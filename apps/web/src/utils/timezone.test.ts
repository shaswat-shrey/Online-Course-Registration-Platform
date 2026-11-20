import { describe, expect, it } from 'vitest';
import { isoToZonedInput, tzOffsetMinutes, zonedInputToIso } from './timezone';

describe('time zone helpers', () => {
  it('converts between instants and IST wall-clock time', () => {
    expect(tzOffsetMinutes(new Date('2026-12-01T00:00:00Z'), 'Asia/Kolkata')).toBe(330);
    expect(zonedInputToIso('2026-12-01T09:00', 'Asia/Kolkata')).toBe('2026-12-01T03:30:00.000Z');
    expect(isoToZonedInput('2026-12-01T03:30:00.000Z', 'Asia/Kolkata')).toBe('2026-12-01T09:00');
  });

  it('handles daylight saving transitions', () => {
    // New York: EST (UTC-5) in January, EDT (UTC-4) in July.
    expect(zonedInputToIso('2027-01-15T09:00', 'America/New_York')).toBe(
      '2027-01-15T14:00:00.000Z',
    );
    expect(zonedInputToIso('2027-07-15T09:00', 'America/New_York')).toBe(
      '2027-07-15T13:00:00.000Z',
    );
    expect(isoToZonedInput('2027-07-15T13:00:00.000Z', 'America/New_York')).toBe(
      '2027-07-15T09:00',
    );
  });

  it('returns empty input for missing values', () => {
    expect(isoToZonedInput(null, 'UTC')).toBe('');
  });
});
