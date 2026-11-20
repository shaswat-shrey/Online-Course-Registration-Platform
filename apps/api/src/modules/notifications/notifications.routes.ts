import { Router } from 'express';
import { z } from 'zod';
import { markNotificationsSchema, paginationQuerySchema } from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import * as service from './notifications.service.js';

export const notificationsRouter = Router();
const tags = ['Notifications'];
const notificationDto = z
  .object({
    id: z.uuid(),
    category: z.string(),
    title: z.string(),
    body: z.string(),
    link: z.string().nullable(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'Notification' });

defineRoute(
  notificationsRouter,
  {
    method: 'get',
    path: '/notifications',
    summary: 'Your notifications, newest first',
    tags,
    access: { authenticated: true },
    request: {
      query: paginationQuerySchema.extend({
        unread: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
    },
    responses: {
      200: { description: 'Notifications', schema: paginatedEnvelope(notificationDto) },
    },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await service.listNotifications(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Notifications retrieved');
  },
);

defineRoute(
  notificationsRouter,
  {
    method: 'get',
    path: '/notifications/unread-count',
    summary: 'Number of unread notifications',
    tags,
    access: { authenticated: true },
    responses: {
      200: { description: 'Count', schema: successEnvelope(z.object({ unread: z.number() })) },
    },
  },
  async (req, res) => {
    sendOk(res, await service.unreadCount(getActor(req)), 'Unread count retrieved');
  },
);

defineRoute(
  notificationsRouter,
  {
    method: 'post',
    path: '/notifications/read',
    summary: 'Mark notifications as read (by id, or all)',
    tags,
    access: { authenticated: true },
    request: { body: markNotificationsSchema },
    responses: {
      200: { description: 'Updated', schema: successEnvelope(z.object({ updated: z.number() })) },
    },
  },
  async (req, res) => {
    sendOk(res, await service.markRead(getActor(req), req.valid.body), 'Notifications updated');
  },
);
