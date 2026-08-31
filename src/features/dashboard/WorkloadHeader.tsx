import { Surface } from '@/components/ui/Surface';
import { cx } from '@/lib/cx';

/**
 * The one-line answer to "what do I need to do?".
 *
 * Deliberately restrained with the slang. "Cooked" is funny once and unhelpful
 * when you are actually behind, so the workload states stay legible and the
 * personality lives in the greeting instead. Deadlines are serious even when
 * the brand is not.
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
    ? 'text-success'
    : overdueCount > 0
      ? 'text-danger'
      : todayCount > 0
        ? 'text-warning'
        : 'text-ink';

  return (
    <Surface variant="clay" pad="lg" className="mb-6">
      <p className="text-[0.8125rem] font-medium text-ink-soft">{greeting(hour)}</p>
      <p className={cx('mt-1 text-[1.75rem] leading-tight font-bold tracking-[-0.02em]', tone)}>
        {headline}
      </p>

      {nothing ? (
        <p className="mt-1.5 text-[0.9375rem] text-ink-soft">
          Nothing needs your attention right now.
        </p>
      ) : (
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[0.8125rem]">
          {overdueCount > 0 ? <Stat label="Overdue" value={overdueCount} tone="text-danger" /> : null}
          {todayCount > 0 ? <Stat label="Today" value={todayCount} tone="text-warning" /> : null}
          <Stat label="Coming up" value={upcomingCount} tone="text-ink" />
        </dl>
      )}
    </Surface>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="order-2 text-ink-soft">{label}</dt>
      <dd className={cx('order-1 text-[1.0625rem] font-bold', tone)}>{value}</dd>
    </div>
  );
}
