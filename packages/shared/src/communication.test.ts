import { describe, expect, it } from 'vitest';
import {
  messageCreateSchema,
  preferencesUpdateSchema,
  ticketCreateSchema,
  ticketListQuerySchema,
} from './communication.js';
import { announcementCreateSchema, audienceSchema } from './teaching.js';

const id = '0196f000-0000-7000-8000-000000000001';

describe('communication schemas', () => {
  it('needs a body or an attachment for a message', () => {
    expect(messageCreateSchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(messageCreateSchema.parse({ fileIds: [id] })).toEqual({ body: '', fileIds: [id] });
    expect(messageCreateSchema.safeParse({ body: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('checks audience targets by type', () => {
    expect(audienceSchema.safeParse({ type: 'ALL_STUDENTS' }).success).toBe(true);
    expect(audienceSchema.safeParse({ type: 'ALL_STUDENTS', targetId: id }).success).toBe(false);
    expect(audienceSchema.safeParse({ type: 'DEPARTMENT' }).success).toBe(false);
    expect(audienceSchema.safeParse({ type: 'YEAR_OF_STUDY', targetValue: 2 }).success).toBe(true);
    expect(audienceSchema.safeParse({ type: 'YEAR_OF_STUDY', targetId: id }).success).toBe(false);
  });

  it('folds faculty section shorthand into audiences and orders publish/expiry', () => {
    const parsed = announcementCreateSchema.parse({ title: 'Quiz', body: 'Fri', sectionIds: [id] });
    expect(parsed.audiences).toEqual([
      { type: 'SECTION', targetId: id, targetValue: null, roleFilter: 'ANY' },
    ]);
    expect(announcementCreateSchema.safeParse({ title: 'Quiz', body: 'Fri' }).success).toBe(false);
    const soon = new Date(Date.now() + 3600_000).toISOString();
    const later = new Date(Date.now() + 7200_000).toISOString();
    expect(
      announcementCreateSchema.safeParse({
        title: 'Quiz',
        body: 'Fri',
        sectionIds: [id],
        publishAt: later,
        expiresAt: soon,
      }).success,
    ).toBe(false);
  });

  it('validates tickets and preferences', () => {
    expect(
      ticketCreateSchema.safeParse({ category: 'ACCOUNT', subject: 'Hi', description: 'short' })
        .success,
    ).toBe(false);
    expect(ticketListQuerySchema.parse({ status: 'ACTIVE' }).status).toBe('ACTIVE');
    expect(ticketListQuerySchema.safeParse({ status: 'BOGUS' }).success).toBe(false);
    expect(
      preferencesUpdateSchema.safeParse({
        preferences: [{ category: 'MESSAGE', channel: 'SMS', enabled: true }],
      }).success,
    ).toBe(false);
  });
});
