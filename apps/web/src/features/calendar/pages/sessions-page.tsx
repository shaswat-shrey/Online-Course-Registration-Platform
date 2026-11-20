import { CalendarRange, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { PageHeader } from '@/components/shared/page-header';
import { EntityStatus } from '@/components/shared/entity-status';
import { StatusBadge } from '@/components/shared/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RowActions } from '@/features/structure/components/row-actions';
import { useCan } from '@/store/auth-store';
import { formatDate } from '@/utils/timezone';
import {
  REGISTRATION_STATE,
  SESSION_TYPE_LABEL,
  useDeleteYear,
  useSessions,
  useYears,
  type AcademicSession,
  type AcademicYear,
} from '../api/calendar-queries';
import { SessionDialog, YearDialog } from '../components/calendar-dialogs';

export function SessionsPage() {
  const sessions = useSessions();
  const years = useYears();
  const removeYear = useDeleteYear();
  const canManage = useCan('session:manage');
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Academic calendar"
        description="Academic years, sessions (terms) and their registration windows."
        actions={
          canManage ? (
            <SessionDialog
              onSaved={(s) => navigate(`/admin/academic-sessions/${s.id}`)}
              trigger={(open) => (
                <Button onClick={open}>
                  <Plus className="size-4" /> New session
                </Button>
              )}
            />
          ) : undefined
        }
      />
      <div className="grid gap-6 [&>*]:min-w-0">
        <DataTable<AcademicSession>
          caption="Academic sessions"
          isLoading={sessions.isPending}
          error={sessions.error}
          onRetry={() => void sessions.refetch()}
          rows={sessions.data}
          rowKey={(s) => s.id}
          onRowClick={(s) => navigate(`/admin/academic-sessions/${s.id}`)}
          emptyTitle="No sessions yet"
          emptyDescription="Create an academic year, then add its sessions."
          columns={[
            {
              key: 'name',
              header: 'Session',
              cell: (s) => (
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    {s.name} {s.isCurrent && <StatusBadge tone="info">Current</StatusBadge>}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{s.code}</p>
                </div>
              ),
            },
            {
              key: 'type',
              header: 'Type',
              cell: (s) => SESSION_TYPE_LABEL[s.type],
              hideOnMobile: true,
            },
            { key: 'year', header: 'Year', cell: (s) => s.academicYear.label, hideOnMobile: true },
            {
              key: 'dates',
              header: 'Dates',
              cell: (s) => (
                <span className="whitespace-nowrap text-sm">
                  {formatDate(s.startDate)} – {formatDate(s.endDate)}
                </span>
              ),
              hideOnMobile: true,
            },
            { key: 'status', header: 'Status', cell: (s) => <EntityStatus status={s.status} /> },
            {
              key: 'registration',
              header: 'Registration',
              cell: (s) => (
                <StatusBadge tone={REGISTRATION_STATE[s.registrationState].tone}>
                  {REGISTRATION_STATE[s.registrationState].label}
                </StatusBadge>
              ),
              hideOnMobile: true,
            },
          ]}
        />
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarRange className="size-4 text-brand" /> Academic years
              </CardTitle>
              <CardDescription>Sessions must fall within their academic year.</CardDescription>
            </div>
            {canManage && (
              <YearDialog
                trigger={(open) => (
                  <Button size="sm" variant="outline" onClick={open}>
                    <Plus className="size-4" /> New year
                  </Button>
                )}
              />
            )}
          </CardHeader>
          <CardContent>
            <DataTable<AcademicYear>
              caption="Academic years"
              isLoading={years.isPending}
              error={years.error}
              rows={years.data}
              rowKey={(y) => y.id}
              emptyTitle="No academic years yet"
              columns={[
                {
                  key: 'label',
                  header: 'Year',
                  cell: (y) => <span className="font-medium">{y.label}</span>,
                },
                {
                  key: 'dates',
                  header: 'Dates',
                  cell: (y) => `${formatDate(y.startDate)} – ${formatDate(y.endDate)}`,
                },
                { key: 'sessions', header: 'Sessions', cell: (y) => y.sessionCount },
                {
                  key: 'actions',
                  header: '',
                  cell: (y) =>
                    canManage ? (
                      <YearDialog
                        entity={y}
                        trigger={(open) => (
                          <RowActions
                            label={y.label}
                            onEdit={open}
                            onDelete={() => removeYear.mutateAsync(y.id)}
                          />
                        )}
                      />
                    ) : null,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
