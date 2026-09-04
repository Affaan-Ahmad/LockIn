import { describe, expect, it } from 'vitest';

import { EMPTY_SYNC_COUNTS } from '@/domain/sync/outcome';
import { describeSyncOutcome } from '@/features/sync/outcome-message';

/**
 * What the student is told after pressing Sync.
 *
 * This is the layer where every backend failure in this system becomes visible
 * or does not. A sync run answers HTTP 200 even when it failed, because the
 * per-course breakdown in the body is the useful part -- which means a client
 * that reads only the counts converts *any* underlying fault (expired grant,
 * unreadable credentials, a killed function, a rate limit) into the sentence
 * "Already up to date."
 *
 * For a product whose failure mode is a missed deadline, that is the worst
 * sentence available: it is a claim that the deadlines on screen are current.
 */

describe('a run that did not succeed', () => {
  it('never reports a failed run as up to date', () => {
    const outcome = describeSyncOutcome('FAILED', EMPTY_SYNC_COUNTS, []);

    expect(outcome.presentation).not.toBe('SUCCESS');
    expect(outcome.text).not.toMatch(/up to date/i);
  });

  it('distinguishes a partial run from a total failure', () => {
    expect(describeSyncOutcome('PARTIAL_SUCCESS', EMPTY_SYNC_COUNTS, []).presentation).toBe(
      'PARTIAL',
    );
    expect(describeSyncOutcome('FAILED', EMPTY_SYNC_COUNTS, []).presentation).toBe('FAILED');
  });

  it('names an expired authorisation, because reconnecting is the fix', () => {
    const outcome = describeSyncOutcome('FAILED', EMPTY_SYNC_COUNTS, [
      { code: 'AUTHORIZATION_EXPIRED' },
    ]);

    expect(outcome.text).toMatch(/reconnect/i);
  });

  it('tells the student to wait when Google is rate limiting us', () => {
    // Retrying is the natural instinct and the wrong move here.
    const outcome = describeSyncOutcome('FAILED', EMPTY_SYNC_COUNTS, [{ code: 'RATE_LIMITED' }]);

    expect(outcome.text).toMatch(/rate limit/i);
  });

  it('names a disabled Classroom API, which no student action can fix', () => {
    const outcome = describeSyncOutcome('FAILED', EMPTY_SYNC_COUNTS, [
      { code: 'GOOGLE_API_DISABLED' },
    ]);

    expect(outcome.text).toMatch(/switched off/i);
  });

  it('stays generic for a code the API did not mark safe to name', () => {
    // A CONFIG_ERROR is real and worth failing on, but its message is for the
    // operator's logs. The student gets the fact, not the cause.
    const outcome = describeSyncOutcome('FAILED', EMPTY_SYNC_COUNTS, [{ code: 'CONFIG_ERROR' }]);

    expect(outcome.presentation).toBe('FAILED');
    expect(outcome.text).toMatch(/couldn't refresh/i);
    expect(outcome.text).not.toMatch(/config|key|encryption/i);
  });

  it('does not accept a still-running body as a finished success', () => {
    expect(describeSyncOutcome('RUNNING', EMPTY_SYNC_COUNTS, []).presentation).toBe('IN_PROGRESS');
    expect(describeSyncOutcome('QUEUED', EMPTY_SYNC_COUNTS, []).presentation).toBe('IN_PROGRESS');
  });

  it('treats an abandoned run as a failure, never as an outcome to ignore', () => {
    const outcome = describeSyncOutcome('ABANDONED', EMPTY_SYNC_COUNTS, []);

    expect(outcome.presentation).toBe('FAILED');
    expect(outcome.text).not.toMatch(/up to date/i);
  });
});

describe('a run that succeeded', () => {
  it('reads the counts the API actually sends', () => {
    // The original client read `created` / `updated`, which are not fields of
    // SyncCounts. Every successful sync therefore reported zero and zero, and
    // said "Already up to date." while importing coursework.
    const outcome = describeSyncOutcome(
      'SUCCESS',
      { ...EMPTY_SYNC_COUNTS, assignmentsCreated: 3, assignmentsUpdated: 2 },
      [],
    );

    expect(outcome.presentation).toBe('SUCCESS');
    expect(outcome.text).toContain('3 new, 2 updated.');
  });

  it('says up to date only when nothing actually changed', () => {
    const outcome = describeSyncOutcome('SUCCESS', EMPTY_SYNC_COUNTS, []);

    expect(outcome.presentation).toBe('SUCCESS');
    expect(outcome.text).toBe('Already up to date.');
  });
});
