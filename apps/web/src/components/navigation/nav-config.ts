import { History, KeyRound, LayoutDashboard, ShieldCheck, type LucideIcon } from 'lucide-react';
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
    { label: 'Account', items: [{ label: 'Security', to: '/faculty/account', icon: KeyRound }] },
  ],
  student: [
    {
      label: 'General',
      items: [{ label: 'Overview', to: '/student/dashboard', icon: LayoutDashboard }],
    },
    { label: 'Account', items: [{ label: 'Security', to: '/student/account', icon: KeyRound }] },
  ],
};

export const PORTAL_LABEL: Record<Portal, string> = {
  admin: 'Administration',
  faculty: 'Faculty',
  student: 'Student',
};
