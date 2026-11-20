import { CheckCircle2, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/forms/form-dialog';
import { SearchPicker, type PickerOption } from '@/components/forms/search-picker';
import { StatusBadge } from '@/components/shared/status-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/services/api-error';
import { apiGetPage } from '@/services/http';
import { useCan } from '@/store/auth-store';
import {
  useDecide,
  useDrop,
  useEligibility,
  useRegisterOnBehalf,
  useWithdraw,
} from '../api/registration-queries';
import {
  OVERRIDE_LABEL,
  REGISTRATION_STATUS_LABEL,
  REGISTRATION_TONE,
  RULE_LABEL,
  type Eligibility,
  type Registration,
  type RegistrationStatus,
} from '../api/types';

type Trigger = (open: () => void) => ReactNode;

export function RegistrationStatusBadge({ status }: { status: RegistrationStatus }) {
  return (
    <StatusBadge tone={REGISTRATION_TONE[status]}>{REGISTRATION_STATUS_LABEL[status]}</StatusBadge>
  );
}

const OUTCOME_TEXT: Record<'admin' | 'self', Record<Eligibility['outcome'], string>> = {
  admin: {
    REGISTER: 'Eligible: the student will be registered.',
    PENDING: 'Eligible, but the registration needs approval (the seat is held meanwhile).',
    WAITLIST: 'The section is full; the student can join the waitlist.',
    FULL: 'The section and its waitlist are full.',
    BLOCKED: 'Not eligible: see the failed checks below.',
  },
  self: {
    REGISTER: 'You can register for this section.',
    PENDING: 'You can register; your request needs approval and holds a seat meanwhile.',
    WAITLIST: 'This section is full. You can join the waitlist.',
    FULL: 'This section and its waitlist are full.',
    BLOCKED: 'You cannot register yet: see the checks below.',
  },
};

/** Every rule's result for a student and section (FR-STUDENT-005, FR-REG-001). */
export function EligibilityTable({
  data,
  viewer = 'admin',
}: {
  data: Eligibility;
  viewer?: 'admin' | 'self';
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{OUTCOME_TEXT[viewer][data.outcome]}</p>
      <ul className="divide-y rounded-lg border text-sm">
        {data.rules.map((r) => (
          <li key={r.code} className="flex items-start gap-2 px-3 py-2">
            {r.passed ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" />
            ) : r.code === 'SECTION_FULL' ? (
              <MinusCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Full" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />
            )}
            <span className="min-w-0">
              <span className="font-medium">{RULE_LABEL[r.code] ?? r.code}</span>
              <span className="block text-muted-foreground">{r.message}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function searchStudents(q: string): Promise<PickerOption[]> {
  const page = await apiGetPage<{
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
    program: { code: string };
    yearOfStudy: number;
  }>('/students', { params: { q: q || undefined, limit: 20, status: 'ACTIVE' } });
  return page.data.map((s) => ({
    value: s.id,
    label: `${s.firstName} ${s.lastName} (${s.studentNumber})`,
    description: `${s.program.code} · Year ${s.yearOfStudy}`,
  }));
}

async function searchSections(q: string, sessionId?: string): Promise<PickerOption[]> {
  const page = await apiGetPage<{
    id: string;
    sectionCode: string;
    course: { code: string; title: string };
    session: { name: string };
    enrolledCount: number;
    capacity: number;
  }>('/course-sections', {
    params: { q: q || undefined, status: 'PUBLISHED', limit: 20, sessionId },
  });
  return page.data.map((s) => ({
    value: s.id,
    label: `${s.course.code} ${s.sectionCode} · ${s.course.title}`,
    description: `${s.session.name} · ${s.enrolledCount}/${s.capacity} enrolled`,
  }));
}

/** Administrative registration with live eligibility and per-rule overrides (FR-ADMIN-022). */
export function RegisterOnBehalfDialog({
  student,
  section,
  sessionId,
  trigger,
}: {
  student?: PickerOption;
  section?: PickerOption;
  sessionId?: string;
  trigger: Trigger;
}) {
  const save = useRegisterOnBehalf();
  const canOverride = useCan('registration:override');
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<PickerOption | null>(null);
  const [what, setWhat] = useState<PickerOption | null>(null);
  const [overrides, setOverrides] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [waitlist, setWaitlist] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useEligibility(who?.value ?? '', what?.value ?? '');
  const failed = (preview.data?.rules ?? []).filter((r) => !r.passed && r.overridable);
  const show = () => {
    setWho(student ?? null);
    setWhat(section ?? null);
    setOverrides([]);
    setReason('');
    setWaitlist(false);
    setError(null);
    setOpen(true);
  };
  return (
    <>
      {trigger(show)}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Register a student"
        description="Every rule is checked again when you submit. Overrides bypass only the rules you tick and are recorded with your reason."
        submitLabel={waitlist ? 'Add to waitlist' : 'Register'}
        submitting={save.isPending}
        error={error}
        wide
        onSubmit={() => {
          if (!who || !what) {
            setError('Choose a student and a section.');
            return;
          }
          if (overrides.length && reason.trim().length < 5) {
            setError('Overrides need a reason of at least 5 characters.');
            return;
          }
          setError(null);
          save.mutate(
            {
              studentId: who.value,
              sectionId: what.value,
              joinWaitlist: waitlist,
              overrides,
              reason: reason.trim() || null,
            },
            {
              onSuccess: (r) => {
                toast.success(
                  `${r.student.name}: ${REGISTRATION_STATUS_LABEL[r.status].toLowerCase()} in ${r.course.code} ${r.section.sectionCode}`,
                );
                setOpen(false);
              },
              onError: (err) => {
                setError(errorMessage(err));
                void preview.refetch();
              },
            },
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Student</Label>
            <SearchPicker
              label="Student"
              value={who}
              onChange={setWho}
              search={searchStudents}
              queryKey={['people', 'student-picker']}
              placeholder="Name or student number…"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Section</Label>
            <SearchPicker
              label="Section"
              value={what}
              onChange={setWhat}
              search={(q) => searchSections(q, sessionId)}
              queryKey={['catalog', 'section-picker', sessionId ?? 'any']}
              placeholder="Course code or title…"
            />
          </div>
        </div>
        {preview.isFetching && !preview.data && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking eligibility…
          </p>
        )}
        {preview.isError && (
          <p className="text-sm text-destructive">{errorMessage(preview.error)}</p>
        )}
        {preview.data && <EligibilityTable data={preview.data} />}
        {preview.data &&
          (preview.data.outcome === 'WAITLIST' || preview.data.outcome === 'FULL') && (
            <div className="flex items-center gap-2">
              <Switch
                id="join-waitlist"
                checked={waitlist}
                onCheckedChange={setWaitlist}
                disabled={preview.data.outcome === 'FULL'}
              />
              <Label htmlFor="join-waitlist">Add to the waitlist instead</Label>
            </div>
          )}
        {canOverride && failed.length > 0 && (
          <fieldset className="grid gap-2 rounded-lg border border-warning/50 bg-warning/10 p-3">
            <legend className="px-1 text-sm font-medium">Override</legend>
            {failed.map((r) => (
              <label key={r.code} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={overrides.includes(r.overridable!)}
                  onCheckedChange={(v) =>
                    setOverrides((all) =>
                      v
                        ? [...new Set([...all, r.overridable!])]
                        : all.filter((x) => x !== r.overridable),
                    )
                  }
                  aria-label={`Override ${OVERRIDE_LABEL[r.overridable!] ?? r.overridable}`}
                />
                {OVERRIDE_LABEL[r.overridable!] ?? r.overridable}
              </label>
            ))}
            <div className="grid gap-1.5">
              <Label htmlFor="override-reason">Reason</Label>
              <Textarea
                id="override-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Approved by the head of department"
              />
            </div>
          </fieldset>
        )}
      </FormDialog>
    </>
  );
}

/** Reject (with a note) or approve a pending registration. */
export function DecisionDialog({
  registration,
  decision,
  trigger,
}: {
  registration: Registration;
  decision: 'APPROVE' | 'REJECT';
  trigger: Trigger;
}) {
  const decide = useDecide();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {trigger(() => {
        setNote('');
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`${decision === 'APPROVE' ? 'Approve' : 'Reject'} ${registration.student.name} in ${registration.course.code} ${registration.section.sectionCode}?`}
        description={
          decision === 'REJECT'
            ? 'The seat is released and the next waitlisted student may move up.'
            : 'The student becomes registered.'
        }
        submitLabel={decision === 'APPROVE' ? 'Approve' : 'Reject'}
        submitting={decide.isPending}
        error={error}
        onSubmit={() => {
          if (decision === 'REJECT' && note.trim().length < 5) {
            setError('Give a reason of at least 5 characters; the student will see it.');
            return;
          }
          decide.mutate(
            { id: registration.id, decision, note: note.trim() || null },
            {
              onSuccess: () => {
                toast.success(
                  decision === 'APPROVE' ? 'Registration approved' : 'Registration rejected',
                );
                setOpen(false);
              },
              onError: (e) => setError(errorMessage(e)),
            },
          );
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="decision-note">
            {decision === 'REJECT' ? 'Reason' : 'Note (optional)'}
          </Label>
          <Textarea
            id="decision-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </FormDialog>
    </>
  );
}

const ACTION_COPY = {
  drop: {
    title: 'Drop',
    description: 'Before the add/drop deadline the seat is released with no transcript entry.',
    overrides: ['PERIOD', 'COREQUISITE'],
  },
  withdraw: {
    title: 'Withdraw',
    description: 'After add/drop: the transcript shows W and the course earns no credits.',
    overrides: ['PERIOD'],
  },
} as const;

/** Administrative drop/withdraw with optional deadline or corequisite overrides. */
export function RegistrationActionDialog({
  registration,
  action,
  trigger,
}: {
  registration: Registration;
  action: 'drop' | 'withdraw';
  trigger: Trigger;
}) {
  const drop = useDrop();
  const withdraw = useWithdraw();
  const canOverride = useCan('registration:override');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [overrides, setOverrides] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const copy = ACTION_COPY[action];
  const label =
    action === 'drop' && registration.status === 'WAITLISTED'
      ? 'Remove from waitlist'
      : action === 'drop' && registration.status === 'PENDING'
        ? 'Cancel request'
        : copy.title;
  const pending = drop.isPending || withdraw.isPending;
  return (
    <>
      {trigger(() => {
        setReason('');
        setOverrides([]);
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`${label}: ${registration.student.name}, ${registration.course.code} ${registration.section.sectionCode}`}
        description={copy.description}
        submitLabel={label}
        submitting={pending}
        error={error}
        onSubmit={() => {
          if (overrides.length && reason.trim().length < 5) {
            setError('Overrides need a reason of at least 5 characters.');
            return;
          }
          const body = { id: registration.id, reason: reason.trim() || null, overrides };
          const done = {
            onSuccess: () => (toast.success('Registration updated'), setOpen(false)),
            onError: (e: unknown) => setError(errorMessage(e)),
          };
          if (action === 'drop') drop.mutate(body, done);
          else withdraw.mutate(body, done);
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="action-reason">Reason</Label>
          <Textarea
            id="action-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        {canOverride && (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Overrides</legend>
            {copy.overrides.map((o) => (
              <label key={o} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={overrides.includes(o)}
                  onCheckedChange={(v) =>
                    setOverrides((all) => (v ? [...all, o] : all.filter((x) => x !== o)))
                  }
                  aria-label={`Override ${o === 'PERIOD' ? 'deadline' : 'corequisite dependency'}`}
                />
                {o === 'PERIOD' ? 'Ignore the deadline' : 'Ignore corequisite dependencies'}
              </label>
            ))}
          </fieldset>
        )}
      </FormDialog>
    </>
  );
}
