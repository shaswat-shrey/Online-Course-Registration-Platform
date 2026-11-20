import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * List state (page, search, filters) kept in the URL so views are shareable
 * and survive reloads. Changing any filter resets to page 1.
 */
export function useListParams<K extends string>(filterKeys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const q = params.get('q') ?? '';
  // Cheap to derive; consumers use the values (not object identity) in query keys.
  const filters = Object.fromEntries(filterKeys.map((k) => [k, params.get(k) ?? ''])) as Record<
    K,
    string
  >;

  const update = useCallback(
    (changes: Record<string, string | number | null>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v === null || v === '' || (k === 'page' && v === 1)) next.delete(k);
            else next.set(k, String(v));
          }
          if (resetPage && !('page' in changes)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { page, q, filters, update };
}
