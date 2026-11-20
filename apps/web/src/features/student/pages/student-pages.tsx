import { CalendarPlus, CheckCircle2, Circle, CircleDot, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { COURSE_CATEGORIES } from '@ucrams/shared';
import type { PickerOption } from '@/components/forms/search-picker';
import { TextField } from '@/components/forms/form-field';
import { FormDialog } from '@/components/forms/form-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { WeekGrid } from '@/components/shared/week-grid';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useListParams } from '@/hooks/use-list-params';
import { MEETING_TYPE_LABEL } from '@/features/courses/api/types';
import { CoursePicker } from '@/features/courses/components/pickers';
import { meetingLabel } from '@/features/courses/components/section-dialogs';
import { RegistrationStatusBadge } from '@/features/registrations/components/registration-dialogs';
import { useDepartmentOptions } from '@/features/structure/api/structure-queries';
import { CATEGORY_LABEL } from '@/features/structure/api/types';
import { AnnouncementList, MaterialList } from '@/features/teaching/components/teaching-components';
import { useMaterials, useSectionAnnouncements } from '@/features/teaching/api/teaching-queries';
import { useSection } from '@/features/courses/api/courses-queries';
import { DiscussionBoard } from '@/features/communication/pages/discussion-pages';
import { errorMessage } from '@/services/api-error';
import {
  downloadTimetableIcs,
  useCatalog,
  useCatalogCourse,
  useCreatePlan,
  useDefaultSession,
  useDeletePlan,
  useHistory,
  useMyRegistrations,
  usePlans,
  usePlanValidation,
  useProgress,
  useRegisterPlan,
  useSavePlanItems,
  useTimetable,
} from '../api/student-queries';
import type {
  BatchResult,
  CatalogCourse,
  CatalogSession,
  CoursePlan,
  MyRegistration,
  RequirementState,
} from '../api/types';
import {
  DeadlineStrip,
  MyRegistrationActions,
  RegisterDialog,
} from '../components/student-components';

function SessionSelect({
  list,
  value,
  onChange,
}: {
  list: CatalogSession[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <FilterSelect
      label="Session"
      value={value}
      onChange={onChange}
      options={list.map((s) => ({ value: s.id, label: s.name }))}
      allLabel="Choose a session"
    />
  );
}

const FILTERS = ['sessionId', 'departmentId', 'category', 'level', 'availability', 'mine'] as const;

/** Catalog search (FR-STUDENT-003). */
export function CatalogPage() {
  const { page, q, filters, update } = useListParams(FILTERS);
  const { list, session, sessions } = useDefaultSession(filters.sessionId);
  const departments = useDepartmentOptions();
  const sessionId = session?.id ?? '';
  const catalog = useCatalog(
    {
      page,
      q,
      limit: 20,
      sessionId,
      departmentId: filters.departmentId,
      category: filters.category,
      level: filters.level,
      availability: filters.availability,
      mine: filters.mine || undefined,
    },
    !!sessionId,
  );
  const navigate = useNavigate();
  if (sessions.isPending) return <LoadingRows rows={5} />;
  if (!session)
    return (
      <EmptyState
        title="No courses are offered yet"
        description="The catalog opens when sections are published for a session."
      />
    );
  return (
    <>
      <PageHeader
        title="Course catalog"
        description="Find courses offered this session and check whether you can register."
      />
      <div className="mb-4">
        <DeadlineStrip session={session} />
      </div>
      <ListToolbar>
        <SearchInput
          value={q}
          onChange={(v) => update({ q: v })}
          placeholder="Code, title or topic"
          label="Search the catalog"
        />
        <SessionSelect list={list} value={sessionId} onChange={(v) => update({ sessionId: v })} />
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
          options={[100, 200, 300, 400].map((l) => ({ value: String(l), label: `${l} level` }))}
          allLabel="All levels"
        />
        <FilterSelect
          label="Availability"
          value={filters.availability}
          onChange={(v) => update({ availability: v })}
          options={[
            { value: 'open', label: 'Seats available' },
            { value: 'waitlist', label: 'Waitlist open' },
          ]}
          allLabel="Any availability"
        />
        <FilterSelect
          label="Program"
          value={filters.mine}
          onChange={(v) => update({ mine: v })}
          options={[{ value: 'true', label: 'In my program' }]}
          allLabel="All programs"
        />
      </ListToolbar>
      <DataTable<CatalogCourse>
        caption="Courses offered"
        isLoading={catalog.isPending}
        error={catalog.error}
        onRetry={() => void catalog.refetch()}
        rows={catalog.data?.data}
        meta={catalog.data?.meta && 'total' in catalog.data.meta ? catalog.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/student/catalog/${c.id}?sessionId=${sessionId}`)}
        emptyTitle={
          q || Object.values(filters).some(Boolean) ? 'No matching courses' : 'No courses offered'
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
                <p className="truncate text-xs text-muted-foreground">
                  {c.department.name}
                  {c.instructors.length ? ` · ${c.instructors.join(', ')}` : ''}
                </p>
              </div>
            ),
          },
          { key: 'credits', header: 'Credits', cell: (c) => c.credits },
          {
            key: 'program',
            header: 'For you',
            cell: (c) =>
              c.inMyProgram ? (
                <StatusBadge tone="info">
                  {c.inMyProgram === 'CORE' ? 'Core' : 'Elective'}
                </StatusBadge>
              ) : null,
            hideOnMobile: true,
          },
          {
            key: 'seats',
            header: 'Seats',
            cell: (c) =>
              c.openSeats > 0 ? (
                <span className="tabular-nums">{c.openSeats} open</span>
              ) : c.waitlistOpen ? (
                <StatusBadge tone="warning">Waitlist</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">Full</StatusBadge>
              ),
          },
          {
            key: 'mine',
            header: '',
            cell: (c) => (c.myStatus ? <RegistrationStatusBadge status={c.myStatus} /> : null),
          },
        ]}
      />
    </>
  );
}

const STATE_ICON: Record<
  RequirementState,
  { icon: typeof Circle; text: string; className: string }
> = {
  COMPLETED: { icon: CheckCircle2, text: 'Completed', className: 'text-success' },
  IN_PROGRESS: { icon: CircleDot, text: 'In progress', className: 'text-warning' },
  THIS_SESSION: { icon: CircleDot, text: 'This session', className: 'text-warning' },
  MISSING: { icon: Circle, text: 'Not taken', className: 'text-muted-foreground' },
};
function RequirementChip({
  code,
  state,
  grade,
  min,
}: {
  code: string;
  state: RequirementState;
  grade: string | null;
  min?: string | null;
}) {
  const s = STATE_ICON[state];
  return (
    <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs">
      <s.icon className={`size-3.5 ${s.className}`} aria-hidden />
      <span className="font-mono">{code}</span>
      <span className="text-muted-foreground">
        {s.text}
        {grade ? ` (${grade})` : ''}
        {min ? ` · min ${min}` : ''}
      </span>
    </span>
  );
}

/** Course detail with personal requirement status and sections (FR-STUDENT-004). */
export function CatalogCoursePage() {
  const { courseId = '' } = useParams();
  const [params] = useSearchParams();
  const { session } = useDefaultSession(params.get('sessionId'));
  const sessionId = session?.id ?? '';
  const course = useCatalogCourse(courseId, sessionId);
  if (course.isPending) return <LoadingRows rows={6} />;
  if (course.isError)
    return <ErrorState error={course.error} onRetry={() => void course.refetch()} />;
  const c = course.data;
  return (
    <>
      <PageHeader
        title={`${c.code} · ${c.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {c.department.name} · {c.credits} credits · {CATEGORY_LABEL[c.category] ?? c.category}
            {c.inMyProgram && (
              <StatusBadge tone="info">
                {c.inMyProgram === 'CORE' ? 'Core in your program' : 'Elective in your program'}
              </StatusBadge>
            )}
            {c.completed && <StatusBadge tone="success">You passed this course</StatusBadge>}
          </span>
        }
      />
      {session && (
        <div className="mb-4">
          <DeadlineStrip session={session} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sections in {session?.name}</CardTitle>
              <CardDescription>
                Seats and schedule; check your eligibility before registering.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {c.myRegistration && (
                <p className="mb-3 flex items-center gap-2 text-sm">
                  You are <RegistrationStatusBadge status={c.myRegistration.status} /> in this
                  course.{' '}
                  <Link className="underline" to="/student/registrations">
                    Manage
                  </Link>
                </p>
              )}
              {c.sections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sections offered this session.</p>
              ) : (
                <ul className="space-y-3">
                  {c.sections.map((s) => {
                    const full = s.enrolledCount >= s.capacity;
                    const label = `${c.code} ${s.sectionCode}`;
                    return (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                      >
                        <div className="min-w-0 text-sm">
                          <p className="font-medium">Section {s.sectionCode}</p>
                          <p className="text-muted-foreground">
                            {s.meetings.map(meetingLabel).join(', ') || 'Schedule to be announced'}
                          </p>
                          <p className="text-muted-foreground">
                            {s.instructors.find((i) => i.role === 'PRIMARY')?.name ??
                              'Instructor TBA'}{' '}
                            ·{' '}
                            {[
                              ...new Set(
                                s.meetings.flatMap((m) => (m.classroom ? [m.classroom.label] : [])),
                              ),
                            ].join(', ') || 'Room TBA'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm tabular-nums">
                            {full ? (
                              <StatusBadge tone="warning">
                                Full · {s.waitlistCount} waiting
                              </StatusBadge>
                            ) : (
                              `${s.availableSeats} of ${s.capacity} seats`
                            )}
                          </span>
                          {!c.myRegistration && s.registrationOpen && (
                            <RegisterDialog
                              sectionId={s.id}
                              label={label}
                              trigger={(open) => (
                                <Button size="sm" onClick={open}>
                                  Check &amp; register
                                </Button>
                              )}
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">About the course</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="whitespace-pre-line">{c.description ?? 'No description yet.'}</p>
              {c.outcomes.length > 0 && (
                <div>
                  <h3 className="mb-1 font-medium">You will be able to</h3>
                  <ol className="list-decimal space-y-1 pl-5">
                    {c.outcomes.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ol>
                </div>
              )}
              {c.assessmentComponents.length > 0 && (
                <div>
                  <h3 className="mb-1 font-medium">Assessment</h3>
                  <ul className="space-y-1">
                    {c.assessmentComponents.map((a) => (
                      <li key={a.name} className="flex justify-between border-b pb-1">
                        <span>{a.name}</span>
                        <span className="tabular-nums">{a.weight}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Requirements</CardTitle>
            <CardDescription>Your status for each.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h3 className="mb-1 font-medium">Prerequisites</h3>
              {c.prerequisites.length === 0 ? (
                <p className="text-muted-foreground">None.</p>
              ) : (
                <ul className="space-y-2">
                  {c.prerequisites.map((g, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-1">
                      {i > 0 && (
                        <span className="text-xs font-semibold text-muted-foreground">AND</span>
                      )}
                      {g.items.map((it, j) => (
                        <span key={it.course.id} className="inline-flex items-center gap-1">
                          {j > 0 && <span className="text-xs text-muted-foreground">or</span>}
                          <RequirementChip
                            code={it.course.code}
                            state={it.state}
                            grade={it.grade}
                            min={it.minGradeLetter}
                          />
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-1 font-medium">Corequisites</h3>
              {c.corequisites.length === 0 ? (
                <p className="text-muted-foreground">None.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {c.corequisites.map((r) => (
                    <RequirementChip
                      key={r.course.id}
                      code={r.course.code}
                      state={r.state}
                      grade={r.grade}
                    />
                  ))}
                </div>
              )}
            </div>
            {c.hasRestrictions && (
              <p className="text-muted-foreground">
                Registration is limited to some programs or years; the eligibility check shows
                whether you qualify.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Registered courses, waitlists and requests per session (FR-STUDENT-006/007). */
export function MyRegistrationsPage() {
  const [params, setParams] = useSearchParams();
  const { list, session, sessions } = useDefaultSession(params.get('sessionId'));
  const sessionId = session?.id ?? '';
  const regs = useMyRegistrations(sessionId || undefined);
  const active = (regs.data?.items ?? []).filter((r) =>
    ['REGISTERED', 'PENDING', 'WAITLISTED', 'OFFERED'].includes(r.status),
  );
  const ended = (regs.data?.items ?? []).filter(
    (r) => !['REGISTERED', 'PENDING', 'WAITLISTED', 'OFFERED'].includes(r.status),
  );
  const columns = [
    {
      key: 'course',
      header: 'Course',
      cell: (r: MyRegistration) => (
        <div className="min-w-0">
          <p className="font-medium">
            <span className="font-mono">
              {r.course.code} {r.section.sectionCode}
            </span>{' '}
            · {r.course.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {r.section.meetings.map(meetingLabel).join(', ') || 'No meetings'} ·{' '}
            {r.section.instructor ?? 'Instructor TBA'}
          </p>
        </div>
      ),
    },
    {
      key: 'credits',
      header: 'Credits',
      cell: (r: MyRegistration) => r.credits,
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (r: MyRegistration) => (
        <div className="flex flex-wrap items-center gap-1">
          <RegistrationStatusBadge status={r.status} />
          {r.waitlistPosition && <span className="text-xs">#{r.waitlistPosition}</span>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      cell: (r: MyRegistration) => <MyRegistrationActions reg={r} session={session ?? undefined} />,
    },
  ];
  if (sessions.isPending) return <LoadingRows rows={4} />;
  return (
    <>
      <PageHeader
        title="My registrations"
        description="Your courses, waitlist places and requests."
        actions={
          <Button asChild>
            <Link to={`/student/catalog${sessionId ? `?sessionId=${sessionId}` : ''}`}>
              Find courses
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SessionSelect
          list={list}
          value={sessionId}
          onChange={(v) => setParams({ sessionId: v }, { replace: true })}
        />
        {regs.data && (
          <span className="text-sm text-muted-foreground">
            {regs.data.seatCredits} credits registered or pending
          </span>
        )}
      </div>
      {session && (
        <div className="mb-4">
          <DeadlineStrip session={session} />
        </div>
      )}
      <DataTable<MyRegistration>
        caption="Current registrations"
        isLoading={regs.isPending}
        error={regs.error}
        onRetry={() => void regs.refetch()}
        rows={active}
        rowKey={(r) => r.id}
        emptyTitle="Nothing registered for this session yet"
        columns={columns}
      />
      {ended.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Earlier changes</h2>
          <DataTable<MyRegistration>
            caption="Ended registrations"
            isLoading={false}
            rows={ended}
            rowKey={(r) => r.id}
            emptyTitle="None"
            columns={columns.slice(0, 3)}
          />
        </div>
      )}
    </>
  );
}

/** Weekly timetable with iCal export (FR-STUDENT-010). */
export function TimetablePage() {
  const [params, setParams] = useSearchParams();
  const { list } = useDefaultSession();
  // The timetable opens on the running session, not the one open for registration.
  const session =
    list.find((x) => x.id === params.get('sessionId')) ??
    list.find((x) => x.status === 'ACTIVE') ??
    list[0] ??
    null;
  const sessionId = session?.id ?? '';
  const t = useTimetable(sessionId);
  return (
    <>
      <PageHeader
        title="Timetable"
        description="Your weekly classes, including requests awaiting approval."
        actions={
          sessionId ? (
            <Button
              variant="outline"
              onClick={() =>
                downloadTimetableIcs(sessionId).catch((e) => toast.error(errorMessage(e)))
              }
            >
              <CalendarPlus className="size-4" /> Add to calendar
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4">
        <SessionSelect
          list={list}
          value={sessionId}
          onChange={(v) => setParams({ sessionId: v }, { replace: true })}
        />
      </div>
      {t.isPending ? (
        <LoadingRows rows={4} />
      ) : t.isError ? (
        <ErrorState error={t.error} onRetry={() => void t.refetch()} />
      ) : (
        <Card>
          <CardContent>
            <WeekGrid
              caption={`Timetable for ${t.data.session.name}`}
              items={t.data.entries.map((e) => ({
                id: e.id,
                dayOfWeek: e.dayOfWeek,
                startMinute: e.startMinute,
                endMinute: e.endMinute,
                title: `${e.course} ${e.sectionCode}`,
                subtitle: [MEETING_TYPE_LABEL[e.type], e.room, e.instructor]
                  .filter(Boolean)
                  .join(' · '),
                href: `/student/courses/${e.sectionId}`,
                muted: e.status !== 'REGISTERED',
              }))}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}

function PlanItemSection({
  courseId,
  sessionId,
  value,
  onChange,
}: {
  courseId: string;
  sessionId: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const course = useCatalogCourse(courseId, sessionId);
  const sections = course.data?.sections ?? [];
  return (
    <Select value={value ?? 'none'} onValueChange={(v) => onChange(v === 'none' ? null : v)}>
      <SelectTrigger aria-label="Section" className="w-full sm:w-72">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Choose a section…</SelectItem>
        {sections.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.sectionCode} · {s.meetings.map(meetingLabel).join(', ') || 'TBA'} ·{' '}
            {s.availableSeats} seats
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PlanEditor({ plan, onResult }: { plan: CoursePlan; onResult: (r: BatchResult) => void }) {
  const save = useSavePlanItems();
  const register = useRegisterPlan();
  const remove = useDeletePlan();
  const validation = usePlanValidation(plan.id);
  const [adding, setAdding] = useState<PickerOption | null>(null);
  const items = plan.items.map((i) => ({
    courseId: i.course.id,
    sectionId: i.section?.id ?? null,
  }));
  const persist = (next: typeof items) =>
    save.mutate({ id: plan.id, items: next }, { onError: (e) => toast.error(errorMessage(e)) });
  const problems = new Map((validation.data?.items ?? []).map((v) => [v.courseId, v]));
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">{plan.name}</CardTitle>
          <CardDescription>{plan.totalCredits} credits planned</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={!plan.items.some((i) => i.section) || register.isPending}
            onClick={() =>
              register.mutate(plan.id, {
                onSuccess: (r) => {
                  onResult(r);
                  toast.success(`${r.succeeded} of ${r.results.length} processed`);
                },
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            Register for all
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon" aria-label={`Delete plan ${plan.name}`}>
                <Trash2 className="size-4" />
              </Button>
            }
            title={`Delete “${plan.name}”?`}
            description="Only the plan is deleted; registrations are not affected."
            confirmLabel="Delete"
            destructive
            onConfirm={() =>
              remove.mutate(plan.id, { onSuccess: () => toast.success('Plan deleted') })
            }
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {plan.items.length === 0 && (
          <p className="text-sm text-muted-foreground">Add courses you are considering.</p>
        )}
        <ul className="space-y-3">
          {plan.items.map((i, idx) => {
            const v = problems.get(i.course.id);
            return (
              <li key={i.course.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium">
                    <span className="font-mono">{i.course.code}</span> · {i.course.title}{' '}
                    <span className="text-xs text-muted-foreground">({i.course.credits} cr)</span>
                  </p>
                  <PlanItemSection
                    courseId={i.course.id}
                    sessionId={plan.session.id}
                    value={i.section?.id ?? null}
                    onChange={(sectionId) =>
                      persist(items.map((x, j) => (j === idx ? { ...x, sectionId } : x)))
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${i.course.code}`}
                    onClick={() => persist(items.filter((_, j) => j !== idx))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {v && !v.ok && (
                  <ul className="mt-2 space-y-0.5 text-xs text-destructive">
                    {v.problems.map((p) => (
                      <li key={p.code}>{p.message}</li>
                    ))}
                  </ul>
                )}
                {v?.ok && <p className="mt-2 text-xs text-success">Ready to register</p>}
              </li>
            );
          })}
        </ul>
        <div className="max-w-md">
          <CoursePicker
            label="Add a course"
            value={adding}
            exclude={plan.items.map((i) => i.course.id)}
            onChange={(o) => {
              setAdding(null);
              if (o) persist([...items, { courseId: o.value, sectionId: null }]);
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/** Course planner (FR-STUDENT-008). */
export function PlannerPage() {
  const [params, setParams] = useSearchParams();
  const { list, session, sessions } = useDefaultSession(params.get('sessionId'));
  const sessionId = session?.id ?? '';
  const plans = usePlans(sessionId);
  const create = useCreatePlan();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  if (sessions.isPending) return <LoadingRows rows={3} />;
  return (
    <>
      <PageHeader
        title="Planner"
        description="Try combinations of courses and sections, see clashes and credit totals, then register in one step."
        actions={
          sessionId ? (
            <Button onClick={() => (setName(''), setError(null), setOpen(true))}>
              <Plus className="size-4" /> New plan
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4">
        <SessionSelect
          list={list}
          value={sessionId}
          onChange={(v) => setParams({ sessionId: v }, { replace: true })}
        />
      </div>
      {result && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Registration results</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {result.results.map((r) => (
                <li key={r.sectionId} className="flex flex-wrap items-center gap-2">
                  {r.ok && r.registration ? (
                    <>
                      <span className="font-mono">
                        {r.registration.course.code} {r.registration.section.sectionCode}
                      </span>
                      <RegistrationStatusBadge status={r.registration.status} />
                    </>
                  ) : (
                    <span className="text-destructive">{r.error?.message}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {plans.isPending ? (
        <LoadingRows rows={3} />
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />
      ) : plans.data.length === 0 ? (
        <EmptyState
          title="No plans for this session"
          description="Create a plan to compare course combinations."
        />
      ) : (
        <div className="grid gap-6">
          {plans.data.map((p) => (
            <PlanEditor key={p.id} plan={p} onResult={setResult} />
          ))}
        </div>
      )}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="New plan"
        submitLabel="Create plan"
        submitting={create.isPending}
        error={error}
        onSubmit={() =>
          name.trim()
            ? create.mutate(
                { sessionId, name: name.trim() },
                { onSuccess: () => setOpen(false), onError: (e) => setError(errorMessage(e)) },
              )
            : setError('Give the plan a name.')
        }
      >
        <TextField
          label="Name"
          placeholder="Plan A"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
      </FormDialog>
    </>
  );
}

const COURSE_STATE = {
  COMPLETED: { tone: 'success' as const, text: 'Completed' },
  IN_PROGRESS: { tone: 'warning' as const, text: 'In progress' },
  PENDING: { tone: 'neutral' as const, text: 'To do' },
};

/** Degree progress (FR-STUDENT-009). */
export function ProgressPage() {
  const p = useProgress();
  if (p.isPending) return <LoadingRows rows={5} />;
  if (p.isError) return <ErrorState error={p.error} onRetry={() => void p.refetch()} />;
  const d = p.data;
  const pct = (n: number) => (d.totalRequired ? Math.min(100, (n / d.totalRequired) * 100) : 0);
  return (
    <>
      <PageHeader
        title="Degree progress"
        description={`${d.program.name}${d.specialization ? ` · ${d.specialization.name}` : ''}`}
      />
      <Card className="mb-6">
        <CardContent className="space-y-2">
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span>
              <span className="font-semibold tabular-nums">{d.completed}</span> completed ·{' '}
              <span className="tabular-nums">{d.inProgress}</span> in progress ·{' '}
              <span className="tabular-nums">{d.remaining}</span> remaining
            </span>
            <span className="text-muted-foreground">{d.totalRequired} credits required</span>
          </div>
          <div
            className="flex h-3 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${d.completed} of ${d.totalRequired} credits completed, ${d.inProgress} in progress`}
          >
            <div className="h-full bg-brand" style={{ width: `${pct(d.completed)}%` }} />
            <div className="h-full bg-brand/40" style={{ width: `${pct(d.inProgress)}%` }} />
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        {d.groups.map((g) => (
          <Card key={g.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {g.name}
                {g.satisfied && <StatusBadge tone="success">Done</StatusBadge>}
                {g.source === 'SPECIALIZATION' && (
                  <StatusBadge tone="info">Specialization</StatusBadge>
                )}
              </CardTitle>
              <CardDescription>
                {g.kind === 'ALL_OF'
                  ? 'Complete every course'
                  : `${g.completedCredits} of ${g.requiredCredits} credits${g.inProgressCredits ? ` (+${g.inProgressCredits} in progress)` : ''}`}
                {g.category ? ` · ${CATEGORY_LABEL[g.category] ?? g.category}` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {g.courses.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing counted yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {g.courses.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="font-mono">{c.code}</span> · {c.title}
                      </span>
                      <StatusBadge tone={COURSE_STATE[c.state].tone}>
                        {COURSE_STATE[c.state].text}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

/** Academic history with GPA (FR-STUDENT-011). */
export function HistoryPage() {
  const h = useHistory();
  if (h.isPending) return <LoadingRows rows={5} />;
  if (h.isError) return <ErrorState error={h.error} onRetry={() => void h.refetch()} />;
  const d = h.data;
  return (
    <>
      <PageHeader
        title="Academic history"
        description={`${d.creditsEarned} credits earned${d.cgpa !== null ? ` · CGPA ${d.cgpa.toFixed(2)}` : ''}`}
      />
      {d.sessions.length === 0 ? (
        <EmptyState title="No completed courses yet" />
      ) : (
        <div className="space-y-6">
          {d.sessions.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle className="text-base">{s.name}</CardTitle>
                <CardDescription>
                  {s.credits} credits earned{s.gpa !== null ? ` · GPA ${s.gpa.toFixed(2)}` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <caption className="sr-only">Courses in {s.name}</caption>
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1 font-medium">Course</th>
                      <th className="py-1 text-right font-medium">Credits</th>
                      <th className="py-1 text-right font-medium">Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.courses.map((c) => (
                      <tr key={`${c.courseId}-${c.grade}`} className="border-b last:border-0">
                        <td className="py-1.5">
                          <span className="font-mono">{c.code}</span> · {c.title}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {c.creditsEarned}/{c.credits}
                        </td>
                        <td
                          className={`py-1.5 text-right font-medium ${c.passed ? '' : 'text-destructive'}`}
                        >
                          {c.grade ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/** A registered course: schedule, materials and announcements. */
export function StudentCoursePage() {
  const { sectionId = '' } = useParams();
  const section = useSection(sectionId);
  const materials = useMaterials(sectionId);
  const announcements = useSectionAnnouncements(sectionId);
  if (section.isPending) return <LoadingRows rows={4} />;
  if (section.isError)
    return <ErrorState error={section.error} onRetry={() => void section.refetch()} />;
  const s = section.data;
  return (
    <>
      <PageHeader
        title={`${s.course.code} ${s.sectionCode} · ${s.course.title}`}
        description={`${s.session.name} · ${s.instructors.find((i) => i.role === 'PRIMARY')?.name ?? 'Instructor TBA'}`}
      />
      <Tabs defaultValue="materials">
        <TabsList className="mb-4">
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="announcements">Announcements</TabsTrigger>
          <TabsTrigger value="discussions">Discussions</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
        </TabsList>
        <TabsContent value="materials">
          {materials.isPending ? (
            <LoadingRows rows={3} />
          ) : materials.isError ? (
            <ErrorState error={materials.error} />
          ) : (
            <MaterialList items={materials.data.items} canManage={false} />
          )}
        </TabsContent>
        <TabsContent value="announcements">
          {announcements.isPending ? (
            <LoadingRows rows={3} />
          ) : announcements.isError ? (
            <ErrorState error={announcements.error} />
          ) : (
            <AnnouncementList items={announcements.data.items} emptyText="No announcements yet." />
          )}
        </TabsContent>
        <TabsContent value="discussions">
          <DiscussionBoard sectionId={sectionId} portal="student" />
        </TabsContent>
        <TabsContent value="schedule">
          <Card>
            <CardContent className="space-y-1 text-sm">
              {s.meetings.length ? (
                s.meetings.map((m) => (
                  <p key={m.id}>
                    {meetingLabel(m)} · {MEETING_TYPE_LABEL[m.type]} ·{' '}
                    {m.classroom?.label ?? 'Room TBA'}
                  </p>
                ))
              ) : (
                <p className="text-muted-foreground">No meetings scheduled.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
