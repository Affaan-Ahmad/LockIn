import type { PostgrestError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { translatePostgrestError } from '@/infrastructure/supabase/repositories/shared';
import { isAppError } from '@/shared/errors';

/**
 * Which database failures mean something, and which are just failures.
 *
 * This translation is the only place a raw SQLSTATE becomes an application
 * error, and getting it wrong is quiet in both directions: an unmapped code
 * turns a routine outcome into a 500, and a mis-mapped one turns breakage into
 * a reassuring 404. Neither shows up as a crash.
 *
 * P0002 is the one these tests exist for. The ownership guards in
 * `app_set_override` and `app_set_assignment_ignored` raise it for an assignment
 * that is not the caller's -- deliberately without distinguishing "belongs to
 * someone else" from "does not exist", because telling those apart is exactly
 * the existence oracle the guards were added to remove.
 */

const pgError = (code: string, message = 'boom'): PostgrestError =>
  ({ code, message, details: '', hint: '', name: 'PostgrestError' }) as PostgrestError;

describe('translating a database failure', () => {
  it('reads P0002 as "not found", not as a server fault', () => {
    const translated = translatePostgrestError(pgError('P0002', 'assignment not found'), 'test');

    expect(isAppError(translated)).toBe(true);
    expect(isAppError(translated) && translated.code).toBe('NOT_FOUND');
  });

  it('does not mark a not-found as retryable', () => {
    // Retrying cannot make somebody else's assignment become yours, and a
    // client that retries on 404 turns one mistake into a loop.
    const translated = translatePostgrestError(pgError('P0002'), 'test');

    expect(isAppError(translated) && translated.retryable).toBe(false);
  });

  it('still reads a live lease as "already running"', () => {
    const translated = translatePostgrestError(pgError('55006'), 'test');

    expect(isAppError(translated) && translated.code).toBe('SYNC_ALREADY_RUNNING');
  });

  it('leaves anything unrecognised as a persistence error', () => {
    // The default has to stay the pessimistic one. A code nobody has considered
    // is breakage until somebody decides otherwise.
    const translated = translatePostgrestError(pgError('23503', 'fk violation'), 'test');

    expect(isAppError(translated) && translated.code).toBe('PERSISTENCE_ERROR');
  });

  it('keeps a database message out of anything a client would be shown', () => {
    // The message carries a constraint name and part of a statement. It belongs
    // in the log; the API's whitelist is what stops it reaching a browser, and
    // PERSISTENCE_ERROR is deliberately not on that list.
    const translated = translatePostgrestError(
      pgError('23503', 'insert violates foreign key "classification_overrides_assignment_id_fkey"'),
      'overrides.set',
    );

    expect(isAppError(translated) && translated.code).toBe('PERSISTENCE_ERROR');
  });
});
