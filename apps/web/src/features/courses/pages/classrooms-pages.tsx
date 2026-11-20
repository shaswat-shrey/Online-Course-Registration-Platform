import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { CLASSROOM_TYPES } from '@ucrams/shared';
import { DetailList } from '@/components/shared/detail-list';
import { EntityStatus, STATUS_OPTIONS } from '@/components/shared/entity-status';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { WeekGrid } from '@/components/shared/week-grid';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useListParams } from '@/hooks/use-list-params';
import { useSessions } from '@/features/calendar/api/calendar-queries';
import { useCampuses } from '@/features/structure/api/structure-queries';
import { RowActions } from '@/features/structure/components/row-actions';
import { useCan } from '@/store/auth-store';
import {
  useClassroom,
  useClassrooms,
  useClassroomSchedule,
  useDeleteClassroom,
} from '../api/courses-queries';
import { CLASSROOM_TYPE_LABEL, type Classroom } from '../api/types';
import { ClassroomDialog } from '../components/section-dialogs';

const FILTERS = ['campusId', 'type', 'status'] as const;

export function ClassroomsPage() {
  const { page, q, filters, update } = useListParams(FILTERS);
  const rooms = useClassrooms({ page, q, limit: 25, ...filters });
  const campuses = useCampuses();
  const canManage = useCan('classroom:manage');
  const remove = useDeleteClassroom();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Classrooms"
        description="Rooms available for scheduling, with capacity and equipment."
        actions={
          canManage ? (
            <ClassroomDialog
              trigger={(open) => (
                <Button onClick={open}>
                  <Plus className="size-4" /> New classroom
                </Button>
              )}
            />
          ) : undefined
        }
      />
      <ListToolbar>
        <SearchInput
          value={q}
          onChange={(v) => update({ q: v })}
          placeholder="Building, room or name"
          label="Search classrooms"
        />
        <FilterSelect
          label="Campus"
          value={filters.campusId}
          onChange={(v) => update({ campusId: v })}
          options={(campuses.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          allLabel="All campuses"
        />
        <FilterSelect
          label="Type"
          value={filters.type}
          onChange={(v) => update({ type: v })}
          options={CLASSROOM_TYPES.map((t) => ({ value: t, label: CLASSROOM_TYPE_LABEL[t]! }))}
          allLabel="All types"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          options={STATUS_OPTIONS}
          allLabel="All statuses"
        />
      </ListToolbar>
      <DataTable<Classroom>
        caption="Classrooms"
        isLoading={rooms.isPending}
        error={rooms.error}
        onRetry={() => void rooms.refetch()}
        rows={rooms.data?.data}
        meta={rooms.data?.meta && 'total' in rooms.data.meta ? rooms.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/admin/classrooms/${r.id}`)}
        emptyTitle={
          Object.values(filters).some(Boolean) || q ? 'No matching classrooms' : 'No classrooms yet'
        }
        columns={[
          {
            key: 'room',
            header: 'Room',
            cell: (r) => (
              <div>
                <p className="font-medium">{r.label}</p>
                <p className="text-xs text-muted-foreground">{r.campus.name}</p>
              </div>
            ),
          },
          {
            key: 'type',
            header: 'Type',
            cell: (r) => CLASSROOM_TYPE_LABEL[r.type],
            hideOnMobile: true,
          },
          {
            key: 'capacity',
            header: 'Seats',
            cell: (r) => <span className="tabular-nums">{r.capacity}</span>,
          },
          {
            key: 'equipment',
            header: 'Equipment',
            cell: (r) => <span className="text-xs">{r.equipment.join(', ') || '—'}</span>,
            hideOnMobile: true,
          },
          { key: 'status', header: 'Status', cell: (r) => <EntityStatus status={r.status} /> },
          {
            key: 'actions',
            header: '',
            cell: (r) =>
              canManage ? (
                <ClassroomDialog
                  classroom={r}
                  trigger={(open) => (
                    <RowActions
                      label={r.label}
                      onEdit={open}
                      onDelete={() =>
                        remove.mutateAsync(r.id).then(() => toast.success('Classroom deleted'))
                      }
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

export function ClassroomDetailPage() {
  const { classroomId = '' } = useParams();
  const room = useClassroom(classroomId);
  const sessions = useSessions();
  const canManage = useCan('classroom:manage');
  const all = sessions.data ?? [];
  const [chosen, setChosen] = useState('');
  const sessionId = chosen || all.find((s) => s.status === 'ACTIVE')?.id || all[0]?.id || '';
  const schedule = useClassroomSchedule(classroomId, sessionId);
  if (room.isPending) return <LoadingRows rows={4} />;
  if (room.isError) return <ErrorState error={room.error} onRetry={() => void room.refetch()} />;
  const r = room.data;
  return (
    <>
      <PageHeader
        title={r.label}
        description={
          <span className="flex items-center gap-2">
            {r.campus.name} · {CLASSROOM_TYPE_LABEL[r.type]} <EntityStatus status={r.status} />
          </span>
        }
        actions={
          canManage ? (
            <ClassroomDialog
              classroom={r}
              trigger={(open) => (
                <Button variant="outline" onClick={open}>
                  <Pencil className="size-4" /> Edit
                </Button>
              )}
            />
          ) : undefined
        }
      />
      <div className="grid gap-6 lg:grid-cols-4 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              columns={1}
              items={[
                { label: 'Seats', value: r.capacity },
                { label: 'Equipment', value: r.equipment.join(', ') || '—' },
                { label: 'Scheduled meetings', value: r.meetingCount },
              ]}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">Weekly occupancy</CardTitle>
            <FilterSelect
              label="Session"
              value={sessionId}
              onChange={setChosen}
              options={all.map((s) => ({ value: s.id, label: s.name }))}
              allLabel="Choose a session"
            />
          </CardHeader>
          <CardContent>
            {schedule.isPending ? (
              <LoadingRows rows={3} />
            ) : schedule.isError ? (
              <ErrorState error={schedule.error} onRetry={() => void schedule.refetch()} />
            ) : (
              <WeekGrid
                caption={`Occupancy of ${r.label}`}
                items={schedule.data.map((b) => ({
                  id: b.id,
                  dayOfWeek: b.dayOfWeek,
                  startMinute: b.startMinute,
                  endMinute: b.endMinute,
                  title: `${b.section.course.code} ${b.section.sectionCode}`,
                  subtitle: b.section.course.title,
                  href: `/admin/sections/${b.section.id}`,
                  muted: b.section.status === 'DRAFT',
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
