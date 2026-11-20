import { Router } from 'express';
import { z } from 'zod';
import {
  contactSearchQuerySchema,
  conversationListQuerySchema,
  conversationSettingsSchema,
  directConversationSchema,
  idParamSchema,
  MESSAGE_MAX_LENGTH,
  messageCreateSchema,
  messageListQuerySchema,
  messageSearchQuerySchema,
  messageUpdateSchema,
} from '@ucrams/shared';
import { userRateLimit } from '../../common/middleware/rate-limit.js';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { successEnvelope } from '../../openapi/registry.js';
import * as service from './messaging.service.js';

export const messagingRouter = Router();
const messageLimit = userRateLimit('messageLimit', 30, 60);
const tags = ['Messaging'];
const access = { permission: 'message:send' } as const;

const conversationDto = z
  .object({
    id: z.uuid(),
    type: z.enum(['DIRECT', 'SECTION', 'SUPPORT']),
    title: z.string(),
    subtitle: z.string().nullable(),
    section: z.object({ id: z.uuid(), label: z.string() }).nullable(),
    announcementOnly: z.boolean(),
    muted: z.boolean(),
    member: z.boolean(),
    unread: z.number(),
    canPost: z.boolean(),
    canModerate: z.boolean(),
    lastMessage: z
      .object({ preview: z.string(), sender: z.string(), createdAt: z.string() })
      .nullable(),
    lastMessageAt: z.string().nullable(),
    participants: z.array(z.object({ userId: z.uuid(), name: z.string(), role: z.string() })),
  })
  .meta({ id: 'Conversation' });
const messageDto = z
  .object({
    id: z.uuid(),
    conversationId: z.uuid(),
    sender: z.object({ id: z.uuid(), name: z.string() }),
    body: z.string().nullable(),
    deleted: z.boolean(),
    editedAt: z.string().nullable(),
    createdAt: z.string(),
    mine: z.boolean(),
    canEdit: z.boolean(),
    canDelete: z.boolean(),
    attachments: z.array(
      z.object({
        fileId: z.uuid(),
        name: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number(),
      }),
    ),
  })
  .meta({ id: 'Message' });
const started = z.object({ conversationId: z.uuid(), message: messageDto });
const link = z.object({ url: z.string(), expiresInSeconds: z.number().nullable() });

defineRoute(
  messagingRouter,
  {
    method: 'get',
    path: '/conversations',
    summary: 'Your conversations (or the support inbox for administrators), most recent first',
    tags,
    access,
    request: { query: conversationListQuerySchema },
    responses: {
      200: { description: 'Conversations', schema: successEnvelope(z.array(conversationDto)) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.listConversations(getActor(req), req.valid.query.box),
      'Conversations retrieved',
    );
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'get',
    path: '/conversations/unread-count',
    summary: 'Unread messages across your conversations (muted ones excluded)',
    tags,
    access,
    responses: {
      200: { description: 'Count', schema: successEnvelope(z.object({ total: z.number() })) },
    },
  },
  async (req, res) => {
    sendOk(res, await service.unreadSummary(getActor(req)), 'Unread count retrieved');
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'get',
    path: '/conversations/contacts',
    summary: 'People you may start a direct conversation with (FR-COMM-002)',
    tags,
    access,
    request: { query: contactSearchQuerySchema },
    responses: {
      200: {
        description: 'Contacts',
        schema: successEnvelope(
          z.array(
            z.object({
              userId: z.uuid(),
              name: z.string(),
              email: z.string(),
              kind: z.enum(['STUDENT', 'FACULTY', 'ADMIN']),
            }),
          ),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await service.contacts(getActor(req), req.valid.query.q), 'Contacts retrieved');
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'get',
    path: '/conversations/search',
    summary: 'Search messages in your conversations',
    tags,
    access,
    request: { query: messageSearchQuerySchema },
    responses: {
      200: {
        description: 'Matches',
        schema: successEnvelope(
          z.array(messageDto.extend({ conversationTitle: z.string() }).meta({ id: 'MessageHit' })),
        ),
      },
    },
  },
  async (req, res) => {
    const q = req.valid.query;
    sendOk(res, await service.searchMessages(getActor(req), q.q, q.limit), 'Search results');
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'post',
    path: '/conversations/direct',
    summary: 'Message someone directly (opens or reuses your conversation with them)',
    tags,
    access,
    middleware: [messageLimit],
    request: { body: directConversationSchema },
    responses: { 201: { description: 'Sent', schema: successEnvelope(started) } },
  },
  async (req, res) => {
    sendCreated(res, await service.startDirect(getActor(req), req.valid.body), 'Message sent');
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'post',
    path: '/conversations/support',
    summary: 'Write to university support (your support conversation is created on first use)',
    tags,
    access,
    middleware: [messageLimit],
    request: { body: z.object({ body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH) }) },
    responses: { 201: { description: 'Sent', schema: successEnvelope(started) } },
  },
  async (req, res) => {
    sendCreated(res, await service.openSupport(getActor(req), req.valid.body.body), 'Message sent');
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'get',
    path: '/conversations/:id',
    summary: 'A conversation you belong to or moderate',
    tags,
    access,
    request: { params: idParamSchema },
    responses: { 200: { description: 'Conversation', schema: successEnvelope(conversationDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.getConversation(getActor(req), req.valid.params.id),
      'Conversation retrieved',
    );
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'patch',
    path: '/conversations/:id',
    summary: 'Mute a conversation, or (instructors) make a section conversation announcement-only',
    tags,
    access,
    request: { params: idParamSchema, body: conversationSettingsSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(conversationDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.updateSettings(getActor(req), req.valid.params.id, req.valid.body),
      'Conversation updated',
    );
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'post',
    path: '/conversations/:id/read',
    summary: 'Mark the conversation read up to its latest message',
    tags,
    access,
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Read', schema: successEnvelope(z.object({ unread: z.number() })) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.markConversationRead(getActor(req), req.valid.params.id),
      'Conversation read',
    );
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'get',
    path: '/conversations/:id/messages',
    summary: 'Messages, oldest first, paged backwards with `before`',
    tags,
    access,
    request: { params: idParamSchema, query: messageListQuerySchema },
    responses: {
      200: {
        description: 'Messages',
        schema: successEnvelope(z.object({ hasMore: z.boolean(), items: z.array(messageDto) })),
      },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.listMessages(getActor(req), req.valid.params.id, req.valid.query),
      'Messages retrieved',
    );
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'post',
    path: '/conversations/:id/messages',
    summary: 'Send a message',
    tags,
    access,
    middleware: [messageLimit],
    request: { params: idParamSchema, body: messageCreateSchema },
    responses: { 201: { description: 'Sent', schema: successEnvelope(messageDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await service.sendMessage(getActor(req), req.valid.params.id, req.valid.body),
      'Message sent',
    );
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'patch',
    path: '/messages/:id',
    summary: 'Edit your message (within 15 minutes of sending)',
    tags,
    access,
    request: { params: idParamSchema, body: messageUpdateSchema },
    responses: { 200: { description: 'Edited', schema: successEnvelope(messageDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.editMessage(getActor(req), req.valid.params.id, req.valid.body.body),
      'Message edited',
    );
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'delete',
    path: '/messages/:id',
    summary: 'Delete a message (yours, or any as a moderator)',
    tags,
    access,
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await service.deleteMessage(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Message deleted');
  },
);

defineRoute(
  messagingRouter,
  {
    method: 'get',
    path: '/messages/:id/attachments/:fileId',
    summary: 'Short-lived download link for a message attachment',
    tags,
    access,
    request: { params: z.object({ id: z.uuid(), fileId: z.uuid() }) },
    responses: { 200: { description: 'Link', schema: successEnvelope(link) } },
  },
  async (req, res) => {
    const p = req.valid.params;
    sendOk(res, await service.attachmentLink(getActor(req), p.id, p.fileId), 'Download link');
  },
);
