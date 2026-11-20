import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { FILE_LIMITS } from '@ucrams/shared';
import { ApiError } from '@/services/api-error';
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost, http } from '@/services/http';
import type {
  Announcement,
  FacultyDashboard,
  Material,
  RosterEntry,
  SectionStudent,
  TeachingSection,
  Workspace,
} from './types';

export const teachingKeys = {
  all: ['teaching'] as const,
  dashboard: ['teaching', 'dashboard'] as const,
  sections: (scope: string) => ['teaching', 'sections', scope] as const,
  workspace: (id: string) => ['teaching', 'workspace', id] as const,
  roster: (id: string, p: object) => ['teaching', 'roster', id, p] as const,
  student: (sectionId: string, studentId: string) =>
    ['teaching', 'student', sectionId, studentId] as const,
  materials: (id: string) => ['teaching', 'materials', id] as const,
  announcements: (id: string) => ['teaching', 'announcements', id] as const,
  myAnnouncements: ['teaching', 'my-announcements'] as const,
};

export const useFacultyDashboard = () =>
  useQuery({
    queryKey: teachingKeys.dashboard,
    queryFn: () => apiGet<FacultyDashboard>('/faculty/me/dashboard'),
  });
export const useMySections = (scope: 'current' | 'upcoming' | 'past') =>
  useQuery({
    queryKey: teachingKeys.sections(scope),
    queryFn: () => apiGet<TeachingSection[]>('/faculty/me/sections', { params: { scope } }),
  });
export const useWorkspace = (id: string) =>
  useQuery({
    queryKey: teachingKeys.workspace(id),
    queryFn: () => apiGet<Workspace>(`/course-sections/${id}/workspace`),
  });
export const useRoster = (id: string, p: { page: number; q?: string; status?: string }) =>
  useQuery({
    queryKey: teachingKeys.roster(id, p),
    queryFn: () =>
      apiGetPage<RosterEntry>(`/course-sections/${id}/roster`, {
        params: { page: p.page, limit: 25, q: p.q || undefined, status: p.status || undefined },
      }),
    placeholderData: keepPreviousData,
  });
export const useSectionStudent = (sectionId: string, studentId: string | null) =>
  useQuery({
    queryKey: teachingKeys.student(sectionId, studentId ?? ''),
    queryFn: () => apiGet<SectionStudent>(`/course-sections/${sectionId}/students/${studentId}`),
    enabled: !!studentId,
  });
export const useMaterials = (id: string) =>
  useQuery({
    queryKey: teachingKeys.materials(id),
    queryFn: () =>
      apiGet<{ canManage: boolean; items: Material[] }>(`/course-sections/${id}/materials`),
  });
export const useSectionAnnouncements = (id: string) =>
  useQuery({
    queryKey: teachingKeys.announcements(id),
    queryFn: () =>
      apiGet<{ canPublish: boolean; items: Announcement[] }>(
        `/course-sections/${id}/announcements`,
      ),
  });
export const useMyAnnouncements = () =>
  useQuery({
    queryKey: teachingKeys.myAnnouncements,
    queryFn: () => apiGet<Announcement[]>('/announcements/mine'),
  });

function useTeachingMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: teachingKeys.all }),
  });
}

export const useCreateMaterial = (sectionId: string) =>
  useTeachingMutation((body: Record<string, unknown>) =>
    apiPost<Material>(`/course-sections/${sectionId}/materials`, body),
  );
export const useUpdateMaterial = () =>
  useTeachingMutation(({ id, ...body }: { id: string } & Record<string, unknown>) =>
    apiPatch<Material>(`/materials/${id}`, body),
  );
export const useDeleteMaterial = () =>
  useTeachingMutation((id: string) => apiDelete(`/materials/${id}`));
export const usePublishAnnouncement = () =>
  useTeachingMutation((body: Record<string, unknown>) =>
    apiPost<Announcement>('/announcements', body),
  );
export const useUpdateAnnouncement = () =>
  useTeachingMutation(({ id, ...body }: { id: string } & Record<string, unknown>) =>
    apiPatch<Announcement>(`/announcements/${id}`, body),
  );
export const useDeleteAnnouncement = () =>
  useTeachingMutation((id: string) => apiDelete(`/announcements/${id}`));

/** Opens a material: a signed download link for files, the URL itself for links. */
export async function openMaterial(id: string) {
  const { url } = await apiGet<{ url: string }>(`/materials/${id}/download`);
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Downloads the roster CSV through the authenticated client and saves it. */
export async function downloadRosterCsv(sectionId: string) {
  const res = await http.get<Blob>(`/course-sections/${sectionId}/roster/export`, {
    responseType: 'blob',
  });
  const name =
    /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ??
    'roster.csv';
  const href = URL.createObjectURL(res.data);
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

/** Uploads a course material file (MATERIAL context) and returns its file id. */
export async function uploadMaterialFile(file: File): Promise<string> {
  const limits = FILE_LIMITS.MATERIAL;
  if (!(limits.mimeTypes as readonly string[]).includes(file.type))
    throw new ApiError(
      422,
      'FILE_TYPE_NOT_ALLOWED',
      'Upload a PDF, Word, PowerPoint, Excel, image or ZIP file',
    );
  if (file.size > limits.maxBytes)
    throw new ApiError(422, 'FILE_TOO_LARGE', 'Files must be at most 50 MB');
  const intent = await apiPost<{
    fileId: string;
    upload: { url: string; headers: Record<string, string> };
  }>('/files/upload-intents', {
    context: 'MATERIAL',
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
