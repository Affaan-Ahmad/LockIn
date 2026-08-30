import type { AppError } from './errors';

/**
 * Used only where a failure is an ordinary, expected outcome that the caller
 * must branch on -- notably per-item mapping during sync, where one malformed
 * coursework item must not abort the other 499.
 *
 * Genuinely exceptional failures still throw. Wrapping everything in Result
 * turns every call site into noise.
 */
export type Result<T, E extends AppError = AppError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends AppError>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function partition<T, E extends AppError>(
  results: readonly Result<T, E>[],
): { readonly values: T[]; readonly errors: E[] } {
  const values: T[] = [];
  const errors: E[] = [];
  for (const result of results) {
    if (result.ok) values.push(result.value);
    else errors.push(result.error);
  }
  return { values, errors };
}
