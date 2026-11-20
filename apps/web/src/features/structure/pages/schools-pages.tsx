import { Building2, Pencil, Plus } from 'lucide-react';
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
import { useCan } from '@/store/auth-store';
import { useDeleteSchool, useDepartments, useSchool, useSchools } from '../api/structure-queries';
import type { Department, School } from '../api/types';
import { DepartmentDialog, SchoolDialog } from '../components/entity-dialogs';
import { RowActions } from '../components/row-actions';

const FILTERS = ['status'] as const;

export function SchoolsPage() {
  const { page, q, filters, update } = useListParams(FILTERS);
  const schools = useSchools({ page, q, status: filters.status, limit: 20 });
  const canManage = useCan('school:manage');
  const remove = useDeleteSchool();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Faculties / schools"
        description="Top-level academic units. Each contains departments."
        actions={
          canManage ? (
            <SchoolDialog
              onSaved={(s) => navigate(`/admin/schools/${s.id}`)}
              trigger={(open) => (
                <Button onClick={open}>
                  <Plus className="size-4" /> New faculty
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
          label="Search faculties"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          options={STATUS_OPTIONS}
          allLabel="All statuses"
        />
      </ListToolbar>
      <DataTable<School>
        caption="Faculties and schools"
        isLoading={schools.isPending}
        error={schools.error}
        onRetry={() => void schools.refetch()}
        rows={schools.data?.data}
        meta={schools.data?.meta && 'total' in schools.data.meta ? schools.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
        rowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/admin/schools/${s.id}`)}
        emptyTitle={q || filters.status ? 'No matching faculties' : 'No faculties yet'}
        columns={[
          {
            key: 'name',
            header: 'Faculty / school',
            cell: (s) => (
              <div>
                <p className="font-medium">{s.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{s.code}</p>
              </div>
            ),
          },
          {
            key: 'campus',
            header: 'Campus',
            cell: (s) => s.campus?.name ?? '—',
            hideOnMobile: true,
          },
          {
            key: 'depts',
            header: 'Departments',
            cell: (s) => <span className="tabular-nums">{s.departmentCount}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (s) => <EntityStatus status={s.status} />,
            hideOnMobile: true,
          },
          {
            key: 'actions',
            header: '',
            cell: (s) =>
              canManage ? (
                <SchoolDialog
                  entity={s}
                  trigger={(open) => (
                    <RowActions
                      label={s.name}
                      onEdit={open}
                      onDelete={() => remove.mutateAsync(s.id)}
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

export function SchoolDetailPage() {
  const { schoolId = '' } = useParams();
  const school = useSchool(schoolId);
  const departments = useDepartments({ schoolId, limit: 100 });
  const canManageSchool = useCan('school:manage');
  const canCreateDept = useCan('department:manage');
  const navigate = useNavigate();
  if (school.isPending) return <LoadingRows rows={5} />;
  if (school.isError)
    return <ErrorState error={school.error} onRetry={() => void school.refetch()} />;
  const s = school.data;
  return (
    <>
      <PageHeader
        title={s.name}
        description={
          <span className="flex items-center gap-2">
            <span className="font-mono text-xs">{s.code}</span> <EntityStatus status={s.status} />
          </span>
        }
        actions={
          canManageSchool ? (
            <SchoolDialog
              entity={s}
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
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-secondary p-3">
                <p className="text-2xl font-semibold tabular-nums">{s.departmentCount}</p>
                <p className="text-xs text-muted-foreground">Departments</p>
              </div>
              <div className="rounded-lg bg-secondary p-3">
                <p className="text-2xl font-semibold tabular-nums">{s.programCount ?? 0}</p>
                <p className="text-xs text-muted-foreground">Programs</p>
              </div>
            </div>
            <DetailList
              items={[
                { label: 'Campus', value: s.campus?.name },
                { label: 'Email', value: s.contactEmail },
                { label: 'Phone', value: s.contactPhone },
                { label: 'Website', value: s.website },
              ]}
            />
            {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4 text-brand" /> Departments
            </CardTitle>
            {canCreateDept && s.status === 'ACTIVE' && (
              <DepartmentDialog
                defaultSchoolId={s.id}
                onSaved={(d) => navigate(`/admin/departments/${d.id}`)}
                trigger={(open) => (
                  <Button size="sm" onClick={open}>
                    <Plus className="size-4" /> New department
                  </Button>
                )}
              />
            )}
          </CardHeader>
          <CardContent>
            <DataTable<Department>
              caption={`Departments of ${s.name}`}
              isLoading={departments.isPending}
              error={departments.error}
              rows={departments.data?.data}
              rowKey={(d) => d.id}
              onRowClick={(d) => navigate(`/admin/departments/${d.id}`)}
              emptyTitle="No departments yet"
              columns={[
                {
                  key: 'name',
                  header: 'Department',
                  cell: (d) => (
                    <Link
                      to={`/admin/departments/${d.id}`}
                      className="font-medium hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {d.name}
                    </Link>
                  ),
                },
                {
                  key: 'code',
                  header: 'Code',
                  cell: (d) => <span className="font-mono text-xs">{d.code}</span>,
                },
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
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
