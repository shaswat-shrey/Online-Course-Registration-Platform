import { ErrorCode, type AudienceType } from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import { AppError, BusinessRuleError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { covers, hasGlobal, hasPermission } from '../authz/authz.js';
import {
  CURRENT_SESSION,
  departmentOf,
  loadPerson,
  RUNNING_SECTION,
  SEAT_HOLDING,
  type Person,
} from '../messaging/people.js';
import { assertInSection, sectionAccess } from '../teaching/teaching-access.js';

export interface Audience {
  type: AudienceType;
  targetId: string | null;
  targetValue: number | null;
  roleFilter: 'ANY' | 'STUDENT' | 'FACULTY';
}

const notAllowed = (what: string) =>
  new AppError(403, ErrorCode.AUDIENCE_NOT_ALLOWED, `You cannot send announcements to ${what}`);
const unknown = (what: string) =>
  new BusinessRuleError(ErrorCode.VALIDATION_ERROR, `Unknown ${what}`, {
    fields: [{ path: 'body.audiences', message: `Unknown ${what}` }],
  });

/** Does the faculty user teach a current section of the course (or coordinate it)? */
async function teachesCourse(userId: string, courseId: string) {
  const n = await prisma.course.count({
    where: {
      id: courseId,
      OR: [
        { coordinator: { userId } },
        {
          sections: {
            some: {
              status: RUNNING_SECTION,
              session: CURRENT_SESSION,
              instructors: { some: { facultyMember: { userId } } },
            },
          },
        },
      ],
    },
  });
  return n > 0;
}

/**
 * FR-COMM-011: faculty announce to their own sections and courses; scoped
 * administrators to schools, departments, programmes, specializations, courses,
 * sections, years and people inside their scope; university-wide audiences need
 * `announcement:publish_global`.
 */
export async function assertCanTarget(actor: ActorContext, audiences: Audience[]) {
  const scoped = (target: { schoolId?: string | null; departmentId?: string | null }) =>
    covers(actor.grants, 'announcement:publish_scoped', target) ||
    covers(actor.grants, 'announcement:publish_global', target);
  for (const a of audiences) {
    switch (a.type) {
      case 'ALL_USERS':
      case 'ALL_STUDENTS':
      case 'ALL_FACULTY':
      case 'ALL_ADMINS':
        if (!hasGlobal(actor.grants, 'announcement:publish_global'))
          throw notAllowed('everyone in the university');
        break;
      case 'SECTION': {
        const access = await sectionAccess(actor, a.targetId!);
        assertInSection(actor, access, 'announcement:publish_section');
        if (!['PUBLISHED', 'CLOSED'].includes(access.section.status))
          throw new BusinessRuleError(
            ErrorCode.VALIDATION_ERROR,
            `${access.section.course.code} ${access.section.sectionCode} is not running`,
            { fields: [{ path: 'body.sectionIds', message: 'Only published or closed sections' }] },
          );
        break;
      }
      case 'COURSE': {
        const course = await prisma.course.findUnique({
          where: { id: a.targetId! },
          select: { departmentId: true, department: { select: { schoolId: true } } },
        });
        if (!course) throw unknown('course');
        const target = { departmentId: course.departmentId, schoolId: course.department.schoolId };
        const ok =
          scoped(target) ||
          covers(actor.grants, 'announcement:publish_section', target) ||
          (hasPermission(actor.grants, 'announcement:publish_section') &&
            (await teachesCourse(actor.userId, a.targetId!)));
        if (!ok) throw notAllowed('this course');
        break;
      }
      case 'SCHOOL':
        if (!(await prisma.school.count({ where: { id: a.targetId! } }))) throw unknown('school');
        if (!scoped({ schoolId: a.targetId })) throw notAllowed('this school');
        break;
      case 'DEPARTMENT':
      case 'YEAR_OF_STUDY': {
        if (!a.targetId) {
          if (
            !hasGlobal(actor.grants, 'announcement:publish_scoped') &&
            !hasGlobal(actor.grants, 'announcement:publish_global')
          )
            throw notAllowed('a year group across the university');
          break;
        }
        const d = await prisma.department.findUnique({
          where: { id: a.targetId },
          select: { schoolId: true },
        });
        if (!d) throw unknown('department');
        if (!scoped({ departmentId: a.targetId, schoolId: d.schoolId }))
          throw notAllowed('this department');
        break;
      }
      case 'PROGRAM': {
        const p = await prisma.program.findUnique({
          where: { id: a.targetId! },
          select: { departmentId: true, department: { select: { schoolId: true } } },
        });
        if (!p) throw unknown('programme');
        if (!scoped({ departmentId: p.departmentId, schoolId: p.department.schoolId }))
          throw notAllowed('this programme');
        break;
      }
      case 'SPECIALIZATION': {
        const s = await prisma.specialization.findUnique({
          where: { id: a.targetId! },
          select: {
            program: {
              select: { departmentId: true, department: { select: { schoolId: true } } },
            },
          },
        });
        if (!s) throw unknown('specialization');
        if (
          !scoped({
            departmentId: s.program.departmentId,
            schoolId: s.program.department.schoolId,
          })
        )
          throw notAllowed('this specialization');
        break;
      }
      case 'USER': {
        const person = await loadPerson(a.targetId!);
        if (!person) throw unknown('user');
        const dept = departmentOf(person);
        const ok = dept
          ? scoped(dept)
          : hasGlobal(actor.grants, 'announcement:publish_scoped') ||
            hasGlobal(actor.grants, 'announcement:publish_global');
        if (!ok) throw notAllowed(person.name);
        break;
      }
    }
  }
}

// ----- who sees what ---------------------------------------------------------------

export interface Viewer {
  person: Person;
  studentSectionIds: string[];
  studentCourseIds: string[];
  facultySectionIds: string[];
  facultyCourseIds: string[];
}

export async function loadViewer(userId: string): Promise<Viewer | null> {
  const person = await loadPerson(userId);
  if (!person) return null;
  const [held, taught] = await Promise.all([
    person.student
      ? prisma.courseRegistration.findMany({
          where: { student: { userId }, status: { in: [...SEAT_HOLDING] } },
          select: { sectionId: true, courseId: true },
        })
      : [],
    person.faculty
      ? prisma.sectionInstructor.findMany({
          where: {
            facultyMember: { userId },
            section: { status: RUNNING_SECTION, session: CURRENT_SESSION },
          },
          select: { sectionId: true, section: { select: { courseId: true } } },
        })
      : [],
  ]);
  return {
    person,
    studentSectionIds: held.map((h) => h.sectionId),
    studentCourseIds: [...new Set(held.map((h) => h.courseId))],
    facultySectionIds: taught.map((t) => t.sectionId),
    facultyCourseIds: [...new Set(taught.map((t) => t.section.courseId))],
  };
}

/** Audience conditions matching the viewer, evaluated at read time (FR-COMM-009). */
export function audienceMatch(v: Viewer): Prisma.AnnouncementAudienceWhereInput[] {
  const { person } = v;
  const or: Prisma.AnnouncementAudienceWhereInput[] = [
    { targetType: 'ALL_USERS' },
    { targetType: 'USER', targetId: person.id },
  ];
  if (person.isAdmin) or.push({ targetType: 'ALL_ADMINS' });
  const s = person.student;
  if (s) {
    const roleFilter = { in: ['ANY' as const, 'STUDENT' as const] };
    or.push(
      { targetType: 'ALL_STUDENTS' },
      { targetType: 'SCHOOL', targetId: s.schoolId, roleFilter },
      { targetType: 'DEPARTMENT', targetId: s.departmentId, roleFilter },
      { targetType: 'PROGRAM', targetId: s.programId },
      {
        targetType: 'YEAR_OF_STUDY',
        targetValue: s.yearOfStudy,
        OR: [{ targetId: null }, { targetId: s.departmentId }],
      },
      { targetType: 'COURSE', targetId: { in: v.studentCourseIds }, roleFilter },
      { targetType: 'SECTION', targetId: { in: v.studentSectionIds }, roleFilter },
    );
    if (s.specializationId) or.push({ targetType: 'SPECIALIZATION', targetId: s.specializationId });
  }
  const f = person.faculty;
  if (f) {
    const roleFilter = { in: ['ANY' as const, 'FACULTY' as const] };
    or.push(
      { targetType: 'ALL_FACULTY' },
      { targetType: 'SCHOOL', targetId: f.schoolId, roleFilter },
      { targetType: 'DEPARTMENT', targetId: f.departmentId, roleFilter },
      { targetType: 'COURSE', targetId: { in: v.facultyCourseIds }, roleFilter },
      { targetType: 'SECTION', targetId: { in: v.facultySectionIds }, roleFilter },
    );
  }
  return or;
}

/** Everyone an announcement reaches, resolved at publish time for the notification fan-out. */
export async function resolveRecipients(audiences: Audience[]): Promise<Set<string>> {
  const ids = new Set<string>();
  const add = async (where: Prisma.UserWhereInput) => {
    const rows = await prisma.user.findMany({
      where: { status: 'ACTIVE', ...where },
      select: { id: true },
    });
    for (const r of rows) ids.add(r.id);
  };
  const students = (a: Audience) => a.roleFilter !== 'FACULTY';
  const faculty = (a: Audience) => a.roleFilter !== 'STUDENT';
  const seatIn = (section: Prisma.CourseSectionWhereInput): Prisma.UserWhereInput => ({
    student: { registrations: { some: { status: { in: [...SEAT_HOLDING] }, section } } },
  });
  const teaches = (section: Prisma.CourseSectionWhereInput): Prisma.UserWhereInput => ({
    facultyMember: { sectionAssignments: { some: { section } } },
  });
  for (const a of audiences) {
    const id = a.targetId!;
    switch (a.type) {
      case 'ALL_USERS':
        await add({});
        break;
      case 'ALL_STUDENTS':
        await add({ student: { isNot: null } });
        break;
      case 'ALL_FACULTY':
        await add({ facultyMember: { isNot: null } });
        break;
      case 'ALL_ADMINS':
        await add({ roles: { some: { role: { scopeMode: 'ORGANIZATIONAL' } } } });
        break;
      case 'USER':
        await add({ id });
        break;
      case 'SCHOOL':
        if (students(a)) await add({ student: { program: { department: { schoolId: id } } } });
        if (faculty(a)) await add({ facultyMember: { department: { schoolId: id } } });
        break;
      case 'DEPARTMENT':
        if (students(a)) await add({ student: { program: { departmentId: id } } });
        if (faculty(a)) await add({ facultyMember: { departmentId: id } });
        break;
      case 'PROGRAM':
        await add({ student: { programId: id } });
        break;
      case 'SPECIALIZATION':
        await add({ student: { specializationId: id } });
        break;
      case 'YEAR_OF_STUDY':
        await add({
          student: {
            yearOfStudy: a.targetValue!,
            ...(a.targetId ? { program: { departmentId: a.targetId } } : {}),
          },
        });
        break;
      case 'COURSE': {
        const section = { courseId: id, status: RUNNING_SECTION, session: CURRENT_SESSION };
        if (students(a)) await add(seatIn(section));
        if (faculty(a)) await add(teaches(section));
        break;
      }
      case 'SECTION':
        if (students(a)) await add(seatIn({ id }));
        if (faculty(a)) await add(teaches({ id }));
        break;
    }
  }
  return ids;
}

// ----- labels ---------------------------------------------------------------------------

const FIXED: Partial<Record<AudienceType, string>> = {
  ALL_USERS: 'Everyone',
  ALL_STUDENTS: 'All students',
  ALL_FACULTY: 'All faculty',
  ALL_ADMINS: 'All administrators',
};

/** Human-readable audience labels for a batch of audiences. */
export async function audienceLabels(audiences: Audience[]) {
  const ids = (t: AudienceType) => [
    ...new Set(audiences.filter((a) => a.type === t && a.targetId).map((a) => a.targetId!)),
  ];
  const yearDepts = ids('YEAR_OF_STUDY');
  const [users, schools, depts, programs, specs, courses, sections] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: ids('USER') } },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.school.findMany({
      where: { id: { in: ids('SCHOOL') } },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { id: { in: [...ids('DEPARTMENT'), ...yearDepts] } },
      select: { id: true, code: true, name: true },
    }),
    prisma.program.findMany({
      where: { id: { in: ids('PROGRAM') } },
      select: { id: true, code: true, name: true },
    }),
    prisma.specialization.findMany({
      where: { id: { in: ids('SPECIALIZATION') } },
      select: { id: true, name: true },
    }),
    prisma.course.findMany({
      where: { id: { in: ids('COURSE') } },
      select: { id: true, code: true, title: true },
    }),
    prisma.courseSection.findMany({
      where: { id: { in: ids('SECTION') } },
      select: { id: true, sectionCode: true, course: { select: { code: true } } },
    }),
  ]);
  const names = new Map<string, string>([
    ...users.map((u) => [u.id, `${u.firstName} ${u.lastName}`] as const),
    ...schools.map((s) => [s.id, s.name] as const),
    ...depts.map((d) => [d.id, d.name] as const),
    ...programs.map((p) => [p.id, `${p.code} · ${p.name}`] as const),
    ...specs.map((s) => [s.id, s.name] as const),
    ...courses.map((c) => [c.id, `${c.code} · ${c.title}`] as const),
    ...sections.map((s) => [s.id, `${s.course.code} ${s.sectionCode}`] as const),
  ]);
  const deptCode = new Map(depts.map((d) => [d.id, d.code]));
  return (a: Audience) => {
    const base =
      FIXED[a.type] ??
      (a.type === 'YEAR_OF_STUDY'
        ? `Year ${a.targetValue}${a.targetId ? ` · ${deptCode.get(a.targetId) ?? 'department'}` : ''} students`
        : (names.get(a.targetId!) ?? 'Removed'));
    return a.roleFilter === 'ANY' ||
      ['PROGRAM', 'SPECIALIZATION', 'YEAR_OF_STUDY', 'USER'].includes(a.type)
      ? base
      : `${base} (${a.roleFilter === 'STUDENT' ? 'students' : 'faculty'})`;
  };
}
