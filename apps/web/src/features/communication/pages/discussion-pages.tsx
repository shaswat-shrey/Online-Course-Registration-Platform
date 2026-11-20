import {
  CheckCircle2,
  HelpCircle,
  Lock,
  MessageSquare,
  Pin,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { Portal, ThreadType } from '@ucrams/shared';
import { TextField } from '@/components/forms/form-field';
import { FormDialog } from '@/components/forms/form-dialog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/services/api-error';
import { formatDateTime, formatRelative } from '@/utils/format';
import {
  useBoards,
  useCreateThread,
  useDeletePost,
  useDeleteThread,
  useReply,
  useThread,
  useThreads,
  useUpdateThread,
} from '../api/queries';
import type { Thread } from '../api/types';
import { PlainText } from '../components/rich-text';

function ThreadBadges({ t }: { t: Thread }) {
  return (
    <>
      {t.pinned && (
        <StatusBadge tone="info">
          <Pin className="size-3" aria-hidden /> Pinned
        </StatusBadge>
      )}
      {t.type === 'QUESTION' && (
        <StatusBadge tone={t.answered ? 'success' : 'warning'}>
          {t.answered ? 'Answered' : 'Question'}
        </StatusBadge>
      )}
      {t.locked && (
        <StatusBadge tone="neutral">
          <Lock className="size-3" aria-hidden /> Locked
        </StatusBadge>
      )}
    </>
  );
}

/** Threads of one section with search and filters (FR-COMM-007). */
export function DiscussionBoard({ sectionId, portal }: { sectionId: string; portal: Portal }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const threads = useThreads(sectionId, {
    q,
    type: filter === 'UNANSWERED' ? undefined : filter,
    unanswered: filter === 'UNANSWERED',
  });
  return (
    <div className="space-y-4">
      <ListToolbar>
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search threads"
          label="Search threads"
        />
        <FilterSelect
          label="Show"
          value={filter}
          onChange={setFilter}
          allLabel="All threads"
          options={[
            { value: 'QUESTION', label: 'Questions' },
            { value: 'UNANSWERED', label: 'Unanswered questions' },
            { value: 'DISCUSSION', label: 'Discussions' },
          ]}
        />
        <NewThreadDialog sectionId={sectionId} portal={portal} />
      </ListToolbar>
      {threads.isPending ? (
        <LoadingRows rows={4} />
      ) : threads.isError ? (
        <ErrorState error={threads.error} onRetry={() => void threads.refetch()} />
      ) : threads.data.items.length === 0 ? (
        <EmptyState
          title="No threads yet"
          description="Ask a question or start a discussion with your class."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {threads.data.items.map((t) => (
            <li key={t.id}>
              <Link
                to={`/${portal}/discussions/${t.id}`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50"
              >
                {t.type === 'QUESTION' ? (
                  <HelpCircle className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                ) : (
                  <MessageSquare
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t.author.name} · {t.replyCount} repl{t.replyCount === 1 ? 'y' : 'ies'} · active{' '}
                    {formatRelative(t.lastActivityAt)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  <ThreadBadges t={t} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewThreadDialog({ sectionId, portal }: { sectionId: string; portal: Portal }) {
  const create = useCreateThread(sectionId);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ThreadType>('QUESTION');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        className="sm:ml-auto"
        onClick={() => {
          setType('QUESTION');
          setTitle('');
          setBody('');
          setError(null);
          setOpen(true);
        }}
      >
        <Plus className="size-4" /> New thread
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="New thread"
        description="Everyone in the section can read and reply."
        submitLabel="Post"
        submitting={create.isPending}
        error={error}
        onSubmit={() => {
          if (title.trim().length < 3)
            return setError('Give the thread a title (at least 3 characters).');
          if (!body.trim()) return setError('Write something.');
          create.mutate(
            { type, title: title.trim(), body: body.trim() },
            {
              onSuccess: (t) => {
                setOpen(false);
                navigate(`/${portal}/discussions/${t.id}`);
              },
              onError: (e) => setError(errorMessage(e)),
            },
          );
        }}
      >
        <div className="grid gap-1.5">
          <Label id="thread-type-label">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as ThreadType)}>
            <SelectTrigger aria-labelledby="thread-type-label" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="QUESTION">Question</SelectItem>
              <SelectItem value="DISCUSSION">Discussion</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TextField
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="thread-body">Details</Label>
          <Textarea
            id="thread-body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={10000}
          />
        </div>
      </FormDialog>
    </>
  );
}

/** Boards for the sections the user teaches or attends. */
export function DiscussionsPage({ portal }: { portal: Portal }) {
  const boards = useBoards();
  const [params, setParams] = useSearchParams();
  const chosen =
    params.get('section') ?? boards.data?.find((b) => b.current)?.id ?? boards.data?.[0]?.id ?? '';
  return (
    <>
      <PageHeader
        title="Discussions"
        description="Questions and discussions for each of your sections."
      />
      {boards.isPending ? (
        <LoadingRows rows={4} />
      ) : boards.isError ? (
        <ErrorState error={boards.error} onRetry={() => void boards.refetch()} />
      ) : boards.data.length === 0 ? (
        <EmptyState
          title="No sections yet"
          description="Boards appear for the sections you teach or are registered in."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid max-w-md gap-1.5">
            <Label id="board-label">Section</Label>
            <Select
              value={chosen}
              onValueChange={(v) => setParams({ section: v }, { replace: true })}
            >
              <SelectTrigger aria-labelledby="board-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {boards.data.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.label} · {b.title} ({b.session})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {chosen && <DiscussionBoard key={chosen} sectionId={chosen} portal={portal} />}
        </div>
      )}
    </>
  );
}

export function ThreadPage({ portal }: { portal: Portal }) {
  const { threadId = '' } = useParams();
  const thread = useThread(threadId);
  const update = useUpdateThread(threadId);
  const removeThread = useDeleteThread();
  const removePost = useDeletePost();
  const reply = useReply(threadId);
  const navigate = useNavigate();
  const [body, setBody] = useState('');
  if (thread.isPending) return <LoadingRows rows={5} />;
  if (thread.isError)
    return <ErrorState error={thread.error} onRetry={() => void thread.refetch()} />;
  const t = thread.data;
  const toggle = (patch: Parameters<typeof update.mutate>[0], done: string) =>
    update.mutate(patch, {
      onSuccess: () => toast.success(done),
      onError: (e) => toast.error(errorMessage(e)),
    });
  return (
    <>
      <PageHeader
        title={t.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {t.author.name} · {formatDateTime(t.createdAt)}
              {t.editedAt && ' · edited'}
            </span>
            <ThreadBadges t={t} />
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to={`/${portal}/discussions?section=${t.sectionId}`}>All threads</Link>
            </Button>
            {t.canModerate && (
              <>
                <Button
                  variant="outline"
                  onClick={() => toggle({ pinned: !t.pinned }, t.pinned ? 'Unpinned' : 'Pinned')}
                >
                  <Pin className="size-4" /> {t.pinned ? 'Unpin' : 'Pin'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => toggle({ locked: !t.locked }, t.locked ? 'Unlocked' : 'Locked')}
                >
                  {t.locked ? <Unlock className="size-4" /> : <Lock className="size-4" />}
                  {t.locked ? 'Unlock' : 'Lock'}
                </Button>
              </>
            )}
            {t.canDelete && (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" aria-label="Delete thread">
                    <Trash2 className="size-4" />
                  </Button>
                }
                title="Delete this thread?"
                description="It is removed from the board for everyone."
                confirmLabel="Delete"
                destructive
                onConfirm={() =>
                  removeThread.mutate(t.id, {
                    onSuccess: () => navigate(`/${portal}/discussions?section=${t.sectionId}`),
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
              />
            )}
          </>
        }
      />
      <Card className="mb-6">
        <CardContent>
          {t.body ? <PlainText text={t.body} /> : <p className="text-sm italic">Removed</p>}
        </CardContent>
      </Card>
      <h2 className="mb-3 text-base font-semibold">
        {t.posts.filter((p) => !p.deleted).length} repl{t.replyCount === 1 ? 'y' : 'ies'}
      </h2>
      <ol className="mb-6 space-y-3">
        {t.posts.map((p) => (
          <li key={p.id}>
            <article
              className={cn(
                'rounded-lg border p-4',
                p.isAnswer && 'border-success/50 bg-success/5',
                p.deleted && 'border-dashed text-muted-foreground',
              )}
            >
              <header className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  <span className="font-medium">{p.author.name}</span>{' '}
                  <span
                    className="text-xs text-muted-foreground"
                    title={formatDateTime(p.createdAt)}
                  >
                    {formatRelative(p.createdAt)}
                  </span>
                </p>
                <div className="flex items-center gap-1">
                  {p.isAnswer && (
                    <StatusBadge tone="success">
                      <CheckCircle2 className="size-3" aria-hidden /> Accepted answer
                    </StatusBadge>
                  )}
                  {t.canModerate && t.type === 'QUESTION' && !p.deleted && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        toggle(
                          { answerPostId: p.isAnswer ? null : p.id },
                          p.isAnswer ? 'Answer cleared' : 'Marked as the answer',
                        )
                      }
                    >
                      {p.isAnswer ? 'Clear answer' : 'Mark as answer'}
                    </Button>
                  )}
                  {p.canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete reply"
                      onClick={() =>
                        removePost.mutate(p.id, { onError: (e) => toast.error(errorMessage(e)) })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </header>
              {p.body ? (
                <PlainText text={p.body} />
              ) : (
                <p className="text-sm italic">Reply removed</p>
              )}
            </article>
          </li>
        ))}
      </ol>
      {t.canReply ? (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            reply.mutate(body.trim(), {
              onSuccess: () => setBody(''),
              onError: (err) => toast.error(errorMessage(err)),
            });
          }}
        >
          <Label htmlFor="reply-body">Your reply</Label>
          <Textarea
            id="reply-body"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={10000}
          />
          <div>
            <Button type="submit" disabled={!body.trim() || reply.isPending}>
              Post reply
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">This thread is locked; replies are closed.</p>
      )}
    </>
  );
}
