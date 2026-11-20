import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/services/http';

export interface AcademicYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  sessionCount: number;
}

export interface SessionPolicy {
  minCredits: number;
  maxCredits: number;
  maxCreditsWithOverride: number | null;
  approvalMode: string;
  waitlistEnabled: boolean;
  waitlistMaxPerSection: number | null;
  promotionMode: string;
  offerWindowHours: number;
  countWaitlistInCredits: boolean;
  allowInProgressPrereqs: boolean;
  withdrawalRequiresApproval: boolean;
}

export interface PriorityWindow {
  id: string;
  name: string;
  opensAt: string;
  program: { id: string; code: string; name: string } | null;
  yearOfStudy: number | null;
  cohort: string | null;
}

export interface RegistrationPeriod {
  id: string;
  opensAt: string;
  closesAt: string;
  lateClosesAt: string | null;
  addDropDeadline: string;
  withdrawalDeadline: string;
  priorityWindows: PriorityWindow[];
}

export type RegistrationState =
  'NOT_CONFIGURED' | 'UPCOMING' | 'OPEN' | 'LATE' | 'ADD_DROP' | 'CLOSED';

export interface AcademicSession {
  id: string;
  code: string;
  name: string;
  type: string;
  status: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  isCurrent: boolean;
  startDate: string;
  endDate: string;
  academicYear: { id: string; label: string };
  gradingScale: { id: string; name: string } | null;
  policy: SessionPolicy | null;
  registrationPeriod: RegistrationPeriod | null;
  registrationState: RegistrationState;
}

export interface GradeEntry {
  letter: string;
  minPercent: number;
  gradePoints: number | null;
  isPassing: boolean;
  countsInGpa: boolean;
}

export interface GradingScale {
  id: string;
  name: string;
  description: string | null;
  status: string;
  sessionCount: number;
  hasGradePoints: boolean;
  entries: GradeEntry[];
}

export const calendarKeys = {
  all: ['calendar'] as const,
  years: ['calendar', 'years'] as const,
  sessions: ['calendar', 'sessions'] as const,
  session: (id: string) => ['calendar', 'session', id] as const,
  scales: ['calendar', 'scales'] as const,
};

export const useYears = () =>
  useQuery({
    queryKey: calendarKeys.years,
    queryFn: () => apiGet<AcademicYear[]>('/academic-years'),
  });
export const useSessions = () =>
  useQuery({
    queryKey: calendarKeys.sessions,
    queryFn: () => apiGet<AcademicSession[]>('/academic-sessions'),
  });
export const useSession = (id: string) =>
  useQuery({
    queryKey: calendarKeys.session(id),
    queryFn: () => apiGet<AcademicSession>(`/academic-sessions/${id}`),
  });
export const useGradingScales = () =>
  useQuery({
    queryKey: calendarKeys.scales,
    queryFn: () => apiGet<GradingScale[]>('/grading-scales'),
  });

function useCalendarMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  });
}

export const useSaveYear = () =>
  useCalendarMutation(({ id, ...input }: { id?: string; [key: string]: unknown }) =>
    id
      ? apiPatch<AcademicYear>(`/academic-years/${id}`, input)
      : apiPost<AcademicYear>('/academic-years', input),
  );
export const useDeleteYear = () =>
  useCalendarMutation((id: string) => apiDelete(`/academic-years/${id}`));
export const useSaveSession = () =>
  useCalendarMutation(({ id, ...input }: { id?: string; [key: string]: unknown }) =>
    id
      ? apiPatch<AcademicSession>(`/academic-sessions/${id}`, input)
      : apiPost<AcademicSession>('/academic-sessions', input),
  );
export const useDeleteSession = () =>
  useCalendarMutation((id: string) => apiDelete(`/academic-sessions/${id}`));
export const useTransitionSession = (id: string) =>
  useCalendarMutation((action: string) =>
    apiPost<AcademicSession>(`/academic-sessions/${id}/transition`, { action }),
  );
export const useSavePolicy = (id: string) =>
  useCalendarMutation((input: object) =>
    apiPut<SessionPolicy>(`/academic-sessions/${id}/policy`, input),
  );
export const useSavePeriod = (id: string) =>
  useCalendarMutation((input: object) =>
    apiPut<AcademicSession>(`/academic-sessions/${id}/registration-period`, input),
  );
export const useAddWindow = (id: string) =>
  useCalendarMutation((input: object) =>
    apiPost<AcademicSession>(`/academic-sessions/${id}/priority-windows`, input),
  );
export const useRemoveWindow = (id: string) =>
  useCalendarMutation((windowId: string) =>
    apiDelete(`/academic-sessions/${id}/priority-windows/${windowId}`),
  );
export const useSaveScale = () =>
  useCalendarMutation(({ id, ...input }: { id?: string; [key: string]: unknown }) =>
    id
      ? apiPut<GradingScale>(`/grading-scales/${id}`, input)
      : apiPost<GradingScale>('/grading-scales', input),
  );
export const useDeleteScale = () =>
  useCalendarMutation((id: string) => apiDelete(`/grading-scales/${id}`));

export const SESSION_TYPE_LABEL: Record<string, string> = {
  FALL: 'Fall',
  SPRING: 'Spring',
  SUMMER: 'Summer',
  WINTER: 'Winter',
  TRIMESTER_1: 'Trimester 1',
  TRIMESTER_2: 'Trimester 2',
  TRIMESTER_3: 'Trimester 3',
  CUSTOM: 'Custom',
};

export const REGISTRATION_STATE: Record<
  RegistrationState,
  { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }
> = {
  NOT_CONFIGURED: { label: 'Not configured', tone: 'neutral' },
  UPCOMING: { label: 'Opens soon', tone: 'info' },
  OPEN: { label: 'Registration open', tone: 'success' },
  LATE: { label: 'Late registration', tone: 'warning' },
  ADD_DROP: { label: 'Add/drop period', tone: 'warning' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};
