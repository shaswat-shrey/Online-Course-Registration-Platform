import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiGetPage, apiPost } from '@/services/http';
import type {
  AcademicRecords,
  Eligibility,
  Registration,
  RegistrationDetail,
  RegistrationRequest,
  SectionRegistrations,
} from './types';

type Params = Record<string, string | number | boolean | undefined>;
const clean = (p: Params) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined));

export const regKeys = {
  all: ['registrations'] as const,
  list: (p: object) => ['registrations', 'list', p] as const,
  one: (id: string) => ['registrations', 'one', id] as const,
  section: (id: string) => ['registrations', 'section', id] as const,
  requests: (p: object) => ['registrations', 'requests', p] as const,
  records: (studentId: string) => ['registrations', 'records', studentId] as const,
};

export const useRegistrations = (p: Params, enabled = true) =>
  useQuery({
    queryKey: regKeys.list(clean(p)),
    queryFn: () => apiGetPage<Registration>('/registrations', { params: clean(p) }),
    placeholderData: keepPreviousData,
    enabled,
  });
export const useRegistration = (id: string) =>
  useQuery({
    queryKey: regKeys.one(id),
    queryFn: () => apiGet<RegistrationDetail>(`/registrations/${id}`),
  });
export const useSectionRegistrations = (sectionId: string, enabled = true) =>
  useQuery({
    queryKey: regKeys.section(sectionId),
    queryFn: () => apiGet<SectionRegistrations>(`/course-sections/${sectionId}/registrations`),
    enabled,
  });
export const useRegistrationRequests = (p: Params, enabled = true) =>
  useQuery({
    queryKey: regKeys.requests(clean(p)),
    queryFn: () => apiGetPage<RegistrationRequest>('/registration-requests', { params: clean(p) }),
    enabled,
  });
export const useStudentRecords = (studentId: string, enabled = true) =>
  useQuery({
    queryKey: regKeys.records(studentId),
    queryFn: () => apiGet<AcademicRecords>(`/students/${studentId}/records`),
    enabled,
  });
export const useEligibility = (studentId: string, sectionId: string) =>
  useQuery({
    queryKey: ['registrations', 'eligibility', studentId, sectionId],
    queryFn: () =>
      apiGet<Eligibility>('/registrations/eligibility', { params: { studentId, sectionId } }),
    enabled: !!studentId && !!sectionId,
    staleTime: 0,
  });

/** Every registration write changes seats, so section and catalog views refresh too. */
function useRegMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: regKeys.all });
      void qc.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
}

export const useRegisterOnBehalf = () =>
  useRegMutation(
    (body: {
      studentId: string;
      sectionId: string;
      joinWaitlist: boolean;
      overrides: string[];
      reason: string | null;
    }) => apiPost<Registration>('/admin/registrations', body),
  );
export const useDecide = () =>
  useRegMutation(
    ({ id, ...body }: { id: string; decision: 'APPROVE' | 'REJECT'; note?: string | null }) =>
      apiPost<Registration>(`/registrations/${id}/decision`, body),
  );
export const useBulkDecide = () =>
  useRegMutation((body: { ids: string[]; decision: 'APPROVE' | 'REJECT'; note?: string | null }) =>
    apiPost<{
      succeeded: number;
      failed: number;
      results: Array<{ id: string; ok: boolean; error?: { message: string } }>;
    }>('/registrations/bulk-decision', body),
  );
export const useDecideRequest = () =>
  useRegMutation(
    ({ id, ...body }: { id: string; decision: 'APPROVE' | 'REJECT'; note?: string | null }) =>
      apiPost<Registration>(`/registration-requests/${id}/decision`, body),
  );
export const useDrop = () =>
  useRegMutation(
    ({
      id,
      ...body
    }: {
      id: string;
      reason: string | null;
      alsoDrop?: string[];
      overrides?: string[];
    }) => apiPost<Registration[]>(`/registrations/${id}/drop`, body),
  );
export const useWithdraw = () =>
  useRegMutation(({ id, ...body }: { id: string; reason: string | null; overrides?: string[] }) =>
    apiPost<Registration>(`/registrations/${id}/withdraw`, body),
  );
export const usePromoteNow = () =>
  useRegMutation((sectionId: string) =>
    apiPost<{ promoted: number; skipped: number }>(
      `/course-sections/${sectionId}/waitlist/promote`,
    ),
  );
