import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Key/value list for detail pages: two columns from `sm` up, or one for narrow cards. */
export function DetailList({
  items,
  columns = 2,
}: {
  items: Array<{ label: string; value: ReactNode }>;
  columns?: 1 | 2;
}) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3 text-sm', columns === 2 && 'sm:grid-cols-2')}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 font-medium break-words">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
