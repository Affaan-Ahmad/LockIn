'use client';

import { useEffect } from 'react';

import { clearSnapshot, readSnapshot, saveSnapshot, type OfflineAssignment } from './store';

/**
 * Copies what is on screen into local storage, so it can be read offline.
 *
 * Renders nothing. It is mounted by the Today screen with the data that screen
 * has already fetched and rendered — it triggers no request of its own, so it
 * cannot make the page slower or the data less current than what the student is
 * looking at.
 *
 * The user id is the safety mechanism. If a snapshot belonging to somebody else
 * is found, it is destroyed before this one is written: two accounts must never
 * have coursework on the device at the same time, and this is the only place
 * that can notice a change of account without a server round trip.
 */

export interface OfflineMirrorProps {
  readonly userId: string;
  readonly timeZone: string;
  readonly overdue: readonly OfflineAssignment[];
  readonly dueSoon: readonly OfflineAssignment[];
}

export function OfflineMirror({ userId, timeZone, overdue, dueSoon }: OfflineMirrorProps) {
  useEffect(() => {
    void (async () => {
      const existing = await readSnapshot();
      if (existing !== null && existing.userId !== userId) await clearSnapshot();

      await saveSnapshot({
        userId,
        savedAt: Date.now(),
        timeZone,
        overdue,
        dueSoon,
      });
    })();
  }, [userId, timeZone, overdue, dueSoon]);

  return null;
}
