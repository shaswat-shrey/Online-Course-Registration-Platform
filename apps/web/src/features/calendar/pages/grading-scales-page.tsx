import { Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EntityStatus } from '@/components/shared/entity-status';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useDeleteScale, useGradingScales } from '../api/calendar-queries';
import { GradingScaleDialog } from '../components/calendar-dialogs';

export function GradingScalesPage() {
  const scales = useGradingScales();
  const canManage = useCan('grading_scale:manage');
  const remove = useDeleteScale();
  return (
    <>
      <PageHeader
        title="Grading scales"
        description="Grade bands and grade points used by sessions. No scale is assumed: sessions use the scale you assign."
        actions={
          canManage ? (
            <GradingScaleDialog
              trigger={(open) => (
                <Button onClick={open}>
                  <Plus className="size-4" /> New scale
                </Button>
              )}
            />
          ) : undefined
        }
      />
      {scales.isPending ? (
        <LoadingRows rows={4} />
      ) : scales.isError ? (
        <ErrorState error={scales.error} onRetry={() => void scales.refetch()} />
      ) : scales.data.length === 0 ? (
        <EmptyState title="No grading scales yet" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {scales.data.map((s) => (
            <Card key={s.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                <div className="min-w-0 space-y-1.5">
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    <EntityStatus status={s.status} />
                    <StatusBadge tone={s.hasGradePoints ? 'info' : 'neutral'}>
                      {s.hasGradePoints ? 'Computes GPA' : 'Pass/fail (no GPA)'}
                    </StatusBadge>
                    <span>Used by {s.sessionCount} session(s)</span>
                  </CardDescription>
                </div>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <GradingScaleDialog
                      entity={s}
                      trigger={(open) => (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${s.name}`}
                          onClick={open}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}
                    />
                    {s.sessionCount === 0 && (
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm">
                            Delete
                          </Button>
                        }
                        title={`Delete “${s.name}”?`}
                        description="This cannot be undone."
                        confirmLabel="Delete"
                        destructive
                        onConfirm={() =>
                          remove.mutate(s.id, {
                            onSuccess: () => toast.success('Scale deleted'),
                            onError: (e) => toast.error(errorMessage(e)),
                          })
                        }
                      />
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {s.description && (
                  <p className="mb-3 text-sm text-muted-foreground">{s.description}</p>
                )}
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <caption className="sr-only">Grade bands of {s.name}</caption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Grade</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>Points</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.entries.map((e) => (
                        <TableRow key={e.letter}>
                          <TableCell className="font-semibold">{e.letter}</TableCell>
                          <TableCell className="tabular-nums">{e.minPercent}%</TableCell>
                          <TableCell className="tabular-nums">{e.gradePoints ?? '—'}</TableCell>
                          <TableCell>
                            {e.isPassing ? 'Pass' : 'Fail'}
                            {!e.countsInGpa && ' · not in GPA'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
