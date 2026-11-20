import { AlertTriangle, CalendarClock, GraduationCap, Loader2, Megaphone } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { FormDialog } from '@/components/forms/form-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  EligibilityTable,
  RegistrationStatusBadge,
} from '@/features/registrations/components/registration-dialogs';
import { errorMessage } from '@/services/api-error';
import { formatDateTime, formatRelative } from '@/utils/format';
import {
  useClaimOffer,
  useDropMine,
  useMyEligibility,
  useRegister,
  useStudentDashboard,
  useWithdrawMine,
} from '../api/student-queries';
import type {
  CatalogSession,
  MyRegistration,
  RegistrationWindow,
  StudentAnnouncement,
} from '../api/types';

export const WINDOW_TEXT: Record<
  RegistrationWindow,
  { label: string; tone: 'success' | 'warning' | 'info' | 'neutral' }
> = {
  NOT_CONFIGURED: { label: 'Registration not scheduled', tone: 'neutral' },
  UPCOMING: { label: 'Registration opens soon', tone: 'info' },
  OPEN: { label: 'Registration open', tone: 'success' },
  LATE: { label: 'Late registration (needs approval)', tone: 'warning' },
  ADD_DROP: { label: 'Add/drop period', tone: 'warning' },
  CLOSED: { label: 'Registration closed', tone: 'neutral' },
};

/** Registration window dates for a session, in the user's locale. */
export function DeadlineStrip({ session }: { session: CatalogSession }) {
  const p = session.period;
  const w = WINDOW_TEXT[session.registrationState];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm">
      <StatusBadge tone={w.tone}>{w.label}</StatusBadge>
      {p && (
        <>
          <span>Opens {formatDateTime(p.opensAt)}</span>
          <span>Closes {formatDateTime(p.closesAt)}</span>
          <span>Add/drop until {formatDateTime(p.addDropDeadline)}</span>
          <span>Withdraw until {formatDateTime(p.withdrawalDeadline)}</span>
        </>
      )}
    </div>
  );
}

/**
 * Eligibility preview then registration (FR-STUDENT-005, FR-REG-015): one
 * idempotency key per dialog, so a retried click cannot register twice.
 */
export function RegisterDialog({
  sectionId,
  label,
  trigger,
}: {
  sectionId: string;
  label: string;
  trigger: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const eligibility = useMyEligibility(open ? sectionId : null);
  const register = useRegister();
  const outcome = eligibility.data?.outcome;
  const submit = (joinWaitlist: boolean) =>
    register.mutate(
      { sectionId, joinWaitlist, key },
      {
        onSuccess: (r) => {
          toast.success(
            r.status === 'WAITLISTED'
              ? `You are number ${r.waitlistPosition} on the waitlist for ${label}`
              : r.status === 'PENDING'
                ? `${label}: requested, awaiting approval`
                : `Registered in ${label}`,
          );
          setOpen(false);
        },
        onError: (e) => {
          setError(errorMessage(e));
          void eligibility.refetch();
        },
      },
    );
  return (
    <>
      {trigger(() => {
        setKey(crypto.randomUUID());
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={`Register for ${label}`}
        description="Every rule is checked again when you confirm."
        submitLabel={
          outcome === 'WAITLIST'
            ? 'Join the waitlist'
            : outcome === 'PENDING'
              ? 'Request a place'
              : 'Register'
        }
        submitting={register.isPending}
        error={error}
        onSubmit={() => {
          if (outcome === 'REGISTER' || outcome === 'PENDING') submit(false);
          else if (outcome === 'WAITLIST') submit(true);
          else setError('You cannot register for this section right now.');
        }}
      >
        {eligibility.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking your eligibility…
          </p>
        ) : eligibility.isError ? (
          <ErrorState error={eligibility.error} onRetry={() => void eligibility.refetch()} />
        ) : (
          <EligibilityTable data={eligibility.data} viewer="self" />
        )}
      </FormDialog>
    </>
  );
}

/** The actions a student may take on one of their registrations, given the session's deadlines. */
export function MyRegistrationActions({
  reg,
  session,
}: {
  reg: MyRegistration;
  session: CatalogSession | undefined;
}) {
  const drop = useDropMine();
  const withdraw = useWithdrawMine();
  const claim = useClaimOffer();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Deadlines are compared against the time the row was shown.
  const [now] = useState(() => Date.now());
  const p = session?.period;
  const beforeAddDrop = p ? now <= new Date(p.addDropDeadline).getTime() : false;
  const beforeWithdrawal = p ? now <= new Date(p.withdrawalDeadline).getTime() : false;
  const label = `${reg.course.code} ${reg.section.sectionCode}`;
  const done = (msg: string) => ({
    onSuccess: () => toast.success(msg),
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  const confirm = (
    text: string,
    title: string,
    description: string,
    action: () => void,
    destructive = false,
  ) => (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="outline">
          {text}
        </Button>
      }
      title={title}
      description={description}
      confirmLabel={text}
      destructive={destructive}
      onConfirm={action}
    />
  );
  switch (reg.status) {
    case 'OFFERED':
      return (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={claim.isPending}
            onClick={() => claim.mutate(reg.id, done(`Seat in ${label} claimed`))}
          >
            Claim seat
          </Button>
          {confirm(
            'Decline',
            `Decline the seat in ${label}?`,
            'The seat passes to the next student on the waitlist.',
            () => drop.mutate({ id: reg.id }, done('Offer declined')),
          )}
        </div>
      );
    case 'WAITLISTED':
      return confirm(
        'Leave waitlist',
        `Leave the waitlist for ${label}?`,
        'You lose your place in the queue.',
        () => drop.mutate({ id: reg.id }, done('You left the waitlist')),
      );
    case 'PENDING':
      return confirm(
        'Cancel request',
        `Cancel your request for ${label}?`,
        'The seat held for you is released.',
        () => drop.mutate({ id: reg.id }, done('Request cancelled')),
      );
    case 'REGISTERED':
      if (beforeAddDrop)
        return confirm(
          'Drop',
          `Drop ${label}?`,
          'Before the add/drop deadline there is no transcript entry. Your seat goes to the next student.',
          () => drop.mutate({ id: reg.id }, done(`Dropped ${label}`)),
          true,
        );
      if (beforeWithdrawal)
        return reg.pendingRequest ? (
          <span className="text-xs text-muted-foreground">Withdrawal requested</span>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => (setReason(''), setError(null), setWithdrawOpen(true))}
            >
              Withdraw
            </Button>
            <FormDialog
              open={withdrawOpen}
              onOpenChange={setWithdrawOpen}
              title={`Withdraw from ${label}?`}
              description="Your transcript will show W and the course earns no credits. Your university may need to approve it."
              submitLabel="Withdraw"
              submitting={withdraw.isPending}
              error={error}
              onSubmit={() =>
                withdraw.mutate(
                  { id: reg.id, reason: reason.trim() || null },
                  {
                    onSuccess: (r) => {
                      toast.success(
                        r.status === 'WITHDRAWN'
                          ? `Withdrawn from ${label}`
                          : 'Withdrawal requested',
                      );
                      setWithdrawOpen(false);
                    },
                    onError: (e) => setError(errorMessage(e)),
                  },
                )
              }
            >
              <div className="grid gap-1.5">
                <Label htmlFor="withdraw-reason">Reason (optional)</Label>
                <Textarea
                  id="withdraw-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </FormDialog>
          </>
        );
      return null;
    default:
      return null;
  }
}

export function AnnouncementFeed({
  items,
  empty,
}: {
  items: StudentAnnouncement[];
  empty: string;
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id}>
          <article className="rounded-lg border p-4">
            <header className="mb-1 flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-medium">{a.title}</h3>
              {a.priority !== 'NORMAL' && (
                <StatusBadge tone={a.priority === 'URGENT' ? 'danger' : 'warning'}>
                  {a.priority === 'URGENT' ? 'Urgent' : 'Important'}
                </StatusBadge>
              )}
            </header>
            <p className="mb-2 text-xs text-muted-foreground">
              {a.sections.map((s) => s.label).join(', ')} · {a.author} ·{' '}
              {formatRelative(a.publishedAt)}
            </p>
            <p className="text-sm whitespace-pre-line">{a.body}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}

/** Student dashboard (FR-STUDENT-001), on the student overview page. */
export function StudentDashboard() {
  const dash = useStudentDashboard();
  if (dash.isPending) return <LoadingRows rows={4} />;
  if (dash.isError) return <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />;
  const d = dash.data;
  const pct = d.progress.totalRequired
    ? Math.min(100, Math.round((d.progress.completed / d.progress.totalRequired) * 100))
    : 0;
  const reg = d.registrationSession;
  return (
    <div className="mb-6 space-y-6">
      {d.profile.activeHolds > 0 && (
        <p className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="size-4 text-destructive" aria-hidden /> You have{' '}
          {d.profile.activeHolds} registration hold(s). Contact the registrar’s office.
          <Link to="/student/profile" className="ml-auto underline">
            Details
          </Link>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="font-mono text-sm">{d.profile.studentNumber}</p>
          <p className="font-medium">{d.profile.program.name}</p>
          <p className="text-xs text-muted-foreground">
            Year {d.profile.yearOfStudy}
            {d.profile.specialization ? ` · ${d.profile.specialization}` : ''}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-2xl font-semibold tabular-nums">{d.currentSession?.credits ?? 0}</p>
          <p className="text-xs text-muted-foreground">
            Credits this session{d.currentSession ? ` (${d.currentSession.name})` : ''}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4 sm:col-span-2">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="flex items-center gap-1 font-medium">
              <GraduationCap className="size-4 text-brand" aria-hidden /> Degree progress
            </span>
            <span className="tabular-nums">
              {d.progress.completed} / {d.progress.totalRequired} credits
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Credits completed"
          >
            <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {d.progress.inProgress} credits in progress
          </p>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {reg && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="size-4 text-brand" /> {reg.name} registration
              </CardTitle>
              <CardDescription>
                <StatusBadge tone={WINDOW_TEXT[reg.registrationState].tone}>
                  {WINDOW_TEXT[reg.registrationState].label}
                </StatusBadge>
                {reg.period && ` Closes ${formatDateTime(reg.period.closesAt)}.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {reg.courses.length ? (
                <ul className="divide-y">
                  {reg.courses.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span>
                        <span className="font-mono">{c.label}</span> · {c.title}
                      </span>
                      <RegistrationStatusBadge status={c.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">You have not registered for anything yet.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link to={`/student/catalog?sessionId=${reg.id}`}>Browse the catalog</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/student/planner">Planner</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        {d.currentSession && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">This session’s courses</CardTitle>
              <Button asChild size="sm" variant="ghost">
                <Link to="/student/timetable">Timetable</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {d.currentSession.courses.length ? (
                <ul className="divide-y text-sm">
                  {d.currentSession.courses.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                      <Link to={`/student/courses/${c.sectionId}`} className="hover:underline">
                        <span className="font-mono">{c.label}</span> · {c.title}
                      </Link>
                      <span className="text-xs text-muted-foreground">{c.credits} cr</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No courses this session.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      {d.pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Waiting on</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {d.pending.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-mono">{p.label}</span> · {p.title}
                  </span>
                  <span className="flex items-center gap-2">
                    <RegistrationStatusBadge status={p.status} />
                    {p.offerExpiresAt && (
                      <span className="text-xs">claim by {formatDateTime(p.offerExpiresAt)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <Button asChild size="sm" variant="ghost" className="mt-2">
              <Link to="/student/registrations">Manage registrations</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="size-4 text-brand" /> Announcements
          </CardTitle>
          <Button asChild size="sm" variant="ghost">
            <Link to="/student/announcements">All</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <AnnouncementFeed items={d.announcements} empty="No announcements from your courses." />
        </CardContent>
      </Card>
    </div>
  );
}
