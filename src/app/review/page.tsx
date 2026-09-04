import Link from 'next/link';

import { CheckIcon } from '@/components/icons';
import { AppShell } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { AssignmentCard } from '@/features/assignments/AssignmentCard';
import { RelevanceChoice } from '@/features/review/RelevanceChoice';
import { AutoSync } from '@/features/sync/AutoSync';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { loadDecisions, loadReviewQueue, requireSessionUser } from '@/lib/queries';

/**
 * Work LockIn could not place.
 *
 * The screen that makes the whole approach honest. Anything the classifier is
 * unsure about is shown here with the reason it is unsure, rather than being
 * quietly assigned to a side. A product that guessed would be wrong silently;
 * this one is unsure out loud.
 *
 * Answering removes an item from this queue, so the answers are listed below
 * with an undo. Without that, a mistaken "not my section" would hide real
 * coursework permanently and unrecoverably.
 */
export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const user = await requireSessionUser();
  const [{ items, freshness }, decisions] = await Promise.all([
    loadReviewQueue(user.id),
    loadDecisions(user.id),
    ]);

  const now = new Date();

  return (
    <AppShell
      title="Review"
      subtitle={
        items.length === 0
          ? undefined
          : 'LockIn could not tell whether these are for your section.'
      }
      reviewCount={items.length}
      headerAside={<SyncStatus freshness={freshness} />}
    >
      <SyncStatus freshness={freshness} variant="banner" />
      <AutoSync level={freshness.level} />

      {items.length === 0 ? (
        <EmptyState
          icon={<CheckIcon className="size-6" />}
          title="Nothing to review"
          body="Every assignment LockIn has read was clear enough to place. Anything ambiguous will appear here."
          action={
            <Link href="/">
              <Button variant="secondary">Back to Today</Button>
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.assignmentId}>
              <AssignmentCard
                item={item}
                now={now}
                timeZone={freshness.timeZone}
                // The scope line is the point here: the student is told what
                // LockIn actually found, so they can judge it for themselves
                // instead of being asked to trust an invisible rule.
                showScope
              />
              <div className="px-4">
                <RelevanceChoice
                  assignmentId={item.assignmentId}
                  current={null}
                  title={item.title}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {decisions.length === 0 ? null : (
        <section className="mt-8" aria-labelledby="decisions">
          <h2
            id="decisions"
            className="mb-3 flex items-baseline gap-2 px-0.5 text-sm font-semibold text-ink-soft"
          >
            Your answers
            <span className="font-normal text-ink-muted">
              {decisions.length}
            </span>
          </h2>
          <ul className="flex flex-col gap-3">
            {decisions.map((item) => (
              <li key={item.assignmentId}>
                <AssignmentCard item={item} now={now} timeZone={freshness.timeZone} />
                <div className="px-4">
                  <RelevanceChoice
                    assignmentId={item.assignmentId}
                    // An override can only be one of two values; the feed
                    // reports it as the effective relevance.
                    current={item.relevance === 'NOT_RELEVANT' ? 'NOT_RELEVANT' : 'RELEVANT'}
                    title={item.title}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
