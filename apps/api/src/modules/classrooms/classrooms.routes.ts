import { Router } from 'express';
import { z } from 'zod';
import {
  CLASSROOM_TYPES,
  classroomCreateSchema,
  classroomUpdateSchema,
  idParamSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { listQuery, statusFilter } from '../../common/http/list-query.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import { classroomDto, classroomScheduleDto } from '../course-dtos.js';
import * as service from './classrooms.service.js';

export const classroomsRouter = Router();
const tags = ['Classrooms'];

defineRoute(
  classroomsRouter,
  {
    method: 'get',
    path: '/classrooms',
    summary: 'List classrooms',
    tags,
    access: { authenticated: true },
    request: {
      query: listQuery(['building', 'capacity', 'createdAt'], 'building:asc').extend({
        status: statusFilter,
        campusId: z.uuid().optional(),
        type: z.enum(CLASSROOM_TYPES).optional(),
        minCapacity: z.coerce.number().int().min(1).optional(),
      }),
    },
    responses: { 200: { description: 'Classrooms', schema: paginatedEnvelope(classroomDto) } },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await service.listClassrooms(q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Classrooms retrieved');
  },
);

defineRoute(
  classroomsRouter,
  {
    method: 'get',
    path: '/classrooms/:id',
    summary: 'Get a classroom',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Classroom', schema: successEnvelope(classroomDto) } },
  },
  async (req, res) => {
    sendOk(res, await service.getClassroom(req.valid.params.id), 'Classroom retrieved');
  },
);

defineRoute(
  classroomsRouter,
  {
    method: 'get',
    path: '/classrooms/:id/schedule',
    summary: 'Weekly occupancy of a classroom in a session',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema, query: z.object({ sessionId: z.uuid() }) },
    responses: { 200: { description: 'Schedule', schema: successEnvelope(classroomScheduleDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.classroomSchedule(req.valid.params.id, req.valid.query.sessionId),
      'Schedule retrieved',
    );
  },
);

defineRoute(
  classroomsRouter,
  {
    method: 'post',
    path: '/classrooms',
    summary: 'Create a classroom',
    tags,
    access: { permission: 'classroom:manage' },
    request: { body: classroomCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(classroomDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await service.createClassroom(getActor(req), req.valid.body),
      'Classroom created',
    );
  },
);

defineRoute(
  classroomsRouter,
  {
    method: 'patch',
    path: '/classrooms/:id',
    summary: 'Update a classroom',
    tags,
    access: { permission: 'classroom:manage' },
    request: { params: idParamSchema, body: classroomUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(classroomDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.updateClassroom(getActor(req), req.valid.params.id, req.valid.body),
      'Classroom updated',
    );
  },
);

defineRoute(
  classroomsRouter,
  {
    method: 'delete',
    path: '/classrooms/:id',
    summary: 'Delete an unused classroom',
    tags,
    access: { permission: 'classroom:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await service.deleteClassroom(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Classroom deleted');
  },
);
