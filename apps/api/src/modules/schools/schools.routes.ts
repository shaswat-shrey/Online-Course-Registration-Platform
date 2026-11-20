import { Router } from 'express';
import { idParamSchema, schoolCreateSchema, schoolUpdateSchema } from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { listQuery, statusFilter } from '../../common/http/list-query.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import { schoolDto } from '../structure-dtos.js';
import {
  createSchool,
  deleteSchool,
  getSchool,
  listSchools,
  updateSchool,
} from './schools.service.js';

export const schoolsRouter = Router();
const tags = ['Faculties / Schools'];

defineRoute(
  schoolsRouter,
  {
    method: 'get',
    path: '/schools',
    summary: 'List faculties/schools',
    tags,
    access: { authenticated: true },
    request: {
      query: listQuery(['name', 'code', 'createdAt'], 'name:asc').extend({ status: statusFilter }),
    },
    responses: { 200: { description: 'Schools', schema: paginatedEnvelope(schoolDto) } },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await listSchools(q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Faculties retrieved');
  },
);

defineRoute(
  schoolsRouter,
  {
    method: 'get',
    path: '/schools/:id',
    summary: 'Get a faculty/school with counts',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'School', schema: successEnvelope(schoolDto) } },
  },
  async (req, res) => {
    sendOk(res, await getSchool(req.valid.params.id), 'Faculty retrieved');
  },
);

defineRoute(
  schoolsRouter,
  {
    method: 'post',
    path: '/schools',
    summary: 'Create a faculty/school',
    tags,
    access: { permission: 'school:manage' },
    request: { body: schoolCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(schoolDto) } },
  },
  async (req, res) => {
    sendCreated(res, await createSchool(getActor(req), req.valid.body), 'Faculty created');
  },
);

defineRoute(
  schoolsRouter,
  {
    method: 'patch',
    path: '/schools/:id',
    summary: 'Update or (de)activate a faculty/school',
    tags,
    access: { permission: 'school:manage' },
    request: { params: idParamSchema, body: schoolUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(schoolDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await updateSchool(getActor(req), req.valid.params.id, req.valid.body),
      'Faculty updated',
    );
  },
);

defineRoute(
  schoolsRouter,
  {
    method: 'delete',
    path: '/schools/:id',
    summary: 'Delete a faculty/school that has no departments',
    tags,
    access: { permission: 'school:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await deleteSchool(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Faculty deleted');
  },
);
