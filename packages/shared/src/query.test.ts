import { describe, expect, it } from 'vitest';
import { buildPaginationMeta, paginationQuerySchema, sortQuerySchema } from './query.js';

describe('paginationQuerySchema', () => {
  it('applies defaults and coerces strings', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationQuerySchema.parse({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50 });
  });

  it('rejects limits above the maximum', () => {
    expect(paginationQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('sortQuerySchema', () => {
  const schema = sortQuerySchema(['code', 'createdAt'] as const, 'code:asc');

  it('parses multiple allowed fields', () => {
    expect(schema.parse('code:asc,createdAt:desc')).toEqual([
      { field: 'code', direction: 'asc' },
      { field: 'createdAt', direction: 'desc' },
    ]);
  });

  it('uses the default when absent', () => {
    expect(schema.parse(undefined)).toEqual([{ field: 'code', direction: 'asc' }]);
  });

  it('rejects unknown fields and directions', () => {
    expect(schema.safeParse('password:asc').success).toBe(false);
    expect(schema.safeParse('code:sideways').success).toBe(false);
  });
});

describe('buildPaginationMeta', () => {
  it('computes total pages with a minimum of 1', () => {
    expect(buildPaginationMeta(1, 20, 0).totalPages).toBe(1);
    expect(buildPaginationMeta(1, 20, 41).totalPages).toBe(3);
  });
});
