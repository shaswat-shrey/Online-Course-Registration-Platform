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

export const announcementCreateSchema = z
  .object({
    title: z.string().trim().min(3, 'At least 3 characters').max(200),
    body: z.string().trim().min(1, 'Write a message').max(10_000),
    priority: z.enum(ANNOUNCEMENT_PRIORITIES).default('NORMAL'),
    pinned: z.boolean().default(false),
    sectionIds: z
      .array(z.uuid())
      .min(1, 'Choose at least one section')
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'A section appears twice' }),
    expiresAt: z.iso
      .datetime({ offset: true })
      .nullish()
      .transform((v) => v ?? null),
  })
  .refine((v) => !v.expiresAt || new Date(v.expiresAt) > new Date(), {
    path: ['expiresAt'],
    message: 'Expiry must be in the future',
  });
export type AnnouncementInput = z.input<typeof announcementCreateSchema>;

export const announcementUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(1).max(10_000),
    priority: z.enum(ANNOUNCEMENT_PRIORITIES),
    pinned: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
