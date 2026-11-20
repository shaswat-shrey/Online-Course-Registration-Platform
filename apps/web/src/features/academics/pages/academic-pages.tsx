import { History, Pencil, Plus, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { minutesToTime } from '@ucrams/shared';
import { FormDialog } from '@/components/forms/form-dialog';
import type { PickerOption } from '@/components/forms/search-picker';
import { CoursePicker } from '@/features/courses/components/pickers';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useSessions } from '@/features/calendar/api/calendar-queries';
import { errorMessage } from '@/services/api-error';
import { useCan } from '@/store/auth-store';
import { formatDateTime } from '@/utils/format';
import { formatDate } from '@/utils/timezone';
import {
  useAvailability,
  useAddExternalRecord,
  useChangeGrade,
  useGradeHistory,
  useMyAssessments,
  useMyAttendance,
  useSubmissions,
  useTranscript,
  type Transcript,
} from '../api/academic-queries';
import { ASSESSMENT_TYPE_LABEL } from '../components/assessments-panel';
import { ATTENDANCE_LABEL, ATTENDANCE_TONE, percentTone } from '../components/attendance-panel';
import { GradesCard, SUBMISSION_LABEL, SUBMISSION_TONE } from '../components/grades-panel';

// ----- student course tabs -------------------------------------------------------------

export function MyAttendancePanel({ sectionId }: { sectionId: string }) {
  const a = useMyAttendance(sectionId);
  if (a.isPending) return <LoadingRows rows={3} />;
  if (a.isError) return <ErrorState error={a.error} onRetry={() => void a.refetch()} />;
  if (!a.data.enabled && !a.data.sessions.length)
    return <EmptyState title="Attendance is not tracked for this course" />;
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm">
        Your attendance
        <StatusBadge tone={percentTone(a.data.percent)}>
          {a.data.percent === null ? 'No marks yet' : `${a.data.percent}%`}
        </StatusBadge>
      </p>
      <ul className="divide-y rounded-lg border">
        {a.data.sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
            <span>
              {formatDate(s.date)}
              {s.startMinute !== null && ` · ${minutesToTime(s.startMinute)}`}
              {s.topic && <span className="text-muted-foreground"> · {s.topic}</span>}
            </span>
            {s.status ? (
              <StatusBadge tone={ATTENDANCE_TONE[s.status]}>
                {ATTENDANCE_LABEL[s.status]}
              </StatusBadge>
            ) : (
              <span className="text-xs text-muted-foreground">Not marked</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MyAssessmentsPanel({ sectionId }: { sectionId: string }) {
  const a = useMyAssessments(sectionId);
  if (a.isPending) return <LoadingRows rows={3} />;
  if (a.isError) return <ErrorState error={a.error} onRetry={() => void a.refetch()} />;
  if (!a.data.items.length)
    return (
      <EmptyState
        title="No published assessments yet"
        description="Scores appear here once your instructor publishes them."
      />
    );
  return (
    <div className="space-y-3">
      {a.data.percent !== null && (
        <p className="text-sm">
          Weighted mark so far:{' '}
          <span className="font-semibold tabular-nums">{a.data.percent}%</span>
          <span className="text-muted-foreground"> (published, marked work only)</span>
        </p>
      )}
      <ul className="divide-y rounded-lg border">
        {a.data.items.map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
          >
            <span className="min-w-0">
              <span className="font-medium">{i.title}</span>{' '}
              <span className="text-xs text-muted-foreground">
                {ASSESSMENT_TYPE_LABEL[i.type]} · {i.weight}%
              </span>
              {i.feedback && (
                <span className="block text-xs text-muted-foreground">{i.feedback}</span>
              )}
            </span>
            <span className="font-medium tabular-nums">
              {i.excused
                ? 'Excused'
                : i.score === null
                  ? 'Not marked'
                  : `${i.score} / ${i.maxScore}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----- transcripts (FR-ACAD-007/008) ------------------------------------------------------------

const POLICY_TEXT = {
  ALL: 'Every attempt counts towards the CGPA.',
  LATEST: 'Only the latest attempt at a repeated course counts towards the CGPA.',
  BEST: 'Only the best attempt at a repeated course counts towards the CGPA.',
};

function GradeChangeDialog({ recordId, onClose }: { recordId: string; onClose: () => void }) {
  const history = useGradeHistory(recordId);
  const change = useChangeGrade();
  const [letter, setLetter] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const h = history.data;
  return (
    <FormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={h ? `Grade for ${h.course.code}` : 'Grade'}
      description="Changes need a reason. Earlier grades stay in the history."
      submitLabel="Change grade"
      submitting={change.isPending}
      error={error}
      onSubmit={() => {
        if (!letter) return setError('Choose the new grade.');
        if (reason.trim().length < 10)
          return setError('Explain the change (at least 10 characters).');
        change.mutate(
          { id: recordId, gradeLetter: letter, reason: reason.trim() },
          {
            onSuccess: () => {
              toast.success('Grade changed');
              onClose();
            },
            onError: (e) => setError(errorMessage(e)),
          },
        );
      }}
    >
      {!h ? (
        <LoadingRows rows={2} />
      ) : (
        <>
          <p className="text-sm">
            Current grade: <span className="font-semibold">{h.gradeLetter ?? '—'}</span> (version{' '}
            {h.version})
          </p>
          {h.changes.length > 0 && (
            <ol className="space-y-1 rounded-md border p-3 text-xs">
              {h.changes.map((c) => (
                <li key={c.version}>
                  v{c.version}: {c.from ?? '—'} → {c.to} by {c.by}, {formatDateTime(c.at)} —{' '}
                  {c.reason}
                </li>
              ))}
            </ol>
          )}
          {h.canChange && (
            <>
              <div className="grid gap-1.5">
                <Label id="new-grade-label">New grade</Label>
                <Select value={letter} onValueChange={setLetter}>
                  <SelectTrigger aria-labelledby="new-grade-label" className="w-32">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {h.letters
                      .filter((l) => l !== h.gradeLetter)
                      .map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="grade-change-reason">Reason</Label>
                <Textarea
                  id="grade-change-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                />
              </div>
            </>
          )}
        </>
      )}
    </FormDialog>
  );
}

function TranscriptView({ t, editable }: { t: Transcript; editable: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <article className="space-y-6 print:space-y-4" aria-label="Transcript">
      <header className="rounded-lg border p-4 print:border-0 print:p-0">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          {t.university ?? 'University'} · Academic transcript
        </p>
        <h2 className="mt-1 text-xl font-semibold">{t.student.name}</h2>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline text-muted-foreground">Student number: </dt>
            <dd className="inline font-mono">{t.student.studentNumber}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Programme: </dt>
            <dd className="inline">
              {t.student.program.code} · {t.student.program.name}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Department: </dt>
            <dd className="inline">
              {t.student.department}, {t.student.school}
            </dd>
          </div>
          {t.student.specialization && (
            <div>
              <dt className="inline text-muted-foreground">Specialization: </dt>
              <dd className="inline">{t.student.specialization}</dd>
            </div>
          )}
          <div>
            <dt className="inline text-muted-foreground">Credits earned: </dt>
            <dd className="inline tabular-nums">{t.creditsEarned}</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">CGPA: </dt>
            <dd className="inline font-semibold tabular-nums">{t.cgpa?.toFixed(2) ?? '—'}</dd>
          </div>
        </dl>
      </header>
      {t.sessions.length === 0 ? (
        <EmptyState title="No academic records yet" />
      ) : (
        t.sessions.map((s) => (
          <section key={s.id} aria-labelledby={`t-${s.id}`} className="break-inside-avoid">
            <h3
              id={`t-${s.id}`}
              className="mb-2 flex flex-wrap items-baseline justify-between gap-2 font-semibold"
            >
              {s.name}
              <span className="text-sm font-normal text-muted-foreground">
                {s.credits} credits{s.gpa !== null && ` · GPA ${s.gpa.toFixed(2)}`}
              </span>
            </h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <caption className="sr-only">{s.name} courses</caption>
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Course
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Credits
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Earned
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Grade
                    </th>
                    {editable && (
                      <th scope="col" className="px-3 py-2 print:hidden">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {s.courses.map((c) => (
                    <tr
                      key={`${c.recordId ?? c.courseId}-${c.grade}`}
                      className="border-b last:border-0"
                    >
                      <td className="px-3 py-2">
                        <span className="font-medium">{c.code}</span> {c.title}
                        {c.repeatedLater && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            (not counted: repeated)
                          </span>
                        )}
                        {c.source !== 'ENROLLMENT' && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({c.source.toLowerCase()}
                            {c.institution ? `, ${c.institution}` : ''})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.credits}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.creditsEarned}</td>
                      <td className="px-3 py-2 font-medium">
                        {c.grade ?? '—'}
                        {c.version > 1 && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            (changed)
                          </span>
                        )}
                      </td>
                      {editable && (
                        <td className="px-3 py-2 text-right print:hidden">
                          {c.recordId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditing(c.recordId)}
                              aria-label={`Grade history for ${c.code}`}
                            >
                              {c.version > 1 ? (
                                <History className="size-4" />
                              ) : (
                                <Pencil className="size-4" />
                              )}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
      <footer className="text-xs text-muted-foreground">
        {POLICY_TEXT[t.repeatPolicy]} W = withdrawn. Generated {formatDateTime(t.generatedAt)}.
      </footer>
      {editing && <GradeChangeDialog recordId={editing} onClose={() => setEditing(null)} />}
    </article>
  );
}

function ExternalRecordDialog({ studentId }: { studentId: string }) {
  const add = useAddExternalRecord(studentId);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<'TRANSFER' | 'EXEMPTION'>('TRANSFER');
  const [course, setCourse] = useState<PickerOption | null>(null);
  const [credits, setCredits] = useState('');
  const [grade, setGrade] = useState('');
  const [institution, setInstitution] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setSource('TRANSFER');
          setCourse(null);
          setCredits('');
          setGrade('');
          setInstitution('');
          setNote('');
          setError(null);
          setOpen(true);
        }}
      >
        <Plus className="size-4" /> Transfer or exemption
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Add a transfer credit or exemption"
        description="It counts towards prerequisites and degree progress, never towards the GPA. Records cannot be deleted."
        submitLabel="Add to record"
        submitting={add.isPending}
        error={error}
        onSubmit={() => {
          if (!course) return setError('Choose the course.');
          if (source === 'TRANSFER' && !institution.trim())
            return setError('Name the institution.');
          if (note.trim().length < 5) return setError('Explain the basis (at least 5 characters).');
          add.mutate(
            {
              source,
              courseId: course.value,
              credits: credits === '' ? undefined : Number(credits),
              gradeLetter: source === 'TRANSFER' ? grade.trim() || null : null,
              externalInstitution: source === 'TRANSFER' ? institution.trim() : null,
              note: note.trim(),
            },
            {
              onSuccess: (r) => {
                toast.success(`${r.course} added (${r.credits} credits)`);
                setOpen(false);
              },
              onError: (e) => setError(errorMessage(e)),
            },
          );
        }}
      >
        <div className="grid gap-1.5">
          <Label id="ext-source">Type</Label>
          <Select value={source} onValueChange={(v) => setSource(v as typeof source)}>
            <SelectTrigger aria-labelledby="ext-source" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TRANSFER">Transfer credit</SelectItem>
              <SelectItem value="EXEMPTION">Exemption</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Course</Label>
          <CoursePicker label="Course" value={course} onChange={setCourse} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ext-credits">Credits (blank = course credits)</Label>
            <Input
              id="ext-credits"
              type="number"
              min={0}
              max={30}
              step="0.5"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
            />
          </div>
          {source === 'TRANSFER' && (
            <div className="grid gap-1.5">
              <Label htmlFor="ext-grade">External grade (optional)</Label>
              <Input
                id="ext-grade"
                maxLength={5}
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              />
            </div>
          )}
        </div>
        {source === 'TRANSFER' && (
          <div className="grid gap-1.5">
            <Label htmlFor="ext-institution">Institution</Label>
            <Input
              id="ext-institution"
              maxLength={200}
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
            />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="ext-note">Basis</Label>
          <Textarea
            id="ext-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. articulation agreement, placement exam result"
          />
        </div>
      </FormDialog>
    </>
  );
}

function TranscriptPage({
  studentId,
  editable,
  canAddRecords = false,
}: {
  studentId: string | 'me';
  editable: boolean;
  canAddRecords?: boolean;
}) {
  const t = useTranscript(studentId);
  return (
    <>
      <PageHeader
        title="Transcript"
        description="Grades by session with session GPA and CGPA."
        actions={
          <>
            {canAddRecords && studentId !== 'me' && <ExternalRecordDialog studentId={studentId} />}
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="size-4" /> Print
            </Button>
          </>
        }
      />
      {t.isPending ? (
        <LoadingRows rows={6} />
      ) : t.isError ? (
        <ErrorState error={t.error} onRetry={() => void t.refetch()} />
      ) : (
        <TranscriptView t={t.data} editable={editable} />
      )}
    </>
  );
}

export function MyTranscriptPage() {
  return <TranscriptPage studentId="me" editable={false} />;
}

export function StudentTranscriptPage() {
  const { studentId = '' } = useParams();
  const canChange = useCan('grade:change');
  const canAddRecords = useCan('record:manage');
  return (
    <TranscriptPage studentId={studentId} editable={canChange} canAddRecords={canAddRecords} />
  );
}

// ----- grade approvals --------------------------------------------------------------------------

export function GradeApprovalsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'SUBMITTED';
  const list = useSubmissions(status);
  return (
    <>
      <PageHeader title="Final grades" description="Grade sheets from sections in your scope." />
      <Tabs
        value={status}
        onValueChange={(v) => setParams({ status: v }, { replace: true })}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="SUBMITTED">Awaiting approval</TabsTrigger>
          <TabsTrigger value="RETURNED">Returned</TabsTrigger>
          <TabsTrigger value="POSTED">Posted</TabsTrigger>
        </TabsList>
      </Tabs>
      {list.isPending ? (
        <LoadingRows rows={4} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description="Grade sheets appear once instructors submit them."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {list.data.map((s) => (
            <li key={s.sectionId}>
              <Link
                to={`/admin/grades/${s.sectionId}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="font-medium">{s.label}</span> {s.title}
                  <span className="block text-xs text-muted-foreground">
                    {s.department} · {s.session} · {s.grades} grade(s)
                    {s.submittedBy && ` · submitted by ${s.submittedBy}`}
                    {s.submittedAt && `, ${formatDateTime(s.submittedAt)}`}
                  </span>
                </span>
                <StatusBadge tone={SUBMISSION_TONE[s.status]}>
                  {SUBMISSION_LABEL[s.status]}
                </StatusBadge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function AdminGradeSheetPage() {
  const { sectionId = '' } = useParams();
  return (
    <>
      <PageHeader
        title="Final grades"
        actions={
          <Button asChild variant="outline">
            <Link to="/admin/grades">All grade sheets</Link>
          </Button>
        }
      />
      <GradesCard sectionId={sectionId} />
    </>
  );
}

// ----- classroom availability (FR-ACAD-002) ---------------------------------------------------------

const DAY_NAMES = [
  '',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const START = 8 * 60;
const END = 20 * 60;

export function ClassroomAvailabilityPage() {
  const sessions = useSessions();
  const [params, setParams] = useSearchParams();
  const fallback = useMemo(
    () =>
      sessions.data?.find((s) => s.status === 'ACTIVE')?.id ??
      sessions.data?.find((s) => s.status === 'PLANNED')?.id ??
      '',
    [sessions.data],
  );
  const sessionId = params.get('sessionId') ?? fallback;
  const day = Number(params.get('day') ?? '1');
  const [minCapacity, setMinCapacity] = useState('');
  const rooms = useAvailability({ sessionId, minCapacity: Number(minCapacity) || undefined });
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set(k, v);
        return n;
      },
      { replace: true },
    );
  const hours = Array.from({ length: (END - START) / 60 + 1 }, (_, i) => START / 60 + i);
  return (
    <>
      <PageHeader
        title="Room availability"
        description="Booked and free times for each classroom."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label id="avail-session">Session</Label>
          <Select value={sessionId} onValueChange={(v) => set('sessionId', v)}>
            <SelectTrigger aria-labelledby="avail-session" className="w-56">
              <SelectValue placeholder="Choose a session" />
            </SelectTrigger>
            <SelectContent>
              {(sessions.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="avail-capacity">Seats at least</Label>
          <Input
            id="avail-capacity"
            type="number"
            min={1}
            className="w-28"
            value={minCapacity}
            onChange={(e) => setMinCapacity(e.target.value)}
          />
        </div>
      </div>
      <Tabs value={String(day)} onValueChange={(v) => set('day', v)} className="mb-4">
        <TabsList className="flex-wrap">
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <TabsTrigger key={d} value={String(d)}>
              {DAY_NAMES[d]!.slice(0, 3)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {!sessionId ? (
        <EmptyState title="Choose a session" />
      ) : rooms.isPending ? (
        <LoadingRows rows={6} />
      ) : rooms.isError ? (
        <ErrorState error={rooms.error} onRetry={() => void rooms.refetch()} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{DAY_NAMES[day]}</CardTitle>
            <CardDescription>
              08:00–20:00. Shaded blocks are booked; hover or focus a block for the section.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <div className="min-w-[44rem]">
              <div className="relative ml-50 h-4 text-[10px] text-muted-foreground" aria-hidden>
                {hours.map((h) => (
                  <span
                    key={h}
                    className="absolute -translate-x-1/2"
                    style={{ left: `${((h * 60 - START) / (END - START)) * 100}%` }}
                  >
                    {String(h).padStart(2, '0')}
                  </span>
                ))}
              </div>
              <ul aria-label={`Room bookings on ${DAY_NAMES[day]}`}>
                {rooms.data.map((r) => {
                  const busy = r.busy.filter((b) => b.dayOfWeek === day);
                  return (
                    <li
                      key={r.id}
                      className="flex items-center gap-2 border-b py-1.5 last:border-0"
                    >
                      <span className="w-48 shrink-0 truncate text-sm">
                        <Link to={`/admin/classrooms/${r.id}`} className="hover:underline">
                          {r.label}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {r.capacity} seats · {r.utilization}% booked
                        </span>
                      </span>
                      <span
                        className="relative h-7 flex-1 rounded bg-success/10"
                        aria-label={busy.length ? `${busy.length} booking(s)` : 'Free all day'}
                      >
                        {busy.map((b) => (
                          <span
                            key={`${b.sectionId}-${b.startMinute}`}
                            tabIndex={0}
                            title={`${b.label} · ${minutesToTime(b.startMinute)}–${minutesToTime(b.endMinute)}`}
                            aria-label={`${b.label} ${minutesToTime(b.startMinute)} to ${minutesToTime(b.endMinute)}`}
                            className="absolute inset-y-0 overflow-hidden rounded bg-brand/80 px-1 text-[10px] leading-7 whitespace-nowrap text-white"
                            style={{
                              left: `${((Math.max(b.startMinute, START) - START) / (END - START)) * 100}%`,
                              width: `${((Math.min(b.endMinute, END) - Math.max(b.startMinute, START)) / (END - START)) * 100}%`,
                            }}
                          >
                            {b.label}
                          </span>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
