import { ErrorCode } from '@ucrams/shared';
import { errorMessage, isApiError } from '@/services/api-error';

/** User-facing copy for authentication failures. */
export function authErrorMessage(error: unknown): string {
  if (!isApiError(error)) return errorMessage(error);
  switch (error.code) {
    case ErrorCode.INVALID_CREDENTIALS:
      return 'The email or password is incorrect.';
    case ErrorCode.ACCOUNT_LOCKED: {
      const seconds =
        (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 0;
      const minutes = Math.max(1, Math.ceil(seconds / 60));
      return `Too many failed attempts. Your account is locked for about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }
    case ErrorCode.ACCOUNT_INACTIVE:
      return 'This account is not active. Contact the administration office.';
    case ErrorCode.RATE_LIMITED:
      return 'Too many attempts. Please wait a few minutes and try again.';
    case ErrorCode.SERVICE_UNAVAILABLE:
      return 'Sign-in is temporarily unavailable. Please try again shortly.';
    default:
      return errorMessage(error);
  }
}
