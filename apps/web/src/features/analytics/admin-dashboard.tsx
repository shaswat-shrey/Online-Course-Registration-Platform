import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, LifeBuoy, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSessions } from '@/features/calendar/api/calendar-queries';
import { useDepartmentOptions, useSchoolOptions } from '@/features/structure/api/structure-queries';
import { apiGet } from '@/services/http';
import { formatRelative } from '@/utils/format';

interface Point {
  label: string;
  value: number;
  title?: string;
}
interface Dashboard {
  scope: 'UNIVERSITY' | 'SCOPED';
  counts: Record<string, number | null>;
  charts: Record<
    | 'enrollmentTrend'
    | 'studentsBySchool'
    | 'studentsByDepartment'
    | 'studentsByProgram'
    | 'facultyByDepartment'
    | 'topCourses'
    | 'registrationStatus'
    | 'utilizationByDepartment',
    Point[]
  >;
  widgets: {
    recentUsers: Array<{
      id: string;
      name: string;
      email: string;
      kind: string;
      createdAt: string;
    }>;
    pending: { registrations: number; tickets: number; feedback: number };
    recentAudit: Array<{
      id: string;
      action: string;
      entityType: string;
      actor: string;
      createdAt: string;
    }>;
  };
  alerts: {
    failedJobs: number | null;
    workerStale: boolean;
    belowMinimum: Array<{ sectionId: string; label: string; enrolled: number; minimum: number }>;
    belowMinimumCount: number;
    withoutInstructor: Array<{ sectionId: string; label: string }>;
    withoutInstructorCount: number;
  };
  generatedAt: string;
  cached: boolean;
}

const ALL = '__all__';
const KPIS: Array<[string, string, (v: number | null) => string]> = [
  ['studentsActive', 'Active students', (v) => String(v ?? '—')],
  ['faculty', 'Faculty', (v) => String(v ?? '—')],
  ['courses', 'Active courses', (v) => String(v ?? '—')],
  ['sections', 'Sections', (v) => String(v ?? '—')],
  ['registrations', 'Seat registrations', (v) => String(v ?? '—')],
  ['pendingRegistrations', 'Pending approvals', (v) => String(v ?? '—')],
  ['availableSeats', 'Available seats', (v) => String(v ?? '—')],
  ['capacityUtilization', 'Capacity used', (v) => (v === null ? '—' : `${v}%`)],
];
const SECONDARY: Array<[string, string]> = [
  ['studentsTotal', 'students in total'],
  ['admins', 'administrators'],
  ['schools', 'schools'],
  ['departments', 'departments'],
  ['programs', 'programmes'],
  ['specializations', 'specializations'],
  ['activeSessions', 'active sessions'],
];
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  REGISTERED: 'Registered',
  WAITLISTED: 'Waitlisted',
  OFFERED: 'Offered',
  DROPPED: 'Dropped',
  WITHDRAWN: 'Withdrawn',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  COMPLETED: 'Completed',
};

const tick = { fontSize: 11, fill: 'var(--muted-foreground)' };

/** Single-series chart in the brand hue with hover tooltip and a data table fallback. */
function ChartCard({
  title,
  description,
  data,
  kind = 'bar',
  unit = '',
  horizontal = false,
}: {
  title: string;
  description?: string;
  data: Point[];
  kind?: 'bar' | 'line';
  unit?: string;
  horizontal?: boolean;
}) {
  const height = horizontal ? Math.max(160, data.length * 26 + 30) : 220;
  const fmt = (v: number) => `${v.toLocaleString()}${unit}`;
  const tooltip = (
    <Tooltip
      cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
      formatter={(v) => [fmt(Number(v)), title]}
      labelFormatter={(l, payload) =>
        (payload?.[0]?.payload as Point | undefined)?.title ?? String(l)
      }
      contentStyle={{
        background: 'var(--popover)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontSize: 12,
        color: 'var(--popover-foreground)',
      }}
    />
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data for these filters.</p>
        ) : (
          <>
            <div style={{ height }} aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                {kind === 'line' ? (
                  <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} />
                    <YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
                    {tooltip}
                    <Line
                      type="linear"
                      dataKey="value"
                      stroke="var(--brand)"
                      strokeWidth={2}
                      dot={{ r: 4, fill: 'var(--brand)', stroke: 'var(--card)', strokeWidth: 2 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                ) : horizontal ? (
                  <BarChart
                    data={data}
                    layout="vertical"
                    margin={{ top: 0, right: 12, bottom: 0, left: 4 }}
                  >
                    <CartesianGrid horizontal={false} stroke="var(--border)" />
                    <XAxis
                      type="number"
                      tick={tick}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={tick}
                      tickLine={false}
                      axisLine={false}
                      width={88}
                    />
                    {tooltip}
                    <Bar dataKey="value" fill="var(--brand)" radius={[0, 4, 4, 0]} barSize={14} />
                  </BarChart>
                ) : (
                  <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis
                      dataKey="label"
                      tick={tick}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                    />
                    <YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
                    {tooltip}
                    <Bar
                      dataKey="value"
                      fill="var(--brand)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={36}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">Show data</summary>
              <table className="mt-2 w-full">
                <caption className="sr-only">{title}</caption>
                <tbody>
                  {data.map((d) => (
                    <tr key={d.label} className="border-b last:border-0">
                      <th scope="row" className="py-1 text-left font-normal">
                        {d.title ? `${d.label} · ${d.title}` : d.label}
                      </th>
                      <td className="py-1 text-right tabular-nums">{fmt(d.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  all,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  all: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label id={id}>{label}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
        <SelectTrigger aria-labelledby={id} className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{all}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Administrator dashboard (FR-ADMIN-001..006): live counts, charts, widgets and alerts. */
export function AdminDashboard() {
  const [sessionId, setSessionId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const sessions = useSessions();
  const schools = useSchoolOptions();
  const departments = useDepartmentOptions(schoolId || undefined);
  const params = {
    sessionId: sessionId || undefined,
    schoolId: schoolId || undefined,
    departmentId: departmentId || undefined,
  };
  const dash = useQuery({
    queryKey: ['dashboard', 'admin', params],
    queryFn: () => apiGet<Dashboard>('/dashboards/admin', { params }),
    refetchInterval: 60_000,
  });
  const d = dash.data;
  return (
    <section aria-label="University dashboard" className="mb-8 space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          id="dash-session"
          label="Session"
          value={sessionId}
          onChange={setSessionId}
          all="Running sessions"
          options={(sessions.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
        <FilterSelect
          id="dash-school"
          label="School"
          value={schoolId}
          onChange={(v) => {
            setSchoolId(v);
            setDepartmentId('');
          }}
          all="All schools"
          options={(schools.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
        <FilterSelect
          id="dash-department"
          label="Department"
          value={departmentId}
          onChange={setDepartmentId}
          all="All departments"
          options={(departments.data?.data ?? []).map((x) => ({ value: x.id, label: x.name }))}
        />
        {d && (
          <p className="ml-auto text-xs text-muted-foreground">
            {d.scope === 'SCOPED' ? 'Your departments · ' : ''}Updated{' '}
            {formatRelative(d.generatedAt)}
          </p>
        )}
      </div>
      {dash.isPending ? (
        <LoadingRows rows={6} />
      ) : dash.isError ? (
        <ErrorState error={dash.error} onRetry={() => void dash.refetch()} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {KPIS.map(([key, label, format]) => (
              <div key={key} className="rounded-lg border bg-card p-4">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {format(d!.counts[key] ?? null)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">
            {SECONDARY.map(([key, label]) => `${d!.counts[key] ?? 0} ${label}`).join(' · ')}
          </p>

          {(d!.alerts.workerStale ||
            (d!.alerts.failedJobs ?? 0) > 0 ||
            d!.alerts.belowMinimumCount > 0 ||
            d!.alerts.withoutInstructorCount > 0) && (
            <Card className="border-warning/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="size-4 text-warning" aria-hidden /> Needs attention
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {d!.alerts.workerStale && (
                  <p>The background worker has not reported in the last few minutes.</p>
                )}
                {(d!.alerts.failedJobs ?? 0) > 0 && (
                  <p>{d!.alerts.failedJobs} background job(s) failed.</p>
                )}
                {d!.alerts.belowMinimumCount > 0 && (
                  <div>
                    <p>{d!.alerts.belowMinimumCount} section(s) below their minimum enrollment:</p>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {d!.alerts.belowMinimum.map((s) => (
                        <li key={s.sectionId}>
                          <Link to={`/admin/sections/${s.sectionId}`} className="underline">
                            {s.label}
                          </Link>{' '}
                          <span className="text-muted-foreground">
                            ({s.enrolled}/{s.minimum})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {d!.alerts.withoutInstructorCount > 0 && (
                  <div>
                    <p>
                      {d!.alerts.withoutInstructorCount} published section(s) without a primary
                      instructor:
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {d!.alerts.withoutInstructor.map((s) => (
                        <li key={s.sectionId}>
                          <Link to={`/admin/sections/${s.sectionId}`} className="underline">
                            {s.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <ChartCard
              title="Enrollment by session"
              description="Registrations in the last six sessions"
              data={d!.charts.enrollmentTrend}
              kind="line"
            />
            <ChartCard
              title="Registration status"
              data={d!.charts.registrationStatus.map((p) => ({
                ...p,
                label: STATUS_LABEL[p.label] ?? p.label,
              }))}
              horizontal
            />
            <ChartCard
              title="Top courses"
              description="By registrations"
              data={d!.charts.topCourses}
              horizontal
            />
            <ChartCard
              title="Capacity used by department"
              data={d!.charts.utilizationByDepartment}
              unit="%"
              horizontal
            />
            <ChartCard
              title="Students by department"
              data={d!.charts.studentsByDepartment}
              horizontal
            />
            <ChartCard title="Students by school" data={d!.charts.studentsBySchool} horizontal />
            <ChartCard
              title="Students by programme"
              description="Ten largest"
              data={d!.charts.studentsByProgram}
              horizontal
            />
            <ChartCard
              title="Faculty by department"
              data={d!.charts.facultyByDepartment}
              horizontal
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Waiting on administrators</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Link
                  to="/admin/registrations?status=PENDING"
                  className="flex items-center justify-between hover:underline"
                >
                  <span className="flex items-center gap-2">
                    <ClipboardList className="size-4" aria-hidden /> Registration approvals
                  </span>
                  <StatusBadge tone={d!.widgets.pending.registrations ? 'warning' : 'neutral'}>
                    {d!.widgets.pending.registrations}
                  </StatusBadge>
                </Link>
                <Link
                  to="/admin/tickets"
                  className="flex items-center justify-between hover:underline"
                >
                  <span className="flex items-center gap-2">
                    <LifeBuoy className="size-4" aria-hidden /> Open tickets
                  </span>
                  <StatusBadge tone={d!.widgets.pending.tickets ? 'warning' : 'neutral'}>
                    {d!.widgets.pending.tickets}
                  </StatusBadge>
                </Link>
                <Link
                  to="/admin/feedback"
                  className="flex items-center justify-between hover:underline"
                >
                  <span className="flex items-center gap-2">
                    <MessageSquarePlus className="size-4" aria-hidden /> Open feedback
                  </span>
                  <StatusBadge tone={d!.widgets.pending.feedback ? 'warning' : 'neutral'}>
                    {d!.widgets.pending.feedback}
                  </StatusBadge>
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recently added people</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {d!.widgets.recentUsers.map((u) => (
                    <li key={u.id} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">{u.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelative(u.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent activity</CardTitle>
              </CardHeader>
              <CardContent>
                {d!.widgets.recentAudit.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Audit history needs the audit permission.
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {d!.widgets.recentAudit.map((a) => (
                      <li key={a.id} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {a.actor} · <span className="font-mono text-xs">{a.action}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatRelative(a.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}
