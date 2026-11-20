import { Worker, type Job, type Processor } from 'bullmq';
import { logger } from './config/logger.js';
import { prisma } from './infrastructure/database/prisma.js';
import { deliverEmail, type EmailJob } from './infrastructure/email/outbox.js';
import { closeQueues, getQueue, QUEUE_PREFIX, QueueName } from './infrastructure/queues/queues.js';
import { createQueueConnection, redis, waitForRedis } from './infrastructure/redis/redis.js';
import { purgeStalePendingFiles } from './modules/files/files.service.js';
import { processImportJob } from './modules/imports/imports.service.js';
import {
  expireOffer,
  promoteSection,
  reconcileCounters,
  sweepWaitlists,
} from './modules/registrations/waitlist.service.js';
import { processExport } from './modules/reports/exports.service.js';
import { closeResolvedTickets } from './modules/support/tickets.service.js';
import { purgeOldNotifications } from './modules/notifications/notifications.service.js';
import {
  fanOutAnnouncement,
  sweepDueAnnouncements,
} from './modules/announcements/announcements.service.js';

/** Last time the worker ran its heartbeat; read by admin system alerts (Phase 11). */
export const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';
const HEARTBEAT_EVERY_MS = 60_000;

const processors: Partial<Record<QueueName, { processor: Processor; concurrency: number }>> = {
  [QueueName.EMAIL]: {
    concurrency: 5,
    processor: async (job: Job<EmailJob>) =>
      deliverEmail(job.data, {
        number: job.attemptsMade + 1,
        final: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
      }),
  },
  [QueueName.IMPORTS]: {
    concurrency: 1,
    processor: async (job: Job<{ jobId: string }>) => processImportJob(job.data.jobId),
  },
  [QueueName.WAITLIST]: {
    concurrency: 5,
    processor: async (job: Job<{ sectionId?: string; registrationId?: string }>) => {
      switch (job.name) {
        case 'promote':
          return promoteSection(job.data.sectionId!);
        case 'expire-offer':
          return expireOffer(job.data.registrationId!);
        default:
          throw new Error(`Unknown waitlist job: ${job.name}`);
      }
    },
  },
  [QueueName.EXPORTS]: {
    concurrency: 1,
    processor: async (job: Job<{ jobId: string }>) => processExport(job.data.jobId),
  },
  [QueueName.ANNOUNCEMENTS]: {
    concurrency: 2,
    processor: async (job: Job<{ announcementId: string }>) =>
      fanOutAnnouncement(job.data.announcementId),
  },
  [QueueName.MAINTENANCE]: {
    concurrency: 1,
    processor: async (job: Job) => {
      switch (job.name) {
        case 'purge-pending-files':
          return { purged: await purgeStalePendingFiles() };
        case 'waitlist-sweep':
          return sweepWaitlists();
        case 'reconcile-counters':
          return reconcileCounters();
        case 'close-resolved-tickets':
          return closeResolvedTickets();
        case 'announcement-sweep':
          return sweepDueAnnouncements();
        case 'purge-notifications':
          return { purged: await purgeOldNotifications() };
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
  await waitForRedis(10_000);
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
  await getQueue(QueueName.MAINTENANCE).upsertJobScheduler(
    'purge-pending-files',
    { every: 60 * 60_000 },
    { name: 'purge-pending-files', opts: { attempts: 3 } },
  );
  await getQueue(QueueName.MAINTENANCE).upsertJobScheduler(
    'waitlist-sweep',
    { every: 5 * 60_000 },
    { name: 'waitlist-sweep', opts: { attempts: 3 } },
  );
  await getQueue(QueueName.MAINTENANCE).upsertJobScheduler(
    'reconcile-counters',
    { every: 60 * 60_000 },
    { name: 'reconcile-counters', opts: { attempts: 3 } },
  );
  await getQueue(QueueName.MAINTENANCE).upsertJobScheduler(
    'purge-notifications',
    { every: 24 * 60 * 60_000 },
    { name: 'purge-notifications', opts: { attempts: 3 } },
  );
  await getQueue(QueueName.MAINTENANCE).upsertJobScheduler(
    'announcement-sweep',
    { every: 60_000 },
    { name: 'announcement-sweep', opts: { attempts: 1 } },
  );
  await getQueue(QueueName.MAINTENANCE).upsertJobScheduler(
    'close-resolved-tickets',
    { every: 60 * 60_000 },
    { name: 'close-resolved-tickets', opts: { attempts: 3 } },
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
