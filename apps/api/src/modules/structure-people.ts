import { ErrorCode } from '@ucrams/shared';
import { BusinessRuleError } from '../common/exceptions/app-error.js';
import { prisma } from '../infrastructure/database/prisma.js';

const invalid = (path: string, message: string) =>
  new BusinessRuleError(ErrorCode.VALIDATION_ERROR, message, {
    fields: [{ path: `body.${path}`, message }],
  });

/** A head of department must be an active faculty member of that department (primary or joint). */
export async function assertHeadCandidate(
  departmentId: string,
  facultyMemberId: string | null | undefined,
) {
  if (!facultyMemberId) return;
  const f = await prisma.facultyMember.findUnique({
    where: { id: facultyMemberId },
    select: {
      departmentId: true,
      employmentStatus: true,
      secondaryDepartments: { select: { departmentId: true } },
    },
  });
  if (!f) throw invalid('headId', 'Unknown faculty member');
  if (f.employmentStatus !== 'ACTIVE') throw invalid('headId', 'Choose an active faculty member');
  if (
    f.departmentId !== departmentId &&
    !f.secondaryDepartments.some((s) => s.departmentId === departmentId)
  ) {
    throw invalid('headId', 'The head must be a faculty member of this department');
  }
}

/** A dean must be an active faculty member whose primary department is in the school. */
export async function assertDeanCandidate(
  schoolId: string,
  facultyMemberId: string | null | undefined,
) {
  if (!facultyMemberId) return;
  const f = await prisma.facultyMember.findUnique({
    where: { id: facultyMemberId },
    select: { employmentStatus: true, department: { select: { schoolId: true } } },
  });
  if (!f) throw invalid('deanId', 'Unknown faculty member');
  if (f.employmentStatus !== 'ACTIVE') throw invalid('deanId', 'Choose an active faculty member');
  if (f.department.schoolId !== schoolId)
    throw invalid('deanId', 'The dean must belong to one of this faculty’s departments');
}

export const personRef = {
  select: { id: true, user: { select: { firstName: true, lastName: true } }, designation: true },
} as const;

export function personDto(
  p: { id: string; designation: string; user: { firstName: string; lastName: string } } | null,
) {
  return p
    ? { id: p.id, name: `${p.user.firstName} ${p.user.lastName}`, designation: p.designation }
    : null;
}
