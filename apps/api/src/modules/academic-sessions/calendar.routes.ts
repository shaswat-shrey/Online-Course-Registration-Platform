import { Router } from 'express';
import { z } from 'zod';
import {
  academicSessionCreateSchema,
  academicSessionUpdateSchema,
  academicYearCreateSchema,
  academicYearUpdateSchema,
  idParamSchema,
  priorityWindowSchema,
  registrationPeriodSchema,
  SESSION_STATUSES,
  sessionPolicySchema,
  sessionTransitionSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { successEnvelope } from '../../openapi/registry.js';
import * as calendar from './calendar.service.js';

export const calendarRouter = Router();
const tags = ['Academic calendar'];

const yearDto = z
  .object({
    id: z.uuid(),
    label: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    sessionCount: z.number(),
  })
  .meta({ id: 'AcademicYear' });
const policyDto = z
  .object({
    minCredits: z.number(),
    maxCredits: z.number(),
    maxCreditsWithOverride: z.number().nullable(),
    approvalMode: z.string(),
    waitlistEnabled: z.boolean(),
    waitlistMaxPerSection: z.number().nullable(),
    promotionMode: z.string(),
    offerWindowHours: z.number(),
    countWaitlistInCredits: z.boolean(),
    allowInProgressPrereqs: z.boolean(),
    withdrawalRequiresApproval: z.boolean(),
    updatedAt: z.string(),
  })
  .meta({ id: 'SessionPolicy' });
const sessionDto = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    type: z.string(),
    status: z.enum(SESSION_STATUSES),
    isCurrent: z.boolean(),
    startDate: z.string(),
    endDate: z.string(),
    academicYear: z.object({ id: z.uuid(), label: z.string() }),
    gradingScale: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    policy: policyDto.nullable(),
    registrationPeriod: z
      .object({
        id: z.uuid(),
        opensAt: z.string(),
        closesAt: z.string(),
        lateClosesAt: z.string().nullable(),
        addDropDeadline: z.string(),
        withdrawalDeadline: z.string(),
        priorityWindows: z.array(
          z.object({
            id: z.uuid(),
            name: z.string(),
            opensAt: z.string(),
            program: z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable(),
            yearOfStudy: z.number().nullable(),
            cohort: z.string().nullable(),
          }),
        ),
      })
      .nullable(),
    registrationState: z.enum(['NOT_CONFIGURED', 'UPCOMING', 'OPEN', 'LATE', 'ADD_DROP', 'CLOSED']),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'AcademicSession' });

// ----- years ---------------------------------------------------------------------
defineRoute(
  calendarRouter,
  {
    method: 'get',
    path: '/academic-years',
    summary: 'List academic years',
    tags,
    access: { authenticated: true },
    responses: { 200: { description: 'Years', schema: successEnvelope(z.array(yearDto)) } },
  },
  async (_req, res) => {
    sendOk(res, await calendar.listYears(), 'Academic years retrieved');
  },
);
defineRoute(
  calendarRouter,
  {
    method: 'post',
    path: '/academic-years',
    summary: 'Create an academic year',
    tags,
    access: { permission: 'session:manage' },
    request: { body: academicYearCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(yearDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await calendar.createYear(getActor(req), req.valid.body),
      'Academic year created',
    );
  },
);
defineRoute(
  calendarRouter,
  {
    method: 'patch',
    path: '/academic-years/:id',
    summary: 'Update an academic year',
    tags,
    access: { permission: 'session:manage' },
    request: { params: idParamSchema, body: academicYearUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(yearDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await calendar.updateYear(getActor(req), req.valid.params.id, req.valid.body),
      'Academic year updated',
    );
  },
);
defineRoute(
  calendarRouter,
  {
    method: 'delete',
    path: '/academic-years/:id',
    summary: 'Delete an academic year without sessions',
    tags,
    access: { permission: 'session:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await calendar.deleteYear(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Academic year deleted');
  },
);

// ----- sessions --------------------------------------------------------------------
defineRoute(
  calendarRouter,
  {
    method: 'get',
    path: '/academic-sessions',
    summary: 'List academic sessions with policy and registration period',
    tags,
    access: { authenticated: true },
    request: {
      query: z.object({
        academicYearId: z.uuid().optional(),
        status: z.enum(SESSION_STATUSES).optional(),
        current: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
    },
    responses: { 200: { description: 'Sessions', schema: successEnvelope(z.array(sessionDto)) } },
  },
  async (req, res) => {
    sendOk(res, await calendar.listSessions(req.valid.query), 'Academic sessions retrieved');
  },
);
defineRoute(
  calendarRouter,
  {
    method: 'get',
    path: '/academic-sessions/:id',
    summary: 'Get an academic session',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Session', schema: successEnvelope(sessionDto) } },
  },
  async (req, res) => {
    sendOk(res, await calendar.getSession(req.valid.params.id), 'Academic session retrieved');
  },
);
defineRoute(
  calendarRouter,
  {
    method: 'post',
    path: '/academic-sessions',
    summary: 'Create an academic session (term)',
    tags,
    access: { permission: 'session:manage' },
    request: { body: academicSessionCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(sessionDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await calendar.createSession(getActor(req), req.valid.body),
      'Academic session created',
    );
  },
);
defineRoute(
  calendarRouter,
  {
    method: 'patch',
    path: '/academic-sessions/:id',
    summary: 'Update an academic session',
    tags,
    access: { permission: 'session:manage' },
    request: { params: idParamSchema, body: academicSessionUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(sessionDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await calendar.updateSession(getActor(req), req.valid.params.id, req.valid.body),
      'Academic session updated',
    );
  },
);
defineRoute(
  calendarRouter,
  {
    method: 'post',
    path: '/academic-sessions/:id/transition',
    summary: 'Activate, complete, archive, or make a session current',
    description:
      'Lifecycle PLANNED → ACTIVE → COMPLETED → ARCHIVED. "make-current" marks it current for its type.',
    tags,
    access: { permission: 'session:manage' },
    request: { params: idParamSchema, body: sessionTransitionSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(sessionDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await calendar.transitionSession(getActor(req), req.valid.params.id, req.valid.body.action),
      'Academic session updated',
    );
  },
);
defineRoute(
  calendarRouter,
  {
    method: 'delete',
    path: '/academic-sessions/:id',
    summary: 'Delete a planned session',
    tags,
    access: { permission: 'session:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await calendar.deleteSession(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Academic session deleted');
  },
);

// ----- registration settings ----------------------------------------------------
defineRoute(
  calendarRouter,
  {
    method: 'put',
    path: '/academic-sessions/:id/policy',
    summary: "Set the session's registration policy",
    tags,
    access: { permission: 'registration_period:manage' },
    request: { params: idParamSchema, body: sessionPolicySchema },
    responses: { 200: { description: 'Saved', schema: successEnvelope(policyDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await calendar.upsertPolicy(getActor(req), req.valid.params.id, req.valid.body),
      'Registration policy saved',
    );
  },
);
defineRoute(
  calendarRouter,
  {
    method: 'put',
    path: '/academic-sessions/:id/registration-period',
    summary: "Set the session's registration windows and deadlines",
    tags,
    access: { permission: 'registration_period:manage' },
    request: { params: idParamSchema, body: registrationPeriodSchema },
    responses: { 200: { description: 'Saved', schema: successEnvelope(sessionDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await calendar.upsertPeriod(getActor(req), req.valid.params.id, req.valid.body),
      'Registration period saved',
    );
  },
);
defineRoute(
  calendarRouter,
  {
    method: 'post',
    path: '/academic-sessions/:id/priority-windows',
    summary: 'Add a priority registration window for a cohort',
    tags,
    access: { permission: 'registration_period:manage' },
    request: { params: idParamSchema, body: priorityWindowSchema },
    responses: { 201: { description: 'Added', schema: successEnvelope(sessionDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await calendar.addPriorityWindow(getActor(req), req.valid.params.id, req.valid.body),
      'Priority window added',
    );
  },
);
defineRoute(
  calendarRouter,
  {
    method: 'delete',
    path: '/academic-sessions/:id/priority-windows/:windowId',
    summary: 'Remove a priority window',
    tags,
    access: { permission: 'registration_period:manage' },
    request: { params: z.object({ id: z.uuid(), windowId: z.uuid() }) },
    responses: { 200: { description: 'Removed', schema: successEnvelope(sessionDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await calendar.removePriorityWindow(
        getActor(req),
        req.valid.params.id,
        req.valid.params.windowId,
      ),
      'Priority window removed',
    );
  },
);
