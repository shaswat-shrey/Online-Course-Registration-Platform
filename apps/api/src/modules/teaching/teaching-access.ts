import type { PermissionKey } from '@ucrams/shared';
import type { ActorContext } from '../../common/context/actor.js';
import { ForbiddenError, NotFoundError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { covers } from '../authz/authz.js';

/**
 * Who the caller is to a section (ADR-014): an administrator whose grant covers
 * the course's department, one of its instructors (relationship), a registered
 * student, or nobody.
 */
export async function sectionAccess(actor: ActorContext, sectionId: string) {
  const section = await prisma.courseSection.findUnique({
    where: { id: sectionId },
    select: {
      id: true,
      status: true,
      sessionId: true,
      sectionCode: true,
      course: {
        select: {
          code: true,
          title: true,
          departmentId: true,
          department: { select: { schoolId: true } },
        },
      },
      instructors: {
        select: { role: true, facultyMemberId: true, facultyMember: { select: { userId: true } } },
      },
    },
  });
  if (!section) throw new NotFoundError('Section');
  const target = {
    departmentId: section.course.departmentId,
    schoolId: section.course.department.schoolId,
  };
  const instructor =
    section.instructors.find((i) => i.facultyMember.userId === actor.userId) ?? null;
  return { section, target, instructor };
}
export type SectionAccess = Awaited<ReturnType<typeof sectionAccess>>;

/** Organisational grant over the department, or the permission (any scope) plus teaching the section. */
export function canInSection(
  actor: ActorContext,
  access: SectionAccess,
  permission: PermissionKey,
): boolean {
  if (covers(actor.grants, permission, access.target)) return true;
  return !!access.instructor && (actor.grants[permission]?.length ?? 0) > 0;
}

export function assertInSection(
  actor: ActorContext,
  access: SectionAccess,
  permission: PermissionKey,
) {
  if (!canInSection(actor, access, permission)) {
    // Hide sections the caller has no relationship with at all.
    if (!access.instructor && !(actor.grants[permission] ?? []).some((g) => g.scope !== 'OWN'))
      throw new NotFoundError('Section');
    throw new ForbiddenError();
  }
}

/** A student holding (or having held) a seat in the section may read its published content. */
export async function isSectionStudent(actor: ActorContext, sectionId: string): Promise<boolean> {
  const count = await prisma.courseRegistration.count({
    where: {
      sectionId,
      status: { in: ['REGISTERED', 'PENDING', 'COMPLETED'] },
      student: { userId: actor.userId },
    },
  });
  return count > 0;
}

export async function facultyMemberOf(actor: ActorContext) {
  const f = await prisma.facultyMember.findUnique({
    where: { userId: actor.userId },
    select: { id: true, maxLoadCredits: true, userId: true },
  });
  if (!f) throw new ForbiddenError('Only faculty members have teaching assignments');
  return f;
}
