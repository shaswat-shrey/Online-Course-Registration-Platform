import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const statusBadgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
  {
    variants: {
      tone: {
        success: 'bg-success/10 text-success ring-success/25',
        warning: 'bg-warning/15 text-warning-foreground ring-warning/30 dark:text-warning',
        danger: 'bg-destructive/10 text-destructive ring-destructive/25',
        info: 'bg-brand/10 text-brand ring-brand/25',
        neutral: 'bg-muted text-muted-foreground ring-border',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type StatusTone = NonNullable<VariantProps<typeof statusBadgeVariants>['tone']>;

/** Status pill with a dot so meaning is not conveyed by colour alone (text is always present). */
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(statusBadgeVariants({ tone }), className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
