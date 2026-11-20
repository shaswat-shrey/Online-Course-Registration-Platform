import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { env } from '../config/env.js';

/** Single registry; every route is added through defineRoute() so docs cannot drift. */
export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

export const errorEnvelopeSchema = z
  .object({
    success: z.literal(false),
    message: z.string(),
    error: z.object({
      code: z.string().meta({ example: 'VALIDATION_ERROR' }),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  })
  .meta({ id: 'ErrorResponse' });

export function successEnvelope<T extends z.ZodType>(data: T) {
  return z.object({
    success: z.literal(true),
    message: z.string(),
    data,
  });
}

export function paginatedEnvelope<T extends z.ZodType>(item: T) {
  return z.object({
    success: z.literal(true),
    message: z.string(),
    data: z.array(item),
    meta: z.object({
      page: z.number().int(),
      limit: z.number().int(),
      total: z.number().int(),
      totalPages: z.number().int(),
    }),
  });
}

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'UCRAMS API',
      version: env.APP_VERSION,
      description:
        'University Course Registration & Academic Management System REST API. Conventions: docs/API.md',
    },
    servers: [{ url: '/api/v1' }],
  });
}
