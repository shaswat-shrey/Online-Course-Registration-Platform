import { CheckCircle2, Download, FileSpreadsheet, Loader2, Upload, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { FormAlert } from '@/components/forms/form-alert';
import { FilterSelect } from '@/components/shared/list-toolbar';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/services/api-error';
import { API_BASE_URL } from '@/services/http';
import { formatDateTime } from '@/utils/format';
import {
  useCancelImport,
  useCommitImport,
  useImport,
  useImportRows,
  usePreviewImport,
  type ImportRow,
} from '../api/imports-queries';

const KIND_LABEL = { students: 'students', faculty: 'faculty' } as const;
const COLUMNS = {
  students:
    'email, first_name, last_name, program_code, year_of_study (required); student_number, specialization_code, admission_session_code, cohort, phone (optional)',
  faculty:
    'email, first_name, last_name, department_code, designation (required); employee_number, phone, office_location, max_load_credits (optional)',
};

export function NewImportPage() {
  const [params] = useSearchParams();
  const kind = params.get('kind') === 'faculty' ? 'faculty' : 'students';
  const preview = usePreviewImport();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <PageHeader
        title={`Import ${KIND_LABEL[kind]}`}
        description="Upload a spreadsheet, review problems row by row, then create the accounts."
      />
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">1. Prepare your file</CardTitle>
          <CardDescription>
            CSV or Excel (.xlsx), up to 5 MB and 5,000 rows. The first row must contain the column
            headers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="font-medium">Columns:</span> {COLUMNS[kind]}
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href={`${API_BASE_URL}/imports/templates/${kind}`} download>
              <Download className="size-4" /> Download template
            </a>
          </Button>
        </CardContent>
        <CardHeader>
          <CardTitle className="text-base">2. Upload and check</CardTitle>
          <CardDescription>
            Nothing is created until you confirm on the next screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {preview.isError && <FormAlert>{errorMessage(preview.error)}</FormAlert>}
          <div
            className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
          >
            <FileSpreadsheet className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm">
              {file ? (
                <span className="font-medium">{file.name}</span>
              ) : (
                'Drag a file here, or choose one'
              )}
            </p>
            <input
              ref={input}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label="Choose an import file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
              Choose file
            </Button>
          </div>
          <Button
            disabled={!file || preview.isPending}
            onClick={() =>
              file &&
              preview.mutate(
                { kind, file },
                { onSuccess: (job) => navigate(`/admin/imports/${job.id}`) },
              )
            }
          >
            {preview.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}{' '}
            Check file
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

const ROW_TONE: Record<string, StatusTone> = {
  VALID: 'info',
  INVALID: 'danger',
  CREATED: 'success',
  FAILED: 'danger',
};
const ROW_LABEL: Record<string, string> = {
  VALID: 'Ready',
  INVALID: 'Has problems',
  CREATED: 'Created',
  FAILED: 'Failed',
};
const JOB_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  PREVIEW: { label: 'Waiting for confirmation', tone: 'info' },
  QUEUED: { label: 'Queued', tone: 'info' },
  PROCESSING: { label: 'Creating accounts…', tone: 'warning' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export function ImportDetailPage() {
  const { importId = '' } = useParams();
  const job = useImport(importId);
  const commit = useCommitImport(importId);
  const cancel = useCancelImport(importId);
  const [sendInvites, setSendInvites] = useState(true);
  // null until the user picks a filter; then defaults to the most useful view for the job's state.
  const [chosenStatus, setStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const j = job.data;
  const status = chosenStatus ?? (j?.status === 'PREVIEW' && j.invalidRows > 0 ? 'INVALID' : '');
  const rows = useImportRows(importId, status, page, `${j?.status}-${j?.createdRows}`, !!j);
  if (job.isPending) return <LoadingRows rows={4} />;
  if (job.isError || !j) return <ErrorState error={job.error} onRetry={() => void job.refetch()} />;
  const kind = j.kind === 'STUDENTS' ? 'students' : 'faculty';
  const st = JOB_LABEL[j.status]!;
  return (
    <>
      <PageHeader
        title={`Import ${kind}: ${j.fileName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
            Uploaded {formatDateTime(j.createdAt)} by {j.createdBy}
          </span>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          ['Rows', j.totalRows],
          ['Ready', j.validRows],
          ['With problems', j.invalidRows],
          [
            j.status === 'PREVIEW' ? 'Will be created' : 'Created',
            j.status === 'PREVIEW' ? j.validRows : j.createdRows,
          ],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-card p-4">
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      {j.status === 'PREVIEW' && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">3. Confirm</CardTitle>
            <CardDescription>
              {j.validRows === 0
                ? 'No rows can be imported. Fix the problems in your file and upload it again.'
                : `${j.validRows} account(s) will be created.${j.invalidRows ? ` ${j.invalidRows} row(s) with problems will be skipped.` : ''}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="send-invites" checked={sendInvites} onCheckedChange={setSendInvites} />
              <Label htmlFor="send-invites">Email invitations when done</Label>
            </div>
            <Button
              disabled={j.validRows === 0 || commit.isPending}
              onClick={() =>
                commit.mutate(sendInvites, {
                  onSuccess: () => toast.success('Import started'),
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              {commit.isPending && <Loader2 className="size-4 animate-spin" />}Create {j.validRows}{' '}
              account(s)
            </Button>
            <Button variant="ghost" onClick={() => cancel.mutate()}>
              Discard
            </Button>
          </CardContent>
        </Card>
      )}
      {j.status === 'COMPLETED' && (
        <div className="mb-6">
          <FormAlert tone="success">
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="size-4" /> {j.createdRows} account(s) created
              {j.failedRows ? `, ${j.failedRows} failed` : ''}.{' '}
              {j.sendInvites ? 'Invitations are being emailed.' : 'No invitations were sent.'}{' '}
              <Link className="underline" to={`/admin/${kind}`}>
                View {kind}
              </Link>
            </span>
          </FormAlert>
        </div>
      )}
      {j.status === 'FAILED' && (
        <div className="mb-6">
          <FormAlert>
            <span className="inline-flex items-center gap-1">
              <XCircle className="size-4" /> {j.errorMessage ?? 'The import failed.'}
            </span>
          </FormAlert>
        </div>
      )}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Rows</h2>
        <FilterSelect
          label="Row status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={Object.entries(ROW_LABEL).map(([value, label]) => ({ value, label }))}
          allLabel="All rows"
        />
      </div>
      <DataTable<ImportRow>
        caption="Import rows"
        isLoading={rows.isPending}
        error={rows.error}
        rows={rows.data?.data}
        meta={rows.data?.meta && 'total' in rows.data.meta ? rows.data.meta : undefined}
        onPageChange={setPage}
        rowKey={(r) => String(r.rowNumber)}
        emptyTitle="No rows in this view"
        columns={[
          {
            key: 'row',
            header: 'Row',
            cell: (r) => <span className="tabular-nums">{r.rowNumber}</span>,
          },
          {
            key: 'person',
            header: 'Person',
            cell: (r) => (
              <div>
                <p className="font-medium">{r.name ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{r.email}</p>
              </div>
            ),
          },
          {
            key: 'ref',
            header: kind === 'students' ? 'Program' : 'Department',
            cell: (r) => r.reference ?? '—',
            hideOnMobile: true,
          },
          {
            key: 'status',
            header: 'Status',
            cell: (r) => (
              <StatusBadge tone={ROW_TONE[r.status]!}>{ROW_LABEL[r.status]}</StatusBadge>
            ),
          },
          {
            key: 'errors',
            header: 'Problems',
            cell: (r) =>
              r.errors.length ? (
                <ul className="text-xs text-destructive">
                  {r.errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono">{e.field}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              ) : null,
          },
        ]}
      />
    </>
  );
}
