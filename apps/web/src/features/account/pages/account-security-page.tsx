import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, LogOut, Monitor } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  changePasswordSchema,
  PASSWORD_MIN_LENGTH,
  type LoginAttemptDto,
  type SessionDto,
} from '@ucrams/shared';
import { FormAlert } from '@/components/forms/form-alert';
import { PasswordField } from '@/components/forms/form-field';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { DataTable } from '@/components/tables/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authApi } from '@/features/auth/api/auth-api';
import { isApiError } from '@/services/api-error';
import { useAuthStore } from '@/store/auth-store';
import { formatDateTime, formatRelative } from '@/utils/format';
import {
  accountKeys,
  useLoginHistory,
  useRevokeSession,
  useSessions,
} from '../api/account-queries';

const formSchema = changePasswordSchema
  .and(z.object({ confirm: z.string() }))
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });
type FormValues = z.infer<typeof formSchema>;

function ChangePasswordCard() {
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const change = useMutation({
    mutationFn: (v: FormValues) =>
      authApi.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => {
      form.reset();
      toast.success('Password changed. Your other sessions were signed out.');
      void qc.invalidateQueries({ queryKey: accountKeys.sessions });
    },
  });
  const err = change.error;
  const currentError =
    isApiError(err) && err.code === 'INVALID_CREDENTIALS' ? err.message : undefined;
  const policyError = isApiError(err) && err.code === 'VALIDATION_ERROR' ? err.message : undefined;
  const otherError = err && !currentError && !policyError;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Change password</CardTitle>
        <CardDescription>Changing your password signs out all your other devices.</CardDescription>
      </CardHeader>
      <CardContent>
        {otherError && (
          <div className="mb-4">
            <FormAlert>
              {err instanceof Error ? err.message : 'Could not change password'}
            </FormAlert>
          </div>
        )}
        <form
          className="grid max-w-md gap-4"
          noValidate
          onSubmit={form.handleSubmit((v) => change.mutate(v))}
        >
          <PasswordField
            label="Current password"
            autoComplete="current-password"
            error={form.formState.errors.currentPassword?.message ?? currentError}
            {...form.register('currentPassword')}
          />
          <PasswordField
            label="New password"
            autoComplete="new-password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. Avoid common passwords and your email address.`}
            error={form.formState.errors.newPassword?.message ?? policyError}
            {...form.register('newPassword')}
          />
          <PasswordField
            label="Confirm new password"
            autoComplete="new-password"
            error={form.formState.errors.confirm?.message}
            {...form.register('confirm')}
          />
          <div>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signOutEverywhere = useMutation({
    mutationFn: authApi.logoutAll,
    onSuccess: () => {
      useAuthStore.getState().clear('signed-out');
      qc.clear();
      navigate('/login', { replace: true });
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-base">Active sessions</CardTitle>
          <CardDescription>Devices currently signed in to your account.</CardDescription>
        </div>
        <ConfirmDialog
          trigger={
            <Button variant="outline" size="sm" disabled={signOutEverywhere.isPending}>
              <LogOut className="size-4" /> Sign out everywhere
            </Button>
          }
          title="Sign out of every device?"
          description="All sessions, including this one, will end. You will need to sign in again."
          confirmLabel="Sign out everywhere"
          destructive
          onConfirm={() => signOutEverywhere.mutate()}
        />
      </CardHeader>
      <CardContent>
        <DataTable<SessionDto>
          caption="Active sessions"
          isLoading={sessions.isPending}
          error={sessions.error}
          onRetry={() => void sessions.refetch()}
          rows={sessions.data}
          rowKey={(s) => s.id}
          emptyTitle="No active sessions"
          columns={[
            {
              key: 'device',
              header: 'Device',
              cell: (s) => (
                <span className="flex items-center gap-2 font-medium">
                  <Monitor className="size-4 text-muted-foreground" aria-hidden />
                  {s.deviceLabel ?? 'Unknown device'}
                  {s.current && <StatusBadge tone="info">This device</StatusBadge>}
                </span>
              ),
            },
            { key: 'ip', header: 'IP address', cell: (s) => s.ip ?? '—', hideOnMobile: true },
            { key: 'seen', header: 'Last active', cell: (s) => formatRelative(s.lastSeenAt) },
            {
              key: 'created',
              header: 'Signed in',
              cell: (s) => formatDateTime(s.createdAt),
              hideOnMobile: true,
            },
            {
              key: 'actions',
              header: '',
              className: 'text-right',
              cell: (s) =>
                s.current ? null : (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm" disabled={revoke.isPending}>
                        Revoke
                      </Button>
                    }
                    title="Revoke this session?"
                    description={`${s.deviceLabel ?? 'This device'} will be signed out immediately.`}
                    confirmLabel="Revoke session"
                    destructive
                    onConfirm={() =>
                      revoke.mutate(s.id, {
                        onSuccess: () => toast.success('Session revoked'),
                        onError: () => toast.error('Could not revoke the session'),
                      })
                    }
                  />
                ),
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

const OUTCOME: Record<string, { tone: StatusTone; label: string }> = {
  SUCCESS: { tone: 'success', label: 'Signed in' },
  INVALID_CREDENTIALS: { tone: 'danger', label: 'Wrong password' },
  LOCKED: { tone: 'warning', label: 'Blocked (locked)' },
  INACTIVE: { tone: 'warning', label: 'Blocked (inactive)' },
  UNKNOWN_USER: { tone: 'neutral', label: 'Not activated' },
};

function LoginHistoryCard() {
  const history = useLoginHistory();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent sign-in activity</CardTitle>
        <CardDescription>The last 50 sign-in attempts on your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable<LoginAttemptDto>
          caption="Recent sign-in activity"
          isLoading={history.isPending}
          error={history.error}
          onRetry={() => void history.refetch()}
          rows={history.data}
          rowKey={(a) => a.id}
          emptyTitle="No sign-in activity yet"
          columns={[
            {
              key: 'outcome',
              header: 'Result',
              cell: (a) => {
                const o = OUTCOME[a.outcome] ?? { tone: 'neutral' as const, label: a.outcome };
                return <StatusBadge tone={o.tone}>{o.label}</StatusBadge>;
              },
            },
            { key: 'device', header: 'Device', cell: (a) => a.deviceLabel ?? 'Unknown device' },
            { key: 'ip', header: 'IP address', cell: (a) => a.ip ?? '—', hideOnMobile: true },
            { key: 'when', header: 'When', cell: (a) => formatDateTime(a.createdAt) },
          ]}
        />
      </CardContent>
    </Card>
  );
}

export function AccountSecurityPage() {
  return (
    <>
      <PageHeader
        title="Account security"
        description="Manage your password and the devices signed in to your account."
      />
      <div className="grid gap-6 [&>*]:min-w-0">
        <ChangePasswordCard />
        <SessionsCard />
        <LoginHistoryCard />
      </div>
    </>
  );
}
