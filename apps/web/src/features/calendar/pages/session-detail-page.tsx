import { CheckCircle2, Clock, Loader2, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  APPROVAL_MODES,
  priorityWindowSchema,
  registrationPeriodSchema,
  sessionPolicySchema,
} from '@ucrams/shared';
import { NumberField, SelectField, SwitchField } from '@/components/forms/fields';
import { FormAlert } from '@/components/forms/form-alert';
import { TextField } from '@/components/forms/form-field';
import { applyServerErrors } from '@/components/forms/server-errors';
import { useZodForm } from '@/components/forms/use-zod-form';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailList } from '@/components/shared/detail-list';
import { EntityStatus } from '@/components/shared/entity-status';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePrograms } from '@/features/structure/api/structure-queries';
import { useUniversity } from '@/features/system/api/system-queries';
import { errorMessage } from '@/services/api-error';
import { useCan } from '@/store/auth-store';
import { formatDate, formatInZone, isoToZonedInput, zonedInputToIso } from '@/utils/timezone';
import {
  REGISTRATION_STATE,
  SESSION_TYPE_LABEL,
  useAddWindow,
  useDeleteSession,
  useRemoveWindow,
  useSavePeriod,
  useSavePolicy,
  useSession,
  useTransitionSession,
  type AcademicSession,
} from '../api/calendar-queries';
import { SessionDialog } from '../components/calendar-dialogs';

const APPROVAL_LABEL: Record<string, string> = {
  NONE: 'No approval needed',
  ALL: 'Every registration needs approval',
  CROSS_DEPARTMENT: 'Only courses outside the student’s department',
  LATE_ONLY: 'Only late registrations',
};

const ACTIONS: Record<string, Array<{ action: string; label: string; description: string }>> = {
  PLANNED: [
    {
      action: 'activate',
      label: 'Activate',
      description:
        'The session becomes active. Registration still follows its registration period.',
    },
  ],
  ACTIVE: [
    {
      action: 'complete',
      label: 'Mark completed',
      description: 'Teaching has finished. Completed sessions cannot change registration settings.',
    },
  ],
  COMPLETED: [
    { action: 'archive', label: 'Archive', description: 'Archived sessions are read-only.' },
  ],
  ARCHIVED: [],
};

function Lifecycle({ session, canManage }: { session: AcademicSession; canManage: boolean }) {
  const transition = useTransitionSession(session.id);
  const remove = useDeleteSession();
  const navigate = useNavigate();
  if (!canManage) return null;
  const run = (action: string) =>
    transition.mutate(action, {
      onSuccess: () => toast.success('Session updated'),
      onError: (e) => toast.error(errorMessage(e)),
    });
  return (
    <>
      {(session.status === 'PLANNED' || session.status === 'ACTIVE') && !session.isCurrent && (
        <ConfirmDialog
          trigger={
            <Button variant="outline" disabled={transition.isPending}>
              <Star className="size-4" /> Make current
            </Button>
          }
          title={`Make ${session.name} the current ${SESSION_TYPE_LABEL[session.type]?.toLowerCase()} session?`}
          description="The previous current session of this type stops being current."
          confirmLabel="Make current"
          onConfirm={() => run('make-current')}
        />
      )}
      {ACTIONS[session.status]!.map((a) => (
        <ConfirmDialog
          key={a.action}
          trigger={<Button disabled={transition.isPending}>{a.label}</Button>}
          title={`${a.label}: ${session.name}?`}
          description={a.description}
          confirmLabel={a.label}
          onConfirm={() => run(a.action)}
        />
      ))}
      {session.status === 'PLANNED' && (
        <ConfirmDialog
          trigger={
            <Button variant="outline" disabled={remove.isPending} aria-label="Delete session">
              <Trash2 className="size-4" />
            </Button>
          }
          title={`Delete ${session.name}?`}
          description="Its policy and registration period are deleted too. This cannot be undone."
          confirmLabel="Delete session"
          destructive
          onConfirm={() =>
            remove.mutate(session.id, {
              onSuccess: () => {
                toast.success('Session deleted');
                navigate('/admin/academic-sessions');
              },
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
        />
      )}
    </>
  );
}

const DEFAULT_POLICY = {
  minCredits: 12,
  maxCredits: 24,
  maxCreditsWithOverride: null,
  approvalMode: 'NONE' as const,
  waitlistEnabled: true,
  waitlistMaxPerSection: null,
  promotionMode: 'AUTO_ENROLL' as const,
  offerWindowHours: 24,
  countWaitlistInCredits: false,
  allowInProgressPrereqs: true,
  withdrawalRequiresApproval: false,
};

function PolicyForm({ session, editable }: { session: AcademicSession; editable: boolean }) {
  const save = useSavePolicy(session.id);
  const [error, setError] = useState<string | null>(null);
  const defaults = (session.policy as typeof DEFAULT_POLICY | null) ?? DEFAULT_POLICY;
  const form = useZodForm(sessionPolicySchema, defaults);
  const promotion = form.watch('promotionMode');
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit((v) => {
        setError(null);
        save.mutate(v, {
          onSuccess: () => toast.success('Registration policy saved'),
          onError: (e) =>
            setError(applyServerErrors(e, form.setError, Object.keys(DEFAULT_POLICY))),
        });
      })}
    >
      {!session.policy && (
        <FormAlert>
          No policy saved yet. These are suggested values; review and save them.
        </FormAlert>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <fieldset disabled={!editable} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField
            control={form.control}
            name="minCredits"
            label="Minimum credits"
            step="0.5"
          />
          <NumberField
            control={form.control}
            name="maxCredits"
            label="Maximum credits"
            step="0.5"
          />
          <NumberField
            control={form.control}
            name="maxCreditsWithOverride"
            label="Maximum with override"
            step="0.5"
            hint="Optional"
          />
        </div>
        <SelectField
          control={form.control}
          name="approvalMode"
          label="Registration approval"
          options={APPROVAL_MODES.map((m) => ({ value: m, label: APPROVAL_LABEL[m]! }))}
          disabled={!editable}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SwitchField
            control={form.control}
            name="waitlistEnabled"
            label="Waitlists"
            description="Students can join a waitlist when a section is full."
          />
          <SwitchField
            control={form.control}
            name="countWaitlistInCredits"
            label="Count waitlisted credits"
            description="Waitlisted courses count toward the credit limit."
          />
          <SwitchField
            control={form.control}
            name="allowInProgressPrereqs"
            label="In-progress prerequisites"
            description="Courses being taken now satisfy prerequisites."
          />
          <SwitchField
            control={form.control}
            name="withdrawalRequiresApproval"
            label="Withdrawal approval"
            description="Withdrawals after add/drop need approval."
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            control={form.control}
            name="promotionMode"
            label="When a seat opens"
            options={[
              { value: 'AUTO_ENROLL', label: 'Enroll the next student' },
              { value: 'OFFER', label: 'Offer the seat to claim' },
            ]}
            disabled={!editable}
          />
          {promotion === 'OFFER' && (
            <NumberField
              control={form.control}
              name="offerWindowHours"
              label="Claim window (hours)"
              step="1"
            />
          )}
          <NumberField
            control={form.control}
            name="waitlistMaxPerSection"
            label="Waitlist size per section"
            step="1"
            hint="Empty = unlimited"
          />
        </div>
      </fieldset>
      {editable && (
        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}Save policy
          </Button>
        </div>
      )}
    </form>
  );
}

type PeriodForm = {
  opensAt: string;
  closesAt: string;
  lateClosesAt: string;
  addDropDeadline: string;
  withdrawalDeadline: string;
};
const PERIOD_FIELDS: Array<{ name: keyof PeriodForm; label: string; hint?: string }> = [
  { name: 'opensAt', label: 'Registration opens' },
  { name: 'closesAt', label: 'Registration closes' },
  {
    name: 'lateClosesAt',
    label: 'Late registration closes',
    hint: 'Optional. Late registrations need approval.',
  },
  { name: 'addDropDeadline', label: 'Add/drop deadline' },
  { name: 'withdrawalDeadline', label: 'Withdrawal deadline' },
];

function PeriodFormCard({
  session,
  editable,
  timeZone,
}: {
  session: AcademicSession;
  editable: boolean;
  timeZone: string;
}) {
  const save = useSavePeriod(session.id);
  const [error, setError] = useState<string | null>(null);
  const p = session.registrationPeriod;
  const form = useForm<PeriodForm>({
    defaultValues: {
      opensAt: isoToZonedInput(p?.opensAt, timeZone),
      closesAt: isoToZonedInput(p?.closesAt, timeZone),
      lateClosesAt: isoToZonedInput(p?.lateClosesAt, timeZone),
      addDropDeadline: isoToZonedInput(p?.addDropDeadline, timeZone),
      withdrawalDeadline: isoToZonedInput(p?.withdrawalDeadline, timeZone),
    },
  });
  const submit = form.handleSubmit((v) => {
    setError(null);
    form.clearErrors();
    const toIso = (s: string) => (s ? zonedInputToIso(s, timeZone) : undefined);
    const payload = {
      opensAt: toIso(v.opensAt),
      closesAt: toIso(v.closesAt),
      lateClosesAt: toIso(v.lateClosesAt) ?? null,
      addDropDeadline: toIso(v.addDropDeadline),
      withdrawalDeadline: toIso(v.withdrawalDeadline),
    };
    const parsed = registrationPeriodSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]) as keyof PeriodForm;
        form.setError(field, { message: payload[field] ? issue.message : 'Required' });
      }
      return;
    }
    save.mutate(parsed.data, {
      onSuccess: () => toast.success('Registration period saved'),
      onError: (e) =>
        setError(
          applyServerErrors(
            e,
            form.setError,
            PERIOD_FIELDS.map((f) => f.name),
          ),
        ),
    });
  });
  return (
    <form noValidate className="grid gap-4" onSubmit={submit}>
      {error && <FormAlert>{error}</FormAlert>}
      <p className="text-xs text-muted-foreground">
        Times are in the university time zone ({timeZone}).
      </p>
      <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
        {PERIOD_FIELDS.map((f) => (
          <TextField
            key={f.name}
            label={f.label}
            type="datetime-local"
            hint={f.hint}
            error={form.formState.errors[f.name]?.message}
            {...form.register(f.name)}
          />
        ))}
      </fieldset>
      {editable && (
        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="size-4 animate-spin" />}Save registration period
          </Button>
        </div>
      )}
    </form>
  );
}

function PriorityWindows({
  session,
  editable,
  timeZone,
}: {
  session: AcademicSession;
  editable: boolean;
  timeZone: string;
}) {
  const add = useAddWindow(session.id);
  const remove = useRemoveWindow(session.id);
  const programs = usePrograms({ limit: 100, status: 'ACTIVE' });
  const [error, setError] = useState<string | null>(null);
  const [opensLocal, setOpensLocal] = useState('');
  const form = useZodForm(priorityWindowSchema, {
    name: '',
    opensAt: '',
    programId: null,
    yearOfStudy: null,
    cohort: '',
  });
  const windows = session.registrationPeriod?.priorityWindows ?? [];
  useEffect(() => {
    form.setValue('opensAt', opensLocal ? zonedInputToIso(opensLocal, timeZone) : '');
  }, [opensLocal, timeZone, form]);
  if (!session.registrationPeriod) return <EmptyState title="Set the registration period first" />;
  return (
    <div className="space-y-4">
      {windows.length === 0 ? (
        <EmptyState
          title="No priority windows"
          description="Everyone can register when general registration opens."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {windows.map((w) => (
            <li key={w.id} className="flex items-center gap-3 px-4 py-3">
              <Clock className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{w.name}</p>
                <p className="text-sm text-muted-foreground">
                  Opens {formatInZone(w.opensAt, timeZone)} for{' '}
                  {[
                    w.program && w.program.code,
                    w.yearOfStudy && `year ${w.yearOfStudy}`,
                    w.cohort && `cohort ${w.cohort}`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </div>
              {editable && (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" size="icon" aria-label={`Remove ${w.name}`}>
                      <Trash2 className="size-4" />
                    </Button>
                  }
                  title={`Remove “${w.name}”?`}
                  description="These students will register when general registration opens."
                  confirmLabel="Remove"
                  destructive
                  onConfirm={() =>
                    remove.mutate(w.id, {
                      onSuccess: () => toast.success('Priority window removed'),
                    })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form
          noValidate
          className="grid gap-4 rounded-lg border p-4"
          onSubmit={form.handleSubmit((v) => {
            setError(null);
            add.mutate(v, {
              onSuccess: () => {
                toast.success('Priority window added');
                form.reset();
                setOpensLocal('');
              },
              onError: (e) =>
                setError(
                  applyServerErrors(e, form.setError, [
                    'name',
                    'opensAt',
                    'programId',
                    'yearOfStudy',
                    'cohort',
                  ]),
                ),
            });
          })}
        >
          <p className="text-sm font-medium">Add a priority window</p>
          {error && <FormAlert>{error}</FormAlert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Name"
              placeholder="Final-year students"
              error={form.formState.errors.name?.message}
              {...form.register('name')}
            />
            <TextField
              label="Opens"
              type="datetime-local"
              value={opensLocal}
              onChange={(e) => setOpensLocal(e.target.value)}
              error={form.formState.errors.opensAt?.message}
            />
            <SelectField
              control={form.control}
              name="programId"
              label="Program"
              allowEmpty
              emptyLabel="Any program"
              options={(programs.data?.data ?? []).map((p) => ({
                value: p.id,
                label: `${p.code} – ${p.name}`,
              }))}
            />
            <NumberField
              control={form.control}
              name="yearOfStudy"
              label="Year of study"
              step="1"
              min={1}
            />
            <TextField
              label="Cohort"
              hint="Optional student group label"
              {...form.register('cohort')}
            />
          </div>
          <div>
            <Button type="submit" variant="outline" disabled={add.isPending}>
              <Plus className="size-4" /> Add window
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function SessionDetailPage() {
  const { sessionId = '' } = useParams();
  const session = useSession(sessionId);
  const university = useUniversity();
  const canManageSession = useCan('session:manage');
  const canManageRegistration = useCan('registration_period:manage');
  if (session.isPending || university.isPending) return <LoadingRows rows={6} />;
  if (session.isError)
    return <ErrorState error={session.error} onRetry={() => void session.refetch()} />;
  const s = session.data;
  const timeZone = university.data?.timezone ?? 'UTC';
  const finished = s.status === 'COMPLETED' || s.status === 'ARCHIVED';
  const registrationEditable = canManageRegistration && !finished;
  const state = REGISTRATION_STATE[s.registrationState];
  return (
    <>
      <PageHeader
        title={s.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{s.code}</span>
            <EntityStatus status={s.status} />
            {s.isCurrent && (
              <StatusBadge tone="info">
                Current {SESSION_TYPE_LABEL[s.type]?.toLowerCase()} session
              </StatusBadge>
            )}
            <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
          </span>
        }
        actions={
          <>
            {canManageSession && s.status !== 'ARCHIVED' && (
              <SessionDialog
                entity={s}
                trigger={(open) => (
                  <Button variant="outline" onClick={open}>
                    <Pencil className="size-4" /> Edit
                  </Button>
                )}
              />
            )}
            <Lifecycle session={s} canManage={canManageSession} />
          </>
        }
      />
      {finished && (
        <div className="mb-4">
          <FormAlert tone="success">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="size-3.5" /> This session is {s.status.toLowerCase()}; its
              registration settings are read-only.
            </span>
          </FormAlert>
        </div>
      )}
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="period">Registration period</TabsTrigger>
          <TabsTrigger value="policy">Policy</TabsTrigger>
          <TabsTrigger value="priority">Priority windows</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardContent>
              <DetailList
                items={[
                  { label: 'Academic year', value: s.academicYear.label },
                  { label: 'Type', value: SESSION_TYPE_LABEL[s.type] },
                  { label: 'Starts', value: formatDate(s.startDate) },
                  { label: 'Ends', value: formatDate(s.endDate) },
                  { label: 'Grading scale', value: s.gradingScale?.name ?? 'Not set' },
                  {
                    label: 'Registration opens',
                    value: s.registrationPeriod
                      ? formatInZone(s.registrationPeriod.opensAt, timeZone)
                      : 'Not configured',
                  },
                  {
                    label: 'Add/drop deadline',
                    value: s.registrationPeriod
                      ? formatInZone(s.registrationPeriod.addDropDeadline, timeZone)
                      : '—',
                  },
                  {
                    label: 'Credit limits',
                    value: s.policy
                      ? `${s.policy.minCredits}–${s.policy.maxCredits} credits`
                      : 'No policy',
                  },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="period" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Registration period</CardTitle>
              <CardDescription>When students can register, drop and withdraw.</CardDescription>
            </CardHeader>
            <CardContent>
              <PeriodFormCard
                key={s.registrationPeriod?.id ?? 'new'}
                session={s}
                editable={registrationEditable}
                timeZone={timeZone}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="policy" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Registration policy</CardTitle>
              <CardDescription>
                Credit limits, approvals and waitlist behaviour for this session.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PolicyForm session={s} editable={registrationEditable} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="priority" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Priority windows</CardTitle>
              <CardDescription>
                Let specific cohorts register before general registration opens.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PriorityWindows session={s} editable={registrationEditable} timeZone={timeZone} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
