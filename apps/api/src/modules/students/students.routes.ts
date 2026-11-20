import { Router } from 'express';
import { z } from 'zod';
import {
  holdCreateSchema,
  holdReleaseSchema,
  idParamSchema,
  programChangeSchema,
  STUDENT_STATUSES,
  studentCreateSchema,
  studentSelfUpdateSchema,
  studentStatusSchema,
  studentUpdateSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { listQuery } from '../../common/http/list-query.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import { studentDetailDto, studentListItemDto } from '../people-dtos.js';
import * as students from './students.service.js';

export const studentsRouter = Router();
const tags = ['Students'];
const detail = { 200: { description: 'Student', schema: successEnvelope(studentDetailDto) } };

defineRoute(
  studentsRouter,
  {
    method: 'get',
    path: '/students/me',
    summary: 'Your student record',
    tags,
    access: { authenticated: true },
    responses: detail,
  },
  async (req, res) => {
    sendOk(res, await students.getOwnStudent(getActor(req)), 'Student profile retrieved');
  },
);

defineRoute(
  studentsRouter,
  {
    method: 'patch',
    path: '/students/me',
    summary: 'Update your phone number and contact details',
    description:
      'Students may change only their phone, personal email, address and emergency contact (FR-STUDENT-002).',
    tags,
    access: { authenticated: true },
    request: { body: studentSelfUpdateSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(res, await students.updateOwnStudent(getActor(req), req.valid.body), 'Profile updated');
  },
);

defineRoute(
  studentsRouter,
  {
    method: 'get',
    path: '/students',
    summary: 'List students in your scope',
    tags,
    access: { permission: 'student:read' },
    request: {
      query: listQuery(['studentNumber', 'lastName', 'createdAt'], 'lastName:asc').extend({
        programId: z.uuid().optional(),
        departmentId: z.uuid().optional(),
        schoolId: z.uuid().optional(),
        yearOfStudy: z.coerce.number().int().min(1).max(10).optional(),
        status: z.enum(STUDENT_STATUSES).optional(),
        hasHold: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
    },
    responses: { 200: { description: 'Students', schema: paginatedEnvelope(studentListItemDto) } },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await students.listStudents(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Students retrieved');
  },
);

defineRoute(
  studentsRouter,
  {
    method: 'get',
    path: '/students/:id',
    summary: 'Get a student record',
    description: 'Contact details and hold reasons are included only with student:read_sensitive.',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(res, await students.getStudent(getActor(req), req.valid.params.id), 'Student retrieved');
  },
);

defineRoute(
  studentsRouter,
  {
    method: 'post',
    path: '/students',
    summary: 'Create a student and (optionally) email an invitation',
    description: 'Leave studentNumber empty to generate one (YY + department code + sequence).',
    tags,
    access: { permission: 'student:create' },
    request: { body: studentCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(studentDetailDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await students.createStudent(getActor(req), req.valid.body),
      'Student created',
    );
  },
);

defineRoute(
  studentsRouter,
  {
    method: 'patch',
    path: '/students/:id',
    summary: 'Update a student record',
    tags,
    access: { permission: 'student:update' },
    request: { params: idParamSchema, body: studentUpdateSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await students.updateStudent(getActor(req), req.valid.params.id, req.valid.body),
      'Student updated',
    );
  },
);

defineRoute(
  studentsRouter,
  {
    method: 'post',
    path: '/students/:id/change-program',
    summary: "Change a student's program or specialization",
    description: 'Records program history; completed academic records are kept (BR-011).',
    tags,
    access: { permission: 'student:update' },
    request: { params: idParamSchema, body: programChangeSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await students.changeProgram(getActor(req), req.valid.params.id, req.valid.body),
      'Program changed',
    );
  },
);

defineRoute(
  studentsRouter,
  {
    method: 'post',
    path: '/students/:id/status',
    summary: 'Change academic status',
    description:
      'SUSPENDED also suspends the account and signs the student out; DISMISSED deactivates it.',
    tags,
    access: { permission: 'student:update' },
    request: { params: idParamSchema, body: studentStatusSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await students.setStudentStatus(getActor(req), req.valid.params.id, req.valid.body),
      'Status changed',
    );
  },
);

defineRoute(
  studentsRouter,
  {
    method: 'post',
    path: '/students/:id/holds',
    summary: 'Place a registration hold',
    tags: ['Students', 'Registration holds'],
    access: { permission: 'student:manage_holds' },
    request: { params: idParamSchema, body: holdCreateSchema },
    responses: { 201: { description: 'Placed', schema: successEnvelope(studentDetailDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await students.placeHold(getActor(req), req.valid.params.id, req.valid.body),
      'Hold placed',
    );
  },
);

defineRoute(
  studentsRouter,
  {
    method: 'post',
    path: '/students/:id/holds/:holdId/release',
    summary: 'Release a registration hold',
    tags: ['Students', 'Registration holds'],
    access: { permission: 'student:manage_holds' },
    request: { params: z.object({ id: z.uuid(), holdId: z.uuid() }), body: holdReleaseSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await students.releaseHold(
        getActor(req),
        req.valid.params.id,
        req.valid.params.holdId,
        req.valid.body,
      ),
      'Hold released',
    );
  },
);
