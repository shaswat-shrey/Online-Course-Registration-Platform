import { BookOpen, Clock, FileText, Link2, Pin, Trash2, Upload, Users } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { minutesToTime } from '@ucrams/shared';
import { FormDialog } from '@/components/forms/form-dialog';
import { TextField } from '@/components/forms/form-field';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { WeekGrid } from '@/components/shared/week-grid';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { MEETING_TYPE_LABEL } from '@/features/courses/api/types';
import { errorMessage, isApiError } from '@/services/api-error';
import { formatDateTime, formatRelative } from '@/utils/format';
import {
  openMaterial,
  useCreateMaterial,
  useDeleteAnnouncement,
  useDeleteMaterial,
  useFacultyDashboard,
  useMySections,
  usePublishAnnouncement,
  useUpdateMaterial,
  uploadMaterialFile,
} from '../api/teaching-queries';
import type { Announcement, Material } from '../api/types';

type Trigger = (open: () => void) => ReactNode;
const time = (m: number) => minutesToTime(m);

/** Faculty dashboard (FR-FACULTY-001), shown on the faculty overview page. */
export function FacultyDashboard() {
  const dash = useFacultyDashboard();
  if (dash.isPending) return <LoadingRows rows={4} />;
  if (dash.isError) return <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />;
  const d = dash.data;
  const loadText = d.load.maxCredits
    ? `${d.load.credits} of ${d.load.maxCredits} credits`
    : `${d.load.credits} credits`;
  const over = d.load.maxCredits !== null && d.load.credits > d.load.maxCredits;
  return (
    <div className="mb-6 space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: d.session ? `Sections in ${d.session.name}` : 'Sections this session',
            value: d.sections.length,
            icon: BookOpen,
          },
          { label: 'Students taught', value: d.totalStudents, icon: Users },
          { label: 'Teaching load', value: loadText, icon: Clock, warn: over },
          { label: 'Sections next session', value: d.upcomingSections, icon: BookOpen },
        ].map((k) => (
          <div key={k.label} className="rounded-lg border bg-card p-4">
            <k.icon className="mb-2 size-4 text-brand" aria-hidden />
            <p
              className={
                over && k.warn
                  ? 'text-2xl font-semibold text-destructive'
                  : 'text-2xl font-semibold tabular-nums'
              }
            >
              {k.value}
            </p>
            <p className="text-xs text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today’s classes</CardTitle>
            <CardDescription>
              Times in the university time zone ({d.today.timeZone}).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.today.classes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No classes today.</p>
            ) : (
              <ul className="space-y-2">
                {d.today.classes.map((c, i) => {
                  const now = d.today.nowMinute >= c.startMinute && d.today.nowMinute < c.endMinute;
                  return (
                    <li
                      key={i}
                      className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm"
                    >
                      <span className="min-w-0">
                        <Link
                          to={`/faculty/sections/${c.sectionId}`}
                          className="font-medium hover:underline"
                        >
                          {c.course} {c.sectionCode}
                        </Link>
                        <span className="block truncate text-xs text-muted-foreground">
                          {MEETING_TYPE_LABEL[c.type] ?? c.type} · {c.classroom ?? 'No room'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        {time(c.startMinute)}–{time(c.endMinute)}
                        {now && <StatusBadge tone="success">Now</StatusBadge>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">My sections</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link to="/faculty/teaching">All assignments</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {d.sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sections assigned this session.</p>
            ) : (
              <ul className="divide-y">
                {d.sections.map((s) => {
                  const fill = s.capacity ? Math.round((s.enrolledCount / s.capacity) * 100) : 0;
                  return (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                    >
                      <Link to={`/faculty/sections/${s.id}`} className="min-w-0 hover:underline">
                        <span className="font-mono font-medium">
                          {s.course.code} {s.sectionCode}
                        </span>{' '}
                        · {s.course.title}
                      </Link>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
                          aria-hidden
                        >
                          <span
                            className="block h-full bg-brand"
                            style={{ width: `${Math.min(fill, 100)}%` }}
                          />
                        </span>
                        <span className="tabular-nums text-xs">
                          {s.enrolledCount}/{s.capacity}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {d.sections.some((s) => s.meetings.length) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weekly schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <WeekGrid
              caption="Weekly teaching schedule"
              items={d.sections.flatMap((s) =>
                s.meetings.map((m) => ({
                  id: m.id,
                  dayOfWeek: m.dayOfWeek,
                  startMinute: m.startMinute,
                  endMinute: m.endMinute,
                  title: `${s.course.code} ${s.sectionCode}`,
                  subtitle: m.classroom?.label,
                  href: `/faculty/sections/${s.id}`,
                })),
              )}
            />
          </CardContent>
        </Card>
      )}
      {d.recentAnnouncements.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Recent announcements</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link to="/faculty/announcements">All</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {d.recentAnnouncements.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span className="truncate">{a.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {a.sectionCount} section(s) · {formatRelative(a.publishedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const PRIORITY_TONE = { NORMAL: 'neutral', IMPORTANT: 'warning', URGENT: 'danger' } as const;

/** Compose an announcement to one or several of the faculty member's current sections (FR-FACULTY-008). */
export function AnnouncementDialog({
  defaultSectionIds = [],
  trigger,
}: {
  defaultSectionIds?: string[];
  trigger: Trigger;
}) {
  const sections = useMySections('current');
  const publish = usePublishAnnouncement();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [pinned, setPinned] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const available = (sections.data ?? []).filter(
    (s) => s.status === 'PUBLISHED' || s.status === 'CLOSED',
  );
  return (
    <>
      {trigger(() => {
        setTitle('');
        setBody('');
        setPriority('NORMAL');
        setPinned(false);
        setChosen(defaultSectionIds);
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="New announcement"
        description="Students in the chosen sections and your co-instructors are notified."
        submitLabel="Publish"
        submitting={publish.isPending}
        error={error}
        wide
        onSubmit={() => {
          if (title.trim().length < 3)
            return setError('Give the announcement a title (at least 3 characters).');
          if (!body.trim()) return setError('Write a message.');
          if (!chosen.length) return setError('Choose at least one section.');
          setError(null);
          publish.mutate(
            { title: title.trim(), body: body.trim(), priority, pinned, sectionIds: chosen },
            {
              onSuccess: () => {
                toast.success('Announcement published');
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
          <Label htmlFor="announcement-body">Message</Label>
          <Textarea
            id="announcement-body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={10000}
          />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="grid gap-1.5">
            <Label id="priority-label">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger aria-labelledby="priority-label" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NORMAL">Normal</SelectItem>
                <SelectItem value="IMPORTANT">Important</SelectItem>
                <SelectItem value="URGENT">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-5">
            <Switch id="announcement-pinned" checked={pinned} onCheckedChange={setPinned} />
            <Label htmlFor="announcement-pinned">Pin to the top</Label>
          </div>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Sections</legend>
          {available.length === 0 && (
            <p className="text-sm text-muted-foreground">
              You have no running sections this session.
            </p>
          )}
          {available.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={chosen.includes(s.id)}
                onCheckedChange={(v) =>
                  setChosen((all) => (v ? [...all, s.id] : all.filter((x) => x !== s.id)))
                }
                aria-label={`${s.course.code} ${s.sectionCode}`}
              />
              <span className="font-mono">
                {s.course.code} {s.sectionCode}
              </span>{' '}
              {s.course.title}{' '}
              <span className="text-xs text-muted-foreground">({s.enrolledCount} students)</span>
            </label>
          ))}
        </fieldset>
      </FormDialog>
    </>
  );
}

export function AnnouncementList({
  items,
  emptyText,
}: {
  items: Announcement[];
  emptyText: string;
}) {
  const remove = useDeleteAnnouncement();
  if (!items.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id}>
          <article className="rounded-lg border p-4">
            <header className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 font-medium">
                  {a.pinned && <Pin className="size-4 text-brand" aria-label="Pinned" />}
                  {a.title}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {a.author} · {formatDateTime(a.publishedAt)} ·{' '}
                  {a.sections.map((s) => s.label).join(', ')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {a.priority !== 'NORMAL' && (
                  <StatusBadge tone={PRIORITY_TONE[a.priority]}>
                    {a.priority === 'URGENT' ? 'Urgent' : 'Important'}
                  </StatusBadge>
                )}
                {a.mine && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Delete “${a.title}”`}>
                        <Trash2 className="size-4" />
                      </Button>
                    }
                    title="Delete this announcement?"
                    description="It disappears for students. Notifications already sent remain in their history."
                    confirmLabel="Delete"
                    destructive
                    onConfirm={() =>
                      remove.mutate(a.id, {
                        onSuccess: () => toast.success('Announcement deleted'),
                        onError: (e) => toast.error(errorMessage(e)),
                      })
                    }
                  />
                )}
              </div>
            </header>
            <p className="text-sm whitespace-pre-line">{a.body}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}

const sizeLabel = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

/** Add a file or a link to a section (FR-FACULTY-007). */
export function MaterialDialog({
  sectionId,
  kind,
  folders,
  trigger,
}: {
  sectionId: string;
  kind: 'FILE' | 'LINK';
  folders: string[];
  trigger: Trigger;
}) {
  const create = useCreateMaterial(sectionId);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [publish, setPublish] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {trigger(() => {
        setTitle('');
        setFolder(folders.at(-1) ?? '');
        setUrl('');
        setDescription('');
        setFile(null);
        setPublish(true);
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={kind === 'FILE' ? 'Upload a file' : 'Add a link'}
        description={
          kind === 'FILE'
            ? 'PDF, Word, PowerPoint, Excel, images or ZIP, up to 50 MB.'
            : 'Readings, videos or other web resources.'
        }
        submitLabel={publish ? 'Add and publish' : 'Add as draft'}
        submitting={busy || create.isPending}
        error={error}
        onSubmit={async () => {
          if (title.trim().length < 2) return setError('Give it a title.');
          if (kind === 'FILE' && !file) return setError('Choose a file.');
          setError(null);
          setBusy(true);
          try {
            const fileId = kind === 'FILE' ? await uploadMaterialFile(file!) : null;
            await create.mutateAsync({
              title: title.trim(),
              folder: folder.trim() || null,
              description: description.trim() || null,
              kind,
              fileId,
              url: kind === 'LINK' ? url.trim() : null,
              publish,
            });
            toast.success(publish ? 'Material published' : 'Material saved as a draft');
            setOpen(false);
          } catch (e) {
            const fields = isApiError(e)
              ? (e.details as { fields?: Array<{ message: string }> } | undefined)?.fields
              : undefined;
            setError(fields?.[0]?.message ?? errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <TextField
          label="Folder"
          hint="e.g. Week 1, Labs"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          list={`folders-${sectionId}`}
          maxLength={100}
        />
        <datalist id={`folders-${sectionId}`}>
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        {kind === 'LINK' ? (
          <TextField
            label="Link"
            type="url"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        ) : (
          <div className="flex items-center gap-3">
            <input
              ref={input}
              type="file"
              className="sr-only"
              aria-label="Choose a file to upload"
              accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp,.zip"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
              }}
            />
            <Button type="button" variant="outline" onClick={() => input.current?.click()}>
              <Upload className="size-4" /> Choose file
            </Button>
            <span className="truncate text-sm text-muted-foreground">
              {file ? `${file.name} (${sizeLabel(file.size)})` : 'No file chosen'}
            </span>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="material-description">Description (optional)</Label>
          <Textarea
            id="material-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="material-publish" checked={publish} onCheckedChange={setPublish} />
          <Label htmlFor="material-publish">Visible to students now</Label>
        </div>
      </FormDialog>
    </>
  );
}

/** Materials grouped by folder with publish toggles for managers. */
export function MaterialList({ items, canManage }: { items: Material[]; canManage: boolean }) {
  const update = useUpdateMaterial();
  const remove = useDeleteMaterial();
  if (!items.length) return <p className="text-sm text-muted-foreground">No materials yet.</p>;
  const groups = items.reduce<Map<string, Material[]>>((acc, m) => {
    const key = m.folder ?? 'General';
    acc.set(key, [...(acc.get(key) ?? []), m]);
    return acc;
  }, new Map());
  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([folder, list]) => (
        <section key={folder}>
          <h3 className="mb-2 text-sm font-semibold">{folder}</h3>
          <ul className="divide-y rounded-lg border">
            {list.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                {m.kind === 'FILE' ? (
                  <FileText className="size-4 text-brand" aria-hidden />
                ) : (
                  <Link2 className="size-4 text-brand" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="text-left text-sm font-medium hover:underline"
                    onClick={() =>
                      void openMaterial(m.id).catch((e) => toast.error(errorMessage(e)))
                    }
                  >
                    {m.title}
                  </button>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.file ? `${m.file.name} · ${sizeLabel(m.file.sizeBytes)}` : m.url}
                    {m.description ? ` · ${m.description}` : ''}
                  </p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={m.published}
                      aria-label={`${m.published ? 'Unpublish' : 'Publish'} ${m.title}`}
                      onCheckedChange={(v) =>
                        update.mutate(
                          { id: m.id, published: v },
                          {
                            onSuccess: () =>
                              toast.success(v ? 'Published' : 'Hidden from students'),
                            onError: (e) => toast.error(errorMessage(e)),
                          },
                        )
                      }
                    />
                    <span className="w-16 text-xs text-muted-foreground">
                      {m.published ? 'Published' : 'Draft'}
                    </span>
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={`Delete ${m.title}`}>
                          <Trash2 className="size-4" />
                        </Button>
                      }
                      title={`Delete “${m.title}”?`}
                      description="Students lose access immediately and the uploaded file is removed."
                      confirmLabel="Delete"
                      destructive
                      onConfirm={() =>
                        remove.mutate(m.id, {
                          onSuccess: () => toast.success('Material deleted'),
                          onError: (e) => toast.error(errorMessage(e)),
                        })
                      }
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
