import { LifeBuoy, Loader2, MessageSquarePlus, Paperclip, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  CASE_PRIORITIES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  type CasePriority,
  type FeedbackCategory,
  type FeedbackStatus,
  type Portal,
  type TicketCategory,
  type TicketStatus,
} from '@ucrams/shared';
import { TextField } from '@/components/forms/form-field';
import { FormDialog } from '@/components/forms/form-dialog';
import type { PickerOption } from '@/components/forms/search-picker';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { DataTable, type Column } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CoursePicker } from '@/features/courses/components/pickers';
import { useListParams } from '@/hooks/use-list-params';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/services/api-error';
import { formatDateTime, formatRelative } from '@/utils/format';
import {
  uploadAttachment,
  useAssignees,
  useCreateTicket,
  useFeedback,
  useFeedbackList,
  useReopenTicket,
  useReplyTicket,
  useRespondFeedback,
  useSubmitFeedback,
  useTicket,
  useTickets,
  useUpdateFeedback,
  useUpdateTicket,
} from '../api/queries';
import {
  FEEDBACK_CATEGORY_LABEL,
  FEEDBACK_STATUS_LABEL,
  PRIORITY_LABEL,
  TICKET_CATEGORY_LABEL,
  TICKET_STATUS_LABEL,
  type Feedback,
  type FileRef,
  type Ticket,
} from '../api/types';
import { AttachmentList, fileSize, PlainText } from '../components/rich-text';

const STATUS_TONE: Record<FeedbackStatus | TicketStatus, StatusTone> = {
  OPEN: 'info',
  UNDER_REVIEW: 'warning',
  IN_PROGRESS: 'warning',
  WAITING_ON_USER: 'danger',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};
const PRIORITY_TONE: Record<CasePriority, StatusTone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
};
const options = <K extends string>(keys: readonly K[], labels: Record<K, string>) =>
  keys.map((k) => ({ value: k, label: labels[k] }));

function ChoiceField<K extends string>({
  id,
  label,
  value,
  onChange,
  choices,
  className,
}: {
  id: string;
  label: string;
  value: K;
  onChange: (v: K) => void;
  choices: Array<{ value: K; label: string }>;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label id={`${id}-label`}>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as K)}>
        <SelectTrigger aria-labelledby={`${id}-label`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AttachmentPicker({
  files,
  onChange,
}: {
  files: FileRef[];
  onChange: (files: FileRef[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="ticket-attachment">Attachments (optional)</Label>
      <input
        id="ticket-attachment"
        type="file"
        accept=".pdf,.docx,image/png,image/jpeg,image/webp"
        disabled={uploading || files.length >= 5}
        className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setUploading(true);
          try {
            const fileId = await uploadAttachment('TICKET', file);
            onChange([
              ...files,
              { fileId, name: file.name, mimeType: file.type, sizeBytes: file.size },
            ]);
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setUploading(false);
          }
        }}
      />
      {uploading && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Uploading…
        </p>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f) => (
            <li
              key={f.fileId}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
            >
              <Paperclip className="size-3.5" />
              <span className="max-w-40 truncate">{f.name}</span>
              <span className="text-muted-foreground">{fileSize(f.sizeBytes)}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(files.filter((x) => x.fileId !== f.fileId))}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ----- feedback (FR-COMM-012) -------------------------------------------------------------

function FeedbackDialog({ portal }: { portal: Portal }) {
  const submit = useSubmitFeedback();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>('COURSE');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [course, setCourse] = useState<PickerOption | null>(null);
  const [priority, setPriority] = useState<CasePriority>('MEDIUM');
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        onClick={() => {
          setCategory('COURSE');
          setSubject('');
          setDescription('');
          setCourse(null);
          setPriority('MEDIUM');
          setAnonymous(false);
          setError(null);
          setOpen(true);
        }}
      >
        <MessageSquarePlus className="size-4" /> Give feedback
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Give feedback"
        description="Administrators for the department concerned review it and may respond."
        submitLabel="Submit"
        submitting={submit.isPending}
        error={error}
        wide
        onSubmit={() => {
          if (subject.trim().length < 3) return setError('Add a subject (at least 3 characters).');
          if (description.trim().length < 10)
            return setError('Describe it in at least 10 characters.');
          setError(null);
          submit.mutate(
            {
              category,
              subject: subject.trim(),
              description: description.trim(),
              courseId: course?.value ?? null,
              priority,
              anonymous,
            },
            {
              onSuccess: (f) => {
                toast.success('Feedback submitted');
                setOpen(false);
                navigate(`/${portal}/feedback/${f.id}`);
              },
              onError: (e) => setError(errorMessage(e)),
            },
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <ChoiceField
            id="feedback-category"
            label="Category"
            value={category}
            onChange={setCategory}
            choices={options(FEEDBACK_CATEGORIES, FEEDBACK_CATEGORY_LABEL)}
          />
          <ChoiceField
            id="feedback-priority"
            label="Priority"
            value={priority}
            onChange={setPriority}
            choices={options(CASE_PRIORITIES, PRIORITY_LABEL)}
          />
        </div>
        <TextField
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="feedback-description">Details</Label>
          <Textarea
            id="feedback-description"
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Related course (optional)</Label>
          <CoursePicker label="Related course" value={course} onChange={setCourse} clearable />
        </div>
        <div className="flex items-start gap-2">
          <Switch id="feedback-anonymous" checked={anonymous} onCheckedChange={setAnonymous} />
          <Label htmlFor="feedback-anonymous" className="leading-snug font-normal">
            Submit anonymously — department administrators will not see your name.
          </Label>
        </div>
      </FormDialog>
    </>
  );
}

const feedbackColumns = (portal: Portal, manage: boolean): Column<Feedback>[] => [
  {
    key: 'subject',
    header: 'Subject',
    cell: (f) => (
      <Link to={`/${portal}/feedback/${f.id}`} className="font-medium hover:underline">
        {f.subject}
      </Link>
    ),
  },
  {
    key: 'category',
    header: 'Category',
    cell: (f) => FEEDBACK_CATEGORY_LABEL[f.category],
    hideOnMobile: true,
  },
  ...(manage
    ? [
        {
          key: 'from',
          header: 'From',
          cell: (f: Feedback) => f.submittedBy?.name ?? <span className="italic">Anonymous</span>,
          hideOnMobile: true,
        },
        {
          key: 'priority',
          header: 'Priority',
          cell: (f: Feedback) => (
            <StatusBadge tone={PRIORITY_TONE[f.priority]}>{PRIORITY_LABEL[f.priority]}</StatusBadge>
          ),
          hideOnMobile: true,
        },
      ]
    : []),
  {
    key: 'status',
    header: 'Status',
    cell: (f) => (
      <StatusBadge tone={STATUS_TONE[f.status]}>{FEEDBACK_STATUS_LABEL[f.status]}</StatusBadge>
    ),
  },
  {
    key: 'updated',
    header: 'Updated',
    cell: (f) => formatRelative(f.updatedAt),
    hideOnMobile: true,
  },
];

export function MyFeedbackPage({ portal }: { portal: Portal }) {
  const { page, filters, update } = useListParams(['status'] as const);
  const list = useFeedbackList('mine', { page, status: filters.status });
  return (
    <>
      <PageHeader
        title="Feedback"
        description="Suggestions and concerns about courses, teaching, facilities and services."
        actions={<FeedbackDialog portal={portal} />}
      />
      <ListToolbar>
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          allLabel="All statuses"
          options={options(FEEDBACK_STATUSES, FEEDBACK_STATUS_LABEL)}
        />
      </ListToolbar>
      <DataTable
        caption="Your feedback"
        columns={feedbackColumns(portal, false)}
        rows={list.data?.data}
        rowKey={(f) => f.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle="No feedback yet"
        emptyDescription="Use “Give feedback” to tell the university what works and what doesn’t."
        meta={list.data?.meta && 'total' in list.data.meta ? list.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
      />
    </>
  );
}

export function FeedbackQueuePage() {
  const { page, filters, update } = useListParams(['status', 'category', 'mine'] as const);
  const list = useFeedbackList('manage', {
    page,
    status: filters.status,
    category: filters.category,
    assignedToMe: filters.mine === '1',
  });
  return (
    <>
      <PageHeader title="Feedback" description="Feedback submitted within your scope." />
      <ListToolbar>
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          allLabel="All statuses"
          options={options(FEEDBACK_STATUSES, FEEDBACK_STATUS_LABEL)}
        />
        <FilterSelect
          label="Category"
          value={filters.category}
          onChange={(v) => update({ category: v })}
          allLabel="All categories"
          options={options(FEEDBACK_CATEGORIES, FEEDBACK_CATEGORY_LABEL)}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={filters.mine === '1'}
            onCheckedChange={(v) => update({ mine: v ? '1' : null })}
          />
          Assigned to me
        </label>
      </ListToolbar>
      <DataTable
        caption="Feedback queue"
        columns={feedbackColumns('admin', true)}
        rows={list.data?.data}
        rowKey={(f) => f.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle="No feedback"
        meta={list.data?.meta && 'total' in list.data.meta ? list.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
      />
    </>
  );
}

function FeedbackManagePanel({ f }: { f: Feedback }) {
  const update = useUpdateFeedback(f.id);
  const assignees = useAssignees('feedback', f.department?.id ?? null, true);
  const [status, setStatus] = useState<FeedbackStatus>(f.status);
  const [priority, setPriority] = useState<CasePriority>(f.priority);
  const [assignee, setAssignee] = useState(f.assignee?.id ?? 'none');
  const [note, setNote] = useState(f.resolutionNote ?? '');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Triage</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ChoiceField
          id="fb-status"
          label="Status"
          value={status}
          onChange={setStatus}
          choices={options(FEEDBACK_STATUSES, FEEDBACK_STATUS_LABEL)}
        />
        <ChoiceField
          id="fb-priority"
          label="Priority"
          value={priority}
          onChange={setPriority}
          choices={options(CASE_PRIORITIES, PRIORITY_LABEL)}
        />
        <ChoiceField
          id="fb-assignee"
          label="Assignee"
          value={assignee}
          onChange={setAssignee}
          choices={[
            { value: 'none', label: 'Unassigned' },
            ...(assignees.data ?? []).map((a) => ({ value: a.userId, label: a.name })),
          ]}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="fb-note">Resolution note</Label>
          <Textarea id="fb-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              {
                status,
                priority,
                assigneeId: assignee === 'none' ? null : assignee,
                resolutionNote: note.trim() || null,
              },
              {
                onSuccess: () => toast.success('Feedback updated'),
                onError: (e) => toast.error(errorMessage(e)),
              },
            )
          }
        >
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

export function FeedbackDetailPage({ portal }: { portal: Portal }) {
  const { feedbackId = '' } = useParams();
  const feedback = useFeedback(feedbackId);
  const respond = useRespondFeedback(feedbackId);
  const [body, setBody] = useState('');
  if (feedback.isPending) return <LoadingRows rows={5} />;
  if (feedback.isError)
    return <ErrorState error={feedback.error} onRetry={() => void feedback.refetch()} />;
  const f = feedback.data;
  return (
    <>
      <PageHeader
        title={f.subject}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={STATUS_TONE[f.status]}>
              {FEEDBACK_STATUS_LABEL[f.status]}
            </StatusBadge>
            <span>
              {FEEDBACK_CATEGORY_LABEL[f.category]} · {f.submittedBy?.name ?? 'Anonymous'} ·{' '}
              {formatDateTime(f.createdAt)}
              {f.course && ` · ${f.course.code}`}
              {f.department && ` · ${f.department.name}`}
            </span>
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link to={`/${portal}/feedback`}>All feedback</Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent>
              <PlainText text={f.description} />
            </CardContent>
          </Card>
          {f.resolutionNote && (
            <Card className="border-success/40 bg-success/5">
              <CardHeader>
                <CardTitle className="text-base">Resolution</CardTitle>
              </CardHeader>
              <CardContent>
                <PlainText text={f.resolutionNote} />
              </CardContent>
            </Card>
          )}
          <section aria-labelledby="fb-responses">
            <h2 id="fb-responses" className="mb-2 font-semibold">
              Responses
            </h2>
            {f.responses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No responses yet.</p>
            ) : (
              <ol className="space-y-3">
                {f.responses.map((r) => (
                  <li
                    key={r.id}
                    className={cn('rounded-lg border p-3', !r.fromSubmitter && 'bg-muted/50')}
                  >
                    <p className="mb-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{r.author}</span> ·{' '}
                      {formatRelative(r.createdAt)}
                    </p>
                    <PlainText text={r.body} />
                  </li>
                ))}
              </ol>
            )}
          </section>
          {f.status !== 'CLOSED' && (
            <form
              className="grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!body.trim()) return;
                respond.mutate(body.trim(), {
                  onSuccess: () => setBody(''),
                  onError: (err) => toast.error(errorMessage(err)),
                });
              }}
            >
              <Label htmlFor="fb-reply">
                {f.canManage && !f.mine ? 'Respond to the submitter' : 'Add a follow-up'}
              </Label>
              <Textarea
                id="fb-reply"
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={5000}
              />
              <div>
                <Button type="submit" disabled={!body.trim() || respond.isPending}>
                  Send
                </Button>
              </div>
            </form>
          )}
        </div>
        <div className="space-y-4">
          {f.canManage && <FeedbackManagePanel key={f.updatedAt} f={f} />}
          <Card>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Priority:</span>{' '}
                {PRIORITY_LABEL[f.priority]}
              </p>
              <p>
                <span className="text-muted-foreground">Assignee:</span>{' '}
                {f.assignee?.name ?? 'Unassigned'}
              </p>
              {f.resolvedAt && (
                <p>
                  <span className="text-muted-foreground">Resolved:</span>{' '}
                  {formatDateTime(f.resolvedAt)}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

// ----- support tickets (FR-COMM-013/014) ----------------------------------------------------

function NewTicketDialog({ portal }: { portal: Portal }) {
  const create = useCreateTicket();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<TicketCategory>('REGISTRATION');
  const [priority, setPriority] = useState<CasePriority>('MEDIUM');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<FileRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        onClick={() => {
          setCategory('REGISTRATION');
          setPriority('MEDIUM');
          setSubject('');
          setDescription('');
          setFiles([]);
          setError(null);
          setOpen(true);
        }}
      >
        <LifeBuoy className="size-4" /> New ticket
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="New support ticket"
        description="Tell us what went wrong. You’ll be notified when staff reply."
        submitLabel="Submit ticket"
        submitting={create.isPending}
        error={error}
        wide
        onSubmit={() => {
          if (subject.trim().length < 3) return setError('Add a subject (at least 3 characters).');
          if (description.trim().length < 10)
            return setError('Describe the problem in at least 10 characters.');
          setError(null);
          create.mutate(
            {
              category,
              priority,
              subject: subject.trim(),
              description: description.trim(),
              fileIds: files.map((f) => f.fileId),
            },
            {
              onSuccess: (t) => {
                toast.success(`Ticket ${t.ticketNumber} created`);
                setOpen(false);
                navigate(`/${portal}/support/${t.id}`);
              },
              onError: (e) => setError(errorMessage(e)),
            },
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <ChoiceField
            id="ticket-category"
            label="Category"
            value={category}
            onChange={setCategory}
            choices={options(TICKET_CATEGORIES, TICKET_CATEGORY_LABEL)}
          />
          <ChoiceField
            id="ticket-priority"
            label="Priority"
            value={priority}
            onChange={setPriority}
            choices={options(CASE_PRIORITIES, PRIORITY_LABEL)}
          />
        </div>
        <TextField
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="ticket-description">Description</Label>
          <Textarea
            id="ticket-description"
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
          />
        </div>
        <AttachmentPicker files={files} onChange={setFiles} />
      </FormDialog>
    </>
  );
}

const ticketColumns = (base: string, manage: boolean): Column<Ticket>[] => [
  {
    key: 'number',
    header: 'Ticket',
    cell: (t) => (
      <Link to={`${base}/${t.id}`} className="font-mono text-xs font-medium hover:underline">
        {t.ticketNumber}
      </Link>
    ),
  },
  {
    key: 'subject',
    header: 'Subject',
    cell: (t) => (
      <Link to={`${base}/${t.id}`} className="font-medium hover:underline">
        {t.subject}
      </Link>
    ),
  },
  ...(manage
    ? [
        { key: 'owner', header: 'From', cell: (t: Ticket) => t.owner.name, hideOnMobile: true },
        {
          key: 'priority',
          header: 'Priority',
          cell: (t: Ticket) => (
            <StatusBadge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</StatusBadge>
          ),
          hideOnMobile: true,
        },
        {
          key: 'assignee',
          header: 'Assignee',
          cell: (t: Ticket) => t.assignee?.name ?? '—',
          hideOnMobile: true,
        },
      ]
    : [
        {
          key: 'category',
          header: 'Category',
          cell: (t: Ticket) => TICKET_CATEGORY_LABEL[t.category],
          hideOnMobile: true,
        },
      ]),
  {
    key: 'status',
    header: 'Status',
    cell: (t) => (
      <StatusBadge tone={STATUS_TONE[t.status]}>
        {manage && t.status === 'WAITING_ON_USER'
          ? 'Waiting on requester'
          : TICKET_STATUS_LABEL[t.status]}
      </StatusBadge>
    ),
  },
  {
    key: 'activity',
    header: 'Last activity',
    cell: (t) => formatRelative(t.lastActivityAt),
    hideOnMobile: true,
  },
];

export function MyTicketsPage({ portal }: { portal: Portal }) {
  const { page, filters, update } = useListParams(['status'] as const);
  const list = useTickets('mine', { page, status: filters.status });
  return (
    <>
      <PageHeader
        title="Support"
        description="Tickets you have opened with university support."
        actions={<NewTicketDialog portal={portal} />}
      />
      <ListToolbar>
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          allLabel="All tickets"
          options={[
            { value: 'ACTIVE', label: 'Active' },
            ...options(TICKET_STATUSES, TICKET_STATUS_LABEL),
          ]}
        />
      </ListToolbar>
      <DataTable
        caption="Your support tickets"
        columns={ticketColumns(`/${portal}/support`, false)}
        rows={list.data?.data}
        rowKey={(t) => t.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle="No tickets"
        emptyDescription="Open a ticket when something needs fixing — we’ll keep you posted."
        meta={list.data?.meta && 'total' in list.data.meta ? list.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
      />
    </>
  );
}

export function TicketQueuePage() {
  const { page, q, filters, update } = useListParams(['status', 'category', 'mine'] as const);
  const status = filters.status || 'ACTIVE';
  const list = useTickets('manage', {
    page,
    q,
    status: status === 'ALL' ? undefined : status,
    category: filters.category,
    assignedToMe: filters.mine === '1',
  });
  return (
    <>
      <PageHeader title="Support tickets" description="Tickets from people within your scope." />
      <ListToolbar>
        <SearchInput
          value={q}
          onChange={(v) => update({ q: v })}
          placeholder="Ticket number or subject"
          label="Search tickets"
        />
        <FilterSelect
          label="Status"
          value={status === 'ACTIVE' ? '' : status}
          onChange={(v) => update({ status: v || null })}
          allLabel="Active"
          options={[
            { value: 'ALL', label: 'All tickets' },
            ...options(TICKET_STATUSES, TICKET_STATUS_LABEL),
          ]}
        />
        <FilterSelect
          label="Category"
          value={filters.category}
          onChange={(v) => update({ category: v })}
          allLabel="All categories"
          options={options(TICKET_CATEGORIES, TICKET_CATEGORY_LABEL)}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={filters.mine === '1'}
            onCheckedChange={(v) => update({ mine: v ? '1' : null })}
          />
          Assigned to me
        </label>
      </ListToolbar>
      <DataTable
        caption="Support queue"
        columns={ticketColumns('/admin/tickets', true)}
        rows={list.data?.data}
        rowKey={(t) => t.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle="No tickets"
        meta={list.data?.meta && 'total' in list.data.meta ? list.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
      />
    </>
  );
}

function TicketManagePanel({ t }: { t: Ticket }) {
  const update = useUpdateTicket(t.id);
  const assignees = useAssignees('tickets', t.department?.id ?? null, true);
  const [status, setStatus] = useState<TicketStatus>(t.status);
  const [priority, setPriority] = useState<CasePriority>(t.priority);
  const [assignee, setAssignee] = useState(t.assignee?.id ?? 'none');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Manage</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ChoiceField
          id="t-status"
          label="Status"
          value={status}
          onChange={setStatus}
          choices={options(TICKET_STATUSES, {
            ...TICKET_STATUS_LABEL,
            WAITING_ON_USER: 'Waiting on requester',
          })}
        />
        <ChoiceField
          id="t-priority"
          label="Priority"
          value={priority}
          onChange={setPriority}
          choices={options(CASE_PRIORITIES, PRIORITY_LABEL)}
        />
        <ChoiceField
          id="t-assignee"
          label="Assignee"
          value={assignee}
          onChange={setAssignee}
          choices={[
            { value: 'none', label: 'Unassigned' },
            ...(assignees.data ?? []).map((a) => ({ value: a.userId, label: a.name })),
          ]}
        />
        <Button
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              { status, priority, assigneeId: assignee === 'none' ? null : assignee },
              {
                onSuccess: () => toast.success('Ticket updated'),
                onError: (e) => toast.error(errorMessage(e)),
              },
            )
          }
        >
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

const EVENT_TEXT: Record<
  string,
  (e: { fromValue: string | null; toValue: string | null }) => string
> = {
  CREATED: () => 'opened the ticket',
  STATUS_CHANGED: (e) =>
    `changed the status to ${TICKET_STATUS_LABEL[e.toValue as TicketStatus]?.toLowerCase() ?? e.toValue}`,
  ASSIGNED: (e) => (e.toValue ? `assigned it to ${e.toValue}` : 'unassigned it'),
  PRIORITY_CHANGED: (e) =>
    `set the priority to ${PRIORITY_LABEL[e.toValue as CasePriority]?.toLowerCase() ?? e.toValue}`,
  REOPENED: () => 'reopened the ticket',
};

export function TicketDetailPage({ portal }: { portal: Portal }) {
  const { ticketId = '' } = useParams();
  const ticket = useTicket(ticketId);
  const reply = useReplyTicket(ticketId);
  const reopen = useReopenTicket(ticketId);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [nextStatus, setNextStatus] = useState<TicketStatus | 'keep'>('keep');
  const [files, setFiles] = useState<FileRef[]>([]);
  if (ticket.isPending) return <LoadingRows rows={5} />;
  if (ticket.isError)
    return <ErrorState error={ticket.error} onRetry={() => void ticket.refetch()} />;
  const t = ticket.data;
  const staff = t.canManage;
  const base = portal === 'admin' ? '/admin/tickets' : `/${portal}/support`;
  const link = (fileId: string) => `/tickets/${t.id}/attachments/${fileId}`;
  const timeline = [
    ...t.responses.map((r) => ({ kind: 'response' as const, at: r.createdAt, r })),
    ...t.events.map((e) => ({ kind: 'event' as const, at: e.createdAt, e })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <>
      <PageHeader
        title={t.subject}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{t.ticketNumber}</span>
            <StatusBadge tone={STATUS_TONE[t.status]}>
              {staff && t.status === 'WAITING_ON_USER'
                ? 'Waiting on requester'
                : TICKET_STATUS_LABEL[t.status]}
            </StatusBadge>
            <span>
              {TICKET_CATEGORY_LABEL[t.category]} · {staff ? `${t.owner.name} · ` : ''}opened{' '}
              {formatDateTime(t.createdAt)}
            </span>
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={base}>All tickets</Link>
            </Button>
            {t.canReopen && (
              <Button
                variant="outline"
                disabled={reopen.isPending}
                onClick={() =>
                  reopen.mutate(undefined, {
                    onSuccess: () => toast.success('Ticket reopened'),
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
              >
                <RotateCcw className="size-4" /> Reopen
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardContent>
              <PlainText text={t.description} />
              <AttachmentList files={t.attachments} linkFor={link} />
            </CardContent>
          </Card>
          <section aria-labelledby="ticket-activity">
            <h2 id="ticket-activity" className="mb-2 font-semibold">
              Activity
            </h2>
            <ol className="space-y-3">
              {timeline.map((item) =>
                item.kind === 'event' ? (
                  <li key={item.e.id} className="px-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{item.e.actor}</span>{' '}
                    {(EVENT_TEXT[item.e.type] ?? (() => item.e.type))(item.e)} ·{' '}
                    {formatRelative(item.at)}
                  </li>
                ) : (
                  <li
                    key={item.r.id}
                    className={cn(
                      'rounded-lg border p-3',
                      item.r.internal && 'border-warning/50 bg-warning/10',
                      !item.r.fromOwner && !item.r.internal && 'bg-muted/50',
                    )}
                  >
                    <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{item.r.author}</span>
                      {formatRelative(item.r.createdAt)}
                      {item.r.internal && <StatusBadge tone="warning">Internal note</StatusBadge>}
                    </p>
                    <PlainText text={item.r.body} />
                    <AttachmentList files={item.r.attachments} linkFor={link} />
                  </li>
                ),
              )}
            </ol>
          </section>
          {t.canReply ? (
            <form
              className="grid gap-3 rounded-lg border p-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!body.trim()) return;
                reply.mutate(
                  {
                    body: body.trim(),
                    internal: staff && internal,
                    ...(staff && nextStatus !== 'keep' ? { status: nextStatus } : {}),
                    fileIds: files.map((f) => f.fileId),
                  },
                  {
                    onSuccess: () => {
                      setBody('');
                      setFiles([]);
                      setInternal(false);
                      setNextStatus('keep');
                      toast.success('Reply sent');
                    },
                    onError: (err) => toast.error(errorMessage(err)),
                  },
                );
              }}
            >
              <Label htmlFor="ticket-reply">Reply</Label>
              <Textarea
                id="ticket-reply"
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={5000}
              />
              <AttachmentPicker files={files} onChange={setFiles} />
              {staff && (
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={internal} onCheckedChange={(v) => setInternal(!!v)} />
                    Internal note (hidden from the requester)
                  </label>
                  <ChoiceField
                    id="reply-status"
                    label="Then set status"
                    value={nextStatus}
                    onChange={setNextStatus}
                    className="w-56"
                    choices={[
                      { value: 'keep', label: 'Keep current status' },
                      ...options(TICKET_STATUSES, {
                        ...TICKET_STATUS_LABEL,
                        WAITING_ON_USER: 'Waiting on requester',
                      }),
                    ]}
                  />
                </div>
              )}
              <div>
                <Button type="submit" disabled={!body.trim() || reply.isPending}>
                  {internal ? 'Add note' : 'Send reply'}
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t.status === 'RESOLVED'
                ? t.canReopen
                  ? `This ticket is resolved. Reopen it until ${formatDateTime(t.reopenUntil!)} if the problem continues.`
                  : 'This ticket is resolved.'
                : 'This ticket is closed. Open a new ticket if you need more help.'}
            </p>
          )}
        </div>
        <div className="space-y-4">
          {staff && <TicketManagePanel key={`${t.status}-${t.priority}-${t.assignee?.id}`} t={t} />}
          <Card>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">Priority:</span>{' '}
                {PRIORITY_LABEL[t.priority]}
              </p>
              <p>
                <span className="text-muted-foreground">Assigned to:</span>{' '}
                {t.assignee?.name ?? 'Not yet assigned'}
              </p>
              {t.department && (
                <p>
                  <span className="text-muted-foreground">Department:</span> {t.department.name}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
