import { ErrorCode } from '@ucrams/shared';

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
  /** Extra response headers (e.g. Retry-After). */
  headers?: Record<string, string>;
}

/**
 * Base class for every error that is safe to show to API clients.
 * Anything that is not an AppError is reported as INTERNAL_ERROR.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(statusCode: number, code: string, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers;
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = 'Request validation failed') {
    super(400, ErrorCode.VALIDATION_ERROR, message, { details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(code: string = ErrorCode.UNAUTHENTICATED, message = 'Authentication required') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(403, ErrorCode.FORBIDDEN, message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(404, ErrorCode.NOT_FOUND, `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(code: string = ErrorCode.CONFLICT, message = 'Conflict', details?: unknown) {
    super(409, code, message, { details });
  }
}

/** 422: the request is well-formed but violates a business rule. */
export class BusinessRuleError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(422, code, message, { details });
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, ErrorCode.RATE_LIMITED, 'Too many requests, please try again later', {
      headers: { 'Retry-After': String(retryAfterSeconds) },
      details: { retryAfterSeconds },
    });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(503, ErrorCode.SERVICE_UNAVAILABLE, message);
  }
}
