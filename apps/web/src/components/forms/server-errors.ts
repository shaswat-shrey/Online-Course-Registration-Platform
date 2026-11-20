import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { errorMessage, isApiError } from '@/services/api-error';

/**
 * Maps API field errors (`details.fields[].path` like "body.code") onto form
 * fields. Returns a message for errors that did not map to a field.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
): string | null {
  if (isApiError(error)) {
    const fields =
      (error.details as { fields?: Array<{ path: string; message: string }> } | undefined)
        ?.fields ?? [];
    let mapped = 0;
    for (const f of fields) {
      const name = f.path.replace(/^body\./, '').split('.')[0]!;
      if (knownFields.includes(name)) {
        setError(name as Path<T>, { type: 'server', message: f.message });
        mapped += 1;
      }
    }
    if (mapped > 0 && mapped === fields.length) return null;
  }
  return errorMessage(error);
}
