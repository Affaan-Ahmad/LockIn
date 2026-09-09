'use client';

import { useEffect } from 'react';

import { saveSection, type OfflineSnapshot, type SectionName } from './store';

/**
 * Copies what a screen has already rendered into local storage.
 *
 * Renders nothing. Each screen mounts one of these with the data it just
 * fetched, so the mirror triggers no request of its own and the stored copy can
 * never be fresher or staler than what the student was looking at.
 *
 * Generic over the section rather than one component per screen: the only thing
 * that differs is which key is written, and three near-identical components
 * would be three places to forget the user check that lives in `saveSection`.
 */

export interface OfflineMirrorProps<K extends SectionName> {
  readonly userId: string;
  readonly timeZone: string;
  readonly section: K;
  readonly value: OfflineSnapshot[K];
}

export function OfflineMirror<K extends SectionName>({
  userId,
  timeZone,
  section,
  value,
}: OfflineMirrorProps<K>) {
  // Serialised for the dependency list. The value is a fresh object on every
  // render, so comparing by reference would rewrite the record on each one.
  const fingerprint = JSON.stringify(value);

  useEffect(() => {
    void saveSection(userId, timeZone, section, JSON.parse(fingerprint) as OfflineSnapshot[K]);
  }, [userId, timeZone, section, fingerprint]);

  return null;
}
