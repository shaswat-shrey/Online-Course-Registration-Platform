import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ErrorCode, type ApiFailure } from '@ucrams/shared';
import { AppError, NotFoundError } from '../exceptions/app-error.js';
import { logger } from '../../config/logger.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
};

interface HttpLikeError {
  status?: number;
  statusCode?: number;
  type?: string;
  expose?: boolean;
}

/** Errors thrown by body-parser etc. carry a status and are safe to map. */
function fromHttpError(err: unknown): AppError | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as HttpLikeError;
  const status = e.statusCode ?? e.status;
  if (!status || status < 400 || status >= 500) return null;
  if (e.type === 'entity.too.large') {
    return new AppError(413, ErrorCode.PAYLOAD_TOO_LARGE, 'Request body is too large');
  }
  if (e.type === 'entity.parse.failed') {
    return new AppError(400, ErrorCode.VALIDATION_ERROR, 'Malformed JSON body');
  }
  return new AppError(status, ErrorCode.VALIDATION_ERROR, 'Invalid request');
}

/**
 * Converts any error into the standard error envelope.
 * Never leaks stack traces, SQL or internal messages (SECURITY.md §6).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = err instanceof AppError ? err : fromHttpError(err);
  const log = req.log ?? logger;

  if (!appError) {
    log.error({ err, requestId: req.id }, 'Unhandled error');
  } else if (appError.statusCode >= 500) {
    log.error({ err, requestId: req.id }, appError.message);
  } else {
    log.debug({ code: appError.code, requestId: req.id }, appError.message);
  }

  const status = appError?.statusCode ?? 500;
  const body: ApiFailure = {
    success: false,
    message: appError?.message ?? 'An unexpected error occurred',
    error: {
      code: appError?.code ?? ErrorCode.INTERNAL_ERROR,
      ...(appError?.details !== undefined ? { details: appError.details } : {}),
      requestId: String(req.id),
    },
  };
  if (appError?.headers) res.set(appError.headers);
  if (res.headersSent) return;
  res.status(status).json(body);
};
