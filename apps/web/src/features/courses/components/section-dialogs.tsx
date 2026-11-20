import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  CLASSROOM_TYPES,
  classroomCreateSchema,
  INSTRUCTOR_ROLES,
  MEETING_TYPES,
  minutesToTime,
  rollForwardSchema,
  sectionCreateSchema,
  sectionUpdateSchema,
  timeToMinutes,
} from '@ucrams/shared';
import { NumberField, SelectField, SwitchField, TextareaField } from '@/components/forms/fields';
import { FormAlert } from '@/components/forms/form-alert';
import { FormDialog } from '@/components/forms/form-dialog';
import { TextField } from '@/components/forms/form-field';
import { SearchPicker, type PickerOption } from '@/components/forms/search-picker';
import { applyServerErrors } from '@/components/forms/server-errors';
import { useZodForm } from '@/components/forms/use-zod-form';
import { STATUS_OPTIONS } from '@/components/shared/entity-status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSessions } from '@/features/calendar/api/calendar-queries';
import { useCampuses, useDepartmentOptions } from '@/features/structure/api/structure-queries';
import { errorMessage, isApiError } from '@/services/api-error';
import { apiGetPage } from '@/services/http';
import {
  useRollForward,
  useSaveClassroom,
  useSaveSection,
  useSetSectionSchedule,
  useTransitionSection,
} from '../api/courses-queries';
import {
  CLASSROOM_TYPE_LABEL,
  DAY_LABEL,
  DAY_NAME,
  MEETING_TYPE_LABEL,
  ROLE_LABEL,
  type Classroom,
  type Conflict,
  type RollForwardResult,
  type ScheduleResult,
  type Section,
} from '../api/types';
import { CoursePicker, FacultyPicker } from './pickers';

type Trigger = (open: () => void) => ReactNode;

function useDialog(reset: () => void) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    open,
    setOpen,
    error,
    setError,
    show: () => {
      reset();
      setError(null);
      setOpen(true);
    },
  };
}

export const formatTime = (m: number) => minutesToTime(m);
export const meetingLabel = (m: { dayOfWeek: number; startMinute: number; endMinute: number }) =>
  `${DAY_LABEL[m.dayOfWeek]} ${formatTime(m.startMinute)}–${formatTime(m.endMinute)}`;

/** Sessions open for scheduling (planned or active), current first. */
export function useSchedulableSessions() {
  const sessions = useSessions();
  return (sessions.data ?? [])
    .filter((s) => s.status === 'PLANNED' || s.status === 'ACTIVE')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

// ----- sections ---------------------------------------------------------------

export function SectionDialog({
  section,
  defaultCourse,
  defaultSessionId,
  trigger,
  onSaved,
}: {
  section?: Section;
  defaultCourse?: { id: string; code: string; title: string; defaultCapacity?: number | null };
  defaultSessionId?: string;
  trigger: Trigger;
  onSaved?: (s: Section) => void;
}) {
  const save = useSaveSection();
  const sessions = useSchedulableSessions();
  const campuses = useCampuses();
  const [course, setCourse] = useState<PickerOption | null>(null);
  const defaults = section
    ? {
        sectionCode: section.sectionCode,
        capacity: section.capacity,
        waitlistCapacity: section.waitlistCapacity,
        campusId: section.campus?.id ?? null,
        registrationOpen: section.registrationOpen,
        notes: section.notes ?? '',
      }
    : {
        courseId: defaultCourse?.id ?? '',
        sessionId: defaultSessionId ?? sessions.find((s) => s.status === 'ACTIVE')?.id ?? '',
        sectionCode: 'A',
        capacity: defaultCourse?.defaultCapacity ?? 40,
        waitlistCapacity: 10,
        campusId: null,
        registrationOpen: true,
        notes: '',
      };
  const form = useZodForm(section ? sectionUpdateSchema : sectionCreateSchema, defaults as never);
  const d = useDialog(() => {
    form.reset(defaults as never);
    setCourse(
      defaultCourse
        ? { value: defaultCourse.id, label: `${defaultCourse.code} · ${defaultCourse.title}` }
        : null,
    );
  });
  const e = form.formState.errors as Record<string, { message?: string } | undefined>;
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title={section ? `Edit ${section.course.code} ${section.sectionCode}` : 'New section'}
        description={
          section
            ? undefined
            : 'Sections start as drafts. Add meetings and an instructor, then publish.'
        }
        submitLabel={section ? 'Save changes' : 'Create section'}
        submitting={save.isPending}
        error={d.error}
        onSubmit={form.handleSubmit((v) =>
          save.mutate(
            { id: section?.id, ...(v as object) },
            {
              onSuccess: (saved) => {
                toast.success(
                  section
                    ? 'Section saved'
                    : `Section ${saved.course.code} ${saved.sectionCode} created`,
                );
                d.setOpen(false);
                onSaved?.(saved);
              },
              onError: (err) =>
                d.setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
            },
          ),
        )}
      >
        {!section && (
          <>
            <div className="grid gap-1.5">
              <Label>Course</Label>
              <CoursePicker
                label="Course"
                value={course}
                invalid={!!e.courseId}
                onChange={(o) => {
                  setCourse(o);
                  form.setValue('courseId' as never, (o?.value ?? '') as never, {
                    shouldValidate: true,
                  });
                }}
              />
              {e.courseId && (
                <p className="text-xs font-medium text-destructive">{e.courseId.message}</p>
              )}
            </div>
            <SelectField
              control={form.control}
              name={'sessionId' as never}
              label="Session"
              options={sessions.map((s) => ({
                value: s.id,
                label: `${s.name}${s.status === 'ACTIVE' ? ' (active)' : ''}`,
              }))}
            />
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Section code"
            error={e.sectionCode?.message}
            {...form.register('sectionCode' as never)}
          />
          <NumberField
            control={form.control}
            name={'capacity' as never}
            label="Capacity"
            step="1"
            min={1}
          />
          <NumberField
            control={form.control}
            name={'waitlistCapacity' as never}
            label="Waitlist size"
            step="1"
            min={0}
          />
        </div>
        <SelectField
          control={form.control}
          name={'campusId' as never}
          label="Campus"
          allowEmpty
          emptyLabel="Not specified"
          options={(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <SwitchField
          control={form.control}
          name={'registrationOpen' as never}
          label="Registration open"
          description="Close registration for this section without unpublishing it."
        />
        <TextareaField control={form.control} name={'notes' as never} label="Notes" rows={2} />
      </FormDialog>
    </>
  );
}

/** Lists conflicts returned by the API and collects an override reason. */
function ConflictPanel({
  conflicts,
  canOverride,
  reason,
  onReason,
}: {
  conflicts: Conflict[];
  canOverride: boolean;
  reason: string;
  onReason: (r: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-warning/50 bg-warning/10 p-3" role="alert">
      <p className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="size-4 text-warning" aria-hidden /> Scheduling conflicts
      </p>
      <ul className="space-y-1 text-sm">
        {conflicts.map((c, i) => (
          <li key={i}>
            <span className="font-medium">
              {c.kind === 'CLASSROOM' ? 'Room' : 'Instructor'} {c.resource}
            </span>{' '}
            is booked {meetingLabel(c)} by {c.section.courseCode} {c.section.sectionCode}
          </li>
        ))}
      </ul>
      {canOverride ? (
        <div className="grid gap-1.5">
          <Label htmlFor="override-reason">Reason for overriding</Label>
          <Textarea
            id="override-reason"
            rows={2}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder="e.g. Combined lecture for both sections"
          />
          <p className="text-xs text-muted-foreground">
            The override and reason are recorded in the audit log.
          </p>
        </div>
      ) : (
        <p className="text-sm">
          Choose another time or room. Overriding room conflicts needs the “override conflicts”
          permission.
        </p>
      )}
    </div>
  );
}

type ConflictState = { conflicts: Conflict[]; canOverride: boolean } | null;

function conflictFrom(err: unknown): ConflictState {
  if (
    isApiError(err) &&
    (err.code === 'CLASSROOM_CONFLICT' || err.code === 'INSTRUCTOR_CONFLICT')
  ) {
    const details = err.details as { conflicts: Conflict[]; canOverride: boolean };
    return { conflicts: details.conflicts, canOverride: details.canOverride };
  }
  return null;
}

function reportResult(result: ScheduleResult, what: string) {
  toast.success(
    result.overriddenConflicts.length
      ? `${what} saved with ${result.overriddenConflicts.length} overridden conflict(s)`
      : `${what} saved`,
  );
  result.warnings.forEach((w) => toast.warning(w));
}

type MeetingDraft = {
  dayOfWeek: string;
  start: string;
  end: string;
  type: string;
  room: PickerOption | null;
};

function RowSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={className ?? 'w-full'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const dayOptions = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: DAY_NAME[d]! }));
const typeOptions = MEETING_TYPES.map((t) => ({ value: t, label: MEETING_TYPE_LABEL[t] ?? t }));

/** Weekly meetings editor with classroom search and conflict override (FR-CRS-005/007). */
export function MeetingsDialog({ section, trigger }: { section: Section; trigger: Trigger }) {
  const save = useSetSectionSchedule(section.id);
  const [rows, setRows] = useState<MeetingDraft[]>([]);
  const [conflict, setConflict] = useState<ConflictState>(null);
  const [reason, setReason] = useState('');
  const d = useDialog(() => {
    setRows(
      section.meetings.map((m) => ({
        dayOfWeek: String(m.dayOfWeek),
        start: formatTime(m.startMinute),
        end: formatTime(m.endMinute),
        type: m.type,
        room: m.classroom ? { value: m.classroom.id, label: m.classroom.label } : null,
      })),
    );
    setConflict(null);
    setReason('');
  });
  const set = (i: number, patch: Partial<MeetingDraft>) => {
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setConflict(null);
  };
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title={`Meetings: ${section.course.code} ${section.sectionCode}`}
        description="Weekly times in the university time zone. Back-to-back classes are fine; overlaps are checked against every other section this session."
        submitLabel={conflict?.canOverride ? 'Save anyway' : 'Save meetings'}
        submitting={save.isPending}
        error={d.error}
        wide
        onSubmit={() => {
          const meetings = rows.map((r) => ({
            dayOfWeek: Number(r.dayOfWeek),
            startMinute: timeToMinutes(r.start),
            endMinute: timeToMinutes(r.end),
            type: r.type,
            classroomId: r.room?.value ?? null,
          }));
          if (
            meetings.some(
              (m) =>
                m.startMinute === null || m.endMinute === null || m.endMinute! <= m.startMinute!,
            )
          ) {
            d.setError('Each meeting needs a start time before its end time.');
            return;
          }
          if (conflict && !conflict.canOverride) return;
          if (conflict && reason.trim().length < 5) {
            d.setError('Give a reason of at least 5 characters to override.');
            return;
          }
          d.setError(null);
          save.mutate(
            {
              part: 'meetings',
              body: { meetings, override: conflict ? { reason: reason.trim() } : null },
            },
            {
              onSuccess: (result) => {
                reportResult(result, 'Meetings');
                d.setOpen(false);
              },
              onError: (err) => {
                const c = conflictFrom(err);
                if (c) setConflict(c);
                else d.setError(errorMessage(err));
              },
            },
          );
        }}
      >
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No meetings (e.g. a project or online course).
          </p>
        )}
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-2 gap-2 rounded-lg border p-3 sm:grid-cols-4 sm:items-center"
          >
            <RowSelect
              label={`Meeting ${i + 1} day`}
              value={r.dayOfWeek}
              options={dayOptions}
              onChange={(v) => set(i, { dayOfWeek: v })}
            />
            <Input
              type="time"
              step={300}
              aria-label={`Meeting ${i + 1} start`}
              value={r.start}
              onChange={(e) => set(i, { start: e.target.value })}
            />
            <Input
              type="time"
              step={300}
              aria-label={`Meeting ${i + 1} end`}
              value={r.end}
              onChange={(e) => set(i, { end: e.target.value })}
            />
            <RowSelect
              label={`Meeting ${i + 1} type`}
              value={r.type}
              options={typeOptions}
              onChange={(v) => set(i, { type: v })}
            />
            <SearchPicker
              className="col-span-2 sm:col-span-3"
              label={`Meeting ${i + 1} classroom`}
              placeholder="Room (optional)"
              value={r.room}
              clearable
              queryKey={['catalog', 'room-picker']}
              search={async (q) =>
                (
                  await apiGetPage<Classroom>('/classrooms', {
                    params: { q: q || undefined, status: 'ACTIVE', limit: 20 },
                  })
                ).data.map((c) => ({
                  value: c.id,
                  label: c.label,
                  description: `${c.campus.name} · ${c.capacity} seats · ${CLASSROOM_TYPE_LABEL[c.type]}`,
                }))
              }
              onChange={(o) => set(i, { room: o })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="justify-self-end"
              aria-label={`Remove meeting ${i + 1}`}
              onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((all) => [
                ...all,
                {
                  dayOfWeek: '1',
                  start: '09:00',
                  end: '10:00',
                  type: section.course.category === 'LABORATORY' ? 'LAB' : 'LECTURE',
                  room: all.at(-1)?.room ?? null,
                },
              ])
            }
          >
            <Plus className="size-4" /> Add meeting
          </Button>
        </div>
        {conflict && (
          <ConflictPanel
            conflicts={conflict.conflicts}
            canOverride={conflict.canOverride}
            reason={reason}
            onReason={setReason}
          />
        )}
      </FormDialog>
    </>
  );
}

type InstructorDraft = { option: PickerOption | null; role: string };
const roleOptions = INSTRUCTOR_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r }));

/** Instructor assignment with conflict override and load warnings (FR-CRS-008). */
export function InstructorsDialog({ section, trigger }: { section: Section; trigger: Trigger }) {
  const save = useSetSectionSchedule(section.id);
  const [rows, setRows] = useState<InstructorDraft[]>([]);
  const [conflict, setConflict] = useState<ConflictState>(null);
  const [reason, setReason] = useState('');
  const d = useDialog(() => {
    setRows(
      section.instructors.map((i) => ({
        option: { value: i.facultyMemberId, label: i.name },
        role: i.role,
      })),
    );
    setConflict(null);
    setReason('');
  });
  const set = (i: number, patch: Partial<InstructorDraft>) => {
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setConflict(null);
  };
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title={`Instructors: ${section.course.code} ${section.sectionCode}`}
        description="One primary instructor. Overlapping teaching and load above a faculty member’s limit are flagged."
        submitLabel={conflict ? 'Assign anyway' : 'Save instructors'}
        submitting={save.isPending}
        error={d.error}
        wide
        onSubmit={() => {
          const instructors = rows
            .filter((r) => r.option)
            .map((r) => ({ facultyMemberId: r.option!.value, role: r.role }));
          if (instructors.filter((i) => i.role === 'PRIMARY').length > 1) {
            d.setError('Only one primary instructor.');
            return;
          }
          if (conflict && reason.trim().length < 5) {
            d.setError('Give a reason of at least 5 characters to override.');
            return;
          }
          d.setError(null);
          save.mutate(
            {
              part: 'instructors',
              body: { instructors, override: conflict ? { reason: reason.trim() } : null },
            },
            {
              onSuccess: (result) => {
                reportResult(result, 'Instructors');
                d.setOpen(false);
              },
              onError: (err) => {
                const c = conflictFrom(err);
                if (c) setConflict(c);
                else d.setError(errorMessage(err));
              },
            },
          );
        }}
      >
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-center">
            <FacultyPicker
              label={`Instructor ${i + 1}`}
              value={r.option}
              exclude={rows
                .filter((_, j) => j !== i)
                .flatMap((x) => (x.option ? [x.option.value] : []))}
              onChange={(o) => set(i, { option: o })}
            />
            <RowSelect
              label={`Instructor ${i + 1} role`}
              value={r.role}
              options={roleOptions}
              onChange={(v) => set(i, { role: v })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove instructor ${i + 1}`}
              onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRows((all) => [
                ...all,
                {
                  option: null,
                  role: all.some((x) => x.role === 'PRIMARY') ? 'SECONDARY' : 'PRIMARY',
                },
              ])
            }
          >
            <Plus className="size-4" /> Add instructor
          </Button>
        </div>
        {conflict && (
          <ConflictPanel
            conflicts={conflict.conflicts}
            canOverride={conflict.canOverride}
            reason={reason}
            onReason={setReason}
          />
        )}
      </FormDialog>
    </>
  );
}

/** Lifecycle buttons for a section (FR-CRS-005, FR-CRS-010). */
export function SectionActions({ section }: { section: Section }) {
  const act = useTransitionSection(section.id);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = (action: string, done: string) =>
    act.mutate(
      { action },
      { onSuccess: () => toast.success(done), onError: (err) => toast.error(errorMessage(err)) },
    );
  const p = section.permissions;
  const buttons: ReactNode[] = [];
  if (p.publish && section.status === 'DRAFT')
    buttons.push(
      <Button
        key="publish"
        onClick={() => run('publish', 'Section published')}
        disabled={act.isPending}
      >
        Publish
      </Button>,
    );
  if (p.publish && section.status === 'PUBLISHED')
    buttons.push(
      <Button
        key="close"
        variant="outline"
        onClick={() => run('close', 'Section closed')}
        disabled={act.isPending}
      >
        Close
      </Button>,
    );
  if (p.publish && section.status === 'CLOSED')
    buttons.push(
      <Button
        key="reopen"
        variant="outline"
        onClick={() => run('reopen', 'Section reopened')}
        disabled={act.isPending}
      >
        Reopen
      </Button>,
    );
  if (
    p.publish &&
    (section.status === 'PUBLISHED' || section.status === 'CLOSED') &&
    section.session.status === 'COMPLETED'
  )
    buttons.push(
      <Button
        key="complete"
        variant="outline"
        onClick={() => run('complete', 'Section completed')}
        disabled={act.isPending}
      >
        Mark completed
      </Button>,
    );
  if (p.cancel && ['DRAFT', 'PUBLISHED', 'CLOSED'].includes(section.status))
    buttons.push(
      <Button
        key="cancel"
        variant="outline"
        className="text-destructive"
        onClick={() => {
          setReason('');
          setError(null);
          setCancelOpen(true);
        }}
      >
        Cancel section
      </Button>,
    );
  return (
    <>
      {buttons}
      <FormDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${section.course.code} ${section.sectionCode}?`}
        description="The section closes for good. Enrolled and waitlisted students are cancelled and notified once registration is live. This cannot be undone."
        submitLabel="Cancel section"
        submitting={act.isPending}
        error={error}
        onSubmit={() => {
          if (reason.trim().length < 5) {
            setError('Give a reason of at least 5 characters.');
            return;
          }
          act.mutate(
            { action: 'cancel', reason: reason.trim() },
            {
              onSuccess: () => {
                toast.success('Section cancelled');
                setCancelOpen(false);
              },
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="cancel-reason">Reason</Label>
          <Textarea
            id="cancel-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </FormDialog>
    </>
  );
}

export function RollForwardDialog({
  defaultToSessionId,
  trigger,
}: {
  defaultToSessionId?: string;
  trigger: Trigger;
}) {
  const run = useRollForward();
  const sessions = useSessions();
  const departments = useDepartmentOptions();
  const [result, setResult] = useState<RollForwardResult | null>(null);
  const defaults = {
    fromSessionId: '',
    toSessionId: defaultToSessionId ?? '',
    departmentId: null as string | null,
    includeInstructors: true,
  };
  const form = useZodForm(rollForwardSchema, defaults);
  const d = useDialog(() => {
    form.reset(defaults);
    setResult(null);
  });
  const all = sessions.data ?? [];
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title="Copy sections from another session"
        description="Copies non-cancelled sections of active courses, with their meetings, rooms and (optionally) instructors, as drafts. Existing section codes are skipped."
        submitLabel={result ? 'Done' : 'Copy sections'}
        submitting={run.isPending}
        error={d.error}
        onSubmit={
          result
            ? () => d.setOpen(false)
            : form.handleSubmit((v) =>
                run.mutate(v, {
                  onSuccess: (r) => {
                    setResult(r);
                    toast.success(`${r.created.length} section(s) copied`);
                  },
                  onError: (err) =>
                    d.setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
                }),
              )
        }
      >
        {result ? (
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium">{result.created.length}</span> section(s) copied as
              drafts
              {result.withConflicts
                ? `, ${result.withConflicts} with scheduling conflicts to resolve before publishing`
                : ''}
              .
            </p>
            {result.skipped.length > 0 && (
              <details>
                <summary className="cursor-pointer">{result.skipped.length} skipped</summary>
                <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-muted-foreground">
                  {result.skipped.map((s, i) => (
                    <li key={i}>
                      {s.course} {s.sectionCode}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ) : (
          <>
            <SelectField
              control={form.control}
              name="fromSessionId"
              label="Copy from"
              options={all.map((s) => ({ value: s.id, label: s.name }))}
            />
            <SelectField
              control={form.control}
              name="toSessionId"
              label="Copy into"
              options={all
                .filter((s) => s.status === 'PLANNED' || s.status === 'ACTIVE')
                .map((s) => ({ value: s.id, label: s.name }))}
            />
            <SelectField
              control={form.control}
              name="departmentId"
              label="Department"
              allowEmpty
              emptyLabel="All departments I manage"
              options={(departments.data?.data ?? []).map((dep) => ({
                value: dep.id,
                label: dep.name,
              }))}
            />
            <SwitchField
              control={form.control}
              name="includeInstructors"
              label="Copy instructors"
              description="Inactive faculty are left out."
            />
          </>
        )}
      </FormDialog>
    </>
  );
}

// ----- classrooms -------------------------------------------------------------

export function ClassroomDialog({
  classroom,
  trigger,
}: {
  classroom?: Classroom;
  trigger: Trigger;
}) {
  const save = useSaveClassroom();
  const campuses = useCampuses();
  const [equipment, setEquipment] = useState('');
  const defaults = {
    campusId: classroom?.campus.id ?? '',
    building: classroom?.building ?? '',
    roomNumber: classroom?.roomNumber ?? '',
    name: classroom?.name ?? '',
    capacity: classroom?.capacity ?? 40,
    type: (classroom?.type ?? 'CLASSROOM') as (typeof CLASSROOM_TYPES)[number],
    equipment: classroom?.equipment ?? [],
    status: (classroom?.status ?? 'ACTIVE') as 'ACTIVE',
  };
  const form = useZodForm(classroomCreateSchema, defaults);
  const d = useDialog(() => {
    form.reset(defaults);
    setEquipment(defaults.equipment.join(', '));
  });
  const e = form.formState.errors;
  return (
    <>
      {trigger(d.show)}
      <FormDialog
        open={d.open}
        onOpenChange={d.setOpen}
        title={classroom ? `Edit ${classroom.label}` : 'New classroom'}
        submitLabel={classroom ? 'Save changes' : 'Create classroom'}
        submitting={save.isPending}
        error={d.error}
        onSubmit={form.handleSubmit((v) =>
          save.mutate(
            { id: classroom?.id, ...v },
            {
              onSuccess: () => {
                toast.success('Classroom saved');
                d.setOpen(false);
              },
              onError: (err) =>
                d.setError(applyServerErrors(err, form.setError, Object.keys(defaults))),
            },
          ),
        )}
      >
        <SelectField
          control={form.control}
          name="campusId"
          label="Campus"
          options={(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Building" error={e.building?.message} {...form.register('building')} />
          <TextField
            label="Room number"
            error={e.roomNumber?.message}
            {...form.register('roomNumber')}
          />
          <TextField
            label="Name"
            hint="Optional, e.g. “Turing Lab”"
            error={e.name?.message}
            {...form.register('name')}
          />
          <NumberField control={form.control} name="capacity" label="Seats" step="1" min={1} />
          <SelectField
            control={form.control}
            name="type"
            label="Type"
            options={CLASSROOM_TYPES.map((t) => ({
              value: t,
              label: CLASSROOM_TYPE_LABEL[t] ?? t,
            }))}
          />
          <SelectField
            control={form.control}
            name="status"
            label="Status"
            options={STATUS_OPTIONS}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="room-equipment">Equipment</Label>
          <Input
            id="room-equipment"
            value={equipment}
            placeholder="Projector, Whiteboard"
            onChange={(ev) => {
              setEquipment(ev.target.value);
              form.setValue(
                'equipment',
                ev.target.value
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              );
            }}
          />
          <p className="text-xs text-muted-foreground">Separate items with commas.</p>
        </div>
      </FormDialog>
    </>
  );
}

export function ConflictNote({ children }: { children: ReactNode }) {
  return <FormAlert>{children}</FormAlert>;
}
