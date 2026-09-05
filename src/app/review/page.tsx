
import { CheckIcon } from '@/components/icons';
import { AppShell } from '@/components/shell/AppShell';
import { ButtonLink } from '@/components/ui/Button';
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
export const metadata = { robots: { index: false, follow: false } };

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
      <div className="review-guidance">
        <p className="text-sm text-ink-soft"><strong className="font-medium text-ink">This is for me</strong> keeps the assignment in your relevant coursework.</p>
        <p className="text-sm text-ink-soft"><strong className="font-medium text-ink">Not for me</strong> removes it from your relevant coursework. You can undo either answer below.</p>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<CheckIcon className="size-6" />}
          title="Nothing to review"
          body="No assignments are waiting for a decision in this view. New or ambiguous coursework appears here after a sync."
          action={
            <ButtonLink href="/" variant="secondary">Back to Today</ButtonLink>
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.assignmentId} className="review-item">
              <AssignmentCard
                item={item}
                now={now}
                timeZone={freshness.timeZone}
                // The scope line is the point here: the student is told what
                // LockIn actually found, so they can judge it for themselves
                // instead of being asked to trust an invisible rule.
                showScope
              />
              <div className="review-decision">
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
              <li key={item.assignmentId} className="review-item">
                <AssignmentCard item={item} now={now} timeZone={freshness.timeZone} />
                <div className="review-decision">
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
