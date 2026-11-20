import { Router } from 'express';
import { z } from 'zod';
import { coursePlanItemsSchema, coursePlanSchema, idParamSchema } from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { successEnvelope } from '../../openapi/registry.js';
import { batchResultDto } from './registration-dtos.js';
import * as service from './plans-records.service.js';

export const plansRecordsRouter = Router();

const recordsDto = z
  .object({
    records: z.array(
      z.object({
        id: z.uuid(),
        source: z.string(),
        courseId: z.uuid(),
        courseCode: z.string(),
        courseTitle: z.string(),
        creditsAttempted: z.number(),
        creditsEarned: z.number(),
        gradeLetter: z.string().nullable(),
        gradePoints: z.number().nullable(),
        countsInGpa: z.boolean(),
        passed: z.boolean(),
        session: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
      }),
    ),
    creditsEarned: z.number(),
    cgpa: z.number().nullable(),
  })
  .meta({ id: 'AcademicRecords' });

const planDto = z
  .object({
    id: z.uuid(),
    name: z.string(),
    session: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    items: z.array(
      z.object({
        course: z.object({
          id: z.uuid(),
          code: z.string(),
          title: z.string(),
          credits: z.number(),
        }),
        section: z.object({ id: z.uuid(), sectionCode: z.string(), status: z.string() }).nullable(),
      }),
    ),
    totalCredits: z.number(),
    updatedAt: z.string(),
  })
  .meta({ id: 'CoursePlan' });

defineRoute(
  plansRecordsRouter,
  {
    method: 'get',
    path: '/academic-records/me',
    summary: 'Your academic records and CGPA',
    tags: ['Academic records'],
    access: { authenticated: true },
    responses: { 200: { description: 'Records', schema: successEnvelope(recordsDto) } },
  },
  async (req, res) => {
    sendOk(res, await service.myRecords(getActor(req)), 'Records retrieved');
  },
);

defineRoute(
  plansRecordsRouter,
  {
    method: 'get',
    path: '/students/:id/records',
    summary: 'A student’s academic records (record:read in scope, or the student)',
    tags: ['Academic records'],
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Records', schema: successEnvelope(recordsDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.studentRecords(getActor(req), req.valid.params.id),
      'Records retrieved',
    );
  },
);

const planTags = ['Course planner'];

defineRoute(
  plansRecordsRouter,
  {
    method: 'get',
    path: '/course-plans',
    summary: 'Your course plans',
    tags: planTags,
    access: { permission: 'registration:self' },
    request: { query: z.object({ sessionId: z.uuid().optional() }) },
    responses: { 200: { description: 'Plans', schema: successEnvelope(z.array(planDto)) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.listPlans(getActor(req), req.valid.query.sessionId),
      'Plans retrieved',
    );
  },
);

defineRoute(
  plansRecordsRouter,
  {
    method: 'post',
    path: '/course-plans',
    summary: 'Create a course plan for a session',
    tags: planTags,
    access: { permission: 'registration:self' },
    request: { body: coursePlanSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(planDto) } },
  },
  async (req, res) => {
    sendCreated(res, await service.createPlan(getActor(req), req.valid.body), 'Plan created');
  },
);

defineRoute(
  plansRecordsRouter,
  {
    method: 'get',
    path: '/course-plans/:id',
    summary: 'A course plan',
    tags: planTags,
    access: { permission: 'registration:self' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Plan', schema: successEnvelope(planDto) } },
  },
  async (req, res) => {
    sendOk(res, await service.getPlan(getActor(req), req.valid.params.id), 'Plan retrieved');
  },
);

defineRoute(
  plansRecordsRouter,
  {
    method: 'put',
    path: '/course-plans/:id/items',
    summary: 'Replace the courses (and chosen sections) of a plan',
    tags: planTags,
    access: { permission: 'registration:self' },
    request: { params: idParamSchema, body: coursePlanItemsSchema },
    responses: { 200: { description: 'Plan', schema: successEnvelope(planDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.setPlanItems(getActor(req), req.valid.params.id, req.valid.body.items),
      'Plan saved',
    );
  },
);

defineRoute(
  plansRecordsRouter,
  {
    method: 'delete',
    path: '/course-plans/:id',
    summary: 'Delete a course plan',
    tags: planTags,
    access: { permission: 'registration:self' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await service.deletePlan(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Plan deleted');
  },
);

defineRoute(
  plansRecordsRouter,
  {
    method: 'get',
    path: '/course-plans/:id/validate',
    summary: 'Check every planned section against the registration rules',
    tags: planTags,
    access: { permission: 'registration:self' },
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Validation',
        schema: successEnvelope(
          z.object({
            planId: z.uuid(),
            totalCredits: z.number(),
            items: z.array(
              z.object({
                courseId: z.uuid(),
                sectionId: z.uuid().nullable(),
                ok: z.boolean(),
                problems: z.array(z.object({ code: z.string(), message: z.string() })),
              }),
            ),
          }),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await service.validatePlan(getActor(req), req.valid.params.id), 'Plan checked');
  },
);

defineRoute(
  plansRecordsRouter,
  {
    method: 'post',
    path: '/course-plans/:id/register',
    summary:
      'Register for every planned section (each item independent; full sections join the waitlist)',
    tags: planTags,
    access: { permission: 'registration:self' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Results', schema: successEnvelope(batchResultDto) } },
  },
  async (req, res) => {
    const result = await service.registerPlan(getActor(req), req.valid.params.id);
    sendOk(res, result, `${result.succeeded} of ${result.results.length} registered`);
  },
);
