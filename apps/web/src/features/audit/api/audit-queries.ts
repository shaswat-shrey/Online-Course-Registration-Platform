import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGetPage } from '@/services/http';

export interface AuditEntryDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: unknown;
  actor: { id: string; name: string; email: string } | null;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface AuditFilters {
  page: number;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
}

export function useAuditLog(filters: AuditFilters) {
  return useQuery({
    queryKey: ['audit', filters],
    queryFn: () =>
      apiGetPage<AuditEntryDto>('/audit-logs', {
        params: {
          page: filters.page,
          limit: 25,
          action: filters.action || undefined,
          entityType: filters.entityType || undefined,
          from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
          to: filters.to ? new Date(`${filters.to}T23:59:59.999`).toISOString() : undefined,
        },
      }),
    placeholderData: keepPreviousData,
  });
}
