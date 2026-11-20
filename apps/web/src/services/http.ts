import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { ApiFailure, ApiSuccess } from '@ucrams/shared';
import { ApiError, NETWORK_ERROR } from './api-error';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/**
 * Shared Axios instance. Phase 2 adds the bearer token and the single-flight
 * refresh interceptor (ARCHITECTURE.md §4).
 */
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

http.interceptors.response.use(undefined, (error: unknown) => {
  if (error instanceof AxiosError) {
    if (error.response) {
      const { status, data } = error.response;
      if (isFailureEnvelope(data)) return Promise.reject(ApiError.fromEnvelope(status, data));
      return Promise.reject(
        new ApiError(status, 'HTTP_ERROR', `Request failed with status ${status}`),
      );
    }
    return Promise.reject(new ApiError(0, NETWORK_ERROR, 'Network error'));
  }
  return Promise.reject(error);
});

/** Performs a request and returns the envelope's `data`. */
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
