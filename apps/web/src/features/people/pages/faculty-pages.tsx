import { FileUp, Pencil, Plus } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { DetailList } from '@/components/shared/detail-list';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { UserAvatar } from '@/components/shared/user-avatar';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDepartmentOptions, useSchoolOptions } from '@/features/structure/api/structure-queries';
import { useListParams } from '@/hooks/use-list-params';
import { useCan } from '@/store/auth-store';
import { formatDate } from '@/utils/timezone';
import { useFacultyList, useFacultyMember } from '../api/people-queries';
import { DESIGNATION_LABEL, type FacultyListItem } from '../api/types';
import { AccountCard } from '../components/account-card';
import { FacultyDialog } from '../components/people-dialogs';
import { RolesCard } from '../components/roles-card';

const FILTERS = ['schoolId', 'departmentId', 'designation', 'employmentStatus'] as const;
const EMPLOYMENT: Record<string, string> = {
  ACTIVE: 'Active',
  ON_LEAVE: 'On leave',
  INACTIVE: 'Inactive',
};

export function FacultyPage() {
  const { page, q, filters, update } = useListParams(FILTERS);
  const faculty = useFacultyList({ page, q, limit: 25, ...filters });
  const schools = useSchoolOptions();
  const departments = useDepartmentOptions(filters.schoolId || undefined);
  const canCreate = useCan('faculty:create');
  const canImport = useCan('faculty:import');
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Faculty"
        description="Teaching staff in your scope."
        actions={
          <>
            {canImport && (
              <Button variant="outline" asChild>
                <Link to="/admin/imports/new?kind=faculty">
                  <FileUp className="size-4" /> Import
                </Link>
              </Button>
            )}
            {canCreate && (
              <FacultyDialog
                defaultDepartmentId={filters.departmentId || undefined}
                onSaved={(f) => navigate(`/admin/faculty/${f.id}`)}
                trigger={(open) => (
                  <Button onClick={open}>
                    <Plus className="size-4" /> New faculty member
                  </Button>
                )}
              />
            )}
          </>
        }
      />
      <ListToolbar>
        <SearchInput
          value={q}
          onChange={(v) => update({ q: v })}
          placeholder="Name, email or employee number"
          label="Search faculty"
        />
        <FilterSelect
          label="Faculty"
          value={filters.schoolId}
          onChange={(v) => update({ schoolId: v, departmentId: null })}
          options={(schools.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          allLabel="All faculties"
        />
        <FilterSelect
          label="Department"
          value={filters.departmentId}
          onChange={(v) => update({ departmentId: v })}
          options={(departments.data?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          allLabel="All departments"
        />
        <FilterSelect
          label="Designation"
          value={filters.designation}
          onChange={(v) => update({ designation: v })}
          options={Object.entries(DESIGNATION_LABEL).map(([value, label]) => ({ value, label }))}
          allLabel="All designations"
        />
        <FilterSelect
          label="Employment"
          value={filters.employmentStatus}
          onChange={(v) => update({ employmentStatus: v })}
          options={Object.entries(EMPLOYMENT).map(([value, label]) => ({ value, label }))}
          allLabel="Any employment"
        />
      </ListToolbar>
      <DataTable<FacultyListItem>
        caption="Faculty"
        isLoading={faculty.isPending}
        error={faculty.error}
        onRetry={() => void faculty.refetch()}
        rows={faculty.data?.data}
        meta={faculty.data?.meta && 'total' in faculty.data.meta ? faculty.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
        rowKey={(f) => f.id}
        onRowClick={(f) => navigate(`/admin/faculty/${f.id}`)}
        emptyTitle={
          q || Object.values(filters).some(Boolean) ? 'No matching faculty' : 'No faculty yet'
        }
        columns={[
          {
            key: 'name',
            header: 'Name',
            cell: (f) => (
              <div>
                <p className="font-medium">
                  {f.firstName} {f.lastName}
                </p>
                <p className="text-xs text-muted-foreground">{f.email}</p>
              </div>
            ),
          },
          {
            key: 'designation',
            header: 'Designation',
            cell: (f) => DESIGNATION_LABEL[f.designation],
            hideOnMobile: true,
          },
          {
            key: 'dept',
            header: 'Department',
            cell: (f) => (
              <span>
                {f.department.name}
                {f.headOf.length > 0 && (
                  <StatusBadge tone="info" className="ml-2">
                    Head
                  </StatusBadge>
                )}
              </span>
            ),
            hideOnMobile: true,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (f) => (
              <StatusBadge tone={f.employmentStatus === 'ACTIVE' ? 'success' : 'neutral'}>
                {EMPLOYMENT[f.employmentStatus]}
              </StatusBadge>
            ),
          },
        ]}
      />
    </>
  );
}

export function FacultyDetailPage() {
  const { facultyId = '' } = useParams();
  const member = useFacultyMember(facultyId);
  if (member.isPending) return <LoadingRows rows={6} />;
  if (member.isError)
    return <ErrorState error={member.error} onRetry={() => void member.refetch()} />;
  const f = member.data;
  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <UserAvatar
            firstName={f.firstName}
            lastName={f.lastName}
            url={f.avatarUrl}
            className="size-14 text-lg"
          />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {f.firstName} {f.lastName}
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {DESIGNATION_LABEL[f.designation]} · {f.department.name}
              {f.employeeNumber && <span className="font-mono text-xs">{f.employeeNumber}</span>}
              {f.headOf.map((d) => (
                <StatusBadge key={d.id} tone="info">
                  Head, {d.name}
                </StatusBadge>
              ))}
              {f.deanOf.map((s) => (
                <StatusBadge key={s.id} tone="info">
                  Dean, {s.name}
                </StatusBadge>
              ))}
            </p>
          </div>
        </div>
        {f.permissions?.edit && (
          <FacultyDialog
            entity={f}
            trigger={(open) => (
              <Button variant="outline" onClick={open}>
                <Pencil className="size-4" /> Edit
              </Button>
            )}
          />
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: 'Email', value: f.email },
                { label: 'Phone', value: f.phone },
                { label: 'Office', value: f.officeLocation },
                { label: 'Office hours', value: f.officeHours },
                {
                  label: 'Joint appointments',
                  value: f.secondaryDepartments.length
                    ? f.secondaryDepartments.map((d) => d.name).join(', ')
                    : 'None',
                },
                { label: 'Specialization', value: f.specialization },
                { label: 'Qualifications', value: f.qualifications },
                { label: 'Research interests', value: f.researchInterests },
                ...(f.restricted
                  ? []
                  : [
                      {
                        label: 'Employment',
                        value:
                          f.employmentStatus === 'ACTIVE'
                            ? 'Active'
                            : f.employmentStatus === 'ON_LEAVE'
                              ? 'On leave'
                              : 'Inactive',
                      },
                      {
                        label: 'Max teaching load',
                        value:
                          f.maxLoadCredits !== null && f.maxLoadCredits !== undefined
                            ? `${f.maxLoadCredits} credits`
                            : 'Not set',
                      },
                      { label: 'Joined', value: f.joinedOn ? formatDate(f.joinedOn) : null },
                    ]),
              ]}
            />
            <p className="mt-4 text-xs text-muted-foreground">
              Teaching assignments and workload appear once course sections are set up.
            </p>
          </CardContent>
        </Card>
        {f.account && (
          <div className="grid gap-4">
            <AccountCard
              userId={f.userId}
              account={f.account}
              canManage={f.permissions?.manageAccount ?? false}
            />
            <RolesCard userId={f.userId} />
          </div>
        )}
      </div>
    </>
  );
}
