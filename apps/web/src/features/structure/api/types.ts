export interface Leader {
  id: string;
  name: string;
  designation: string;
}

export interface Ref {
  id: string;
  name: string;
}
export interface CodedRef extends Ref {
  code: string;
}

export interface University {
  id: string;
  name: string;
  shortName: string;
  timezone: string;
  schoolLabel: string;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  updatedAt: string;
}

export interface Campus {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  status: string;
  schoolCount: number;
  departmentCount: number;
}

export interface School {
  id: string;
  code: string;
  name: string;
  description: string | null;
  campus: Ref | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  dean: Leader | null;
  status: string;
  departmentCount: number;
  programCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  description: string | null;
  school: CodedRef;
  campus: Ref | null;
  contactEmail: string | null;
  contactPhone: string | null;
  officeLocation: string | null;
  head: Leader | null;
  status: string;
  programCount: number;
  facultyCount: number;
  specializationCount?: number;
  studentCount?: number;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Degree {
  id: string;
  code: string;
  name: string;
  level: string;
  description: string | null;
  status: string;
  programCount: number;
}

export interface RequirementGroup {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  minCredits: number | null;
  category: string | null;
  position: number;
}

export interface Specialization {
  id: string;
  programId: string;
  code: string;
  name: string;
  description: string | null;
  additionalCredits: number | null;
  status: string;
  requirementGroups?: RequirementGroup[];
}

export interface Program {
  id: string;
  code: string;
  name: string;
  description: string | null;
  degree: CodedRef & { level: string };
  department: CodedRef & { schoolId: string };
  durationYears: number;
  sessionCount: number;
  totalCredits: number;
  minCoreCredits: number | null;
  minElectiveCredits: number | null;
  status: string;
  specializationCount: number;
  canManage: boolean;
  specializations?: Specialization[];
  requirementGroups?: RequirementGroup[];
}

export const DEGREE_LEVEL_LABEL: Record<string, string> = {
  DIPLOMA: 'Diploma',
  UNDERGRADUATE: 'Undergraduate',
  POSTGRADUATE: 'Postgraduate',
  DOCTORAL: 'Doctoral',
};

export const REQUIREMENT_KIND_LABEL: Record<string, string> = {
  ALL_OF: 'All listed courses',
  CREDITS_FROM_LIST: 'Credits from a course list',
  CREDITS_FROM_CATEGORY: 'Credits from a category',
  CREDITS_ANY: 'Credits from any course',
};

export const CATEGORY_LABEL: Record<string, string> = {
  CORE: 'Core',
  ELECTIVE: 'Elective',
  GENERAL_EDUCATION: 'General education',
  LABORATORY: 'Laboratory',
  SEMINAR: 'Seminar',
  RESEARCH: 'Research',
  PROJECT: 'Project',
  INTERNSHIP: 'Internship',
  PRACTICAL: 'Practical',
};
