import { z } from 'zod';

/** OpenAPI response shapes for courses, classrooms and sections. */
const ref = z.object({ id: z.uuid(), code: z.string(), name: z.string() });
const courseRef = z.object({
  id: z.uuid(),
  code: z.string(),
  title: z.string(),
  credits: z.number(),
  status: z.string(),
});
const timestamps = { createdAt: z.string(), updatedAt: z.string() };
const restriction = z.object({
  id: z.uuid(),
  mode: z.string(),
  targetType: z.string(),
  targetId: z.uuid().nullable(),
  targetValue: z.number().nullable(),
  label: z.string(),
});

export const classroomDto = z
  .object({
    id: z.uuid(),
    campus: ref,
    building: z.string(),
    roomNumber: z.string(),
    name: z.string().nullable(),
    label: z.string(),
    capacity: z.number(),
    type: z.string(),
    equipment: z.array(z.string()),
    status: z.string(),
    meetingCount: z.number(),
    ...timestamps,
  })
  .meta({ id: 'Classroom' });

export const courseDto = z
  .object({
    id: z.uuid(),
    code: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    department: ref,
    credits: z.number(),
    level: z.number(),
    category: z.string(),
    recommendedYear: z.number().nullable(),
    recommendedSessionType: z.string().nullable(),
    defaultCapacity: z.number().nullable(),
    minEnrollment: z.number().nullable(),
    coordinator: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    isRepeatable: z.boolean(),
    status: z.string(),
    sectionCount: z.number(),
    hasPrerequisites: z.boolean(),
    canManage: z.boolean(),
    ...timestamps,
  })
  .meta({ id: 'Course' });

export const courseDetailDto = courseDto
  .extend({
    syllabus: z.string().nullable(),
    outcomes: z.array(z.string()),
    assessmentComponents: z.array(z.object({ name: z.string(), weight: z.number() })),
    prerequisites: z.array(
      z.object({
        id: z.uuid(),
        items: z.array(z.object({ course: courseRef, minGradeLetter: z.string().nullable() })),
      }),
    ),
    corequisites: z.array(courseRef),
    requiredBy: z.array(courseRef),
    programs: z.array(ref.extend({ mappingType: z.string() })),
    specializations: z.array(
      ref.extend({
        program: z.object({ id: z.uuid(), code: z.string() }),
        mappingType: z.string(),
      }),
    ),
    restrictions: z.array(restriction),
    requirementGroups: z.array(
      z.object({ id: z.uuid(), name: z.string(), kind: z.string(), owner: z.string() }),
    ),
    sectionsByStatus: z.record(z.string(), z.number()),
    canArchive: z.boolean(),
    warnings: z.array(z.string()).optional(),
  })
  .meta({ id: 'CourseDetail' });

const meeting = z.object({
  id: z.uuid(),
  dayOfWeek: z.number(),
  startMinute: z.number(),
  endMinute: z.number(),
  type: z.string(),
  classroom: z.object({ id: z.uuid(), label: z.string(), capacity: z.number() }).nullable(),
});

export const sectionDto = z
  .object({
    id: z.uuid(),
    sectionCode: z.string(),
    course: courseRef.extend({ category: z.string(), department: ref }),
    session: z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      status: z.string(),
      startDate: z.string(),
      endDate: z.string(),
    }),
    campus: ref.nullable(),
    capacity: z.number(),
    enrolledCount: z.number(),
    availableSeats: z.number(),
    waitlistCapacity: z.number(),
    waitlistCount: z.number(),
    status: z.string(),
    registrationOpen: z.boolean(),
    notes: z.string().nullable(),
    publishedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
    cancelReason: z.string().nullable(),
    meetings: z.array(meeting),
    instructors: z.array(
      z.object({
        facultyMemberId: z.uuid(),
        name: z.string(),
        email: z.string(),
        designation: z.string(),
        role: z.string(),
      }),
    ),
    hasRestrictions: z.boolean(),
    permissions: z.record(z.string(), z.boolean()),
    ...timestamps,
  })
  .meta({ id: 'Section' });

export const sectionDetailDto = sectionDto
  .extend({ restrictions: z.array(restriction).optional() })
  .meta({ id: 'SectionDetail' });

const conflict = z.object({
  kind: z.enum(['CLASSROOM', 'INSTRUCTOR']),
  resource: z.string(),
  resourceId: z.uuid(),
  dayOfWeek: z.number(),
  startMinute: z.number(),
  endMinute: z.number(),
  section: z.object({ id: z.uuid(), sectionCode: z.string(), courseCode: z.string() }),
});
export const sectionScheduleResultDto = sectionDto
  .extend({ warnings: z.array(z.string()), overriddenConflicts: z.array(conflict) })
  .meta({ id: 'SectionScheduleResult' });

export const rollForwardResultDto = z
  .object({
    created: z.array(
      z.object({
        id: z.uuid(),
        course: z.string(),
        sectionCode: z.string(),
        conflicts: z.number(),
      }),
    ),
    skipped: z.array(z.object({ course: z.string(), sectionCode: z.string(), reason: z.string() })),
    withConflicts: z.number(),
  })
  .meta({ id: 'RollForwardResult' });

export const classroomScheduleDto = z
  .array(
    z.object({
      id: z.uuid(),
      dayOfWeek: z.number(),
      startMinute: z.number(),
      endMinute: z.number(),
      type: z.string(),
      section: z.object({
        id: z.uuid(),
        sectionCode: z.string(),
        status: z.string(),
        course: z.object({ id: z.uuid(), code: z.string(), title: z.string() }),
      }),
    }),
  )
  .meta({ id: 'ClassroomSchedule' });

export const facultyScheduleDto = z
  .object({
    sections: z.array(sectionDto.extend({ role: z.string() })),
    totalCredits: z.number(),
    maxLoadCredits: z.number().nullable(),
  })
  .meta({ id: 'FacultySchedule' });

export const requirementCourseListDto = z.array(courseRef).meta({ id: 'RequirementCourseList' });
