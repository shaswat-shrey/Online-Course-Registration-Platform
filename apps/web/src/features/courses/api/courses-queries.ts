import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost, apiPut } from '@/services/http';
import type {
  Classroom,
  ClassroomBooking,
  Course,
  CourseDetail,
  RollForwardResult,
  ScheduleResult,
  Section,
} from './types';

type Params = Record<string, string | number | boolean | undefined>;
const clean = (p: Params) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined));
type Body = Record<string, unknown>;

export const catalogKeys = {
  all: ['catalog'] as const,
  courses: (p: object) => ['catalog', 'courses', p] as const,
  course: (id: string) => ['catalog', 'course', id] as const,
  classrooms: (p: object) => ['catalog', 'classrooms', p] as const,
  classroom: (id: string) => ['catalog', 'classroom', id] as const,
  sections: (p: object) => ['catalog', 'sections', p] as const,
  section: (id: string) => ['catalog', 'section', id] as const,
};

export const useCourses = (p: Params, enabled = true) =>
  useQuery({
    queryKey: catalogKeys.courses(clean(p)),
    queryFn: () => apiGetPage<Course>('/courses', { params: clean(p) }),
    placeholderData: keepPreviousData,
    enabled,
  });
export const useCourse = (id: string) =>
  useQuery({
    queryKey: catalogKeys.course(id),
    queryFn: () => apiGet<CourseDetail>(`/courses/${id}`),
  });

export const useClassrooms = (p: Params) =>
  useQuery({
    queryKey: catalogKeys.classrooms(clean(p)),
    queryFn: () => apiGetPage<Classroom>('/classrooms', { params: clean(p) }),
    placeholderData: keepPreviousData,
  });
export const useClassroom = (id: string) =>
  useQuery({
    queryKey: catalogKeys.classroom(id),
    queryFn: () => apiGet<Classroom>(`/classrooms/${id}`),
  });
export const useClassroomSchedule = (id: string, sessionId: string) =>
  useQuery({
    queryKey: [...catalogKeys.classroom(id), 'schedule', sessionId],
    queryFn: () =>
      apiGet<ClassroomBooking[]>(`/classrooms/${id}/schedule`, { params: { sessionId } }),
    enabled: !!sessionId,
  });

export const useSections = (p: Params, enabled = true) =>
  useQuery({
    queryKey: catalogKeys.sections(clean(p)),
    queryFn: () => apiGetPage<Section>('/course-sections', { params: clean(p) }),
    placeholderData: keepPreviousData,
    enabled,
  });
export const useSection = (id: string) =>
  useQuery({
    queryKey: catalogKeys.section(id),
    queryFn: () => apiGet<Section>(`/course-sections/${id}`),
  });

export const useFacultySchedule = (facultyId: string, sessionId: string) =>
  useQuery({
    queryKey: ['catalog', 'faculty-schedule', facultyId, sessionId],
    queryFn: () =>
      apiGet<{
        sections: Array<Section & { role: string }>;
        totalCredits: number;
        maxLoadCredits: number | null;
      }>(`/faculty/${facultyId}/schedule`, { params: { sessionId } }),
    enabled: !!facultyId && !!sessionId,
  });

/** Mutation that refreshes every catalog query (and programs, which list requirement courses). */
function useCatalogMutation<TInput, TResult>(fn: (input: TInput) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: catalogKeys.all });
      void qc.invalidateQueries({ queryKey: ['structure'] });
    },
  });
}

export const useSaveCourse = () =>
  useCatalogMutation(({ id, ...body }: { id?: string } & Body) =>
    id ? apiPatch<CourseDetail>(`/courses/${id}`, body) : apiPost<CourseDetail>('/courses', body),
  );
export const useDeleteCourse = () =>
  useCatalogMutation((id: string) => apiDelete(`/courses/${id}`));
export const useSetCourseRelation = (courseId: string) =>
  useCatalogMutation(
    ({
      relation,
      body,
    }: {
      relation: 'prerequisites' | 'corequisites' | 'programs' | 'specializations' | 'restrictions';
      body: Body;
    }) => apiPut<CourseDetail>(`/courses/${courseId}/${relation}`, body),
  );
export const useSetRequirementCourses = () =>
  useCatalogMutation(({ groupId, courseIds }: { groupId: string; courseIds: string[] }) =>
    apiPut(`/requirement-groups/${groupId}/courses`, { courseIds }),
  );

export const useSaveClassroom = () =>
  useCatalogMutation(({ id, ...body }: { id?: string } & Body) =>
    id ? apiPatch<Classroom>(`/classrooms/${id}`, body) : apiPost<Classroom>('/classrooms', body),
  );
export const useDeleteClassroom = () =>
  useCatalogMutation((id: string) => apiDelete(`/classrooms/${id}`));

export const useSaveSection = () =>
  useCatalogMutation(({ id, ...body }: { id?: string } & Body) =>
    id
      ? apiPatch<Section>(`/course-sections/${id}`, body)
      : apiPost<Section>('/course-sections', body),
  );
export const useDeleteSection = () =>
  useCatalogMutation((id: string) => apiDelete(`/course-sections/${id}`));
export const useSetSectionSchedule = (sectionId: string) =>
  useCatalogMutation(({ part, body }: { part: 'meetings' | 'instructors'; body: Body }) =>
    apiPut<ScheduleResult>(`/course-sections/${sectionId}/${part}`, body),
  );
export const useSetSectionRestrictions = (sectionId: string) =>
  useCatalogMutation((body: Body) =>
    apiPut<Section>(`/course-sections/${sectionId}/restrictions`, body),
  );
export const useTransitionSection = (sectionId: string) =>
  useCatalogMutation((body: { action: string; reason?: string }) =>
    apiPost<Section>(`/course-sections/${sectionId}/transition`, body),
  );
export const useRollForward = () =>
  useCatalogMutation((body: Body) =>
    apiPost<RollForwardResult>('/course-sections/roll-forward', body),
  );
