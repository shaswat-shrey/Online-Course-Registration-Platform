import { describe, expect, it } from 'vitest';
import {
  courseCreateSchema,
  meetingsOverlap,
  minutesToTime,
  prerequisitesSchema,
  restrictionsSchema,
  sectionInstructorsSchema,
  sectionMeetingsSchema,
  sectionTransitionSchema,
  timeToMinutes,
} from './courses.js';

const id = (n: number) => `0196f000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const course = {
  code: 'cs101',
  title: 'Programming Fundamentals',
  departmentId: id(1),
  credits: 4,
  level: 100,
  category: 'CORE',
};

describe('course schemas', () => {
  it('normalises the code and applies defaults', () => {
    const v = courseCreateSchema.parse(course);
    expect(v.code).toBe('CS101');
    expect(v).toMatchObject({
      status: 'DRAFT',
      isRepeatable: false,
      outcomes: [],
      coordinatorId: null,
    });
  });

  it('rejects assessment weights above 100% and min enrollment above capacity', () => {
    const r = courseCreateSchema.safeParse({
      ...course,
      defaultCapacity: 10,
      minEnrollment: 20,
      assessmentComponents: [
        { name: 'Exam', weight: 70 },
        { name: 'Project', weight: 40 },
      ],
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['assessmentComponents', 'minEnrollment']));
  });

  it('validates prerequisite groups and grade letters', () => {
    expect(
      prerequisitesSchema
        .parse({
          groups: [{ items: [{ courseId: id(2), minGradeLetter: 'b+' }, { courseId: id(3) }] }],
        })
        .groups[0]!.items.map((i) => i.minGradeLetter),
    ).toEqual(['B+', null]);
    expect(prerequisitesSchema.safeParse({ groups: [{ items: [] }] }).success).toBe(false);
    expect(
      prerequisitesSchema.safeParse({
        groups: [{ items: [{ courseId: id(2) }, { courseId: id(2) }] }],
      }).success,
    ).toBe(false);
  });

  it('requires a matching target per restriction type', () => {
    expect(
      restrictionsSchema.safeParse({
        restrictions: [{ mode: 'INCLUDE', targetType: 'YEAR_OF_STUDY', targetValue: 2 }],
      }).success,
    ).toBe(true);
    expect(
      restrictionsSchema.safeParse({
        restrictions: [{ mode: 'INCLUDE', targetType: 'PROGRAM', targetValue: 2 }],
      }).success,
    ).toBe(false);
  });
});

describe('section schemas', () => {
  it('treats back-to-back meetings as non-overlapping (BR-018)', () => {
    const a = { dayOfWeek: 1, startMinute: 540, endMinute: 600 };
    expect(meetingsOverlap(a, { dayOfWeek: 1, startMinute: 600, endMinute: 660 })).toBe(false);
    expect(meetingsOverlap(a, { dayOfWeek: 1, startMinute: 599, endMinute: 660 })).toBe(true);
    expect(meetingsOverlap(a, { dayOfWeek: 2, startMinute: 540, endMinute: 600 })).toBe(false);
  });

  it('rejects overlapping meetings within a section and inverted times', () => {
    expect(
      sectionMeetingsSchema.safeParse({
        meetings: [
          { dayOfWeek: 1, startMinute: 540, endMinute: 600 },
          { dayOfWeek: 1, startMinute: 570, endMinute: 630 },
        ],
      }).success,
    ).toBe(false);
    expect(
      sectionMeetingsSchema.safeParse({
        meetings: [{ dayOfWeek: 1, startMinute: 600, endMinute: 540 }],
      }).success,
    ).toBe(false);
  });

  it('allows at most one primary instructor', () => {
    expect(
      sectionInstructorsSchema.safeParse({
        instructors: [
          { facultyMemberId: id(1), role: 'PRIMARY' },
          { facultyMemberId: id(2), role: 'PRIMARY' },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires a reason to cancel', () => {
    expect(sectionTransitionSchema.safeParse({ action: 'cancel' }).success).toBe(false);
    expect(sectionTransitionSchema.safeParse({ action: 'publish' }).success).toBe(true);
  });

  it('converts between times and minutes', () => {
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('24:00')).toBe(1440);
    expect(timeToMinutes('25:00')).toBeNull();
    expect(minutesToTime(570)).toBe('09:30');
  });
});
