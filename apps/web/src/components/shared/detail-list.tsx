import type { ReactNode } from 'react';

/** Two-column key/value list for detail pages. */
export function DetailList({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-muted-foreground">{i.label}</dt>
          <dd className="mt-0.5 break-words font-medium">{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
