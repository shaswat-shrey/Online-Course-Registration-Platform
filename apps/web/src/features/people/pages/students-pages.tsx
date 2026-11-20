import { ArrowRightLeft, Ban, FileUp, Pencil, Plus, ShieldAlert } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailList } from '@/components/shared/detail-list';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { UserAvatar } from '@/components/shared/user-avatar';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useDepartmentOptions,
  usePrograms,
  useSchoolOptions,
} from '@/features/structure/api/structure-queries';
import { useListParams } from '@/hooks/use-list-params';
import { errorMessage } from '@/services/api-error';
import { StudentRegistrationsPanel } from '@/features/registrations/components/registration-panels';
import { useCan } from '@/store/auth-store';
import { formatDateTime } from '@/utils/format';
import { formatDate } from '@/utils/timezone';
import { useReleaseHold, useStudent, useStudents } from '../api/people-queries';
import { HOLD_LABEL, STUDENT_STATUS_LABEL, type StudentListItem } from '../api/types';
import { AccountCard } from '../components/account-card';
import {
  ChangeProgramDialog,
  ContactDialog,
  EditStudentDialog,
  HoldDialog,
  NewStudentDialog,
  StudentStatusDialog,
} from '../components/people-dialogs';
import { RolesCard } from '../components/roles-card';

export const STUDENT_TONE: Record<string, StatusTone> = {
  ACTIVE: 'success',
  ON_LEAVE: 'info',
  SUSPENDED: 'warning',
  GRADUATED: 'neutral',
  WITHDRAWN: 'neutral',
  DISMISSED: 'danger',
};

const FILTERS = [
  'schoolId',
  'departmentId',
  'programId',
  'yearOfStudy',
  'status',
  'hasHold',
] as const;

export function StudentsPage() {
  const { page, q, filters, update } = useListParams(FILTERS);
  const students = useStudents({ page, q, limit: 25, ...filters });
  const schools = useSchoolOptions();
  const departments = useDepartmentOptions(filters.schoolId || undefined);
  const programs = usePrograms({
    limit: 100,
    departmentId: filters.departmentId || undefined,
    schoolId: filters.schoolId || undefined,
  });
  const canCreate = useCan('student:create');
  const canImport = useCan('student:import');
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Students"
        description="Student records in your scope."
        actions={
          <>
            {canImport && (
              <Button variant="outline" asChild>
                <Link to="/admin/imports/new?kind=students">
                  <FileUp className="size-4" /> Import
                </Link>
              </Button>
            )}
            {canCreate && (
              <NewStudentDialog
                onSaved={(s) => navigate(`/admin/students/${s.id}`)}
                trigger={(open) => (
                  <Button onClick={open}>
                    <Plus className="size-4" /> New student
                  </Button>
                )}
              />
            )}
          </>
        }
      />
      <ListToolbar>
        <SearchInput
          value={q}
          onChange={(v) => update({ q: v })}
          placeholder="Name, email or student number"
          label="Search students"
        />
        <FilterSelect
          label="Faculty"
          value={filters.schoolId}
          onChange={(v) => update({ schoolId: v, departmentId: null, programId: null })}
          options={(schools.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          allLabel="All faculties"
        />
        <FilterSelect
          label="Department"
          value={filters.departmentId}
          onChange={(v) => update({ departmentId: v, programId: null })}
          options={(departments.data?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          allLabel="All departments"
        />
        <FilterSelect
          label="Program"
          value={filters.programId}
          onChange={(v) => update({ programId: v })}
          options={(programs.data?.data ?? []).map((p) => ({ value: p.id, label: p.code }))}
          allLabel="All programs"
        />
        <FilterSelect
          label="Year"
          value={filters.yearOfStudy}
          onChange={(v) => update({ yearOfStudy: v })}
          options={[1, 2, 3, 4, 5].map((y) => ({ value: String(y), label: `Year ${y}` }))}
          allLabel="All years"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          options={Object.entries(STUDENT_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          allLabel="All statuses"
        />
        <FilterSelect
          label="Holds"
          value={filters.hasHold}
          onChange={(v) => update({ hasHold: v })}
          options={[
            { value: 'true', label: 'With active holds' },
            { value: 'false', label: 'Without holds' },
          ]}
          allLabel="Any holds"
        />
      </ListToolbar>
      <DataTable<StudentListItem>
        caption="Students"
        isLoading={students.isPending}
        error={students.error}
        onRetry={() => void students.refetch()}
        rows={students.data?.data}
        meta={students.data?.meta && 'total' in students.data.meta ? students.data.meta : undefined}
        onPageChange={(p) => update({ page: p }, false)}
        rowKey={(s) => s.id}
        onRowClick={(s) => navigate(`/admin/students/${s.id}`)}
        emptyTitle={
          q || Object.values(filters).some(Boolean) ? 'No matching students' : 'No students yet'
        }
        columns={[
          {
            key: 'name',
            header: 'Student',
            cell: (s) => (
              <div>
                <p className="font-medium">
                  {s.firstName} {s.lastName}
                </p>
                <p className="text-xs text-muted-foreground">{s.email}</p>
              </div>
            ),
          },
          {
            key: 'number',
            header: 'Number',
            cell: (s) => <span className="font-mono text-xs">{s.studentNumber}</span>,
          },
          {
            key: 'program',
            header: 'Program',
            cell: (s) => <span title={s.program.name}>{s.program.code}</span>,
            hideOnMobile: true,
          },
          { key: 'year', header: 'Year', cell: (s) => s.yearOfStudy, hideOnMobile: true },
          {
            key: 'status',
            header: 'Status',
            cell: (s) => (
              <div className="flex flex-wrap gap-1">
                <StatusBadge tone={STUDENT_TONE[s.status] ?? 'neutral'}>
                  {STUDENT_STATUS_LABEL[s.status]}
                </StatusBadge>
                {s.activeHolds > 0 && <StatusBadge tone="danger">Hold</StatusBadge>}
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

export function StudentDetailPage() {
  const { studentId = '' } = useParams();
  const student = useStudent(studentId);
  const release = useReleaseHold(studentId);
  if (student.isPending) return <LoadingRows rows={6} />;
  if (student.isError)
    return <ErrorState error={student.error} onRetry={() => void student.refetch()} />;
  const s = student.data;
  const p = s.permissions;
  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-4">
          <UserAvatar
            firstName={s.firstName}
            lastName={s.lastName}
            url={s.avatarUrl}
            className="size-14 text-lg"
          />
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {s.firstName} {s.lastName}
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono text-xs">{s.studentNumber}</span> · {s.email}
              <StatusBadge tone={STUDENT_TONE[s.status] ?? 'neutral'}>
                {STUDENT_STATUS_LABEL[s.status]}
              </StatusBadge>
              {s.activeHolds > 0 && (
                <StatusBadge tone="danger">{s.activeHolds} active hold(s)</StatusBadge>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.edit && (
            <>
              <EditStudentDialog
                student={s}
                trigger={(open) => (
                  <Button variant="outline" onClick={open}>
                    <Pencil className="size-4" /> Edit
                  </Button>
                )}
              />
              <ChangeProgramDialog
                student={s}
                trigger={(open) => (
                  <Button variant="outline" onClick={open}>
                    <ArrowRightLeft className="size-4" /> Change program
                  </Button>
                )}
              />
              <StudentStatusDialog
                student={s}
                trigger={(open) => (
                  <Button variant="outline" onClick={open}>
                    <Ban className="size-4" /> Status
                  </Button>
                )}
              />
            </>
          )}
          {p.manageHolds && (
            <HoldDialog
              studentId={s.id}
              trigger={(open) => (
                <Button onClick={open}>
                  <ShieldAlert className="size-4" /> Place hold
                </Button>
              )}
            />
          )}
        </div>
      </div>
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {p.readSensitive && <TabsTrigger value="contact">Contact</TabsTrigger>}
          <TabsTrigger value="holds">Holds ({s.holds.length})</TabsTrigger>
          <TabsTrigger value="history">Program history</TabsTrigger>
          <TabsTrigger value="registrations">Registrations</TabsTrigger>
          {s.account && <TabsTrigger value="account">Account &amp; access</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardContent>
              <DetailList
                items={[
                  { label: 'Program', value: `${s.program.name} (${s.program.code})` },
                  { label: 'Department', value: s.department.name },
                  { label: 'Specialization', value: s.specialization?.name ?? 'None' },
                  { label: 'Year of study', value: s.yearOfStudy },
                  {
                    label: 'Admission',
                    value:
                      s.admissionSession?.name ??
                      (s.admissionDate ? formatDate(s.admissionDate) : 'Not recorded'),
                  },
                  { label: 'Expected graduation', value: s.expectedGraduationYear ?? 'Not set' },
                  { label: 'Cohort', value: s.cohort },
                  { label: 'Phone', value: s.phone },
                  { label: 'Credits required', value: s.program.totalCredits },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
        {p.readSensitive && s.contact && (
          <TabsContent value="contact" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Contact details</CardTitle>
                {p.edit && (
                  <ContactDialog
                    student={s}
                    trigger={(open) => (
                      <Button size="sm" variant="outline" onClick={open}>
                        <Pencil className="size-4" /> Edit
                      </Button>
                    )}
                  />
                )}
              </CardHeader>
              <CardContent>
                <DetailList
                  items={[
                    { label: 'Personal email', value: s.contact.personalEmail },
                    {
                      label: 'Date of birth',
                      value: s.contact.dateOfBirth ? formatDate(s.contact.dateOfBirth) : null,
                    },
                    {
                      label: 'Address',
                      value:
                        [
                          s.contact.addressLine,
                          s.contact.city,
                          s.contact.state,
                          s.contact.postalCode,
                          s.contact.country,
                        ]
                          .filter(Boolean)
                          .join(', ') || null,
                    },
                    {
                      label: 'Emergency contact',
                      value: s.contact.emergencyContactName
                        ? `${s.contact.emergencyContactName}${s.contact.emergencyContactRelation ? ` (${s.contact.emergencyContactRelation})` : ''} · ${s.contact.emergencyContactPhone ?? ''}`
                        : null,
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </TabsContent>
        )}
        <TabsContent value="holds" className="mt-4">
          {s.holds.length === 0 ? (
            <EmptyState title="No holds" description="Nothing is blocking registration." />
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {s.holds.map((h) => (
                <li key={h.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      {HOLD_LABEL[h.type]} hold
                      <StatusBadge tone={h.releasedAt ? 'neutral' : 'danger'}>
                        {h.releasedAt ? 'Released' : 'Active'}
                      </StatusBadge>
                    </p>
                    {h.reason && <p className="text-sm">{h.reason}</p>}
                    <p className="text-xs text-muted-foreground">
                      Placed {formatDateTime(h.placedAt)}
                      {h.placedBy && ` by ${h.placedBy}`}
                      {h.releasedAt &&
                        ` · released ${formatDateTime(h.releasedAt)}${h.releasedBy ? ` by ${h.releasedBy}` : ''}`}
                    </p>
                  </div>
                  {!h.releasedAt && p.manageHolds && (
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="outline">
                          Release
                        </Button>
                      }
                      title="Release this hold?"
                      description="The student can register again unless other holds remain."
                      confirmLabel="Release hold"
                      onConfirm={() =>
                        release.mutate(
                          { holdId: h.id },
                          {
                            onSuccess: () => toast.success('Hold released'),
                            onError: (e) => toast.error(errorMessage(e)),
                          },
                        )
                      }
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="registrations" className="mt-4">
          <StudentRegistrationsPanel
            student={{
              id: s.id,
              name: `${s.firstName} ${s.lastName}`,
              studentNumber: s.studentNumber,
            }}
          />
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          {s.programHistory.length === 0 ? (
            <EmptyState title="No program changes" />
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {s.programHistory.map((h) => (
                <li key={h.id} className="px-4 py-3 text-sm">
                  <p className="font-medium">
                    {h.from?.code ?? '—'} → {h.to.code}
                    {h.effectiveSession && (
                      <span className="text-muted-foreground"> (from {h.effectiveSession})</span>
                    )}
                  </p>
                  {h.reason && <p>{h.reason}</p>}
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(h.createdAt)}
                    {h.changedBy && ` by ${h.changedBy}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        {s.account && (
          <TabsContent value="account" className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <AccountCard userId={s.userId} account={s.account} canManage={p.manageAccount} />
            <RolesCard userId={s.userId} />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
