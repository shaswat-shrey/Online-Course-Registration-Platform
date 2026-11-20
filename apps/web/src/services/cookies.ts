import { AUTH_COOKIE } from '@ucrams/shared';

export function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const entry = document.cookie.split('; ').find((c) => c.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : undefined;
}

/** The CSRF cookie exists only while a refresh session may exist. */
export const csrfToken = () => readCookie(AUTH_COOKIE.csrf);
