import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../infrastructure/database/prisma.js';

type Tx = Prisma.TransactionClient | typeof prisma;

/** Atomically increments and returns the next value for `key` (starts at 1). */
export async function nextSequence(key: string, tx: Tx = prisma): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "id_sequences" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "id_sequences"."value" + 1
    RETURNING "value"`;
  return rows[0]!.value;
}

/**
 * Student numbers: two-digit admission year + department code + 4-digit
 * sequence per (year, department), e.g. 26CS0001. Admins may also supply their own.
 */
export async function generateStudentNumber(
  departmentCode: string,
  year: number,
  tx: Tx = prisma,
): Promise<string> {
  const yy = String(year % 100).padStart(2, '0');
  const prefix = `${yy}${departmentCode.replace(/[^A-Z0-9]/gi, '').toUpperCase()}`;
  for (;;) {
    const n = await nextSequence(`student:${prefix}`, tx);
    const candidate = `${prefix}${String(n).padStart(4, '0')}`;
    // Skip numbers taken by manually entered or imported IDs.
    if (
      !(await tx.student.findUnique({ where: { studentNumber: candidate }, select: { id: true } }))
    )
      return candidate;
  }
}

/** Employee numbers: FAC + 5-digit sequence, e.g. FAC00042. */
export async function generateEmployeeNumber(tx: Tx = prisma): Promise<string> {
  for (;;) {
    const n = await nextSequence('faculty', tx);
    const candidate = `FAC${String(n).padStart(5, '0')}`;
    if (
      !(await tx.facultyMember.findUnique({
        where: { employeeNumber: candidate },
        select: { id: true },
      }))
    )
      return candidate;
  }
}
