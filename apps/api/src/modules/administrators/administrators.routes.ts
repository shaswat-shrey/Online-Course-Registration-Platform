import { Router } from 'express';
import { z } from 'zod';
import {
  ACCOUNT_STATUSES,
  accountStatusSchema,
  adminCreateSchema,
  adminUpdateSchema,
  idParamSchema,
  paginationQuerySchema,
  setAvatarSchema,
  uploadIntentSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import {
  completeUpload,
  createUploadIntent,
  removeOwnAvatar,
  setOwnAvatar,
} from '../files/files.service.js';
import { adminDetailDto, adminListItemDto } from '../people-dtos.js';
import { resendInvitation, setAccountStatus } from '../users/users.service.js';
import {
  createAdministrator,
  getAdministrator,
  listAdministrators,
  updateAdministrator,
} from './administrators.service.js';

export const peopleAdminRouter = Router();

// ----- administrators ---------------------------------------------------------------
defineRoute(
  peopleAdminRouter,
  {
    method: 'get',
    path: '/administrators',
    summary: 'List administrators and their roles',
    tags: ['Administrators'],
    access: { permission: 'admin:manage' },
    request: {
      query: paginationQuerySchema.extend({
        q: z.string().trim().max(100).optional(),
        status: z.enum(['INVITED', ...ACCOUNT_STATUSES]).optional(),
      }),
    },
    responses: {
      200: { description: 'Administrators', schema: paginatedEnvelope(adminListItemDto) },
    },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await listAdministrators(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Administrators retrieved');
  },
);
defineRoute(
  peopleAdminRouter,
  {
    method: 'get',
    path: '/administrators/:id',
    summary: 'Get an administrator',
    tags: ['Administrators'],
    access: { permission: 'admin:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Administrator', schema: successEnvelope(adminDetailDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await getAdministrator(getActor(req), req.valid.params.id),
      'Administrator retrieved',
    );
  },
);
defineRoute(
  peopleAdminRouter,
  {
    method: 'post',
    path: '/administrators',
    summary: 'Create an administrator with one role',
    description: 'You can only grant roles whose permissions you hold at the target scope.',
    tags: ['Administrators'],
    access: { permission: 'admin:manage' },
    request: { body: adminCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(adminDetailDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await createAdministrator(getActor(req), req.valid.body),
      'Administrator created',
    );
  },
);
defineRoute(
  peopleAdminRouter,
  {
    method: 'patch',
    path: '/administrators/:id',
    summary: "Update an administrator's profile",
    tags: ['Administrators'],
    access: { permission: 'admin:manage' },
    request: { params: idParamSchema, body: adminUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(adminDetailDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await updateAdministrator(getActor(req), req.valid.params.id, req.valid.body),
      'Administrator updated',
    );
  },
);

// ----- accounts -------------------------------------------------------------------------
defineRoute(
  peopleAdminRouter,
  {
    method: 'post',
    path: '/users/:id/status',
    summary: 'Suspend, deactivate or reactivate an account',
    description: 'Suspending or deactivating signs the user out everywhere.',
    tags: ['Account security'],
    access: { permission: 'user:manage_status' },
    request: { params: idParamSchema, body: accountStatusSchema },
    responses: {
      200: { description: 'Updated', schema: successEnvelope(z.object({ status: z.string() })) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await setAccountStatus(getActor(req), req.valid.params.id, req.valid.body),
      'Account status changed',
    );
  },
);
defineRoute(
  peopleAdminRouter,
  {
    method: 'post',
    path: '/users/:id/resend-invite',
    summary: 'Email a new activation link to an invited user',
    tags: ['Account security'],
    access: { permission: 'user:create' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Sent' } },
  },
  async (req, res) => {
    await resendInvitation(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Invitation sent');
  },
);

// ----- files & avatars ----------------------------------------------------------------
defineRoute(
  peopleAdminRouter,
  {
    method: 'post',
    path: '/files/upload-intents',
    summary: 'Start an upload: returns a presigned PUT URL',
    description:
      'Upload the bytes to `upload.url` with the given headers, then call /files/{id}/complete.',
    tags: ['Files'],
    access: { authenticated: true },
    request: { body: uploadIntentSchema },
    responses: {
      201: {
        description: 'Intent created',
        schema: successEnvelope(
          z.object({
            fileId: z.uuid(),
            upload: z.object({
              url: z.string(),
              method: z.literal('PUT'),
              headers: z.record(z.string(), z.string()),
              expiresAt: z.string(),
            }),
          }),
        ),
      },
    },
  },
  async (req, res) => {
    sendCreated(res, await createUploadIntent(getActor(req), req.valid.body), 'Upload ready');
  },
);
defineRoute(
  peopleAdminRouter,
  {
    method: 'post',
    path: '/files/:id/complete',
    summary: 'Finish an upload: verifies size and content type',
    tags: ['Files'],
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Verified',
        schema: successEnvelope(
          z.object({ fileId: z.uuid(), status: z.string(), mimeType: z.string() }),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await completeUpload(getActor(req), req.valid.params.id), 'Upload verified');
  },
);
defineRoute(
  peopleAdminRouter,
  {
    method: 'put',
    path: '/me/avatar',
    summary: 'Set your profile photo from a completed upload',
    tags: ['Files'],
    access: { authenticated: true },
    request: { body: setAvatarSchema },
    responses: {
      200: {
        description: 'Updated',
        schema: successEnvelope(z.object({ avatarUrl: z.string().nullable() })),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await setOwnAvatar(getActor(req), req.valid.body.fileId), 'Profile photo updated');
  },
);
defineRoute(
  peopleAdminRouter,
  {
    method: 'delete',
    path: '/me/avatar',
    summary: 'Remove your profile photo',
    tags: ['Files'],
    access: { authenticated: true },
    responses: { 200: { description: 'Removed' } },
  },
  async (req, res) => {
    await removeOwnAvatar(getActor(req));
    sendOk(res, null, 'Profile photo removed');
  },
);
