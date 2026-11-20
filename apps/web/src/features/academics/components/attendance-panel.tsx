import { CalendarPlus, Check, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { minutesToTime, timeToMinutes, type AttendanceStatus } from '@ucrams/shared';
import { FormDialog } from '@/components/forms/form-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/services/api-error';
import {
  useAddClass,
  useAttendance,
  useAttendanceSettings,
  useDeleteClass,
  useMarkAttendance,
  type AttendanceRegister,
} from '../api/academic-queries';

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED: 'Excused',
};
export const ATTENDANCE_TONE: Record<AttendanceStatus, StatusTone> = {
  PRESENT: 'success',
  ABSENT: 'danger',
  LATE: 'warning',
  EXCUSED: 'neutral',
};
const ORDER: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];

export const percentTone = (p: number | null): StatusTone =>
  p === null ? 'neutral' : p >= 75 ? 'success' : p >= 60 ? 'warning' : 'danger';

function AddClassDialog({ sectionId }: { sectionId: string }) {
  const add = useAddClass(sectionId);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [topic, setTopic] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        onClick={() => {
          setDate(new Date().toISOString().slice(0, 10));
          setTime('');
          setTopic('');
          setError(null);
          setOpen(true);
        }}
      >
        <CalendarPlus className="size-4" /> Add class
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Add a class"
        description="Then mark who attended."
        submitLabel="Add"
        submitting={add.isPending}
        error={error}
        onSubmit={() => {
          if (!date) return setError('Choose a date.');
          add.mutate(
            { date, startMinute: time ? timeToMinutes(time) : null, topic: topic.trim() || null },
            {
              onSuccess: () => {
                toast.success('Class added');
                setOpen(false);
              },
              onError: (e) => setError(errorMessage(e)),
            },
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="class-date">Date</Label>
            <Input
              id="class-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="class-time">Start time (optional)</Label>
            <Input
              id="class-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="class-topic">Topic (optional)</Label>
          <Input
            id="class-topic"
            value={topic}
            maxLength={200}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>
      </FormDialog>
    </>
  );
}

function MarkSheet({
  register,
  sessionId,
  onDone,
}: {
  register: AttendanceRegister;
  sessionId: string;
  onDone: () => void;
}) {
  const session = register.sessions.find((s) => s.id === sessionId)!;
  const mark = useMarkAttendance();
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>(() =>
    Object.fromEntries(session.records.map((r) => [r.studentId, r.status])),
  );
  const unmarked = register.students.filter((s) => !marks[s.studentId]).length;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">
            {session.date}
            {session.startMinute !== null && ` · ${minutesToTime(session.startMinute)}`}
          </CardTitle>
          <CardDescription>{session.topic ?? 'Class'}</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setMarks((m) => ({
                ...Object.fromEntries(
                  register.students.map((s) => [s.studentId, 'PRESENT' as const]),
                ),
                ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== 'PRESENT')),
              }))
            }
          >
            <Check className="size-4" /> Everyone else present
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-md border" aria-label="Mark attendance">
          {register.students.map((s) => (
            <li
              key={s.studentId}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 text-sm">
                <span className="font-medium">{s.name}</span>{' '}
                <span className="text-xs text-muted-foreground">{s.studentNumber}</span>
              </span>
              <span
                role="radiogroup"
                aria-label={`Attendance for ${s.name}`}
                className="flex gap-1"
              >
                {ORDER.map((status) => (
                  <button
                    key={status}
                    type="button"
                    role="radio"
                    aria-checked={marks[s.studentId] === status}
                    onClick={() => setMarks((m) => ({ ...m, [s.studentId]: status }))}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                      marks[s.studentId] === status
                        ? status === 'PRESENT'
                          ? 'border-success bg-success text-white'
                          : status === 'ABSENT'
                            ? 'border-destructive bg-destructive text-white'
                            : status === 'LATE'
                              ? 'border-warning bg-warning text-warning-foreground'
                              : 'border-foreground bg-foreground text-background'
                        : 'hover:bg-muted',
                    )}
                  >
                    {ATTENDANCE_LABEL[status]}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={mark.isPending || Object.keys(marks).length === 0}
            onClick={() =>
              mark.mutate(
                {
                  id: sessionId,
                  records: Object.entries(marks).map(([studentId, status]) => ({
                    studentId,
                    status,
                  })),
                },
                {
                  onSuccess: () => {
                    toast.success('Attendance saved');
                    onDone();
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
          >
            Save attendance
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Close
          </Button>
          {unmarked > 0 && (
            <span className="text-xs text-muted-foreground">{unmarked} not marked yet</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Attendance register for instructors (FR-ACAD-003). */
export function AttendancePanel({ sectionId }: { sectionId: string }) {
  const register = useAttendance(sectionId);
  const settings = useAttendanceSettings(sectionId);
  const remove = useDeleteClass();
  const [open, setOpen] = useState<string | null>(null);
  if (register.isPending) return <LoadingRows rows={4} />;
  if (register.isError)
    return <ErrorState error={register.error} onRetry={() => void register.refetch()} />;
  const r = register.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {r.canManage ? (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={r.enabled}
              onCheckedChange={(v) =>
                settings.mutate(v, { onError: (e) => toast.error(errorMessage(e)) })
              }
            />
            Track attendance for this section
          </label>
        ) : (
          <span />
        )}
        {r.canManage && r.enabled && <AddClassDialog sectionId={sectionId} />}
      </div>
      {open && <MarkSheet key={open} register={r} sessionId={open} onDone={() => setOpen(null)} />}
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Classes</CardTitle>
          </CardHeader>
          <CardContent>
            {r.sessions.length === 0 ? (
              <EmptyState
                title="No classes yet"
                description="Add a class to start taking attendance."
              />
            ) : (
              <ul className="divide-y">
                {r.sessions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{s.date}</span>
                      {s.startMinute !== null && ` · ${minutesToTime(s.startMinute)}`}
                      {s.topic && <span className="text-muted-foreground"> · {s.topic}</span>}
                      <span className="block text-xs text-muted-foreground">
                        {s.marked} of {r.students.length} marked
                      </span>
                    </span>
                    {r.canManage && r.enabled && (
                      <span className="flex shrink-0 gap-1">
                        <Button variant="outline" size="sm" onClick={() => setOpen(s.id)}>
                          Mark
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove class on ${s.date}`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          }
                          title="Remove this class?"
                          description="Its attendance marks are deleted too."
                          confirmLabel="Remove"
                          destructive
                          onConfirm={() =>
                            remove.mutate(s.id, { onError: (e) => toast.error(errorMessage(e)) })
                          }
                        />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Students</CardTitle>
            <CardDescription>
              Present or late, over marked classes (excused not counted).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {r.students.map((s) => (
                <li
                  key={s.studentId}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {s.name}{' '}
                    <span className="text-xs text-muted-foreground">{s.studentNumber}</span>
                  </span>
                  <StatusBadge tone={percentTone(s.percent)}>
                    {s.percent === null ? 'No marks' : `${s.percent}%`}
                  </StatusBadge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
