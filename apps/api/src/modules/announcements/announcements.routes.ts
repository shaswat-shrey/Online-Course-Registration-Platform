import { Router } from 'express';
import { z } from 'zod';
import {
  ANNOUNCEMENT_PRIORITIES,
  announcementCreateSchema,
  announcementUpdateSchema,
  AUDIENCE_ROLES,
  AUDIENCE_TYPES,
  idParamSchema,
  paginationQuerySchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import * as service from './announcements.service.js';

export const announcementsRouter = Router();
const tags = ['Announcements'];

const announcementDto = z
  .object({
    id: z.uuid(),
    title: z.string(),
    body: z.string(),
    priority: z.enum(ANNOUNCEMENT_PRIORITIES),
    pinned: z.boolean(),
    publishedAt: z.string(),
    expiresAt: z.string().nullable(),
    scheduled: z.boolean(),
    expired: z.boolean(),
    author: z.string(),
    mine: z.boolean(),
    canManage: z.boolean(),
    read: z.boolean(),
    readCount: z.number().nullable(),
    audiences: z.array(
      z.object({
        type: z.enum(AUDIENCE_TYPES),
        targetId: z.uuid().nullable(),
        targetValue: z.number().nullable(),
        roleFilter: z.enum(AUDIENCE_ROLES),
        label: z.string(),
      }),
    ),
    sections: z.array(z.object({ id: z.uuid(), label: z.string() })),
  })
  .meta({ id: 'Announcement' });

defineRoute(
  announcementsRouter,
  {
    method: 'get',
    path: '/announcements/feed',
    summary: 'Current announcements that reach you, pinned first, with read state',
    tags,
    access: { authenticated: true },
    request: {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        unread: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
    },
    responses: {
      200: {
        description: 'Feed',
        schema: successEnvelope(z.object({ unread: z.number(), items: z.array(announcementDto) })),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await service.feed(getActor(req), req.valid.query), 'Announcements retrieved');
  },
);

defineRoute(
  announcementsRouter,
  {
    method: 'get',
    path: '/announcements/manage',
    summary: 'Announcements you can manage (global publishers see all), newest first',
    tags,
    access: { authenticated: true },
    request: { query: paginationQuerySchema },
    responses: {
      200: { description: 'Announcements', schema: paginatedEnvelope(announcementDto) },
    },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await service.manageList(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Announcements retrieved');
  },
);

defineRoute(
  announcementsRouter,
  {
    method: 'get',
    path: '/announcements/mine',
    summary: 'Announcements you have written',
    tags,
    access: { permission: 'announcement:publish_section' },
    responses: {
      200: { description: 'Announcements', schema: successEnvelope(z.array(announcementDto)) },
    },
  },
  async (req, res) => {
    sendOk(res, await service.myAnnouncements(getActor(req)), 'Announcements retrieved');
  },
);

defineRoute(
  announcementsRouter,
  {
    method: 'get',
    path: '/course-sections/:id/announcements',
    summary: 'Announcements to a section (students see current ones only)',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Announcements',
        schema: successEnvelope(
          z.object({ canPublish: z.boolean(), items: z.array(announcementDto) }),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.sectionAnnouncements(getActor(req), req.valid.params.id),
      'Announcements retrieved',
    );
  },
);

defineRoute(
  announcementsRouter,
  {
    method: 'post',
    path: '/announcements',
    summary:
      'Publish or schedule an announcement (faculty: own sections and courses; administrators: within scope)',
    tags,
    access: { authenticated: true },
    request: { body: announcementCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(announcementDto) } },
  },
  async (req, res) => {
    const a = await service.createAnnouncement(getActor(req), req.valid.body);
    sendCreated(res, a, a.scheduled ? 'Announcement scheduled' : 'Announcement published');
  },
);

defineRoute(
  announcementsRouter,
  {
    method: 'get',
    path: '/announcements/:id',
    summary: 'One announcement that reaches you (or that you manage)',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Announcement', schema: successEnvelope(announcementDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.getAnnouncement(getActor(req), req.valid.params.id),
      'Announcement retrieved',
    );
  },
);

defineRoute(
  announcementsRouter,
  {
    method: 'post',
    path: '/announcements/:id/read',
    summary: 'Mark an announcement read',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Read' } },
  },
  async (req, res) => {
    await service.markAnnouncementRead(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Announcement marked read');
  },
);

defineRoute(
  announcementsRouter,
  {
    method: 'patch',
    path: '/announcements/:id',
    summary: 'Edit an announcement; changing the publish time reschedules it',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema, body: announcementUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(announcementDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.updateAnnouncement(getActor(req), req.valid.params.id, req.valid.body),
      'Announcement updated',
    );
  },
);

defineRoute(
  announcementsRouter,
  {
    method: 'delete',
    path: '/announcements/:id',
    summary: 'Delete an announcement',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await service.deleteAnnouncement(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Announcement deleted');
  },
);
