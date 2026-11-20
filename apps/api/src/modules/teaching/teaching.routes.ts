import { Router } from 'express';
import { z } from 'zod';
import {
  idParamSchema,
  materialCreateSchema,
  materialUpdateSchema,
  paginationQuerySchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import { sectionDto } from '../course-dtos.js';
import * as materials from './materials.service.js';
import * as teaching from './teaching.service.js';

export const teachingRouter = Router();
const tags = ['Faculty workspace'];
const rosterStatus = z.enum(['REGISTERED', 'PENDING', 'WAITLISTED', 'COMPLETED']).optional();
const sectionStudentParams = z.object({ id: z.uuid(), studentId: z.uuid() });

const rosterItem = z
  .object({
    registrationId: z.uuid(),
    status: z.string(),
    registeredAt: z.string(),
    student: z.object({
      id: z.uuid(),
      studentNumber: z.string(),
      name: z.string(),
      email: z.string(),
      program: z.object({ code: z.string(), name: z.string() }),
      specialization: z.string().nullable(),
      yearOfStudy: z.number(),
    }),
    attendancePercent: z.number().nullable(),
  })
  .meta({ id: 'RosterEntry' });
const materialDto = z
  .object({
    id: z.uuid(),
    sectionId: z.uuid(),
    folder: z.string().nullable(),
    title: z.string(),
    description: z.string().nullable(),
    kind: z.enum(['FILE', 'LINK']),
    url: z.string().nullable(),
    file: z.object({ name: z.string(), mimeType: z.string(), sizeBytes: z.number() }).nullable(),
    position: z.number(),
    published: z.boolean(),
    publishedAt: z.string().nullable(),
    createdBy: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'SectionMaterial' });
const teachingSection = sectionDto.extend({ myRole: z.string() });

defineRoute(
  teachingRouter,
  {
    method: 'get',
    path: '/faculty/me/dashboard',
    summary: 'Faculty dashboard: this session’s sections, today’s classes, load, announcements',
    tags,
    access: { authenticated: true },
    responses: {
      200: {
        description: 'Dashboard',
        schema: successEnvelope(
          z.object({
            session: z.unknown().nullable(),
            sections: z.array(teachingSection),
            totalStudents: z.number(),
            today: z.object({
              dayOfWeek: z.number(),
              nowMinute: z.number(),
              timeZone: z.string(),
              classes: z.array(z.record(z.string(), z.unknown())),
            }),
            load: z.object({ credits: z.number(), maxCredits: z.number().nullable() }),
            upcomingSections: z.number(),
            recentAnnouncements: z.array(z.record(z.string(), z.unknown())),
          }),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await teaching.dashboard(getActor(req)), 'Dashboard retrieved');
  },
);

defineRoute(
  teachingRouter,
  {
    method: 'get',
    path: '/faculty/me/sections',
    summary: 'Your teaching assignments (current, upcoming or past sessions)',
    tags,
    access: { authenticated: true },
    request: {
      query: z.object({ scope: z.enum(['current', 'upcoming', 'past']).default('current') }),
    },
    responses: {
      200: { description: 'Sections', schema: successEnvelope(z.array(teachingSection)) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await teaching.mySections(getActor(req), req.valid.query.scope),
      'Sections retrieved',
    );
  },
);

defineRoute(
  teachingRouter,
  {
    method: 'get',
    path: '/course-sections/:id/workspace',
    summary: 'Course workspace: course content, schedule and class statistics',
    description: 'Instructors of the section, or administrators with roster:read in scope.',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Workspace', schema: successEnvelope(z.record(z.string(), z.unknown())) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await teaching.workspace(getActor(req), req.valid.params.id),
      'Workspace retrieved',
    );
  },
);

defineRoute(
  teachingRouter,
  {
    method: 'get',
    path: '/course-sections/:id/roster',
    summary: 'Class roster (instructors of the section or administrators in scope)',
    tags,
    access: { permission: 'roster:read' },
    request: {
      params: idParamSchema,
      query: paginationQuerySchema.extend({
        q: z.string().trim().max(100).optional(),
        status: rosterStatus,
      }),
    },
    responses: { 200: { description: 'Roster', schema: paginatedEnvelope(rosterItem) } },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await teaching.roster(getActor(req), req.valid.params.id, q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Roster retrieved');
  },
);

defineRoute(
  teachingRouter,
  {
    method: 'get',
    path: '/course-sections/:id/roster/export',
    summary: 'Download the roster as CSV (roster:export)',
    tags,
    access: { permission: 'roster:export' },
    request: { params: idParamSchema, query: z.object({ status: rosterStatus }) },
    responses: { 200: { description: 'CSV file' } },
  },
  async (req, res) => {
    const { fileName, csv } = await teaching.rosterCsv(
      getActor(req),
      req.valid.params.id,
      req.valid.query,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  },
);

defineRoute(
  teachingRouter,
  {
    method: 'get',
    path: '/course-sections/:id/students/:studentId',
    summary: 'Academic profile of a student in the section (no contact or personal details)',
    tags,
    access: { permission: 'roster:read' },
    request: { params: sectionStudentParams },
    responses: {
      200: { description: 'Student', schema: successEnvelope(z.record(z.string(), z.unknown())) },
    },
  },
  async (req, res) => {
    const { id, studentId } = req.valid.params;
    sendOk(res, await teaching.studentInSection(getActor(req), id, studentId), 'Student retrieved');
  },
);

defineRoute(
  teachingRouter,
  {
    method: 'get',
    path: '/course-sections/:id/materials',
    summary: 'Course materials (students see published ones)',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Materials',
        schema: successEnvelope(z.object({ canManage: z.boolean(), items: z.array(materialDto) })),
      },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await materials.listMaterials(getActor(req), req.valid.params.id),
      'Materials retrieved',
    );
  },
);

defineRoute(
  teachingRouter,
  {
    method: 'post',
    path: '/course-sections/:id/materials',
    summary: 'Add a file or link to a section',
    tags,
    access: { permission: 'material:manage' },
    request: { params: idParamSchema, body: materialCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(materialDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await materials.createMaterial(getActor(req), req.valid.params.id, req.valid.body),
      'Material added',
    );
  },
);

defineRoute(
  teachingRouter,
  {
    method: 'patch',
    path: '/materials/:id',
    summary: 'Edit, reorder, publish or unpublish a material',
    tags,
    access: { permission: 'material:manage' },
    request: { params: idParamSchema, body: materialUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(materialDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await materials.updateMaterial(getActor(req), req.valid.params.id, req.valid.body),
      'Material updated',
    );
  },
);

defineRoute(
  teachingRouter,
  {
    method: 'delete',
    path: '/materials/:id',
    summary: 'Delete a material (and its file)',
    tags,
    access: { permission: 'material:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await materials.deleteMaterial(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Material deleted');
  },
);

defineRoute(
  teachingRouter,
  {
    method: 'get',
    path: '/materials/:id/download',
    summary: 'Short-lived download link (members of the section only)',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Link',
        schema: successEnvelope(
          z.object({ url: z.string(), expiresInSeconds: z.number().nullable() }),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await materials.materialLink(getActor(req), req.valid.params.id), 'Link created');
  },
);
