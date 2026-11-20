import { PERMISSION_KEYS, type PermissionKey } from './permissions.js';

export const RoleKey = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  UNIVERSITY_ADMIN: 'UNIVERSITY_ADMIN',
  ACADEMIC_ADMIN: 'ACADEMIC_ADMIN',
  DEPARTMENT_ADMIN: 'DEPARTMENT_ADMIN',
  FACULTY: 'FACULTY',
  STUDENT: 'STUDENT',
} as const;
export type RoleKey = (typeof RoleKey)[keyof typeof RoleKey];

export const ScopeType = { GLOBAL: 'GLOBAL', SCHOOL: 'SCHOOL', DEPARTMENT: 'DEPARTMENT' } as const;
export type ScopeType = (typeof ScopeType)[keyof typeof ScopeType];

/**
 * ORGANIZATIONAL: permissions apply to the assignment's scope.
 * RELATIONSHIP: permissions apply only to the holder's own sections/records (ADR-014).
 */
export type RoleScopeMode = 'ORGANIZATIONAL' | 'RELATIONSHIP';

export interface SystemRoleDefinition {
  key: RoleKey;
  scopeMode: RoleScopeMode;
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

const UNIVERSITY_ADMIN_EXCLUDED: PermissionKey[] = [
  'settings:manage',
  'rbac:manage',
  'jobs:manage',
  'grade:submit',
  'grade:change',
  'record:manage',
  'assessment:manage',
  'material:manage',
  'attendance:manage',
  'registration:self',
  'feedback:submit',
];

const ACADEMIC_ADMIN: PermissionKey[] = [
  'audit:read',
  'user:read',
  'user:create',
  'user:update',
  'user:manage_status',
  'user:assign_roles',
  'student:read',
  'student:read_sensitive',
  'student:create',
  'student:update',
  'student:import',
  'student:manage_holds',
  'faculty:read',
  'faculty:create',
  'faculty:update',
  'faculty:import',
  'department:manage',
  'degree:manage',
  'program:manage',
  'specialization:manage',
  'classroom:manage',
  'session:manage',
  'registration_period:manage',
  'grading_scale:manage',
  'course:create',
  'course:update',
  'course:archive',
  'section:create',
  'section:update',
  'section:publish',
  'section:cancel',
  'section:publish_without_instructor',
  'section:assign_faculty',
  'section:override_conflicts',
  'registration:read',
  'registration:approve',
  'registration:manage',
  'registration:override',
  'waitlist:manage',
  'roster:read',
  'roster:export',
  'material:manage',
  'attendance:manage',
  'grade:approve',
  'grade:change',
  'record:read',
  'record:manage',
  'message:send',
  'message:moderate',
  'announcement:publish_section',
  'announcement:publish_scoped',
  'announcement:publish_global',
  'feedback:manage',
  'ticket:submit',
  'ticket:manage',
  'dashboard:admin',
  'report:read',
  'report:export',
  'document:manage',
];

const DEPARTMENT_ADMIN: PermissionKey[] = [
  'user:read',
  'user:create',
  'user:update',
  'student:read',
  'student:create',
  'student:update',
  'student:manage_holds',
  'faculty:read',
  'faculty:update',
  'department:manage',
  'program:manage',
  'specialization:manage',
  'course:create',
  'course:update',
  'course:archive',
  'section:create',
  'section:update',
  'section:publish',
  'section:cancel',
  'section:assign_faculty',
  'registration:read',
  'registration:approve',
  'registration:manage',
  'waitlist:manage',
  'roster:read',
  'roster:export',
  'material:manage',
  'attendance:manage',
  'grade:approve',
  'record:read',
  'message:send',
  'message:moderate',
  'announcement:publish_section',
  'announcement:publish_scoped',
  'feedback:manage',
  'ticket:submit',
  'ticket:manage',
  'dashboard:admin',
  'report:read',
  'report:export',
  'document:manage',
];

const FACULTY: PermissionKey[] = [
  'student:read',
  'registration:read',
  'roster:read',
  'roster:export',
  'material:manage',
  'attendance:manage',
  'assessment:manage',
  'grade:submit',
  'record:read',
  'message:send',
  'message:moderate',
  'announcement:publish_section',
  'feedback:submit',
  'ticket:submit',
];

const STUDENT: PermissionKey[] = [
  'student:read',
  'student:read_sensitive',
  'registration:read',
  'registration:self',
  'record:read',
  'message:send',
  'feedback:submit',
  'ticket:submit',
];

/**
 * System roles and their permission sets: the role → permission matrix in
 * docs/USER_ROLES_AND_PERMISSIONS.md §4. Scope (🔹) comes from the role
 * assignment; relationship limits (👤) are enforced by module policies.
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: RoleKey.SUPER_ADMIN,
    scopeMode: 'ORGANIZATIONAL',
    name: 'Super Administrator',
    description: 'Full system control, including roles, permissions and system settings.',
    permissions: PERMISSION_KEYS.filter(
      (p) => p !== 'registration:self' && p !== 'feedback:submit' && p !== 'grade:submit',
    ),
  },
  {
    key: RoleKey.UNIVERSITY_ADMIN,
    scopeMode: 'ORGANIZATIONAL',
    name: 'University Administrator',
    description:
      'Runs the university: structure, users, calendar and reports. Cannot change RBAC or security settings.',
    permissions: PERMISSION_KEYS.filter((p) => !UNIVERSITY_ADMIN_EXCLUDED.includes(p)),
  },
  {
    key: RoleKey.ACADEMIC_ADMIN,
    scopeMode: 'ORGANIZATIONAL',
    name: 'Academic Administrator',
    description: 'Registrar: catalog, sections, registrations, academic records and grades.',
    permissions: ACADEMIC_ADMIN,
  },
  {
    key: RoleKey.DEPARTMENT_ADMIN,
    scopeMode: 'ORGANIZATIONAL',
    name: 'Department Administrator',
    description: 'Academic administration limited to assigned departments.',
    permissions: DEPARTMENT_ADMIN,
  },
  {
    key: RoleKey.FACULTY,
    scopeMode: 'RELATIONSHIP',
    name: 'Faculty Member',
    description: 'Teaching, rosters and course communication for assigned sections.',
    permissions: FACULTY,
  },
  {
    key: RoleKey.STUDENT,
    scopeMode: 'RELATIONSHIP',
    name: 'Student',
    description: 'Self-service registration and academic information.',
    permissions: STUDENT,
  },
];

export type Portal = 'admin' | 'faculty' | 'student';
