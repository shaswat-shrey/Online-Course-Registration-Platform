import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PaginationMeta } from '@ucrams/shared';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide below the md breakpoint to keep tables readable on phones. */
  hideOnMobile?: boolean;
}

interface Props<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyTitle: string;
  emptyDescription?: string;
  meta?: PaginationMeta;
  onPageChange?: (page: number) => void;
  onRowClick?: (row: T) => void;
}

/** Server-driven table with loading, empty and error states (docs: UI requirements). */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  isLoading,
  error,
  onRetry,
  emptyTitle,
  emptyDescription,
  meta,
  onPageChange,
  onRowClick,
}: Props<T>) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  const hide = (c: Column<T>) => (c.hideOnMobile ? 'hidden md:table-cell' : undefined);
  return (
    <div className="min-w-0 space-y-3">
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.key} className={cn(hide(c), c.className)}>
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 5 }, (_, i) => (
                  <TableRow key={i}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className={hide(c)}>
                        <Skeleton className="h-4 w-3/4" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows?.map((row) => (
                  <TableRow
                    key={rowKey(row)}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((c) => (
                      <TableCell key={c.key} className={cn(hide(c), c.className)}>
                        {c.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!isLoading && rows?.length === 0 && (
          <div className="p-4">
            <EmptyState title={emptyTitle} description={emptyDescription} />
          </div>
        )}
      </div>
      {meta && onPageChange && meta.total > 0 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <p className="text-muted-foreground">
            Page {meta.page} of {meta.totalPages} · {meta.total.toLocaleString()} total
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => onPageChange(meta.page - 1)}
            >
              <ChevronLeft className="size-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => onPageChange(meta.page + 1)}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
