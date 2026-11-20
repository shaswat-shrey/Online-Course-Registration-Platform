/**
 * Response envelope shared by the API and the web client.
 * See docs/API.md §3.
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CursorMeta {
  nextCursor: string | null;
}

export interface ApiSuccess<T, M = PaginationMeta | CursorMeta> {
  success: true;
  message: string;
  data: T;
  meta?: M;
}

export interface ApiErrorBody {
  code: string;
  details?: unknown;
  requestId?: string;
}

export interface ApiFailure {
  success: false;
  message: string;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface FieldError {
  path: string;
  message: string;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  checks: Record<string, { status: 'up' | 'down'; latencyMs?: number; error?: string }>;
  uptimeSeconds: number;
  version: string;
}
