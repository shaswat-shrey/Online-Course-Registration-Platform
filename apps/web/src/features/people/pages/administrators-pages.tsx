import { Plus } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { ACCOUNT_STATUSES } from '@ucrams/shared';
import { DetailList } from '@/components/shared/detail-list';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { UserAvatar } from '@/components/shared/user-avatar';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useListParams } from '@/hooks/use-list-params';
import { useCan } from '@/store/auth-store';
import { formatRelative, SCOPE_LABEL } from '@/utils/format';
import { useAdministrator, useAdministrators } from '../api/people-queries';
import { ACCOUNT_STATUS_LABEL, type AdminListItem } from '../api/types';
import { AccountCard } from '../components/account-card';
import { NewAdminDialog } from '../components/people-dialogs';
import { RolesCard } from '../components/roles-card';

const FILTERS = ['status'] as const;

export function AdministratorsPage() {
  const { page, q, filters, update } = useListParams(FILTERS);
  const admins = useAdministrators({ page, q, limit: 25, ...filters });
  const canAssignRoles = useCan('user:assign_roles');
  const canReadRoles = useCan('rbac:read');
  const canAssign = canAssignRoles && canReadRoles;
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Administrators"
        description="People with administrative roles, and where their roles apply."
        actions={
          canAssign ? (
            <NewAdminDialog
              onSaved={(a) => navigate(`/admin/administrators/${a.id}`)}
              trigger={(open) => (
                <Button onClick={open}>
                  <Plus className="size-4" /> New administrator
                </Button>
              )}
            />
          ) : undefined
        }
      />
      <ListToolbar>
        <SearchInput
          value={q}
          onChange={(v) => update({ q: v })}
          placeholder="Name or email"
          label="Search administrators"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          options={['INVITED', ...ACCOUNT_STATUSES].map((s) => ({
            value: s,
            label: ACCOUNT_STATUS_LABEL[s]!,
          }))}
          allLabel="All statuses"
        />
      </ListToolbar>
      <DataTable<AdminListItem>
        caption="Administrators"
        isLoading={admins.isPending}
        error={admins.error}
        onRetry={() => void admins.refetch()}
        rows={admins.data?.data}
        meta={admins.data?.meta && 'total' in admins.data.meta ? admins.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
        rowKey={(a) => a.id}
        onRowClick={(a) => navigate(`/admin/administrators/${a.id}`)}
        emptyTitle="No administrators match"
        columns={[
          {
            key: 'name',
            header: 'Name',
            cell: (a) => (
              <div>
                <p className="font-medium">
                  {a.firstName} {a.lastName}
                </p>
                <p className="text-xs text-muted-foreground">{a.jobTitle ?? a.email}</p>
              </div>
            ),
          },
          {
            key: 'roles',
            header: 'Roles',
            cell: (a) => (
              <ul className="space-y-0.5 text-sm">
                {a.roles.map((r) => (
                  <li key={r.id}>
                    {r.roleName}
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      · {r.scopeName ?? SCOPE_LABEL[r.scopeType]}
                    </span>
                  </li>
                ))}
              </ul>
            ),
          },
          {
            key: 'login',
            header: 'Last sign-in',
            cell: (a) => (a.lastLoginAt ? formatRelative(a.lastLoginAt) : 'Never'),
            hideOnMobile: true,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (a) => (
              <StatusBadge
                tone={
                  a.status === 'ACTIVE' ? 'success' : a.status === 'INVITED' ? 'info' : 'warning'
                }
              >
                {ACCOUNT_STATUS_LABEL[a.status]}
              </StatusBadge>
            ),
            hideOnMobile: true,
          },
        ]}
      />
    </>
  );
}

export function AdministratorDetailPage() {
  const { adminId = '' } = useParams();
  const admin = useAdministrator(adminId);
  const canManage = useCan('user:manage_status');
  if (admin.isPending) return <LoadingRows rows={5} />;
  if (admin.isError) return <ErrorState error={admin.error} onRetry={() => void admin.refetch()} />;
  const a = admin.data;
  return (
    <>
      <div className="mb-6 flex items-center gap-4">
        <UserAvatar
          firstName={a.firstName}
          lastName={a.lastName}
          url={a.avatarUrl}
          className="size-14 text-lg"
        />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {a.firstName} {a.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {a.jobTitle ?? 'Administrator'} · {a.email}
          </p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: 'Job title', value: a.jobTitle },
                  { label: 'Employee number', value: a.employeeNumber },
                  { label: 'Phone', value: a.phone },
                  { label: 'Office', value: a.officeDepartment?.name },
                ]}
              />
            </CardContent>
          </Card>
          <RolesCard userId={a.id} />
        </div>
        <AccountCard userId={a.id} account={a.account} canManage={canManage} />
      </div>
    </>
  );
}
