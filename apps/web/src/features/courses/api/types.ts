export interface Ref {
  id: string;
  code: string;
  name: string;
}
export interface CourseRef {
  id: string;
  code: string;
  title: string;
  credits: number;
  status: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  description: string | null;
  department: Ref;
  credits: number;
  level: number;
  category: string;
  recommendedYear: number | null;
  recommendedSessionType: string | null;
  defaultCapacity: number | null;
  minEnrollment: number | null;
  coordinator: { id: string; name: string } | null;
  isRepeatable: boolean;
  status: CourseStatus;
  sectionCount: number;
  hasPrerequisites: boolean;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}
export type CourseStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface Restriction {
  id: string;
  mode: 'INCLUDE' | 'EXCLUDE';
  targetType: 'DEPARTMENT' | 'PROGRAM' | 'SPECIALIZATION' | 'YEAR_OF_STUDY';
  targetId: string | null;
  targetValue: number | null;
  label: string;
}

export interface CourseDetail extends Course {
  syllabus: string | null;
  outcomes: string[];
  assessmentComponents: Array<{ name: string; weight: number }>;
  prerequisites: Array<{
    id: string;
    items: Array<{ course: CourseRef; minGradeLetter: string | null }>;
  }>;
  corequisites: CourseRef[];
  requiredBy: CourseRef[];
  programs: Array<Ref & { mappingType: 'CORE' | 'ELECTIVE' }>;
  specializations: Array<
    Ref & { program: { id: string; code: string }; mappingType: 'CORE' | 'ELECTIVE' }
  >;
  restrictions: Restriction[];
  requirementGroups: Array<{ id: string; name: string; kind: string; owner: string }>;
  sectionsByStatus: Record<string, number>;
  canArchive: boolean;
  warnings?: string[];
}

export interface Classroom {
  id: string;
  campus: Ref;
  building: string;
  roomNumber: string;
  name: string | null;
  label: string;
  capacity: number;
  type: string;
  equipment: string[];
  status: string;
  meetingCount: number;
}

export interface Meeting {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  type: string;
  classroom: { id: string; label: string; capacity: number } | null;
}

export type SectionStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'CANCELLED' | 'COMPLETED';

export interface Section {
  id: string;
  sectionCode: string;
  course: CourseRef & { category: string; department: Ref };
  session: {
    id: string;
    code: string;
    name: string;
    status: string;
    startDate: string;
    endDate: string;
  };
  campus: Ref | null;
  capacity: number;
  enrolledCount: number;
  availableSeats: number;
  waitlistCapacity: number;
  waitlistCount: number;
  status: SectionStatus;
  registrationOpen: boolean;
  notes: string | null;
  publishedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  scheduleOverrideReason: string | null;
  meetings: Meeting[];
  instructors: Array<{
    facultyMemberId: string;
    name: string;
    email: string;
    designation: string;
    role: 'PRIMARY' | 'SECONDARY' | 'TA';
  }>;
  hasRestrictions: boolean;
  permissions: {
    update: boolean;
    publish: boolean;
    cancel: boolean;
    assignFaculty: boolean;
    overrideConflicts: boolean;
  };
  restrictions?: Restriction[];
}

export interface Conflict {
  kind: 'CLASSROOM' | 'INSTRUCTOR';
  resource: string;
  resourceId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  section: { id: string; sectionCode: string; courseCode: string };
}

export interface ScheduleResult extends Section {
  warnings: string[];
  overriddenConflicts: Conflict[];
}

export interface RollForwardResult {
  created: Array<{ id: string; course: string; sectionCode: string; conflicts: number }>;
  skipped: Array<{ course: string; sectionCode: string; reason: string }>;
  withConflicts: number;
}

export interface ClassroomBooking {
  id: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  type: string;
  section: {
    id: string;
    sectionCode: string;
    status: string;
    course: { id: string; code: string; title: string };
  };
}

export const COURSE_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  ARCHIVED: 'Archived',
};
export const SECTION_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};
export const CLASSROOM_TYPE_LABEL: Record<string, string> = {
  LECTURE_HALL: 'Lecture hall',
  CLASSROOM: 'Classroom',
  LABORATORY: 'Laboratory',
  SEMINAR_ROOM: 'Seminar room',
  COMPUTER_LAB: 'Computer lab',
  AUDITORIUM: 'Auditorium',
  STUDIO: 'Studio',
};
export const MEETING_TYPE_LABEL: Record<string, string> = {
  LECTURE: 'Lecture',
  LAB: 'Lab',
  TUTORIAL: 'Tutorial',
  SEMINAR: 'Seminar',
  PRACTICAL: 'Practical',
};
export const ROLE_LABEL: Record<string, string> = {
  PRIMARY: 'Primary',
  SECONDARY: 'Co-instructor',
  TA: 'Teaching assistant',
};
export const DAY_LABEL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const DAY_NAME = [
  '',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
