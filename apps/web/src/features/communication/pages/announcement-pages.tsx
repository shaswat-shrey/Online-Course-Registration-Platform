import { CalendarClock, Check, Megaphone, Pencil, Pin, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  AUDIENCE_TYPES,
  GLOBAL_AUDIENCES,
  type AudienceRole,
  type AudienceType,
  type Portal,
} from '@ucrams/shared';
import { TextField } from '@/components/forms/form-field';
import { FormDialog } from '@/components/forms/form-dialog';
import { SearchPicker, type PickerOption } from '@/components/forms/search-picker';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/services/api-error';
import { apiGet, apiGetPage } from '@/services/http';
import { useCan } from '@/store/auth-store';
import { formatDateTime, formatRelative } from '@/utils/format';
import {
  useAnnouncementFeed,
  useCreateAnnouncement,
  useManagedAnnouncements,
  useMarkAnnouncementRead,
  useUpdateAnnouncement,
} from '../api/queries';
import type { Announcement } from '../api/types';
import { useDeleteAnnouncement } from '@/features/teaching/api/teaching-queries';
import { PlainText } from '../components/rich-text';

const PRIORITY_TONE = { NORMAL: 'neutral', IMPORTANT: 'warning', URGENT: 'danger' } as const;

function AnnouncementCard({
  a,
  highlighted,
  onRead,
  manage,
}: {
  a: Announcement;
  highlighted?: boolean;
  onRead?: () => void;
  manage?: boolean;
}) {
  const remove = useDeleteAnnouncement();
  return (
    <article
      id={`announcement-${a.id}`}
      className={cn(
        'rounded-lg border p-4',
        onRead && !a.read && 'border-brand/40 bg-brand/5',
        highlighted && 'ring-2 ring-brand',
      )}
    >
      <header className="mb-1 flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 font-medium">
          {onRead && !a.read && (
            <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />
          )}
          {a.pinned && <Pin className="size-4 shrink-0 text-brand" aria-label="Pinned" />}
          <span className="break-words">{a.title}</span>
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          {a.priority !== 'NORMAL' && (
            <StatusBadge tone={PRIORITY_TONE[a.priority]}>
              {a.priority === 'URGENT' ? 'Urgent' : 'Important'}
            </StatusBadge>
          )}
          {a.scheduled && (
            <StatusBadge tone="info">
              <CalendarClock className="size-3" aria-hidden /> Scheduled
            </StatusBadge>
          )}
          {a.expired && <StatusBadge tone="neutral">Expired</StatusBadge>}
          {manage && a.canManage && (
            <>
              <EditAnnouncementDialog a={a} />
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="icon" aria-label={`Delete “${a.title}”`}>
                    <Trash2 className="size-4" />
                  </Button>
                }
                title="Delete this announcement?"
                description="It disappears for everyone. Notifications already sent remain in their history."
                confirmLabel="Delete"
                destructive
                onConfirm={() =>
                  remove.mutate(a.id, {
                    onSuccess: () => toast.success('Announcement deleted'),
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
              />
            </>
          )}
        </div>
      </header>
      <p className="mb-2 text-xs text-muted-foreground">
        {a.author} ·{' '}
        {a.scheduled ? `publishes ${formatDateTime(a.publishedAt)}` : formatRelative(a.publishedAt)}
        {' · '}
        {a.audiences.map((x) => x.label).join(', ')}
        {a.expiresAt && ` · until ${formatDateTime(a.expiresAt)}`}
        {manage && a.readCount !== null && ` · read by ${a.readCount}`}
      </p>
      <PlainText text={a.body} />
      {onRead && !a.read && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRead}>
          <Check className="size-4" /> Mark as read
        </Button>
      )}
    </article>
  );
}

/** Announcements that reach the signed-in user, with read tracking (FR-COMM-008/009). */
export function AnnouncementFeed() {
  const feed = useAnnouncementFeed();
  const markRead = useMarkAnnouncementRead();
  const [params] = useSearchParams();
  const focus = params.get('a');
  const { mutate: read } = markRead;
  useEffect(() => {
    if (!focus || !feed.data) return;
    document.getElementById(`announcement-${focus}`)?.scrollIntoView({ block: 'center' });
    if (feed.data.items.some((a) => a.id === focus && !a.read)) read(focus);
  }, [focus, feed.data, read]);
  if (feed.isPending) return <LoadingRows rows={3} />;
  if (feed.isError) return <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />;
  if (!feed.data.items.length)
    return (
      <EmptyState title="No announcements" description="Announcements for you will appear here." />
    );
  return (
    <div className="space-y-3">
      {feed.data.unread > 0 && (
        <p className="text-sm text-muted-foreground">{feed.data.unread} unread</p>
      )}
      <ul className="space-y-3">
        {feed.data.items.map((a) => (
          <li key={a.id}>
            <AnnouncementCard a={a} highlighted={a.id === focus} onRead={() => read(a.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnnouncementsPage() {
  return (
    <>
      <PageHeader
        title="Announcements"
        description="From your instructors, department and the university."
      />
      <AnnouncementFeed />
    </>
  );
}

// ----- administration -------------------------------------------------------------------

const AUDIENCE_LABEL: Record<AudienceType, string> = {
  ALL_USERS: 'Everyone',
  ALL_STUDENTS: 'All students',
  ALL_FACULTY: 'All faculty',
  ALL_ADMINS: 'All administrators',
  USER: 'A person',
  SCHOOL: 'Faculty / school',
  DEPARTMENT: 'Department',
  PROGRAM: 'Programme',
  SPECIALIZATION: 'Specialization',
  COURSE: 'Course',
  SECTION: 'Section',
  YEAR_OF_STUDY: 'Year of study',
};
const ROLE_FILTERED: AudienceType[] = ['SCHOOL', 'DEPARTMENT', 'COURSE', 'SECTION'];

interface AudienceDraft {
  key: number;
  type: AudienceType;
  target: PickerOption | null;
  year: number;
  roleFilter: AudienceRole;
}

const searchers: Partial<Record<AudienceType, (q: string) => Promise<PickerOption[]>>> = {
  SCHOOL: async (q) =>
    (
      await apiGetPage<{ id: string; code: string; name: string }>('/schools', {
        params: { q: q || undefined, limit: 20 },
      })
    ).data.map((s) => ({ value: s.id, label: s.name, description: s.code })),
  DEPARTMENT: async (q) =>
    (
      await apiGetPage<{ id: string; code: string; name: string }>('/departments', {
        params: { q: q || undefined, limit: 20 },
      })
    ).data.map((d) => ({ value: d.id, label: d.name, description: d.code })),
  PROGRAM: async (q) =>
    (
      await apiGetPage<{ id: string; code: string; name: string }>('/programs', {
        params: { q: q || undefined, limit: 20 },
      })
    ).data.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })),
  COURSE: async (q) =>
    (
      await apiGetPage<{ id: string; code: string; title: string }>('/courses', {
        params: { q: q || undefined, limit: 20, status: 'ACTIVE' },
      })
    ).data.map((c) => ({ value: c.id, label: `${c.code} · ${c.title}` })),
  SECTION: async (q) =>
    (
      await apiGetPage<{
        id: string;
        sectionCode: string;
        course: { code: string; title: string };
        session: { name: string };
      }>('/course-sections', { params: { q: q || undefined, limit: 20 } })
    ).data.map((s) => ({
      value: s.id,
      label: `${s.course.code} ${s.sectionCode}`,
      description: `${s.course.title} · ${s.session.name}`,
    })),
  USER: async (q) =>
    (
      await apiGet<Array<{ userId: string; name: string; email: string }>>(
        '/conversations/contacts',
        { params: { q } },
      )
    ).map((u) => ({ value: u.userId, label: u.name, description: u.email })),
  YEAR_OF_STUDY: async (q) =>
    (
      await apiGetPage<{ id: string; code: string; name: string }>('/departments', {
        params: { q: q || undefined, limit: 20 },
      })
    ).data.map((d) => ({ value: d.id, label: d.name, description: d.code })),
};

function SpecializationPicker({
  value,
  onChange,
}: {
  value: PickerOption | null;
  onChange: (o: PickerOption | null) => void;
}) {
  const [program, setProgram] = useState<PickerOption | null>(null);
  const [options, setOptions] = useState<PickerOption[]>([]);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <SearchPicker
        label="Programme"
        value={program}
        queryKey={['audience', 'PROGRAM']}
        search={searchers.PROGRAM!}
        onChange={async (p) => {
          setProgram(p);
          onChange(null);
          setOptions(
            p
              ? (
                  await apiGet<Array<{ id: string; name: string }>>(
                    `/programs/${p.value}/specializations`,
                  )
                ).map((s) => ({ value: s.id, label: s.name }))
              : [],
          );
        }}
      />
      <Select
        value={value?.value ?? ''}
        onValueChange={(v) => onChange(options.find((o) => o.value === v) ?? null)}
        disabled={!options.length}
      >
        <SelectTrigger aria-label="Specialization">
          <SelectValue
            placeholder={program ? 'Choose a specialization' : 'Choose a programme first'}
          />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function AudienceRow({
  draft,
  types,
  onChange,
  onRemove,
}: {
  draft: AudienceDraft;
  types: AudienceType[];
  onChange: (d: AudienceDraft) => void;
  onRemove?: () => void;
}) {
  const needsTarget = !draft.type.startsWith('ALL_');
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={draft.type}
          onValueChange={(v) => onChange({ ...draft, type: v as AudienceType, target: null })}
        >
          <SelectTrigger aria-label="Audience type" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {AUDIENCE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {ROLE_FILTERED.includes(draft.type) && (
          <Select
            value={draft.roleFilter}
            onValueChange={(v) => onChange({ ...draft, roleFilter: v as AudienceRole })}
          >
            <SelectTrigger aria-label="Who in this audience" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ANY">Students and faculty</SelectItem>
              <SelectItem value="STUDENT">Students only</SelectItem>
              <SelectItem value="FACULTY">Faculty only</SelectItem>
            </SelectContent>
          </Select>
        )}
        {draft.type === 'YEAR_OF_STUDY' && (
          <Input
            type="number"
            min={1}
            max={10}
            value={draft.year}
            aria-label="Year of study"
            className="w-24"
            onChange={(e) => onChange({ ...draft, year: Number(e.target.value) || 1 })}
          />
        )}
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto"
            aria-label="Remove audience"
            onClick={onRemove}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      {needsTarget &&
        (draft.type === 'SPECIALIZATION' ? (
          <SpecializationPicker
            value={draft.target}
            onChange={(t) => onChange({ ...draft, target: t })}
          />
        ) : (
          <SearchPicker
            key={draft.type}
            label={
              draft.type === 'YEAR_OF_STUDY'
                ? 'Department (optional)'
                : `Choose ${AUDIENCE_LABEL[draft.type].toLowerCase()}`
            }
            value={draft.target}
            clearable={draft.type === 'YEAR_OF_STUDY'}
            queryKey={['audience', draft.type]}
            search={searchers[draft.type]!}
            onChange={(t) => onChange({ ...draft, target: t })}
          />
        ))}
    </div>
  );
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

let draftKey = 0;
const newDraft = (type: AudienceType): AudienceDraft => ({
  key: ++draftKey,
  type,
  target: null,
  year: 1,
  roleFilter: 'ANY',
});

/** Compose an announcement for any audience the user may target (FR-COMM-008/010/011). */
function ComposeAnnouncementDialog() {
  const global = useCan('announcement:publish_global');
  const types = AUDIENCE_TYPES.filter((t) => global || !GLOBAL_AUDIENCES.includes(t));
  const create = useCreateAnnouncement();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<'NORMAL' | 'IMPORTANT' | 'URGENT'>('NORMAL');
  const [pinned, setPinned] = useState(false);
  const [publishAt, setPublishAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [audiences, setAudiences] = useState<AudienceDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        onClick={() => {
          setTitle('');
          setBody('');
          setPriority('NORMAL');
          setPinned(false);
          setPublishAt('');
          setExpiresAt('');
          setAudiences([newDraft(global ? 'ALL_STUDENTS' : 'DEPARTMENT')]);
          setError(null);
          setOpen(true);
        }}
      >
        <Megaphone className="size-4" /> New announcement
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="New announcement"
        description="Everyone in the chosen audiences sees it in their feed and is notified when it publishes."
        submitLabel={publishAt ? 'Schedule' : 'Publish'}
        submitting={create.isPending}
        error={error}
        wide
        onSubmit={() => {
          if (title.trim().length < 3)
            return setError('Give the announcement a title (at least 3 characters).');
          if (!body.trim()) return setError('Write a message.');
          const missing = audiences.find(
            (a) => !a.type.startsWith('ALL_') && a.type !== 'YEAR_OF_STUDY' && !a.target,
          );
          if (!audiences.length || missing) return setError('Complete every audience row.');
          setError(null);
          create.mutate(
            {
              title: title.trim(),
              body: body.trim(),
              priority,
              pinned,
              publishAt: fromLocalInput(publishAt),
              expiresAt: fromLocalInput(expiresAt),
              audiences: audiences.map((a) => ({
                type: a.type,
                targetId: a.target?.value ?? null,
                targetValue: a.type === 'YEAR_OF_STUDY' ? a.year : null,
                roleFilter: ROLE_FILTERED.includes(a.type) ? a.roleFilter : 'ANY',
              })),
            },
            {
              onSuccess: (a) => {
                toast.success(a.scheduled ? 'Announcement scheduled' : 'Announcement published');
                setOpen(false);
              },
              onError: (e) => setError(errorMessage(e)),
            },
          );
        }}
      >
        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="admin-announcement-body">Message</Label>
          <Textarea
            id="admin-announcement-body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={10000}
          />
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Audiences</legend>
          {audiences.map((a, i) => (
            <AudienceRow
              key={a.key}
              draft={a}
              types={types}
              onChange={(d) => setAudiences((all) => all.map((x, j) => (j === i ? d : x)))}
              onRemove={
                audiences.length > 1
                  ? () => setAudiences((all) => all.filter((_, j) => j !== i))
                  : undefined
              }
            />
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAudiences((all) => [...all, newDraft('DEPARTMENT')])}
            >
              <Plus className="size-4" /> Add audience
            </Button>
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="announcement-publish-at">Publish at (optional)</Label>
            <Input
              id="announcement-publish-at"
              type="datetime-local"
              value={publishAt}
              onChange={(e) => setPublishAt(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="announcement-expires-at">Expires at (optional)</Label>
            <Input
              id="announcement-expires-at"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="grid gap-1.5">
            <Label id="admin-priority-label">Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
              <SelectTrigger aria-labelledby="admin-priority-label" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="IMPORTANT">Important</SelectItem>
                <SelectItem value="URGENT">Urgent (also emailed)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Switch id="admin-announcement-pinned" checked={pinned} onCheckedChange={setPinned} />
            <Label htmlFor="admin-announcement-pinned">Pin to the top</Label>
          </div>
        </div>
      </FormDialog>
    </>
  );
}

function EditAnnouncementDialog({ a }: { a: Announcement }) {
  const update = useUpdateAnnouncement();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(a.title);
  const [body, setBody] = useState(a.body);
  const [pinned, setPinned] = useState(a.pinned);
  const [publishAt, setPublishAt] = useState(toLocalInput(a.publishedAt));
  const [expiresAt, setExpiresAt] = useState(toLocalInput(a.expiresAt));
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Edit “${a.title}”`}
        onClick={() => {
          setTitle(a.title);
          setBody(a.body);
          setPinned(a.pinned);
          setPublishAt(toLocalInput(a.publishedAt));
          setExpiresAt(toLocalInput(a.expiresAt));
          setError(null);
          setOpen(true);
        }}
      >
        <Pencil className="size-4" />
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Edit announcement"
        description={a.scheduled ? 'Changing the publish time reschedules it.' : undefined}
        submitLabel="Save"
        submitting={update.isPending}
        error={error}
        wide
        onSubmit={() =>
          update.mutate(
            {
              id: a.id,
              title: title.trim(),
              body: body.trim(),
              pinned,
              expiresAt: fromLocalInput(expiresAt),
              ...(a.scheduled && publishAt ? { publishAt: fromLocalInput(publishAt) } : {}),
            },
            {
              onSuccess: () => {
                toast.success('Announcement updated');
                setOpen(false);
              },
              onError: (e) => setError(errorMessage(e)),
            },
          )
        }
      >
        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <div className="grid gap-1.5">
          <Label htmlFor={`edit-body-${a.id}`}>Message</Label>
          <Textarea
            id={`edit-body-${a.id}`}
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {a.scheduled && (
            <div className="grid gap-1.5">
              <Label htmlFor={`edit-publish-${a.id}`}>Publish at</Label>
              <Input
                id={`edit-publish-${a.id}`}
                type="datetime-local"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor={`edit-expires-${a.id}`}>Expires at</Label>
            <Input
              id={`edit-expires-${a.id}`}
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch id={`edit-pinned-${a.id}`} checked={pinned} onCheckedChange={setPinned} />
          <Label htmlFor={`edit-pinned-${a.id}`}>Pin to the top</Label>
        </div>
      </FormDialog>
    </>
  );
}

function ManagedAnnouncements() {
  const [page, setPage] = useState(1);
  const list = useManagedAnnouncements(page);
  if (list.isPending) return <LoadingRows rows={3} />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data.data.length)
    return (
      <EmptyState
        title="No announcements yet"
        description="Announcements you publish or schedule appear here."
      />
    );
  const meta = list.data.meta;
  const totalPages = meta && 'totalPages' in meta ? meta.totalPages : 1;
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {list.data.data.map((a) => (
          <li key={a.id}>
            <AnnouncementCard a={a} manage />
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/** Administrators: compose, schedule and manage announcements, and read their own feed. */
export function AdminAnnouncementsPage({ portal }: { portal: Portal }) {
  const scoped = useCan('announcement:publish_scoped');
  const global = useCan('announcement:publish_global');
  const canPublish = scoped || global;
  const [params, setParams] = useSearchParams();
  const tab = params.get('a') ? 'feed' : (params.get('tab') ?? (canPublish ? 'manage' : 'feed'));
  return (
    <>
      <PageHeader
        title="Announcements"
        description={
          portal === 'admin'
            ? 'Publish to the university, schools, departments, programmes, courses and people.'
            : undefined
        }
        actions={canPublish ? <ComposeAnnouncementDialog /> : undefined}
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList className="mb-4">
          {canPublish && <TabsTrigger value="manage">Published</TabsTrigger>}
          <TabsTrigger value="feed">For you</TabsTrigger>
        </TabsList>
        {canPublish && (
          <TabsContent value="manage">
            <ManagedAnnouncements />
          </TabsContent>
        )}
        <TabsContent value="feed">
          <AnnouncementFeed />
        </TabsContent>
      </Tabs>
    </>
  );
}
