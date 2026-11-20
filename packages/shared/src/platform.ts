import { z } from 'zod';

/*
 * Platform administration inputs: typed system settings, global search and the
 * administrative document library.
 */

// ----- system settings ---------------------------------------------------------------

/** Every runtime setting, its schema and default. Unknown keys are rejected. */
export const SETTINGS = {
  'messaging.studentsContactAnyFaculty': {
    schema: z.boolean(),
    default: false,
    label: 'Students may message any faculty member',
    description:
      'Off: students can message only the instructors of their current sections (FR-COMM-002).',
  },
  'notifications.retentionDays': {
    schema: z.number().int().min(30).max(3650),
    default: 180,
    label: 'Keep notifications for (days)',
    description: 'Older notifications are removed by the daily clean-up job (FR-NOTIF-003).',
  },
  'portal.bannerMessage': {
    schema: z.string().trim().max(300).nullable(),
    default: null as string | null,
    label: 'Banner shown to every signed-in user',
    description: 'For maintenance windows or important notices. Leave empty to hide it.',
  },
} as const;
export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
/** Settings any signed-in user may read (the rest need settings:manage). */
export const PUBLIC_SETTINGS: SettingKey[] = ['portal.bannerMessage'];

export const settingUpdateSchema = z.object({ value: z.unknown() });

// ----- global search (FR-SRCH-001/002) ---------------------------------------------------

export const SEARCH_TYPES = [
  'course',
  'department',
  'program',
  'specialization',
  'faculty',
  'student',
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'At least 2 characters').max(100),
  types: z
    .string()
    .max(200)
    .optional()
    .transform((v, ctx) => {
      if (!v) return [...SEARCH_TYPES];
      const list = v.split(',').map((t) => t.trim());
      const bad = list.filter((t) => !(SEARCH_TYPES as readonly string[]).includes(t));
      if (bad.length) {
        ctx.addIssue({ code: 'custom', message: `Unknown type: ${bad.join(', ')}` });
        return z.NEVER;
      }
      return list as SearchType[];
    }),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

// ----- documents --------------------------------------------------------------------------

export const DOCUMENT_VISIBILITIES = ['ALL_USERS', 'STUDENTS', 'FACULTY', 'ADMINS'] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

export const documentCreateSchema = z.object({
  title: z.string().trim().min(3, 'At least 3 characters').max(200),
  description: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => v || null),
  category: z.string().trim().min(2).max(60),
  visibility: z.enum(DOCUMENT_VISIBILITIES).default('ALL_USERS'),
  departmentId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  fileId: z.uuid(),
});
export type DocumentInput = z.input<typeof documentCreateSchema>;

export const documentListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  manage: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
