import type {
  CasePriority,
  ConversationType,
  FeedbackCategory,
  FeedbackStatus,
  NotificationCategory,
  NotificationChannel,
  ThreadType,
  TicketCategory,
  TicketStatus,
} from '@ucrams/shared';

export type { Announcement } from '@/features/teaching/api/types';

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string;
  subtitle: string | null;
  section: { id: string; label: string } | null;
  announcementOnly: boolean;
  muted: boolean;
  member: boolean;
  unread: number;
  canPost: boolean;
  canModerate: boolean;
  lastMessage: { preview: string; sender: string; createdAt: string } | null;
  lastMessageAt: string | null;
  participants: Array<{ userId: string; name: string; role: string }>;
}

export interface FileRef {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: { id: string; name: string };
  body: string | null;
  deleted: boolean;
  editedAt: string | null;
  createdAt: string;
  mine: boolean;
  canEdit: boolean;
  canDelete: boolean;
  attachments: FileRef[];
}
export type MessageHit = Message & { conversationTitle: string };

export interface Contact {
  userId: string;
  name: string;
  email: string;
  kind: 'STUDENT' | 'FACULTY' | 'ADMIN';
}

export interface Board {
  id: string;
  label: string;
  title: string;
  session: string;
  current: boolean;
  threads: number;
}

export interface Thread {
  id: string;
  sectionId: string;
  type: ThreadType;
  title: string;
  body: string | null;
  deleted: boolean;
  pinned: boolean;
  locked: boolean;
  answered: boolean;
  answerPostId: string | null;
  replyCount: number;
  author: { id: string; name: string };
  mine: boolean;
  canEdit: boolean;
  canDelete: boolean;
  lastActivityAt: string;
  editedAt: string | null;
  createdAt: string;
}
export interface Post {
  id: string;
  body: string | null;
  deleted: boolean;
  isAnswer: boolean;
  author: { id: string; name: string };
  mine: boolean;
  canDelete: boolean;
  editedAt: string | null;
  createdAt: string;
}
export type ThreadDetail = Thread & { canModerate: boolean; canReply: boolean; posts: Post[] };
export interface ThreadList {
  section: { id: string; label: string; title: string };
  canModerate: boolean;
  items: Thread[];
}

export interface PreferenceRow {
  category: NotificationCategory;
  channels: Array<{ channel: NotificationChannel; enabled: boolean; mandatory: boolean }>;
}

export interface Feedback {
  id: string;
  category: FeedbackCategory;
  subject: string;
  description: string;
  priority: CasePriority;
  status: FeedbackStatus;
  anonymous: boolean;
  submittedBy: { id: string; name: string } | null;
  mine: boolean;
  department: { id: string; code: string; name: string } | null;
  course: { id: string; code: string; title: string } | null;
  assignee: { id: string; name: string } | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  responseCount: number;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}
export type FeedbackDetail = Feedback & {
  responses: Array<{
    id: string;
    body: string;
    author: string;
    fromSubmitter: boolean;
    createdAt: string;
  }>;
};

export interface Ticket {
  id: string;
  ticketNumber: string;
  category: TicketCategory;
  priority: CasePriority;
  subject: string;
  description: string;
  status: TicketStatus;
  owner: { id: string; name: string; email: string };
  mine: boolean;
  department: { id: string; code: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  resolvedAt: string | null;
  closedAt: string | null;
  reopenUntil: string | null;
  canManage: boolean;
  canReopen: boolean;
  canReply: boolean;
  lastActivityAt: string;
  createdAt: string;
}
export type TicketDetail = Ticket & {
  attachments: FileRef[];
  responses: Array<{
    id: string;
    body: string;
    internal: boolean;
    author: string;
    fromOwner: boolean;
    attachments: FileRef[];
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    type: string;
    fromValue: string | null;
    toValue: string | null;
    actor: string;
    createdAt: string;
  }>;
};

export interface Assignee {
  userId: string;
  name: string;
  email: string;
}

export const FEEDBACK_CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  ACADEMIC: 'Academic',
  COURSE: 'Course',
  FACULTY: 'Faculty',
  REGISTRATION: 'Registration',
  FACILITIES: 'Facilities',
  TECHNICAL: 'Technical',
  ADMINISTRATIVE: 'Administrative',
  OTHER: 'Other',
};
export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> = {
  REGISTRATION: 'Course registration',
  ACADEMIC: 'Academic',
  FACULTY: 'Faculty',
  TECHNICAL: 'Technical',
  ACCOUNT: 'Account',
  DEPARTMENT: 'Department',
  OTHER: 'Other',
};
export const PRIORITY_LABEL: Record<CasePriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  OPEN: 'Open',
  UNDER_REVIEW: 'Under review',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_USER: 'Waiting on you',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
export const CATEGORY_NOTIFICATION_LABEL: Record<NotificationCategory, string> = {
  REGISTRATION: 'Registration',
  WAITLIST: 'Waitlist offers',
  ANNOUNCEMENT: 'Announcements',
  MESSAGE: 'Messages and discussions',
  TICKET: 'Support tickets',
  FEEDBACK: 'Feedback',
  SCHEDULE: 'Schedule changes',
  GRADES: 'Grades and results',
  SYSTEM: 'System notices',
};
