import { Router } from 'express';
import { z } from 'zod';
import { PERMISSION_KEYS } from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { successEnvelope } from '../../openapi/registry.js';
import { loginAttemptSchema, sessionSchema } from '../auth/auth.schemas.js';
import { assertGlobal } from '../authz/authz.js';
import {
  assignRole,
  createRole,
  deleteRole,
  getRole,
  listPermissions,
  listRoles,
  listUserRoles,
  revokeRole,
  setRolePermissions,
  updateRole,
} from './rbac.service.js';
import {
  adminListSessions,
  adminLoginHistory,
  adminRevokeSessions,
  adminUnlockUser,
} from './user-security.service.js';

export const rbacRouter = Router();
const tags = ['Roles & Permissions'];
const idParams = z.object({ id: z.uuid() });

const permissionSchema = z
  .object({ key: z.string(), resource: z.string(), action: z.string(), description: z.string() })
  .meta({ id: 'Permission' });
const roleSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    scopeMode: z.enum(['ORGANIZATIONAL', 'RELATIONSHIP']),
    permissions: z.array(z.string()),
    assignmentCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'Role' });
const assignmentSchema = z
  .object({
    id: z.uuid(),
    roleId: z.uuid(),
    roleKey: z.string(),
    roleName: z.string(),
    scopeType: z.enum(['GLOBAL', 'SCHOOL', 'DEPARTMENT']),
    scopeId: z.uuid().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'RoleAssignment' });

const permissionKeys = z
  .array(z.enum(PERMISSION_KEYS as [string, ...string[]]))
  .max(PERMISSION_KEYS.length);
const roleKey = z
  .string()
  .trim()
  .regex(
    /^[A-Z][A-Z0-9_]{2,49}$/,
    'Use 3–50 upper-case letters, digits or underscores, starting with a letter',
  );

defineRoute(
  rbacRouter,
  {
    method: 'get',
    path: '/permissions',
    summary: 'Permission catalogue',
    tags,
    access: { permission: 'rbac:read' },
    responses: {
      200: { description: 'Permissions', schema: successEnvelope(z.array(permissionSchema)) },
    },
  },
  async (req, res) => {
    sendOk(res, await listPermissions(getActor(req)), 'Permissions retrieved');
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'get',
    path: '/roles',
    summary: 'Roles with their permissions and assignment counts',
    tags,
    access: { permission: 'rbac:read' },
    responses: { 200: { description: 'Roles', schema: successEnvelope(z.array(roleSchema)) } },
  },
  async (req, res) => {
    sendOk(res, await listRoles(getActor(req)), 'Roles retrieved');
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'get',
    path: '/roles/:id',
    summary: 'Get a role',
    tags,
    access: { permission: 'rbac:read' },
    request: { params: idParams },
    responses: { 200: { description: 'Role', schema: successEnvelope(roleSchema) } },
  },
  async (req, res) => {
    sendOk(res, await getRole(getActor(req), req.valid.params.id), 'Role retrieved');
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'post',
    path: '/roles',
    summary: 'Create a custom role',
    tags,
    access: { permission: 'rbac:manage' },
    request: {
      body: z.object({
        key: roleKey,
        name: z.string().trim().min(2).max(100),
        description: z.string().trim().max(500).nullish(),
        permissions: permissionKeys,
      }),
    },
    responses: { 201: { description: 'Created', schema: successEnvelope(roleSchema) } },
  },
  async (req, res) => {
    sendCreated(res, await createRole(getActor(req), req.valid.body), 'Role created');
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'patch',
    path: '/roles/:id',
    summary: 'Rename or describe a role',
    tags,
    access: { permission: 'rbac:manage' },
    request: {
      params: idParams,
      body: z.object({
        name: z.string().trim().min(2).max(100).optional(),
        description: z.string().trim().max(500).nullish(),
      }),
    },
    responses: { 200: { description: 'Updated', schema: successEnvelope(roleSchema) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await updateRole(getActor(req), req.valid.params.id, req.valid.body),
      'Role updated',
    );
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'put',
    path: '/roles/:id/permissions',
    summary: "Replace a role's permissions",
    description: 'Holders of the role must refresh their access token to pick up the change.',
    tags,
    access: { permission: 'rbac:manage' },
    request: { params: idParams, body: z.object({ permissions: permissionKeys }) },
    responses: { 200: { description: 'Updated', schema: successEnvelope(roleSchema) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await setRolePermissions(getActor(req), req.valid.params.id, req.valid.body.permissions),
      'Role permissions updated',
    );
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'delete',
    path: '/roles/:id',
    summary: 'Delete an unassigned custom role',
    tags,
    access: { permission: 'rbac:manage' },
    request: { params: idParams },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await deleteRole(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Role deleted');
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'get',
    path: '/users/:id/roles',
    summary: "A user's role assignments",
    tags,
    access: { permission: 'user:read' },
    request: { params: idParams },
    responses: {
      200: { description: 'Assignments', schema: successEnvelope(z.array(assignmentSchema)) },
    },
  },
  async (req, res) => {
    assertGlobal(getActor(req), 'user:read');
    sendOk(res, await listUserRoles(req.valid.params.id), 'Role assignments retrieved');
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'post',
    path: '/users/:id/roles',
    summary: 'Assign a role to a user at a scope',
    description:
      'You can only assign roles whose permissions you hold at the target scope, and only within your own user:assign_roles scope.',
    tags,
    access: { permission: 'user:assign_roles' },
    request: {
      params: idParams,
      body: z.discriminatedUnion('scopeType', [
        z.object({
          roleId: z.uuid(),
          scopeType: z.literal('GLOBAL'),
          scopeId: z.null().optional(),
        }),
        z.object({
          roleId: z.uuid(),
          scopeType: z.enum(['SCHOOL', 'DEPARTMENT']),
          scopeId: z.uuid(),
        }),
      ]),
    },
    responses: {
      201: { description: 'Assigned', schema: successEnvelope(z.object({ id: z.uuid() })) },
    },
  },
  async (req, res) => {
    sendCreated(
      res,
      await assignRole(getActor(req), req.valid.params.id, req.valid.body),
      'Role assigned',
    );
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'delete',
    path: '/users/:id/roles/:assignmentId',
    summary: 'Revoke a role assignment',
    tags,
    access: { permission: 'user:assign_roles' },
    request: { params: z.object({ id: z.uuid(), assignmentId: z.uuid() }) },
    responses: { 200: { description: 'Revoked' } },
  },
  async (req, res) => {
    await revokeRole(getActor(req), req.valid.params.id, req.valid.params.assignmentId);
    sendOk(res, null, 'Role revoked');
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'get',
    path: '/users/:id/sessions',
    summary: "A user's active sessions",
    tags: ['Account security'],
    access: { permission: 'user:read_sessions' },
    request: { params: idParams },
    responses: {
      200: { description: 'Sessions', schema: successEnvelope(z.array(sessionSchema)) },
    },
  },
  async (req, res) => {
    sendOk(res, await adminListSessions(getActor(req), req.valid.params.id), 'Sessions retrieved');
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'delete',
    path: '/users/:id/sessions',
    summary: "Revoke all of a user's sessions",
    tags: ['Account security'],
    access: { permission: 'user:revoke_sessions' },
    request: { params: idParams },
    responses: {
      200: {
        description: 'Revoked',
        schema: successEnvelope(z.object({ sessionsRevoked: z.number() })),
      },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      { sessionsRevoked: await adminRevokeSessions(getActor(req), req.valid.params.id) },
      'Sessions revoked',
    );
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'get',
    path: '/users/:id/login-history',
    summary: "A user's recent sign-in attempts",
    tags: ['Account security'],
    access: { permission: 'user:read_sessions' },
    request: { params: idParams },
    responses: {
      200: { description: 'Login history', schema: successEnvelope(z.array(loginAttemptSchema)) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await adminLoginHistory(getActor(req), req.valid.params.id),
      'Login history retrieved',
    );
  },
);

defineRoute(
  rbacRouter,
  {
    method: 'post',
    path: '/users/:id/unlock',
    summary: 'Clear a lockout caused by failed sign-in attempts',
    tags: ['Account security'],
    access: { permission: 'user:manage_status' },
    request: { params: idParams },
    responses: { 200: { description: 'Unlocked' } },
  },
  async (req, res) => {
    await adminUnlockUser(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Account unlocked');
  },
);
