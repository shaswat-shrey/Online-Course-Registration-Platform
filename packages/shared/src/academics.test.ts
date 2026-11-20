import { describe, expect, it } from 'vitest';
import {
  assessmentScoresSchema,
  attendanceSessionCreateSchema,
  finalGradesSchema,
  letterFor,
  weightedPercent,
} from './academics.js';

const id = '0196f000-0000-7000-8000-000000000001';

describe('academic helpers', () => {
  it('weights scores, rescales around excused components and counts missing as zero', () => {
    expect(
      weightedPercent([
        { weight: 40, maxScore: 50, score: 40, excused: false },
        { weight: 60, maxScore: 100, score: 90, excused: false },
      ]),
    ).toBe(86);
    expect(
      weightedPercent([
        { weight: 40, maxScore: 50, score: 40, excused: false },
        { weight: 60, maxScore: 100, score: null, excused: true },
      ]),
    ).toBe(80);
    expect(weightedPercent([{ weight: 50, maxScore: 10, score: null, excused: false }])).toBe(0);
    expect(weightedPercent([{ weight: 50, maxScore: 10, score: null, excused: true }])).toBeNull();
  });

  it('finds the band for a percentage', () => {
    const bands = [
      { letter: 'A', minPercent: 90 },
      { letter: 'B', minPercent: 75 },
      { letter: 'F', minPercent: 0 },
    ];
    expect(letterFor(bands, 89.99)?.letter).toBe('B');
    expect(letterFor(bands, 90)?.letter).toBe('A');
    expect(letterFor(bands, 3)?.letter).toBe('F');
  });

  it('validates inputs', () => {
    expect(attendanceSessionCreateSchema.safeParse({ date: '2026-11-31' }).success).toBe(false);
    expect(
      assessmentScoresSchema.safeParse({
        scores: [{ studentId: id, score: 5, excused: true }],
      }).success,
    ).toBe(false);
    expect(
      finalGradesSchema.parse({ grades: [{ registrationId: id, gradeLetter: ' b+ ' }] }).grades[0]
        ?.gradeLetter,
    ).toBe('B+');
  });
});
