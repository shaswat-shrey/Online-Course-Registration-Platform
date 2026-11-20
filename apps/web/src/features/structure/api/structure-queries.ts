import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost, apiPut } from '@/services/http';
import type {
  Campus,
  Degree,
  Department,
  Program,
  RequirementGroup,
  School,
  Specialization,
  University,
} from './types';

export const structureKeys = {
  all: ['structure'] as const,
  university: ['structure', 'university'] as const,
  campuses: ['structure', 'campuses'] as const,
  schools: (params: object) => ['structure', 'schools', params] as const,
  school: (id: string) => ['structure', 'school', id] as const,
  departments: (params: object) => ['structure', 'departments', params] as const,
  department: (id: string) => ['structure', 'department', id] as const,
  degrees: ['structure', 'degrees'] as const,
  programs: (params: object) => ['structure', 'programs', params] as const,
  program: (id: string) => ['structure', 'program', id] as const,
};

type Params = Record<string, string | number | undefined>;
const clean = (p: Params) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined));

export const useUniversityProfile = () =>
  useQuery({
    queryKey: structureKeys.university,
    queryFn: () => apiGet<University>('/university'),
  });
export const useCampuses = () =>
  useQuery({ queryKey: structureKeys.campuses, queryFn: () => apiGet<Campus[]>('/campuses') });

export const useSchools = (params: Params) =>
  useQuery({
    queryKey: structureKeys.schools(clean(params)),
    queryFn: () => apiGetPage<School>('/schools', { params: clean(params) }),
    placeholderData: keepPreviousData,
  });
export const useSchool = (id: string) =>
  useQuery({ queryKey: structureKeys.school(id), queryFn: () => apiGet<School>(`/schools/${id}`) });

export const useDepartments = (params: Params) =>
  useQuery({
    queryKey: structureKeys.departments(clean(params)),
    queryFn: () => apiGetPage<Department>('/departments', { params: clean(params) }),
    placeholderData: keepPreviousData,
  });
export const useDepartment = (id: string) =>
  useQuery({
    queryKey: structureKeys.department(id),
    queryFn: () => apiGet<Department>(`/departments/${id}`),
  });

export const useDegrees = () =>
  useQuery({ queryKey: structureKeys.degrees, queryFn: () => apiGet<Degree[]>('/degrees') });

export const usePrograms = (params: Params) =>
  useQuery({
    queryKey: structureKeys.programs(clean(params)),
    queryFn: () => apiGetPage<Program>('/programs', { params: clean(params) }),
    placeholderData: keepPreviousData,
  });
export const useProgram = (id: string) =>
  useQuery({
    queryKey: structureKeys.program(id),
    queryFn: () => apiGet<Program>(`/programs/${id}`),
  });

/** Options for pickers: all active schools/departments (structure lists are small). */
export const useSchoolOptions = () => useSchools({ limit: 100, status: 'ACTIVE' });
export const useDepartmentOptions = (schoolId?: string) =>
  useDepartments({ limit: 100, status: 'ACTIVE', schoolId });

/** Mutation that invalidates every structure query on success. */
function useStructureMutation<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
  extraKeys: QueryKey[] = [],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: structureKeys.all });
      for (const key of extraKeys) await qc.invalidateQueries({ queryKey: key });
    },
  });
}

export const useUpdateUniversity = () =>
  useStructureMutation((input: object) => apiPatch<University>('/university', input));
export const useSaveCampus = () =>
  useStructureMutation(({ id, ...input }: { id?: string; [key: string]: unknown }) =>
    id ? apiPatch<Campus>(`/campuses/${id}`, input) : apiPost<Campus>('/campuses', input),
  );
export const useDeleteCampus = () =>
  useStructureMutation((id: string) => apiDelete(`/campuses/${id}`));

export const useSaveSchool = () =>
  useStructureMutation(({ id, ...input }: { id?: string; [key: string]: unknown }) =>
    id ? apiPatch<School>(`/schools/${id}`, input) : apiPost<School>('/schools', input),
  );
export const useDeleteSchool = () =>
  useStructureMutation((id: string) => apiDelete(`/schools/${id}`));

export const useSaveDepartment = () =>
  useStructureMutation(({ id, ...input }: { id?: string; [key: string]: unknown }) =>
    id
      ? apiPatch<Department>(`/departments/${id}`, input)
      : apiPost<Department>('/departments', input),
  );
export const useDeleteDepartment = () =>
  useStructureMutation((id: string) => apiDelete(`/departments/${id}`));

export const useSaveDegree = () =>
  useStructureMutation(({ id, ...input }: { id?: string; [key: string]: unknown }) =>
    id ? apiPatch<Degree>(`/degrees/${id}`, input) : apiPost<Degree>('/degrees', input),
  );
export const useDeleteDegree = () =>
  useStructureMutation((id: string) => apiDelete(`/degrees/${id}`));

export const useSaveProgram = () =>
  useStructureMutation(({ id, ...input }: { id?: string; [key: string]: unknown }) =>
    id ? apiPatch<Program>(`/programs/${id}`, input) : apiPost<Program>('/programs', input),
  );
export const useDeleteProgram = () =>
  useStructureMutation((id: string) => apiDelete(`/programs/${id}`));

export const useSaveSpecialization = () =>
  useStructureMutation(({ id, ...input }: { id?: string; [key: string]: unknown }) =>
    id
      ? apiPatch<Specialization>(`/specializations/${id}`, input)
      : apiPost<Specialization>('/specializations', input),
  );
export const useDeleteSpecialization = () =>
  useStructureMutation((id: string) => apiDelete(`/specializations/${id}`));

export const useSaveRequirementGroup = () =>
  useStructureMutation(
    ({
      id,
      owner,
      ...input
    }: {
      id?: string;
      owner?: { programId: string } | { specializationId: string };
      [key: string]: unknown;
    }) => {
      if (id) return apiPut<RequirementGroup>(`/requirement-groups/${id}`, input);
      const url =
        owner && 'programId' in owner
          ? `/programs/${owner.programId}/requirement-groups`
          : `/specializations/${(owner as { specializationId: string }).specializationId}/requirement-groups`;
      return apiPost<RequirementGroup>(url, input);
    },
  );
export const useDeleteRequirementGroup = () =>
  useStructureMutation((id: string) => apiDelete(`/requirement-groups/${id}`));
