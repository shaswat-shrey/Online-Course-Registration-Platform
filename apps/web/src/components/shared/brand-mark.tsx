import { GraduationCap } from 'lucide-react';

export function BrandMark({ name }: { name?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <GraduationCap className="size-5" aria-hidden />
      </span>
      <span className="text-sm font-semibold tracking-tight">{name ?? 'UCRAMS'}</span>
    </div>
  );
}
