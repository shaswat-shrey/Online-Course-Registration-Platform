import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  FILE_LIMITS,
  type DocumentVisibility,
  type SearchType,
  type SettingKey,
} from '@ucrams/shared';
import { ApiError } from '@/services/api-error';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/services/http';

export const platformKeys = {
  search: (q: string) => ['platform', 'search', q] as const,
  settings: ['platform', 'settings'] as const,
  publicSettings: ['platform', 'settings', 'public'] as const,
  jobs: ['platform', 'jobs'] as const,
  documents: ['platform', 'documents'] as const,
};

// ----- search ----------------------------------------------------------------------

export interface SearchHit {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string | null;
}
export interface SearchResult {
  q: string;
  total: number;
  groups: { type: SearchType; items: SearchHit[] }[];
}

export function useGlobalSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: platformKeys.search(term),
    queryFn: () => apiGet<SearchResult>('/search', { params: { q: term } }),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

// ----- settings --------------------------------------------------------------------

export interface SettingRow {
  key: SettingKey;
  value: unknown;
  default: unknown;
  label: string;
  description: string;
  updatedAt: string | null;
}

export const useSettings = () =>
  useQuery({ queryKey: platformKeys.settings, queryFn: () => apiGet<SettingRow[]>('/settings') });

export const usePublicSettings = () =>
  useQuery({
    queryKey: platformKeys.publicSettings,
    queryFn: () => apiGet<{ 'portal.bannerMessage'?: string | null }>('/settings/public'),
    staleTime: 5 * 60_000,
  });

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: SettingKey; value: unknown }) =>
      apiPatch<SettingRow>(`/settings/${key}`, { value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.settings }),
  });
}

// ----- background jobs ------------------------------------------------------------------

export interface JobsOverview {
  workerHeartbeat: string | null;
  queues: {
    queue: string;
    waiting?: number;
    active?: number;
    delayed?: number;
    failed?: number;
    completed?: number;
  }[];
  failed: {
    queue: string;
    id: string;
    name: string;
    reason: string;
    attempts: number;
    failedAt: string | null;
    createdAt: string;
  }[];
}

export const useJobs = () =>
  useQuery({
    queryKey: platformKeys.jobs,
    queryFn: () => apiGet<JobsOverview>('/jobs'),
    refetchInterval: 15_000,
  });

export function useJobAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      queue,
      id,
      action,
    }: {
      queue: string;
      id: string;
      action: 'retry' | 'remove';
    }) =>
      action === 'retry'
        ? apiPost(`/jobs/${encodeURIComponent(queue)}/${encodeURIComponent(id)}/retry`)
        : apiDelete(`/jobs/${encodeURIComponent(queue)}/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.jobs }),
  });
}

// ----- documents ------------------------------------------------------------------------

export interface DocumentItem {
  id: string;
  title: string;
  description: string | null;
  category: string;
  visibility: DocumentVisibility;
  department: { id: string; code: string; name: string } | null;
  file: { name: string; mimeType: string; sizeBytes: number };
  uploadedBy: string;
  createdAt: string;
  canManage: boolean;
}

export const useDocuments = (params: { q?: string; category?: string; manage?: boolean }) =>
  useQuery({
    queryKey: [...platformKeys.documents, params],
    queryFn: () =>
      apiGet<{ items: DocumentItem[]; categories: string[] }>('/documents', {
        params: {
          q: params.q || undefined,
          category: params.category || undefined,
          manage: params.manage ? 'true' : undefined,
        },
      }),
    placeholderData: keepPreviousData,
  });

async function uploadDocumentFile(file: File): Promise<string> {
  const limits = FILE_LIMITS.DOCUMENT;
  if (!(limits.mimeTypes as readonly string[]).includes(file.type))
    throw new ApiError(
      422,
      'FILE_TYPE_NOT_ALLOWED',
      'Choose a PDF, Word, Excel or PowerPoint file',
    );
  if (file.size > limits.maxBytes)
    throw new ApiError(422, 'FILE_TOO_LARGE', 'Documents must be at most 25 MB');
  const intent = await apiPost<{
    fileId: string;
    upload: { url: string; headers: Record<string, string> };
  }>('/files/upload-intents', {
    context: 'DOCUMENT',
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

export interface DocumentDraft {
  title: string;
  description: string;
  category: string;
  visibility: DocumentVisibility;
  departmentId: string | null;
  file: File;
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, ...rest }: DocumentDraft) => {
      const fileId = await uploadDocumentFile(file);
      return apiPost<DocumentItem>('/documents', { ...rest, fileId });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.documents }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/documents/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: platformKeys.documents }),
  });
}

export async function openDocument(id: string) {
  const link = await apiGet<{ url: string }>(`/documents/${id}/download`);
  window.open(link.url, '_blank', 'noopener');
}
