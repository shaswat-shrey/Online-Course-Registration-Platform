import { z } from 'zod';

/*
 * Faculty workspace inputs (SRS FR-FACULTY-005..008): materials and section announcements.
 */

export const MATERIAL_KINDS = ['FILE', 'LINK'] as const;
export const ANNOUNCEMENT_PRIORITIES = ['NORMAL', 'IMPORTANT', 'URGENT'] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const httpsUrl = z
  .string()
  .trim()
  .max(1000)
  .pipe(z.url({ protocol: /^https?$/, message: 'Enter a valid http(s) link' }));

export const materialCreateSchema = z
  .object({
    title: z.string().trim().min(2, 'At least 2 characters').max(200),
    description: optional(2000),
    folder: optional(100),
    kind: z.enum(MATERIAL_KINDS),
    fileId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    url: httpsUrl.nullish().transform((v) => v ?? null),
    publish: z.boolean().default(false),
  })
  .refine(
    (v) =>
      v.kind === 'FILE' ? v.fileId !== null && v.url === null : v.url !== null && v.fileId === null,
    {
      path: ['url'],
      message: 'Attach a file or give a link, matching the material type',
    },
  );
export type MaterialInput = z.input<typeof materialCreateSchema>;

export const materialUpdateSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: optional(2000),
    folder: optional(100),
    url: httpsUrl,
    position: z.number().int().min(0).max(10_000),
    published: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

/** Announcement audiences (FR-COMM-008). ALL_* need no target; YEAR_OF_STUDY takes a year. */
export const AUDIENCE_TYPES = [
  'ALL_USERS',
  'ALL_STUDENTS',
  'ALL_FACULTY',
  'ALL_ADMINS',
  'USER',
  'SCHOOL',
  'DEPARTMENT',
  'PROGRAM',
  'SPECIALIZATION',
  'COURSE',
  'SECTION',
  'YEAR_OF_STUDY',
] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];
export const AUDIENCE_ROLES = ['ANY', 'STUDENT', 'FACULTY'] as const;
export type AudienceRole = (typeof AUDIENCE_ROLES)[number];
/** Audiences any holder of `announcement:publish_global` may use. */
export const GLOBAL_AUDIENCES: readonly AudienceType[] = [
  'ALL_USERS',
  'ALL_STUDENTS',
  'ALL_FACULTY',
  'ALL_ADMINS',
];

export const audienceSchema = z
  .object({
    type: z.enum(AUDIENCE_TYPES),
    targetId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    targetValue: z
      .number()
      .int()
      .min(1)
      .max(10)
      .nullish()
      .transform((v) => v ?? null),
    roleFilter: z.enum(AUDIENCE_ROLES).default('ANY'),
  })
  .superRefine((a, ctx) => {
    if (a.type.startsWith('ALL_')) {
      if (a.targetId || a.targetValue)
        ctx.addIssue({
          code: 'custom',
          path: ['targetId'],
          message: 'No target for this audience',
        });
    } else if (a.type === 'YEAR_OF_STUDY') {
      if (!a.targetValue)
        ctx.addIssue({ code: 'custom', path: ['targetValue'], message: 'Choose a year of study' });
    } else if (!a.targetId) {
      ctx.addIssue({ code: 'custom', path: ['targetId'], message: 'Choose who this is for' });
    } else if (a.targetValue) {
      ctx.addIssue({ code: 'custom', path: ['targetValue'], message: 'Not used here' });
    }
  });
export type AudienceInput = z.input<typeof audienceSchema>;

const isoDateTime = z.iso
  .datetime({ offset: true })
  .nullish()
  .transform((v) => v ?? null);

/**
 * Faculty pass `sectionIds` (their own sections); administrators pass `audiences`.
 * Either way the server receives a single audience list.
 */
export const announcementCreateSchema = z
  .object({
    title: z.string().trim().min(3, 'At least 3 characters').max(200),
    body: z.string().trim().min(1, 'Write a message').max(10_000),
    priority: z.enum(ANNOUNCEMENT_PRIORITIES).default('NORMAL'),
    pinned: z.boolean().default(false),
    sectionIds: z
      .array(z.uuid())
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'A section appears twice' })
      .default([]),
    audiences: z.array(audienceSchema).max(30).default([]),
    /** Future time schedules the announcement (FR-COMM-010); null publishes now. */
    publishAt: isoDateTime,
    expiresAt: isoDateTime,
  })
  .superRefine((v, ctx) => {
    if (!v.sectionIds.length && !v.audiences.length)
      ctx.addIssue({
        code: 'custom',
        path: ['sectionIds'],
        message: 'Choose at least one audience',
      });
    if (v.expiresAt && new Date(v.expiresAt) <= new Date())
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Expiry must be in the future',
      });
    if (v.expiresAt && v.publishAt && new Date(v.expiresAt) <= new Date(v.publishAt))
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Expiry must be after the publish time',
      });
  })
  .transform(({ sectionIds, audiences, ...rest }) => ({
    ...rest,
    audiences: [
      ...sectionIds.map((targetId) => ({
        type: 'SECTION' as const,
        targetId,
        targetValue: null,
        roleFilter: 'ANY' as const,
      })),
      ...audiences,
    ],
  }));
export type AnnouncementInput = z.input<typeof announcementCreateSchema>;

export const announcementUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(1).max(10_000),
    priority: z.enum(ANNOUNCEMENT_PRIORITIES),
    pinned: z.boolean(),
    /** Only while the announcement is still scheduled. */
    publishAt: z.iso.datetime({ offset: true }),
    expiresAt: isoDateTime,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
