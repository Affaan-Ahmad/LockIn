import type { BadgeTone } from '@/components/ui/Badge';
import type { UrgencyBand } from '@/lib/format';

/**
 * Domain status to visual treatment.
 *
 * The Open/Closed seam on the frontend, mirroring how `SectionScopeRule` works
 * in the backend. A new relevance value, submission state or urgency band is a
 * new entry in a map here -- not a new `if` inside AssignmentCard, and not a
 * new conditional in three other components that also happen to show status.
 *
 * The rule that keeps this honest: **nothing here invents meaning.** Every
 * value maps a status the backend actually returned. If the backend says
 * UNCERTAIN, the UI says "Check this" -- it does not quietly pick a side.
 */

export type Relevance = 'RELEVANT' | 'NOT_RELEVANT' | 'UNCERTAIN';
export type SubmissionState =
  | 'NEW'
  | 'CREATED'
  | 'TURNED_IN'
  | 'RETURNED'
  | 'RECLAIMED_BY_STUDENT'
  | 'UNSPECIFIED'
  | null;

export interface StatusPresentation {
  readonly label: string;
  readonly tone: BadgeTone;
  /** Whether to show it at all. Most items are unremarkable and need no badge. */
  readonly show: boolean;
}

/**
 * Urgency.
 *
 * Deliberately restrained. Turning every card red destroys the meaning of red,
 * and a student who sees eight red cards learns to ignore all of them. Only
 * genuinely overdue work gets the danger tone; "due today" is a warning, and
 * everything further out is plain.
 */
export const URGENCY: Readonly<Record<UrgencyBand, StatusPresentation>> = {
  overdue: { label: 'Overdue', tone: 'danger', show: true },
  today: { label: 'Due today', tone: 'warning', show: true },
  tomorrow: { label: 'Tomorrow', tone: 'neutral', show: false },
  thisWeek: { label: 'This week', tone: 'neutral', show: false },
  later: { label: 'Later', tone: 'neutral', show: false },
  none: { label: 'No due date', tone: 'neutral', show: true },
};

/**
 * Relevance.
 *
 * UNCERTAIN is the one that matters. It is phrased as a question the app is
 * asking, not a verdict it has reached -- "Check this" rather than "Maybe
 * relevant" -- because the student is being asked to decide, and implying we
 * already leaned one way would bias that decision.
 *
 * NOT_RELEVANT never appears on a card in the normal feed: those items are
 * filtered out server-side. It exists here for the review screen, where a
 * student is looking at what LockIn decided and may want to overturn it.
 */
export const RELEVANCE: Readonly<Record<Relevance, StatusPresentation>> = {
  RELEVANT: { label: 'For you', tone: 'success', show: false },
  UNCERTAIN: { label: 'Check this', tone: 'review', show: true },
  NOT_RELEVANT: { label: 'Not for you', tone: 'neutral', show: true },
};

/**
 * Submission state.
 *
 * Only "done" states are worth a badge. Absence of a badge means outstanding,
 * which is the common case and needs no ink. Note that `null` is not the same
 * as NEW: null means Google told us nothing, and claiming "Not submitted" from
 * missing data would be inventing a fact.
 */
export const SUBMISSION: Readonly<Record<string, StatusPresentation>> = {
  TURNED_IN: { label: 'Submitted', tone: 'success', show: true },
  RETURNED: { label: 'Graded', tone: 'success', show: true },
  RECLAIMED_BY_STUDENT: { label: 'Unsubmitted', tone: 'warning', show: true },
  NEW: { label: 'Not submitted', tone: 'neutral', show: false },
  CREATED: { label: 'Draft', tone: 'neutral', show: false },
  UNSPECIFIED: { label: '', tone: 'neutral', show: false },
};

export function submissionPresentation(state: SubmissionState): StatusPresentation {
  if (state === null) return { label: '', tone: 'neutral', show: false };
  return SUBMISSION[state] ?? { label: '', tone: 'neutral', show: false };
}

/**
 * Freshness.
 *
 * Never silently downgraded to make the interface look calmer. If the last sync
 * failed, the student is told, because the alternative is presenting stale
 * coursework as current -- and the cost of that is a missed deadline.
 */
export type FreshnessLevel = 'FRESH' | 'AGEING' | 'STALE' | 'PARTIAL' | 'UNAVAILABLE';

export const FRESHNESS: Readonly<
  Record<FreshnessLevel, { readonly tone: BadgeTone; readonly prominent: boolean }>
> = {
  FRESH: { tone: 'neutral', prominent: false },
  AGEING: { tone: 'neutral', prominent: false },
  STALE: { tone: 'warning', prominent: true },
  PARTIAL: { tone: 'warning', prominent: true },
  UNAVAILABLE: { tone: 'danger', prominent: true },
};

/** Group headings, in display order. Empty groups are never rendered. */
export const GROUP_ORDER: readonly UrgencyBand[] = [
  'overdue',
  'today',
  'tomorrow',
  'thisWeek',
  'later',
];

export const GROUP_LABEL: Readonly<Record<UrgencyBand, string>> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  later: 'Later',
  none: 'No due date',
};
