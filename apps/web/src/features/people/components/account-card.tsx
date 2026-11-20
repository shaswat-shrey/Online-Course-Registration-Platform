import { Ban, KeyRound, LogOut, Mail, RotateCcw, ShieldCheck, Unlock } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { accountStatusSchema } from '@ucrams/shared';
import { TextareaField } from '@/components/forms/fields';
import { FormDialog } from '@/components/forms/form-dialog';
import { applyServerErrors } from '@/components/forms/server-errors';
import { useZodForm } from '@/components/forms/use-zod-form';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailList } from '@/components/shared/detail-list';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/services/api-error';
import { useAuthStore, useCan } from '@/store/auth-store';
import { formatDateTime } from '@/utils/format';
import {
  useAccountStatus,
  useResendInvite,
  useRevokeUserSessions,
  useUnlockUser,
} from '../api/people-queries';
import { ACCOUNT_STATUS_LABEL, type AccountSummary } from '../api/types';

const TONE: Record<string, StatusTone> = {
  INVITED: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  DEACTIVATED: 'neutral',
};

function StatusChangeDialog({
  userId,
  status,
  trigger,
  title,
  description,
}: {
  userId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  trigger: (open: () => void) => ReactNode;
  title: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = useAccountStatus(userId);
  const form = useZodForm(accountStatusSchema, { status, reason: '' });
  return (
    <>
      {trigger(() => {
        form.reset({ status, reason: '' });
        setError(null);
        setOpen(true);
      })}
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        submitLabel={title}
        submitting={change.isPending}
        error={error}
        onSubmit={form.handleSubmit((v) =>
          change.mutate(v, {
            onSuccess: () => {
              toast.success('Account status changed');
              setOpen(false);
            },
            onError: (e) => setError(applyServerErrors(e, form.setError, ['reason'])),
          }),
        )}
      >
        <TextareaField
          control={form.control}
          name="reason"
          label="Reason (recorded in the audit log)"
          rows={3}
        />
      </FormDialog>
    </>
  );
}

/** Account state and administrative actions shared by student, faculty and admin pages. */
export function AccountCard({
  userId,
  account,
  canManage,
}: {
  userId: string;
  account: AccountSummary;
  canManage: boolean;
}) {
  const self = useAuthStore((s) => s.me?.user.id) === userId;
  const canInvite = useCan('user:create');
  const canSessions = useCan('user:revoke_sessions');
  const resend = useResendInvite(userId);
  const unlock = useUnlockUser(userId);
  const revoke = useRevokeUserSessions(userId);
  const done = (msg: string) => ({
    onSuccess: () => toast.success(msg),
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-brand" /> Account
        </CardTitle>
        <CardDescription>Sign-in access to the platform.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <DetailList
          items={[
            {
              label: 'Status',
              value: (
                <StatusBadge tone={TONE[account.status] ?? 'neutral'}>
                  {ACCOUNT_STATUS_LABEL[account.status]}
                </StatusBadge>
              ),
            },
            {
              label: 'Last sign-in',
              value: account.lastLoginAt ? formatDateTime(account.lastLoginAt) : 'Never',
            },
            { label: 'Active sessions', value: account.activeSessions },
            {
              label: 'Locked out',
              value: account.locked ? <StatusBadge tone="warning">Locked</StatusBadge> : 'No',
            },
          ]}
        />
        {!self && (
          <div className="flex flex-wrap gap-2">
            {account.status === 'INVITED' && canInvite && (
              <Button
                variant="outline"
                size="sm"
                disabled={resend.isPending}
                onClick={() => resend.mutate(undefined, done('Invitation sent'))}
              >
                <Mail className="size-4" /> Resend invitation
              </Button>
            )}
            {account.locked && canManage && (
              <Button
                variant="outline"
                size="sm"
                disabled={unlock.isPending}
                onClick={() => unlock.mutate(undefined, done('Account unlocked'))}
              >
                <Unlock className="size-4" /> Unlock
              </Button>
            )}
            {account.activeSessions > 0 && canSessions && (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm">
                    <LogOut className="size-4" /> Sign out everywhere
                  </Button>
                }
                title="Sign this person out of every device?"
                description="They will need to sign in again."
                confirmLabel="Sign out everywhere"
                onConfirm={() => revoke.mutate(undefined, done('Sessions revoked'))}
              />
            )}
            {canManage && (account.status === 'ACTIVE' || account.status === 'INVITED') && (
              <StatusChangeDialog
                userId={userId}
                status="SUSPENDED"
                title="Suspend account"
                description="The person is signed out immediately and cannot sign in until reactivated."
                trigger={(open) => (
                  <Button variant="outline" size="sm" onClick={open}>
                    <Ban className="size-4" /> Suspend
                  </Button>
                )}
              />
            )}
            {canManage && (account.status === 'SUSPENDED' || account.status === 'DEACTIVATED') && (
              <StatusChangeDialog
                userId={userId}
                status="ACTIVE"
                title="Reactivate account"
                description="The person can sign in again."
                trigger={(open) => (
                  <Button variant="outline" size="sm" onClick={open}>
                    <RotateCcw className="size-4" /> Reactivate
                  </Button>
                )}
              />
            )}
            {canManage && account.status !== 'DEACTIVATED' && (
              <StatusChangeDialog
                userId={userId}
                status="DEACTIVATED"
                title="Deactivate account"
                description="Use when someone leaves the university. Their records are kept."
                trigger={(open) => (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={open}>
                    <KeyRound className="size-4" /> Deactivate
                  </Button>
                )}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
