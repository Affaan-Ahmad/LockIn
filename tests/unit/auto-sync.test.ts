import { describe, expect, it } from 'vitest';

import { beforeEach } from 'vitest';

import {
  AUTO_SYNC_COOLDOWN_MS,
  consumeReloadGrant,
  cooldownElapsed,
  resetReloadGrantForTests,
  shouldAutoSync,
  wasReloaded,
} from '@/features/sync/auto-sync';

/**
 * When opening the app refreshes it by itself.
 *
 * The rule lives in a pure function precisely so it can be argued with here
 * rather than discovered in production. Two of its clauses cost real money if
 * they are wrong: refreshing when there is nothing to refresh burns a
 * rate-limit slot the student may need, and refreshing on a revoked grant
 * burns one that can never succeed.
 */

describe('deciding to refresh on arrival', () => {
  it('refreshes data that has aged past the comfort window', () => {
    expect(shouldAutoSync('AGEING')).toBe(true);
    expect(shouldAutoSync('STALE')).toBe(true);
  });

  it('retries a run that only partly succeeded', () => {
    // Some course failed last time. Arriving is exactly the moment to try it
    // again, and PARTIAL is the only signal that says so.
    expect(shouldAutoSync('PARTIAL')).toBe(true);
  });

  it('leaves fresh data alone', () => {
    // Under thirty minutes old. Spending a Google request to replace it with
    // the same rows is waste, and the quota is shared with the button.
    expect(shouldAutoSync('FRESH')).toBe(false);
  });

  it('does not retry when the Google grant is gone', () => {
    // The clause worth pausing on. UNAVAILABLE means no authorisation, so
    // every attempt fails identically -- it would consume the rate limit and
    // resolve to the same message the student is already being shown. The
    // reconnect prompt is the answer there, not a retry.
    expect(shouldAutoSync('UNAVAILABLE')).toBe(false);
  });
});

describe('the cooldown between automatic attempts', () => {
  const NOW = 1_800_000_000_000;

  it('allows the first ever visit', () => {
    expect(cooldownElapsed(null, NOW)).toBe(true);
  });

  it('blocks a second screen opened moments later', () => {
    // The case it exists for: moving between Today, Upcoming and Review mounts
    // the component three times, and the server-rendered freshness on each is
    // a snapshot from before the first sync finished -- so all three look
    // stale. Without this, one sitting exhausts the rate limit.
    expect(cooldownElapsed(String(NOW - 30_000), NOW)).toBe(false);
  });

  it('allows a genuine return visit', () => {
    expect(cooldownElapsed(String(NOW - AUTO_SYNC_COOLDOWN_MS - 1), NOW)).toBe(true);
  });

  it('is shorter than the window that makes data stale in the first place', () => {
    // Otherwise the cooldown, not the freshness rule, would decide how current
    // the data gets to be.
    expect(AUTO_SYNC_COOLDOWN_MS).toBeLessThan(30 * 60 * 1000);
  });

  it('fails towards syncing when the stored value is unusable', () => {
    // Whatever is in browser storage is whatever is in browser storage: absent,
    // stale, or something a user typed into devtools. Being wrong here costs
    // one redundant request; the other direction silently never refreshes.
    expect(cooldownElapsed('not-a-number', NOW)).toBe(true);
    expect(cooldownElapsed('', NOW)).toBe(true);
  });

  it('recovers from a timestamp in the future', () => {
    // A clock change or a tampered value must not lock automatic sync out
    // until real time catches up.
    expect(cooldownElapsed(String(NOW + 86_400_000), NOW)).toBe(true);
  });
});

describe('an explicit reload', () => {
  it('is recognised, and a plain navigation is not', () => {
    // Pull-to-refresh in a mobile browser, Ctrl+R and the toolbar button all
    // arrive as a reload. Following a link does not.
    expect(wasReloaded('reload')).toBe(true);
    expect(wasReloaded('navigate')).toBe(false);
    expect(wasReloaded('back_forward')).toBe(false);
  });

  it('is not assumed when the browser will not say', () => {
    // Navigation Timing is absent in older Safari and some webviews. Treating
    // silence as "reload" would bypass the cooldown on every page load and
    // undo the throttle entirely.
    expect(wasReloaded(undefined)).toBe(false);
  });

  it('overrides the cooldown but not the freshness rule', () => {
    // The distinction the component encodes: a reload means "make this current
    // now", which beats an anti-stampede throttle. It does not make
    // thirty-second-old data worth re-fetching.
    expect(wasReloaded('reload')).toBe(true);
    expect(shouldAutoSync('FRESH')).toBe(false);
  });
});

describe('the reload grant is spendable once', () => {
  beforeEach(() => {
    resetReloadGrantForTests();
  });

  it('is granted to the first screen that asks', () => {
    expect(consumeReloadGrant('reload')).toBe(true);
  });

  it('is refused to every screen after it', () => {
    // The bug this exists for, and it cost a real student their rate limit.
    // Navigation Timing describes the *document* load, and a Next.js
    // client-side route change creates no new entry -- so after opening the app
    // with a reload, every subsequent screen still saw 'reload' and skipped the
    // cooldown. Today -> Upcoming -> Courses -> Settings fired four syncs in
    // seconds; twice through and the ten-per-ten-minutes budget was gone, which
    // presents as sync refusing to start at all.
    expect(consumeReloadGrant('reload')).toBe(true);
    expect(consumeReloadGrant('reload')).toBe(false);
    expect(consumeReloadGrant('reload')).toBe(false);
    expect(consumeReloadGrant('reload')).toBe(false);
  });

  it('is never granted for an ordinary navigation', () => {
    expect(consumeReloadGrant('navigate')).toBe(false);
    // ...and refusing does not spend it, so a genuine reload later still counts.
    expect(consumeReloadGrant('reload')).toBe(true);
  });

  it('is not granted when the browser will not say how the page loaded', () => {
    expect(consumeReloadGrant(undefined)).toBe(false);
  });

  it('leaves the cooldown governing everything after the first screen', () => {
    consumeReloadGrant('reload');

    // Second screen, moments later: no grant, so the cooldown decides -- and it
    // says no, which is the whole point.
    expect(consumeReloadGrant('reload')).toBe(false);
    expect(cooldownElapsed(String(Date.now() - 1_000), Date.now())).toBe(false);
  });
});
