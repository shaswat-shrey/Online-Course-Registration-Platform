import { Plus } from 'lucide-react';
import { EntityStatus } from '@/components/shared/entity-status';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { useCan } from '@/store/auth-store';
import { useDegrees, useDeleteDegree } from '../api/structure-queries';
import { DEGREE_LEVEL_LABEL, type Degree } from '../api/types';
import { DegreeDialog } from '../components/entity-dialogs';
import { RowActions } from '../components/row-actions';

export function DegreesPage() {
  const degrees = useDegrees();
  const canManage = useCan('degree:manage');
  const remove = useDeleteDegree();
  return (
    <>
      <PageHeader
        title="Degrees"
        description="Credential types awarded by programs (B.Tech, B.Sc., LL.B., Ph.D.)."
        actions={
          canManage ? (
            <DegreeDialog
              trigger={(open) => (
                <Button onClick={open}>
                  <Plus className="size-4" /> New degree
                </Button>
              )}
            />
          ) : undefined
        }
      />
      <DataTable<Degree>
        caption="Degrees"
        isLoading={degrees.isPending}
        error={degrees.error}
        onRetry={() => void degrees.refetch()}
        rows={degrees.data}
        rowKey={(d) => d.id}
        emptyTitle="No degrees yet"
        columns={[
          {
            key: 'name',
            header: 'Degree',
            cell: (d) => <span className="font-medium">{d.name}</span>,
          },
          {
            key: 'code',
            header: 'Code',
            cell: (d) => <span className="font-mono text-xs">{d.code}</span>,
          },
          {
            key: 'level',
            header: 'Level',
            cell: (d) => DEGREE_LEVEL_LABEL[d.level] ?? d.level,
            hideOnMobile: true,
          },
          {
            key: 'programs',
            header: 'Programs',
            cell: (d) => <span className="tabular-nums">{d.programCount}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (d) => <EntityStatus status={d.status} />,
            hideOnMobile: true,
          },
          {
            key: 'actions',
            header: '',
            cell: (d) =>
              canManage ? (
                <DegreeDialog
                  entity={d}
                  trigger={(open) => (
                    <RowActions
                      label={d.name}
                      onEdit={open}
                      onDelete={() => remove.mutateAsync(d.id)}
                    />
                  )}
                />
              ) : null,
          },
        ]}
      />
    </>
  );
}
