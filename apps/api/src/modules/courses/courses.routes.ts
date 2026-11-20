import { Router } from 'express';
import { z } from 'zod';
import {
  COURSE_CATEGORIES,
  COURSE_STATUSES,
  corequisitesSchema,
  courseCreateSchema,
  courseProgramsSchema,
  courseSpecializationsSchema,
  courseUpdateSchema,
  idParamSchema,
  prerequisitesSchema,
  requirementCoursesSchema,
  restrictionsSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { listQuery } from '../../common/http/list-query.js';
import { sendCreated, sendOk, sendPaginated } from '../../common/http/response.js';
import { paginatedEnvelope, successEnvelope } from '../../openapi/registry.js';
import { courseDetailDto, courseDto, requirementCourseListDto } from '../course-dtos.js';
import * as relations from './course-relations.service.js';
import * as service from './courses.service.js';

export const coursesRouter = Router();
const tags = ['Courses'];
const detail = { 200: { description: 'Course', schema: successEnvelope(courseDetailDto) } };

defineRoute(
  coursesRouter,
  {
    method: 'get',
    path: '/courses',
    summary: 'Search the course catalog',
    description:
      'Full-text search over code, title and description (ranked) plus filters. Users without catalog management rights see active courses only.',
    tags,
    access: { authenticated: true },
    request: {
      query: listQuery(['code', 'title', 'level', 'credits', 'createdAt'], 'code:asc').extend({
        status: z.enum(COURSE_STATUSES).optional(),
        departmentId: z.uuid().optional(),
        schoolId: z.uuid().optional(),
        category: z.enum(COURSE_CATEGORIES).optional(),
        level: z.coerce.number().int().min(100).max(900).optional(),
        programId: z.uuid().optional(),
        specializationId: z.uuid().optional(),
        minCredits: z.coerce.number().min(0).max(40).optional(),
        maxCredits: z.coerce.number().min(0).max(40).optional(),
      }),
    },
    responses: { 200: { description: 'Courses', schema: paginatedEnvelope(courseDto) } },
  },
  async (req, res) => {
    const q = req.valid.query;
    const { total, items } = await service.listCourses(getActor(req), q);
    sendPaginated(res, items, { page: q.page, limit: q.limit, total }, 'Courses retrieved');
  },
);

defineRoute(
  coursesRouter,
  {
    method: 'get',
    path: '/courses/:id',
    summary: 'Get a course with prerequisites, mappings and restrictions',
    tags,
    access: { authenticated: true },
    request: { params: idParamSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(res, await service.getCourse(getActor(req), req.valid.params.id), 'Course retrieved');
  },
);

defineRoute(
  coursesRouter,
  {
    method: 'post',
    path: '/courses',
    summary: 'Create a course',
    tags,
    access: { permission: 'course:create' },
    request: { body: courseCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(courseDetailDto) } },
  },
  async (req, res) => {
    sendCreated(res, await service.createCourse(getActor(req), req.valid.body), 'Course created');
  },
);

defineRoute(
  coursesRouter,
  {
    method: 'patch',
    path: '/courses/:id',
    summary: 'Update a course (including status changes)',
    tags,
    access: { permission: 'course:update' },
    request: { params: idParamSchema, body: courseUpdateSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await service.updateCourse(getActor(req), req.valid.params.id, req.valid.body),
      'Course updated',
    );
  },
);

defineRoute(
  coursesRouter,
  {
    method: 'delete',
    path: '/courses/:id',
    summary: 'Delete an unreferenced draft course',
    tags,
    access: { permission: 'course:create' },
    request: { params: idParamSchema },
    responses: { 200: { description: 'Deleted' } },
  },
  async (req, res) => {
    await service.deleteCourse(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Course deleted');
  },
);

defineRoute(
  coursesRouter,
  {
    method: 'put',
    path: '/courses/:id/prerequisites',
    summary: 'Replace prerequisites (AND of OR-groups); cycles are rejected',
    tags,
    access: { permission: 'course:update' },
    request: { params: idParamSchema, body: prerequisitesSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await relations.setPrerequisites(getActor(req), req.valid.params.id, req.valid.body),
      'Prerequisites saved',
    );
  },
);

defineRoute(
  coursesRouter,
  {
    method: 'put',
    path: '/courses/:id/corequisites',
    summary: 'Replace corequisites',
    tags,
    access: { permission: 'course:update' },
    request: { params: idParamSchema, body: corequisitesSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await relations.setCorequisites(getActor(req), req.valid.params.id, req.valid.body),
      'Corequisites saved',
    );
  },
);

defineRoute(
  coursesRouter,
  {
    method: 'put',
    path: '/courses/:id/programs',
    summary: 'Replace program mappings (core/elective)',
    tags,
    access: { permission: 'course:update' },
    request: { params: idParamSchema, body: courseProgramsSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await relations.setCoursePrograms(getActor(req), req.valid.params.id, req.valid.body),
      'Program mappings saved',
    );
  },
);

defineRoute(
  coursesRouter,
  {
    method: 'put',
    path: '/courses/:id/specializations',
    summary: 'Replace specialization mappings (core/elective)',
    tags,
    access: { permission: 'course:update' },
    request: { params: idParamSchema, body: courseSpecializationsSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await relations.setCourseSpecializations(getActor(req), req.valid.params.id, req.valid.body),
      'Specialization mappings saved',
    );
  },
);

defineRoute(
  coursesRouter,
  {
    method: 'put',
    path: '/courses/:id/restrictions',
    summary: 'Replace course-level registration restrictions',
    tags,
    access: { permission: 'course:update' },
    request: { params: idParamSchema, body: restrictionsSchema },
    responses: detail,
  },
  async (req, res) => {
    sendOk(
      res,
      await relations.setCourseRestrictions(
        getActor(req),
        req.valid.params.id,
        req.valid.body.restrictions,
      ),
      'Restrictions saved',
    );
  },
);

defineRoute(
  coursesRouter,
  {
    method: 'put',
    path: '/requirement-groups/:id/courses',
    summary: 'Replace the course list of an ALL_OF / CREDITS_FROM_LIST requirement group',
    tags: ['Programs & specializations'],
    // program:manage or specialization:manage depending on the group's owner (checked in the service).
    access: { authenticated: true },
    request: { params: idParamSchema, body: requirementCoursesSchema },
    responses: {
      200: { description: 'Courses', schema: successEnvelope(requirementCourseListDto) },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await relations.setRequirementCourses(getActor(req), req.valid.params.id, req.valid.body),
      'Requirement courses saved',
    );
  },
);
