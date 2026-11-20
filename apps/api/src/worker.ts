import { Worker, type Job, type Processor } from 'bullmq';
import { logger } from './config/logger.js';
import { prisma } from './infrastructure/database/prisma.js';
import { sendMail, type MailMessage } from './infrastructure/email/mailer.js';
import { closeQueues, getQueue, QUEUE_PREFIX, QueueName } from './infrastructure/queues/queues.js';
import { createQueueConnection, redis } from './infrastructure/redis/redis.js';

/** Last time the worker ran its heartbeat; read by admin system alerts (Phase 11). */
export const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';
const HEARTBEAT_EVERY_MS = 60_000;

const processors: Partial<Record<QueueName, { processor: Processor; concurrency: number }>> = {
  [QueueName.EMAIL]: {
    concurrency: 5,
    processor: async (job: Job<MailMessage>) => sendMail(job.data),
  },
  [QueueName.MAINTENANCE]: {
    concurrency: 1,
    processor: async (job: Job) => {
      switch (job.name) {
        case 'heartbeat':
          await redis.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), 'EX', 300);
          return { ok: true };
        default:
          throw new Error(`Unknown maintenance job: ${job.name}`);
      }
    },
  },
};

async function main() {
  const workers = Object.entries(processors).map(([name, def]) => {
    const worker = new Worker(name, def.processor, {
      connection: createQueueConnection(`worker-${name}`),
      prefix: QUEUE_PREFIX,
      concurrency: def.concurrency,
    });
    worker.on('failed', (job, err) =>
      logger.error(
        {
          queue: name,
          jobId: job?.id,
          jobName: job?.name,
          attemptsMade: job?.attemptsMade,
          err: err.message,
        },
        'Job failed',
      ),
    );
    worker.on('error', (err) => logger.error({ queue: name, err: err.message }, 'Worker error'));
    return worker;
  });

  await getQueue(QueueName.MAINTENANCE).upsertJobScheduler(
    'heartbeat',
    { every: HEARTBEAT_EVERY_MS },
    { name: 'heartbeat', opts: { attempts: 1 } },
  );
  logger.info({ queues: Object.keys(processors) }, 'Worker started');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down worker (finishing active jobs)');
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
