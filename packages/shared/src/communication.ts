import { z } from 'zod';
import { paginationQuerySchema } from './query.js';

/*
 * Communication inputs (SRS FR-COMM-001..014, FR-NOTIF-004): messaging,
 * discussions, notification preferences, feedback and support tickets.
 */

const text = (min: number, max: number, message = 'Write something') =>
  z.string().trim().min(min, message).max(max);
const optionalId = z
  .uuid()
  .nullish()
  .transform((v) => v ?? null);
const fileIds = z
  .array(z.uuid())
  .max(5, 'At most 5 attachments')
  .refine((ids) => new Set(ids).size === ids.length, { message: 'A file appears twice' })
  .default([]);

// ----- messaging ---------------------------------------------------------------

export const CONVERSATION_TYPES = ['DIRECT', 'SECTION', 'SUPPORT'] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];
/** Messages can be edited for this long after sending (FR-COMM-004). */
export const MESSAGE_EDIT_WINDOW_MINUTES = 15;
export const MESSAGE_MAX_LENGTH = 4000;

export const messageCreateSchema = z
  .object({
    body: z.string().trim().max(MESSAGE_MAX_LENGTH).default(''),
    fileIds,
  })
  .refine((v) => v.body.length > 0 || v.fileIds.length > 0, {
    path: ['body'],
    message: 'Write a message or attach a file',
  });
export type MessageInput = z.input<typeof messageCreateSchema>;

export const messageUpdateSchema = z.object({ body: text(1, MESSAGE_MAX_LENGTH) });

/** Start (or reopen) a direct conversation and send its first message. */
export const directConversationSchema = z.object({
  userId: z.uuid(),
  body: text(1, MESSAGE_MAX_LENGTH, 'Write a message'),
});
export type DirectConversationInput = z.input<typeof directConversationSchema>;

export const conversationSettingsSchema = z
  .object({ muted: z.boolean(), announcementOnly: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one setting');

export const conversationListQuerySchema = z.object({
  /** `support` lists the support inbox (administrators). */
  box: z.enum(['mine', 'support']).default('mine'),
});

export const messageListQuerySchema = z.object({
  /** Messages strictly older than this message id (keyset pagination). */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const messageSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'At least 2 characters').max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const contactSearchQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
});

// ----- discussions ---------------------------------------------------------------

export const THREAD_TYPES = ['QUESTION', 'DISCUSSION'] as const;
export type ThreadType = (typeof THREAD_TYPES)[number];

export const threadCreateSchema = z.object({
  type: z.enum(THREAD_TYPES).default('DISCUSSION'),
  title: text(3, 200, 'At least 3 characters'),
  body: text(1, 10_000),
});
export type ThreadInput = z.input<typeof threadCreateSchema>;

export const threadUpdateSchema = z
  .object({
    title: text(3, 200),
    body: text(1, 10_000),
    /** Moderators only. */
    pinned: z.boolean(),
    locked: z.boolean(),
    /** Moderators only: the accepted answer of a question (null clears it). */
    answerPostId: z.uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const postCreateSchema = z.object({ body: text(1, 10_000) });

// ----- notification preferences ---------------------------------------------------

export const NOTIFICATION_CATEGORIES = [
  'REGISTRATION',
  'WAITLIST',
  'ANNOUNCEMENT',
  'MESSAGE',
  'TICKET',
  'FEEDBACK',
  'SCHEDULE',
  'GRADES',
  'SYSTEM',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Defaults when a user has not chosen (FR-NOTIF-004). */
export const DEFAULT_CHANNELS: Record<
  NotificationCategory,
  Record<NotificationChannel, boolean>
> = {
  REGISTRATION: { IN_APP: true, EMAIL: true },
  WAITLIST: { IN_APP: true, EMAIL: true },
  ANNOUNCEMENT: { IN_APP: true, EMAIL: false },
  MESSAGE: { IN_APP: true, EMAIL: false },
  TICKET: { IN_APP: true, EMAIL: true },
  FEEDBACK: { IN_APP: true, EMAIL: true },
  SCHEDULE: { IN_APP: true, EMAIL: false },
  GRADES: { IN_APP: true, EMAIL: true },
  SYSTEM: { IN_APP: true, EMAIL: false },
};

/**
 * Channels users cannot switch off: registration outcomes (including cancellations)
 * and waitlist seat offers are time-critical, system notices are always shown.
 */
export const MANDATORY_CHANNELS: Partial<Record<NotificationCategory, NotificationChannel[]>> = {
  REGISTRATION: ['IN_APP', 'EMAIL'],
  WAITLIST: ['IN_APP', 'EMAIL'],
  SYSTEM: ['IN_APP'],
};

export const preferencesUpdateSchema = z.object({
  preferences: z
    .array(
      z.object({
        category: z.enum(NOTIFICATION_CATEGORIES),
        channel: z.enum(NOTIFICATION_CHANNELS),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(NOTIFICATION_CATEGORIES.length * NOTIFICATION_CHANNELS.length),
});

// ----- feedback & tickets -------------------------------------------------------------

export const CASE_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const FEEDBACK_CATEGORIES = [
  'ACADEMIC',
  'COURSE',
  'FACULTY',
  'REGISTRATION',
  'FACILITIES',
  'TECHNICAL',
  'ADMINISTRATIVE',
  'OTHER',
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export const FEEDBACK_STATUSES = [
  'OPEN',
  'UNDER_REVIEW',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const feedbackCreateSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  subject: text(3, 200, 'At least 3 characters'),
  description: text(10, 5000, 'At least 10 characters'),
  departmentId: optionalId,
  courseId: optionalId,
  priority: z.enum(CASE_PRIORITIES).default('MEDIUM'),
  anonymous: z.boolean().default(false),
});
export type FeedbackInput = z.input<typeof feedbackCreateSchema>;

export const feedbackUpdateSchema = z
  .object({
    status: z.enum(FEEDBACK_STATUSES),
    priority: z.enum(CASE_PRIORITIES),
    assigneeId: z.uuid().nullable(),
    resolutionNote: z.string().trim().max(5000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const feedbackListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  category: z.enum(FEEDBACK_CATEGORIES).optional(),
  assignedToMe: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const TICKET_CATEGORIES = [
  'REGISTRATION',
  'ACADEMIC',
  'FACULTY',
  'TECHNICAL',
  'ACCOUNT',
  'DEPARTMENT',
  'OTHER',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_ON_USER',
  'RESOLVED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
/** Owners can reopen a resolved ticket for this long; after it the ticket closes (FR-COMM-014). */
export const TICKET_REOPEN_DAYS = 7;

export const ticketCreateSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  subject: text(3, 200, 'At least 3 characters'),
  description: text(10, 5000, 'At least 10 characters'),
  priority: z.enum(CASE_PRIORITIES).default('MEDIUM'),
  fileIds,
});
export type TicketInput = z.input<typeof ticketCreateSchema>;

export const ticketReplySchema = z.object({
  body: text(1, 5000),
  /** Staff only: a note the owner never sees. */
  internal: z.boolean().default(false),
  /** Staff only: change the status in the same step. */
  status: z.enum(TICKET_STATUSES).optional(),
  fileIds,
});
export type TicketReplyInput = z.input<typeof ticketReplySchema>;

export const ticketUpdateSchema = z
  .object({
    status: z.enum(TICKET_STATUSES),
    priority: z.enum(CASE_PRIORITIES),
    assigneeId: z.uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');

export const ticketListQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum([...TICKET_STATUSES, 'ACTIVE'] as [string, ...string[]])
    .optional()
    .transform((v) => v as TicketStatus | 'ACTIVE' | undefined),
  category: z.enum(TICKET_CATEGORIES).optional(),
  assignedToMe: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().max(100).optional(),
});
