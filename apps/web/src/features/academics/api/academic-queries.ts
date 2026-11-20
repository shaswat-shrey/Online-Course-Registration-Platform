import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssessmentInput,
  AssessmentType,
  AttendanceStatus,
  ExternalRecordInput,
  GradeSubmissionStatus,
} from '@ucrams/shared';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/services/http';

export interface ClassMember {
  registrationId: string;
  registrationStatus: string;
  credits: number;
  studentId: string;
  userId: string;
  studentNumber: string;
  name: string;
}
export interface AttendanceRegister {
  enabled: boolean;
  canManage: boolean;
  students: Array<ClassMember & { percent: number | null }>;
  sessions: Array<{
    id: string;
    date: string;
    startMinute: number | null;
    topic: string | null;
    marked: number;
    records: Array<{ studentId: string; status: AttendanceStatus; note: string | null }>;
  }>;
}
export interface MyAttendance {
  enabled: boolean;
  percent: number | null;
  sessions: Array<{
    id: string;
    date: string;
    startMinute: number | null;
    topic: string | null;
    status: AttendanceStatus | null;
  }>;
}
export interface Assessment {
  id: string;
  title: string;
  type: AssessmentType;
  weight: number;
  maxScore: number;
  dueAt: string | null;
  published: boolean;
  publishedAt: string | null;
  position: number;
}
export interface ScoreCell {
  score: number | null;
  excused: boolean;
  feedback: string | null;
}
export interface Gradebook {
  canManage: boolean;
  totalWeight: number;
  assessments: Assessment[];
  students: Array<
    ClassMember & { percent: number | null; scores: Record<string, ScoreCell | null> }
  >;
}
export interface MyAssessments {
  percent: number | null;
  items: Array<Assessment & ScoreCell>;
}
export interface GradeBand {
  letter: string;
  minPercent: number;
  gradePoints: number | null;
  isPassing: boolean;
  countsInGpa: boolean;
}
export interface GradeSheet {
  section: { id: string; label: string; title: string };
  scale: { name: string; bands: GradeBand[] } | null;
  status: GradeSubmissionStatus;
  submittedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  returnReason: string | null;
  postedAt: string | null;
  assessmentWeight: number;
  canEdit: boolean;
  canDecide: boolean;
  students: Array<{
    registrationId: string;
    studentId: string;
    studentNumber: string;
    name: string;
    registrationStatus: string;
    percent: number | null;
    suggested: string | null;
    gradeLetter: string | null;
    posted: boolean;
  }>;
}
export interface SubmissionSummary {
  sectionId: string;
  label: string;
  title: string;
  department: string;
  session: string;
  status: GradeSubmissionStatus;
  grades: number;
  submittedBy: string | null;
  submittedAt: string | null;
}
export interface TranscriptCourse {
  recordId: string | null;
  courseId: string;
  code: string;
  title: string;
  credits: number;
  creditsEarned: number;
  grade: string | null;
  gradePoints: number | null;
  passed: boolean;
  source: string;
  repeatedLater: boolean;
  version: number;
  institution: string | null;
}
export interface Transcript {
  university: string | null;
  repeatPolicy: 'ALL' | 'LATEST' | 'BEST';
  student: {
    id: string;
    studentNumber: string;
    name: string;
    email: string;
    status: string;
    program: { code: string; name: string };
    department: string;
    school: string;
    specialization: string | null;
    yearOfStudy: number;
  };
  sessions: Array<{
    id: string;
    name: string;
    courses: TranscriptCourse[];
    credits: number;
    gpa: number | null;
  }>;
  creditsAttempted: number;
  creditsEarned: number;
  cgpa: number | null;
  generatedAt: string;
}
export interface GradeHistory {
  id: string;
  course: { code: string; title: string };
  gradeLetter: string | null;
  gradePoints: number | null;
  version: number;
  canChange: boolean;
  letters: string[];
  changes: Array<{
    version: number;
    from: string | null;
    to: string;
    reason: string;
    by: string;
    at: string;
  }>;
}
export interface RoomAvailability {
  id: string;
  label: string;
  campus: string;
  capacity: number;
  type: string;
  utilization: number;
  busy: Array<{
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
    sectionId: string;
    label: string;
  }>;
}

export const academicKeys = {
  attendance: (id: string) => ['academics', 'attendance', id] as const,
  myAttendance: (id: string) => ['academics', 'my-attendance', id] as const,
  gradebook: (id: string) => ['academics', 'gradebook', id] as const,
  myAssessments: (id: string) => ['academics', 'my-assessments', id] as const,
  grades: (id: string) => ['academics', 'grades', id] as const,
  submissions: (status: string) => ['academics', 'submissions', status] as const,
  transcript: (who: string) => ['academics', 'transcript', who] as const,
  history: (id: string) => ['academics', 'grade-history', id] as const,
  availability: (p: object) => ['academics', 'availability', p] as const,
};

function useAcademicMutation<T, R>(fn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['academics'] });
      void qc.invalidateQueries({ queryKey: ['teaching'] });
    },
  });
}

// ----- attendance ------------------------------------------------------------------

export const useAttendance = (sectionId: string) =>
  useQuery({
    queryKey: academicKeys.attendance(sectionId),
    queryFn: () => apiGet<AttendanceRegister>(`/course-sections/${sectionId}/attendance`),
  });
export const useMyAttendance = (sectionId: string) =>
  useQuery({
    queryKey: academicKeys.myAttendance(sectionId),
    queryFn: () => apiGet<MyAttendance>(`/course-sections/${sectionId}/my-attendance`),
  });
export const useAttendanceSettings = (sectionId: string) =>
  useAcademicMutation((enabled: boolean) =>
    apiPut(`/course-sections/${sectionId}/attendance/settings`, { enabled }),
  );
export const useAddClass = (sectionId: string) =>
  useAcademicMutation((body: { date: string; startMinute: number | null; topic: string | null }) =>
    apiPost<{ id: string }>(`/course-sections/${sectionId}/attendance-sessions`, body),
  );
export const useDeleteClass = () =>
  useAcademicMutation((id: string) => apiDelete(`/attendance-sessions/${id}`));
export const useMarkAttendance = () =>
  useAcademicMutation(
    ({
      id,
      records,
    }: {
      id: string;
      records: Array<{ studentId: string; status: AttendanceStatus }>;
    }) => apiPut(`/attendance-sessions/${id}/records`, { records }),
  );

// ----- assessments -------------------------------------------------------------------

export const useGradebook = (sectionId: string) =>
  useQuery({
    queryKey: academicKeys.gradebook(sectionId),
    queryFn: () => apiGet<Gradebook>(`/course-sections/${sectionId}/gradebook`),
  });
export const useMyAssessments = (sectionId: string) =>
  useQuery({
    queryKey: academicKeys.myAssessments(sectionId),
    queryFn: () => apiGet<MyAssessments>(`/course-sections/${sectionId}/my-assessments`),
  });
export const useCreateAssessment = (sectionId: string) =>
  useAcademicMutation((body: AssessmentInput) =>
    apiPost<Assessment>(`/course-sections/${sectionId}/assessments`, body),
  );
export const useUpdateAssessment = () =>
  useAcademicMutation(({ id, ...body }: { id: string } & Record<string, unknown>) =>
    apiPatch<Assessment>(`/assessments/${id}`, body),
  );
export const useDeleteAssessment = () =>
  useAcademicMutation((id: string) => apiDelete(`/assessments/${id}`));
export const useSaveScores = () =>
  useAcademicMutation(
    ({
      id,
      scores,
    }: {
      id: string;
      scores: Array<{ studentId: string; score: number | null; excused: boolean }>;
    }) => apiPut(`/assessments/${id}/scores`, { scores }),
  );

// ----- final grades -----------------------------------------------------------------------

export const useGradeSheet = (sectionId: string) =>
  useQuery({
    queryKey: academicKeys.grades(sectionId),
    queryFn: () => apiGet<GradeSheet>(`/course-sections/${sectionId}/final-grades`),
  });
export const useSaveGrades = (sectionId: string) =>
  useAcademicMutation((grades: Array<{ registrationId: string; gradeLetter: string }>) =>
    apiPut<GradeSheet>(`/course-sections/${sectionId}/final-grades`, { grades }),
  );
export const useSubmitGrades = (sectionId: string) =>
  useAcademicMutation(() =>
    apiPost<GradeSheet>(`/course-sections/${sectionId}/final-grades/submit`),
  );
export const useApproveGrades = (sectionId: string) =>
  useAcademicMutation(() =>
    apiPost<{ posted: number }>(`/course-sections/${sectionId}/final-grades/approve`),
  );
export const useReturnGrades = (sectionId: string) =>
  useAcademicMutation((reason: string) =>
    apiPost<GradeSheet>(`/course-sections/${sectionId}/final-grades/return`, { reason }),
  );
export const useSubmissions = (status: string) =>
  useQuery({
    queryKey: academicKeys.submissions(status),
    queryFn: () => apiGet<SubmissionSummary[]>('/grade-submissions', { params: { status } }),
  });

// ----- records -----------------------------------------------------------------------------

export const useTranscript = (studentId: string | 'me') =>
  useQuery({
    queryKey: academicKeys.transcript(studentId),
    queryFn: () => apiGet<Transcript>(`/students/${studentId}/transcript`),
  });
export const useGradeHistory = (recordId: string | null) =>
  useQuery({
    queryKey: academicKeys.history(recordId ?? ''),
    queryFn: () => apiGet<GradeHistory>(`/academic-records/${recordId}/grade-history`),
    enabled: !!recordId,
  });
export const useChangeGrade = () =>
  useAcademicMutation(({ id, ...body }: { id: string; gradeLetter: string; reason: string }) =>
    apiPost<GradeHistory>(`/academic-records/${id}/grade-change`, body),
  );
export const useAvailability = (p: { sessionId: string; minCapacity?: number }) =>
  useQuery({
    queryKey: academicKeys.availability(p),
    queryFn: () =>
      apiGet<RoomAvailability[]>('/classrooms/availability', {
        params: { sessionId: p.sessionId, minCapacity: p.minCapacity || undefined },
      }),
    enabled: !!p.sessionId,
  });

export const useAddExternalRecord = (studentId: string) =>
  useAcademicMutation((body: ExternalRecordInput) =>
    apiPost<{ id: string; course: string; credits: number }>(
      `/students/${studentId}/records`,
      body,
    ),
  );
