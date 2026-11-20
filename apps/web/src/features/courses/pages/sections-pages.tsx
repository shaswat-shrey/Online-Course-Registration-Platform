import { CalendarClock, Copy, Pencil, Plus, ShieldAlert, Trash2, Users } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { SECTION_STATUSES } from '@ucrams/shared';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailList } from '@/components/shared/detail-list';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { WeekGrid } from '@/components/shared/week-grid';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useListParams } from '@/hooks/use-list-params';
import { useSessions } from '@/features/calendar/api/calendar-queries';
import { DESIGNATION_LABEL } from '@/features/people/api/types';
import { useDepartmentOptions } from '@/features/structure/api/structure-queries';
import { errorMessage } from '@/services/api-error';
import { formatDateTime } from '@/utils/format';
import { useCan } from '@/store/auth-store';
import {
  useDeleteSection,
  useSection,
  useSections,
  useSetSectionRestrictions,
} from '../api/courses-queries';
import { MEETING_TYPE_LABEL, ROLE_LABEL, SECTION_STATUS_LABEL, type Section } from '../api/types';
import { RestrictionList, RestrictionsDialog } from '../components/relation-dialogs';
import {
  formatTime,
  InstructorsDialog,
  meetingLabel,
  MeetingsDialog,
  RollForwardDialog,
  SectionActions,
  SectionDialog,
} from '../components/section-dialogs';

const SECTION_TONE: Record<string, StatusTone> = {
  DRAFT: 'info',
  PUBLISHED: 'success',
  CLOSED: 'warning',
  CANCELLED: 'danger',
  COMPLETED: 'neutral',
};
export function SectionStatusBadge({ status }: { status: string }) {
  return (
    <StatusBadge tone={SECTION_TONE[status] ?? 'neutral'}>
      {SECTION_STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

function Seats({
  s,
}: {
  s: Pick<Section, 'enrolledCount' | 'capacity' | 'waitlistCount' | 'waitlistCapacity'>;
}) {
  const full = s.enrolledCount >= s.capacity;
  return (
    <span className="tabular-nums">
      <span className={full ? 'font-medium text-destructive' : undefined}>
        {s.enrolledCount}/{s.capacity}
      </span>
      {s.waitlistCount > 0 && (
        <span className="text-xs text-muted-foreground"> +{s.waitlistCount} waitlisted</span>
      )}
    </span>
  );
}

const FILTERS = ['sessionId', 'departmentId', 'status', 'unassigned'] as const;

export function SectionsPage() {
  const { page, q, filters, update } = useListParams(FILTERS);
  const sessions = useSessions();
  const departments = useDepartmentOptions();
  const canCreate = useCan('section:create');
  const navigate = useNavigate();
  const all = sessions.data ?? [];
  // Default to the current active session so the page opens on what matters now.
  const sessionId =
    filters.sessionId ||
    all.find((s) => s.status === 'ACTIVE' && s.isCurrent)?.id ||
    all.find((s) => s.status === 'ACTIVE')?.id ||
    '';
  const sections = useSections(
    {
      page,
      q,
      limit: 25,
      sessionId,
      departmentId: filters.departmentId,
      status: filters.status,
      unassigned: filters.unassigned || undefined,
    },
    !!sessionId || sessions.isFetched,
  );
  return (
    <>
      <PageHeader
        title="Sections"
        description="Course offerings per session: schedule, rooms, instructors and seats."
        actions={
          canCreate ? (
            <>
              <RollForwardDialog
                trigger={(open) => (
                  <Button variant="outline" onClick={open}>
                    <Copy className="size-4" /> Copy from session
                  </Button>
                )}
              />
              <SectionDialog
                defaultSessionId={sessionId || undefined}
                onSaved={(s) => navigate(`/admin/sections/${s.id}`)}
                trigger={(open) => (
                  <Button onClick={open}>
                    <Plus className="size-4" /> New section
                  </Button>
                )}
              />
            </>
          ) : undefined
        }
      />
      <ListToolbar>
        <SearchInput
          value={q}
          onChange={(v) => update({ q: v })}
          placeholder="Course code, title or section"
          label="Search sections"
        />
        <FilterSelect
          label="Session"
          value={sessionId}
          onChange={(v) => update({ sessionId: v })}
          options={all.map((s) => ({ value: s.id, label: s.name }))}
          allLabel="All sessions"
        />
        <FilterSelect
          label="Department"
          value={filters.departmentId}
          onChange={(v) => update({ departmentId: v })}
          options={(departments.data?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          allLabel="All departments"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          options={SECTION_STATUSES.map((s) => ({ value: s, label: SECTION_STATUS_LABEL[s]! }))}
          allLabel="All statuses"
        />
        <FilterSelect
          label="Instructor"
          value={filters.unassigned}
          onChange={(v) => update({ unassigned: v })}
          options={[{ value: 'true', label: 'No primary instructor' }]}
          allLabel="Any instructor"
        />
      </ListToolbar>
      <DataTable<Section>
        caption="Sections"
        isLoading={sections.isPending}
        error={sections.error}
        onRetry={() => void sections.refetch()}
        rows={sections.data?.data}
        meta={sections.data?.meta && 'total' in sections.data.meta ? sections.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
        rowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/admin/sections/${s.id}`)}
        emptyTitle={
          Object.values(filters).some(Boolean) || q
            ? 'No matching sections'
            : 'No sections in this session'
        }
        emptyDescription={
          canCreate
            ? 'Create sections one by one, or copy them from a previous session.'
            : undefined
        }
        columns={[
          {
            key: 'course',
            header: 'Section',
            cell: (s) => (
              <div className="min-w-0">
                <p className="font-medium">
                  <span className="font-mono">
                    {s.course.code} {s.sectionCode}
                  </span>{' '}
                  · {s.course.title}
                </p>
                <p className="text-xs text-muted-foreground">{s.course.department.name}</p>
              </div>
            ),
          },
          {
            key: 'meets',
            header: 'Meets',
            cell: (s) => (
              <span className="text-xs">{s.meetings.map(meetingLabel).join(', ') || '—'}</span>
            ),
            hideOnMobile: true,
          },
          {
            key: 'room',
            header: 'Room',
            cell: (s) =>
              [
                ...new Set(s.meetings.flatMap((m) => (m.classroom ? [m.classroom.label] : []))),
              ].join(', ') || '—',
            hideOnMobile: true,
          },
          {
            key: 'instructor',
            header: 'Instructor',
            cell: (s) =>
              s.instructors.find((i) => i.role === 'PRIMARY')?.name ?? (
                <span className="text-muted-foreground">TBA</span>
              ),
            hideOnMobile: true,
          },
          { key: 'seats', header: 'Enrolled', cell: (s) => <Seats s={s} /> },
          {
            key: 'status',
            header: 'Status',
            cell: (s) => <SectionStatusBadge status={s.status} />,
          },
        ]}
      />
    </>
  );
}

export function SectionDetailPage() {
  const { sectionId = '' } = useParams();
  const section = useSection(sectionId);
  const restrictions = useSetSectionRestrictions(sectionId);
  const remove = useDeleteSection();
  const navigate = useNavigate();
  if (section.isPending) return <LoadingRows rows={6} />;
  if (section.isError)
    return <ErrorState error={section.error} onRetry={() => void section.refetch()} />;
  const s = section.data;
  const editable = ['DRAFT', 'PUBLISHED', 'CLOSED'].includes(s.status);
  const p = s.permissions;
  const primary = s.instructors.find((i) => i.role === 'PRIMARY');
  return (
    <>
      <PageHeader
        title={`${s.course.code} ${s.sectionCode} · ${s.course.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {s.session.name} ·
            <Link to={`/admin/courses/${s.course.id}`} className="hover:underline">
              View course
            </Link>
            <SectionStatusBadge status={s.status} />
            {s.status === 'PUBLISHED' && !s.registrationOpen && (
              <StatusBadge tone="warning">Registration closed</StatusBadge>
            )}
          </span>
        }
        actions={
          <>
            {p.update && editable && (
              <SectionDialog
                section={s}
                trigger={(open) => (
                  <Button variant="outline" onClick={open}>
                    <Pencil className="size-4" /> Edit
                  </Button>
                )}
              />
            )}
            <SectionActions section={s} />
            {p.update && s.status === 'DRAFT' && (
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label="Delete section">
                    <Trash2 className="size-4" />
                  </Button>
                }
                title="Delete this draft section?"
                description="This cannot be undone."
                confirmLabel="Delete"
                destructive
                onConfirm={() =>
                  remove.mutate(s.id, {
                    onSuccess: () => {
                      toast.success('Section deleted');
                      navigate('/admin/sections');
                    },
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
              />
            )}
          </>
        }
      />
      {s.status === 'DRAFT' && !primary && (
        <p className="mb-4 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          Assign a primary instructor before publishing, or the section will show “Instructor TBA”.
        </p>
      )}
      {s.scheduleOverrideReason && s.status !== 'CANCELLED' && (
        <p className="mb-4 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          This schedule overlaps another section by agreement: {s.scheduleOverrideReason}
        </p>
      )}
      {s.status === 'CANCELLED' && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          Cancelled {s.cancelledAt ? formatDateTime(s.cancelledAt) : ''}: {s.cancelReason}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Enrolled', `${s.enrolledCount}/${s.capacity}`],
                ['Available', s.availableSeats],
                ['Waitlisted', `${s.waitlistCount}/${s.waitlistCapacity}`],
                ['Credits', s.course.credits],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-secondary p-3">
                  <p className="text-xl font-semibold tabular-nums">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <DetailList
              columns={1}
              items={[
                { label: 'Campus', value: s.campus?.name ?? '—' },
                { label: 'Registration', value: s.registrationOpen ? 'Open' : 'Closed' },
                {
                  label: 'Published',
                  value: s.publishedAt ? formatDateTime(s.publishedAt) : 'Not yet',
                },
                { label: 'Notes', value: s.notes ?? '—' },
              ]}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="size-4 text-brand" /> Weekly schedule
              </CardTitle>
              <CardDescription>
                {s.session.startDate} to {s.session.endDate}
              </CardDescription>
            </div>
            {p.update && editable && (
              <MeetingsDialog
                section={s}
                trigger={(open) => (
                  <Button size="sm" variant="outline" onClick={open}>
                    Edit meetings
                  </Button>
                )}
              />
            )}
          </CardHeader>
          <CardContent>
            {s.meetings.length ? (
              <ul className="divide-y text-sm">
                {s.meetings.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="font-medium">{meetingLabel(m)}</span>
                    <span className="text-muted-foreground">
                      {MEETING_TYPE_LABEL[m.type]} ·{' '}
                      {m.classroom ? (
                        <Link
                          className="hover:underline"
                          to={`/admin/classrooms/${m.classroom.id}`}
                        >
                          {m.classroom.label}
                        </Link>
                      ) : (
                        'No room'
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No meetings scheduled.</p>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-brand" /> Instructors
            </CardTitle>
            {p.assignFaculty && editable && (
              <InstructorsDialog
                section={s}
                trigger={(open) => (
                  <Button size="sm" variant="outline" onClick={open}>
                    Assign
                  </Button>
                )}
              />
            )}
          </CardHeader>
          <CardContent>
            {s.instructors.length ? (
              <ul className="divide-y text-sm">
                {s.instructors.map((i) => (
                  <li
                    key={i.facultyMemberId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <Link
                      className="font-medium hover:underline"
                      to={`/admin/faculty/${i.facultyMemberId}`}
                    >
                      {i.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {DESIGNATION_LABEL[i.designation] ?? i.designation} · {ROLE_LABEL[i.role]}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Instructor TBA.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-brand" /> Section rules
            </CardTitle>
            {p.update && editable && (
              <RestrictionsDialog
                title={`Restrictions for ${s.course.code} ${s.sectionCode}`}
                initial={s.restrictions ?? []}
                saving={restrictions.isPending}
                onSave={(body) => restrictions.mutateAsync(body)}
                trigger={(open) => (
                  <Button size="sm" variant="outline" onClick={open}>
                    Edit
                  </Button>
                )}
              />
            )}
          </CardHeader>
          <CardContent>
            <RestrictionList rules={s.restrictions ?? []} />
            <p className="mt-2 text-xs text-muted-foreground">Course-level rules also apply.</p>
          </CardContent>
        </Card>
      </div>
      {s.meetings.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Week view</CardTitle>
          </CardHeader>
          <CardContent>
            <WeekGrid
              caption="Section week view"
              items={s.meetings.map((m) => ({
                id: m.id,
                dayOfWeek: m.dayOfWeek,
                startMinute: m.startMinute,
                endMinute: m.endMinute,
                title: `${s.course.code} ${s.sectionCode}`,
                subtitle: m.classroom?.label ?? MEETING_TYPE_LABEL[m.type],
              }))}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}

export { formatTime };
