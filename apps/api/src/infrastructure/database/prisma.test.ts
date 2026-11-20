import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from './prisma.js';

afterAll(() => prisma.$disconnect());

describe('database time zone', () => {
  it('stores instants exactly, whatever the server time zone is', async () => {
    const when = new Date('2026-01-01T00:00:00.000Z');
    const [row] = await prisma.$queryRaw<Array<{ utc: string; tz: string }>>`
      SELECT to_char(${when}::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS utc,
             current_setting('TimeZone') AS tz`;
    expect(row).toEqual({ utc: '2026-01-01T00:00', tz: 'UTC' });
  });
});
