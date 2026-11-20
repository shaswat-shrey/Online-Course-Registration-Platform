import { pino, type LoggerOptions } from 'pino';
import { env } from './env.js';

/** Paths that must never be written to logs (SECURITY.md §11). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
];

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'ucrams-api', version: env.APP_VERSION },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  timestamp: pino.stdTimeFunctions.isoTime,
};

export const logger =
  env.NODE_ENV === 'development'
    ? pino({ ...options, transport: { target: 'pino-pretty', options: { singleLine: true } } })
    : pino(options);

export type Logger = typeof logger;
