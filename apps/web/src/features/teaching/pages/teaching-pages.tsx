import { Download, Link2, Megaphone, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { DetailList } from '@/components/shared/detail-list';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { UserAvatar } from '@/components/shared/user-avatar';
import { WeekGrid } from '@/components/shared/week-grid';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MEETING_TYPE_LABEL, ROLE_LABEL } from '@/features/courses/api/types';
import { meetingLabel } from '@/features/courses/components/section-dialogs';
import { SectionStatusBadge } from '@/features/courses/pages/sections-pages';
import {
  REGISTRATION_STATUS_LABEL,
  REGISTRATION_TONE,
  type RegistrationStatus,
} from '@/features/registrations/api/types';
import { AnnouncementFeed } from '@/features/communication/pages/announcement-pages';
import { DiscussionBoard } from '@/features/communication/pages/discussion-pages';
import { errorMessage } from '@/services/api-error';
import { formatDate } from '@/utils/timezone';
import {
  downloadRosterCsv,
  useMaterials,
  useMyAnnouncements,
  useMySections,
  useRoster,
  useSectionAnnouncements,
  useSectionStudent,
  useWorkspace,
} from '../api/teaching-queries';
import type { RosterEntry, TeachingSection } from '../api/types';
import {
  AnnouncementDialog,
  AnnouncementList,
  MaterialDialog,
  MaterialList,
} from '../components/teaching-components';

function SectionList({ scope }: { scope: 'current' | 'upcoming' | 'past' }) {
  const sections = useMySections(scope);
  const navigate = useNavigate();
  return (
    <DataTable<TeachingSection>
      caption={`${scope} teaching assignments`}
      isLoading={sections.isPending}
      error={sections.error}
      onRetry={() => void sections.refetch()}
      rows={sections.data}
      rowKey={(s) => s.id}
      onRowClick={(s) => navigate(`/faculty/sections/${s.id}`)}
      emptyTitle={
        scope === 'current'
          ? 'No sections this session'
          : scope === 'upcoming'
            ? 'Nothing scheduled yet'
            : 'No past sections'
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
              <p className="text-xs text-muted-foreground">
                {s.session.name} · {ROLE_LABEL[s.myRole]}
              </p>
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
            [...new Set(s.meetings.flatMap((m) => (m.classroom ? [m.classroom.label] : [])))].join(
              ', ',
            ) || '—',
          hideOnMobile: true,
        },
        {
          key: 'enrolled',
          header: 'Enrolled',
          cell: (s) => (
            <span className="tabular-nums">
              {s.enrolledCount}/{s.capacity}
            </span>
          ),
        },
        { key: 'status', header: 'Status', cell: (s) => <SectionStatusBadge status={s.status} /> },
      ]}
    />
  );
}

/** Teaching assignments (FR-FACULTY-003). */
export function MyTeachingPage() {
  const [params, setParams] = useSearchParams();
  const scope = (params.get('scope') as 'current' | 'upcoming' | 'past' | null) ?? 'current';
  return (
    <>
      <PageHeader title="My teaching" description="Your sections, their schedule and enrollment." />
      <Tabs
        value={scope}
        onValueChange={(v) => setParams(v === 'current' ? {} : { scope: v }, { replace: true })}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="current">This session</TabsTrigger>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>
        {(['current', 'upcoming', 'past'] as const).map((s) => (
          <TabsContent key={s} value={s}>
            <SectionList scope={s} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

function StudentSheet({
  sectionId,
  studentId,
  onClose,
}: {
  sectionId: string;
  studentId: string | null;
  onClose: () => void;
}) {
  const student = useSectionStudent(sectionId, studentId);
  const s = student.data;
  return (
    <Sheet open={!!studentId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{s?.name ?? 'Student'}</SheetTitle>
          <SheetDescription>Academic details for teaching purposes only.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {student.isPending && <LoadingRows rows={3} />}
          {student.isError && <ErrorState error={student.error} />}
          {s && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <UserAvatar
                  firstName={s.name.split(' ')[0] ?? ''}
                  lastName={s.name.split(' ').slice(1).join(' ')}
                  url={s.avatarUrl}
                  className="size-14"
                />
                <div className="min-w-0">
                  <p className="font-mono text-sm">{s.studentNumber}</p>
                  <a
                    className="text-sm break-all text-brand hover:underline"
                    href={`mailto:${s.email}`}
                  >
                    {s.email}
                  </a>
                </div>
              </div>
              <DetailList
                columns={1}
                items={[
                  { label: 'Program', value: `${s.program.name} (${s.program.code})` },
                  { label: 'Department', value: s.program.department },
                  { label: 'Specialization', value: s.specialization ?? 'None' },
                  { label: 'Year of study', value: s.yearOfStudy },
                  {
                    label: 'Registration',
                    value: `${REGISTRATION_STATUS_LABEL[s.registration.status as RegistrationStatus] ?? s.registration.status} since ${formatDate(s.registration.since.slice(0, 10))}`,
                  },
                  {
                    label: 'Also in your sections',
                    value:
                      s.alsoInYourSections.map((x) => x.label).join(', ') || 'No other sections',
                  },
                ]}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Roster({ sectionId, canExport }: { sectionId: string; canExport: boolean }) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const roster = useRoster(sectionId, { page, q, status });
  return (
    <>
      <ListToolbar>
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Name, number or email"
          label="Search the roster"
        />
        <FilterSelect
          label="Registration status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: 'REGISTERED', label: 'Registered' },
            { value: 'PENDING', label: 'Pending approval' },
            { value: 'WAITLISTED', label: 'Waitlisted' },
          ]}
          allLabel="Enrolled (all)"
        />
        {canExport && (
          <Button
            variant="outline"
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              downloadRosterCsv(sectionId)
                .catch((e) => toast.error(errorMessage(e)))
                .finally(() => setExporting(false));
            }}
          >
            <Download className="size-4" /> Export CSV
          </Button>
        )}
      </ListToolbar>
      <DataTable<RosterEntry>
        caption="Class roster"
        isLoading={roster.isPending}
        error={roster.error}
        onRetry={() => void roster.refetch()}
        rows={roster.data?.data}
        meta={roster.data?.meta && 'total' in roster.data.meta ? roster.data.meta : undefined}
        onPageChange={setPage}
        rowKey={(r) => r.registrationId}
        onRowClick={(r) => setSelected(r.student.id)}
        emptyTitle={q || status ? 'No matching students' : 'No students yet'}
        columns={[
          {
            key: 'student',
            header: 'Student',
            cell: (r) => (
              <div className="min-w-0">
                <p className="font-medium">{r.student.name}</p>
                <p className="truncate text-xs text-muted-foreground">{r.student.email}</p>
              </div>
            ),
          },
          {
            key: 'number',
            header: 'Number',
            cell: (r) => <span className="font-mono text-xs">{r.student.studentNumber}</span>,
          },
          {
            key: 'program',
            header: 'Program',
            cell: (r) => `${r.student.program.code} · Year ${r.student.yearOfStudy}`,
            hideOnMobile: true,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <StatusBadge tone={REGISTRATION_TONE[r.status as RegistrationStatus] ?? 'neutral'}>
                {REGISTRATION_STATUS_LABEL[r.status as RegistrationStatus] ?? r.status}
              </StatusBadge>
            ),
          },
        ]}
      />
      <StudentSheet sectionId={sectionId} studentId={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function Materials({ sectionId }: { sectionId: string }) {
  const materials = useMaterials(sectionId);
  if (materials.isPending) return <LoadingRows rows={3} />;
  if (materials.isError)
    return <ErrorState error={materials.error} onRetry={() => void materials.refetch()} />;
  const { items, canManage } = materials.data;
  const folders = [...new Set(items.flatMap((m) => (m.folder ? [m.folder] : [])))];
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Materials</CardTitle>
          <CardDescription>
            Only students registered in this section can open published materials.
          </CardDescription>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <MaterialDialog
              sectionId={sectionId}
              kind="LINK"
              folders={folders}
              trigger={(open) => (
                <Button size="sm" variant="outline" onClick={open}>
                  <Link2 className="size-4" /> Add link
                </Button>
              )}
            />
            <MaterialDialog
              sectionId={sectionId}
              kind="FILE"
              folders={folders}
              trigger={(open) => (
                <Button size="sm" onClick={open}>
                  <Upload className="size-4" /> Upload file
                </Button>
              )}
            />
          </div>
        )}
      </CardHeader>
      <CardContent>
        <MaterialList items={items} canManage={canManage} />
      </CardContent>
    </Card>
  );
}

function SectionAnnouncements({ sectionId }: { sectionId: string }) {
  const list = useSectionAnnouncements(sectionId);
  if (list.isPending) return <LoadingRows rows={3} />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <CardTitle className="text-base">Announcements</CardTitle>
        {list.data.canPublish && (
          <AnnouncementDialog
            defaultSectionIds={[sectionId]}
            trigger={(open) => (
              <Button size="sm" onClick={open}>
                <Megaphone className="size-4" /> New announcement
              </Button>
            )}
          />
        )}
      </CardHeader>
      <CardContent>
        <AnnouncementList items={list.data.items} emptyText="No announcements yet." />
      </CardContent>
    </Card>
  );
}

/** Course workspace for one section (FR-FACULTY-004). */
export function SectionWorkspacePage() {
  const { sectionId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const ws = useWorkspace(sectionId);
  if (ws.isPending) return <LoadingRows rows={6} />;
  if (ws.isError) return <ErrorState error={ws.error} onRetry={() => void ws.refetch()} />;
  const { section: s, course, stats, can } = ws.data;
  const tab = params.get('tab') ?? 'overview';
  return (
    <>
      <PageHeader
        title={`${s.course.code} ${s.sectionCode} · ${s.course.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {s.session.name} · {s.course.credits} credits <SectionStatusBadge status={s.status} />
            {ws.data.myRole && <span className="text-xs">You: {ROLE_LABEL[ws.data.myRole]}</span>}
          </span>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })}
      >
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="roster">Roster ({s.enrolledCount})</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="announcements">Announcements</TabsTrigger>
          <TabsTrigger value="discussions">Discussions</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Class</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Enrolled', `${s.enrolledCount}/${s.capacity}`],
                  ['Waitlisted', s.waitlistCount],
                  ['Pending approval', stats.byStatus.PENDING ?? 0],
                  [
                    'Dropped or withdrawn',
                    (stats.byStatus.DROPPED ?? 0) + (stats.byStatus.WITHDRAWN ?? 0),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-secondary p-3">
                    <p className="text-xl font-semibold tabular-nums">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              <div>
                <h3 className="mb-1 text-sm font-medium">By program</h3>
                <ul className="space-y-0.5 text-sm">
                  {stats.byProgram.length ? (
                    stats.byProgram.map((p) => (
                      <li key={p.label} className="flex justify-between">
                        <span>{p.label}</span>
                        <span className="tabular-nums">{p.count}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-muted-foreground">No students yet.</li>
                  )}
                </ul>
              </div>
              <div>
                <h3 className="mb-1 text-sm font-medium">By year</h3>
                <ul className="space-y-0.5 text-sm">
                  {stats.byYear.map((p) => (
                    <li key={p.label} className="flex justify-between">
                      <span>{p.label}</span>
                      <span className="tabular-nums">{p.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Course</CardTitle>
              <CardDescription>
                <Link className="hover:underline" to={`/faculty/teaching`}>
                  Back to my teaching
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="whitespace-pre-line">{course.description ?? 'No description.'}</p>
              {course.outcomes.length > 0 && (
                <div>
                  <h3 className="mb-1 font-medium">Learning outcomes</h3>
                  <ol className="list-decimal space-y-1 pl-5">
                    {course.outcomes.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ol>
                </div>
              )}
              {course.assessmentComponents.length > 0 && (
                <div>
                  <h3 className="mb-1 font-medium">Assessment</h3>
                  <ul className="space-y-1">
                    {course.assessmentComponents.map((a) => (
                      <li key={a.name} className="flex justify-between border-b pb-1">
                        <span>{a.name}</span>
                        <span className="tabular-nums">{a.weight}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <h3 className="mb-1 font-medium">Schedule</h3>
                {s.meetings.length ? (
                  <ul className="space-y-1">
                    {s.meetings.map((m) => (
                      <li key={m.id}>
                        {meetingLabel(m)} · {MEETING_TYPE_LABEL[m.type]} ·{' '}
                        {m.classroom?.label ?? 'No room'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">No meetings scheduled.</p>
                )}
              </div>
              <p className="text-muted-foreground">
                Instructors:{' '}
                {s.instructors.map((i) => `${i.name} (${ROLE_LABEL[i.role]})`).join(', ') || 'TBA'}
              </p>
            </CardContent>
          </Card>
          {s.meetings.length > 0 && (
            <Card className="lg:col-span-3">
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
                    subtitle: m.classroom?.label,
                  }))}
                />
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="roster">
          <Roster sectionId={sectionId} canExport={can.exportRoster} />
        </TabsContent>
        <TabsContent value="materials">
          <Materials sectionId={sectionId} />
        </TabsContent>
        <TabsContent value="announcements">
          <SectionAnnouncements sectionId={sectionId} />
        </TabsContent>
        <TabsContent value="discussions">
          <DiscussionBoard sectionId={sectionId} portal="faculty" />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Announcements the faculty member has published, with a composer. */
export function FacultyAnnouncementsPage() {
  const mine = useMyAnnouncements();
  const [params, setParams] = useSearchParams();
  const tab = params.get('a') ? 'feed' : (params.get('tab') ?? 'mine');
  return (
    <>
      <PageHeader
        title="Announcements"
        description="Messages you send to your sections, and announcements for you."
        actions={
          <AnnouncementDialog
            trigger={(open) => (
              <Button onClick={open}>
                <Megaphone className="size-4" /> New announcement
              </Button>
            )}
          />
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList className="mb-4">
          <TabsTrigger value="mine">Published by you</TabsTrigger>
          <TabsTrigger value="feed">For you</TabsTrigger>
        </TabsList>
        <TabsContent value="mine">
          {mine.isPending ? (
            <LoadingRows rows={3} />
          ) : mine.isError ? (
            <ErrorState error={mine.error} onRetry={() => void mine.refetch()} />
          ) : (
            <AnnouncementList
              items={mine.data}
              emptyText="You have not published any announcements yet."
            />
          )}
        </TabsContent>
        <TabsContent value="feed">
          <AnnouncementFeed />
        </TabsContent>
      </Tabs>
    </>
  );
}
