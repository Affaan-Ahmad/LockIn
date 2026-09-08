import 'server-only';

import type { PostgrestError } from '@supabase/supabase-js';

import { NotFoundError, PersistenceError, SyncAlreadyRunningError } from '@/shared/errors';

/**
 * Translates PostgREST failures into the application's error taxonomy.
 *
 * Three SQLSTATEs carry real meaning for this system and must not be flattened
 * into a generic database error:
 *
 *   55006 (object_in_use) is raised by app_acquire_sync_run when another run
 *   already holds the lease. That is a normal, expected outcome -- "you are
 *   already syncing" -- not a failure to report as breakage.
 *
 *   23505 (unique_violation) on the single-active-run index means the same
 *   thing arrived by a different route: two callers raced past the advisory
 *   lock boundary and Postgres arbitrated.
 *
 *   P0002 (no_data_found) is raised by the ownership guards on the override and
 *   ignore writes, and means "that assignment is not yours" -- a 404, not a
 *   fault.
 *
 * Everything else becomes a PersistenceError whose retryable flag reflects
 * whether trying again could plausibly help.
 */
export function translatePostgrestError(error: PostgrestError, operation: string): Error {
  const code = error.code;

  if (code === '55006') {
    return new SyncAlreadyRunningError(
      'A synchronisation is already running for this account',
      { context: { operation } },
    );
  }

  if (code === '23505' && error.message.includes('sync_runs_single_active')) {
    return new SyncAlreadyRunningError(
      'A synchronisation is already running for this account',
      { context: { operation } },
    );
  }

  // P0002 (no_data_found) is what the ownership guards in app_set_override and
  // app_set_assignment_ignored raise when the assignment is not the caller's.
  // It means the same thing for a row that belongs to somebody else as for one
  // that was never there, and both must keep answering identically -- that
  // sameness is the point of the guard.
  //
  // Mapped rather than left to fall through: as a PersistenceError this became
  // a 500 with a generic body, which reported a routine "you asked about
  // something that is not yours" as server breakage.
  if (code === 'P0002') {
    return new NotFoundError('Assignment not found', { context: { operation } });
  }

  // 42501 is insufficient_privilege, which for us means RLS refused the write.
  // Surfacing it as a persistence error rather than an auth error is correct:
  // the user is authenticated, the row simply is not theirs.
  const retryable = code === '40001' || code === '40P01' || code === '57014';

  return new PersistenceError(`${operation} failed: ${error.message}`, {
    retryable,
    context: { operation, code: code ?? 'unknown', details: error.details ?? '' },
    });
}

export function toDbTimestamp(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function fromDbTimestamp(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

/**
 * PostgREST renders bytea as a `\x`-prefixed hex string and accepts the same
 * form on write. Keeping the conversion in one place stops an encrypted token
 * from being written in a format that reads back as garbage.
 */
export function bufferToPgHex(buffer: Buffer): string {
  return `\\x${buffer.toString('hex')}`;
}

export function pgHexToBuffer(value: string | null): Buffer | null {
  if (value === null || value === '') return null;
  const hex = value.startsWith('\\x') ? value.slice(2) : value;
  if (hex === '') return null;
  return Buffer.from(hex, 'hex');
}
