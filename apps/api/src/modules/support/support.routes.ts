import { Router } from 'express';
import { z } from 'zod';
import {
  CASE_PRIORITIES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  feedbackCreateSchema,
  feedbackListQuerySchema,
  feedbackUpdateSchema,
  idParamSchema,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  ticketCreateSchema,
  ticketListQuerySchema,
  ticketReplySchema,
  ticketUpdateSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import { assignees } from './case-access.js';
import * as feedback from './feedback.service.js';
import * as tickets from './tickets.service.js';

export const supportRouter = Router();
const feedbackTags = ['Feedback'];
const ticketTags = ['Support tickets'];

const ref = z.object({ id: z.uuid(), name: z.string() });
const org = z.object({ id: z.uuid(), code: z.string(), name: z.string() }).nullable();
const file = z.object({
  fileId: z.uuid(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
});
const link = z.object({ url: z.string(), expiresInSeconds: z.number().nullable() });
const assignee = z.object({ userId: z.uuid(), name: z.string(), email: z.string() });

const feedbackDto = z
  .object({
    id: z.uuid(),
    category: z.enum(FEEDBACK_CATEGORIES),
    subject: z.string(),
    description: z.string(),
    priority: z.enum(CASE_PRIORITIES),
    status: z.enum(FEEDBACK_STATUSES),
    anonymous: z.boolean(),
    submittedBy: ref.nullable(),
    mine: z.boolean(),
    department: org,
    course: z.object({ id: z.uuid(), code: z.string(), title: z.string() }).nullable(),
    assignee: ref.nullable(),
    resolutionNote: z.string().nullable(),
    resolvedAt: z.string().nullable(),
    responseCount: z.number(),
    canManage: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Feedback' });
const feedbackDetail = feedbackDto
  .extend({
    responses: z.array(
      z.object({
        id: z.uuid(),
        body: z.string(),
        author: z.string(),
        fromSubmitter: z.boolean(),
        createdAt: z.string(),
      }),
    ),
  })
  .meta({ id: 'FeedbackDetail' });

const ticketDto = z
  .object({
    id: z.uuid(),
    ticketNumber: z.string(),
    category: z.enum(TICKET_CATEGORIES),
    priority: z.enum(CASE_PRIORITIES),
    subject: z.string(),
    description: z.string(),
    status: z.enum(TICKET_STATUSES),
    owner: z.object({ id: z.uuid(), name: z.string(), email: z.string() }),
    mine: z.boolean(),
    department: org,
    assignee: ref.nullable(),
    resolvedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    reopenUntil: z.string().nullable(),
    canManage: z.boolean(),
    canReopen: z.boolean(),
    canReply: z.boolean(),
    lastActivityAt: z.string(),
    createdAt: z.string(),
  })
  .meta({ id: 'SupportTicket' });
const ticketDetail = ticketDto
  .extend({
    attachments: z.array(file),
    responses: z.array(
      z.object({
        id: z.uuid(),
        body: z.string(),
        internal: z.boolean(),
        author: z.string(),
        fromOwner: z.boolean(),
        attachments: z.array(file),
        createdAt: z.string(),
      }),
    ),
    events: z.array(
      z.object({
        id: z.uuid(),
        type: z.string(),
        fromValue: z.string().nullable(),
        toValue: z.string().nullable(),
        actor: z.string(),
        createdAt: z.string(),
      }),
    ),
  })
  .meta({ id: 'SupportTicketDetail' });

// ----- feedback (FR-COMM-012) --------------------------------------------------------

defineRoute(
  supportRouter,
  {
    method: 'post',
    path: '/feedback',
    summary: 'Submit feedback (optionally anonymous to administrators)',
    tags: feedbackTags,
    access: { permission: 'feedback:submit' },
    request: { body: feedbackCreateSchema },
    responses: { 201: { description: 'Submitted', schema: successEnvelope(feedbackDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await feedback.createFeedback(getActor(req), req.valid.body),
      'Feedback submitted',
    );
  },
);

for (const box of ['mine', 'manage'] as const)
  defineRoute(
    supportRouter,
    {
      method: 'get',
      path: box === 'mine' ? '/feedback/mine' : '/feedback',
      summary: box === 'mine' ? 'Feedback you submitted' : 'Feedback in your scope (triage queue)',
      tags: feedbackTags,
      access: { permission: box === 'mine' ? 'feedback:submit' : 'feedback:manage' },
      request: { query: feedbackListQuerySchema },
      responses: { 200: { description: 'Feedback', schema: paginatedEnvelope(feedbackDto) } },
    },
    async (req, res) => {
      const q = req.valid.query;
      const { total, items } = await feedback.listFeedback(getActor(req), q, box);
      sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Feedback retrieved');
    },
  );

defineRoute(
  supportRouter,
  {
    method: 'get',
    path: '/feedback/assignees',
    summary: 'Administrators who can be assigned feedback in a department',
    tags: feedbackTags,
    access: { permission: 'feedback:manage' },
    request: { query: z.object({ departmentId: z.uuid().optional() }) },
    responses: {
      200: { description: 'Assignees', schema: successEnvelope(z.array(assignee)) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await assignees('feedback:manage', req.valid.query.departmentId ?? null),
      'Assignees retrieved',
    );
  },
);

defineRoute(
  supportRouter,
  {
    method: 'get',
    path: '/feedback/:id',
    summary: 'Feedback with responses (submitter or a manager in scope)',
    tags: feedbackTags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Feedback', schema: successEnvelope(feedbackDetail) } },
  },
  async (req, res) => {
    sendOk(res, await feedback.getFeedback(getActor(req), req.valid.params.id), 'Feedback');
  },
);

defineRoute(
  supportRouter,
  {
    method: 'patch',
    path: '/feedback/:id',
    summary: 'Triage feedback: status, priority, assignee, resolution note',
    tags: feedbackTags,
    access: { permission: 'feedback:manage' },
    request: { params: idParamSchema, body: feedbackUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(feedbackDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await feedback.updateFeedback(getActor(req), req.valid.params.id, req.valid.body),
      'Feedback updated',
    );
  },
);

defineRoute(
  supportRouter,
  {
    method: 'post',
    path: '/feedback/:id/responses',
    summary: 'Respond to feedback (managers), or add a follow-up (submitter)',
    tags: feedbackTags,
    access: { authenticated: true },
    request: {
      params: idParamSchema,
      body: z.object({ body: z.string().trim().min(1).max(5000) }),
    },
    responses: { 201: { description: 'Added', schema: successEnvelope(feedbackDetail) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await feedback.respondToFeedback(getActor(req), req.valid.params.id, req.valid.body.body),
      'Response added',
    );
  },
);

// ----- support tickets (FR-COMM-013/014) ------------------------------------------------

defineRoute(
  supportRouter,
  {
    method: 'post',
    path: '/tickets',
    summary: 'Open a support ticket',
    tags: ticketTags,
    access: { permission: 'ticket:submit' },
    request: { body: ticketCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(ticketDto) } },
  },
  async (req, res) => {
    const t = await tickets.createTicket(getActor(req), req.valid.body);
    sendCreated(res, t, `Ticket ${t.ticketNumber} created`);
  },
);

for (const box of ['mine', 'manage'] as const)
  defineRoute(
    supportRouter,
    {
      method: 'get',
      path: box === 'mine' ? '/tickets/mine' : '/tickets',
      summary: box === 'mine' ? 'Tickets you opened' : 'Tickets in your scope (support queue)',
      tags: ticketTags,
      access: { permission: box === 'mine' ? 'ticket:submit' : 'ticket:manage' },
      request: { query: ticketListQuerySchema },
      responses: { 200: { description: 'Tickets', schema: paginatedEnvelope(ticketDto) } },
    },
    async (req, res) => {
      const q = req.valid.query;
      const { total, items } = await tickets.listTickets(getActor(req), q, box);
      sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Tickets retrieved');
    },
  );

defineRoute(
  supportRouter,
  {
    method: 'get',
    path: '/tickets/assignees',
    summary: 'Administrators who can be assigned tickets in a department',
    tags: ticketTags,
    access: { permission: 'ticket:manage' },
    request: { query: z.object({ departmentId: z.uuid().optional() }) },
    responses: {
      200: { description: 'Assignees', schema: successEnvelope(z.array(assignee)) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await assignees('ticket:manage', req.valid.query.departmentId ?? null),
      'Assignees retrieved',
    );
  },
);

defineRoute(
  supportRouter,
  {
    method: 'get',
    path: '/tickets/:id',
    summary: 'A ticket with its replies and status history (internal notes for staff only)',
    tags: ticketTags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Ticket', schema: successEnvelope(ticketDetail) } },
  },
  async (req, res) => {
    sendOk(res, await tickets.getTicket(getActor(req), req.valid.params.id), 'Ticket retrieved');
  },
);

defineRoute(
  supportRouter,
  {
    method: 'patch',
    path: '/tickets/:id',
    summary: 'Change status, priority or assignee',
    tags: ticketTags,
    access: { permission: 'ticket:manage' },
    request: { params: idParamSchema, body: ticketUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(ticketDetail) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await tickets.updateTicket(getActor(req), req.valid.params.id, req.valid.body),
      'Ticket updated',
    );
  },
);

defineRoute(
  supportRouter,
  {
    method: 'post',
    path: '/tickets/:id/responses',
    summary: 'Reply to a ticket (staff may add internal notes and change status)',
    tags: ticketTags,
    access: { authenticated: true },
    request: { params: idParamSchema, body: ticketReplySchema },
    responses: { 201: { description: 'Added', schema: successEnvelope(ticketDetail) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await tickets.replyToTicket(getActor(req), req.valid.params.id, req.valid.body),
      'Reply added',
    );
  },
);

defineRoute(
  supportRouter,
  {
    method: 'post',
    path: '/tickets/:id/reopen',
    summary: 'Reopen your resolved ticket (within 7 days of resolution)',
    tags: ticketTags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Reopened', schema: successEnvelope(ticketDetail) } },
  },
  async (req, res) => {
    sendOk(res, await tickets.reopenTicket(getActor(req), req.valid.params.id), 'Ticket reopened');
  },
);

defineRoute(
  supportRouter,
  {
    method: 'get',
    path: '/tickets/:id/attachments/:fileId',
    summary: 'Short-lived download link for a ticket attachment',
    tags: ticketTags,
    access: { authenticated: true },
    request: { params: z.object({ id: z.uuid(), fileId: z.uuid() }) },
    responses: { 200: { description: 'Link', schema: successEnvelope(link) } },
  },
  async (req, res) => {
    const p = req.valid.params;
    sendOk(res, await tickets.attachmentLink(getActor(req), p.id, p.fileId), 'Download link');
  },
);
