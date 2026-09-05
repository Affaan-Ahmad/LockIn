import Link from 'next/link';

export interface WorkloadHeaderProps {
  readonly overdueCount: number;
  readonly todayCount: number;
  readonly upcomingCount: number;
  readonly reviewCount?: number;
  readonly undatedCount?: number;
}

export function WorkloadHeader({
  overdueCount, todayCount, upcomingCount, reviewCount = 0, undatedCount = 0, hour,
}: WorkloadHeaderProps & { readonly hour: number }) {
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const headline = overdueCount > 0 ? 'Start with what needs attention'
    : todayCount > 0 ? 'Your focus for today'
    : 'A little room to plan ahead';
  return (
    <div className="workload-header">
      <div>
        <p className="text-sm text-ink-muted">{greeting}</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">{headline}</h2>
      </div>
      <div className="workload-summary">
        <span><strong>{overdueCount}</strong> overdue</span>
        <span><strong>{todayCount}</strong> today</span>
        <span><strong>{upcomingCount}</strong> coming up</span>
        {undatedCount > 0 ? <span><strong>{undatedCount}</strong> without dates</span> : null}
        {reviewCount > 0 ? <Link href="/review" className="font-medium text-review underline underline-offset-4">{reviewCount} to review</Link> : null}
      </div>
      <p className="workload-note">From your tracked courses · Counts reflect the coursework in this view.</p>
    </div>
  );
}
