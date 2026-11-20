import { Router } from 'express';
import { z } from 'zod';
import { gradingScaleSchema, idParamSchema } from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { successEnvelope } from '../../openapi/registry.js';
import {
  createScale,
  deleteScale,
  getScale,
  listScales,
  replaceScale,
} from './grading-scales.service.js';

export const gradingScalesRouter = Router();
const tags = ['Grading scales'];

const scaleDto = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.string(),
    sessionCount: z.number(),
    hasGradePoints: z.boolean(),
    entries: z.array(
      z.object({
        letter: z.string(),
        minPercent: z.number(),
        gradePoints: z.number().nullable(),
        isPassing: z.boolean(),
        countsInGpa: z.boolean(),
      }),
    ),
    updatedAt: z.string(),
  })
  .meta({ id: 'GradingScale' });

defineRoute(
  gradingScalesRouter,
  {
    method: 'get',
    path: '/grading-scales',
    summary: 'List grading scales',
    tags,
    access: { authenticated: true },
    responses: { 200: { description: 'Scales', schema: successEnvelope(z.array(scaleDto)) } },
  },
  async (_req, res) => {
    sendOk(res, await listScales(), 'Grading scales retrieved');
  },
);
defineRoute(
  gradingScalesRouter,
  {
    method: 'get',
    path: '/grading-scales/:id',
    summary: 'Get a grading scale',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Scale', schema: successEnvelope(scaleDto) } },
  },
  async (req, res) => {
    sendOk(res, await getScale(req.valid.params.id), 'Grading scale retrieved');
  },
);
defineRoute(
  gradingScalesRouter,
  {
    method: 'post',
    path: '/grading-scales',
    summary: 'Create a grading scale',
    tags,
    access: { permission: 'grading_scale:manage' },
    request: { body: gradingScaleSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(scaleDto) } },
  },
  async (req, res) => {
    sendCreated(res, await createScale(getActor(req), req.valid.body), 'Grading scale created');
  },
);
defineRoute(
  gradingScalesRouter,
  {
    method: 'put',
    path: '/grading-scales/:id',
    summary: 'Replace a grading scale',
    description: 'Grade bands cannot change once a completed or archived session uses the scale.',
    tags,
    access: { permission: 'grading_scale:manage' },
    request: { params: idParamSchema, body: gradingScaleSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(scaleDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await replaceScale(getActor(req), req.valid.params.id, req.valid.body),
      'Grading scale updated',
    );
  },
);
defineRoute(
  gradingScalesRouter,
  {
    method: 'delete',
    path: '/grading-scales/:id',
    summary: 'Delete an unused grading scale',
    tags,
    access: { permission: 'grading_scale:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await deleteScale(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Grading scale deleted');
  },
);
