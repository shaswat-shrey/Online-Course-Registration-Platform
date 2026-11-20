import { RotateCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { errorMessage } from '@/services/api-error';
import { useCan } from '@/store/auth-store';
import { useJobAction, useJobs } from '../api/platform-queries';

const STALE_HEARTBEAT_MS = 2 * 60_000;

/** Background queues: counts, worker heartbeat, failed jobs with retry/remove. */
export function JobsPage() {
  const jobs = useJobs();
  const action = useJobAction();
  const canManage = useCan('jobs:manage');
  const run = (queue: string, id: string, kind: 'retry' | 'remove') =>
    action.mutate(
      { queue, id, action: kind },
      {
        onSuccess: () => toast.success(kind === 'retry' ? 'Job queued again' : 'Job removed'),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  if (jobs.isPending) return <LoadingRows />;
  if (jobs.isError) return <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />;
  const d = jobs.data;
  const beat = d.workerHeartbeat ? new Date(d.workerHeartbeat) : null;
  // Compared with when the data was fetched (refreshed every 15 s), keeping render pure.
  const alive = beat && jobs.dataUpdatedAt - beat.getTime() < STALE_HEARTBEAT_MS;
  return (
    <>
      <PageHeader
        title="Background jobs"
        description="Email, notifications, exports, imports and maintenance run in the worker."
        actions={
          <StatusBadge tone={alive ? 'success' : 'danger'}>
            {alive
              ? 'Worker running'
              : beat
                ? `Worker last seen ${beat.toLocaleTimeString()}`
                : 'Worker not seen'}
          </StatusBadge>
        }
      />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Queues</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead className="text-right">Waiting</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Delayed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.queues.map((q) => (
                <TableRow key={q.queue}>
                  <TableCell className="font-mono text-xs">{q.queue}</TableCell>
                  <TableCell className="text-right tabular-nums">{q.waiting ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{q.active ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{q.delayed ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{q.failed ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{q.completed ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <h2 className="mb-3 text-lg font-semibold">Recent failures</h2>
      {d.failed.length === 0 ? (
        <EmptyState
          title="No failed jobs"
          description="Failures appear here after their last retry."
        />
      ) : (
        <ul className="grid gap-3">
          {d.failed.map((j) => (
            <li key={`${j.queue}:${j.id}`} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {j.name}{' '}
                    <span className="font-mono text-xs text-muted-foreground">{j.queue}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {j.attempts} attempt{j.attempts === 1 ? '' : 's'}
                    {j.failedAt && ` · failed ${new Date(j.failedAt).toLocaleString()}`}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() => run(j.queue, j.id, 'retry')}
                    >
                      <RotateCw className="size-4" /> Retry
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="outline" disabled={action.isPending}>
                          <Trash2 className="size-4" /> Remove
                        </Button>
                      }
                      title="Remove this failed job?"
                      description="It will not be retried."
                      confirmLabel="Remove"
                      destructive
                      onConfirm={() => run(j.queue, j.id, 'remove')}
                    />
                  </div>
                )}
              </div>
              <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
                {j.reason}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
