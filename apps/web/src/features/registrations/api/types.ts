import type { StatusTone } from '@/components/shared/status-badge';

export type RegistrationStatus =
  | 'PENDING'
  | 'REGISTERED'
  | 'WAITLISTED'
  | 'OFFERED'
  | 'DROPPED'
  | 'WITHDRAWN'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'COMPLETED';

export interface Registration {
  id: string;
  status: RegistrationStatus;
  credits: number;
  student: {
    id: string;
    studentNumber: string;
    name: string;
    email: string;
    yearOfStudy: number;
    program: { code: string; name: string };
  };
  course: { id: string; code: string; title: string; credits: number };
  section: {
    id: string;
    sectionCode: string;
    status: string;
    meetings: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
    instructor: string | null;
  };
  session: { id: string; code: string; name: string };
  waitlistedAt: string | null;
  offerExpiresAt: string | null;
  registeredAt: string | null;
  endedAt: string | null;
  overrides: string[];
  overrideReason: string | null;
  pendingRequest: { id: string; type: string; reason: string | null; createdAt: string } | null;
  waitlistPosition?: number | null;
  createdAt: string;
}

export interface RegistrationDetail extends Registration {
  history: Array<{
    id: string;
    from: string | null;
    to: string;
    action: string;
    actor: string;
    reason: string | null;
    details: unknown;
    at: string;
  }>;
}

export interface RuleCheck {
  code: string;
  passed: boolean;
  message: string;
  details: Record<string, unknown> | null;
  overridable: string | null;
}

export interface Eligibility {
  sectionId: string;
  studentId: string;
  eligible: boolean;
  outcome: 'REGISTER' | 'PENDING' | 'WAITLIST' | 'FULL' | 'BLOCKED';
  rules: RuleCheck[];
}

export interface SectionRegistrations {
  capacity: number;
  enrolledCount: number;
  waitlistCount: number;
  seats: Registration[];
  waitlist: Registration[];
  canManage: boolean;
  canManageWaitlist: boolean;
  canApprove: boolean;
}

export interface RegistrationRequest {
  id: string;
  type: string;
  status: string;
  reason: string | null;
  decisionNote: string | null;
  createdAt: string;
  registration: Registration;
}

export interface AcademicRecords {
  records: Array<{
    id: string;
    source: string;
    courseId: string;
    courseCode: string;
    courseTitle: string;
    creditsAttempted: number;
    creditsEarned: number;
    gradeLetter: string | null;
    gradePoints: number | null;
    passed: boolean;
    session: { id: string; code: string; name: string } | null;
  }>;
  creditsEarned: number;
  cgpa: number | null;
}

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  PENDING: 'Pending approval',
  REGISTERED: 'Registered',
  WAITLISTED: 'Waitlisted',
  OFFERED: 'Seat offered',
  DROPPED: 'Dropped',
  WITHDRAWN: 'Withdrawn',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  COMPLETED: 'Completed',
};
export const REGISTRATION_TONE: Record<RegistrationStatus, StatusTone> = {
  PENDING: 'warning',
  REGISTERED: 'success',
  WAITLISTED: 'info',
  OFFERED: 'info',
  DROPPED: 'neutral',
  WITHDRAWN: 'neutral',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
  COMPLETED: 'success',
};
/** Human names for rule codes (eligibility preview, errors). */
export const RULE_LABEL: Record<string, string> = {
  STUDENT_NOT_ACTIVE: 'Student status',
  REGISTRATION_HOLD: 'Registration holds',
  REGISTRATION_PERIOD_CLOSED: 'Registration window',
  REGISTRATION_NOT_YET_OPEN: 'Registration window',
  SECTION_NOT_AVAILABLE: 'Section availability',
  DUPLICATE_REGISTRATION: 'Not already registered',
  COURSE_ALREADY_COMPLETED: 'Not already completed',
  PREREQUISITE_NOT_MET: 'Prerequisites',
  COREQUISITE_NOT_MET: 'Corequisites',
  RESTRICTION_NOT_MET: 'Restrictions',
  CREDIT_LIMIT_EXCEEDED: 'Credit limit',
  TIMETABLE_CONFLICT: 'Timetable',
  SECTION_FULL: 'Seats',
};
export const OVERRIDE_LABEL: Record<string, string> = {
  PERIOD: 'Registration window',
  CAPACITY: 'Capacity (raises it by one)',
  PREREQUISITE: 'Prerequisites',
  COREQUISITE: 'Corequisites',
  RESTRICTION: 'Restrictions',
  CREDIT_LIMIT: 'Credit limit',
  TIME_CONFLICT: 'Timetable clash',
};
