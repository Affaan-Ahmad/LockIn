import { describe, expect, it } from 'vitest';
import { syncPresentation } from '@/features/sync/status-presentation';
import { GROUP_ORDER, submissionPresentation } from '@/features/assignments/presentation';
import type { FreshnessView } from '@/lib/queries';

const fresh: FreshnessView = {
  level: 'FRESH', reason: 'Recently synced', ageMs: 120_000,
  lastSuccessfulSyncAt: '2026-09-05T10:00:00Z', timeZone: 'Asia/Karachi',
  connectionUsable: true, lastRunStatus: 'SUCCESS',
};

describe('frontend preserves backend uncertainty', () => {
  it.each(['FAILED', 'ABANDONED'] as const)('does not claim a recent %s run is current', (lastRunStatus) => {
    const result = syncPresentation({ ...fresh, lastRunStatus });
    expect(result.prominent).toBe(true);
    expect(result.tone).toBe('danger');
    expect(result.label).not.toMatch(/^Updated/);
    expect(result.detail).toContain('Last complete update');
  });
  it('treats a queued run as in progress, not as stale data', () => {
    // A worker that hit its deadline hands the run over and it sits QUEUED
    // until a continuation claims it. That is a sync in flight; saying
    // "showing older coursework" tells the student nothing is happening.
    const queued = syncPresentation({
      level: 'STALE',
      reason: 'handed over',
      ageMs: 9 * 60 * 60 * 1000,
      lastSuccessfulSyncAt: new Date().toISOString(),
      timeZone: 'UTC',
      lastRunStatus: 'QUEUED',
      connectionUsable: true,
    });

    expect(queued.label).toBe('Sync in progress');
  });

  it('reports partial and running independently of timestamp freshness', () => {
    expect(syncPresentation({ ...fresh, lastRunStatus: 'PARTIAL_SUCCESS' }).label).toContain('Some courses');
    expect(syncPresentation({ ...fresh, lastRunStatus: 'RUNNING' }).label).toContain('in progress');
  });
  it('does not describe never-synced connected users as disconnected', () => {
    const result = syncPresentation({ ...fresh, level: 'UNAVAILABLE', lastRunStatus: null,
      lastSuccessfulSyncAt: null, ageMs: null });
    expect(result.label).toBe('Coursework not synced yet');
    expect(result.detail).toContain('No successful sync');
  });
  it('directs unusable connections to reconnect', () => {
    expect(syncPresentation({ ...fresh, connectionUsable: false }).label).toContain('Reconnect');
  });
  it('does not describe old successful data as a failed sync', () => {
    expect(syncPresentation({ ...fresh, level: 'STALE' }).label).toBe('Showing older coursework');
  });
  it('keeps undated assignments visible and unknown submissions unknown', () => {
    expect(GROUP_ORDER).toContain('none');
    expect(submissionPresentation(null).show).toBe(false);
    expect(submissionPresentation('FUTURE_UNKNOWN_STATE').show).toBe(false);
  });
});
