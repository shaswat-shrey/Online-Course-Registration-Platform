import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiGetPage, apiPost, http } from '@/services/http';
import type { ApiSuccess } from '@ucrams/shared';

export interface ImportJob {
  id: string;
  kind: 'STUDENTS' | 'FACULTY';
  status: 'PREVIEW' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  fileName: string;
  sendInvites: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdRows: number;
  failedRows: number;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface ImportRow {
  rowNumber: number;
  status: 'VALID' | 'INVALID' | 'CREATED' | 'FAILED';
  email: string | null;
  name: string | null;
  reference: string | null;
  errors: Array<{ field: string; message: string }>;
  userId: string | null;
}

const RUNNING = new Set(['QUEUED', 'PROCESSING']);

/** Polls every 2 s while the job runs. */
export const useImport = (id: string) =>
  useQuery({
    queryKey: ['imports', id],
    queryFn: () => apiGet<ImportJob>(`/imports/${id}`),
    refetchInterval: (q) => (q.state.data && RUNNING.has(q.state.data.status) ? 2000 : false),
  });

export const useImportRows = (
  id: string,
  status: string,
  page: number,
  refreshKey: string,
  enabled: boolean,
) =>
  useQuery({
    enabled,
    queryKey: ['imports', id, 'rows', status, page, refreshKey],
    queryFn: () =>
      apiGetPage<ImportRow>(`/imports/${id}/rows`, {
        params: { status: status || undefined, page, limit: 25 },
      }),
  });

export const useRecentImports = () =>
  useQuery({ queryKey: ['imports', 'recent'], queryFn: () => apiGet<ImportJob[]>('/imports') });

export function usePreviewImport() {
  return useMutation({
    mutationFn: async ({ kind, file }: { kind: 'students' | 'faculty'; file: File }) => {
      const body = new FormData();
      body.append('file', file);
      const res = await http.post<ApiSuccess<ImportJob>>(`/imports/${kind}/preview`, body);
      return res.data.data;
    },
  });
}

export function useCommitImport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sendInvites: boolean) =>
      apiPost<ImportJob>(`/imports/${id}/commit`, { sendInvites }),
    onSuccess: (job) => {
      qc.setQueryData(['imports', id], job);
      void qc.invalidateQueries({ queryKey: ['people'] });
    },
  });
}

export function useCancelImport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<ImportJob>(`/imports/${id}/cancel`),
    onSuccess: (job) => qc.setQueryData(['imports', id], job),
  });
}
