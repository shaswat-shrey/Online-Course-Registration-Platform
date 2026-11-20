import { Router } from 'express';
import { z } from 'zod';
import {
  idParamSchema,
  postCreateSchema,
  THREAD_TYPES,
  threadCreateSchema,
  threadUpdateSchema,
} from '@ucrams/shared';
import { getActor } from '../../common/context/actor.js';
import { defineRoute } from '../../common/http/define-route.js';
import { sendCreated, sendOk } from '../../common/http/response.js';
import { successEnvelope } from '../../openapi/registry.js';
import * as service from './discussions.service.js';

export const discussionsRouter = Router();
const tags = ['Discussions'];
const access = { authenticated: true } as const;

const person = z.object({ id: z.uuid(), name: z.string() });
const threadDto = z
  .object({
    id: z.uuid(),
    sectionId: z.uuid(),
    type: z.enum(THREAD_TYPES),
    title: z.string(),
    body: z.string().nullable(),
    deleted: z.boolean(),
    pinned: z.boolean(),
    locked: z.boolean(),
    answered: z.boolean(),
    answerPostId: z.uuid().nullable(),
    replyCount: z.number(),
    author: person,
    mine: z.boolean(),
    canEdit: z.boolean(),
    canDelete: z.boolean(),
    lastActivityAt: z.string(),
    editedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'DiscussionThread' });
const postDto = z
  .object({
    id: z.uuid(),
    body: z.string().nullable(),
    deleted: z.boolean(),
    isAnswer: z.boolean(),
    author: person,
    mine: z.boolean(),
    canDelete: z.boolean(),
    editedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'DiscussionPost' });
const threadDetail = threadDto
  .extend({ canModerate: z.boolean(), canReply: z.boolean(), posts: z.array(postDto) })
  .meta({ id: 'DiscussionThreadDetail' });

defineRoute(
  discussionsRouter,
  {
    method: 'get',
    path: '/discussions/boards',
    summary: 'Section discussion boards you can open',
    tags,
    access,
    responses: {
      200: {
        description: 'Boards',
        schema: successEnvelope(
          z.array(
            z.object({
              id: z.uuid(),
              label: z.string(),
              title: z.string(),
              session: z.string(),
              current: z.boolean(),
              threads: z.number(),
            }),
          ),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(res, await service.myBoards(getActor(req)), 'Boards retrieved');
  },
);

defineRoute(
  discussionsRouter,
  {
    method: 'get',
    path: '/course-sections/:id/discussions',
    summary: 'Threads in a section, pinned first then most recently active',
    tags,
    access,
    request: {
      params: idParamSchema,
      query: z.object({
        q: z.string().trim().max(100).optional(),
        type: z.enum(THREAD_TYPES).optional(),
        unanswered: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
    },
    responses: {
      200: {
        description: 'Threads',
        schema: successEnvelope(
          z.object({
            section: z.object({ id: z.uuid(), label: z.string(), title: z.string() }),
            canModerate: z.boolean(),
            items: z.array(threadDto),
          }),
        ),
      },
    },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.listThreads(getActor(req), req.valid.params.id, req.valid.query),
      'Threads retrieved',
    );
  },
);

defineRoute(
  discussionsRouter,
  {
    method: 'post',
    path: '/course-sections/:id/discussions',
    summary: 'Start a question or discussion in a section',
    tags,
    access,
    request: { params: idParamSchema, body: threadCreateSchema },
    responses: { 201: { description: 'Created', schema: successEnvelope(threadDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await service.createThread(getActor(req), req.valid.params.id, req.valid.body),
      'Thread created',
    );
  },
);

defineRoute(
  discussionsRouter,
  {
    method: 'get',
    path: '/discussions/:id',
    summary: 'A thread with its replies',
    tags,
    access,
    request: { params: idParamSchema },
    responses: { 200: { description: 'Thread', schema: successEnvelope(threadDetail) } },
  },
  async (req, res) => {
    sendOk(res, await service.getThread(getActor(req), req.valid.params.id), 'Thread retrieved');
  },
);

defineRoute(
  discussionsRouter,
  {
    method: 'patch',
    path: '/discussions/:id',
    summary: 'Edit your thread; instructors pin, lock and mark the answer',
    tags,
    access,
    request: { params: idParamSchema, body: threadUpdateSchema },
    responses: { 200: { description: 'Updated', schema: successEnvelope(threadDetail) } },
  },
  async (req, res) => {
    sendOk(
      res,
      await service.updateThread(getActor(req), req.valid.params.id, req.valid.body),
      'Thread updated',
    );
  },
);

defineRoute(
  discussionsRouter,
  {
    method: 'delete',
    path: '/discussions/:id',
    summary: 'Remove a thread (yours, or any as an instructor)',
    tags,
    access,
    request: { params: idParamSchema },
    responses: { 200: { description: 'Removed' } },
  },
  async (req, res) => {
    await service.deleteThread(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Thread removed');
  },
);

defineRoute(
  discussionsRouter,
  {
    method: 'post',
    path: '/discussions/:id/posts',
    summary: 'Reply to a thread',
    tags,
    access,
    request: { params: idParamSchema, body: postCreateSchema },
    responses: { 201: { description: 'Posted', schema: successEnvelope(postDto) } },
  },
  async (req, res) => {
    sendCreated(
      res,
      await service.createPost(getActor(req), req.valid.params.id, req.valid.body),
      'Reply posted',
    );
  },
);

defineRoute(
  discussionsRouter,
  {
    method: 'delete',
    path: '/discussion-posts/:id',
    summary: 'Remove a reply (yours, or any as an instructor)',
    tags,
    access,
    request: { params: idParamSchema },
    responses: { 200: { description: 'Removed' } },
  },
  async (req, res) => {
    await service.deletePost(getActor(req), req.valid.params.id);
    sendOk(res, null, 'Reply removed');
  },
);
