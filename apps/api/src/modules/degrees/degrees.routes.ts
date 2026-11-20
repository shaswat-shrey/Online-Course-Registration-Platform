import { Router } from 'express';
import { z } from 'zod';
import {
  DEGREE_LEVELS,
  degreeCreateSchema,
  degreeUpdateSchema,
  idParamSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { statusFilter } from '../../common/http/list-query.js';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { successEnvelope } from '../../openapi/registry.js';
import { degreeDto } from '../structure-dtos.js';
import { createDegree, deleteDegree, listDegrees, updateDegree } from './degrees.service.js';

export const degreesRouter = Router();
const tags = ['Degrees'];

defineRoute(
  degreesRouter,
  {
    method: 'get',
    path: '/degrees',
    summary: 'List degrees (credential types)',
    tags,
    access: { authenticated: true },
    request: { query: z.object({ level: z.enum(DEGREE_LEVELS).optional(), status: statusFilter }) },
    responses: { 200: { description: 'Degrees', schema: successEnvelope(z.array(degreeDto)) } },
  },
  async (req, res) => {
    sendOk(res, await listDegrees(req.valid.query), 'Degrees retrieved');
  },
);

defineRoute(
  degreesRouter,
  {
    method: 'post',
    path: '/degrees',
    summary: 'Create a degree',
    tags,
    access: { permission: 'degree:manage' },
    request: { body: degreeCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(degreeDto) } },
  },
  async (req, res) => {
    sendCreated(res, await createDegree(getActor(req), req.valid.body), 'Degree created');
  },
);

defineRoute(
  degreesRouter,
  {
    method: 'patch',
    path: '/degrees/:id',
    summary: 'Update or (de)activate a degree',
    tags,
    access: { permission: 'degree:manage' },
    request: { params: idParamSchema, body: degreeUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(degreeDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await updateDegree(getActor(req), req.valid.params.id, req.valid.body),
      'Degree updated',
    );
  },
);

defineRoute(
  degreesRouter,
  {
    method: 'delete',
    path: '/degrees/:id',
    summary: 'Delete a degree no program uses',
    tags,
    access: { permission: 'degree:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await deleteDegree(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Degree deleted');
  },
);
