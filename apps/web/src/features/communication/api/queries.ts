import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import axios from 'axios';
import {
  FILE_LIMITS,
  type AnnouncementInput,
  type FeedbackInput,
  type NotificationCategory,
  type NotificationChannel,
  type ThreadInput,
  type TicketInput,
  type TicketReplyInput,
} from '@ucrams/shared';
import { ApiError } from '@/services/api-error';
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost, apiPut } from '@/services/http';
import type {
  Announcement,
  Assignee,
  Board,
  Contact,
  Conversation,
  Feedback,
  FeedbackDetail,
  Message,
  MessageHit,
  Post,
  PreferenceRow,
  Thread,
  ThreadDetail,
  ThreadList,
  Ticket,
  TicketDetail,
} from './types';

export const commKeys = {
  conversations: (box: string) => ['conversations', box] as const,
  conversation: (id: string) => ['conversations', 'one', id] as const,
  messages: (id: string) => ['messages', id] as const,
  unread: ['conversations', 'unread'] as const,
  contacts: (q: string) => ['contacts', q] as const,
  search: (q: string) => ['message-search', q] as const,
  boards: ['discussions', 'boards'] as const,
  threads: (sectionId: string, p: object) => ['discussions', 'threads', sectionId, p] as const,
  thread: (id: string) => ['discussions', 'thread', id] as const,
  feed: ['announcements', 'feed'] as const,
  manage: (page: number) => ['announcements', 'manage', page] as const,
  preferences: ['notification-preferences'] as const,
  feedback: (box: string, p: object) => ['feedback', box, p] as const,
  feedbackOne: (id: string) => ['feedback', 'one', id] as const,
  tickets: (box: string, p: object) => ['tickets', box, p] as const,
  ticket: (id: string) => ['tickets', 'one', id] as const,
  assignees: (kind: string, dept: string | null) => ['assignees', kind, dept] as const,
};

// ----- uploads ---------------------------------------------------------------------

/** Message and ticket attachments: intent, PUT to the signed URL, then server verification. */
export async function uploadAttachment(context: 'MESSAGE' | 'TICKET', file: File) {
  const limits = FILE_LIMITS[context];
  if (!(limits.mimeTypes as readonly string[]).includes(file.type))
    throw new ApiError(422, 'FILE_TYPE_NOT_ALLOWED', 'Attach a PDF, Word document or image');
  if (file.size > limits.maxBytes)
    throw new ApiError(422, 'FILE_TOO_LARGE', 'Attachments must be at most 10 MB');
  const intent = await apiPost<{
    fileId: string;
    upload: { url: string; headers: Record<string, string> };
  }>('/files/upload-intents', {
    context,
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  try {
    await axios.put(intent.upload.url, file, { headers: intent.upload.headers });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'The upload did not complete. Try again.');
  }
  await apiPost(`/files/${intent.fileId}/complete`);
  return intent.fileId;
}

export async function openDownload(url: string) {
  const link = await apiGet<{ url: string }>(url);
  window.open(link.url, '_blank', 'noopener');
}

// ----- messaging --------------------------------------------------------------------

export const useConversations = (box: 'mine' | 'support', enabled = true) =>
  useQuery({
    queryKey: commKeys.conversations(box),
    queryFn: () => apiGet<Conversation[]>('/conversations', { params: { box } }),
    enabled,
  });
export const useConversation = (id: string | null) =>
  useQuery({
    queryKey: commKeys.conversation(id ?? ''),
    queryFn: () => apiGet<Conversation>(`/conversations/${id}`),
    enabled: !!id,
  });
export const useUnreadMessages = (enabled: boolean) =>
  useQuery({
    queryKey: commKeys.unread,
    queryFn: () => apiGet<{ total: number }>('/conversations/unread-count'),
    enabled,
    refetchInterval: 120_000,
  });
export const useMessages = (id: string | null) =>
  useInfiniteQuery({
    queryKey: commKeys.messages(id ?? ''),
    queryFn: ({ pageParam }) =>
      apiGet<{ hasMore: boolean; items: Message[] }>(`/conversations/${id}/messages`, {
        params: { before: pageParam, limit: 30 },
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.items[0]?.id : undefined),
    enabled: !!id,
  });
export const useContacts = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: commKeys.contacts(q),
    queryFn: () => apiGet<Contact[]>('/conversations/contacts', { params: { q } }),
    enabled,
    placeholderData: keepPreviousData,
  });
export const useMessageSearch = (q: string) =>
  useQuery({
    queryKey: commKeys.search(q),
    queryFn: () => apiGet<MessageHit[]>('/conversations/search', { params: { q } }),
    enabled: q.trim().length >= 2,
  });

function useInvalidateMessaging() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['conversations'] });
    void qc.invalidateQueries({ queryKey: ['messages'] });
  };
}
export const useSendMessage = (id: string) => {
  const done = useInvalidateMessaging();
  return useMutation({
    mutationFn: (body: { body: string; fileIds: string[] }) =>
      apiPost<Message>(`/conversations/${id}/messages`, body),
    onSuccess: done,
  });
};
export const useStartDirect = () => {
  const done = useInvalidateMessaging();
  return useMutation({
    mutationFn: (body: { userId: string; body: string }) =>
      apiPost<{ conversationId: string }>('/conversations/direct', body),
    onSuccess: done,
  });
};
export const useWriteSupport = () => {
  const done = useInvalidateMessaging();
  return useMutation({
    mutationFn: (body: string) =>
      apiPost<{ conversationId: string }>('/conversations/support', { body }),
    onSuccess: done,
  });
};
export const useEditMessage = () => {
  const done = useInvalidateMessaging();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiPatch<Message>(`/messages/${id}`, { body }),
    onSuccess: done,
  });
};
export const useDeleteMessage = () => {
  const done = useInvalidateMessaging();
  return useMutation({ mutationFn: (id: string) => apiDelete(`/messages/${id}`), onSuccess: done });
};
export const useConversationSettings = (id: string) => {
  const done = useInvalidateMessaging();
  return useMutation({
    mutationFn: (body: { muted?: boolean; announcementOnly?: boolean }) =>
      apiPatch<Conversation>(`/conversations/${id}`, body),
    onSuccess: done,
  });
};
export const useMarkConversationRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/conversations/${id}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
};

// ----- discussions -------------------------------------------------------------------

export const useBoards = () =>
  useQuery({ queryKey: commKeys.boards, queryFn: () => apiGet<Board[]>('/discussions/boards') });
export const useThreads = (
  sectionId: string,
  p: { q?: string; type?: string; unanswered?: boolean },
) =>
  useQuery({
    queryKey: commKeys.threads(sectionId, p),
    queryFn: () =>
      apiGet<ThreadList>(`/course-sections/${sectionId}/discussions`, {
        params: {
          q: p.q || undefined,
          type: p.type || undefined,
          unanswered: p.unanswered ? 'true' : undefined,
        },
      }),
    enabled: !!sectionId,
    placeholderData: keepPreviousData,
  });
export const useThread = (id: string) =>
  useQuery({
    queryKey: commKeys.thread(id),
    queryFn: () => apiGet<ThreadDetail>(`/discussions/${id}`),
  });
export const useCreateThread = (sectionId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ThreadInput) =>
      apiPost<Thread>(`/course-sections/${sectionId}/discussions`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['discussions'] }),
  });
};
export const useUpdateThread = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      body: Partial<{
        title: string;
        body: string;
        pinned: boolean;
        locked: boolean;
        answerPostId: string | null;
      }>,
    ) => apiPatch<ThreadDetail>(`/discussions/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['discussions'] }),
  });
};
export const useDeleteThread = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/discussions/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['discussions'] }),
  });
};
export const useReply = (threadId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => apiPost<Post>(`/discussions/${threadId}/posts`, { body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['discussions'] }),
  });
};
export const useDeletePost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/discussion-posts/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['discussions'] }),
  });
};

// ----- announcements ----------------------------------------------------------------

export const useAnnouncementFeed = () =>
  useQuery({
    queryKey: commKeys.feed,
    queryFn: () =>
      apiGet<{ unread: number; items: Announcement[] }>('/announcements/feed', {
        params: { limit: 100 },
      }),
  });
export const useManagedAnnouncements = (page: number) =>
  useQuery({
    queryKey: commKeys.manage(page),
    queryFn: () =>
      apiGetPage<Announcement>('/announcements/manage', { params: { page, limit: 20 } }),
    placeholderData: keepPreviousData,
  });
function useInvalidateAnnouncements() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['announcements'] });
    void qc.invalidateQueries({ queryKey: ['teaching'] });
  };
}
export const useCreateAnnouncement = () => {
  const done = useInvalidateAnnouncements();
  return useMutation({
    mutationFn: (body: AnnouncementInput) => apiPost<Announcement>('/announcements', body),
    onSuccess: done,
  });
};
export const useUpdateAnnouncement = () => {
  const done = useInvalidateAnnouncements();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiPatch<Announcement>(`/announcements/${id}`, body),
    onSuccess: done,
  });
};
export const useMarkAnnouncementRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost(`/announcements/${id}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: commKeys.feed }),
  });
};

// ----- preferences ------------------------------------------------------------------

export const usePreferences = () =>
  useQuery({
    queryKey: commKeys.preferences,
    queryFn: () => apiGet<PreferenceRow[]>('/notifications/preferences'),
  });
export const useSavePreference = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: {
      category: NotificationCategory;
      channel: NotificationChannel;
      enabled: boolean;
    }) => apiPut<PreferenceRow[]>('/notifications/preferences', { preferences: [p] }),
    onSuccess: (data) => qc.setQueryData(commKeys.preferences, data),
  });
};

// ----- feedback ------------------------------------------------------------------------

type CaseListParams = {
  page: number;
  status?: string;
  category?: string;
  q?: string;
  assignedToMe?: boolean;
};
const caseParams = (p: CaseListParams) => ({
  page: p.page,
  limit: 20,
  status: p.status || undefined,
  category: p.category || undefined,
  q: p.q || undefined,
  assignedToMe: p.assignedToMe ? 'true' : undefined,
});

export const useFeedbackList = (box: 'mine' | 'manage', p: CaseListParams) =>
  useQuery({
    queryKey: commKeys.feedback(box, p),
    queryFn: () =>
      apiGetPage<Feedback>(box === 'mine' ? '/feedback/mine' : '/feedback', {
        params: caseParams(p),
      }),
    placeholderData: keepPreviousData,
  });
export const useFeedback = (id: string) =>
  useQuery({
    queryKey: commKeys.feedbackOne(id),
    queryFn: () => apiGet<FeedbackDetail>(`/feedback/${id}`),
  });
export const useSubmitFeedback = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FeedbackInput) => apiPost<Feedback>('/feedback', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['feedback'] }),
  });
};
export const useUpdateFeedback = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch<Feedback>(`/feedback/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['feedback'] }),
  });
};
export const useRespondFeedback = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => apiPost<FeedbackDetail>(`/feedback/${id}/responses`, { body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['feedback'] }),
  });
};

// ----- tickets --------------------------------------------------------------------------

export const useTickets = (box: 'mine' | 'manage', p: CaseListParams) =>
  useQuery({
    queryKey: commKeys.tickets(box, p),
    queryFn: () =>
      apiGetPage<Ticket>(box === 'mine' ? '/tickets/mine' : '/tickets', { params: caseParams(p) }),
    placeholderData: keepPreviousData,
  });
export const useTicket = (id: string) =>
  useQuery({
    queryKey: commKeys.ticket(id),
    queryFn: () => apiGet<TicketDetail>(`/tickets/${id}`),
  });
export const useCreateTicket = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TicketInput) => apiPost<Ticket>('/tickets', body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tickets'] }),
  });
};
export const useReplyTicket = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TicketReplyInput) => apiPost<TicketDetail>(`/tickets/${id}/responses`, body),
    onSuccess: (data) => {
      qc.setQueryData(commKeys.ticket(id), data);
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
};
export const useUpdateTicket = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPatch<TicketDetail>(`/tickets/${id}`, body),
    onSuccess: (data) => {
      qc.setQueryData(commKeys.ticket(id), data);
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
};
export const useReopenTicket = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<TicketDetail>(`/tickets/${id}/reopen`),
    onSuccess: (data) => {
      qc.setQueryData(commKeys.ticket(id), data);
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
};
export const useAssignees = (
  kind: 'feedback' | 'tickets',
  departmentId: string | null,
  enabled: boolean,
) =>
  useQuery({
    queryKey: commKeys.assignees(kind, departmentId),
    queryFn: () =>
      apiGet<Assignee[]>(`/${kind}/assignees`, {
        params: { departmentId: departmentId ?? undefined },
      }),
    enabled,
  });

export const useDigest = () =>
  useQuery({
    queryKey: ['notification-digest'],
    queryFn: () => apiGet<{ enabled: boolean; lastSentAt: string | null }>('/notifications/digest'),
  });
export const useSaveDigest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      apiPut<{ enabled: boolean; lastSentAt: string | null }>('/notifications/digest', { enabled }),
    onSuccess: (data) => qc.setQueryData(['notification-digest'], data),
  });
};
