import { Router } from 'express';
import { z } from 'zod';
import { COURSE_CATEGORIES, idParamSchema, paginationQuerySchema } from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import * as service from './student.service.js';

export const studentRouter = Router();
const tags = ['Student portal'];
const loose = (id: string) => z.record(z.string(), z.unknown()).meta({ id });
const sessionQuery = z.object({ sessionId: z.uuid() });

defineRoute(
  studentRouter,
  {
    method: 'get',
    path: '/catalog/sessions',
    summary: 'Sessions with published sections, with their registration window state',
    tags,
    access: { authenticated: true },
    responses: {
      200: { description: 'Sessions', schema: successEnvelope(z.array(loose('CatalogSession'))) },
    },
  },
  async (_req, res) => {
    sendOk(res, await service.catalogSessions(), 'Sessions retrieved');
  },
);

defineRoute(
  studentRouter,
  {
    method: 'get',
    path: '/catalog',
    summary: 'Course catalog for a session (active courses with published sections)',
    tags,
    access: { permission: 'registration:self' },
    request: {
      query: paginationQuerySchema.extend({
        sessionId: z.uuid(),
        q: z.string().trim().max(100).optional(),
        departmentId: z.uuid().optional(),
        category: z.enum(COURSE_CATEGORIES).optional(),
        level: z.coerce.number().int().min(100).max(900).optional(),
        minCredits: z.coerce.number().min(0).max(40).optional(),
        maxCredits: z.coerce.number().min(0).max(40).optional(),
        programId: z.uuid().optional(),
        specializationId: z.uuid().optional(),
        facultyMemberId: z.uuid().optional(),
        availability: z.enum(['open', 'waitlist']).optional(),
        mine: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
    },
    responses: {
      200: { description: 'Courses', schema: paginatedEnvelope(loose('CatalogCourse')) },
    },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await service.catalog(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Catalog retrieved');
  },
);

defineRoute(
  studentRouter,
  {
    method: 'get',
    path: '/catalog/courses/:id',
    summary: 'Course detail with your prerequisite status and the session’s sections',
    tags,
    access: { permission: 'registration:self' },
    request: { params: idParamSchema, query: sessionQuery },
    responses: {
      200: { description: 'Course', schema: successEnvelope(loose('CatalogCourseDetail')) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.catalogCourse(getActor(req), req.valid.params.id, req.valid.query.sessionId),
      'Course retrieved',
    );
  },
);

defineRoute(
  studentRouter,
  {
    method: 'get',
    path: '/students/me/dashboard',
    summary: 'Student dashboard',
    tags,
    access: { permission: 'registration:self' },
    responses: {
      200: { description: 'Dashboard', schema: successEnvelope(loose('StudentDashboard')) },
    },
  },
  async (req, res) => {
    sendOk(res, await service.dashboard(getActor(req)), 'Dashboard retrieved');
  },
);

defineRoute(
  studentRouter,
  {
    method: 'get',
    path: '/students/me/timetable',
    summary: 'Your weekly timetable for a session',
    tags,
    access: { permission: 'registration:self' },
    request: { query: sessionQuery },
    responses: {
      200: { description: 'Timetable', schema: successEnvelope(loose('StudentTimetable')) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.timetable(getActor(req), req.valid.query.sessionId),
      'Timetable retrieved',
    );
  },
);

defineRoute(
  studentRouter,
  {
    method: 'get',
    path: '/students/me/timetable.ics',
    summary: 'Your timetable as an iCalendar file',
    tags,
    access: { permission: 'registration:self' },
    request: { query: sessionQuery },
    responses: { 200: { description: 'iCalendar file' } },
  },
  async (req, res) => {
    const { fileName, ics } = await service.timetableIcs(getActor(req), req.valid.query.sessionId);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(ics);
  },
);

defineRoute(
  studentRouter,
  {
    method: 'get',
    path: '/students/me/progress',
    summary: 'Degree progress against your program’s requirements',
    tags,
    access: { permission: 'registration:self' },
    responses: {
      200: { description: 'Progress', schema: successEnvelope(loose('StudentProgress')) },
    },
  },
  async (req, res) => {
    sendOk(res, await service.progress(getActor(req)), 'Progress retrieved');
  },
);

defineRoute(
  studentRouter,
  {
    method: 'get',
    path: '/students/me/history',
    summary: 'Academic history by session with GPA',
    tags,
    access: { permission: 'registration:self' },
    responses: {
      200: { description: 'History', schema: successEnvelope(loose('StudentHistory')) },
    },
  },
  async (req, res) => {
    sendOk(res, await service.history(getActor(req)), 'History retrieved');
  },
);

defineRoute(
  studentRouter,
  {
    method: 'get',
    path: '/students/me/announcements',
    summary: 'Announcements to your current sections',
    tags,
    access: { permission: 'registration:self' },
    responses: {
      200: {
        description: 'Announcements',
        schema: successEnvelope(z.array(loose('StudentAnnouncement'))),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await service.announcementFeed(getActor(req), 100), 'Announcements retrieved');
  },
);
