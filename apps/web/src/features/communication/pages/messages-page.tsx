import {
  ArrowLeft,
  BellOff,
  LifeBuoy,
  Loader2,
  Megaphone,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { MESSAGE_MAX_LENGTH, type Portal } from '@ucrams/shared';
import { FormDialog } from '@/components/forms/form-dialog';
import { SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/services/api-error';
import { useCan } from '@/store/auth-store';
import { formatDateTime, formatRelative } from '@/utils/format';
import {
  uploadAttachment,
  useContacts,
  useConversation,
  useConversations,
  useConversationSettings,
  useDeleteMessage,
  useEditMessage,
  useMarkConversationRead,
  useMessages,
  useMessageSearch,
  useSendMessage,
  useStartDirect,
  useWriteSupport,
} from '../api/queries';
import type { Conversation, FileRef, Message } from '../api/types';
import { AttachmentList, fileSize, PlainText } from '../components/rich-text';

const KIND_LABEL = { STUDENT: 'Student', FACULTY: 'Faculty', ADMIN: 'Administrator' } as const;

/** Messaging (FR-COMM-001..006): conversation list, thread, composer and search. */
export function MessagesPage({ portal }: { portal: Portal }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get('c');
  const box = params.get('box') === 'support' ? 'support' : 'mine';
  const canModerate = useCan('message:moderate');
  const supportStaff = portal === 'admin' && canModerate;
  const [q, setQ] = useState('');
  const list = useConversations(box);
  const select = (id: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id) next.set('c', id);
        else next.delete('c');
        return next;
      },
      { replace: false },
    );

  return (
    <>
      <PageHeader
        title="Messages"
        description="Conversations with your instructors, students, classmates and university staff."
        actions={
          <>
            {portal !== 'admin' && <SupportDialog onOpened={select} />}
            <NewMessageDialog onStarted={select} />
          </>
        }
      />
      {supportStaff && (
        <Tabs
          value={box}
          onValueChange={(v) =>
            setParams(v === 'support' ? { box: 'support' } : {}, { replace: true })
          }
          className="mb-4"
        >
          <TabsList>
            <TabsTrigger value="mine">My conversations</TabsTrigger>
            <TabsTrigger value="support">Support inbox</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <div className="grid min-h-[32rem] gap-4 md:h-[calc(100dvh-15rem)] md:grid-cols-[20rem_minmax(0,1fr)]">
        <section
          aria-label="Conversations"
          className={cn('flex min-h-0 flex-col rounded-lg border', selected && 'hidden md:flex')}
        >
          <div className="border-b p-2">
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Search messages"
              label="Search messages"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {q.trim().length >= 2 ? (
              <SearchResults
                q={q}
                onOpen={(id) => {
                  setQ('');
                  select(id);
                }}
              />
            ) : list.isPending ? (
              <div className="p-3">
                <LoadingRows rows={4} />
              </div>
            ) : list.isError ? (
              <div className="p-3">
                <ErrorState error={list.error} onRetry={() => void list.refetch()} />
              </div>
            ) : list.data.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {box === 'support'
                  ? 'No support conversations in your scope.'
                  : 'No conversations yet. Start one with “New message”.'}
              </p>
            ) : (
              <ul>
                {list.data.map((c) => (
                  <li key={c.id}>
                    <ConversationRow c={c} active={c.id === selected} onOpen={() => select(c.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section
          aria-label="Conversation"
          className={cn('flex min-h-0 flex-col rounded-lg border', !selected && 'hidden md:flex')}
        >
          {selected ? (
            <ConversationView key={selected} id={selected} onBack={() => select(null)} />
          ) : (
            <div className="m-auto p-6">
              <EmptyState
                title="Choose a conversation"
                description="Section chats appear automatically for the courses you teach or attend."
              />
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function ConversationIcon({ c }: { c: Conversation }) {
  const Icon = c.type === 'SECTION' ? Users : c.type === 'SUPPORT' ? LifeBuoy : null;
  if (!Icon)
    return (
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand"
      >
        {c.title
          .split(/\s+/)
          .slice(0, 2)
          .map((w) => w[0])
          .join('')
          .toUpperCase()}
      </span>
    );
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
    >
      <Icon className="size-4" />
    </span>
  );
}

function ConversationRow({
  c,
  active,
  onOpen,
}: {
  c: Conversation;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
        active && 'bg-muted',
      )}
    >
      <ConversationIcon c={c} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className={cn('truncate text-sm', c.unread ? 'font-semibold' : 'font-medium')}>
            {c.title}
          </span>
          {c.lastMessage && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRelative(c.lastMessage.createdAt)}
            </span>
          )}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">
            {c.lastMessage
              ? `${c.lastMessage.sender}: ${c.lastMessage.preview}`
              : 'No messages yet'}
          </span>
          {c.muted ? (
            <BellOff className="size-3.5 shrink-0 text-muted-foreground" aria-label="Muted" />
          ) : c.unread > 0 ? (
            <span className="shrink-0 rounded-full bg-brand px-1.5 text-[10px] leading-4 font-semibold text-white">
              <span className="sr-only">Unread: </span>
              {c.unread}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function SearchResults({ q, onOpen }: { q: string; onOpen: (conversationId: string) => void }) {
  const hits = useMessageSearch(q);
  if (hits.isPending)
    return (
      <div className="p-3">
        <LoadingRows rows={3} />
      </div>
    );
  if (hits.isError)
    return <p className="p-4 text-sm text-destructive">{errorMessage(hits.error)}</p>;
  if (!hits.data.length)
    return <p className="p-4 text-sm text-muted-foreground">No messages match.</p>;
  return (
    <ul aria-label="Search results">
      {hits.data.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            onClick={() => onOpen(m.conversationId)}
            className="w-full border-b px-3 py-2.5 text-left hover:bg-muted/60"
          >
            <span className="block truncate text-xs text-muted-foreground">
              {m.conversationTitle} · {m.sender.name} · {formatRelative(m.createdAt)}
            </span>
            <span className="line-clamp-2 text-sm">{m.body}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ConversationView({ id, onBack }: { id: string; onBack: () => void }) {
  const conversation = useConversation(id);
  const messages = useMessages(id);
  const markRead = useMarkConversationRead();
  const settings = useConversationSettings(id);
  const scroller = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () => [...(messages.data?.pages ?? [])].reverse().flatMap((p) => p.items),
    [messages.data],
  );
  const newest = items.at(-1)?.id;
  const { mutate: read } = markRead;
  const member = conversation.data?.member;

  // Read up to the newest message whenever it changes while the thread is open.
  useEffect(() => {
    if (newest && member) read(id);
  }, [newest, member, id, read]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newest]);

  if (conversation.isPending)
    return (
      <div className="p-4">
        <LoadingRows rows={5} />
      </div>
    );
  if (conversation.isError)
    return (
      <div className="p-4">
        <ErrorState error={conversation.error} onRetry={() => void conversation.refetch()} />
      </div>
    );
  const c = conversation.data;
  return (
    <>
      <header className="flex items-center gap-3 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <ConversationIcon c={c} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{c.title}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {c.subtitle ?? c.participants.map((p) => p.name).join(', ')}
          </p>
        </div>
        {c.announcementOnly && (
          <StatusBadge tone="info" className="hidden sm:inline-flex">
            Instructors only
          </StatusBadge>
        )}
        {(c.member || c.canModerate) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Conversation settings">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {c.member && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    settings.mutate({ muted: !c.muted });
                  }}
                >
                  <BellOff className="size-4" />
                  <span className="flex-1">Mute notifications</span>
                  <Switch checked={c.muted} aria-hidden tabIndex={-1} />
                </DropdownMenuItem>
              )}
              {c.type === 'SECTION' && c.canModerate && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    settings.mutate({ announcementOnly: !c.announcementOnly });
                  }}
                >
                  <Megaphone className="size-4" />
                  <span className="flex-1">Only instructors can post</span>
                  <Switch checked={c.announcementOnly} aria-hidden tabIndex={-1} />
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>
      <div
        ref={scroller}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        aria-live="polite"
      >
        {messages.hasNextPage && (
          <div className="text-center">
            <Button
              variant="outline"
              size="sm"
              disabled={messages.isFetchingNextPage}
              onClick={() => void messages.fetchNextPage()}
            >
              {messages.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />} Load
              earlier messages
            </Button>
          </div>
        )}
        {messages.isPending ? (
          <LoadingRows rows={4} />
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No messages yet. Say hello!
          </p>
        ) : (
          <ol className="space-y-3">
            {items.map((m) => (
              <li key={m.id}>
                <MessageBubble m={m} showSender={c.type !== 'DIRECT'} />
              </li>
            ))}
          </ol>
        )}
      </div>
      {c.canPost ? (
        <Composer conversationId={id} />
      ) : (
        <p className="border-t px-4 py-3 text-sm text-muted-foreground">
          Only instructors can post in this conversation.
        </p>
      )}
    </>
  );
}

function MessageBubble({ m, showSender }: { m: Message; showSender: boolean }) {
  const edit = useEditMessage();
  const remove = useDeleteMessage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body ?? '');
  return (
    <article className={cn('flex flex-col', m.mine ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'group relative max-w-[85%] rounded-2xl px-3 py-2 sm:max-w-[75%]',
          m.deleted
            ? 'border border-dashed text-muted-foreground'
            : m.mine
              ? 'bg-brand text-white'
              : 'bg-muted',
        )}
      >
        {showSender && !m.mine && !m.deleted && (
          <p className="mb-0.5 text-xs font-semibold">{m.sender.name}</p>
        )}
        {m.deleted ? (
          <p className="text-sm italic">Message deleted</p>
        ) : editing ? (
          <form
            className="grid w-72 max-w-full gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              edit.mutate(
                { id: m.id, body: draft.trim() },
                {
                  onSuccess: () => setEditing(false),
                  onError: (err) => toast.error(errorMessage(err)),
                },
              );
            }}
          >
            <Label htmlFor={`edit-${m.id}`} className="sr-only">
              Edit message
            </Label>
            <Textarea
              id={`edit-${m.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="bg-background text-foreground"
              maxLength={MESSAGE_MAX_LENGTH}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={!draft.trim() || edit.isPending}
              >
                Save
              </Button>
            </div>
          </form>
        ) : (
          m.body && <PlainText text={m.body} />
        )}
        {!m.deleted && (
          <AttachmentList
            files={m.attachments}
            linkFor={(fileId) => `/messages/${m.id}/attachments/${fileId}`}
          />
        )}
        {(m.canEdit || m.canDelete) && !editing && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'absolute -top-2 size-7 rounded-full bg-background text-foreground opacity-0 shadow-sm group-hover:opacity-100 focus-visible:opacity-100',
                  m.mine ? '-left-8' : '-right-8',
                )}
                aria-label="Message actions"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={m.mine ? 'end' : 'start'}>
              {m.canEdit && (
                <DropdownMenuItem
                  onSelect={() => {
                    setDraft(m.body ?? '');
                    setEditing(true);
                  }}
                >
                  <Pencil className="size-4" /> Edit
                </DropdownMenuItem>
              )}
              {m.canDelete && (
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={() =>
                    remove.mutate(m.id, { onError: (e) => toast.error(errorMessage(e)) })
                  }
                >
                  <Trash2 className="size-4" /> Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p
        className="mt-0.5 px-1 text-[11px] text-muted-foreground"
        title={formatDateTime(m.createdAt)}
      >
        {formatRelative(m.createdAt)}
        {m.editedAt && ' · edited'}
      </p>
    </article>
  );
}

function Composer({ conversationId }: { conversationId: string }) {
  const send = useSendMessage(conversationId);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<FileRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const submit = () => {
    if ((!body.trim() && !files.length) || send.isPending) return;
    send.mutate(
      { body: body.trim(), fileIds: files.map((f) => f.fileId) },
      {
        onSuccess: () => {
          setBody('');
          setFiles([]);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };
  return (
    <form
      className="border-t p-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments to send">
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
                onClick={() => setFiles((all) => all.filter((x) => x.fileId !== f.fileId))}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={picker}
          type="file"
          className="hidden"
          accept=".pdf,.docx,.xlsx,image/png,image/jpeg,image/webp"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setUploading(true);
            try {
              const fileId = await uploadAttachment('MESSAGE', file);
              setFiles((all) => [
                ...all,
                { fileId, name: file.name, mimeType: file.type, sizeBytes: file.size },
              ]);
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setUploading(false);
            }
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Attach a file"
          disabled={uploading || files.length >= 5}
          onClick={() => picker.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Paperclip className="size-4" />
          )}
        </Button>
        <Label htmlFor={`composer-${conversationId}`} className="sr-only">
          Message
        </Label>
        <Textarea
          id={`composer-${conversationId}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Write a message — Enter to send, Shift+Enter for a new line"
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          className="max-h-40 min-h-10 flex-1 resize-none"
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send"
          disabled={send.isPending || (!body.trim() && !files.length)}
        >
          {send.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </div>
    </form>
  );
}

function NewMessageDialog({ onStarted }: { onStarted: (conversationId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [to, setTo] = useState<{ userId: string; name: string } | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const contacts = useContacts(q, open);
  const start = useStartDirect();
  return (
    <>
      <Button
        onClick={() => {
          setQ('');
          setTo(null);
          setBody('');
          setError(null);
          setOpen(true);
        }}
      >
        <Plus className="size-4" /> New message
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="New message"
        description="You can message people you teach, study with or work with."
        submitLabel="Send"
        submitting={start.isPending}
        error={error}
        onSubmit={() => {
          if (!to) return setError('Choose who to message.');
          if (!body.trim()) return setError('Write a message.');
          setError(null);
          start.mutate(
            { userId: to.userId, body: body.trim() },
            {
              onSuccess: (r) => {
                setOpen(false);
                onStarted(r.conversationId);
              },
              onError: (e) => setError(errorMessage(e)),
            },
          );
        }}
      >
        {to ? (
          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span>
              To: <span className="font-medium">{to.name}</span>
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setTo(null)}>
              Change
            </Button>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="contact-search">To</Label>
            <Input
              id="contact-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or email"
              autoComplete="off"
            />
            <ul className="max-h-56 overflow-y-auto rounded-md border" aria-label="Contacts">
              {contacts.isPending ? (
                <li className="p-3 text-sm text-muted-foreground">Loading…</li>
              ) : !contacts.data?.length ? (
                <li className="p-3 text-sm text-muted-foreground">
                  {q.trim().length < 2
                    ? 'Type at least 2 characters to search.'
                    : 'Nobody you can message matches.'}
                </li>
              ) : (
                contacts.data.map((c) => (
                  <li key={c.userId}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => setTo({ userId: c.userId, name: c.name })}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.email}
                        </span>
                      </span>
                      <StatusBadge tone="neutral">{KIND_LABEL[c.kind]}</StatusBadge>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="new-message-body">Message</Label>
          <Textarea
            id="new-message-body"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={MESSAGE_MAX_LENGTH}
          />
        </div>
      </FormDialog>
    </>
  );
}

function SupportDialog({ onOpened }: { onOpened: (conversationId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const write = useWriteSupport();
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setBody('');
          setError(null);
          setOpen(true);
        }}
      >
        <LifeBuoy className="size-4" /> Contact support
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Message university support"
        description="Administrators for your department answer here. For issues that need tracking, open a support ticket instead."
        submitLabel="Send"
        submitting={write.isPending}
        error={error}
        onSubmit={() => {
          if (!body.trim()) return setError('Write a message.');
          write.mutate(body.trim(), {
            onSuccess: (r) => {
              setOpen(false);
              onOpened(r.conversationId);
            },
            onError: (e) => setError(errorMessage(e)),
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="support-body">Message</Label>
          <Textarea
            id="support-body"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={MESSAGE_MAX_LENGTH}
          />
        </div>
      </FormDialog>
    </>
  );
}
