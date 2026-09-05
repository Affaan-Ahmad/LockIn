import { describe, expect, it } from 'vitest';

import type { AppSupabaseClient } from '@/infrastructure/supabase/clients';
import { SupabaseSyncRunRepository } from '@/infrastructure/supabase/repositories/sync-run.repository';

/**
 * The composite-null trap, which has now caused two production incidents.
 *
 * A plpgsql function declared `returns sync_runs` answers with SQL NULL when it
 * has nothing to return -- `app_resume_sync_run` does exactly that when no run
 * is queued. PostgREST does not render that as `null`. It renders an object
 * whose every column is null, which is truthy in JavaScript and passes any
 * `!== null` check written against it.
 *
 * The first time, a work item with a null id read as a real one. The second
 * time, a lease with a null id read as a run worth adopting: `startOrResume`
 * concluded it had resumed something, never called `start()`, so no run was
 * created at all -- and the endpoint still answered 202 with `syncRunId: null`,
 * which the client then polled until it gave up.
 *
 * Both cost a user a broken sync and a confusing message. Hence a test that
 * reproduces the shape PostgREST actually returns rather than the shape the
 * type says it returns.
 */

const USER = '00000000-0000-4000-8000-000000000001';
const OWNER = '11111111-1111-4111-8111-111111111111';

/** Every column null, which is what PostgREST sends for a composite NULL. */
const COMPOSITE_NULL = {
  id: null,
  user_id: null,
  trigger: null,
  mode: null,
  status: null,
  started_at: null,
  finished_at: null,
  heartbeat_at: null,
  lease_expires_at: null,
  counts: null,
  error_summary: null,
  lease_owner: null,
  discovery_completed_at: null,
  resume_attempts: null,
};

const REAL_ROW = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  user_id: USER,
  trigger: 'MANUAL',
  mode: 'INCREMENTAL',
  status: 'RUNNING',
  started_at: '2026-09-05T12:00:00.000Z',
  finished_at: null,
  heartbeat_at: '2026-09-05T12:00:00.000Z',
  lease_expires_at: '2026-09-05T12:01:30.000Z',
  counts: null,
  error_summary: null,
  lease_owner: OWNER,
  discovery_completed_at: null,
  resume_attempts: 0,
};

function clientReturning(payload: unknown): AppSupabaseClient {
  return {
    rpc: () => Promise.resolve({ data: payload, error: null }),
  } as unknown as AppSupabaseClient;
}

describe('resuming when there is nothing to resume', () => {
  it('reports no lease when PostgREST sends a composite null', async () => {
    const repo = new SupabaseSyncRunRepository(clientReturning(COMPOSITE_NULL));

    await expect(repo.resume(USER, 90, OWNER)).resolves.toBeNull();
  });

  it('reports no lease when it sends a real null', async () => {
    const repo = new SupabaseSyncRunRepository(clientReturning(null));

    await expect(repo.resume(USER, 90, OWNER)).resolves.toBeNull();
  });

  it('reports no lease when it sends a one-element array of composite null', async () => {
    // PostgREST varies between a bare object and a single-element array
    // depending on the call shape, and both have to mean the same thing.
    const repo = new SupabaseSyncRunRepository(clientReturning([COMPOSITE_NULL]));

    await expect(repo.resume(USER, 90, OWNER)).resolves.toBeNull();
  });

  it('never produces a lease without a run id', async () => {
    // The property that actually matters. Whatever shape arrives, a lease that
    // does not identify a run must not exist -- adopting one skips start(), so
    // no run is created and the caller is handed an id resolving to nothing.
    for (const payload of [COMPOSITE_NULL, [COMPOSITE_NULL], null]) {
      const lease = await new SupabaseSyncRunRepository(clientReturning(payload)).resume(
        USER,
        90,
        OWNER,
      );
      expect(lease?.syncRunId ?? null).toBeNull();
    }
  });
});

describe('resuming a run that does exist', () => {
  it('returns the lease, carrying the owner token it claimed with', async () => {
    const repo = new SupabaseSyncRunRepository(clientReturning(REAL_ROW));

    const lease = await repo.resume(USER, 90, OWNER);

    expect(lease).toMatchObject({ syncRunId: REAL_ROW.id, userId: USER, owner: OWNER });
  });

  it('reads discovery as done only when the run recorded a timestamp', async () => {
    const notPlanned = await new SupabaseSyncRunRepository(clientReturning(REAL_ROW)).resume(
      USER,
      90,
      OWNER,
    );
    expect(notPlanned?.discoveryCompleted).toBe(false);

    const planned = await new SupabaseSyncRunRepository(
      clientReturning({ ...REAL_ROW, discovery_completed_at: '2026-09-05T12:00:05.000Z' }),
    ).resume(USER, 90, OWNER);
    expect(planned?.discoveryCompleted).toBe(true);
  });
});

describe('failing a run outright', () => {
  /**
   * The fenced functions answer with a boolean, and only `true` means the
   * database acted. Anything else -- `false` because the lease moved on, or the
   * null PostgREST sends when a function returns nothing -- has to read as "this
   * worker did not fail the run", because the caller uses that answer to decide
   * whether the run has been closed by somebody.
   */
  it('reports refusal when the lease has moved to another worker', async () => {
    const repo = new SupabaseSyncRunRepository(clientReturning(false));

    await expect(repo.failRun(REAL_ROW.id, OWNER, 'AUTHORIZATION_EXPIRED')).resolves.toBe(false);
  });

  it('does not read a null answer as a run that was failed', async () => {
    const repo = new SupabaseSyncRunRepository(clientReturning(null));

    await expect(repo.failRun(REAL_ROW.id, OWNER, 'AUTHORIZATION_EXPIRED')).resolves.toBe(false);
  });

  it('confirms only an explicit true', async () => {
    const repo = new SupabaseSyncRunRepository(clientReturning(true));

    await expect(repo.failRun(REAL_ROW.id, OWNER, 'AUTHORIZATION_EXPIRED')).resolves.toBe(true);
  });
});

describe('starting a run', () => {
  it('refuses to invent a lease from a composite null', async () => {
    // start() must never silently succeed with a null id either: the caller
    // would return 202 for a run that does not exist.
    const repo = new SupabaseSyncRunRepository(clientReturning(COMPOSITE_NULL));

    await expect(repo.start(USER, 'MANUAL', 'INCREMENTAL', 90, OWNER)).rejects.toThrow(
      /lease was not returned/i,
    );
  });

  it('returns the claimed run when one is created', async () => {
    const repo = new SupabaseSyncRunRepository(clientReturning(REAL_ROW));

    await expect(repo.start(USER, 'MANUAL', 'INCREMENTAL', 90, OWNER)).resolves.toMatchObject({
      syncRunId: REAL_ROW.id,
      owner: OWNER,
    });
  });
});
