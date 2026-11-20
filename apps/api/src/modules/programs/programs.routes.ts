import { Router } from 'express';
import { z } from 'zod';
import {
  DEGREE_LEVELS,
  idParamSchema,
  programCreateSchema,
  programUpdateSchema,
  requirementGroupCreateSchema,
  requirementGroupUpdateSchema,
  specializationCreateSchema,
  specializationUpdateSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { listQuery, statusFilter } from '../../common/http/list-query.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import { programDto, requirementGroupDto, specializationDto } from '../structure-dtos.js';
import * as service from './programs.service.js';

export const programsRouter = Router();
const tags = ['Programs & specializations'];

defineRoute(
  programsRouter,
  {
    method: 'get',
    path: '/programs',
    summary: 'List degree programs',
    tags,
    access: { authenticated: true },
    request: {
      query: listQuery(['name', 'code', 'createdAt'], 'name:asc').extend({
        status: statusFilter,
        departmentId: z.uuid().optional(),
        schoolId: z.uuid().optional(),
        degreeId: z.uuid().optional(),
        level: z.enum(DEGREE_LEVELS).optional(),
      }),
    },
    responses: { 200: { description: 'Programs', schema: paginatedEnvelope(programDto) } },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await service.listPrograms(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Programs retrieved');
  },
);

defineRoute(
  programsRouter,
  {
    method: 'get',
    path: '/programs/:id',
    summary: 'Get a program with specializations and requirement groups',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Program', schema: successEnvelope(programDto) } },
  },
  async (req, res) => {
    sendOk(res, await service.getProgram(getActor(req), req.valid.params.id), 'Program retrieved');
  },
);

defineRoute(
  programsRouter,
  {
    method: 'post',
    path: '/programs',
    summary: 'Create a program',
    tags,
    access: { permission: 'program:manage' },
    request: { body: programCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(programDto) } },
  },
  async (req, res) => {
    sendCreated(res, await service.createProgram(getActor(req), req.valid.body), 'Program created');
  },
);

defineRoute(
  programsRouter,
  {
    method: 'patch',
    path: '/programs/:id',
    summary: 'Update or (de)activate a program',
    tags,
    access: { permission: 'program:manage' },
    request: { params: idParamSchema, body: programUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(programDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.updateProgram(getActor(req), req.valid.params.id, req.valid.body),
      'Program updated',
    );
  },
);

defineRoute(
  programsRouter,
  {
    method: 'delete',
    path: '/programs/:id',
    summary: 'Delete an unused program',
    tags,
    access: { permission: 'program:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await service.deleteProgram(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Program deleted');
  },
);

defineRoute(
  programsRouter,
  {
    method: 'get',
    path: '/programs/:id/specializations',
    summary: "A program's specializations",
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Specializations', schema: successEnvelope(z.array(specializationDto)) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.listSpecializations(req.valid.params.id),
      'Specializations retrieved',
    );
  },
);

defineRoute(
  programsRouter,
  {
    method: 'post',
    path: '/specializations',
    summary: 'Create a specialization in a program',
    tags,
    access: { permission: 'specialization:manage' },
    request: { body: specializationCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(specializationDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await service.createSpecialization(getActor(req), req.valid.body),
      'Specialization created',
    );
  },
);

defineRoute(
  programsRouter,
  {
    method: 'patch',
    path: '/specializations/:id',
    summary: 'Update or (de)activate a specialization',
    tags,
    access: { permission: 'specialization:manage' },
    request: { params: idParamSchema, body: specializationUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(specializationDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.updateSpecialization(getActor(req), req.valid.params.id, req.valid.body),
      'Specialization updated',
    );
  },
);

defineRoute(
  programsRouter,
  {
    method: 'delete',
    path: '/specializations/:id',
    summary: 'Delete a specialization',
    tags,
    access: { permission: 'specialization:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await service.deleteSpecialization(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Specialization deleted');
  },
);

defineRoute(
  programsRouter,
  {
    method: 'post',
    path: '/programs/:id/requirement-groups',
    summary: 'Add a requirement group to a program',
    description: 'The sum of program-level minimum credits cannot exceed the program total.',
    tags,
    access: { permission: 'program:manage' },
    request: { params: idParamSchema, body: requirementGroupCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(requirementGroupDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await service.createRequirementGroup(
        getActor(req),
        { programId: req.valid.params.id },
        req.valid.body,
      ),
      'Requirement group created',
    );
  },
);

defineRoute(
  programsRouter,
  {
    method: 'post',
    path: '/specializations/:id/requirement-groups',
    summary: 'Add a requirement group to a specialization',
    tags,
    access: { permission: 'specialization:manage' },
    request: { params: idParamSchema, body: requirementGroupCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(requirementGroupDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await service.createRequirementGroup(
        getActor(req),
        { specializationId: req.valid.params.id },
        req.valid.body,
      ),
      'Requirement group created',
    );
  },
);

defineRoute(
  programsRouter,
  {
    method: 'put',
    path: '/requirement-groups/:id',
    summary: 'Replace a requirement group',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema, body: requirementGroupUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(requirementGroupDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.updateRequirementGroup(getActor(req), req.valid.params.id, req.valid.body),
      'Requirement group updated',
    );
  },
);

defineRoute(
  programsRouter,
  {
    method: 'delete',
    path: '/requirement-groups/:id',
    summary: 'Delete a requirement group',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await service.deleteRequirementGroup(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Requirement group deleted');
  },
);
