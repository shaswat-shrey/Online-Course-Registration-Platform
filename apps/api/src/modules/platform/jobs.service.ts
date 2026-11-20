import type { ActorContext } from '../../common/context/actor.js';
import { NotFoundError } from '../../common/exceptions/app-error.js';
import { getQueue, QueueName } from '../../infrastructure/queues/queues.js';
import { redis } from '../../infrastructure/redis/redis.js';
import { recordAudit } from '../audit/audit.service.js';
import { assertGlobal } from '../authz/authz.js';

const QUEUES = Object.values(QueueName);
const isQueue = (q: string): q is QueueName => (QUEUES as string[]).includes(q);

/** Per-queue counts, the worker heartbeat and recent failures (jobs:read). */
export async function overview(actor: ActorContext) {
  assertGlobal(actor, 'jobs:read');
  const [counts, failed, heartbeat] = await Promise.all([
    Promise.all(
      QUEUES.map(async (name) => ({
        queue: name,
        ...(await getQueue(name).getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
          'completed',
        )),
      })),
    ),
    Promise.all(
      QUEUES.map(async (name) => ({ name, jobs: await getQueue(name).getFailed(0, 49) })),
    ),
    redis.get('worker:heartbeat').catch(() => null),
  ]);
  return {
    workerHeartbeat: heartbeat,
    queues: counts,
    failed: failed
      .flatMap(({ name, jobs }) =>
        jobs.map((j) => ({
          queue: name,
          id: String(j.id),
          name: j.name,
          reason: (j.failedReason ?? 'Unknown error').slice(0, 500),
          attempts: j.attemptsMade,
          failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
          createdAt: new Date(j.timestamp).toISOString(),
        })),
      )
      .sort((a, b) => (b.failedAt ?? '').localeCompare(a.failedAt ?? ''))
      .slice(0, 100),
  };
}

async function failedJob(queue: string, id: string) {
  if (!isQueue(queue)) throw new NotFoundError('Queue');
  const job = await getQueue(queue).getJob(id);
  if (!job || !(await job.isFailed())) throw new NotFoundError('Failed job');
  return job;
}

export async function retry(actor: ActorContext, queue: string, id: string) {
  assertGlobal(actor, 'jobs:manage');
  const job = await failedJob(queue, id);
  await job.retry();
  await recordAudit(actor, {
    action: 'jobs.retried',
    entityType: 'Job',
    entityId: `${queue}:${id}`,
  });
}

export async function remove(actor: ActorContext, queue: string, id: string) {
  assertGlobal(actor, 'jobs:manage');
  const job = await failedJob(queue, id);
  await job.remove();
  await recordAudit(actor, {
    action: 'jobs.removed',
    entityType: 'Job',
    entityId: `${queue}:${id}`,
  });
}
