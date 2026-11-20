import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import {
  CSRF_HEADER,
  ErrorCode,
  type ApiFailure,
  type ApiSuccess,
  type RefreshResultDto,
} from '@ucrams/shared';
import { useAuthStore } from '@/store/auth-store';
import { ApiError, NETWORK_ERROR } from './api-error';
import { csrfToken } from './cookies';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export const http = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 20_000,
  headers: { Accept: 'application/json' },
});

function isFailureEnvelope(body: unknown): body is ApiFailure {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as ApiFailure).success === false &&
    typeof (body as ApiFailure).error?.code === 'string'
  );
}

function toApiError(error: unknown): unknown {
  if (error instanceof AxiosError) {
    if (error.response) {
      const { status, data } = error.response;
      if (isFailureEnvelope(data)) return ApiError.fromEnvelope(status, data);
      return new ApiError(status, 'HTTP_ERROR', `Request failed with status ${status}`);
    }
    return new ApiError(0, NETWORK_ERROR, 'Network error');
  }
  return error;
}

/**
 * Rotates the refresh cookie and returns a new access token. Uses a bare axios
 * call so it never recurses through the 401 interceptor.
 */
export async function refreshAccessToken(): Promise<string> {
  try {
    const res = await axios.post<ApiSuccess<RefreshResultDto>>(
      `${API_BASE_URL}/auth/refresh`,
      undefined,
      {
        withCredentials: true,
        headers: { [CSRF_HEADER]: csrfToken() ?? '' },
      },
    );
    return res.data.data.accessToken;
  } catch (error) {
    throw toApiError(error);
  }
}

let inflightRefresh: Promise<string> | null = null;

/** Single-flight: concurrent 401s share one refresh request (ARCHITECTURE.md §4). */
export function refreshOnce(): Promise<string> {
  inflightRefresh ??= refreshAccessToken()
    .then((token) => {
      useAuthStore.getState().setAccessToken(token);
      return token;
    })
    .finally(() => {
      inflightRefresh = null;
    });
  return inflightRefresh;
}

http.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

http.interceptors.response.use(undefined, async (error: unknown) => {
  const apiError = toApiError(error);
  const config = (error as AxiosError).config as RetriableConfig | undefined;
  if (
    apiError instanceof ApiError &&
    apiError.status === 401 &&
    apiError.code === ErrorCode.TOKEN_EXPIRED &&
    config &&
    !config._retried
  ) {
    try {
      // If a refresh already completed after this request was sent, reuse its token
      // instead of rotating again.
      const current = useAuthStore.getState().accessToken;
      const sentWith = String(config.headers.Authorization ?? '');
      const token = current && sentWith !== `Bearer ${current}` ? current : await refreshOnce();
      config._retried = true;
      config.headers.Authorization = `Bearer ${token}`;
      return http.request(config);
    } catch (refreshError) {
      useAuthStore.getState().clear();
      return Promise.reject(refreshError);
    }
  }
  if (
    apiError instanceof ApiError &&
    apiError.status === 401 &&
    apiError.code === ErrorCode.SESSION_REVOKED
  ) {
    useAuthStore.getState().clear();
  }
  return Promise.reject(apiError);
});

export async function apiGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await http.get<ApiSuccess<T>>(url, config);
  return res.data.data;
}

export async function apiPost<T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await http.post<ApiSuccess<T>>(url, body, config);
  return res.data.data;
}

export async function apiPut<T, B = unknown>(url: string, body?: B): Promise<T> {
  const res = await http.put<ApiSuccess<T>>(url, body);
  return res.data.data;
}

export async function apiPatch<T, B = unknown>(url: string, body?: B): Promise<T> {
  const res = await http.patch<ApiSuccess<T>>(url, body);
  return res.data.data;
}

export async function apiDelete<T = null>(url: string): Promise<T> {
  const res = await http.delete<ApiSuccess<T>>(url);
  return res.data.data;
}

/** Full envelope (for paginated lists that need `meta`). */
export async function apiGetPage<T>(url: string, config?: AxiosRequestConfig) {
  const res = await http.get<ApiSuccess<T[]>>(url, config);
  return res.data;
}
