import { useQuery } from '@tanstack/react-query';
import type { ApiSuccess, HealthStatus } from '@ucrams/shared';
import { apiGet, http } from '@/services/http';

export interface PublicUniversity {
  id: string;
  name: string;
  shortName: string;
  timezone: string;
  schoolLabel: string;
  website: string | null;
  contactEmail: string | null;
}

export const systemKeys = {
  university: ['system', 'university'] as const,
  readiness: ['system', 'readiness'] as const,
};

export function useUniversity() {
  return useQuery({
    queryKey: systemKeys.university,
    queryFn: () => apiGet<PublicUniversity>('/university/public'),
    staleTime: 10 * 60_000,
  });
}

/** Readiness returns 503 with a body when down; accept it so the checks can be shown. */
export async function fetchReadiness(): Promise<HealthStatus> {
  const res = await http.get<ApiSuccess<HealthStatus>>('/health/ready', {
    validateStatus: (status) => status === 200 || status === 503,
  });
  return res.data.data;
}

export function useReadiness() {
  return useQuery({
    queryKey: systemKeys.readiness,
    queryFn: fetchReadiness,
    refetchInterval: 30_000,
    staleTime: 0,
  });
}
