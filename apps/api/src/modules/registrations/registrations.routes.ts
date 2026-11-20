import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import {
  adminRegisterSchema,
  batchRegisterSchema,
  bulkDecisionSchema,
  decisionSchema,
  dropSchema,
  eligibilityQuerySchema,
  idParamSchema,
  paginationQuerySchema,
  REGISTRATION_STATUSES,
  registerSchema,
  withdrawSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { ValidationError } from '../../common/exceptions/app-error.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import * as service from './registrations.service.js';
import * as waitlist from './waitlist.service.js';
import {
  batchResultDto,
  decisionResultDto,
  eligibilityDto,
  registrationDetailDto,
  registrationDto,
  registrationRequestDto,
  sectionRegistrationsDto,
} from './registration-dtos.js';

export const registrationsRouter = Router();
const tags = ['Registrations'];
const one = { 200: { description: 'Registration', schema: successEnvelope(registrationDto) } };

/** `Idempotency-Key` header (API.md §8): optional, at most 100 safe characters. */
function idempotencyKey(req: Request): string | null {
  const key = req.header('idempotency-key');
  if (!key) return null;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key))
    throw new ValidationError({
      fields: [{ path: 'headers.idempotency-key', message: 'Use 8–100 letters, digits, - or _' }],
    });
  return key;
}

defineRoute(
  registrationsRouter,
  {
    method: 'get',
    path: '/registrations/eligibility',
    summary: 'Preview every registration rule for a section (FR-STUDENT-005)',
    description: 'Students preview for themselves; administrators pass `studentId`.',
    tags,
    access: { authenticated: true },
    request: { query: eligibilityQuerySchema },
    responses: { 200: { description: 'Rule results', schema: successEnvelope(eligibilityDto) } },
  },
  async (req, res) => {
    sendOk(res, await service.eligibility(getActor(req), req.valid.query), 'Eligibility evaluated');
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'post',
    path: '/registrations',
    summary: 'Register yourself for a section (optionally joining the waitlist)',
    description: 'Accepts an `Idempotency-Key` header; replays return the original registration.',
    tags,
    access: { permission: 'registration:self' },
    request: { body: registerSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(registrationDto) } },
  },
  async (req, res) => {
    const result = await service.registerSelf(getActor(req), req.valid.body, idempotencyKey(req));
    if (result.replay) {
      res.setHeader('Idempotent-Replay', 'true');
      sendOk(res, result, 'Registration retrieved');
    } else
      sendCreated(
        res,
        result,
        result.status === 'WAITLISTED' ? 'Added to the waitlist' : 'Registration created',
      );
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'post',
    path: '/registrations/batch',
    summary: 'Register for several sections; each item succeeds or fails on its own',
    tags,
    access: { permission: 'registration:self' },
    request: { body: batchRegisterSchema },
    responses: { 200: { description: 'Results', schema: successEnvelope(batchResultDto) } },
  },
  async (req, res) => {
    const result = await service.registerBatch(getActor(req), req.valid.body.items);
    sendOk(res, result, `${result.succeeded} of ${result.results.length} processed`);
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'post',
    path: '/admin/registrations',
    summary: 'Register a student on their behalf, optionally overriding rules',
    tags,
    access: { permission: 'registration:manage' },
    request: { body: adminRegisterSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(registrationDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await service.registerOnBehalf(getActor(req), req.valid.body),
      'Registration created',
    );
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'get',
    path: '/registrations/me',
    summary: 'Your registrations (optionally for one session)',
    tags,
    access: { permission: 'registration:self' },
    request: { query: z.object({ sessionId: z.uuid().optional() }) },
    responses: {
      200: {
        description: 'Registrations',
        schema: successEnvelope(
          z.object({ items: z.array(registrationDto), seatCredits: z.number() }),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.myRegistrations(getActor(req), req.valid.query.sessionId),
      'Registrations retrieved',
    );
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'get',
    path: '/registrations',
    summary: 'List registrations (administrators: in scope; others: their own)',
    tags,
    access: { authenticated: true },
    request: {
      query: paginationQuerySchema.extend({
        q: z.string().trim().max(100).optional(),
        sessionId: z.uuid().optional(),
        status: z.enum(REGISTRATION_STATUSES).optional(),
        departmentId: z.uuid().optional(),
        courseId: z.uuid().optional(),
        sectionId: z.uuid().optional(),
        studentId: z.uuid().optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        hasOverrides: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
    },
    responses: {
      200: { description: 'Registrations', schema: paginatedEnvelope(registrationDto) },
    },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await service.listRegistrations(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Registrations retrieved');
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'get',
    path: '/registrations/:id',
    summary: 'A registration with its full history',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Registration', schema: successEnvelope(registrationDetailDto) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.getRegistration(getActor(req), req.valid.params.id),
      'Registration retrieved',
    );
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'post',
    path: '/registrations/:id/drop',
    summary: 'Drop a seat, leave a waitlist, cancel a pending request or decline an offer',
    description:
      'Students act on their own registrations; administrators need registration:manage (overrides: registration:override).',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema, body: dropSchema },
    responses: {
      200: { description: 'Updated', schema: successEnvelope(z.array(registrationDto)) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.dropRegistration(getActor(req), req.valid.params.id, req.valid.body),
      'Registration updated',
    );
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'post',
    path: '/registrations/:id/withdraw',
    summary: 'Withdraw after add/drop (may create an approval request)',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema, body: withdrawSchema },
    responses: one,
  },
  async (req, res) => {
    sendOk(
      res,
      await service.withdrawRegistration(getActor(req), req.valid.params.id, req.valid.body),
      'Withdrawal recorded',
    );
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'post',
    path: '/registrations/:id/claim',
    summary: 'Claim an offered seat',
    tags,
    access: { permission: 'registration:self' },
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Claimed',
        schema: successEnvelope(z.object({ id: z.uuid(), status: z.string() })),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await waitlist.claimOffer(getActor(req), req.valid.params.id), 'Seat claimed');
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'post',
    path: '/registrations/:id/decision',
    summary: 'Approve or reject a pending registration',
    tags,
    access: { permission: 'registration:approve' },
    request: { params: idParamSchema, body: decisionSchema },
    responses: one,
  },
  async (req, res) => {
    sendOk(
      res,
      await service.decideRegistration(getActor(req), req.valid.params.id, req.valid.body),
      'Decision recorded',
    );
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'post',
    path: '/registrations/bulk-decision',
    summary: 'Approve or reject several pending registrations',
    tags,
    access: { permission: 'registration:approve' },
    request: { body: bulkDecisionSchema },
    responses: { 200: { description: 'Results', schema: successEnvelope(decisionResultDto) } },
  },
  async (req, res) => {
    const result = await service.decideMany(getActor(req), req.valid.body);
    sendOk(res, result, `${result.succeeded} of ${result.results.length} decided`);
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'get',
    path: '/registration-requests',
    summary: 'Withdrawal requests awaiting a decision (in scope)',
    tags,
    access: { permission: 'registration:approve' },
    request: {
      query: paginationQuerySchema.extend({
        status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
      }),
    },
    responses: {
      200: { description: 'Requests', schema: paginatedEnvelope(registrationRequestDto) },
    },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await service.listRequests(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Requests retrieved');
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'post',
    path: '/registration-requests/:id/decision',
    summary: 'Approve or reject a withdrawal request',
    tags,
    access: { permission: 'registration:approve' },
    request: { params: idParamSchema, body: decisionSchema },
    responses: one,
  },
  async (req, res) => {
    sendOk(
      res,
      await service.decideRequest(getActor(req), req.valid.params.id, req.valid.body),
      'Decision recorded',
    );
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'get',
    path: '/course-sections/:id/registrations',
    summary: 'Seat holders and the ordered waitlist of a section',
    tags,
    access: { permission: 'registration:read' },
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Registrations', schema: successEnvelope(sectionRegistrationsDto) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.sectionRegistrations(getActor(req), req.valid.params.id),
      'Registrations retrieved',
    );
  },
);

defineRoute(
  registrationsRouter,
  {
    method: 'post',
    path: '/course-sections/:id/waitlist/promote',
    summary: 'Promote waitlisted students into free seats now',
    tags,
    access: { permission: 'waitlist:manage' },
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Result',
        schema: successEnvelope(z.object({ promoted: z.number(), skipped: z.number() })),
      },
    },
  },
  async (req, res) => {
    const result = await waitlist.promoteNow(getActor(req), req.valid.params.id);
    sendOk(res, result, `${result.promoted} promoted`);
  },
);
