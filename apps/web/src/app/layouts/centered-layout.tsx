import { Outlet } from 'react-router';
import { BrandMark } from '@/components/shared/brand-mark';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { useUniversity } from '@/features/system/api/system-queries';

/** Minimal shell for public pages (status, login in Phase 2, errors). */
export function CenteredLayout() {
  const { data: university } = useUniversity();
  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-secondary/60 to-background">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <BrandMark name={university?.name} />
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-10 sm:px-6">
        <Outlet />
      </main>
      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        {university?.shortName ?? 'UCRAMS'} · Course Registration &amp; Academic Management
      </footer>
    </div>
  );
}
