import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from '@/services/http';
import type {
  AdminDetail,
  AdminListItem,
  FacultyDetail,
  FacultyListItem,
  RoleAssignment,
  StudentDetail,
  StudentListItem,
} from './types';

type Params = Record<string, string | number | undefined>;
const clean = (p: Params) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined));
type Body = Record<string, unknown>;

export const peopleKeys = {
  all: ['people'] as const,
  students: (p: object) => ['people', 'students', p] as const,
  student: (id: string) => ['people', 'student', id] as const,
  me: ['people', 'me'] as const,
  faculty: (p: object) => ['people', 'faculty', p] as const,
  facultyMember: (id: string) => ['people', 'faculty-member', id] as const,
  admins: (p: object) => ['people', 'admins', p] as const,
  admin: (id: string) => ['people', 'admin', id] as const,
  roles: (userId: string) => ['people', 'roles', userId] as const,
};

export const useStudents = (p: Params) =>
  useQuery({
    queryKey: peopleKeys.students(clean(p)),
    queryFn: () => apiGetPage<StudentListItem>('/students', { params: clean(p) }),
    placeholderData: keepPreviousData,
  });
export const useStudent = (id: string) =>
  useQuery({
    queryKey: peopleKeys.student(id),
    queryFn: () => apiGet<StudentDetail>(`/students/${id}`),
  });
export const useMyStudentRecord = () =>
  useQuery({
    queryKey: [...peopleKeys.me, 'student'],
    queryFn: () => apiGet<StudentDetail>('/students/me'),
  });

export const useFacultyList = (p: Params) =>
  useQuery({
    queryKey: peopleKeys.faculty(clean(p)),
    queryFn: () => apiGetPage<FacultyListItem>('/faculty', { params: clean(p) }),
    placeholderData: keepPreviousData,
  });
/** Faculty of a department, for head-of-department pickers (directory fields). */
export const useFacultyDirectory = (p: Params, enabled = true) =>
  useQuery({
    queryKey: ['people', 'directory', clean(p)],
    queryFn: () => apiGetPage<FacultyDetail>('/faculty/directory', { params: clean(p) }),
    enabled,
  });
export const useFacultyMember = (id: string) =>
  useQuery({
    queryKey: peopleKeys.facultyMember(id),
    queryFn: () => apiGet<FacultyDetail>(`/faculty/${id}`),
  });
export const useMyFacultyRecord = () =>
  useQuery({
    queryKey: [...peopleKeys.me, 'faculty'],
    queryFn: () => apiGet<FacultyDetail>('/faculty/me'),
  });

export const useAdministrators = (p: Params) =>
  useQuery({
    queryKey: peopleKeys.admins(clean(p)),
    queryFn: () => apiGetPage<AdminListItem>('/administrators', { params: clean(p) }),
    placeholderData: keepPreviousData,
  });
export const useAdministrator = (id: string) =>
  useQuery({
    queryKey: peopleKeys.admin(id),
    queryFn: () => apiGet<AdminDetail>(`/administrators/${id}`),
  });

export const useUserRoles = (userId: string | undefined) =>
  useQuery({
    queryKey: peopleKeys.roles(userId ?? ''),
    queryFn: () => apiGet<RoleAssignment[]>(`/users/${userId}/roles`),
    enabled: !!userId,
  });

function usePeopleMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: peopleKeys.all });
      await qc.invalidateQueries({ queryKey: ['structure'] });
    },
  });
}

export const useSaveStudent = () =>
  usePeopleMutation(({ id, ...body }: { id?: string } & Body) =>
    id
      ? apiPatch<StudentDetail>(`/students/${id}`, body)
      : apiPost<StudentDetail>('/students', body),
  );
export const useChangeProgram = (id: string) =>
  usePeopleMutation((body: Body) => apiPost<StudentDetail>(`/students/${id}/change-program`, body));
export const useStudentStatus = (id: string) =>
  usePeopleMutation((body: Body) => apiPost<StudentDetail>(`/students/${id}/status`, body));
export const usePlaceHold = (id: string) =>
  usePeopleMutation((body: Body) => apiPost<StudentDetail>(`/students/${id}/holds`, body));
export const useReleaseHold = (id: string) =>
  usePeopleMutation(({ holdId, ...body }: { holdId: string } & Body) =>
    apiPost<StudentDetail>(`/students/${id}/holds/${holdId}/release`, body),
  );
export const useUpdateMyStudent = () =>
  usePeopleMutation((body: Body) => apiPatch<StudentDetail>('/students/me', body));

export const useSaveFaculty = () =>
  usePeopleMutation(({ id, ...body }: { id?: string } & Body) =>
    id ? apiPatch<FacultyDetail>(`/faculty/${id}`, body) : apiPost<FacultyDetail>('/faculty', body),
  );
export const useUpdateMyFaculty = () =>
  usePeopleMutation((body: Body) => apiPatch<FacultyDetail>('/faculty/me', body));

export const useSaveAdministrator = () =>
  usePeopleMutation(({ id, ...body }: { id?: string } & Body) =>
    id
      ? apiPatch<AdminDetail>(`/administrators/${id}`, body)
      : apiPost<AdminDetail>('/administrators', body),
  );

export const useAccountStatus = (userId: string) =>
  usePeopleMutation((body: { status: string; reason: string }) =>
    apiPost<{ status: string }>(`/users/${userId}/status`, body),
  );
export const useResendInvite = (userId: string) =>
  usePeopleMutation(() => apiPost(`/users/${userId}/resend-invite`));
export const useUnlockUser = (userId: string) =>
  usePeopleMutation(() => apiPost(`/users/${userId}/unlock`));
export const useResetUserMfa = (userId: string) =>
  usePeopleMutation(() => apiPost(`/users/${userId}/mfa/reset`));
export const useRevokeUserSessions = (userId: string) =>
  usePeopleMutation(() => apiDelete<{ sessionsRevoked: number }>(`/users/${userId}/sessions`));
export const useAssignRole = (userId: string) =>
  usePeopleMutation((body: { roleId: string; scopeType: string; scopeId?: string | null }) =>
    apiPost(`/users/${userId}/roles`, body),
  );
export const useRevokeRole = (userId: string) =>
  usePeopleMutation((assignmentId: string) => apiDelete(`/users/${userId}/roles/${assignmentId}`));
