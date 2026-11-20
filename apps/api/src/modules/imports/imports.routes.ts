import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  ErrorCode,
  idParamSchema,
  importCommitSchema,
  paginationQuerySchema,
  STUDENT_IMPORT_COLUMNS,
  FACULTY_IMPORT_COLUMNS,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { AppError, ValidationError } from '../../common/exceptions/app-error.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import { MAX_IMPORT_BYTES, templateCsv } from './import-parser.js';
import * as imports from './imports.service.js';

export const importsRouter = Router();
const tags = ['Bulk import'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
});
/** Single "file" field; multer's own errors become API errors. */
const fileUpload: RequestHandler = (req, res, next) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError(422, ErrorCode.FILE_TOO_LARGE, 'Import files must be at most 5 MB'));
    }
    if (err)
      return next(
        new ValidationError({
          fields: [{ path: 'body.file', message: 'Upload one file in the "file" field' }],
        }),
      );
    if (!req.file)
      return next(
        new ValidationError({
          fields: [{ path: 'body.file', message: 'Choose a file to upload' }],
        }),
      );
    next();
  });

const jobDto = z
  .object({
    id: z.uuid(),
    kind: z.enum(['STUDENTS', 'FACULTY']),
    status: z.string(),
    fileName: z.string(),
    sendInvites: z.boolean(),
    totalRows: z.number(),
    validRows: z.number(),
    invalidRows: z.number(),
    createdRows: z.number(),
    failedRows: z.number(),
    createdBy: z.string(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    errorMessage: z.string().nullable(),
  })
  .meta({ id: 'ImportJob' });
const rowDto = z
  .object({
    rowNumber: z.number(),
    status: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    reference: z.string().nullable(),
    errors: z.array(z.object({ field: z.string(), message: z.string() })),
    userId: z.uuid().nullable(),
  })
  .meta({ id: 'ImportRow' });
const kindParam = z.object({ kind: z.enum(['students', 'faculty']) });
const toKind = (k: 'students' | 'faculty'): 'STUDENTS' | 'FACULTY' =>
  k === 'students' ? 'STUDENTS' : 'FACULTY';

defineRoute(
  importsRouter,
  {
    method: 'get',
    path: '/imports/templates/:kind',
    summary: 'Download a CSV template',
    tags,
    access: { authenticated: true },
    request: { params: kindParam },
    responses: { 200: { description: 'CSV file' } },
  },
  (req, res) => {
    const students = req.valid.params.kind === 'students';
    const csv = students
      ? templateCsv(STUDENT_IMPORT_COLUMNS, {
          email: 'asha.rao@example.edu',
          first_name: 'Asha',
          last_name: 'Rao',
          program_code: 'BTECH-CS',
          specialization_code: 'AIML',
          year_of_study: '1',
          admission_session_code: 'FALL-2026',
          phone: '+91 98450 00000',
        })
      : templateCsv(FACULTY_IMPORT_COLUMNS, {
          email: 'k.iyer@example.edu',
          first_name: 'Kavya',
          last_name: 'Iyer',
          department_code: 'CS',
          designation: 'Assistant Professor',
          office_location: 'ENG Block, 214',
          max_load_credits: '12',
        });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${req.valid.params.kind}-import-template.csv"`,
    );
    res.send(csv);
  },
);

defineRoute(
  importsRouter,
  {
    method: 'post',
    path: '/imports/:kind/preview',
    summary: 'Upload a CSV/XLSX file and validate it (nothing is created yet)',
    description: 'multipart/form-data with a single "file" field, at most 5 MB and 5,000 rows.',
    tags,
    access: { authenticated: true },
    request: { params: kindParam },
    middleware: [fileUpload],
    responses: { 201: { description: 'Preview', schema: successEnvelope(jobDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await imports.previewImport(getActor(req), toKind(req.valid.params.kind), req.file!),
      'File validated',
    );
  },
);

defineRoute(
  importsRouter,
  {
    method: 'get',
    path: '/imports',
    summary: 'Your recent imports',
    tags,
    access: { authenticated: true },
    responses: { 200: { description: 'Imports', schema: successEnvelope(z.array(jobDto)) } },
  },
  async (req, res) => {
    sendOk(res, await imports.listImports(getActor(req)), 'Imports retrieved');
  },
);

defineRoute(
  importsRouter,
  {
    method: 'get',
    path: '/imports/:id',
    summary: 'Import status and counts',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Import', schema: successEnvelope(jobDto) } },
  },
  async (req, res) => {
    sendOk(res, await imports.getImport(getActor(req), req.valid.params.id), 'Import retrieved');
  },
);

defineRoute(
  importsRouter,
  {
    method: 'get',
    path: '/imports/:id/rows',
    summary: 'Per-row results (filter by status)',
    tags,
    access: { authenticated: true },
    request: {
      params: idParamSchema,
      query: paginationQuerySchema.extend({
        status: z.enum(['VALID', 'INVALID', 'CREATED', 'FAILED']).optional(),
      }),
    },
    responses: { 200: { description: 'Rows', schema: paginatedEnvelope(rowDto) } },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await imports.listImportRows(getActor(req), req.valid.params.id, q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Rows retrieved');
  },
);

defineRoute(
  importsRouter,
  {
    method: 'post',
    path: '/imports/:id/commit',
    summary: 'Create accounts for the valid rows (runs in the background)',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema, body: importCommitSchema },
    responses: { 200: { description: 'Queued', schema: successEnvelope(jobDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await imports.commitImport(getActor(req), req.valid.params.id, req.valid.body.sendInvites),
      'Import started',
    );
  },
);

defineRoute(
  importsRouter,
  {
    method: 'post',
    path: '/imports/:id/cancel',
    summary: 'Discard a preview',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Cancelled', schema: successEnvelope(jobDto) } },
  },
  async (req, res) => {
    sendOk(res, await imports.cancelImport(getActor(req), req.valid.params.id), 'Import cancelled');
  },
);
