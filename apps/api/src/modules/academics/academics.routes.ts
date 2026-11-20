import { Router } from 'express';
import { z } from 'zod';
import {
  ASSESSMENT_TYPES,
  assessmentCreateSchema,
  assessmentScoresSchema,
  assessmentUpdateSchema,
  ATTENDANCE_STATUSES,
  attendanceRecordsSchema,
  attendanceSessionCreateSchema,
  attendanceSettingsSchema,
  classroomAvailabilityQuerySchema,
  finalGradesSchema,
  GRADE_SUBMISSION_STATUSES,
  gradeChangeSchema,
  gradeReturnSchema,
  idParamSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { successEnvelope } from '../../openapi/registry.js';
import * as assessments from './assessments.service.js';
import * as attendance from './attendance.service.js';
import * as grades from './grades.service.js';
import { classroomAvailability } from './timetable.service.js';
import * as transcripts from './transcript.service.js';

export const academicsRouter = Router();
const tags = ['Academic management'];
const loose = (id: string) => z.object({}).passthrough().meta({ id });

const classMember = {
  registrationId: z.uuid(),
  registrationStatus: z.string(),
  credits: z.number(),
  studentId: z.uuid(),
  userId: z.uuid(),
  studentNumber: z.string(),
  name: z.string(),
};
const assessmentDto = z
  .object({
    id: z.uuid(),
    title: z.string(),
    type: z.enum(ASSESSMENT_TYPES),
    weight: z.number(),
    maxScore: z.number(),
    dueAt: z.string().nullable(),
    published: z.boolean(),
    publishedAt: z.string().nullable(),
    position: z.number(),
  })
  .meta({ id: 'Assessment' });
const gradeSheet = z
  .object({
    section: z.object({ id: z.uuid(), label: z.string(), title: z.string() }),
    scale: z
      .object({
        name: z.string(),
        bands: z.array(
          z.object({
            letter: z.string(),
            minPercent: z.number(),
            gradePoints: z.number().nullable(),
            isPassing: z.boolean(),
            countsInGpa: z.boolean(),
          }),
        ),
      })
      .nullable(),
    status: z.enum(GRADE_SUBMISSION_STATUSES),
    submittedBy: z.string().nullable(),
    submittedAt: z.string().nullable(),
    decidedBy: z.string().nullable(),
    decidedAt: z.string().nullable(),
    returnReason: z.string().nullable(),
    postedAt: z.string().nullable(),
    assessmentWeight: z.number(),
    canEdit: z.boolean(),
    canDecide: z.boolean(),
    students: z.array(
      z.object({
        registrationId: z.uuid(),
        studentId: z.uuid(),
        studentNumber: z.string(),
        name: z.string(),
        registrationStatus: z.string(),
        percent: z.number().nullable(),
        suggested: z.string().nullable(),
        gradeLetter: z.string().nullable(),
        posted: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'GradeSheet' });
const gradeHistory = z
  .object({
    id: z.uuid(),
    course: z.object({ code: z.string(), title: z.string() }),
    gradeLetter: z.string().nullable(),
    gradePoints: z.number().nullable(),
    version: z.number(),
    canChange: z.boolean(),
    letters: z.array(z.string()),
    changes: z.array(
      z.object({
        version: z.number(),
        from: z.string().nullable(),
        to: z.string(),
        reason: z.string(),
        by: z.string(),
        at: z.string(),
      }),
    ),
  })
  .meta({ id: 'GradeHistory' });

// ----- timetables (FR-ACAD-001/002) -----------------------------------------------------

defineRoute(
  academicsRouter,
  {
    method: 'get',
    path: '/classrooms/availability',
    summary: 'Free/busy of every active classroom in a session',
    tags,
    access: { authenticated: true },
    request: { query: classroomAvailabilityQuerySchema },
    responses: {
      200: {
        description: 'Availability',
        schema: successEnvelope(z.array(loose('ClassroomAvailability'))),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await classroomAvailability(req.valid.query), 'Availability retrieved');
  },
);

// ----- attendance (FR-ACAD-003) ------------------------------------------------------------

defineRoute(
  academicsRouter,
  {
    method: 'get',
    path: '/course-sections/:id/attendance',
    summary: 'Attendance register: class list, sessions and marks',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Register',
        schema: successEnvelope(
          z.object({
            enabled: z.boolean(),
            canManage: z.boolean(),
            students: z.array(z.object({ ...classMember, percent: z.number().nullable() })),
            sessions: z.array(
              z.object({
                id: z.uuid(),
                date: z.string(),
                startMinute: z.number().nullable(),
                topic: z.string().nullable(),
                marked: z.number(),
                records: z.array(
                  z.object({
                    studentId: z.uuid(),
                    status: z.enum(ATTENDANCE_STATUSES),
                    note: z.string().nullable(),
                  }),
                ),
              }),
            ),
          }),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await attendance.register(getActor(req), req.valid.params.id), 'Attendance');
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'put',
    path: '/course-sections/:id/attendance/settings',
    summary: 'Turn attendance tracking on or off for a section',
    tags,
    access: { permission: 'attendance:manage' },
    request: { params: idParamSchema, body: attendanceSettingsSchema },
    responses: {
      200: { description: 'Saved', schema: successEnvelope(z.object({ enabled: z.boolean() })) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await attendance.setAttendanceEnabled(
        getActor(req),
        req.valid.params.id,
        req.valid.body.enabled,
      ),
      'Attendance settings saved',
    );
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'post',
    path: '/course-sections/:id/attendance-sessions',
    summary: 'Add a class date to take attendance for',
    tags,
    access: { permission: 'attendance:manage' },
    request: { params: idParamSchema, body: attendanceSessionCreateSchema },
    responses: {
      201: { description: 'Created', schema: successEnvelope(z.object({ id: z.uuid() })) },
    },
  },
  async (req, res) => {
    sendCreated(
      res,
      await attendance.createSession(getActor(req), req.valid.params.id, req.valid.body),
      'Class added',
    );
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'put',
    path: '/attendance-sessions/:id/records',
    summary: 'Mark students present, absent, late or excused',
    tags,
    access: { permission: 'attendance:manage' },
    request: { params: idParamSchema, body: attendanceRecordsSchema },
    responses: {
      200: { description: 'Saved', schema: successEnvelope(z.object({ marked: z.number() })) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await attendance.recordAttendance(getActor(req), req.valid.params.id, req.valid.body),
      'Attendance saved',
    );
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'delete',
    path: '/attendance-sessions/:id',
    summary: 'Remove a class date and its marks',
    tags,
    access: { permission: 'attendance:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await attendance.deleteSession(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Class removed');
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'get',
    path: '/course-sections/:id/my-attendance',
    summary: 'Your attendance in a section',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Attendance', schema: successEnvelope(loose('MyAttendance')) },
    },
  },
  async (req, res) => {
    sendOk(res, await attendance.myAttendance(getActor(req), req.valid.params.id), 'Attendance');
  },
);

// ----- assessments (FR-ACAD-004) -------------------------------------------------------------

defineRoute(
  academicsRouter,
  {
    method: 'get',
    path: '/course-sections/:id/gradebook',
    summary: 'Assessments, scores and the computed mark per student',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Gradebook',
        schema: successEnvelope(
          z.object({
            canManage: z.boolean(),
            totalWeight: z.number(),
            assessments: z.array(assessmentDto),
            students: z.array(
              z.object({
                ...classMember,
                percent: z.number().nullable(),
                scores: z.record(
                  z.string(),
                  z
                    .object({
                      score: z.number().nullable(),
                      excused: z.boolean(),
                      feedback: z.string().nullable(),
                    })
                    .nullable(),
                ),
              }),
            ),
          }),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await assessments.gradebook(getActor(req), req.valid.params.id), 'Gradebook');
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'post',
    path: '/course-sections/:id/assessments',
    summary: 'Add an assessment component (weights may not exceed 100 %)',
    tags,
    access: { permission: 'assessment:manage' },
    request: { params: idParamSchema, body: assessmentCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(assessmentDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await assessments.createAssessment(getActor(req), req.valid.params.id, req.valid.body),
      'Assessment added',
    );
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'patch',
    path: '/assessments/:id',
    summary: 'Edit or publish an assessment (publishing notifies students)',
    tags,
    access: { permission: 'assessment:manage' },
    request: { params: idParamSchema, body: assessmentUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(assessmentDto) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await assessments.updateAssessment(getActor(req), req.valid.params.id, req.valid.body),
      'Assessment updated',
    );
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'delete',
    path: '/assessments/:id',
    summary: 'Delete an assessment and its scores',
    tags,
    access: { permission: 'assessment:manage' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await assessments.deleteAssessment(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Assessment deleted');
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'put',
    path: '/assessments/:id/scores',
    summary: 'Enter scores',
    tags,
    access: { permission: 'assessment:manage' },
    request: { params: idParamSchema, body: assessmentScoresSchema },
    responses: {
      200: { description: 'Saved', schema: successEnvelope(z.object({ saved: z.number() })) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await assessments.saveScores(getActor(req), req.valid.params.id, req.valid.body),
      'Scores saved',
    );
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'get',
    path: '/course-sections/:id/my-assessments',
    summary: 'Your published assessments and scores in a section',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Assessments', schema: successEnvelope(loose('MyAssessments')) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await assessments.myAssessments(getActor(req), req.valid.params.id),
      'Assessments retrieved',
    );
  },
);

// ----- final grades (FR-ACAD-006/007) --------------------------------------------------------

defineRoute(
  academicsRouter,
  {
    method: 'get',
    path: '/course-sections/:id/final-grades',
    summary: 'Grade sheet with computed marks, suggested letters and workflow state',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Grade sheet', schema: successEnvelope(gradeSheet) } },
  },
  async (req, res) => {
    sendOk(res, await grades.gradeSheet(getActor(req), req.valid.params.id), 'Grade sheet');
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'put',
    path: '/course-sections/:id/final-grades',
    summary: 'Save draft final grades (primary instructor)',
    tags,
    access: { permission: 'grade:submit' },
    request: { params: idParamSchema, body: finalGradesSchema },
    responses: { 200: { description: 'Saved', schema: successEnvelope(gradeSheet) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await grades.saveGrades(getActor(req), req.valid.params.id, req.valid.body),
      'Grades saved',
    );
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'post',
    path: '/course-sections/:id/final-grades/submit',
    summary: 'Submit final grades for approval',
    tags,
    access: { permission: 'grade:submit' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Submitted', schema: successEnvelope(gradeSheet) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await grades.submitGrades(getActor(req), req.valid.params.id),
      'Grades submitted for approval',
    );
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'post',
    path: '/course-sections/:id/final-grades/approve',
    summary: 'Approve and post final grades to academic records',
    tags,
    access: { permission: 'grade:approve' },
    request: { params: idParamSchema },
    responses: {
      200: {
        description: 'Posted',
        schema: successEnvelope(z.object({ posted: z.number(), sheet: gradeSheet })),
      },
    },
  },
  async (req, res) => {
    const r = await grades.approveGrades(getActor(req), req.valid.params.id);
    sendOk(res, r, `${r.posted} grade(s) posted`);
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'post',
    path: '/course-sections/:id/final-grades/return',
    summary: 'Return final grades to the instructor with a reason',
    tags,
    access: { permission: 'grade:approve' },
    request: { params: idParamSchema, body: gradeReturnSchema },
    responses: { 200: { description: 'Returned', schema: successEnvelope(gradeSheet) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await grades.returnGrades(getActor(req), req.valid.params.id, req.valid.body.reason),
      'Grades returned',
    );
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'get',
    path: '/grade-submissions',
    summary: 'Grade sheets by status within your approval scope',
    tags,
    access: { permission: 'grade:approve' },
    request: {
      query: z.object({ status: z.enum(GRADE_SUBMISSION_STATUSES).default('SUBMITTED') }),
    },
    responses: {
      200: {
        description: 'Submissions',
        schema: successEnvelope(z.array(loose('GradeSubmissionSummary'))),
      },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await grades.submissionQueue(getActor(req), req.valid.query.status),
      'Submissions retrieved',
    );
  },
);

// ----- records, grade changes, transcripts (FR-ACAD-006..009) -------------------------------------

defineRoute(
  academicsRouter,
  {
    method: 'get',
    path: '/academic-records/:id/grade-history',
    summary: 'A record with every version of its grade',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: { 200: { description: 'History', schema: successEnvelope(gradeHistory) } },
  },
  async (req, res) => {
    sendOk(res, await grades.gradeHistory(getActor(req), req.valid.params.id), 'Grade history');
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'post',
    path: '/academic-records/:id/grade-change',
    summary: 'Change a posted grade (reason required; the old grade is kept as a version)',
    tags,
    access: { permission: 'grade:change' },
    request: { params: idParamSchema, body: gradeChangeSchema },
    responses: { 200: { description: 'Changed', schema: successEnvelope(gradeHistory) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await grades.changeGrade(getActor(req), req.valid.params.id, req.valid.body),
      'Grade changed',
    );
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'get',
    path: '/students/me/transcript',
    summary: 'Your transcript (grades by session, session GPA, CGPA)',
    tags,
    access: { permission: 'record:read' },
    responses: { 200: { description: 'Transcript', schema: successEnvelope(loose('Transcript')) } },
  },
  async (req, res) => {
    sendOk(res, await transcripts.myTranscript(getActor(req)), 'Transcript');
  },
);

defineRoute(
  academicsRouter,
  {
    method: 'get',
    path: '/students/:id/transcript',
    summary: "A student's transcript (record readers in scope)",
    tags,
    access: { permission: 'record:read' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Transcript', schema: successEnvelope(loose('Transcript')) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await transcripts.studentTranscript(getActor(req), req.valid.params.id),
      'Transcript',
    );
  },
);
