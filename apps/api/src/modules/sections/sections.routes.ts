import { Router } from 'express';
import { z } from 'zod';
import {
  idParamSchema,
  restrictionsSchema,
  rollForwardSchema,
  SECTION_STATUSES,
  sectionCreateSchema,
  sectionInstructorsSchema,
  sectionMeetingsSchema,
  sectionTransitionSchema,
  sectionUpdateSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { listQuery } from '../../common/http/list-query.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import {
  facultyScheduleDto,
  rollForwardResultDto,
  sectionDetailDto,
  sectionDto,
  sectionScheduleResultDto,
} from '../course-dtos.js';
import * as service from './sections.service.js';

export const sectionsRouter = Router();
const tags = ['Course sections'];
const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();
const one = { 200: { description: 'Section', schema: successEnvelope(sectionDto) } };
const scheduled = {
  200: { description: 'Section', schema: successEnvelope(sectionScheduleResultDto) },
};

defineRoute(
  sectionsRouter,
  {
    method: 'get',
    path: '/course-sections',
    summary: 'List course sections',
    description:
      'Users without section management rights see published sections and the ones they teach.',
    tags,
    access: { authenticated: true },
    request: {
      query: listQuery(
        ['courseCode', 'sectionCode', 'capacity', 'createdAt'],
        'courseCode:asc',
      ).extend({
        sessionId: z.uuid().optional(),
        courseId: z.uuid().optional(),
        departmentId: z.uuid().optional(),
        schoolId: z.uuid().optional(),
        status: z.enum(SECTION_STATUSES).optional(),
        facultyMemberId: z.uuid().optional(),
        hasSeats: bool,
        unassigned: bool,
      }),
    },
    responses: { 200: { description: 'Sections', schema: paginatedEnvelope(sectionDto) } },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await service.listSections(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Sections retrieved');
  },
);

defineRoute(
  sectionsRouter,
  {
    method: 'get',
    path: '/course-sections/:id',
    summary: 'Get a section with meetings, instructors and restrictions',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Section', schema: successEnvelope(sectionDetailDto) } },
  },
  async (req, res) => {
    sendOk(res, await service.getSection(getActor(req), req.valid.params.id), 'Section retrieved');
  },
);

defineRoute(
  sectionsRouter,
  {
    method: 'post',
    path: '/course-sections',
    summary: 'Create a draft section',
    tags,
    access: { permission: 'section:create' },
    request: { body: sectionCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(sectionDto) } },
  },
  async (req, res) => {
    sendCreated(res, await service.createSection(getActor(req), req.valid.body), 'Section created');
  },
);

defineRoute(
  sectionsRouter,
  {
    method: 'patch',
    path: '/course-sections/:id',
    summary: 'Update a section (capacity cannot drop below enrollment)',
    tags,
    access: { permission: 'section:update' },
    request: { params: idParamSchema, body: sectionUpdateSchema },
    responses: one,
  },
  async (req, res) => {
    sendOk(
      res,
      await service.updateSection(getActor(req), req.valid.params.id, req.valid.body),
      'Section updated',
    );
  },
);

defineRoute(
  sectionsRouter,
  {
    method: 'delete',
    path: '/course-sections/:id',
    summary: 'Delete a draft section',
    tags,
    access: { permission: 'section:create' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await service.deleteSection(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Section deleted');
  },
);

defineRoute(
  sectionsRouter,
  {
    method: 'put',
    path: '/course-sections/:id/meetings',
    summary: 'Replace weekly meetings (classroom/instructor conflicts need an override reason)',
    tags,
    access: { permission: 'section:update' },
    request: { params: idParamSchema, body: sectionMeetingsSchema },
    responses: scheduled,
  },
  async (req, res) => {
    sendOk(
      res,
      await service.setMeetings(getActor(req), req.valid.params.id, req.valid.body),
      'Meetings saved',
    );
  },
);

defineRoute(
  sectionsRouter,
  {
    method: 'put',
    path: '/course-sections/:id/instructors',
    summary:
      'Replace instructors (conflicts need an override reason; load limits produce warnings)',
    tags,
    access: { permission: 'section:assign_faculty' },
    request: { params: idParamSchema, body: sectionInstructorsSchema },
    responses: scheduled,
  },
  async (req, res) => {
    sendOk(
      res,
      await service.setInstructors(getActor(req), req.valid.params.id, req.valid.body),
      'Instructors saved',
    );
  },
);

defineRoute(
  sectionsRouter,
  {
    method: 'put',
    path: '/course-sections/:id/restrictions',
    summary: 'Replace section-level registration restrictions',
    tags,
    access: { permission: 'section:update' },
    request: { params: idParamSchema, body: restrictionsSchema },
    responses: { 200: { description: 'Section', schema: successEnvelope(sectionDetailDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.setSectionRestrictions(
        getActor(req),
        req.valid.params.id,
        req.valid.body.restrictions,
      ),
      'Restrictions saved',
    );
  },
);

defineRoute(
  sectionsRouter,
  {
    method: 'post',
    path: '/course-sections/:id/transition',
    summary: 'Publish, close, reopen, cancel or complete a section',
    tags,
    // section:publish or section:cancel depending on the action (checked in the service).
    access: { authenticated: true },
    request: { params: idParamSchema, body: sectionTransitionSchema },
    responses: one,
  },
  async (req, res) => {
    sendOk(
      res,
      await service.transitionSection(getActor(req), req.valid.params.id, req.valid.body),
      'Section updated',
    );
  },
);

defineRoute(
  sectionsRouter,
  {
    method: 'post',
    path: '/course-sections/roll-forward',
    summary: 'Copy sections from another session as drafts',
    tags,
    access: { permission: 'section:create' },
    request: { body: rollForwardSchema },
    responses: { 200: { description: 'Result', schema: successEnvelope(rollForwardResultDto) } },
  },
  async (req, res) => {
    const result = await service.rollForward(getActor(req), req.valid.body);
    sendOk(res, result, `${result.created.length} section(s) copied`);
  },
);

defineRoute(
  sectionsRouter,
  {
    method: 'get',
    path: '/faculty/:id/schedule',
    summary: 'Teaching schedule and load of a faculty member in a session',
    tags: ['Faculty'],
    // Self, faculty:read in scope, or section managers (checked in the service).
    access: { authenticated: true },
    request: { params: idParamSchema, query: z.object({ sessionId: z.uuid() }) },
    responses: { 200: { description: 'Schedule', schema: successEnvelope(facultyScheduleDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.facultySchedule(getActor(req), req.valid.params.id, req.valid.query.sessionId),
      'Schedule retrieved',
    );
  },
);
