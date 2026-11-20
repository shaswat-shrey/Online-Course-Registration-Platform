import { describe, expect, it } from 'vitest';
import { announcementCreateSchema, materialCreateSchema } from './teaching.js';

const id = '0196f000-0000-7000-8000-000000000001';

describe('teaching schemas', () => {
  it('requires a file for FILE materials and a link for LINK materials', () => {
    expect(
      materialCreateSchema.safeParse({ title: 'Week 1 slides', kind: 'FILE', fileId: id }).success,
    ).toBe(true);
    expect(
      materialCreateSchema.safeParse({
        title: 'Week 1 slides',
        kind: 'FILE',
        url: 'https://x.test',
      }).success,
    ).toBe(false);
    expect(
      materialCreateSchema.safeParse({ title: 'Reading', kind: 'LINK', url: 'javascript:alert(1)' })
        .success,
    ).toBe(false);
    expect(
      materialCreateSchema.parse({ title: 'Reading', kind: 'LINK', url: 'https://x.test/a' }),
    ).toMatchObject({ publish: false, folder: null });
  });

  it('needs at least one distinct section and a future expiry', () => {
    expect(
      announcementCreateSchema.safeParse({ title: 'Quiz', body: 'Friday', sectionIds: [] }).success,
    ).toBe(false);
    expect(
      announcementCreateSchema.safeParse({ title: 'Quiz', body: 'Friday', sectionIds: [id, id] })
        .success,
    ).toBe(false);
    expect(
      announcementCreateSchema.safeParse({
        title: 'Quiz',
        body: 'Friday',
        sectionIds: [id],
        expiresAt: '2000-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      announcementCreateSchema.parse({ title: 'Quiz', body: 'Friday', sectionIds: [id] }),
    ).toMatchObject({ priority: 'NORMAL', pinned: false });
  });
});
