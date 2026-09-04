import type { SyncCounts, SyncRunStatus } from '@/domain/sync/outcome';

/**
 * How a run is described to the student.
 *
 * Pure, and deliberately not inside the button. Two mistakes lived here before
 * and neither was visible from the UI code:
 *
 *   The counts are named `assignmentsCreated` / `assignmentsUpdated`. The button
 *   read `created` / `updated`, which are not fields of `SyncCounts`, so every
 *   run -- including one that imported fifty assignments -- said "Already up to
 *   date." Reading them through a typed parameter makes that a compile error.
 *
 *   A run that failed still answered HTTP 200, because the per-course breakdown
 *   is the useful part of the body. `status` is therefore the only thing
 *   separating "nothing to do" from "nothing worked", and a client that skips it
 *   tells a student their deadlines are current at the moment they stopped
 *   being current.
 *
 * The four outcomes below are exhaustive over the state machine, so a status
 * this file has never heard of cannot fall through into the success branch.
 */

export type SyncPresentation = 'IN_PROGRESS' | 'SUCCESS' | 'PARTIAL' | 'FAILED';

export interface SyncIssueSummary {
  readonly code?: string | undefined;
}

export interface SyncOutcomeMessage {
  readonly text: string;
  readonly presentation: SyncPresentation;
}

/** Not a display concern: it decides whether the client keeps polling. */
export function presentationFor(status: SyncRunStatus | undefined): SyncPresentation {
  switch (status) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'PARTIAL_SUCCESS':
      return 'PARTIAL';
    case 'FAILED':
    case 'ABANDONED':
      return 'FAILED';
    case 'QUEUED':
    case 'RUNNING':
      return 'IN_PROGRESS';
    default:
      // An unrecognised or absent status is unfinished, never finished. Any
      // other default turns a future state into a false "up to date".
      return 'IN_PROGRESS';
  }
}

export function describeSyncOutcome(
  status: SyncRunStatus | undefined,
  counts: Partial<SyncCounts> | undefined,
  issues: readonly SyncIssueSummary[] | undefined,
): SyncOutcomeMessage {
  const presentation = presentationFor(status);

  if (presentation === 'IN_PROGRESS') {
    return { text: 'Updating Classroom…', presentation };
  }

  if (presentation === 'FAILED' || presentation === 'PARTIAL') {
    return { text: describeFailure(presentation, issues), presentation };
  }

  const created = counts?.assignmentsCreated ?? 0;
  const updated = counts?.assignmentsUpdated ?? 0;

  return {
    text:
      created === 0 && updated === 0
        ? 'Already up to date.'
        : `Classroom updated — ${String(created)} new, ${String(updated)} updated.`,
    presentation,
  };
}

/**
 * Names the cause when the API marked one safe to name.
 *
 * "Reconnect Google" and "wait, Google is rate limiting us" are different
 * instructions and only one is worth acting on now. Anything else falls back to
 * the plain fact -- never to silence, and never to reassurance.
 */
function describeFailure(
  presentation: 'FAILED' | 'PARTIAL',
  issues: readonly SyncIssueSummary[] | undefined,
): string {
  const codes = new Set((issues ?? []).map((issue) => issue.code));

  if (codes.has('AUTHORIZATION_EXPIRED')) {
    return 'Google access needs reconnecting. Open Settings to reconnect.';
  }
  if (codes.has('GOOGLE_API_DISABLED')) {
    return 'The Google Classroom API is switched off for this app.';
  }
  if (codes.has('RATE_LIMITED')) {
    return 'Google is rate limiting us. Try again in a few minutes.';
  }

  return presentation === 'PARTIAL'
    ? "Some courses couldn't be updated."
    : "Couldn't refresh Classroom. Your list may be out of date.";
}
