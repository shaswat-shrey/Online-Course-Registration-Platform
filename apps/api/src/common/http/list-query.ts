import { z } from 'zod';
import {
  ENTITY_STATUSES,
  paginationQuerySchema,
  sortQuerySchema,
  type SortField,
} from '@ucrams/shared';

/** Standard list query: page, limit, q (search) and allow-listed sort (docs/API.md §4). */
export function listQuery<const F extends readonly [string, ...string[]]>(
  sortFields: F,
  defaultSort: string,
) {
  return paginationQuerySchema.extend({
    q: z.string().trim().max(100).optional(),
    sort: sortQuerySchema(sortFields, defaultSort),
  });
}

export const statusFilter = z.enum(ENTITY_STATUSES).optional();

export function toOrderBy<F extends string>(sort: SortField<F>[]) {
  return sort.map((s) => ({ [s.field]: s.direction })) as Array<Record<F, 'asc' | 'desc'>>;
}

/** Case-insensitive contains search over the given text fields. */
export function searchWhere(q: string | undefined, fields: string[]) {
  if (!q) return {};
  return { OR: fields.map((f) => ({ [f]: { contains: q, mode: 'insensitive' as const } })) };
}

export function paging(q: { page: number; limit: number }) {
  return { skip: (q.page - 1) * q.limit, take: q.limit };
}

/** Prisma Decimal (or null) → JSON number. */
export function num(value: { toNumber(): number } | null | undefined): number | null {
  return value === null || value === undefined ? null : value.toNumber();
}

export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
