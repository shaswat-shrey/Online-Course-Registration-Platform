import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/** `page` / `limit` query parameters (docs/API.md §4). */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const uuidSchema = z.uuid();
export const idParamSchema = z.object({ id: uuidSchema });

export type SortDirection = 'asc' | 'desc';
export interface SortField<F extends string = string> {
  field: F;
  direction: SortDirection;
}

/**
 * Builds a schema for `sort=field:asc,other:desc` restricted to an allow-list.
 * Unknown fields fail validation, so sort input is never interpolated.
 */
export function sortQuerySchema<const F extends readonly [string, ...string[]]>(
  allowed: F,
  defaultSort?: string,
) {
  const allowedSet = new Set<string>(allowed);
  return z
    .string()
    .max(200)
    .optional()
    .transform((raw, ctx): SortField<F[number]>[] => {
      const value = raw ?? defaultSort;
      if (!value) return [];
      const result: SortField<F[number]>[] = [];
      for (const part of value.split(',')) {
        const [field, dir = 'asc'] = part.trim().split(':');
        if (!field || !allowedSet.has(field) || (dir !== 'asc' && dir !== 'desc')) {
          ctx.addIssue({
            code: 'custom',
            message: `Invalid sort "${part}". Allowed fields: ${allowed.join(', ')}`,
          });
          return z.NEVER;
        }
        result.push({ field: field as F[number], direction: dir });
      }
      return result;
    });
}

export function buildPaginationMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
