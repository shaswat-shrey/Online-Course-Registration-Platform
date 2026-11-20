import {
  Award,
  BookOpen,
  CalendarRange,
  DoorOpen,
  Building2,
  CalendarDays,
  GraduationCap,
  History,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Percent,
  School,
  ShieldCheck,
  UserCog,
  UserRound,
  Users,
  Contact,
  type LucideIcon,
} from 'lucide-react';
import type { PermissionKey, Portal } from '@ucrams/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  permission?: PermissionKey;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Navigation per portal. Only implemented pages are listed; items are hidden
 * when the user lacks the permission (the API enforces independently).
 */
export const NAVIGATION: Record<Portal, NavGroup[]> = {
  admin: [
    {
      label: 'General',
      items: [{ label: 'Overview', to: '/admin/dashboard', icon: LayoutDashboard }],
    },
    {
      label: 'University',
      items: [
        { label: 'University', to: '/admin/university', icon: Landmark },
        { label: 'Faculties', to: '/admin/schools', icon: School },
        { label: 'Departments', to: '/admin/departments', icon: Building2 },
        { label: 'Degrees', to: '/admin/degrees', icon: Award },
        { label: 'Programs', to: '/admin/programs', icon: GraduationCap },
      ],
    },
    {
      label: 'Catalog',
      items: [
        { label: 'Courses', to: '/admin/courses', icon: BookOpen },
        { label: 'Sections', to: '/admin/sections', icon: CalendarRange },
        { label: 'Classrooms', to: '/admin/classrooms', icon: DoorOpen },
      ],
    },
    {
      label: 'People',
      items: [
        { label: 'Students', to: '/admin/students', icon: Users, permission: 'student:read' },
        { label: 'Faculty', to: '/admin/faculty', icon: Contact, permission: 'faculty:read' },
        {
          label: 'Administrators',
          to: '/admin/administrators',
          icon: UserCog,
          permission: 'admin:manage',
        },
      ],
    },
    {
      label: 'Academic calendar',
      items: [
        { label: 'Sessions', to: '/admin/academic-sessions', icon: CalendarDays },
        { label: 'Grading scales', to: '/admin/grading-scales', icon: Percent },
      ],
    },
    {
      label: 'Access control',
      items: [
        {
          label: 'Roles & permissions',
          to: '/admin/roles',
          icon: ShieldCheck,
          permission: 'rbac:read',
        },
        { label: 'Audit log', to: '/admin/audit-logs', icon: History, permission: 'audit:read' },
      ],
    },
    { label: 'Account', items: [{ label: 'Security', to: '/admin/account', icon: KeyRound }] },
  ],
  faculty: [
    {
      label: 'General',
      items: [{ label: 'Overview', to: '/faculty/dashboard', icon: LayoutDashboard }],
    },
    {
      label: 'Account',
      items: [
        { label: 'Profile', to: '/faculty/profile', icon: UserRound },
        { label: 'Security', to: '/faculty/account', icon: KeyRound },
      ],
    },
  ],
  student: [
    {
      label: 'General',
      items: [{ label: 'Overview', to: '/student/dashboard', icon: LayoutDashboard }],
    },
    {
      label: 'Account',
      items: [
        { label: 'Profile', to: '/student/profile', icon: UserRound },
        { label: 'Security', to: '/student/account', icon: KeyRound },
      ],
    },
  ],
};

export const PORTAL_LABEL: Record<Portal, string> = {
  admin: 'Administration',
  faculty: 'Faculty',
  student: 'Student',
};
