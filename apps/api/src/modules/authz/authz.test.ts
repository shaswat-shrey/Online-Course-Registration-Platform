import { describe, expect, it } from 'vitest';
import type { GrantMap } from '../../common/context/actor.js';
import { covers, grantCovers, hasGlobal, hasPermission, scopeFilter } from './authz.js';

const SCHOOL = '00000000-0000-7000-8000-00000000000a';
const DEPT = '00000000-0000-7000-8000-00000000000b';
const OTHER_DEPT = '00000000-0000-7000-8000-00000000000c';

describe('scope coverage', () => {
  it('GLOBAL covers everything, SCHOOL covers its departments, DEPARTMENT only itself', () => {
    expect(grantCovers({ scope: 'GLOBAL' }, {})).toBe(true);
    expect(
      grantCovers({ scope: 'SCHOOL', id: SCHOOL }, { schoolId: SCHOOL, departmentId: DEPT }),
    ).toBe(true);
    expect(grantCovers({ scope: 'SCHOOL', id: SCHOOL }, { schoolId: 'other' })).toBe(false);
    expect(
      grantCovers({ scope: 'DEPARTMENT', id: DEPT }, { schoolId: SCHOOL, departmentId: DEPT }),
    ).toBe(true);
    expect(
      grantCovers(
        { scope: 'DEPARTMENT', id: DEPT },
        { schoolId: SCHOOL, departmentId: OTHER_DEPT },
      ),
    ).toBe(false);
  });

  it('scoped grants never cover university-wide resources (AC-RBAC-001 basis)', () => {
    const grants: GrantMap = { 'course:update': [{ scope: 'DEPARTMENT', id: DEPT }] };
    expect(hasPermission(grants, 'course:update')).toBe(true);
    expect(hasGlobal(grants, 'course:update')).toBe(false);
    expect(covers(grants, 'course:update', {})).toBe(false);
    expect(covers(grants, 'course:update', { departmentId: OTHER_DEPT })).toBe(false);
    expect(covers(grants, 'course:update', { departmentId: DEPT })).toBe(true);
    expect(covers(grants, 'course:create', { departmentId: DEPT })).toBe(false);
  });

  it('OWN grants (relationship roles) never cover any organisational scope (ADR-014)', () => {
    const grants: GrantMap = { 'material:manage': [{ scope: 'OWN' }] };
    expect(hasPermission(grants, 'material:manage')).toBe(true);
    expect(hasGlobal(grants, 'material:manage')).toBe(false);
    expect(covers(grants, 'material:manage', {})).toBe(false);
    expect(covers(grants, 'material:manage', { schoolId: SCHOOL, departmentId: DEPT })).toBe(false);
    expect(scopeFilter(grants, 'material:manage')).toEqual({ schoolIds: [], departmentIds: [] });
  });

  it('builds list filters from grants', () => {
    expect(
      scopeFilter(
        { 'report:read': [{ scope: 'GLOBAL' }, { scope: 'SCHOOL', id: SCHOOL }] },
        'report:read',
      ),
    ).toBeNull();
    expect(
      scopeFilter(
        {
          'report:read': [
            { scope: 'SCHOOL', id: SCHOOL },
            { scope: 'DEPARTMENT', id: DEPT },
          ],
        },
        'report:read',
      ),
    ).toEqual({ schoolIds: [SCHOOL], departmentIds: [DEPT] });
    expect(scopeFilter({}, 'report:read')).toEqual({ schoolIds: [], departmentIds: [] });
  });
});
