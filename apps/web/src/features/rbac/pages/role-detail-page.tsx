import { Loader2, Lock, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { ErrorState, LoadingRows } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FormAlert } from '@/components/forms/form-alert';
import { errorMessage } from '@/services/api-error';
import { useCan } from '@/store/auth-store';
import {
  useDeleteRole,
  usePermissions,
  useRole,
  useSetRolePermissions,
  type PermissionDto,
  type RoleDto,
} from '../api/rbac-queries';

const RESOURCE_LABEL = (r: string) => r.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function RoleDetailPage() {
  const { roleId = '' } = useParams();
  const role = useRole(roleId);
  const permissions = usePermissions();

  if (role.isPending || permissions.isPending) return <LoadingRows rows={6} />;
  if (role.isError || permissions.isError) {
    return (
      <ErrorState error={role.error ?? permissions.error} onRetry={() => void role.refetch()} />
    );
  }
  // Keyed so local edits reset whenever the server version of the role changes.
  return (
    <RoleEditor
      key={`${role.data.id}:${role.data.updatedAt}`}
      role={role.data}
      catalog={permissions.data}
    />
  );
}

function RoleEditor({ role: r, catalog }: { role: RoleDto; catalog: PermissionDto[] }) {
  const navigate = useNavigate();
  const canManage = useCan('rbac:manage');
  const save = useSetRolePermissions(r.id);
  const remove = useDeleteRole();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(r.permissions));

  const groups = useMemo(() => {
    const map = new Map<string, PermissionDto[]>();
    for (const p of catalog) map.set(p.resource, [...(map.get(p.resource) ?? []), p]);
    return [...map.entries()];
  }, [catalog]);

  const locked = r.key === 'SUPER_ADMIN';
  const editable = canManage && !locked;
  const original = new Set(r.permissions);
  const added = [...selected].filter((k) => !original.has(k));
  const removed = [...original].filter((k) => !selected.has(k));
  const dirty = added.length + removed.length > 0;

  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <>
      <PageHeader
        title={r.name}
        description={r.description ?? undefined}
        actions={
          canManage && !r.isSystem ? (
            <ConfirmDialog
              trigger={
                <Button variant="outline" disabled={remove.isPending}>
                  <Trash2 className="size-4" /> Delete role
                </Button>
              }
              title={`Delete “${r.name}”?`}
              description={
                r.assignmentCount > 0
                  ? `This role is assigned ${r.assignmentCount} time(s). Remove the assignments first.`
                  : 'This cannot be undone.'
              }
              confirmLabel="Delete role"
              destructive
              onConfirm={() =>
                remove.mutate(r.id, {
                  onSuccess: () => {
                    toast.success('Role deleted');
                    navigate('/admin/roles');
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            />
          ) : undefined
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs text-muted-foreground">{r.key}</span>
        <StatusBadge tone={r.isSystem ? 'info' : 'neutral'}>
          {r.isSystem ? 'System role' : 'Custom role'}
        </StatusBadge>
        {r.scopeMode === 'RELATIONSHIP' && (
          <StatusBadge tone="neutral">
            Applies only to the holder’s own sections and records
          </StatusBadge>
        )}
        <span className="text-muted-foreground">
          {selected.size} of {catalog.length} permissions · {r.assignmentCount} assignment(s)
        </span>
      </div>
      {locked && (
        <div className="mb-4">
          <FormAlert>
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3.5" /> The Super Administrator role always has every
              administrative permission and cannot be edited.
            </span>
          </FormAlert>
        </div>
      )}
      {save.isError && (
        <div className="mb-4">
          <FormAlert>{errorMessage(save.error)}</FormAlert>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map(([resource, perms]) => (
          <Card key={resource}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{RESOURCE_LABEL(resource)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {perms.map((p) => (
                <label key={p.key} className="flex items-start gap-3 text-sm">
                  <Checkbox
                    checked={selected.has(p.key)}
                    disabled={!editable}
                    onCheckedChange={(v) => toggle(p.key, v === true)}
                    aria-describedby={`perm-${p.key}`}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-mono text-xs">{p.key}</span>
                    <span id={`perm-${p.key}`} className="block text-muted-foreground">
                      {p.description}
                    </span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
      {editable && dirty && (
        <div className="sticky bottom-4 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-lg">
          <p className="text-sm">
            <strong>{added.length}</strong> added, <strong>{removed.length}</strong> removed. People
            with this role must sign in again or refresh to pick up changes.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSelected(new Set(r.permissions))}>
              Discard
            </Button>
            <ConfirmDialog
              trigger={
                <Button disabled={save.isPending}>
                  {save.isPending && <Loader2 className="size-4 animate-spin" />}Save changes
                </Button>
              }
              title={`Update permissions for “${r.name}”?`}
              description={`This affects ${r.assignmentCount} assignment(s) immediately.`}
              confirmLabel="Save changes"
              onConfirm={() =>
                save.mutate([...selected], {
                  onSuccess: () => toast.success('Permissions updated'),
                })
              }
            />
          </div>
        </div>
      )}
    </>
  );
}
