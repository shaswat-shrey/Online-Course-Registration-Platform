/** Only same-app relative paths are accepted as post-login destinations (no open redirect). */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
    return null;
  return next;
}
