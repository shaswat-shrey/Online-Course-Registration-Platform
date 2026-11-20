import { ListChecks, Pencil, Plus } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { useSetRequirementCourses } from '@/features/courses/api/courses-queries';
import { CourseListDialog } from '@/features/courses/components/course-dialogs';
import { DetailList } from '@/components/shared/detail-list';
import { EntityStatus, STATUS_OPTIONS } from '@/components/shared/entity-status';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useListParams } from '@/hooks/use-list-params';
import { useCan } from '@/store/auth-store';
import {
  useDegrees,
  useDeleteProgram,
  useDeleteRequirementGroup,
  useDeleteSpecialization,
  useProgram,
  usePrograms,
  useSchoolOptions,
} from '../api/structure-queries';
import {
  CATEGORY_LABEL,
  DEGREE_LEVEL_LABEL,
  REQUIREMENT_KIND_LABEL,
  type Program,
  type RequirementGroup,
  type Specialization,
} from '../api/types';
import {
  ProgramDialog,
  RequirementGroupDialog,
  SpecializationDialog,
} from '../components/entity-dialogs';
import { RowActions } from '../components/row-actions';

const FILTERS = ['status', 'schoolId', 'degreeId', 'level'] as const;

export function ProgramsPage() {
  const { page, q, filters, update } = useListParams(FILTERS);
  const programs = usePrograms({ page, q, limit: 20, ...filters });
  const schools = useSchoolOptions();
  const degrees = useDegrees();
  const canCreate = useCan('program:manage');
  const remove = useDeleteProgram();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Programs"
        description="Degree programs offered by departments, with their specializations and requirements."
        actions={
          canCreate ? (
            <ProgramDialog
              onSaved={(p) => navigate(`/admin/programs/${p.id}`)}
              trigger={(open) => (
                <Button onClick={open}>
                  <Plus className="size-4" /> New program
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
          label="Search programs"
        />
        <FilterSelect
          label="Faculty"
          value={filters.schoolId}
          onChange={(v) => update({ schoolId: v })}
          options={(schools.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          allLabel="All faculties"
        />
        <FilterSelect
          label="Level"
          value={filters.level}
          onChange={(v) => update({ level: v })}
          options={Object.entries(DEGREE_LEVEL_LABEL).map(([value, label]) => ({ value, label }))}
          allLabel="All levels"
        />
        <FilterSelect
          label="Degree"
          value={filters.degreeId}
          onChange={(v) => update({ degreeId: v })}
          options={(degrees.data ?? []).map((d) => ({ value: d.id, label: d.code }))}
          allLabel="All degrees"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          options={STATUS_OPTIONS}
          allLabel="All statuses"
        />
      </ListToolbar>
      <DataTable<Program>
        caption="Programs"
        isLoading={programs.isPending}
        error={programs.error}
        onRetry={() => void programs.refetch()}
        rows={programs.data?.data}
        meta={programs.data?.meta && 'total' in programs.data.meta ? programs.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
        rowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/admin/programs/${p.id}`)}
        emptyTitle={
          Object.values(filters).some(Boolean) || q ? 'No matching programs' : 'No programs yet'
        }
        columns={[
          {
            key: 'name',
            header: 'Program',
            cell: (p) => (
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{p.code}</p>
              </div>
            ),
          },
          { key: 'dept', header: 'Department', cell: (p) => p.department.name, hideOnMobile: true },
          { key: 'degree', header: 'Degree', cell: (p) => p.degree.code, hideOnMobile: true },
          {
            key: 'duration',
            header: 'Duration',
            cell: (p) => `${p.durationYears} yrs · ${p.sessionCount} sessions`,
            hideOnMobile: true,
          },
          {
            key: 'credits',
            header: 'Credits',
            cell: (p) => <span className="tabular-nums">{p.totalCredits}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (p) => <EntityStatus status={p.status} />,
            hideOnMobile: true,
          },
          {
            key: 'actions',
            header: '',
            cell: (p) =>
              p.canManage ? (
                <ProgramDialog
                  entity={p}
                  trigger={(open) => (
                    <RowActions
                      label={p.name}
                      onEdit={open}
                      onDelete={() => remove.mutateAsync(p.id)}
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

function RequirementCourses({ group, canManage }: { group: RequirementGroup; canManage: boolean }) {
  const save = useSetRequirementCourses();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {group.courses.length === 0 && (
        <span className="text-xs text-muted-foreground">No courses listed yet.</span>
      )}
      {group.courses.map((c) => (
        <Link
          key={c.id}
          to={`/admin/courses/${c.id}`}
          title={c.title}
          className="rounded border px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
        >
          {c.code}
        </Link>
      ))}
      {canManage && (
        <CourseListDialog
          title={`Courses for “${group.name}”`}
          description={
            group.kind === 'ALL_OF'
              ? 'Students must complete every course listed.'
              : 'Students earn the required credits from these courses.'
          }
          initial={group.courses}
          submitLabel="Save courses"
          saving={save.isPending}
          onSave={(courseIds) =>
            save
              .mutateAsync({ groupId: group.id, courseIds })
              .then(() => toast.success('Requirement courses saved'))
          }
          trigger={(open) => (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={open}>
              Edit courses
            </Button>
          )}
        />
      )}
    </div>
  );
}

function RequirementList({
  groups,
  owner,
  canManage,
}: {
  groups: RequirementGroup[];
  owner: { programId: string } | { specializationId: string };
  canManage: boolean;
}) {
  const remove = useDeleteRequirementGroup();
  if (groups.length === 0)
    return (
      <EmptyState
        title="No requirements yet"
        description="Add requirement groups that make up the degree."
      />
    );
  return (
    <ul className="divide-y rounded-lg border">
      {groups.map((g) => (
        <li key={g.id} className="flex items-start gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{g.name}</p>
            <p className="text-sm text-muted-foreground">
              {REQUIREMENT_KIND_LABEL[g.kind]}
              {g.minCredits !== null && ` · ${g.minCredits} credits`}
              {g.category && ` · ${CATEGORY_LABEL[g.category]}`}
            </p>
            {(g.kind === 'ALL_OF' || g.kind === 'CREDITS_FROM_LIST') && (
              <RequirementCourses group={g} canManage={canManage} />
            )}
          </div>
          {canManage && (
            <RequirementGroupDialog
              entity={g}
              owner={owner}
              trigger={(open) => (
                <RowActions
                  label={g.name}
                  onEdit={open}
                  onDelete={() => remove.mutateAsync(g.id)}
                />
              )}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function SpecializationCard({ spec, canManage }: { spec: Specialization; canManage: boolean }) {
  const remove = useDeleteSpecialization();
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base">{spec.name}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{spec.code}</span>
            {spec.additionalCredits !== null && <span>+{spec.additionalCredits} credits</span>}
            <EntityStatus status={spec.status} />
          </CardDescription>
        </div>
        {canManage && (
          <SpecializationDialog
            entity={spec}
            programId={spec.programId}
            trigger={(open) => (
              <RowActions
                label={spec.name}
                onEdit={open}
                onDelete={() => remove.mutateAsync(spec.id)}
              />
            )}
          />
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <RequirementList
          groups={spec.requirementGroups ?? []}
          owner={{ specializationId: spec.id }}
          canManage={canManage}
        />
        {canManage && (
          <RequirementGroupDialog
            owner={{ specializationId: spec.id }}
            trigger={(open) => (
              <Button variant="outline" size="sm" onClick={open}>
                <Plus className="size-4" /> Add requirement
              </Button>
            )}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function ProgramDetailPage() {
  const { programId = '' } = useParams();
  const program = useProgram(programId);
  if (program.isPending) return <LoadingRows rows={6} />;
  if (program.isError)
    return <ErrorState error={program.error} onRetry={() => void program.refetch()} />;
  const p = program.data;
  const allocated = (p.requirementGroups ?? []).reduce((sum, g) => sum + (g.minCredits ?? 0), 0);
  return (
    <>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{p.code}</span> ·
            <Link to={`/admin/departments/${p.department.id}`} className="hover:underline">
              {p.department.name}
            </Link>
            <EntityStatus status={p.status} />
          </span>
        }
        actions={
          p.canManage ? (
            <ProgramDialog
              entity={p}
              trigger={(open) => (
                <Button variant="outline" onClick={open}>
                  <Pencil className="size-4" /> Edit
                </Button>
              )}
            />
          ) : undefined
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          ['Total credits', p.totalCredits],
          ['Duration', `${p.durationYears} years`],
          ['Sessions', p.sessionCount],
          ['Specializations', p.specializationCount],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-card p-4">
            <p className="text-xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <Tabs defaultValue="requirements">
        <TabsList>
          <TabsTrigger value="requirements">Requirements</TabsTrigger>
          <TabsTrigger value="specializations">
            Specializations ({p.specializations?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="requirements" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="size-4 text-brand" /> Program requirements
                </CardTitle>
                <CardDescription>
                  {allocated} of {p.totalCredits} credits allocated to credit-based groups.{' '}
                  {allocated > p.totalCredits ? (
                    <StatusBadge tone="danger">Over budget</StatusBadge>
                  ) : null}
                </CardDescription>
              </div>
              {p.canManage && (
                <RequirementGroupDialog
                  owner={{ programId: p.id }}
                  trigger={(open) => (
                    <Button size="sm" onClick={open}>
                      <Plus className="size-4" /> Add requirement
                    </Button>
                  )}
                />
              )}
            </CardHeader>
            <CardContent>
              <RequirementList
                groups={p.requirementGroups ?? []}
                owner={{ programId: p.id }}
                canManage={p.canManage}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="specializations" className="mt-4 space-y-4">
          {p.canManage && p.status === 'ACTIVE' && (
            <SpecializationDialog
              programId={p.id}
              trigger={(open) => (
                <Button size="sm" onClick={open}>
                  <Plus className="size-4" /> New specialization
                </Button>
              )}
            />
          )}
          {(p.specializations ?? []).length === 0 ? (
            <EmptyState
              title="No specializations"
              description="This program has no specializations."
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
              {p.specializations!.map((s) => (
                <SpecializationCard key={s.id} spec={s} canManage={p.canManage} />
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="details" className="mt-4">
          <Card>
            <CardContent>
              <DetailList
                items={[
                  { label: 'Degree', value: `${p.degree.name} (${p.degree.code})` },
                  { label: 'Level', value: DEGREE_LEVEL_LABEL[p.degree.level] },
                  { label: 'Owning department', value: p.department.name },
                  { label: 'Minimum core credits', value: p.minCoreCredits ?? 'Not set' },
                  { label: 'Minimum elective credits', value: p.minElectiveCredits ?? 'Not set' },
                  { label: 'Description', value: p.description },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
