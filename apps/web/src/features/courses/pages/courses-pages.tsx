import {
  BookOpen,
  CalendarRange,
  Link2,
  ListChecks,
  Pencil,
  Plus,
  ShieldAlert,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { COURSE_CATEGORIES, COURSE_STATUSES } from '@ucrams/shared';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailList } from '@/components/shared/detail-list';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useListParams } from '@/hooks/use-list-params';
import { SESSION_TYPE_LABEL } from '@/features/calendar/api/calendar-queries';
import { useDepartmentOptions } from '@/features/structure/api/structure-queries';
import { CATEGORY_LABEL } from '@/features/structure/api/types';
import { errorMessage } from '@/services/api-error';
import { useCan } from '@/store/auth-store';
import {
  useCourse,
  useCourses,
  useDeleteCourse,
  useSaveCourse,
  useSections,
  useSetCourseRelation,
} from '../api/courses-queries';
import { COURSE_STATUS_LABEL, type Course, type CourseDetail, type Section } from '../api/types';
import {
  CorequisitesDialog,
  CourseDialog,
  PrerequisitesDialog,
} from '../components/course-dialogs';
import {
  MappingsDialog,
  RestrictionList,
  RestrictionsDialog,
} from '../components/relation-dialogs';
import { meetingLabel, SectionDialog } from '../components/section-dialogs';
import { SectionStatusBadge } from './sections-pages';

export const COURSE_TONE: Record<string, StatusTone> = {
  DRAFT: 'info',
  ACTIVE: 'success',
  INACTIVE: 'warning',
  ARCHIVED: 'neutral',
};
export function CourseStatusBadge({ status }: { status: string }) {
  return (
    <StatusBadge tone={COURSE_TONE[status] ?? 'neutral'}>
      {COURSE_STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

const FILTERS = ['status', 'departmentId', 'category', 'level'] as const;

export function CoursesPage() {
  const { page, q, filters, update } = useListParams(FILTERS);
  const courses = useCourses({ page, q, limit: 25, ...filters });
  const departments = useDepartmentOptions();
  const canCreate = useCan('course:create');
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Courses"
        description="The course catalog: credits, prerequisites, program mappings and restrictions."
        actions={
          canCreate ? (
            <CourseDialog
              defaultDepartmentId={filters.departmentId || undefined}
              onSaved={(c) => navigate(`/admin/courses/${c.id}`)}
              trigger={(open) => (
                <Button onClick={open}>
                  <Plus className="size-4" /> New course
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
          placeholder="Code, title or topic"
          label="Search courses"
        />
        <FilterSelect
          label="Department"
          value={filters.departmentId}
          onChange={(v) => update({ departmentId: v })}
          options={(departments.data?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          allLabel="All departments"
        />
        <FilterSelect
          label="Category"
          value={filters.category}
          onChange={(v) => update({ category: v })}
          options={COURSE_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] ?? c }))}
          allLabel="All categories"
        />
        <FilterSelect
          label="Level"
          value={filters.level}
          onChange={(v) => update({ level: v })}
          options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map((l) => ({
            value: String(l),
            label: `${l} level`,
          }))}
          allLabel="All levels"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          options={COURSE_STATUSES.map((s) => ({ value: s, label: COURSE_STATUS_LABEL[s]! }))}
          allLabel="All statuses"
        />
      </ListToolbar>
      <DataTable<Course>
        caption="Courses"
        isLoading={courses.isPending}
        error={courses.error}
        onRetry={() => void courses.refetch()}
        rows={courses.data?.data}
        meta={courses.data?.meta && 'total' in courses.data.meta ? courses.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/admin/courses/${c.id}`)}
        emptyTitle={
          Object.values(filters).some(Boolean) || q ? 'No matching courses' : 'No courses yet'
        }
        columns={[
          {
            key: 'course',
            header: 'Course',
            cell: (c) => (
              <div className="min-w-0">
                <p className="font-medium">
                  <span className="font-mono">{c.code}</span> · {c.title}
                </p>
                <p className="text-xs text-muted-foreground">{c.department.name}</p>
              </div>
            ),
          },
          {
            key: 'category',
            header: 'Category',
            cell: (c) => CATEGORY_LABEL[c.category] ?? c.category,
            hideOnMobile: true,
          },
          {
            key: 'credits',
            header: 'Credits',
            cell: (c) => <span className="tabular-nums">{c.credits}</span>,
          },
          { key: 'level', header: 'Level', cell: (c) => c.level, hideOnMobile: true },
          {
            key: 'sections',
            header: 'Sections',
            cell: (c) => <span className="tabular-nums">{c.sectionCount}</span>,
            hideOnMobile: true,
          },
          { key: 'status', header: 'Status', cell: (c) => <CourseStatusBadge status={c.status} /> },
        ]}
      />
    </>
  );
}

function StatusActions({ course }: { course: CourseDetail }) {
  const save = useSaveCourse();
  const remove = useDeleteCourse();
  const navigate = useNavigate();
  const setStatus = (status: string, done: string) =>
    save.mutate(
      { id: course.id, status },
      { onSuccess: () => toast.success(done), onError: (e) => toast.error(errorMessage(e)) },
    );
  const actions = [];
  if (course.canManage && (course.status === 'DRAFT' || course.status === 'INACTIVE'))
    actions.push(
      <Button
        key="activate"
        onClick={() => setStatus('ACTIVE', 'Course activated')}
        disabled={save.isPending}
      >
        Activate
      </Button>,
    );
  if (course.canManage && course.status === 'ACTIVE')
    actions.push(
      <ConfirmDialog
        key="deactivate"
        trigger={<Button variant="outline">Deactivate</Button>}
        title={`Deactivate ${course.code}?`}
        description="Students no longer see it in the catalog. Existing records and completed sections are kept."
        confirmLabel="Deactivate"
        onConfirm={() => setStatus('INACTIVE', 'Course deactivated')}
      />,
    );
  if (course.canArchive && course.status !== 'ARCHIVED')
    actions.push(
      <ConfirmDialog
        key="archive"
        trigger={<Button variant="outline">Archive</Button>}
        title={`Archive ${course.code}?`}
        description="Archived courses stay on transcripts but cannot be offered. You can restore it later."
        confirmLabel="Archive"
        onConfirm={() => setStatus('ARCHIVED', 'Course archived')}
      />,
    );
  if (course.canArchive && course.status === 'ARCHIVED')
    actions.push(
      <Button
        key="restore"
        variant="outline"
        onClick={() => setStatus('INACTIVE', 'Course restored as inactive')}
      >
        Restore
      </Button>,
    );
  if (course.canManage && course.status === 'DRAFT')
    actions.push(
      <ConfirmDialog
        key="delete"
        trigger={
          <Button variant="outline" className="text-destructive">
            Delete
          </Button>
        }
        title={`Delete ${course.code}?`}
        description="Only unreferenced draft courses can be deleted. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() =>
          remove.mutate(course.id, {
            onSuccess: () => {
              toast.success('Course deleted');
              navigate('/admin/courses');
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />,
    );
  return <>{actions}</>;
}

function Prerequisites({ course }: { course: CourseDetail }) {
  if (!course.prerequisites.length) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ol className="space-y-2 text-sm">
      {course.prerequisites.map((g, i) => (
        <li key={g.id} className="flex flex-wrap items-center gap-1">
          {i > 0 && <span className="mr-1 text-xs font-semibold text-muted-foreground">AND</span>}
          {g.items.map((item, j) => (
            <span key={item.course.id} className="inline-flex items-center gap-1">
              {j > 0 && <span className="text-xs font-semibold text-muted-foreground">or</span>}
              <Link
                to={`/admin/courses/${item.course.id}`}
                className="rounded border px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
              >
                {item.course.code}
              </Link>
              {item.minGradeLetter && (
                <span className="text-xs text-muted-foreground">(min {item.minGradeLetter})</span>
              )}
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}

function CourseSections({ course }: { course: CourseDetail }) {
  const sections = useSections({ courseId: course.id, limit: 50, sort: 'createdAt:desc' });
  const canCreate = useCan('section:create');
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="size-4 text-brand" /> Sections
        </CardTitle>
        {canCreate &&
          course.canManage &&
          (course.status === 'ACTIVE' || course.status === 'DRAFT') && (
            <SectionDialog
              defaultCourse={course}
              onSaved={(s) => navigate(`/admin/sections/${s.id}`)}
              trigger={(open) => (
                <Button size="sm" onClick={open}>
                  <Plus className="size-4" /> New section
                </Button>
              )}
            />
          )}
      </CardHeader>
      <CardContent>
        <DataTable<Section>
          caption={`Sections of ${course.code}`}
          isLoading={sections.isPending}
          error={sections.error}
          rows={sections.data?.data}
          rowKey={(s) => s.id}
          onRowClick={(s) => navigate(`/admin/sections/${s.id}`)}
          emptyTitle="No sections yet"
          columns={[
            { key: 'session', header: 'Session', cell: (s) => s.session.name },
            {
              key: 'code',
              header: 'Section',
              cell: (s) => <span className="font-mono">{s.sectionCode}</span>,
            },
            {
              key: 'when',
              header: 'Meets',
              cell: (s) => s.meetings.map(meetingLabel).join(', ') || '—',
              hideOnMobile: true,
            },
            {
              key: 'instructor',
              header: 'Instructor',
              cell: (s) => s.instructors.find((i) => i.role === 'PRIMARY')?.name ?? 'TBA',
              hideOnMobile: true,
            },
            {
              key: 'seats',
              header: 'Enrolled',
              cell: (s) => (
                <span className="tabular-nums">
                  {s.enrolledCount}/{s.capacity}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              cell: (s) => <SectionStatusBadge status={s.status} />,
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

export function CourseDetailPage() {
  const { courseId = '' } = useParams();
  const course = useCourse(courseId);
  const restrictions = useSetCourseRelation(courseId);
  if (course.isPending) return <LoadingRows rows={6} />;
  if (course.isError)
    return <ErrorState error={course.error} onRetry={() => void course.refetch()} />;
  const c = course.data;
  const edit = c.canManage;
  return (
    <>
      <PageHeader
        title={`${c.code} · ${c.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link to={`/admin/departments/${c.department.id}`} className="hover:underline">
              {c.department.name}
            </Link>
            · {c.credits} credits · {CATEGORY_LABEL[c.category] ?? c.category}
            <CourseStatusBadge status={c.status} />
          </span>
        }
        actions={
          <>
            {edit && (
              <CourseDialog
                course={c}
                trigger={(open) => (
                  <Button variant="outline" onClick={open}>
                    <Pencil className="size-4" /> Edit
                  </Button>
                )}
              />
            )}
            <StatusActions course={c} />
          </>
        }
      />
      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="requirements">Prerequisites</TabsTrigger>
          <TabsTrigger value="programs">
            Programs ({c.programs.length + c.specializations.length})
          </TabsTrigger>
          <TabsTrigger value="restrictions">Restrictions ({c.restrictions.length})</TabsTrigger>
          <TabsTrigger value="sections">Sections ({c.sectionCount})</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="size-4 text-brand" /> About
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="whitespace-pre-line">{c.description ?? 'No description yet.'}</p>
              <div>
                <h3 className="mb-1 font-medium">Learning outcomes</h3>
                {c.outcomes.length ? (
                  <ol className="list-decimal space-y-1 pl-5">
                    {c.outcomes.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-muted-foreground">None listed.</p>
                )}
              </div>
              <div>
                <h3 className="mb-1 font-medium">Assessment</h3>
                {c.assessmentComponents.length ? (
                  <ul className="space-y-1">
                    {c.assessmentComponents.map((a) => (
                      <li key={a.name} className="flex justify-between gap-4 border-b pb-1">
                        <span>{a.name}</span>
                        <span className="tabular-nums">{a.weight}%</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">Not specified.</p>
                )}
              </div>
              {c.syllabus && (
                <div>
                  <h3 className="mb-1 font-medium">Syllabus</h3>
                  <p className="whitespace-pre-line">{c.syllabus}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                columns={1}
                items={[
                  { label: 'Level', value: c.level },
                  {
                    label: 'Recommended',
                    value:
                      [
                        c.recommendedYear ? `Year ${c.recommendedYear}` : null,
                        c.recommendedSessionType
                          ? SESSION_TYPE_LABEL[c.recommendedSessionType]
                          : null,
                      ]
                        .filter(Boolean)
                        .join(', ') || '—',
                  },
                  {
                    label: 'Coordinator',
                    value: c.coordinator ? (
                      <Link className="hover:underline" to={`/admin/faculty/${c.coordinator.id}`}>
                        {c.coordinator.name}
                      </Link>
                    ) : (
                      'Not assigned'
                    ),
                  },
                  { label: 'Default capacity', value: c.defaultCapacity ?? '—' },
                  { label: 'Minimum enrollment', value: c.minEnrollment ?? '—' },
                  { label: 'Repeatable', value: c.isRepeatable ? 'Yes' : 'No' },
                  {
                    label: 'Requirement groups',
                    value: c.requirementGroups.length ? (
                      <ul className="space-y-0.5">
                        {c.requirementGroups.map((g) => (
                          <li key={g.id}>
                            {g.owner}: {g.name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      'None'
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="requirements" className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="size-4 text-brand" /> Prerequisites
                </CardTitle>
                <CardDescription>
                  Every group must be met; any course within a group counts.
                </CardDescription>
              </div>
              {edit && (
                <PrerequisitesDialog
                  course={c}
                  trigger={(open) => (
                    <Button size="sm" variant="outline" onClick={open}>
                      Edit
                    </Button>
                  )}
                />
              )}
            </CardHeader>
            <CardContent>
              <Prerequisites course={c} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="size-4 text-brand" /> Corequisites
                </CardTitle>
                <CardDescription>Completed earlier or taken in the same session.</CardDescription>
              </div>
              {edit && (
                <CorequisitesDialog
                  course={c}
                  trigger={(open) => (
                    <Button size="sm" variant="outline" onClick={open}>
                      Edit
                    </Button>
                  )}
                />
              )}
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1">
              {c.corequisites.length ? (
                c.corequisites.map((r) => (
                  <Link
                    key={r.id}
                    to={`/admin/courses/${r.id}`}
                    className="rounded border px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
                  >
                    {r.code}
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">None.</p>
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Required by</CardTitle>
              <CardDescription>Courses that list {c.code} as a prerequisite.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1">
              {c.requiredBy.length ? (
                c.requiredBy.map((r) => (
                  <Link
                    key={r.id}
                    to={`/admin/courses/${r.id}`}
                    className="rounded border px-1.5 py-0.5 text-xs hover:bg-accent"
                  >
                    <span className="font-mono">{r.code}</span> {r.title}
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No course depends on it.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="programs">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <CardTitle className="text-base">Programs and specializations</CardTitle>
              {edit && (
                <MappingsDialog
                  course={c}
                  trigger={(open) => (
                    <Button size="sm" variant="outline" onClick={open}>
                      Edit
                    </Button>
                  )}
                />
              )}
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {c.programs.length + c.specializations.length === 0 && (
                <p className="text-muted-foreground">Not mapped to any program.</p>
              )}
              <ul className="space-y-1">
                {c.programs.map((p) => (
                  <li key={p.id} className="flex justify-between gap-4 border-b pb-1">
                    <Link className="hover:underline" to={`/admin/programs/${p.id}`}>
                      {p.name}{' '}
                      <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
                    </Link>
                    <StatusBadge tone={p.mappingType === 'CORE' ? 'info' : 'neutral'}>
                      {p.mappingType === 'CORE' ? 'Core' : 'Elective'}
                    </StatusBadge>
                  </li>
                ))}
                {c.specializations.map((s) => (
                  <li key={s.id} className="flex justify-between gap-4 border-b pb-1">
                    <span>
                      {s.name}{' '}
                      <span className="text-xs text-muted-foreground">
                        ({s.program.code} specialization)
                      </span>
                    </span>
                    <StatusBadge tone={s.mappingType === 'CORE' ? 'info' : 'neutral'}>
                      {s.mappingType === 'CORE' ? 'Core' : 'Elective'}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="restrictions">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert className="size-4 text-brand" /> Who may register
                </CardTitle>
                <CardDescription>
                  Applies to every section; sections can add their own rules.
                </CardDescription>
              </div>
              {edit && (
                <RestrictionsDialog
                  title={`Restrictions for ${c.code}`}
                  initial={c.restrictions}
                  saving={restrictions.isPending}
                  onSave={(body) => restrictions.mutateAsync({ relation: 'restrictions', body })}
                  trigger={(open) => (
                    <Button size="sm" variant="outline" onClick={open}>
                      Edit
                    </Button>
                  )}
                />
              )}
            </CardHeader>
            <CardContent>
              <RestrictionList rules={c.restrictions} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="sections">
          <CourseSections course={c} />
        </TabsContent>
      </Tabs>
    </>
  );
}
