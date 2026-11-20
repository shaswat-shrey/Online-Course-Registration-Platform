import { ArrowUpCircle, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { meetingLabel } from '@/features/courses/components/section-dialogs';
import { errorMessage } from '@/services/api-error';
import { useCan } from '@/store/auth-store';
import {
  usePromoteNow,
  useRegistrations,
  useSectionRegistrations,
  useStudentRecords,
} from '../api/registration-queries';
import type { Registration } from '../api/types';
import {
  DecisionDialog,
  RegisterOnBehalfDialog,
  RegistrationActionDialog,
  RegistrationStatusBadge,
} from './registration-dialogs';

/** Seat holders and the ordered waitlist of a section (FR-ADMIN-023). */
export function SectionRegistrationsCard({
  section,
}: {
  section: {
    id: string;
    status: string;
    sectionCode: string;
    course: { code: string; title: string };
    session: { id: string };
  };
}) {
  const canRead = useCan('registration:read');
  const data = useSectionRegistrations(section.id, canRead);
  const promote = usePromoteNow();
  const navigate = useNavigate();
  if (!canRead) return null;
  if (data.isPending) return <LoadingRows rows={3} />;
  if (data.isError) return <ErrorState error={data.error} onRetry={() => void data.refetch()} />;
  const d = data.data;
  const free = d.capacity - d.enrolledCount;
  const studentCell = (r: Registration) => (
    <div className="min-w-0">
      <p className="font-medium">{r.student.name}</p>
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{r.student.studentNumber}</span> · {r.student.program.code} ·
        Year {r.student.yearOfStudy}
      </p>
    </div>
  );
  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Registrations</CardTitle>
          <CardDescription>
            {d.enrolledCount} of {d.capacity} seats taken · {d.waitlistCount} waitlisted
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.canManageWaitlist && d.waitlist.length > 0 && free > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={promote.isPending}
              onClick={() =>
                promote.mutate(section.id, {
                  onSuccess: (r) =>
                    toast.success(
                      `${r.promoted} promoted${r.skipped ? `, ${r.skipped} no longer eligible` : ''}`,
                    ),
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              <ArrowUpCircle className="size-4" /> Promote from waitlist
            </Button>
          )}
          {d.canManage && section.status === 'PUBLISHED' && (
            <RegisterOnBehalfDialog
              section={{
                value: section.id,
                label: `${section.course.code} ${section.sectionCode} · ${section.course.title}`,
              }}
              sessionId={section.session.id}
              trigger={(open) => (
                <Button size="sm" onClick={open}>
                  <UserPlus className="size-4" /> Register a student
                </Button>
              )}
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <DataTable<Registration>
          caption="Seat holders"
          isLoading={false}
          rows={d.seats}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/admin/registrations/${r.id}`)}
          emptyTitle="No one registered yet"
          columns={[
            { key: 'student', header: 'Student', cell: studentCell },
            {
              key: 'status',
              header: 'Status',
              cell: (r) => <RegistrationStatusBadge status={r.status} />,
            },
            {
              key: 'actions',
              header: '',
              cell: (r) =>
                r.status === 'PENDING' && d.canApprove ? (
                  <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <DecisionDialog
                      registration={r}
                      decision="APPROVE"
                      trigger={(open) => (
                        <Button size="sm" variant="outline" onClick={open}>
                          Approve
                        </Button>
                      )}
                    />
                    <DecisionDialog
                      registration={r}
                      decision="REJECT"
                      trigger={(open) => (
                        <Button size="sm" variant="ghost" onClick={open}>
                          Reject
                        </Button>
                      )}
                    />
                  </div>
                ) : null,
            },
          ]}
        />
        {d.waitlist.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-medium">Waitlist</h3>
            <DataTable<Registration>
              caption="Waitlist"
              isLoading={false}
              rows={d.waitlist}
              rowKey={(r) => r.id}
              emptyTitle="Empty"
              columns={[
                {
                  key: 'pos',
                  header: '#',
                  cell: (r) => <span className="tabular-nums">{r.waitlistPosition}</span>,
                },
                { key: 'student', header: 'Student', cell: studentCell },
                {
                  key: 'actions',
                  header: '',
                  cell: (r) =>
                    d.canManageWaitlist || d.canManage ? (
                      <RegistrationActionDialog
                        registration={r}
                        action="drop"
                        trigger={(open) => (
                          <Button size="sm" variant="ghost" onClick={open}>
                            Remove
                          </Button>
                        )}
                      />
                    ) : null,
                },
              ]}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A student's registrations and academic record, for the student detail page. */
export function StudentRegistrationsPanel({
  student,
}: {
  student: { id: string; name: string; studentNumber: string };
}) {
  const canRead = useCan('registration:read');
  const canRecords = useCan('record:read');
  const canManage = useCan('registration:manage');
  const regs = useRegistrations({ studentId: student.id, limit: 100 }, canRead);
  const records = useStudentRecords(student.id, canRecords);
  const navigate = useNavigate();
  const active = (regs.data?.data ?? []).filter((r) =>
    ['PENDING', 'REGISTERED', 'WAITLISTED', 'OFFERED'].includes(r.status),
  );
  const past = (regs.data?.data ?? []).filter(
    (r) => !['PENDING', 'REGISTERED', 'WAITLISTED', 'OFFERED'].includes(r.status),
  );
  const columns = [
    {
      key: 'course',
      header: 'Course',
      cell: (r: Registration) => (
        <div className="min-w-0">
          <p className="font-medium">
            <span className="font-mono">
              {r.course.code} {r.section.sectionCode}
            </span>{' '}
            · {r.course.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {r.section.meetings.map(meetingLabel).join(', ') || 'No meetings'}
          </p>
        </div>
      ),
    },
    {
      key: 'session',
      header: 'Session',
      cell: (r: Registration) => r.session.name,
      hideOnMobile: true,
    },
    { key: 'credits', header: 'Credits', cell: (r: Registration) => r.credits, hideOnMobile: true },
    {
      key: 'status',
      header: 'Status',
      cell: (r: Registration) => <RegistrationStatusBadge status={r.status} />,
    },
  ];
  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      {canRead && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Current registrations</CardTitle>
              <CardDescription>Seats, pending requests and waitlist places.</CardDescription>
            </div>
            {canManage && (
              <RegisterOnBehalfDialog
                student={{ value: student.id, label: `${student.name} (${student.studentNumber})` }}
                trigger={(open) => (
                  <Button size="sm" onClick={open}>
                    <UserPlus className="size-4" /> Register
                  </Button>
                )}
              />
            )}
          </CardHeader>
          <CardContent>
            <DataTable<Registration>
              caption="Current registrations"
              isLoading={regs.isPending}
              error={regs.error}
              rows={active}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/admin/registrations/${r.id}`)}
              emptyTitle="No active registrations"
              columns={columns}
            />
          </CardContent>
        </Card>
      )}
      {canRecords && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Academic record</CardTitle>
            <CardDescription>
              {records.data
                ? `${records.data.creditsEarned} credits earned${records.data.cgpa !== null ? ` · CGPA ${records.data.cgpa.toFixed(2)}` : ''}`
                : 'Completed courses'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {records.isPending ? (
              <LoadingRows rows={3} />
            ) : records.isError ? (
              <ErrorState error={records.error} onRetry={() => void records.refetch()} />
            ) : records.data.records.length === 0 ? (
              <p className="text-sm text-muted-foreground">No completed courses yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {records.data.records.map((rec) => (
                  <li
                    key={rec.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span>
                      <span className="font-mono">{rec.courseCode}</span> · {rec.courseTitle}
                      <span className="block text-xs text-muted-foreground">
                        {rec.session?.name ?? rec.source.toLowerCase()}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {rec.gradeLetter ?? '—'} · {rec.creditsEarned}/{rec.creditsAttempted} cr
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
      {canRead && past.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Past attempts</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable<Registration>
              caption="Past registrations"
              isLoading={false}
              rows={past}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/admin/registrations/${r.id}`)}
              emptyTitle="None"
              columns={columns}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
