import { Plus, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { SelectField } from '@/components/forms/fields';
import { FormDialog } from '@/components/forms/form-dialog';
import { applyServerErrors } from '@/components/forms/server-errors';
import { useZodForm } from '@/components/forms/use-zod-form';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { LoadingRows } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRoles } from '@/features/rbac/api/rbac-queries';
import { useDepartmentOptions, useSchoolOptions } from '@/features/structure/api/structure-queries';
import { errorMessage } from '@/services/api-error';
import { useCan } from '@/store/auth-store';
import { SCOPE_LABEL } from '@/utils/format';
import { useAssignRole, useRevokeRole, useUserRoles } from '../api/people-queries';

const assignSchema = z
  .object({
    roleId: z.uuid('Choose a role'),
    scopeType: z.enum(['GLOBAL', 'SCHOOL', 'DEPARTMENT']),
    scopeId: z.string().nullable(),
  })
  .refine((v) => v.scopeType === 'GLOBAL' || !!v.scopeId, {
    path: ['scopeId'],
    message: 'Choose where this role applies',
  });

export function ScopeFields({
  control,
  scopeType,
}: {
  control: Parameters<typeof SelectField>[0]['control'];
  scopeType: string;
}) {
  const schools = useSchoolOptions();
  const departments = useDepartmentOptions();
  return (
    <>
      <SelectField
        control={control}
        name="scopeType"
        label="Applies to"
        options={[
          { value: 'GLOBAL', label: 'The whole university' },
          { value: 'SCHOOL', label: 'One faculty / school' },
          { value: 'DEPARTMENT', label: 'One department' },
        ]}
      />
      {scopeType === 'SCHOOL' && (
        <SelectField
          control={control}
          name="scopeId"
          label="Faculty / school"
          options={(schools.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
      )}
      {scopeType === 'DEPARTMENT' && (
        <SelectField
          control={control}
          name="scopeId"
          label="Department"
          options={(departments.data?.data ?? []).map((d) => ({
            value: d.id,
            label: `${d.name} (${d.code})`,
          }))}
        />
      )}
    </>
  );
}

function AssignRoleDialog({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roles = useRoles();
  const assign = useAssignRole(userId);
  const form = useZodForm(assignSchema, { roleId: '', scopeType: 'GLOBAL', scopeId: null });
  const scopeType = form.watch('scopeType');
  const roleId = form.watch('roleId');
  const relationship = roles.data?.find((r) => r.id === roleId)?.scopeMode === 'RELATIONSHIP';
  useEffect(() => {
    if (relationship) form.setValue('scopeType', 'GLOBAL');
  }, [relationship, form]);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          form.reset();
          setError(null);
          setOpen(true);
        }}
      >
        <Plus className="size-4" /> Assign role
      </Button>
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="Assign a role"
        description="You can only assign roles whose permissions you hold where they apply."
        submitLabel="Assign"
        submitting={assign.isPending}
        error={error}
        onSubmit={form.handleSubmit((v) =>
          assign.mutate(
            {
              roleId: v.roleId,
              scopeType: v.scopeType,
              ...(v.scopeType === 'GLOBAL' ? {} : { scopeId: v.scopeId }),
            },
            {
              onSuccess: () => {
                toast.success('Role assigned');
                setOpen(false);
              },
              onError: (e) => setError(applyServerErrors(e, form.setError, ['roleId', 'scopeId'])),
            },
          ),
        )}
      >
        <SelectField
          control={form.control}
          name="roleId"
          label="Role"
          options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
        />
        {relationship ? (
          <p className="text-sm text-muted-foreground">
            This role applies to the person’s own sections and records.
          </p>
        ) : (
          <ScopeFields control={form.control as never} scopeType={scopeType} />
        )}
      </FormDialog>
    </>
  );
}

/** Role assignments of a user, with assign/revoke for administrators. */
export function RolesCard({ userId }: { userId: string }) {
  const roles = useUserRoles(userId);
  const canAssign = useCan('user:assign_roles');
  const canSeeRoles = useCan('rbac:read');
  const revoke = useRevokeRole(userId);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-brand" /> Roles
        </CardTitle>
        {canAssign && canSeeRoles && <AssignRoleDialog userId={userId} />}
      </CardHeader>
      <CardContent>
        {roles.isPending ? (
          <LoadingRows rows={2} />
        ) : roles.isError ? (
          <p className="text-sm text-muted-foreground">{errorMessage(roles.error)}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {roles.data.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.roleName}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.scopeMode === 'RELATIONSHIP'
                      ? 'Own records only'
                      : r.scopeName
                        ? `${SCOPE_LABEL[r.scopeType]}: ${r.scopeName}`
                        : SCOPE_LABEL[r.scopeType]}
                  </p>
                </div>
                {canAssign && (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Remove ${r.roleName}`}>
                        <X className="size-4" />
                      </Button>
                    }
                    title={`Remove the ${r.roleName} role?`}
                    description="The person loses these permissions on their next request."
                    confirmLabel="Remove role"
                    destructive
                    onConfirm={() =>
                      revoke.mutate(r.id, {
                        onSuccess: () => toast.success('Role removed'),
                        onError: (e) => toast.error(errorMessage(e)),
                      })
                    }
                  />
                )}
              </li>
            ))}
            {roles.data.length === 0 && (
              <li className="px-3 py-2.5 text-sm text-muted-foreground">No roles assigned.</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
