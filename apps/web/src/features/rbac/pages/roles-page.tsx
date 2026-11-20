import { useNavigate } from 'react-router';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { useCan } from '@/store/auth-store';
import { useRoles, type RoleDto } from '../api/rbac-queries';
import { CreateRoleDialog } from '../components/create-role-dialog';

export function RolesPage() {
  const roles = useRoles();
  const canManage = useCan('rbac:manage');
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Roles bundle permissions. Assignments add a scope: university-wide, a faculty/school, or a department."
        actions={canManage ? <CreateRoleDialog /> : undefined}
      />
      <DataTable<RoleDto>
        caption="Roles"
        isLoading={roles.isPending}
        error={roles.error}
        onRetry={() => void roles.refetch()}
        rows={roles.data}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/admin/roles/${r.id}`)}
        emptyTitle="No roles"
        columns={[
          {
            key: 'name',
            header: 'Role',
            cell: (r) => (
              <div>
                <p className="font-medium">{r.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{r.key}</p>
              </div>
            ),
          },
          {
            key: 'type',
            header: 'Type',
            cell: (r) => (
              <div className="flex flex-wrap gap-1.5">
                <StatusBadge tone={r.isSystem ? 'info' : 'neutral'}>
                  {r.isSystem ? 'System' : 'Custom'}
                </StatusBadge>
                {r.scopeMode === 'RELATIONSHIP' && (
                  <StatusBadge tone="neutral">Own records only</StatusBadge>
                )}
              </div>
            ),
            hideOnMobile: true,
          },
          {
            key: 'perms',
            header: 'Permissions',
            cell: (r) => <span className="tabular-nums">{r.permissions.length}</span>,
          },
          {
            key: 'assignments',
            header: 'Assignments',
            cell: (r) => <span className="tabular-nums">{r.assignmentCount}</span>,
            hideOnMobile: true,
          },
        ]}
      />
    </>
  );
}
