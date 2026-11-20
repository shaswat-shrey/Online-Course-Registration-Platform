import { z } from 'zod';

/** OpenAPI response shapes for structure modules. */
const ref = z.object({ id: z.uuid(), name: z.string() });
const refWithCode = ref.extend({ code: z.string() });
const timestamps = { createdAt: z.string(), updatedAt: z.string() };
const person = z.object({ id: z.uuid(), name: z.string(), designation: z.string() }).nullable();

export const schoolDto = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    campus: ref.nullable(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    website: z.string().nullable(),
    dean: person,
    status: z.string(),
    departmentCount: z.number(),
    programCount: z.number().optional(),
    ...timestamps,
  })
  .meta({ id: 'School' });

export const departmentDto = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    school: refWithCode,
    campus: ref.nullable(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    officeLocation: z.string().nullable(),
    head: person,
    status: z.string(),
    programCount: z.number(),
    facultyCount: z.number(),
    specializationCount: z.number().optional(),
    studentCount: z.number().optional(),
    canManage: z.boolean().describe('Whether the caller may edit this department'),
    ...timestamps,
  })
  .meta({ id: 'Department' });

export const degreeDto = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    level: z.string(),
    description: z.string().nullable(),
    status: z.string(),
    programCount: z.number(),
  })
  .meta({ id: 'Degree' });

export const requirementGroupDto = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    kind: z.string(),
    minCredits: z.number().nullable(),
    category: z.string().nullable(),
    position: z.number(),
  })
  .meta({ id: 'RequirementGroup' });

export const specializationDto = z
  .object({
    id: z.uuid(),
    programId: z.uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    additionalCredits: z.number().nullable(),
    status: z.string(),
    requirementGroups: z.array(requirementGroupDto).optional(),
    ...timestamps,
  })
  .meta({ id: 'Specialization' });

export const programDto = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    degree: refWithCode.extend({ level: z.string() }),
    department: refWithCode.extend({ schoolId: z.uuid() }),
    durationYears: z.number(),
    sessionCount: z.number(),
    totalCredits: z.number(),
    minCoreCredits: z.number().nullable(),
    minElectiveCredits: z.number().nullable(),
    status: z.string(),
    specializationCount: z.number(),
    canManage: z.boolean(),
    specializations: z.array(specializationDto).optional(),
    requirementGroups: z.array(requirementGroupDto).optional(),
    ...timestamps,
  })
  .meta({ id: 'Program' });
