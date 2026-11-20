import type { NextFunction, RequestHandler, Response, Router } from 'express';
import type { z } from 'zod';
import { errorEnvelopeSchema, registry } from '../../openapi/registry.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Route access declaration. Every route must state its access explicitly:
 * routes without one cannot be registered (default deny, SECURITY.md §7).
 * `authenticated` / `permission` are enforced from Phase 2.
 */
export type RouteAccess = { public: true } | { authenticated: true } | { permission: string };

type Infer<T> = T extends z.ZodType ? z.infer<T> : Record<string, never>;

/** Handler receiving input typed from the route's Zod schemas. */
export type TypedHandler<P, Q, B> = (
  req: ValidatedRequest<Infer<P>, Infer<Q>, Infer<B>>,
  res: Response,
  next: NextFunction,
) => unknown;

export interface RouteSpec<
  P extends z.ZodObject | undefined = undefined,
  Q extends z.ZodObject | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
> {
  method: Method;
  /** Express-style path relative to the router mount, e.g. "/courses/:id". */
  path: string;
  /** Mount prefix used for documentation, e.g. "" for /api/v1 itself. */
  docsPrefix?: string;
  summary: string;
  description?: string;
  tags: string[];
  access: RouteAccess;
  request?: {
    params?: P;
    query?: Q;
    body?: B;
  };
  responses: Record<number, { description: string; schema?: z.ZodType }>;
  /** Extra middleware run after validation (auth/permission guards are added in Phase 2). */
  middleware?: RequestHandler[];
  /** Exclude from OpenAPI (e.g. binary storage endpoints documented elsewhere). */
  hidden?: boolean;
}

/** Collected for the "every route is documented and declares access" test. */
export const routeManifest: Array<{
  method: Method;
  path: string;
  fullPath: string;
  access: RouteAccess;
  hidden?: boolean;
}> = [];

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function defineRoute<
  P extends z.ZodObject | undefined = undefined,
  Q extends z.ZodObject | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
>(router: Router, spec: RouteSpec<P, Q, B>, handler: TypedHandler<P, Q, B>): void {
  if (!spec.access)
    throw new Error(`Route ${spec.method.toUpperCase()} ${spec.path} has no access declaration`);
  const fullPath = `${spec.docsPrefix ?? ''}${spec.path}`;
  routeManifest.push({
    method: spec.method,
    path: spec.path,
    access: spec.access,
    hidden: spec.hidden,
    fullPath,
  });

  if (!spec.hidden) {
    const responses: Record<string, unknown> = {};
    for (const [status, r] of Object.entries(spec.responses)) {
      responses[status] = r.schema
        ? { description: r.description, content: { 'application/json': { schema: r.schema } } }
        : { description: r.description };
    }
    responses['default'] ??= {
      description: 'Error',
      content: { 'application/json': { schema: errorEnvelopeSchema } },
    };
    registry.registerPath({
      method: spec.method,
      path: toOpenApiPath(fullPath),
      summary: spec.summary,
      description: spec.description,
      tags: spec.tags,
      security: 'public' in spec.access ? [] : [{ bearerAuth: [] }],
      request: {
        params: spec.request?.params,
        query: spec.request?.query,
        body: spec.request?.body
          ? { content: { 'application/json': { schema: spec.request.body } } }
          : undefined,
      },
      responses: responses as never,
    });
  }

  const chain: RequestHandler[] = [];
  if (spec.request) {
    chain.push(
      validate({ params: spec.request.params, query: spec.request.query, body: spec.request.body }),
    );
  }
  if (spec.middleware) chain.push(...spec.middleware);
  router[spec.method](spec.path, ...chain, handler as unknown as RequestHandler);
}
