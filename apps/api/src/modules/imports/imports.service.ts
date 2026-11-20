import {
  ErrorCode,
  FACULTY_IMPORT_COLUMNS,
  facultyImportRowSchema,
  STUDENT_IMPORT_COLUMNS,
  studentImportRowSchema,
  type FacultyImportRow,
  type PermissionKey,
  type StudentImportRow,
} from '@ucrams/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ActorContext } from '../../common/context/actor.js';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
} from '../../common/exceptions/app-error.js';
import { paging } from '../../common/http/list-query.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { getQueue, QueueName } from '../../infrastructure/queues/queues.js';
import { recordAudit } from '../audit/audit.service.js';
import { covers, hasGlobal, hasPermission } from '../authz/authz.js';
import { generateEmployeeNumber, generateStudentNumber } from '../users/id-sequences.js';
import { createInvitedUser, sendInvitations } from '../users/provisioning.js';
import { parseImportFile } from './import-parser.js';

type Kind = 'STUDENTS' | 'FACULTY';
type RowError = { field: string; message: string };

const PERMS: Record<Kind, { import: PermissionKey; create: PermissionKey }> = {
  STUDENTS: { import: 'student:import', create: 'student:create' },
  FACULTY: { import: 'faculty:import', create: 'faculty:create' },
};

function assertCanImport(actor: ActorContext, kind: Kind) {
  if (!hasPermission(actor.grants, PERMS[kind].import)) throw new ForbiddenError();
}

/** Resolved database references for a validated row (stored with the row). */
type StudentResolved = StudentImportRow & {
  programId: string;
  departmentCode: string;
  specializationId: string | null;
  admissionSessionId: string | null;
  admissionYear: number;
};
type FacultyResolved = FacultyImportRow & { departmentId: string };

/**
 * Parses and validates an upload; nothing is created yet (FR-USER-005 preview).
 * Row checks: schema, references (codes), duplicates in the file and the
 * database, and the uploader's scope for each row's department.
 */
export async function previewImport(
  actor: ActorContext,
  kind: Kind,
  file: { originalname: string; buffer: Buffer },
) {
  assertCanImport(actor, kind);
  const columns = kind === 'STUDENTS' ? STUDENT_IMPORT_COLUMNS : FACULTY_IMPORT_COLUMNS;
  const parsed = await parseImportFile(file.originalname, file.buffer, columns);

  const [programs, specializations, sessions, departments] = await Promise.all([
    kind === 'STUDENTS'
      ? prisma.program.findMany({
          select: {
            id: true,
            code: true,
            status: true,
            department: { select: { id: true, code: true, schoolId: true } },
          },
        })
      : [],
    kind === 'STUDENTS'
      ? prisma.specialization.findMany({
          select: { id: true, code: true, programId: true, status: true },
        })
      : [],
    kind === 'STUDENTS'
      ? prisma.academicSession.findMany({ select: { id: true, code: true, startDate: true } })
      : [],
    prisma.department.findMany({ select: { id: true, code: true, schoolId: true, status: true } }),
  ]);
  const programByCode = new Map(programs.map((p) => [p.code, p]));
  const sessionByCode = new Map(sessions.map((s) => [s.code, s]));
  const deptByCode = new Map(departments.map((d) => [d.code, d]));

  const emails = parsed.map((r) => (r.values.email ?? '').trim().toLowerCase()).filter(Boolean);
  const numbers = parsed
    .map((r) =>
      (r.values[kind === 'STUDENTS' ? 'student_number' : 'employee_number'] ?? '')
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);
  const [existingEmails, existingNumbers] = await Promise.all([
    prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    kind === 'STUDENTS'
      ? prisma.student.findMany({
          where: { studentNumber: { in: numbers } },
          select: { studentNumber: true },
        })
      : prisma.facultyMember.findMany({
          where: { employeeNumber: { in: numbers } },
          select: { employeeNumber: true },
        }),
  ]);
  const takenEmails = new Set(existingEmails.map((u) => u.email.toLowerCase()));
  const takenNumbers = new Set(
    existingNumbers.map((r) => ('studentNumber' in r ? r.studentNumber : r.employeeNumber)),
  );
  const seenEmails = new Map<string, number>();
  const seenNumbers = new Map<string, number>();

  const rows = parsed.map(({ rowNumber, values }) => {
    const errors: RowError[] = [];
    const schema = kind === 'STUDENTS' ? studentImportRowSchema : facultyImportRowSchema;
    const result = schema.safeParse(values);
    if (!result.success) {
      for (const issue of result.error.issues)
        errors.push({ field: String(issue.path[0] ?? 'row'), message: issue.message });
      return {
        rowNumber,
        data: values as Prisma.InputJsonValue,
        status: 'INVALID' as const,
        errors,
      };
    }
    const row = result.data;
    if (takenEmails.has(row.email))
      errors.push({ field: 'email', message: 'An account with this email already exists' });
    if (seenEmails.has(row.email))
      errors.push({ field: 'email', message: `Duplicate of row ${seenEmails.get(row.email)}` });
    seenEmails.set(row.email, rowNumber);
    const number = 'student_number' in row ? row.student_number : row.employee_number;
    if (number) {
      if (takenNumbers.has(number))
        errors.push({
          field: kind === 'STUDENTS' ? 'student_number' : 'employee_number',
          message: 'Already in use',
        });
      if (seenNumbers.has(number))
        errors.push({
          field: kind === 'STUDENTS' ? 'student_number' : 'employee_number',
          message: `Duplicate of row ${seenNumbers.get(number)}`,
        });
      seenNumbers.set(number, rowNumber);
    }

    let resolved: StudentResolved | FacultyResolved | null = null;
    if ('program_code' in row) {
      const program = programByCode.get(row.program_code);
      if (!program)
        errors.push({ field: 'program_code', message: `Unknown program ${row.program_code}` });
      else if (program.status !== 'ACTIVE')
        errors.push({ field: 'program_code', message: 'Program is not active' });
      else if (
        !covers(actor.grants, PERMS[kind].create, {
          departmentId: program.department.id,
          schoolId: program.department.schoolId,
        })
      ) {
        errors.push({ field: 'program_code', message: 'Outside your administrative scope' });
      }
      let specializationId: string | null = null;
      if (row.specialization_code && program) {
        const spec = specializations.find(
          (s) => s.programId === program.id && s.code === row.specialization_code,
        );
        if (!spec)
          errors.push({
            field: 'specialization_code',
            message: `No specialization ${row.specialization_code} in ${program.code}`,
          });
        else if (spec.status !== 'ACTIVE')
          errors.push({ field: 'specialization_code', message: 'Specialization is not active' });
        else specializationId = spec.id;
      }
      let admissionSessionId: string | null = null;
      let admissionYear = new Date().getUTCFullYear();
      if (row.admission_session_code) {
        const session = sessionByCode.get(row.admission_session_code);
        if (!session)
          errors.push({
            field: 'admission_session_code',
            message: `Unknown session ${row.admission_session_code}`,
          });
        else {
          admissionSessionId = session.id;
          admissionYear = session.startDate.getUTCFullYear();
        }
      }
      if (program)
        resolved = {
          ...row,
          programId: program.id,
          departmentCode: program.department.code,
          specializationId,
          admissionSessionId,
          admissionYear,
        };
    } else {
      const dept = deptByCode.get(row.department_code);
      if (!dept)
        errors.push({
          field: 'department_code',
          message: `Unknown department ${row.department_code}`,
        });
      else if (dept.status !== 'ACTIVE')
        errors.push({ field: 'department_code', message: 'Department is not active' });
      else if (
        !covers(actor.grants, PERMS[kind].create, {
          departmentId: dept.id,
          schoolId: dept.schoolId,
        })
      ) {
        errors.push({ field: 'department_code', message: 'Outside your administrative scope' });
      } else resolved = { ...row, departmentId: dept.id };
    }
    return errors.length > 0 || !resolved
      ? {
          rowNumber,
          data: (resolved ?? row) as unknown as Prisma.InputJsonValue,
          status: 'INVALID' as const,
          errors,
        }
      : {
          rowNumber,
          data: resolved as unknown as Prisma.InputJsonValue,
          status: 'VALID' as const,
          errors: [],
        };
  });

  const validRows = rows.filter((r) => r.status === 'VALID').length;
  const job = await prisma.$transaction(async (tx) => {
    const j = await tx.importJob.create({
      data: {
        kind,
        fileName: file.originalname.slice(0, 255),
        totalRows: rows.length,
        validRows,
        createdById: actor.userId,
      },
    });
    await tx.importJobRow.createMany({
      data: rows.map((r) => ({
        jobId: j.id,
        rowNumber: r.rowNumber,
        data: r.data,
        status: r.status,
        errors: r.errors.length ? r.errors : undefined,
      })),
    });
    await recordAudit(
      actor,
      {
        action: 'import.previewed',
        entityType: 'ImportJob',
        entityId: j.id,
        changes: { kind, totalRows: rows.length, validRows },
      },
      tx,
    );
    return j;
  });
  return getImport(actor, job.id);
}

async function loadJob(actor: ActorContext, id: string) {
  const job = await prisma.importJob.findUnique({
    where: { id },
    include: { createdBy: { select: { firstName: true, lastName: true } } },
  });
  if (!job) throw new NotFoundError('Import');
  // Imports are visible to their creator and to university-wide importers.
  if (job.createdById !== actor.userId && !hasGlobal(actor.grants, PERMS[job.kind].import))
    throw new NotFoundError('Import');
  return job;
}

export async function getImport(actor: ActorContext, id: string) {
  const job = await loadJob(actor, id);
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    fileName: job.fileName,
    sendInvites: job.sendInvites,
    totalRows: job.totalRows,
    validRows: job.validRows,
    invalidRows: job.totalRows - job.validRows,
    createdRows: job.createdRows,
    failedRows: job.failedRows,
    createdBy: `${job.createdBy.firstName} ${job.createdBy.lastName}`,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    errorMessage: job.errorMessage,
  };
}

export async function listImportRows(
  actor: ActorContext,
  id: string,
  q: { page: number; limit: number; status?: string },
) {
  await loadJob(actor, id);
  const where = { jobId: id, ...(q.status ? { status: q.status as never } : {}) };
  const [total, rows] = await Promise.all([
    prisma.importJobRow.count({ where }),
    prisma.importJobRow.findMany({ where, orderBy: { rowNumber: 'asc' }, ...paging(q) }),
  ]);
  return {
    total,
    items: rows.map((r) => {
      const d = r.data as Record<string, unknown>;
      return {
        rowNumber: r.rowNumber,
        status: r.status,
        email: (d.email as string) ?? null,
        name: [d.first_name, d.last_name].filter(Boolean).join(' ') || null,
        reference: (d.program_code ?? d.department_code ?? null) as string | null,
        errors: (r.errors as RowError[] | null) ?? [],
        userId: r.userId,
      };
    }),
  };
}

export async function listImports(actor: ActorContext) {
  const rows = await prisma.importJob.findMany({
    where: { createdById: actor.userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return Promise.all(rows.map((r) => getImport(actor, r.id)));
}

export async function commitImport(actor: ActorContext, id: string, sendInvites: boolean) {
  const job = await loadJob(actor, id);
  assertCanImport(actor, job.kind);
  if (job.status !== 'PREVIEW')
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'This import was already started or cancelled',
    );
  if (job.validRows === 0)
    throw new BusinessRuleError(ErrorCode.VALIDATION_ERROR, 'There are no valid rows to import');
  await prisma.importJob.update({ where: { id }, data: { status: 'QUEUED', sendInvites } });
  await getQueue(QueueName.IMPORTS).add(
    'process',
    { jobId: id },
    { jobId: `import-${id}`, attempts: 1 } /* BullMQ ids cannot contain ':' */,
  );
  await recordAudit(actor, {
    action: 'import.committed',
    entityType: 'ImportJob',
    entityId: id,
    changes: { sendInvites },
  });
  return getImport(actor, id);
}

export async function cancelImport(actor: ActorContext, id: string) {
  const job = await loadJob(actor, id);
  if (job.status !== 'PREVIEW')
    throw new BusinessRuleError(
      ErrorCode.INVALID_STATE_TRANSITION,
      'Only previews can be cancelled',
    );
  await prisma.importJob.update({ where: { id }, data: { status: 'CANCELLED' } });
  return getImport(actor, id);
}

/**
 * Worker: creates one account per valid row, each in its own transaction so a
 * failing row (e.g. an email registered since the preview) doesn't stop the rest.
 */
export async function processImportJob(jobId: string): Promise<void> {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job || (job.status !== 'QUEUED' && job.status !== 'PROCESSING')) return;
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: 'PROCESSING', startedAt: new Date() },
  });
  const created: string[] = [];
  let failed = 0;
  try {
    const rows = await prisma.importJobRow.findMany({
      where: { jobId, status: 'VALID' },
      orderBy: { rowNumber: 'asc' },
    });
    for (const row of rows) {
      try {
        const userId = await prisma.$transaction(async (tx) => {
          if (job.kind === 'STUDENTS') {
            const d = row.data as unknown as StudentResolved;
            const user = await createInvitedUser(tx, {
              email: d.email,
              firstName: d.first_name,
              lastName: d.last_name,
              role: 'STUDENT',
              assignedById: job.createdById,
            });
            await tx.student.create({
              data: {
                userId: user.id,
                studentNumber:
                  d.student_number ??
                  (await generateStudentNumber(d.departmentCode, d.admissionYear, tx)),
                programId: d.programId,
                specializationId: d.specializationId,
                admissionSessionId: d.admissionSessionId,
                yearOfStudy: d.year_of_study,
                cohort: d.cohort,
                phone: d.phone,
              },
            });
            return user.id;
          }
          const d = row.data as unknown as FacultyResolved;
          const user = await createInvitedUser(tx, {
            email: d.email,
            firstName: d.first_name,
            lastName: d.last_name,
            role: 'FACULTY',
            assignedById: job.createdById,
          });
          await tx.facultyMember.create({
            data: {
              userId: user.id,
              employeeNumber: d.employee_number ?? (await generateEmployeeNumber(tx)),
              departmentId: d.departmentId,
              designation: d.designation,
              phone: d.phone,
              officeLocation: d.office_location,
              maxLoadCredits: d.max_load_credits,
            },
          });
          return user.id;
        });
        created.push(userId);
        await prisma.importJobRow.update({
          where: { id: row.id },
          data: { status: 'CREATED', userId },
        });
      } catch (err) {
        failed += 1;
        const message =
          err instanceof Error &&
          'code' in err &&
          (err as { code?: string }).code === ErrorCode.UNIQUE_VIOLATION
            ? err.message
            : 'Could not create this account';
        if (!(err instanceof Error && 'statusCode' in err))
          logger.error({ err, jobId, row: row.rowNumber }, 'Import row failed');
        await prisma.importJobRow.update({
          where: { id: row.id },
          data: { status: 'FAILED', errors: [{ field: 'row', message }] },
        });
      }
      if ((created.length + failed) % 100 === 0) {
        await prisma.importJob.update({
          where: { id: jobId },
          data: { createdRows: created.length, failedRows: failed },
        });
      }
    }
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        createdRows: created.length,
        failedRows: failed,
        finishedAt: new Date(),
      },
    });
    await recordAudit(
      {
        userId: job.createdById,
        ip: null,
        userAgent: 'import-worker',
        requestId: `import:${jobId}`,
      },
      {
        action: 'import.completed',
        entityType: 'ImportJob',
        entityId: jobId,
        changes: { kind: job.kind, created: created.length, failed },
      },
    );
    if (job.sendInvites) await sendInvitations(created);
  } catch (err) {
    logger.error({ err, jobId }, 'Import job failed');
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        createdRows: created.length,
        failedRows: failed,
        finishedAt: new Date(),
        errorMessage: 'The import stopped unexpectedly',
      },
    });
  }
}
