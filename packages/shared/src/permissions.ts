/**
 * Permission catalogue (docs/USER_ROLES_AND_PERMISSIONS.md §3).
 * Keys are stable: never rename one, deprecate and add a new key instead.
 */
export const PERMISSIONS = {
  // System
  'settings:read': 'View system settings',
  'settings:manage': 'Change system settings',
  'rbac:read': 'View roles and permissions',
  'rbac:manage': 'Create and edit roles and their permissions',
  'audit:read': 'View audit logs',
  'jobs:read': 'View background job status and failures',
  'jobs:manage': 'Retry or remove failed background jobs',
  // Users
  'user:read': 'View user accounts',
  'user:create': 'Create accounts and send invitations',
  'user:update': 'Edit account details',
  'user:manage_status': 'Suspend, deactivate, reactivate and unlock accounts',
  'user:assign_roles': 'Assign and revoke roles within your own permissions and scope',
  'user:read_sessions': "View other users' sessions and login history",
  'user:revoke_sessions': "Revoke other users' sessions",
  'student:read': 'View student academic profiles',
  'student:read_sensitive':
    'View student address, emergency contact, date of birth and hold reasons',
  'student:create': 'Create student records',
  'student:update': 'Edit student records and program assignments',
  'student:import': 'Bulk import students',
  'student:manage_holds': 'Place and release registration holds',
  'faculty:read': 'View faculty administrative details and workload',
  'faculty:create': 'Create faculty records',
  'faculty:update': 'Edit faculty records',
  'faculty:import': 'Bulk import faculty',
  'admin:manage': 'Manage administrator profiles',
  // Structure
  'university:manage': 'Edit the university profile and campuses',
  'school:manage': 'Create and edit faculties/schools',
  'department:manage': 'Create and edit departments',
  'degree:manage': 'Create and edit degrees',
  'program:manage': 'Create and edit programs and their requirements',
  'specialization:manage': 'Create and edit specializations and their requirements',
  'classroom:manage': 'Create and edit classrooms',
  // Calendar
  'session:manage': 'Manage academic years and sessions',
  'registration_period:manage': 'Configure registration periods, priority windows and policies',
  'grading_scale:manage': 'Configure grading scales',
  // Catalog
  'course:create': 'Create courses',
  'course:update': 'Edit courses, prerequisites, mappings and restrictions',
  'course:archive': 'Archive courses',
  'section:create': 'Create course sections',
  'section:update': 'Edit course sections',
  'section:publish': 'Publish and close course sections',
  'section:cancel': 'Cancel course sections',
  'section:publish_without_instructor': 'Publish sections that have no primary instructor',
  'section:assign_faculty': 'Assign instructors and course coordinators',
  'section:override_conflicts': 'Save sections despite classroom or instructor conflicts',
  // Registration
  'registration:read': 'View registrations',
  'registration:approve': 'Approve or reject pending registrations and requests',
  'registration:manage': 'Register, drop and withdraw on behalf of students',
  'registration:override': 'Bypass specific registration rules',
  'waitlist:manage': 'Remove, promote and reorder waitlist entries',
  'registration:self': 'Register, drop and withdraw for yourself',
  // Academics
  'roster:read': 'View section rosters',
  'roster:export': 'Export section rosters',
  'material:manage': 'Manage course materials',
  'attendance:manage': 'Record attendance',
  'assessment:manage': 'Manage assessments and scores',
  'grade:submit': 'Submit final grades',
  'grade:approve': 'Approve and post final grades',
  'grade:change': 'Change posted grades',
  'record:read': 'View academic records',
  'record:manage': 'Add transfer credits and exemptions, correct records',
  // Communication
  'message:send': 'Use messaging',
  'message:moderate': 'Moderate section conversations and discussions',
  'announcement:publish_section': 'Publish announcements to your own sections',
  'announcement:publish_scoped':
    'Publish announcements to departments, programs and courses in scope',
  'announcement:publish_global': 'Publish announcements to all students, faculty or administrators',
  'feedback:submit': 'Submit feedback',
  'feedback:manage': 'Triage, respond to and resolve feedback',
  'ticket:submit': 'Create support tickets',
  'ticket:manage': 'Assign, respond to and resolve support tickets',
  // Reports
  'dashboard:admin': 'Access the administrator dashboard',
  'report:read': 'View reports',
  'report:export': 'Export reports',
  // Files
  'document:manage': 'Manage administrative documents',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export function isPermissionKey(value: string): value is PermissionKey {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export function splitPermission(key: PermissionKey): { resource: string; action: string } {
  const [resource = '', action = ''] = key.split(':');
  return { resource, action };
}
