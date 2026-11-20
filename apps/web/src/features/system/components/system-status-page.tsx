import { Database, HardDrive, RotateCw, Server } from 'lucide-react';
import type { HealthStatus } from '@ucrams/shared';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useReadiness, useUniversity } from '../api/system-queries';

const CHECK_META: Record<string, { label: string; description: string; icon: typeof Server }> = {
  database: { label: 'Database', description: 'PostgreSQL system of record', icon: Database },
  redis: {
    label: 'Cache & queues',
    description: 'Redis: caching, rate limits, background jobs',
    icon: Server,
  },
  storage: {
    label: 'File storage',
    description: 'Course materials and documents',
    icon: HardDrive,
  },
};

const OVERALL: Record<
  HealthStatus['status'],
  { tone: StatusTone; label: string; summary: string }
> = {
  ok: { tone: 'success', label: 'Operational', summary: 'All systems are operational.' },
  degraded: {
    tone: 'warning',
    label: 'Degraded',
    summary: 'Some services are impaired. Core features remain available.',
  },
  down: { tone: 'danger', label: 'Unavailable', summary: 'The platform is currently unavailable.' },
};

export function SystemStatusPage() {
  const university = useUniversity();
  const readiness = useReadiness();

  return (
    <div className="mx-auto w-full max-w-3xl py-8 sm:py-14">
      <div className="mb-8 space-y-2">
        <p className="text-sm font-medium text-brand">System status</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {university.data?.name ?? 'University platform'}
        </h1>
        <p className="text-muted-foreground">
          Course registration and academic management platform health.
        </p>
      </div>

      {readiness.isPending ? (
        <LoadingRows rows={4} />
      ) : readiness.isError ? (
        <ErrorState
          title="Status unavailable"
          error={readiness.error}
          onRetry={() => void readiness.refetch()}
        />
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-3">
                Platform
                <StatusBadge tone={OVERALL[readiness.data.status].tone}>
                  {OVERALL[readiness.data.status].label}
                </StatusBadge>
              </CardTitle>
              <CardDescription>{OVERALL[readiness.data.status].summary}</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void readiness.refetch()}
              disabled={readiness.isFetching}
            >
              <RotateCw className={readiness.isFetching ? 'size-4 animate-spin' : 'size-4'} />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {Object.entries(readiness.data.checks).map(([name, check]) => {
                const meta = CHECK_META[name] ?? { label: name, description: '', icon: Server };
                const Icon = meta.icon;
                return (
                  <li key={name} className="flex items-center gap-4 px-4 py-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{meta.label}</p>
                      <p className="truncate text-xs text-muted-foreground">{meta.description}</p>
                    </div>
                    {check.latencyMs !== undefined && (
                      <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">
                        {check.latencyMs} ms
                      </span>
                    )}
                    <StatusBadge tone={check.status === 'up' ? 'success' : 'danger'}>
                      {check.status === 'up' ? 'Up' : 'Down'}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">
              Version {readiness.data.version} · Last checked{' '}
              <time dateTime={new Date(readiness.dataUpdatedAt).toISOString()}>
                {new Date(readiness.dataUpdatedAt).toLocaleTimeString()}
              </time>{' '}
              · refreshes every 30 seconds
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
