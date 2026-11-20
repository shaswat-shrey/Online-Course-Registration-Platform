import type { ApiFailure } from '@ucrams/shared';

/** Normalized client-side error for every failed API call. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  static fromEnvelope(status: number, body: ApiFailure): ApiError {
    return new ApiError(
      status,
      body.error.code,
      body.message,
      body.error.details,
      body.error.requestId,
    );
  }
}

export const NETWORK_ERROR = 'NETWORK_ERROR';

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** User-facing message for an unknown error value. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.code === NETWORK_ERROR)
      return 'Unable to reach the server. Check your connection and try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
