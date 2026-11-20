import { History, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { REGISTRATION_STATUSES } from '@ucrams/shared';
import { FormDialog } from '@/components/forms/form-dialog';
import { DetailList } from '@/components/shared/detail-list';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useListParams } from '@/hooks/use-list-params';
import { useSessions } from '@/features/calendar/api/calendar-queries';
import { meetingLabel } from '@/features/courses/components/section-dialogs';
import { useDepartmentOptions } from '@/features/structure/api/structure-queries';
import { errorMessage } from '@/services/api-error';
import { useCan } from '@/store/auth-store';
import { formatDateTime } from '@/utils/format';
import {
  useBulkDecide,
  useDecideRequest,
  useRegistration,
  useRegistrationRequests,
  useRegistrations,
} from '../api/registration-queries';
import {
  REGISTRATION_STATUS_LABEL,
  type Registration,
  type RegistrationRequest,
} from '../api/types';
import {
  DecisionDialog,
  RegisterOnBehalfDialog,
  RegistrationActionDialog,
  RegistrationStatusBadge,
} from '../components/registration-dialogs';

const studentCell = (r: Registration) => (
  <div className="min-w-0">
    <p className="font-medium">{r.student.name}</p>
    <p className="text-xs text-muted-foreground">
      <span className="font-mono">{r.student.studentNumber}</span> · {r.student.program.code} · Year{' '}
      {r.student.yearOfStudy}
    </p>
  </div>
);
const sectionCell = (r: Registration) => (
  <div className="min-w-0">
    <p className="font-medium">
      <span className="font-mono">
        {r.course.code} {r.section.sectionCode}
      </span>
    </p>
    <p className="truncate text-xs text-muted-foreground">{r.course.title}</p>
  </div>
);

const FILTERS = ['sessionId', 'status', 'departmentId', 'hasOverrides'] as const;

function AllRegistrations() {
  const { page, q, filters, update } = useListParams(FILTERS);
  const sessions = useSessions();
  const departments = useDepartmentOptions();
  const list = useRegistrations({
    page,
    q,
    limit: 25,
    ...filters,
    hasOverrides: filters.hasOverrides || undefined,
  });
  const navigate = useNavigate();
  return (
    <>
      <ListToolbar>
        <SearchInput
          value={q}
          onChange={(v) => update({ q: v })}
          placeholder="Student or course code"
          label="Search registrations"
        />
        <FilterSelect
          label="Session"
          value={filters.sessionId}
          onChange={(v) => update({ sessionId: v })}
          options={(sessions.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          allLabel="All sessions"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          options={REGISTRATION_STATUSES.map((s) => ({
            value: s,
            label: REGISTRATION_STATUS_LABEL[s],
          }))}
          allLabel="All statuses"
        />
        <FilterSelect
          label="Department"
          value={filters.departmentId}
          onChange={(v) => update({ departmentId: v })}
          options={(departments.data?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          allLabel="All departments"
        />
        <FilterSelect
          label="Overrides"
          value={filters.hasOverrides}
          onChange={(v) => update({ hasOverrides: v })}
          options={[{ value: 'true', label: 'Created with overrides' }]}
          allLabel="Any"
        />
      </ListToolbar>
      <DataTable<Registration>
        caption="Registrations"
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        rows={list.data?.data}
        meta={list.data?.meta && 'total' in list.data.meta ? list.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/admin/registrations/${r.id}`)}
        emptyTitle={
          Object.values(filters).some(Boolean) || q
            ? 'No matching registrations'
            : 'No registrations yet'
        }
        columns={[
          { key: 'student', header: 'Student', cell: studentCell },
          { key: 'section', header: 'Section', cell: sectionCell },
          { key: 'session', header: 'Session', cell: (r) => r.session.name, hideOnMobile: true },
          {
            key: 'when',
            header: 'Submitted',
            cell: (r) => <span className="text-xs">{formatDateTime(r.createdAt)}</span>,
            hideOnMobile: true,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <div className="flex flex-wrap gap-1">
                <RegistrationStatusBadge status={r.status} />
                {r.overrides.length > 0 && <span className="text-xs text-warning">override</span>}
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

/** Pending registrations with selection for bulk decisions (FR-ADMIN-021). */
function Approvals() {
  const [page, setPage] = useState(1);
  const list = useRegistrations({ status: 'PENDING', page, limit: 50 });
  const bulk = useBulkDecide();
  const [selected, setSelected] = useState<string[]>([]);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rows = list.data?.data ?? [];
  const allChecked = rows.length > 0 && rows.every((r) => selected.includes(r.id));
  const run = (decision: 'APPROVE' | 'REJECT', n?: string) =>
    bulk.mutate(
      { ids: selected, decision, note: n ?? null },
      {
        onSuccess: (r) => {
          toast.success(
            `${r.succeeded} ${decision === 'APPROVE' ? 'approved' : 'rejected'}${r.failed ? `, ${r.failed} could not be decided` : ''}`,
          );
          r.results.filter((x) => !x.ok).forEach((x) => toast.error(x.error?.message ?? 'Failed'));
          setSelected([]);
          setRejectOpen(false);
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {selected.length
            ? `${selected.length} selected`
            : 'Pending registrations hold a seat until decided.'}
        </p>
        <Button
          size="sm"
          disabled={!selected.length || bulk.isPending}
          onClick={() => run('APPROVE')}
        >
          Approve selected
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected.length || bulk.isPending}
          onClick={() => {
            setNote('');
            setError(null);
            setRejectOpen(true);
          }}
        >
          Reject selected
        </Button>
      </div>
      <DataTable<Registration>
        caption="Pending registrations"
        isLoading={list.isPending}
        error={list.error}
        rows={rows}
        meta={list.data?.meta && 'total' in list.data.meta ? list.data.meta : undefined}
        onPageChange={setPage}
        rowKey={(r) => r.id}
        emptyTitle="Nothing awaiting approval"
        columns={[
          {
            key: 'select',
            header: '',
            cell: (r) => (
              <Checkbox
                aria-label={`Select ${r.student.name} in ${r.course.code}`}
                checked={selected.includes(r.id)}
                onCheckedChange={(v) =>
                  setSelected((all) => (v ? [...all, r.id] : all.filter((x) => x !== r.id)))
                }
              />
            ),
          },
          { key: 'student', header: 'Student', cell: studentCell },
          { key: 'section', header: 'Section', cell: sectionCell },
          { key: 'session', header: 'Session', cell: (r) => r.session.name, hideOnMobile: true },
          {
            key: 'when',
            header: 'Requested',
            cell: (r) => <span className="text-xs">{formatDateTime(r.createdAt)}</span>,
            hideOnMobile: true,
          },
          {
            key: 'actions',
            header: '',
            cell: (r) => (
              <div className="flex gap-1">
                <DecisionDialog
                  registration={r}
                  decision="APPROVE"
                  trigger={(open) => (
                    <Button size="sm" variant="outline" onClick={open}>
                      Approve
                    </Button>
                  )}
                />
                <DecisionDialog
                  registration={r}
                  decision="REJECT"
                  trigger={(open) => (
                    <Button size="sm" variant="ghost" onClick={open}>
                      Reject
                    </Button>
                  )}
                />
              </div>
            ),
          },
        ]}
      />
      {rows.length > 0 && (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <Checkbox
            checked={allChecked}
            onCheckedChange={(v) => setSelected(v ? rows.map((r) => r.id) : [])}
            aria-label="Select all on this page"
          />
          Select all on this page
        </label>
      )}
      <FormDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Reject ${selected.length} registration(s)?`}
        description="Seats are released; students see your reason."
        submitLabel="Reject"
        submitting={bulk.isPending}
        error={error}
        onSubmit={() =>
          note.trim().length < 5
            ? setError('Give a reason of at least 5 characters.')
            : run('REJECT', note.trim())
        }
      >
        <div className="grid gap-1.5">
          <Label htmlFor="bulk-note">Reason</Label>
          <Textarea
            id="bulk-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </FormDialog>
    </>
  );
}

function RequestDecision({
  request,
  decision,
}: {
  request: RegistrationRequest;
  decision: 'APPROVE' | 'REJECT';
}) {
  const decide = useDecideRequest();
  return (
    <Button
      size="sm"
      variant={decision === 'APPROVE' ? 'outline' : 'ghost'}
      disabled={decide.isPending}
      onClick={() =>
        decide.mutate(
          {
            id: request.id,
            decision,
            note:
              decision === 'REJECT' ? 'Withdrawal not approved by the registrar’s office' : null,
          },
          {
            onSuccess: () =>
              toast.success(decision === 'APPROVE' ? 'Withdrawal approved' : 'Withdrawal declined'),
            onError: (e) => toast.error(errorMessage(e)),
          },
        )
      }
    >
      {decision === 'APPROVE' ? 'Approve' : 'Decline'}
    </Button>
  );
}

function WithdrawalRequests() {
  const [page, setPage] = useState(1);
  const list = useRegistrationRequests({ status: 'PENDING', page, limit: 25 });
  return (
    <DataTable<RegistrationRequest>
      caption="Withdrawal requests"
      isLoading={list.isPending}
      error={list.error}
      rows={list.data?.data}
      meta={list.data?.meta && 'total' in list.data.meta ? list.data.meta : undefined}
      onPageChange={setPage}
      rowKey={(r) => r.id}
      emptyTitle="No withdrawal requests"
      columns={[
        { key: 'student', header: 'Student', cell: (r) => studentCell(r.registration) },
        { key: 'section', header: 'Section', cell: (r) => sectionCell(r.registration) },
        {
          key: 'reason',
          header: 'Reason',
          cell: (r) => <span className="text-sm">{r.reason ?? '—'}</span>,
          hideOnMobile: true,
        },
        {
          key: 'when',
          header: 'Requested',
          cell: (r) => <span className="text-xs">{formatDateTime(r.createdAt)}</span>,
          hideOnMobile: true,
        },
        {
          key: 'actions',
          header: '',
          cell: (r) => (
            <div className="flex gap-1">
              <RequestDecision request={r} decision="APPROVE" />
              <RequestDecision request={r} decision="REJECT" />
            </div>
          ),
        },
      ]}
    />
  );
}

export function RegistrationsPage() {
  const [params, setParams] = useSearchParams();
  const canApprove = useCan('registration:approve');
  const canManage = useCan('registration:manage');
  const tab = params.get('tab') ?? 'all';
  return (
    <>
      <PageHeader
        title="Registrations"
        description="Every registration attempt, its status and history."
        actions={
          canManage ? (
            <RegisterOnBehalfDialog
              trigger={(open) => (
                <Button onClick={open}>
                  <UserPlus className="size-4" /> Register a student
                </Button>
              )}
            />
          ) : undefined
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'all' ? {} : { tab: v }, { replace: true })}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="all">All</TabsTrigger>
          {canApprove && <TabsTrigger value="approvals">Approvals</TabsTrigger>}
          {canApprove && <TabsTrigger value="withdrawals">Withdrawal requests</TabsTrigger>}
        </TabsList>
        <TabsContent value="all">
          <AllRegistrations />
        </TabsContent>
        {canApprove && (
          <TabsContent value="approvals">
            <Approvals />
          </TabsContent>
        )}
        {canApprove && (
          <TabsContent value="withdrawals">
            <WithdrawalRequests />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}

const ACTION_LABEL: Record<string, string> = {
  REQUESTED: 'Requested (awaiting approval)',
  REGISTERED: 'Registered',
  WAITLISTED: 'Joined the waitlist',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PROMOTED: 'Promoted from the waitlist',
  OFFERED: 'Offered a seat',
  OFFER_CLAIMED: 'Claimed the offered seat',
  OFFER_EXPIRED: 'Offer expired',
  OFFER_DECLINED: 'Declined the offer',
  DROPPED: 'Dropped',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
  LEFT_WAITLIST: 'Left the waitlist',
  PROMOTION_SKIPPED: 'Removed from the waitlist (no longer eligible)',
  SECTION_CANCELLED: 'Section cancelled',
  EXPIRED: 'Waitlist expired',
};

export function RegistrationDetailPage() {
  const { registrationId = '' } = useParams();
  const reg = useRegistration(registrationId);
  const canManage = useCan('registration:manage');
  const canApprove = useCan('registration:approve');
  if (reg.isPending) return <LoadingRows rows={5} />;
  if (reg.isError) return <ErrorState error={reg.error} onRetry={() => void reg.refetch()} />;
  const r = reg.data;
  const active = ['PENDING', 'REGISTERED', 'WAITLISTED', 'OFFERED'].includes(r.status);
  return (
    <>
      <PageHeader
        title={`${r.student.name} · ${r.course.code} ${r.section.sectionCode}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {r.session.name} <RegistrationStatusBadge status={r.status} />
            {r.waitlistPosition && <span className="text-xs">Position {r.waitlistPosition}</span>}
          </span>
        }
        actions={
          <>
            {canApprove && r.status === 'PENDING' && (
              <>
                <DecisionDialog
                  registration={r}
                  decision="APPROVE"
                  trigger={(open) => <Button onClick={open}>Approve</Button>}
                />
                <DecisionDialog
                  registration={r}
                  decision="REJECT"
                  trigger={(open) => (
                    <Button variant="outline" onClick={open}>
                      Reject
                    </Button>
                  )}
                />
              </>
            )}
            {canManage && active && (
              <RegistrationActionDialog
                registration={r}
                action="drop"
                trigger={(open) => (
                  <Button variant="outline" onClick={open}>
                    {r.status === 'WAITLISTED'
                      ? 'Remove from waitlist'
                      : r.status === 'PENDING'
                        ? 'Cancel request'
                        : 'Drop'}
                  </Button>
                )}
              />
            )}
            {canManage && r.status === 'REGISTERED' && (
              <RegistrationActionDialog
                registration={r}
                action="withdraw"
                trigger={(open) => (
                  <Button variant="outline" onClick={open}>
                    Withdraw
                  </Button>
                )}
              />
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              columns={1}
              items={[
                {
                  label: 'Student',
                  value: (
                    <Link className="hover:underline" to={`/admin/students/${r.student.id}`}>
                      {r.student.name} ({r.student.studentNumber})
                    </Link>
                  ),
                },
                {
                  label: 'Program',
                  value: `${r.student.program.name} · Year ${r.student.yearOfStudy}`,
                },
                {
                  label: 'Section',
                  value: (
                    <Link className="hover:underline" to={`/admin/sections/${r.section.id}`}>
                      {r.course.code} {r.section.sectionCode} · {r.course.title}
                    </Link>
                  ),
                },
                { label: 'Meets', value: r.section.meetings.map(meetingLabel).join(', ') || '—' },
                { label: 'Instructor', value: r.section.instructor ?? 'TBA' },
                { label: 'Credits', value: r.credits },
                ...(r.overrides.length
                  ? [
                      {
                        label: 'Overrides',
                        value: `${r.overrides.join(', ')}: ${r.overrideReason ?? ''}`,
                      },
                    ]
                  : []),
                ...(r.pendingRequest
                  ? [
                      {
                        label: 'Pending request',
                        value: `Withdrawal: ${r.pendingRequest.reason ?? 'no reason given'}`,
                      },
                    ]
                  : []),
              ]}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-brand" /> History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-l pl-4">
              {r.history.map((h) => (
                <li key={h.id}>
                  <span
                    className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-background bg-brand"
                    aria-hidden
                  />
                  <p className="text-sm font-medium">{ACTION_LABEL[h.action] ?? h.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(h.at)} · {h.actor}
                  </p>
                  {h.reason && <p className="mt-0.5 text-sm">{h.reason}</p>}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
