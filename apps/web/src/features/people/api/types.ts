export interface AccountSummary {
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  lastLoginAt: string | null;
  locked: boolean;
  activated: boolean;
  activeSessions: number;
  createdAt: string;
}

interface Coded {
  id: string;
  code: string;
  name: string;
}

export interface StudentListItem {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  program: Coded;
  department: Coded;
  specialization: { code: string; name: string } | null;
  yearOfStudy: number;
  status: string;
  accountStatus: string;
  activeHolds: number;
}

export interface StudentContact {
  personalEmail: string | null;
  dateOfBirth: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
}

export interface StudentDetail {
  id: string;
  userId: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  program: Coded & { totalCredits: number };
  department: Coded & { schoolId: string };
  specialization: Coded | null;
  admissionSession: Coded | null;
  admissionDate: string | null;
  expectedGraduationYear: number | null;
  yearOfStudy: number;
  cohort: string | null;
  status: string;
  phone: string | null;
  contact: StudentContact | null;
  activeHolds: number;
  holds: Array<{
    id: string;
    type: string;
    reason: string | null;
    placedAt: string;
    placedBy: string | null;
    releasedAt: string | null;
    releasedBy: string | null;
    releaseNote: string | null;
  }>;
  programHistory: Array<{
    id: string;
    from: { code: string; name: string } | null;
    to: { code: string; name: string };
    effectiveSession: string | null;
    reason: string | null;
    changedBy: string | null;
    createdAt: string;
  }>;
  account: AccountSummary | null;
  permissions: {
    edit: boolean;
    manageHolds: boolean;
    readSensitive: boolean;
    manageAccount: boolean;
  };
}

export interface FacultyListItem {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  designation: string;
  department: Coded;
  employmentStatus: string;
  accountStatus: string;
  headOf: Array<{ id: string; name: string }>;
}

export interface FacultyDetail {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  designation: string;
  department: Coded & { schoolId: string };
  secondaryDepartments: Array<Coded & { schoolId: string }>;
  specialization: string | null;
  researchInterests: string | null;
  qualifications: string | null;
  officeLocation: string | null;
  officeHours: string | null;
  headOf: Array<{ id: string; name: string }>;
  deanOf: Array<{ id: string; name: string }>;
  restricted: boolean;
  employeeNumber?: string;
  employmentStatus?: string;
  phone?: string | null;
  maxLoadCredits?: number | null;
  joinedOn?: string | null;
  account?: AccountSummary | null;
  permissions?: { edit: boolean; manageAccount: boolean };
}

export interface AdminRoleRef {
  id: string;
  roleKey: string;
  roleName: string;
  scopeType: string;
  scopeName: string | null;
}

export interface AdminListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  jobTitle: string | null;
  roles: AdminRoleRef[];
  lastLoginAt: string | null;
}

export interface AdminDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  employeeNumber: string | null;
  phone: string | null;
  officeDepartment: { id: string; name: string } | null;
  roles: AdminRoleRef[];
  account: AccountSummary;
}

export interface RoleAssignment {
  id: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  scopeMode: 'ORGANIZATIONAL' | 'RELATIONSHIP';
  scopeType: 'GLOBAL' | 'SCHOOL' | 'DEPARTMENT';
  scopeId: string | null;
  scopeName: string | null;
  createdAt: string;
}

export const STUDENT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  ON_LEAVE: 'On leave',
  SUSPENDED: 'Suspended',
  GRADUATED: 'Graduated',
  WITHDRAWN: 'Withdrawn',
  DISMISSED: 'Dismissed',
};
export const DESIGNATION_LABEL: Record<string, string> = {
  PROFESSOR: 'Professor',
  ASSOCIATE_PROFESSOR: 'Associate Professor',
  ASSISTANT_PROFESSOR: 'Assistant Professor',
  LECTURER: 'Lecturer',
  SENIOR_LECTURER: 'Senior Lecturer',
  ADJUNCT: 'Adjunct Faculty',
  VISITING: 'Visiting Faculty',
  EMERITUS: 'Professor Emeritus',
};
export const HOLD_LABEL: Record<string, string> = {
  FINANCIAL: 'Financial',
  ACADEMIC: 'Academic',
  DISCIPLINARY: 'Disciplinary',
  ADMINISTRATIVE: 'Administrative',
  DOCUMENTATION: 'Documentation',
};
export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  INVITED: 'Invitation sent',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated',
};
