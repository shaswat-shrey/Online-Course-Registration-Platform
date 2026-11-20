import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function createTransport(): Transporter {
  if (env.MAIL_TRANSPORT === 'smtp') {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  // 'log' transport: renders the message without sending (development without Mailpit).
  return nodemailer.createTransport({ jsonTransport: true });
}

const transport = createTransport();

/**
 * Sends an email immediately. Application code should enqueue on the
 * `email` queue instead of calling this directly (retries, ARCHITECTURE.md §10).
 */
export async function sendMail(message: MailMessage): Promise<{ messageId: string }> {
  const info = await transport.sendMail({ from: env.MAIL_FROM, ...message });
  if (env.MAIL_TRANSPORT === 'log') {
    logger.info(
      { to: message.to, subject: message.subject },
      'Email rendered (log transport, not sent)',
    );
  }
  return { messageId: info.messageId };
}
