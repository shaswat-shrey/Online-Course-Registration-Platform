import type { Section } from '@/features/courses/api/types';
import type { Registration, RegistrationStatus } from '@/features/registrations/api/types';

export type RegistrationWindow =
  'NOT_CONFIGURED' | 'UPCOMING' | 'OPEN' | 'LATE' | 'ADD_DROP' | 'CLOSED';

export interface CatalogSession {
  id: string;
  code: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  registrationState: RegistrationWindow;
  period: {
    opensAt: string;
    closesAt: string;
    lateClosesAt: string | null;
    addDropDeadline: string;
    withdrawalDeadline: string;
  } | null;
}

export interface CatalogCourse {
  id: string;
  code: string;
  title: string;
  description: string | null;
  credits: number;
  level: number;
  category: string;
  department: { id: string; code: string; name: string };
  hasPrerequisites: boolean;
  inMyProgram: 'CORE' | 'ELECTIVE' | null;
  sections: number;
  openSeats: number;
  waitlistOpen: boolean;
  instructors: string[];
  myStatus: RegistrationStatus | null;
}

export type RequirementState = 'COMPLETED' | 'IN_PROGRESS' | 'THIS_SESSION' | 'MISSING';
export interface CatalogCourseDetail {
  id: string;
  code: string;
  title: string;
  description: string | null;
  syllabus: string | null;
  credits: number;
  level: number;
  category: string;
  department: { id: string; code: string; name: string };
  isRepeatable: boolean;
  inMyProgram: 'CORE' | 'ELECTIVE' | null;
  outcomes: string[];
  assessmentComponents: Array<{ name: string; weight: number }>;
  prerequisites: Array<{
    items: Array<{
      course: { id: string; code: string; title: string };
      minGradeLetter: string | null;
      state: RequirementState;
      grade: string | null;
    }>;
  }>;
  corequisites: Array<{
    course: { id: string; code: string; title: string };
    state: RequirementState;
    grade: string | null;
  }>;
  hasRestrictions: boolean;
  completed: boolean;
  myRegistration: { id: string; status: RegistrationStatus; sectionId: string } | null;
  sections: Section[];
}

export interface BriefRegistration {
  id: string;
  status: RegistrationStatus;
  sectionId: string;
  label: string;
  title: string;
  credits: number;
  offerExpiresAt: string | null;
}

export interface StudentDashboardData {
  profile: {
    name: string;
    studentNumber: string;
    program: { code: string; name: string };
    department: string;
    specialization: string | null;
    yearOfStudy: number;
    activeHolds: number;
  };
  currentSession: (CatalogSession & { courses: BriefRegistration[]; credits: number }) | null;
  registrationSession: (CatalogSession & { courses: BriefRegistration[]; credits: number }) | null;
  pending: BriefRegistration[];
  progress: { totalRequired: number; completed: number; inProgress: number };
  announcements: StudentAnnouncement[];
}

export interface StudentAnnouncement {
  id: string;
  title: string;
  body: string;
  priority: 'NORMAL' | 'IMPORTANT' | 'URGENT';
  pinned: boolean;
  publishedAt: string;
  author: string;
  sections: Array<{ id: string; label: string }>;
}

export interface TimetableEntry {
  id: string;
  registrationId: string;
  status: string;
  sectionId: string;
  course: string;
  title: string;
  sectionCode: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  type: string;
  room: string | null;
  instructor: string | null;
}

export interface ProgressData {
  program: { code: string; name: string };
  specialization: { code: string; name: string } | null;
  totalRequired: number;
  completed: number;
  inProgress: number;
  remaining: number;
  groups: Array<{
    id: string;
    name: string;
    kind: string;
    category: string | null;
    source: 'PROGRAM' | 'SPECIALIZATION';
    requiredCredits: number;
    completedCredits: number;
    inProgressCredits: number;
    satisfied: boolean;
    courses: Array<{
      id: string;
      code: string;
      title: string;
      credits: number;
      state: 'COMPLETED' | 'IN_PROGRESS' | 'PENDING';
    }>;
  }>;
}

export interface HistoryData {
  sessions: Array<{
    id: string;
    name: string;
    credits: number;
    gpa: number | null;
    courses: Array<{
      courseId: string;
      code: string;
      title: string;
      credits: number;
      creditsEarned: number;
      grade: string | null;
      passed: boolean;
    }>;
  }>;
  creditsEarned: number;
  cgpa: number | null;
}

export interface CoursePlan {
  id: string;
  name: string;
  session: { id: string; code: string; name: string };
  items: Array<{
    course: { id: string; code: string; title: string; credits: number };
    section: { id: string; sectionCode: string; status: string } | null;
  }>;
  totalCredits: number;
  updatedAt: string;
}

export interface PlanValidation {
  planId: string;
  totalCredits: number;
  items: Array<{
    courseId: string;
    sectionId: string | null;
    ok: boolean;
    problems: Array<{ code: string; message: string }>;
  }>;
}

export interface BatchResult {
  results: Array<{
    sectionId: string;
    ok: boolean;
    registration?: Registration;
    error?: { code: string; message: string };
  }>;
  succeeded: number;
  failed: number;
}

export type MyRegistration = Registration & { waitlistPosition: number | null };
