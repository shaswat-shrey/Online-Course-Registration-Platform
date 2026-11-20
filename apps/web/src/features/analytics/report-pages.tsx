import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { FilterSelect, ListToolbar, SearchInput } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { DataTable, type Column } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSessions } from '@/features/calendar/api/calendar-queries';
import { useDepartmentOptions, useSchoolOptions } from '@/features/structure/api/structure-queries';
import { useListParams } from '@/hooks/use-list-params';
import { errorMessage } from '@/services/api-error';
import { apiGet, apiPost } from '@/services/http';
import { useCan } from '@/store/auth-store';
import { formatDateTime } from '@/utils/format';
import { formatDate } from '@/utils/timezone';

interface ReportInfo {
  key: string;
  title: string;
  description: string;
  filters: string[];
  statuses?: string[];
  columns: Array<{ key: string; label: string; type?: 'number' | 'percent' | 'text' | 'date' }>;
  defaultSort: string;
}
type Row = Record<string, string | number | null>;
interface ReportPage {
  rows: Row[];
  total: number;
  page: number;
  limit: number;
  sort: string;
  sessionId: string | null;
}
interface ExportJob {
  id: string;
  reportKey: string;
  report: string;
  format: 'CSV' | 'XLSX';
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  rowCount: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

const useCatalogue = () =>
  useQuery({ queryKey: ['reports', 'catalogue'], queryFn: () => apiGet<ReportInfo[]>('/reports') });

async function download(id: string) {
  const link = await apiGet<{ url: string }>(`/reports/exports/${id}/download`);
  window.open(link.url, '_blank', 'noopener');
}

/** Report center (FR-RPT-001). */
export function ReportsPage() {
  const list = useCatalogue();
  const canExport = useCan('report:export');
  return (
    <>
      <PageHeader
        title="Reports"
        description="Data within your scope, filtered and sorted on the server, exportable to CSV or Excel."
        actions={
          canExport ? (
            <Button asChild variant="outline">
              <Link to="/admin/reports/exports">My exports</Link>
            </Button>
          ) : undefined
        }
      />
      {list.isPending ? (
        <LoadingRows rows={6} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((r) => (
            <li key={r.key}>
              <Link to={`/admin/reports/${r.key}`} className="block h-full">
                <Card className="h-full transition-colors hover:border-brand/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <FileText className="size-4 text-brand" aria-hidden /> {r.title}
                    </CardTitle>
                    <CardDescription>{r.description}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const cell = (type: string | undefined, v: string | number | null) =>
  v === null || v === undefined || v === ''
    ? '—'
    : type === 'percent'
      ? `${v}%`
      : type === 'date'
        ? typeof v === 'string' && v.length > 10
          ? formatDateTime(v)
          : formatDate(String(v))
        : type === 'number'
          ? Number(v).toLocaleString()
          : String(v);

export function ReportPage() {
  const { reportKey = '' } = useParams();
  const catalogue = useCatalogue();
  const report = catalogue.data?.find((r) => r.key === reportKey);
  const { page, q, filters, update } = useListParams([
    'sessionId',
    'schoolId',
    'departmentId',
    'status',
    'sort',
  ] as const);
  const sessions = useSessions();
  const schools = useSchoolOptions();
  const departments = useDepartmentOptions(filters.schoolId || undefined);
  const canExport = useCan('report:export');
  const qc = useQueryClient();
  const params = {
    page,
    limit: 25,
    q: q || undefined,
    sort: filters.sort || undefined,
    sessionId: filters.sessionId || undefined,
    schoolId: filters.schoolId || undefined,
    departmentId: filters.departmentId || undefined,
    status: filters.status || undefined,
  };
  const data = useQuery({
    queryKey: ['reports', reportKey, params],
    queryFn: () => apiGet<ReportPage>(`/reports/${reportKey}`, { params }),
    enabled: !!report,
    placeholderData: keepPreviousData,
  });
  const exporter = useMutation({
    mutationFn: (format: 'CSV' | 'XLSX') =>
      apiPost<ExportJob>(`/reports/${reportKey}/export`, {
        format,
        sort: params.sort,
        filters: {
          sessionId: params.sessionId,
          schoolId: params.schoolId,
          departmentId: params.departmentId,
          status: params.status,
          q: params.q,
        },
      }),
    onSuccess: async (job) => {
      void qc.invalidateQueries({ queryKey: ['reports', 'exports'] });
      if (job.status === 'COMPLETED') {
        toast.success(`${job.rowCount} rows exported`);
        await download(job.id).catch((e) => toast.error(errorMessage(e)));
      } else toast.success('Large export queued — you will be notified when it is ready');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (catalogue.isPending) return <LoadingRows rows={6} />;
  if (catalogue.isError) return <ErrorState error={catalogue.error} />;
  if (!report) return <EmptyState title="Report not found" />;
  const has = (f: string) => report.filters.includes(f);
  const [sortKey, sortDir] = (data.data?.sort ?? report.defaultSort).split(':');
  const columns: Column<Row>[] = report.columns.map((c, i) => ({
    key: c.key,
    header: c.label,
    className: c.type === 'number' || c.type === 'percent' ? 'text-right tabular-nums' : undefined,
    hideOnMobile: i > 2,
    cell: (r) => cell(c.type, r[c.key] ?? null),
  }));
  return (
    <>
      <PageHeader
        title={report.title}
        description={report.description}
        actions={
          canExport ? (
            <>
              <Button
                variant="outline"
                disabled={exporter.isPending}
                onClick={() => exporter.mutate('CSV')}
              >
                {exporter.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}{' '}
                CSV
              </Button>
              <Button
                variant="outline"
                disabled={exporter.isPending}
                onClick={() => exporter.mutate('XLSX')}
              >
                <FileSpreadsheet className="size-4" /> Excel
              </Button>
            </>
          ) : undefined
        }
      />
      <ListToolbar>
        {has('q') && (
          <SearchInput value={q} onChange={(v) => update({ q: v })} label="Search report" />
        )}
        {has('sessionId') && (
          <FilterSelect
            label="Session"
            value={filters.sessionId}
            onChange={(v) => update({ sessionId: v })}
            allLabel="Running session"
            options={(sessions.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        {has('schoolId') && (
          <FilterSelect
            label="School"
            value={filters.schoolId}
            onChange={(v) => update({ schoolId: v, departmentId: null })}
            allLabel="All schools"
            options={(schools.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        {has('departmentId') && (
          <FilterSelect
            label="Department"
            value={filters.departmentId}
            onChange={(v) => update({ departmentId: v })}
            allLabel="All departments"
            options={(departments.data?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
          />
        )}
        {report.statuses && (
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(v) => update({ status: v })}
            allLabel="Any status"
            options={report.statuses.map((s) => ({
              value: s,
              label: s.replace(/_/g, ' ').toLowerCase(),
            }))}
          />
        )}
        <FilterSelect
          label="Sort by"
          value={filters.sort}
          onChange={(v) => update({ sort: v })}
          allLabel={`Default (${report.columns.find((c) => c.key === report.defaultSort.split(':')[0])?.label})`}
          options={report.columns.flatMap((c) => [
            { value: `${c.key}:asc`, label: `${c.label} ↑` },
            { value: `${c.key}:desc`, label: `${c.label} ↓` },
          ])}
        />
      </ListToolbar>
      <p className="mb-2 text-xs text-muted-foreground">
        Sorted by {report.columns.find((c) => c.key === sortKey)?.label}{' '}
        {sortDir === 'desc' ? '(descending)' : '(ascending)'}
        {data.data && ` · ${data.data.total.toLocaleString()} rows`}
      </p>
      <DataTable
        caption={report.title}
        columns={columns}
        rows={data.data?.rows}
        rowKey={(r) => report.columns.map((c) => r[c.key]).join('|')}
        isLoading={data.isPending}
        error={data.error}
        onRetry={() => void data.refetch()}
        emptyTitle="No rows for these filters"
        meta={
          data.data
            ? {
                page: data.data.page,
                limit: data.data.limit,
                total: data.data.total,
                totalPages: Math.max(1, Math.ceil(data.data.total / data.data.limit)),
              }
            : undefined
        }
        onPageChange={(p) => update({ page: p }, false)}
      />
    </>
  );
}

const STATUS_TONE = {
  QUEUED: 'neutral',
  RUNNING: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
} as const;

export function ExportsPage() {
  const list = useQuery({
    queryKey: ['reports', 'exports'],
    queryFn: () => apiGet<ExportJob[]>('/reports/exports'),
    refetchInterval: (q) =>
      q.state.data?.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING') ? 3000 : false,
  });
  return (
    <>
      <PageHeader
        title="My exports"
        description="Files you exported from reports. Links are generated on download."
      />
      <DataTable
        caption="Exports"
        rows={list.data}
        rowKey={(j) => j.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyTitle="No exports yet"
        columns={[
          { key: 'report', header: 'Report', cell: (j) => j.report },
          { key: 'format', header: 'Format', cell: (j) => j.format, hideOnMobile: true },
          {
            key: 'rows',
            header: 'Rows',
            cell: (j) => j.rowCount?.toLocaleString() ?? '—',
            hideOnMobile: true,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (j) => (
              <StatusBadge tone={STATUS_TONE[j.status]}>{j.status.toLowerCase()}</StatusBadge>
            ),
          },
          {
            key: 'created',
            header: 'Requested',
            cell: (j) => formatDateTime(j.createdAt),
            hideOnMobile: true,
          },
          {
            key: 'download',
            header: 'File',
            cell: (j) =>
              j.status === 'COMPLETED' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => download(j.id).catch((e) => toast.error(errorMessage(e)))}
                >
                  <Download className="size-4" /> Download
                </Button>
              ) : (
                (j.error ?? '—')
              ),
          },
        ]}
      />
    </>
  );
}
