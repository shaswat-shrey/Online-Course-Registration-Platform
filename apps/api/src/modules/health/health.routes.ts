import { Router } from 'express';
import { z } from 'zod';
import type { ApiSuccess, HealthStatus } from '@ucrams/shared';
import { defineRoute } from '../../common/http/define-route.js';
import { successEnvelope } from '../../openapi/registry.js';
import { getLiveness, getReadiness } from './health.service.js';

const checkSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
});
const healthSchema = z
  .object({
    status: z.enum(['ok', 'degraded', 'down']),
    checks: z.record(z.string(), checkSchema),
    uptimeSeconds: z.number(),
    version: z.string(),
  })
  .meta({ id: 'HealthStatus' });

export const healthRouter = Router();

defineRoute(
  healthRouter,
  {
    method: 'get',
    path: '/health/live',
    summary: 'Liveness probe',
    tags: ['Health'],
    access: { public: true },
    responses: { 200: { description: 'Process is up', schema: successEnvelope(healthSchema) } },
  },
  (_req, res) => {
    res.json({
      success: true,
      message: 'Alive',
      data: getLiveness(),
    } satisfies ApiSuccess<HealthStatus>);
  },
);

defineRoute(
  healthRouter,
  {
    method: 'get',
    path: '/health/ready',
    summary: 'Readiness probe (database, Redis, storage)',
    tags: ['Health'],
    access: { public: true },
    responses: {
      200: { description: 'Ready (ok or degraded)', schema: successEnvelope(healthSchema) },
      503: { description: 'Not ready', schema: successEnvelope(healthSchema) },
    },
  },
  async (_req, res) => {
    const status = await getReadiness();
    // A 503 still uses the success envelope shape so probes can read the checks.
    res.status(status.status === 'down' ? 503 : 200).json({
      success: status.status !== 'down',
      message: `Status: ${status.status}`,
      data: status,
    });
  },
);
