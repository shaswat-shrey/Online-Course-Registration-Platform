import { Queue, type JobsOptions } from 'bullmq';
import { createQueueConnection } from '../redis/redis.js';

/** Queue names (ARCHITECTURE.md §10). */
export const QueueName = {
  EMAIL: 'email',
  NOTIFICATIONS: 'notifications',
  ANNOUNCEMENTS: 'announcements',
  WAITLIST: 'waitlist',
  IMPORTS: 'imports',
  EXPORTS: 'exports',
  MAINTENANCE: 'maintenance',
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];

export const QUEUE_PREFIX = 'ucrams';

/** Defaults: exponential backoff, keep a bounded history of completed/failed jobs. */
export const defaultJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { count: 1000 },
};

const queues = new Map<QueueName, Queue>();

/** Lazily created producer queues sharing one connection. */
let producerConnection: ReturnType<typeof createQueueConnection> | undefined;

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    producerConnection ??= createQueueConnection('producer');
    queue = new Queue(name, {
      connection: producerConnection,
      prefix: QUEUE_PREFIX,
      defaultJobOptions,
    });
    queues.set(name, queue);
  }
  return queue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (producerConnection) {
    producerConnection.disconnect();
    producerConnection = undefined;
  }
}
