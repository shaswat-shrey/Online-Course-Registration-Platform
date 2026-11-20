import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';
import type { FieldError } from '@ucrams/shared';
import { ValidationError } from '../exceptions/app-error.js';

interface Schemas {
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
}

export interface Validated<P = unknown, Q = unknown, B = unknown> {
  params: P;
  query: Q;
  body: B;
}

/** A request whose input has been validated; produced by validate(). */
export type ValidatedRequest<P = unknown, Q = unknown, B = unknown> = Request & {
  valid: Validated<P, Q, B>;
};

export function toFieldErrors(location: string, error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: [location, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}

/**
 * Validates params, query and body with Zod. Unknown keys are stripped by
 * z.object() defaults, so mass-assignment of unexpected fields is impossible.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    const fields: FieldError[] = [];
    const valid: Validated = { params: {}, query: {}, body: {} };
    for (const location of ['params', 'query', 'body'] as const) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location] ?? {});
      if (result.success) valid[location] = result.data;
      else fields.push(...toFieldErrors(location, result.error));
    }
    if (fields.length > 0) return next(new ValidationError({ fields }));
    (req as ValidatedRequest).valid = valid;
    next();
  };
}
