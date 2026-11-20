import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/utils/format';
import { useAuditLog, type AuditEntryDto } from '../api/audit-queries';

const FILTER_KEYS = ['action', 'entityType', 'from', 'to'] as const;

/** Filters live in the URL so views can be shared and survive reloads. */
export function AuditLogPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<
    (typeof FILTER_KEYS)[number],
    string
  >;
  const [draft, setDraft] = useState(filters);
  const [expanded, setExpanded] = useState<string | null>(null);
  const log = useAuditLog({ page, ...filters });

  const apply = (next: typeof filters, nextPage = 1) => {
    const p = new URLSearchParams();
    for (const k of FILTER_KEYS) if (next[k]) p.set(k, next[k]);
    if (nextPage > 1) p.set('page', String(nextPage));
    setParams(p);
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Security events and administrative changes, newest first."
      />
      <form
        className="mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          apply(draft);
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="f-action">Action starts with</Label>
          <Input
            id="f-action"
            placeholder="e.g. auth. or rbac.role_"
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-entity">Entity type</Label>
          <Input
            id="f-entity"
            placeholder="e.g. User, Role, Session"
            value={draft.entityType}
            onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-from">From</Label>
          <Input
            id="f-from"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-to">To</Label>
          <Input
            id="f-to"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const empty = { action: '', entityType: '', from: '', to: '' };
              setDraft(empty);
              apply(empty);
            }}
          >
            Clear
          </Button>
        </div>
      </form>
      <DataTable<AuditEntryDto>
        caption="Audit log entries"
        isLoading={log.isPending}
        error={log.error}
        onRetry={() => void log.refetch()}
        rows={log.data?.data}
        meta={log.data?.meta && 'total' in log.data.meta ? log.data.meta : undefined}
        onPageChange={(p) => apply(filters, p)}
        rowKey={(e) => e.id}
        emptyTitle="No matching entries"
        emptyDescription="Try widening the date range or clearing filters."
        columns={[
          {
            key: 'when',
            header: 'When',
            cell: (e) => <span className="whitespace-nowrap">{formatDateTime(e.createdAt)}</span>,
          },
          {
            key: 'action',
            header: 'Action',
            cell: (e) => <span className="font-mono text-xs">{e.action}</span>,
          },
          {
            key: 'actor',
            header: 'Actor',
            cell: (e) =>
              e.actor ? (
                <span title={e.actor.email}>{e.actor.name}</span>
              ) : (
                <span className="text-muted-foreground">System / anonymous</span>
              ),
            hideOnMobile: true,
          },
          {
            key: 'entity',
            header: 'Entity',
            cell: (e) => (
              <span className="text-xs">
                {e.entityType}
                {e.entityId && (
                  <span className="block font-mono text-muted-foreground">
                    {e.entityId.slice(0, 13)}…
                  </span>
                )}
              </span>
            ),
            hideOnMobile: true,
          },
          {
            key: 'details',
            header: '',
            className: 'text-right',
            cell: (e) =>
              e.changes ? (
                <div className="text-left">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={expanded === e.id}
                    onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  >
                    Details{' '}
                    <ChevronDown className={expanded === e.id ? 'size-4 rotate-180' : 'size-4'} />
                  </Button>
                  {expanded === e.id && (
                    <pre className="mt-2 max-w-md overflow-x-auto rounded bg-muted p-2 text-xs">
                      {JSON.stringify(e.changes, null, 2)}
                    </pre>
                  )}
                </div>
              ) : null,
          },
        ]}
      />
    </>
  );
}
