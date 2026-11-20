import { Router } from 'express';
import { z } from 'zod';
import {
  EMPLOYMENT_STATUSES,
  FACULTY_DESIGNATIONS,
  facultyCreateSchema,
  facultySelfUpdateSchema,
  facultyUpdateSchema,
  idParamSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { listQuery } from '../../common/http/list-query.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import { facultyDetailDto, facultyDirectoryDto, facultyListItemDto } from '../people-dtos.js';
import * as faculty from './faculty.service.js';

export const facultyRouter = Router();
const tags = ['Faculty'];
const detail = {
  200: { description: 'Faculty member', schema: successEnvelope(facultyDetailDto) },
};
const query = listQuery(['lastName', 'employeeNumber', 'createdAt'], 'lastName:asc').extend({
  departmentId: z.uuid().optional(),
  schoolId: z.uuid().optional(),
  designation: z.enum(FACULTY_DESIGNATIONS).optional(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
});

defineRoute(
  facultyRouter,
  {
    method: 'get',
    path: '/faculty/me',
    summary: 'Your faculty profile',
    tags,
    access: { authenticated: true },
    responses: detail,
  },
  async (req, res) => {
    sendOk(res, await faculty.getOwnFaculty(getActor(req)), 'Faculty profile retrieved');
  },
);

defineRoute(
  facultyRouter,
  {
    method: 'patch',
    path: '/faculty/me',
    summary: 'Update your office, contact and research details',
    tags,
    access: { authenticated: true },
    request: { body: facultySelfUpdateSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(res, await faculty.updateOwnFaculty(getActor(req), req.valid.body), 'Profile updated');
  },
);

defineRoute(
  facultyRouter,
  {
    method: 'get',
    path: '/faculty/directory',
    summary: 'Faculty directory (public fields, any signed-in user)',
    tags,
    access: { authenticated: true },
    request: { query },
    responses: {
      200: { description: 'Directory', schema: paginatedEnvelope(facultyDirectoryDto) },
    },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await faculty.facultyDirectory(q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Directory retrieved');
  },
);

defineRoute(
  facultyRouter,
  {
    method: 'get',
    path: '/faculty',
    summary: 'List faculty in your scope (administrative fields)',
    tags,
    access: { permission: 'faculty:read' },
    request: { query },
    responses: { 200: { description: 'Faculty', schema: paginatedEnvelope(facultyListItemDto) } },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await faculty.listFaculty(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Faculty retrieved');
  },
);

defineRoute(
  facultyRouter,
  {
    method: 'get',
    path: '/faculty/:id',
    summary: 'Get a faculty member',
    description: 'Outside your scope only directory fields are returned (restricted: true).',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await faculty.getFaculty(getActor(req), req.valid.params.id),
      'Faculty member retrieved',
    );
  },
);

defineRoute(
  facultyRouter,
  {
    method: 'post',
    path: '/faculty',
    summary: 'Create a faculty member and (optionally) email an invitation',
    tags,
    access: { permission: 'faculty:create' },
    request: { body: facultyCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(facultyDetailDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await faculty.createFaculty(getActor(req), req.valid.body),
      'Faculty member created',
    );
  },
);

defineRoute(
  facultyRouter,
  {
    method: 'patch',
    path: '/faculty/:id',
    summary: 'Update a faculty member',
    tags,
    access: { permission: 'faculty:update' },
    request: { params: idParamSchema, body: facultyUpdateSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await faculty.updateFaculty(getActor(req), req.valid.params.id, req.valid.body),
      'Faculty member updated',
    );
  },
);
