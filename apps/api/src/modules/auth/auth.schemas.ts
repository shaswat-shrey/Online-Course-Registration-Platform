import { z } from 'zod';

const roleAssignment = z.object({
  id: z.uuid(),
  roleKey: z.string(),
  roleName: z.string(),
  scopeType: z.enum(['GLOBAL', 'SCHOOL', 'DEPARTMENT']),
  scopeId: z.uuid().nullable(),
  scopeMode: z.enum(['ORGANIZATIONAL', 'RELATIONSHIP']),
});

export const meSchema = z
  .object({
    user: z.object({
      id: z.uuid(),
      email: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      status: z.string(),
      lastLoginAt: z.string().nullable(),
    }),
    roles: z.array(roleAssignment),
    permissions: z.array(z.string()),
    grants: z.record(
      z.string(),
      z.array(
        z.object({
          scope: z.enum(['GLOBAL', 'SCHOOL', 'DEPARTMENT', 'OWN']),
          id: z.uuid().optional(),
        }),
      ),
    ),
    portals: z.array(z.enum(['admin', 'faculty', 'student'])),
    sessionId: z.uuid(),
  })
  .meta({ id: 'Me' });

export const accessTokenSchema = z
  .object({ accessToken: z.string(), accessTokenExpiresAt: z.string() })
  .meta({ id: 'AccessToken' });

export const loginResultSchema = accessTokenSchema
  .extend({ me: meSchema })
  .meta({ id: 'LoginResult' });

export const sessionSchema = z
  .object({
    id: z.uuid(),
    deviceLabel: z.string().nullable(),
    ip: z.string().nullable(),
    createdAt: z.string(),
    lastSeenAt: z.string(),
    expiresAt: z.string(),
    current: z.boolean(),
  })
  .meta({ id: 'Session' });

export const loginAttemptSchema = z
  .object({
    id: z.string(),
    outcome: z.string(),
    ip: z.string().nullable(),
    deviceLabel: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'LoginAttempt' });
