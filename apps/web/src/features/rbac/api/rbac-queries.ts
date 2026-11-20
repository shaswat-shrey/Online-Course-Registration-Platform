import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost, apiPut } from '@/services/http';

export interface RoleDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  scopeMode: 'ORGANIZATIONAL' | 'RELATIONSHIP';
  permissions: string[];
  assignmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionDto {
  key: string;
  resource: string;
  action: string;
  description: string;
}

export const rbacKeys = {
  roles: ['rbac', 'roles'] as const,
  role: (id: string) => ['rbac', 'roles', id] as const,
  permissions: ['rbac', 'permissions'] as const,
};

export const useRoles = () =>
  useQuery({ queryKey: rbacKeys.roles, queryFn: () => apiGet<RoleDto[]>('/roles') });
export const useRole = (id: string) =>
  useQuery({ queryKey: rbacKeys.role(id), queryFn: () => apiGet<RoleDto>(`/roles/${id}`) });
export const usePermissions = () =>
  useQuery({
    queryKey: rbacKeys.permissions,
    queryFn: () => apiGet<PermissionDto[]>('/permissions'),
    staleTime: 10 * 60_000,
  });

export function useSetRolePermissions(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (permissions: string[]) =>
      apiPut<RoleDto>(`/roles/${id}/permissions`, { permissions }),
    onSuccess: (role) => {
      qc.setQueryData(rbacKeys.role(id), role);
      void qc.invalidateQueries({ queryKey: rbacKeys.roles });
    },
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      key: string;
      name: string;
      description?: string;
      permissions: string[];
    }) => apiPost<RoleDto>('/roles', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: rbacKeys.roles }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: rbacKeys.roles }),
  });
}
