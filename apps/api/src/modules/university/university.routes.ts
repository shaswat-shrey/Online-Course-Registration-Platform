import { Router } from 'express';
import { defineRoute } from '../../common/http/define-route.js';
import { sendOk } from '../../common/http/response.js';
import { successEnvelope } from '../../openapi/registry.js';
import { publicUniversitySchema } from './university.schemas.js';
import { getPublicUniversity } from './university.service.js';

export const universityRouter = Router();

defineRoute(
  universityRouter,
  {
    method: 'get',
    path: '/university/public',
    summary: 'Public university profile (branding for the login page)',
    tags: ['University'],
    access: { public: true },
    responses: {
      200: { description: 'University profile', schema: successEnvelope(publicUniversitySchema) },
    },
  },
  async (_req, res) => {
    sendOk(res, await getPublicUniversity(), 'University retrieved successfully');
  },
);
