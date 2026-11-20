import { logger } from '../../config/logger.js';
import { prisma } from '../database/prisma.js';
import { getQueue, QueueName } from '../queues/queues.js';
import { sendMail, type MailMessage } from './mailer.js';

export interface EmailJob extends MailMessage {
  /** email_logs row tracking this message (FR-NOTIF-005). */
  logId?: string;
}

/** Records the email in the log and queues it for the worker (retries with backoff). Never throws. */
export async function enqueueEmail(message: MailMessage, kind: string): Promise<void> {
  try {
    const log = await prisma.emailLog.create({
      data: {
        toAddress: message.to,
        subject: message.subject.slice(0, 300),
        kind: kind.slice(0, 60),
      },
      select: { id: true },
    });
    await getQueue(QueueName.EMAIL).add(kind, { ...message, logId: log.id } satisfies EmailJob);
  } catch (err) {
    logger.error({ err: (err as Error).message, kind }, 'Failed to enqueue email');
  }
}

/** Worker side: sends and records the outcome; FAILED only once retries are exhausted. */
export async function deliverEmail(
  job: EmailJob,
  attempt: { number: number; final: boolean },
): Promise<{ messageId: string }> {
  const { logId, ...message } = job;
  try {
    const result = await sendMail(message);
    if (logId)
      await prisma.emailLog.update({
        where: { id: logId },
        data: { status: 'SENT', attempts: attempt.number, sentAt: new Date(), lastError: null },
      });
    return result;
  } catch (err) {
    if (logId)
      await prisma.emailLog
        .update({
          where: { id: logId },
          data: {
            attempts: attempt.number,
            lastError: (err as Error).message.slice(0, 1000),
            ...(attempt.final ? { status: 'FAILED' as const } : {}),
          },
        })
        .catch(() => undefined);
    throw err;
  }
}
