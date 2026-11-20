import { Router } from 'express';
import { z } from 'zod';
import {
  campusCreateSchema,
  campusUpdateSchema,
  idParamSchema,
  universityUpdateSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { successEnvelope } from '../../openapi/registry.js';
import { publicUniversitySchema } from './university.schemas.js';
import {
  createCampus,
  deleteCampus,
  getPublicUniversity,
  getUniversity,
  listCampuses,
  updateCampus,
  updateUniversity,
} from './university.service.js';

export const universityRouter = Router();
const tags = ['University'];

const universitySchema = publicUniversitySchema
  .extend({
    contactPhone: z.string().nullable(),
    address: z.string().nullable(),
    updatedAt: z.string(),
  })
  .meta({ id: 'University' });
const campusSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    status: z.string(),
    schoolCount: z.number(),
    departmentCount: z.number(),
  })
  .meta({ id: 'Campus' });

defineRoute(
  universityRouter,
  {
    method: 'get',
    path: '/university/public',
    summary: 'Public university profile (branding for the login page)',
    tags,
    access: { public: true },
    responses: {
      200: { description: 'University profile', schema: successEnvelope(publicUniversitySchema) },
    },
  },
  async (_req, res) => {
    sendOk(res, await getPublicUniversity(), 'University retrieved successfully');
  },
);

defineRoute(
  universityRouter,
  {
    method: 'get',
    path: '/university',
    summary: 'Full university profile',
    tags,
    access: { authenticated: true },
    responses: { 200: { description: 'University', schema: successEnvelope(universitySchema) } },
  },
  async (_req, res) => {
    sendOk(res, await getUniversity(), 'University retrieved successfully');
  },
);

defineRoute(
  universityRouter,
  {
    method: 'patch',
    path: '/university',
    summary: 'Update the university profile',
    tags,
    access: { permission: 'university:manage' },
    request: { body: universityUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(universitySchema) } },
  },
  async (req, res) => {
    sendOk(res, await updateUniversity(getActor(req), req.valid.body), 'University updated');
  },
);

defineRoute(
  universityRouter,
  {
    method: 'get',
    path: '/campuses',
    summary: 'List campuses',
    tags,
    access: { authenticated: true },
    responses: { 200: { description: 'Campuses', schema: successEnvelope(z.array(campusSchema)) } },
  },
  async (_req, res) => {
    sendOk(res, await listCampuses(), 'Campuses retrieved');
  },
);

defineRoute(
  universityRouter,
  {
    method: 'post',
    path: '/campuses',
    summary: 'Create a campus',
    tags,
    access: { permission: 'university:manage' },
    request: { body: campusCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(campusSchema) } },
  },
  async (req, res) => {
    sendCreated(res, await createCampus(getActor(req), req.valid.body), 'Campus created');
  },
);

defineRoute(
  universityRouter,
  {
    method: 'patch',
    path: '/campuses/:id',
    summary: 'Update a campus',
    tags,
    access: { permission: 'university:manage' },
    request: { params: idParamSchema, body: campusUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(campusSchema) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await updateCampus(getActor(req), req.valid.params.id, req.valid.body),
      'Campus updated',
    );
  },
);

defineRoute(
  universityRouter,
  {
    method: 'delete',
    path: '/campuses/:id',
    summary: 'Delete an unused campus',
    tags,
    access: { permission: 'university:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await deleteCampus(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Campus deleted');
  },
);
