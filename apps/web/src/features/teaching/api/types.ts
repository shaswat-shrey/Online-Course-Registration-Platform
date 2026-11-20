import type { AudienceRole, AudienceType } from '@ucrams/shared';
import type { Section } from '@/features/courses/api/types';

export type TeachingSection = Section & { myRole: 'PRIMARY' | 'SECONDARY' | 'TA' };

export interface FacultyDashboard {
  session: Section['session'] | null;
  sections: TeachingSection[];
  totalStudents: number;
  today: {
    dayOfWeek: number;
    nowMinute: number;
    timeZone: string;
    classes: Array<{
      sectionId: string;
      course: string;
      sectionCode: string;
      title: string;
      startMinute: number;
      endMinute: number;
      classroom: string | null;
      type: string;
    }>;
  };
  load: { credits: number; maxCredits: number | null };
  upcomingSections: number;
  recentAnnouncements: Array<{
    id: string;
    title: string;
    priority: string;
    publishedAt: string;
    sectionCount: number;
  }>;
}

export interface Workspace {
  section: Section;
  course: {
    description: string | null;
    syllabus: string | null;
    level: number;
    outcomes: string[];
    assessmentComponents: Array<{ name: string; weight: number }>;
  };
  stats: {
    byStatus: Record<string, number>;
    byProgram: Array<{ label: string; count: number }>;
    byYear: Array<{ label: string; count: number }>;
  };
  myRole: string | null;
  can: { exportRoster: boolean; manageMaterials: boolean; announce: boolean };
}

export interface RosterEntry {
  registrationId: string;
  status: string;
  registeredAt: string;
  student: {
    id: string;
    studentNumber: string;
    name: string;
    email: string;
    program: { code: string; name: string };
    specialization: string | null;
    yearOfStudy: number;
  };
  attendancePercent: number | null;
}

export interface SectionStudent {
  id: string;
  studentNumber: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  program: { code: string; name: string; department: string };
  specialization: string | null;
  yearOfStudy: number;
  cohort: string | null;
  studentStatus: string;
  registration: { status: string; since: string };
  alsoInYourSections: Array<{ sectionId: string; label: string }>;
}

export interface Material {
  id: string;
  sectionId: string;
  folder: string | null;
  title: string;
  description: string | null;
  kind: 'FILE' | 'LINK';
  url: string | null;
  file: { name: string; mimeType: string; sizeBytes: number } | null;
  position: number;
  published: boolean;
  publishedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  priority: 'NORMAL' | 'IMPORTANT' | 'URGENT';
  pinned: boolean;
  publishedAt: string;
  expiresAt: string | null;
  scheduled: boolean;
  expired: boolean;
  author: string;
  mine: boolean;
  canManage: boolean;
  read: boolean;
  readCount: number | null;
  audiences: Array<{
    type: AudienceType;
    targetId: string | null;
    targetValue: number | null;
    roleFilter: AudienceRole;
    label: string;
  }>;
  sections: Array<{ id: string; label: string }>;
}
