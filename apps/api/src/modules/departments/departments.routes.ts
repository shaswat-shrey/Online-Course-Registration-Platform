import { Router } from 'express';
import { z } from 'zod';
import { departmentCreateSchema, departmentUpdateSchema, idParamSchema } from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { listQuery, statusFilter } from '../../common/http/list-query.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import { departmentDto } from '../structure-dtos.js';
import {
  createDepartment,
  deleteDepartment,
  getDepartment,
  listDepartments,
  updateDepartment,
} from './departments.service.js';

export const departmentsRouter = Router();
const tags = ['Departments'];

defineRoute(
  departmentsRouter,
  {
    method: 'get',
    path: '/departments',
    summary: 'List departments',
    tags,
    access: { authenticated: true },
    request: {
      query: listQuery(['name', 'code', 'createdAt'], 'name:asc').extend({
        status: statusFilter,
        schoolId: z.uuid().optional(),
      }),
    },
    responses: { 200: { description: 'Departments', schema: paginatedEnvelope(departmentDto) } },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await listDepartments(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Departments retrieved');
  },
);

defineRoute(
  departmentsRouter,
  {
    method: 'get',
    path: '/departments/:id',
    summary: 'Get a department with counts',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Department', schema: successEnvelope(departmentDto) } },
  },
  async (req, res) => {
    sendOk(res, await getDepartment(getActor(req), req.valid.params.id), 'Department retrieved');
  },
);

defineRoute(
  departmentsRouter,
  {
    method: 'post',
    path: '/departments',
    summary: 'Create a department',
    description:
      'Requires department:manage covering the parent faculty/school (school-wide or university-wide).',
    tags,
    access: { permission: 'department:manage' },
    request: { body: departmentCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(departmentDto) } },
  },
  async (req, res) => {
    sendCreated(res, await createDepartment(getActor(req), req.valid.body), 'Department created');
  },
);

defineRoute(
  departmentsRouter,
  {
    method: 'patch',
    path: '/departments/:id',
    summary: 'Update or (de)activate a department',
    tags,
    access: { permission: 'department:manage' },
    request: { params: idParamSchema, body: departmentUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(departmentDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await updateDepartment(getActor(req), req.valid.params.id, req.valid.body),
      'Department updated',
    );
  },
);

defineRoute(
  departmentsRouter,
  {
    method: 'delete',
    path: '/departments/:id',
    summary: 'Delete a department that has no programs',
    tags,
    access: { permission: 'department:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await deleteDepartment(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Department deleted');
  },
);
