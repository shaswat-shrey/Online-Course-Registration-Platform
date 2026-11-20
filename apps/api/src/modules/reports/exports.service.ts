import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import type { ActorContext } from '../../common/context/actor.js';
import { ForbiddenError, NotFoundError } from '../../common/exceptions/app-error.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { getQueue, QueueName } from '../../infrastructure/queues/queues.js';
import { storage } from '../../infrastructure/storage/index.js';
import { recordAudit } from '../audit/audit.service.js';
import { hasPermission } from '../authz/authz.js';
import { computeAuthState } from '../authz/grants.service.js';
import { queueNotifications } from '../notifications/notifications.service.js';
import { csvCell } from '../teaching/teaching.service.js';
import {
  reportByKey,
  runReport,
  type ReportDefinition,
  type ReportFilters,
  type Row,
} from './reports.js';

/** Exports above this many rows run in the background (FR-RPT-003). */
export const SYNC_EXPORT_LIMIT = 5000;
const MIME = {
  CSV: 'text/csv',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
type Format = keyof typeof MIME;

export interface ExportParams {
  filters: ReportFilters;
  sort?: string;
}

/** CSV (UTF-8 BOM, formula-safe cells) or XLSX with a bold header and typed columns. */
export async function renderFile(report: ReportDefinition, rows: Row[], format: Format) {
  if (format === 'CSV') {
    const lines = [
      report.columns.map((c) => csvCell(c.label)).join(','),
      ...rows.map((r) => report.columns.map((c) => csvCell(r[c.key])).join(',')),
    ];
    return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
  }
  const book = new ExcelJS.Workbook();
  book.creator = 'UCRAMS';
  const sheet = book.addWorksheet(report.title.slice(0, 31));
  sheet.columns = report.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.max(12, Math.min(40, c.label.length + 6)),
    style: c.type === 'percent' ? { numFmt: '0.0"%"' } : {},
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) sheet.addRow(r);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function storeExport(
  jobId: string,
  ownerId: string,
  report: ReportDefinition,
  rows: Row[],
  format: Format,
) {
  const body = await renderFile(report, rows, format);
  const ext = format === 'CSV' ? 'csv' : 'xlsx';
  const key = `export/${ownerId}/${randomUUID()}.${ext}`;
  await storage.putObject(key, body, MIME[format]);
  const stamp = new Date().toISOString().slice(0, 10);
  const file = await prisma.storedFile.create({
    data: {
      ownerId,
      storageKey: key,
      originalName: `${report.key}-${stamp}.${ext}`,
      mimeType: MIME[format],
      sizeBytes: body.length,
      context: 'EXPORT',
      status: 'READY',
      completedAt: new Date(),
    },
  });
  return prisma.exportJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', rowCount: rows.length, fileId: file.id, completedAt: new Date() },
  });
}

const jobDto = (j: {
  id: string;
  reportKey: string;
  format: string;
  status: string;
  rowCount: number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}) => ({
  id: j.id,
  reportKey: j.reportKey,
  report: reportByKey.get(j.reportKey)?.title ?? j.reportKey,
  format: j.format,
  status: j.status,
  rowCount: j.rowCount,
  error: j.error,
  createdAt: j.createdAt.toISOString(),
  completedAt: j.completedAt?.toISOString() ?? null,
});

/**
 * Starts an export (FR-RPT-003/004): up to 5,000 rows are written at once;
 * larger exports are queued and the requester is notified when the file is ready.
 */
export async function requestExport(
  actor: ActorContext,
  reportKey: string,
  format: Format,
  params: ExportParams,
) {
  if (!hasPermission(actor.grants, 'report:export')) throw new ForbiddenError();
  const report = reportByKey.get(reportKey);
  if (!report) throw new NotFoundError('Report');
  const { rows, sort } = await runReport(actor, report, params.filters, params.sort);
  const job = await prisma.exportJob.create({
    data: {
      requestedById: actor.userId,
      reportKey,
      format,
      params: { filters: params.filters, sort } as object,
      rowCount: rows.length,
    },
  });
  await recordAudit(actor, {
    action: 'report.exported',
    entityType: 'ExportJob',
    entityId: job.id,
    changes: { reportKey, format, rows: rows.length, filters: params.filters } as never,
  });
  if (rows.length <= SYNC_EXPORT_LIMIT) {
    const done = await storeExport(job.id, actor.userId, report, rows, format);
    return jobDto(done);
  }
  await getQueue(QueueName.EXPORTS).add('export', { jobId: job.id }, { jobId: `export-${job.id}` });
  return jobDto(job);
}

/** Worker: re-runs the report with the requester's current grants, then notifies them. */
export async function processExport(jobId: string) {
  const job = await prisma.exportJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === 'COMPLETED') return { skipped: true };
  const report = reportByKey.get(job.reportKey);
  const auth = await computeAuthState(job.requestedById);
  try {
    if (!report || !auth || auth.status !== 'ACTIVE')
      throw new Error('Report or requester unavailable');
    await prisma.exportJob.update({ where: { id: jobId }, data: { status: 'RUNNING' } });
    const params = job.params as unknown as ExportParams;
    const actor: ActorContext = {
      userId: job.requestedById,
      sessionId: 'export-worker',
      grants: auth.grants,
      ip: null,
      userAgent: null,
      requestId: `export-${jobId}`,
    };
    const { rows } = await runReport(actor, report, params.filters ?? {}, params.sort);
    await storeExport(jobId, job.requestedById, report, rows, job.format);
    const after = await queueNotifications(prisma, [
      {
        userId: job.requestedById,
        category: 'SYSTEM',
        title: `Export ready: ${report.title}`,
        body: `${rows.length} rows are ready to download.`,
        link: '/admin/reports/exports',
      },
    ]);
    after();
    return { rows: rows.length };
  } catch (err) {
    logger.error({ err: (err as Error).message, jobId }, 'Export failed');
    await prisma.exportJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', error: (err as Error).message.slice(0, 1000) },
    });
    throw err;
  }
}

export async function myExports(actor: ActorContext) {
  const jobs = await prisma.exportJob.findMany({
    where: { requestedById: actor.userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return jobs.map(jobDto);
}

/** Signed download for the requester only. */
export async function exportLink(actor: ActorContext, id: string) {
  const job = await prisma.exportJob.findUnique({ where: { id }, include: { file: true } });
  if (!job || job.requestedById !== actor.userId) throw new NotFoundError('Export');
  if (job.status !== 'COMPLETED' || !job.file) throw new NotFoundError('Export file');
  const url = await storage.createDownloadUrl(job.file.storageKey, {
    expiresInSeconds: 300,
    filename: job.file.originalName,
    disposition: 'attachment',
  });
  return { url, expiresInSeconds: 300 };
}
