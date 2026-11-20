import { Router } from 'express';
import { z } from 'zod';
import { idParamSchema, paginationQuerySchema } from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { NotFoundError } from '../../common/exceptions/app-error.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendOk } from '../../common/http/response.js';
import { successEnvelope } from '../../openapi/registry.js';
import { adminDashboard } from '../analytics/dashboard.service.js';
import * as exportsService from './exports.service.js';
import { REPORTS, reportByKey, runReport } from './reports.js';

export const reportsRouter = Router();
const tags = ['Reports and analytics'];
const uuid = z.uuid().optional();
const filterSchema = z.object({
  sessionId: uuid,
  schoolId: uuid,
  departmentId: uuid,
  programId: uuid,
  courseId: uuid,
  status: z.string().trim().max(40).optional(),
  q: z.string().trim().max(100).optional(),
});
const loose = (id: string) => z.object({}).passthrough().meta({ id });
const exportJob = z
  .object({
    id: z.uuid(),
    reportKey: z.string(),
    report: z.string(),
    format: z.enum(['CSV', 'XLSX']),
    status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']),
    rowCount: z.number().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
  })
  .meta({ id: 'ExportJob' });

defineRoute(
  reportsRouter,
  {
    method: 'get',
    path: '/dashboards/admin',
    summary: 'Administrator dashboard: counts, charts, widgets and alerts within your scope',
    tags,
    access: { permission: 'dashboard:admin' },
    request: {
      query: z.object({
        academicYearId: uuid,
        sessionId: uuid,
        schoolId: uuid,
        departmentId: uuid,
        degreeId: uuid,
        programId: uuid,
        specializationId: uuid,
        courseId: uuid,
      }),
    },
    responses: {
      200: { description: 'Dashboard', schema: successEnvelope(loose('AdminDashboard')) },
    },
  },
  async (req, res) => {
    sendOk(res, await adminDashboard(getActor(req), req.valid.query), 'Dashboard');
  },
);

defineRoute(
  reportsRouter,
  {
    method: 'get',
    path: '/reports',
    summary: 'The report catalogue with columns and supported filters',
    tags,
    access: { permission: 'report:read' },
    responses: {
      200: { description: 'Reports', schema: successEnvelope(z.array(loose('ReportInfo'))) },
    },
  },
  async (_req, res) => {
    sendOk(
      res,
      REPORTS.map(({ run: _run, ...info }) => info),
      'Reports',
    );
  },
);

defineRoute(
  reportsRouter,
  {
    method: 'get',
    path: '/reports/exports',
    summary: 'Your report exports, newest first',
    tags,
    access: { permission: 'report:export' },
    responses: { 200: { description: 'Exports', schema: successEnvelope(z.array(exportJob)) } },
  },
  async (req, res) => {
    sendOk(res, await exportsService.myExports(getActor(req)), 'Exports');
  },
);

defineRoute(
  reportsRouter,
  {
    method: 'get',
    path: '/reports/exports/:id/download',
    summary: 'Short-lived download link for a finished export',
    tags,
    access: { permission: 'report:export' },
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Link',
        schema: successEnvelope(z.object({ url: z.string(), expiresInSeconds: z.number() })),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await exportsService.exportLink(getActor(req), req.valid.params.id), 'Link');
  },
);

defineRoute(
  reportsRouter,
  {
    method: 'get',
    path: '/reports/:key',
    summary: 'Run a report with server-side filters, sorting and pagination (scoped)',
    tags,
    access: { permission: 'report:read' },
    request: {
      params: z.object({ key: z.string().max(60) }),
      query: paginationQuerySchema.extend(filterSchema.shape).extend({
        sort: z.string().max(60).optional(),
      }),
    },
    responses: {
      200: {
        description: 'Report page',
        schema: successEnvelope(
          z.object({
            rows: z.array(z.record(z.string(), z.unknown())),
            total: z.number(),
            page: z.number(),
            limit: z.number(),
            sort: z.string(),
            sessionId: z.string().nullable(),
          }),
        ),
      },
    },
  },
  async (req, res) => {
    const report = reportByKey.get(req.valid.params.key);
    if (!report) throw new NotFoundError('Report');
    const { page, limit, sort, ...filters } = req.valid.query;
    const result = await runReport(getActor(req), report, filters, sort);
    sendOk(
      res,
      {
        rows: result.rows.slice((page - 1) * limit, page * limit),
        total: result.rows.length,
        page,
        limit,
        sort: result.sort,
        sessionId: result.sessionId,
      },
      'Report',
    );
  },
);

defineRoute(
  reportsRouter,
  {
    method: 'post',
    path: '/reports/:key/export',
    summary: 'Export a report to CSV or XLSX (background above 5,000 rows); audited',
    tags,
    access: { permission: 'report:export' },
    request: {
      params: z.object({ key: z.string().max(60) }),
      body: z.object({
        format: z.enum(['CSV', 'XLSX']),
        filters: filterSchema.default({}),
        sort: z.string().max(60).optional(),
      }),
    },
    responses: { 200: { description: 'Export', schema: successEnvelope(exportJob) } },
  },
  async (req, res) => {
    const b = req.valid.body;
    const job = await exportsService.requestExport(getActor(req), req.valid.params.key, b.format, {
      filters: b.filters,
      sort: b.sort,
    });
    sendOk(res, job, job.status === 'COMPLETED' ? 'Export ready' : 'Export queued');
  },
);
