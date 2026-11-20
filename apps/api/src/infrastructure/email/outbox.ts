import { logger } from '../../config/logger.js';
import { getQueue, QueueName } from '../queues/queues.js';
import type { MailMessage } from './mailer.js';

/** Queues an email for the worker (retries with backoff). Never throws to callers. */
export async function enqueueEmail(message: MailMessage, kind: string): Promise<void> {
  try {
    await getQueue(QueueName.EMAIL).add(kind, message);
  } catch (err) {
    logger.error({ err: (err as Error).message, kind }, 'Failed to enqueue email');
  }
}
