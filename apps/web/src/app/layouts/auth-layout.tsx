import { CalendarCheck2, GraduationCap, ShieldCheck, Users } from 'lucide-react';
import { Outlet } from 'react-router';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { useUniversity } from '@/features/system/api/system-queries';

const HIGHLIGHTS = [
  { icon: CalendarCheck2, text: 'Plan, register and manage your courses each session' },
  { icon: Users, text: 'Faculty rosters, course communication and announcements' },
  { icon: ShieldCheck, text: 'Secure sign-in with per-device session control' },
];

/** Split layout for sign-in flows: brand panel on large screens, form only on mobile. */
export function AuthLayout() {
  const { data: university } = useUniversity();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <GraduationCap className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold">{university?.name ?? 'University portal'}</span>
        </div>
        <div className="max-w-md space-y-8">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight text-white">
            Course registration and academic management, in one place.
          </h2>
          <ul className="space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-sidebar-foreground/85">
                <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent">
                  <Icon className="size-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-sidebar-foreground/60">
          {university?.shortName ?? 'UCRAMS'} · Academic Management System
        </p>
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-sidebar-primary/15 blur-3xl"
        />
      </aside>
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6">
          <span className="flex items-center gap-2 font-semibold lg:invisible">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="size-4" aria-hidden />
            </span>
            {university?.shortName ?? 'UCRAMS'}
          </span>
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-6">
          <div className="w-full max-w-sm">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
