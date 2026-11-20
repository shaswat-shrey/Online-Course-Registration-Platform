import { describe, expect, it } from 'vitest';
import { isPermissionKey, PERMISSION_KEYS } from './permissions.js';
import { SYSTEM_ROLES } from './roles.js';

const perms = (key: string) => new Set(SYSTEM_ROLES.find((r) => r.key === key)!.permissions);

describe('system roles', () => {
  it('only reference known permissions, without duplicates', () => {
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) expect(isPermissionKey(p), `${role.key}: ${p}`).toBe(true);
      expect(new Set(role.permissions).size, role.key).toBe(role.permissions.length);
    }
  });

  it('gives only SUPER_ADMIN rbac:manage and settings:manage', () => {
    for (const role of SYSTEM_ROLES) {
      const has = perms(role.key);
      expect(has.has('rbac:manage'), role.key).toBe(role.key === 'SUPER_ADMIN');
      expect(has.has('settings:manage'), role.key).toBe(role.key === 'SUPER_ADMIN');
    }
  });

  it('keeps separation of duties for the university admin', () => {
    const ua = perms('UNIVERSITY_ADMIN');
    for (const p of [
      'grade:change',
      'grade:submit',
      'record:manage',
      'assessment:manage',
    ] as const) {
      expect(ua.has(p)).toBe(false);
    }
    expect(ua.has('announcement:publish_global')).toBe(true);
    // University admins provision department admins, so they hold every department-admin permission.
    const da = perms('DEPARTMENT_ADMIN');
    expect([...da].filter((p) => !ua.has(p))).toEqual([]);
  });

  it('never lets faculty publish globally or students act on others', () => {
    expect(perms('FACULTY').has('announcement:publish_global')).toBe(false);
    expect(perms('FACULTY').has('registration:manage')).toBe(false);
    expect(perms('STUDENT').has('registration:manage')).toBe(false);
    expect(perms('STUDENT').has('registration:self')).toBe(true);
  });

  it('super admin holds every administrative permission', () => {
    const sa = perms('SUPER_ADMIN');
    expect(PERMISSION_KEYS.filter((p) => !sa.has(p)).sort()).toEqual([
      'feedback:submit',
      'grade:submit',
      'registration:self',
    ]);
  });
});
