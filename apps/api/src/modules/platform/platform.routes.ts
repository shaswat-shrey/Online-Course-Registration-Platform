import { Router } from 'express';
import { z } from 'zod';
import {
  documentCreateSchema,
  documentListQuerySchema,
  idParamSchema,
  searchQuerySchema,
  settingUpdateSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { userRateLimit } from '../../common/middleware/rate-limit.js';
import * as documents from './documents.service.js';
import * as jobs from './jobs.service.js';
import { search } from './search.service.js';
import * as settings from './settings.service.js';

export const platformRouter = Router();
const searchLimiter = userRateLimit('search', 60, 60);

// ----- settings -------------------------------------------------------------------------

defineRoute(
  platformRouter,
  {
    method: 'get',
    path: '/settings',
    summary: 'Every system setting with its default',
    tags: ['Settings'],
    access: { permission: 'settings:manage' },
    responses: { 200: { description: 'Settings' } },
  },
  async (req, res) => sendOk(res, await settings.listSettings(getActor(req))),
);

defineRoute(
  platformRouter,
  {
    method: 'get',
    path: '/settings/public',
    summary: 'Settings every signed-in user may read (the portal banner)',
    tags: ['Settings'],
    access: { authenticated: true },
    responses: { 200: { description: 'Public settings' } },
  },
  async (_req, res) => sendOk(res, await settings.publicSettings()),
);

defineRoute(
  platformRouter,
  {
    method: 'patch',
    path: '/settings/:key',
    summary: 'Change a setting (validated against its schema; audited)',
    tags: ['Settings'],
    access: { permission: 'settings:manage' },
    request: { params: z.object({ key: z.string().max(100) }), body: settingUpdateSchema },
    responses: { 200: { description: 'Updated setting' } },
  },
  async (req, res) =>
    sendOk(
      res,
      await settings.updateSetting(getActor(req), req.valid.params.key, req.valid.body.value),
      'Setting saved',
    ),
);

// ----- search ---------------------------------------------------------------------------

defineRoute(
  platformRouter,
  {
    method: 'get',
    path: '/search',
    summary: 'Global search across courses, structure, faculty and (in scope) students',
    tags: ['Search'],
    access: { authenticated: true },
    middleware: [searchLimiter],
    request: { query: searchQuerySchema },
    responses: { 200: { description: 'Grouped results' } },
  },
  async (req, res) => sendOk(res, await search(getActor(req), req.valid.query)),
);

// ----- background jobs ------------------------------------------------------------------

const jobParams = z.object({ queue: z.string().max(60), id: z.string().max(200) });

defineRoute(
  platformRouter,
  {
    method: 'get',
    path: '/jobs',
    summary: 'Queue counts, worker heartbeat and recent failures',
    tags: ['Jobs'],
    access: { permission: 'jobs:read' },
    responses: { 200: { description: 'Job overview' } },
  },
  async (req, res) => sendOk(res, await jobs.overview(getActor(req))),
);

defineRoute(
  platformRouter,
  {
    method: 'post',
    path: '/jobs/:queue/:id/retry',
    summary: 'Retry a failed job',
    tags: ['Jobs'],
    access: { permission: 'jobs:manage' },
    request: { params: jobParams },
    responses: { 200: { description: 'Queued again' } },
  },
  async (req, res) => {
    await jobs.retry(getActor(req), req.valid.params.queue, req.valid.params.id);
    sendOk(res, null, 'Job queued again');
  },
);

defineRoute(
  platformRouter,
  {
    method: 'delete',
    path: '/jobs/:queue/:id',
    summary: 'Remove a failed job',
    tags: ['Jobs'],
    access: { permission: 'jobs:manage' },
    request: { params: jobParams },
    responses: { 200: { description: 'Removed' } },
  },
  async (req, res) => {
    await jobs.remove(getActor(req), req.valid.params.queue, req.valid.params.id);
    sendOk(res, null, 'Job removed');
  },
);

// ----- documents ------------------------------------------------------------------------

defineRoute(
  platformRouter,
  {
    method: 'get',
    path: '/documents',
    summary: 'Documents published to you (or, with manage=true, those you manage)',
    tags: ['Documents'],
    access: { authenticated: true },
    request: { query: documentListQuerySchema },
    responses: { 200: { description: 'Documents and categories' } },
  },
  async (req, res) => sendOk(res, await documents.list(getActor(req), req.valid.query)),
);

defineRoute(
  platformRouter,
  {
    method: 'post',
    path: '/documents',
    summary: 'Publish a document from a completed DOCUMENT upload',
    tags: ['Documents'],
    access: { permission: 'document:manage' },
    request: { body: documentCreateSchema },
    responses: { 201: { description: 'Document' } },
  },
  async (req, res) =>
    sendCreated(res, await documents.create(getActor(req), req.valid.body), 'Document published'),
);

defineRoute(
  platformRouter,
  {
    method: 'get',
    path: '/documents/:id/download',
    summary: 'Short-lived download link',
    tags: ['Documents'],
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Signed link' } },
  },
  async (req, res) => sendOk(res, await documents.link(getActor(req), req.valid.params.id)),
);

defineRoute(
  platformRouter,
  {
    method: 'delete',
    path: '/documents/:id',
    summary: 'Delete a document and its file',
    tags: ['Documents'],
    access: { permission: 'document:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await documents.remove(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Document deleted');
  },
);
