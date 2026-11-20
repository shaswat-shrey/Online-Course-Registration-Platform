import { Worker } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { createQueueConnection } from '../redis/redis.js';
import { closeQueues, getQueue, QUEUE_PREFIX, QueueName } from './queues.js';
import { sendMail } from '../email/mailer.js';

afterAll(closeQueues);

describe('queues', () => {
  it('delivers an email job end to end through BullMQ (log transport)', async () => {
    const connection = createQueueConnection('test-worker');
    const worker = new Worker(QueueName.EMAIL, async (job) => sendMail(job.data), {
      connection,
      prefix: QUEUE_PREFIX,
    });
    const done = new Promise<{ messageId: string }>((resolve, reject) => {
      worker.on('completed', (_job, result) => resolve(result));
      worker.on('failed', (_job, err) => reject(err));
    });

    await getQueue(QueueName.EMAIL).add('test', {
      to: 'student@example.edu',
      subject: 'Hello',
      text: 'Queued message',
    });

    const result = await done;
    expect(result.messageId).toBeTruthy();
    await worker.close();
    connection.disconnect();
  });

  it('applies retry defaults to new jobs', async () => {
    const job = await getQueue(QueueName.MAINTENANCE).add('noop-for-test', {}, { delay: 60_000 });
    expect(job.opts.attempts).toBe(5);
    expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 30_000 });
    await job.remove();
  });
});
