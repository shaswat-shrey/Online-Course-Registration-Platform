import { GraduationCap, Pencil, Plus } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { DetailList } from '@/components/shared/detail-list';
import { EntityStatus, STATUS_OPTIONS } from '@/components/shared/entity-status';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useListParams } from '@/hooks/use-list-params';
import { useCanAt } from '@/store/auth-store';
import {
  useDeleteDepartment,
  useDepartment,
  useDepartments,
  usePrograms,
  useSchoolOptions,
} from '../api/structure-queries';
import type { Department, Program } from '../api/types';
import { DepartmentDialog, ProgramDialog } from '../components/entity-dialogs';
import { DepartmentHeadField } from '../components/leader-field';
import { RowActions } from '../components/row-actions';

const FILTERS = ['status', 'schoolId'] as const;

export function DepartmentsPage() {
  const { page, q, filters, update } = useListParams(FILTERS);
  const departments = useDepartments({
    page,
    q,
    status: filters.status,
    schoolId: filters.schoolId,
    limit: 20,
  });
  const schools = useSchoolOptions();
  // Department-scoped admins can edit their department but not create new ones (TD-010).
  const canCreate = useCanAt('department:manage', 'school-or-global');
  const remove = useDeleteDepartment();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Departments"
        description="Departments own programs and courses."
        actions={
          canCreate ? (
            <DepartmentDialog
              defaultSchoolId={filters.schoolId || undefined}
              onSaved={(d) => navigate(`/admin/departments/${d.id}`)}
              trigger={(open) => (
                <Button onClick={open}>
                  <Plus className="size-4" /> New department
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
          placeholder="Search name or code"
          label="Search departments"
        />
        <FilterSelect
          label="Faculty"
          value={filters.schoolId}
          onChange={(v) => update({ schoolId: v })}
          options={(schools.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          allLabel="All faculties"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          options={STATUS_OPTIONS}
          allLabel="All statuses"
        />
      </ListToolbar>
      <DataTable<Department>
        caption="Departments"
        isLoading={departments.isPending}
        error={departments.error}
        onRetry={() => void departments.refetch()}
        rows={departments.data?.data}
        meta={
          departments.data?.meta && 'total' in departments.data.meta
            ? departments.data.meta
            : undefined
        }
        onPageChange={(p) => update({ page: p }, false)}
        rowKey={(d) => d.id}
        onRowClick={(d) => navigate(`/admin/departments/${d.id}`)}
        emptyTitle={
          q || filters.status || filters.schoolId ? 'No matching departments' : 'No departments yet'
        }
        columns={[
          {
            key: 'name',
            header: 'Department',
            cell: (d) => (
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{d.code}</p>
              </div>
            ),
          },
          { key: 'school', header: 'Faculty', cell: (d) => d.school.name, hideOnMobile: true },
          {
            key: 'programs',
            header: 'Programs',
            cell: (d) => <span className="tabular-nums">{d.programCount}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (d) => <EntityStatus status={d.status} />,
            hideOnMobile: true,
          },
          {
            key: 'actions',
            header: '',
            cell: (d) =>
              d.canManage ? (
                <DepartmentDialog
                  entity={d}
                  trigger={(open) => (
                    <RowActions
                      label={d.name}
                      onEdit={open}
                      onDelete={() => remove.mutateAsync(d.id)}
                    />
                  )}
                />
              ) : null,
          },
        ]}
      />
    </>
  );
}

export function DepartmentDetailPage() {
  const { departmentId = '' } = useParams();
  const dept = useDepartment(departmentId);
  const programs = usePrograms({ departmentId, limit: 100 });
  const navigate = useNavigate();
  if (dept.isPending) return <LoadingRows rows={5} />;
  if (dept.isError) return <ErrorState error={dept.error} onRetry={() => void dept.refetch()} />;
  const d = dept.data;
  return (
    <>
      <PageHeader
        title={d.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{d.code}</span> ·
            <Link to={`/admin/schools/${d.school.id}`} className="hover:underline">
              {d.school.name}
            </Link>
            <EntityStatus status={d.status} />
          </span>
        }
        actions={
          d.canManage ? (
            <DepartmentDialog
              entity={d}
              trigger={(open) => (
                <Button variant="outline" onClick={open}>
                  <Pencil className="size-4" /> Edit
                </Button>
              )}
            />
          ) : undefined
        }
      />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Programs', d.programCount],
                ['Specializations', d.specializationCount ?? 0],
                ['Faculty', d.facultyCount],
                ['Active students', d.studentCount ?? 0],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-secondary p-3">
                  <p className="text-2xl font-semibold tabular-nums">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <DetailList
              items={[
                {
                  label: 'Head',
                  value: (
                    <DepartmentHeadField
                      departmentId={d.id}
                      head={d.head}
                      canManage={d.canManage}
                    />
                  ),
                },
                { label: 'Campus', value: d.campus?.name ?? 'Same as faculty' },
                { label: 'Office', value: d.officeLocation },
                { label: 'Email', value: d.contactEmail },
                { label: 'Phone', value: d.contactPhone },
              ]}
            />
            {d.description && <p className="text-sm text-muted-foreground">{d.description}</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="size-4 text-brand" /> Programs
            </CardTitle>
            {d.canManage && d.status === 'ACTIVE' && (
              <ProgramDialog
                defaultDepartmentId={d.id}
                onSaved={(p) => navigate(`/admin/programs/${p.id}`)}
                trigger={(open) => (
                  <Button size="sm" onClick={open}>
                    <Plus className="size-4" /> New program
                  </Button>
                )}
              />
            )}
          </CardHeader>
          <CardContent>
            <DataTable<Program>
              caption={`Programs of ${d.name}`}
              isLoading={programs.isPending}
              error={programs.error}
              rows={programs.data?.data}
              rowKey={(p) => p.id}
              onRowClick={(p) => navigate(`/admin/programs/${p.id}`)}
              emptyTitle="No programs yet"
              columns={[
                {
                  key: 'name',
                  header: 'Program',
                  cell: (p) => <span className="font-medium">{p.name}</span>,
                },
                { key: 'degree', header: 'Degree', cell: (p) => p.degree.code, hideOnMobile: true },
                {
                  key: 'credits',
                  header: 'Credits',
                  cell: (p) => <span className="tabular-nums">{p.totalCredits}</span>,
                },
                {
                  key: 'specs',
                  header: 'Specializations',
                  cell: (p) => <span className="tabular-nums">{p.specializationCount}</span>,
                  hideOnMobile: true,
                },
                {
                  key: 'status',
                  header: 'Status',
                  cell: (p) => <EntityStatus status={p.status} />,
                  hideOnMobile: true,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
