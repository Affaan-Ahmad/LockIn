import { cx } from '@/lib/cx';

/**
 * The one-line answer to "what do I need to do?".
 *
 * Not a card any more, and that is the change that matters. It used to be a
 * clay panel sitting above a list of clay cards, so the summary and the
 * assignments carried identical weight and the eye had nowhere to land first.
 * Set directly on the ground it reads as the page speaking, and the cards below
 * are the only raised objects on the screen.
 *
 * The counts sit inline in a sentence rather than in a row of statistic tiles.
 * A student with three assignments does not need an analytics dashboard, and
 * three big numbers on a phone is the most generic thing an app can do.
 *
 * Deliberately restrained with the slang. "Cooked" is funny once and unhelpful
 * when you are actually behind, so the workload states stay legible and the
 * personality lives in the greeting instead.
 */

export interface WorkloadHeaderProps {
  readonly overdueCount: number;
  readonly todayCount: number;
  readonly upcomingCount: number;
}

function greeting(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function WorkloadHeader({
  overdueCount,
  todayCount,
  upcomingCount,
  hour,
}: WorkloadHeaderProps & { readonly hour: number }) {
  const nothing = overdueCount === 0 && todayCount === 0 && upcomingCount === 0;

  const headline = nothing
    ? "You're all caught up"
    : overdueCount > 0
      ? `${String(overdueCount)} overdue`
      : todayCount > 0
        ? `${String(todayCount)} due today`
        : `${String(upcomingCount)} coming up`;

  const tone = nothing
    ? 'text-ink'
    : overdueCount > 0
      ? 'text-danger'
      : todayCount > 0
        ? 'text-warning'
        : 'text-ink';

  // Whatever the headline already said is not repeated underneath it.
  const rest = [
    overdueCount > 0 && todayCount > 0 ? `${String(todayCount)} due today` : null,
    upcomingCount > 0 && (overdueCount > 0 || todayCount > 0)
      ? `${String(upcomingCount)} coming up`
      : null,
      ].filter((part): part is string => part !== null);

  return (
    <div className="mb-8">
      <p className="text-sm text-ink-muted">{greeting(hour)}</p>
      <p className={cx('mt-1 text-2xl font-semibold tracking-[-0.02em]', tone)}>{headline}</p>
      {nothing ? (
        <p className="mt-2 text-sm text-ink-soft">Nothing needs your attention right now.</p>
      ) : rest.length > 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{rest.join(', ')}.</p>
      ) : null}
    </div>
  );
}
