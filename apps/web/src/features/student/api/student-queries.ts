import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiGetPage, apiPost, apiPut, http } from '@/services/http';
import type { Eligibility, Registration } from '@/features/registrations/api/types';
import type {
  BatchResult,
  CatalogCourse,
  CatalogCourseDetail,
  CatalogSession,
  CoursePlan,
  HistoryData,
  MyRegistration,
  PlanValidation,
  ProgressData,
  StudentAnnouncement,
  StudentDashboardData,
  TimetableEntry,
} from './types';

type Params = Record<string, string | number | boolean | undefined>;
const clean = (p: Params) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined));

export const studentKeys = {
  all: ['student'] as const,
  sessions: ['student', 'catalog-sessions'] as const,
  catalog: (p: object) => ['student', 'catalog', p] as const,
  course: (id: string, sessionId: string) => ['student', 'course', id, sessionId] as const,
  dashboard: ['student', 'dashboard'] as const,
  registrations: (sessionId?: string) => ['student', 'registrations', sessionId ?? 'all'] as const,
  timetable: (sessionId: string) => ['student', 'timetable', sessionId] as const,
  progress: ['student', 'progress'] as const,
  history: ['student', 'history'] as const,
  announcements: ['student', 'announcements'] as const,
  plans: (sessionId: string) => ['student', 'plans', sessionId] as const,
  validation: (planId: string) => ['student', 'plan-validation', planId] as const,
};

export const useCatalogSessions = () =>
  useQuery({
    queryKey: studentKeys.sessions,
    queryFn: () => apiGet<CatalogSession[]>('/catalog/sessions'),
  });

/** The session students care about now: open for registration first, otherwise the latest with sections. */
export function useDefaultSession(explicit?: string | null) {
  const sessions = useCatalogSessions();
  const list = sessions.data ?? [];
  const chosen =
    list.find((s) => s.id === explicit) ??
    list.find((s) => s.registrationState === 'OPEN' || s.registrationState === 'LATE') ??
    list.find((s) => s.registrationState === 'UPCOMING') ??
    list.find((s) => s.status === 'ACTIVE') ??
    list.at(-1);
  return { sessions, list, session: chosen ?? null };
}

export const useCatalog = (p: Params, enabled: boolean) =>
  useQuery({
    queryKey: studentKeys.catalog(clean(p)),
    queryFn: () => apiGetPage<CatalogCourse>('/catalog', { params: clean(p) }),
    placeholderData: keepPreviousData,
    enabled,
  });
export const useCatalogCourse = (id: string, sessionId: string) =>
  useQuery({
    queryKey: studentKeys.course(id, sessionId),
    queryFn: () => apiGet<CatalogCourseDetail>(`/catalog/courses/${id}`, { params: { sessionId } }),
    enabled: !!sessionId,
  });
export const useStudentDashboard = () =>
  useQuery({
    queryKey: studentKeys.dashboard,
    queryFn: () => apiGet<StudentDashboardData>('/students/me/dashboard'),
  });
export const useMyRegistrations = (sessionId?: string) =>
  useQuery({
    queryKey: studentKeys.registrations(sessionId),
    queryFn: () =>
      apiGet<{ items: MyRegistration[]; seatCredits: number }>('/registrations/me', {
        params: clean({ sessionId }),
      }),
  });
export const useTimetable = (sessionId: string) =>
  useQuery({
    queryKey: studentKeys.timetable(sessionId),
    queryFn: () =>
      apiGet<{
        session: { id: string; name: string; startDate: string; endDate: string };
        entries: TimetableEntry[];
      }>('/students/me/timetable', {
        params: { sessionId },
      }),
    enabled: !!sessionId,
  });
export const useProgress = () =>
  useQuery({
    queryKey: studentKeys.progress,
    queryFn: () => apiGet<ProgressData>('/students/me/progress'),
  });
export const useHistory = () =>
  useQuery({
    queryKey: studentKeys.history,
    queryFn: () => apiGet<HistoryData>('/students/me/history'),
  });
export const useStudentAnnouncements = () =>
  useQuery({
    queryKey: studentKeys.announcements,
    queryFn: () => apiGet<StudentAnnouncement[]>('/students/me/announcements'),
  });
export const useMyEligibility = (sectionId: string | null) =>
  useQuery({
    queryKey: ['student', 'eligibility', sectionId],
    queryFn: () => apiGet<Eligibility>('/registrations/eligibility', { params: { sectionId } }),
    enabled: !!sectionId,
    staleTime: 0,
  });
export const usePlans = (sessionId: string) =>
  useQuery({
    queryKey: studentKeys.plans(sessionId),
    queryFn: () => apiGet<CoursePlan[]>('/course-plans', { params: { sessionId } }),
    enabled: !!sessionId,
  });
export const usePlanValidation = (planId: string | null) =>
  useQuery({
    queryKey: studentKeys.validation(planId ?? ''),
    queryFn: () => apiGet<PlanValidation>(`/course-plans/${planId}/validate`),
    enabled: !!planId,
    staleTime: 0,
  });

/** Registration writes change seats, credits, timetable and progress: refresh everything student-side. */
function useStudentMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: studentKeys.all });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/** Self-registration with an idempotency key so retries never double-register (FR-REG-015). */
export const useRegister = () =>
  useStudentMutation(
    ({ sectionId, joinWaitlist, key }: { sectionId: string; joinWaitlist: boolean; key: string }) =>
      http
        .post<{ data: Registration & { waitlistPosition: number | null } }>(
          '/registrations',
          { sectionId, joinWaitlist },
          { headers: { 'Idempotency-Key': key } },
        )
        .then((r) => r.data.data),
  );
export const useDropMine = () =>
  useStudentMutation(
    ({ id, reason, alsoDrop }: { id: string; reason?: string | null; alsoDrop?: string[] }) =>
      apiPost<Registration[]>(`/registrations/${id}/drop`, {
        reason: reason ?? null,
        alsoDrop: alsoDrop ?? [],
      }),
  );
export const useWithdrawMine = () =>
  useStudentMutation(({ id, reason }: { id: string; reason: string | null }) =>
    apiPost<Registration>(`/registrations/${id}/withdraw`, { reason }),
  );
export const useClaimOffer = () =>
  useStudentMutation((id: string) => apiPost(`/registrations/${id}/claim`));
export const useCreatePlan = () =>
  useStudentMutation((body: { sessionId: string; name: string }) =>
    apiPost<CoursePlan>('/course-plans', body),
  );
export const useSavePlanItems = () =>
  useStudentMutation(
    ({ id, items }: { id: string; items: Array<{ courseId: string; sectionId: string | null }> }) =>
      apiPut<CoursePlan>(`/course-plans/${id}/items`, { items }),
  );
export const useDeletePlan = () =>
  useStudentMutation((id: string) => apiDelete(`/course-plans/${id}`));
export const useRegisterPlan = () =>
  useStudentMutation((id: string) => apiPost<BatchResult>(`/course-plans/${id}/register`));

export async function downloadTimetableIcs(sessionId: string) {
  const res = await http.get<Blob>('/students/me/timetable.ics', {
    params: { sessionId },
    responseType: 'blob',
  });
  const name =
    /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ??
    'timetable.ics';
  const href = URL.createObjectURL(res.data);
  const a = Object.assign(document.createElement('a'), { href, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
