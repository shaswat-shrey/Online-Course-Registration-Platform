import { ErrorCode } from '@ucrams/shared';
import { BusinessRuleError } from '../../common/exceptions/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type { ScopeTarget } from '../authz/authz.js';

export type ScopeInput =
  { scopeType: 'GLOBAL'; scopeId?: null } | { scopeType: 'SCHOOL' | 'DEPARTMENT'; scopeId: string };

const unknown = (label: string) =>
  new BusinessRuleError(ErrorCode.VALIDATION_ERROR, `Unknown ${label}`, {
    fields: [{ path: 'body.scopeId', message: `No ${label} exists with this id` }],
  });

/**
 * Resolves a role-assignment scope to its organisational location so the
 * assigner's coverage can be checked (a SCHOOL grant covers its departments).
 */
export async function resolveScope(input: ScopeInput): Promise<ScopeTarget> {
  if (input.scopeType === 'GLOBAL') return {};
  if (input.scopeType === 'SCHOOL') {
    const school = await prisma.school.findUnique({
      where: { id: input.scopeId },
      select: { id: true },
    });
    if (!school) throw unknown('school');
    return { schoolId: school.id };
  }
  const dept = await prisma.department.findUnique({
    where: { id: input.scopeId },
    select: { id: true, schoolId: true },
  });
  if (!dept) throw unknown('department');
  return { departmentId: dept.id, schoolId: dept.schoolId };
}
