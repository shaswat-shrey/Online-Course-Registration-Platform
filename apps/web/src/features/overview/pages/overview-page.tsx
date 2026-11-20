import { KeyRound, Laptop, ShieldCheck, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import type { Portal } from '@ucrams/shared';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLoginHistory, useSessions } from '@/features/account/api/account-queries';
import { useAuthStore } from '@/store/auth-store';
import { formatDateTime, formatRelative, SCOPE_LABEL } from '@/utils/format';

const GREETING = (h: number) =>
  h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

/**
 * Portal landing page: account and access summary from live data. Portal-specific
 * dashboards (registrations, teaching, analytics) extend this in later phases.
 */
export function OverviewPage({ portal }: { portal: Portal }) {
  const me = useAuthStore((s) => s.me)!;
  const sessions = useSessions();
  const history = useLoginHistory();
  const previous = history.data?.filter((a) => a.outcome === 'SUCCESS')[1];
  const failedSincePrevious = history.data
    ?.filter((a) => !previous || a.createdAt > previous.createdAt)
    .filter((a) => a.outcome !== 'SUCCESS').length;

  return (
    <>
      <PageHeader
        title={`${GREETING(new Date().getHours())}, ${me.user.firstName}`}
        description="Your account and access at a glance."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="size-4 text-brand" aria-hidden /> Account
            </CardTitle>
            <CardDescription>{me.user.email}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">
                {me.user.firstName} {me.user.lastName}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge tone="success">Active</StatusBadge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-brand" aria-hidden /> Roles
            </CardTitle>
            <CardDescription>What you can do in this system</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {me.roles.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{r.roleName}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.scopeMode === 'RELATIONSHIP' ? 'Own records only' : SCOPE_LABEL[r.scopeType]}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Laptop className="size-4 text-brand" aria-hidden /> Sign-in activity
            </CardTitle>
            <CardDescription>Review regularly for anything unfamiliar</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {sessions.isPending || history.isPending ? (
              <>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active sessions</span>
                  <span className="font-medium tabular-nums">{sessions.data?.length ?? '—'}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Previous sign-in</span>
                  <span
                    className="text-right font-medium"
                    title={previous ? formatDateTime(previous.createdAt) : undefined}
                  >
                    {previous
                      ? `${formatRelative(previous.createdAt)} · ${previous.deviceLabel ?? 'Unknown device'}`
                      : 'First sign-in'}
                  </span>
                </div>
                {!!failedSincePrevious && (
                  <p className="rounded-md bg-warning/15 px-2 py-1.5 text-xs">
                    {failedSincePrevious} failed sign-in attempt
                    {failedSincePrevious === 1 ? '' : 's'} since your previous sign-in.
                  </p>
                )}
              </>
            )}
            <Button asChild variant="outline" size="sm" className="mt-2 w-full">
              <Link to={`/${portal}/account`}>
                <KeyRound className="size-4" /> Manage security
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
