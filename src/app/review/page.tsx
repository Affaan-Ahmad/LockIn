
import { CheckIcon } from '@/components/icons';
import { Shell } from '@/components/shell/Shell';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { AssignmentCard } from '@/features/assignments/AssignmentCard';
import { RelevanceChoice } from '@/features/review/RelevanceChoice';
import { SubmittedWork } from '@/features/review/SubmittedWork';
import { AutoSync } from '@/features/sync/AutoSync';
import { SyncStatus } from '@/features/sync/SyncStatus';
import { readTimeFormat } from '@/lib/preferences';
import {
  loadDecisions,
  loadReviewQueue,
  loadSubmitted,
  requireSessionUser,
} from '@/lib/queries';

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
 *
 * The queue is also, for most students, empty -- unambiguous sections classify
 * cleanly, and a screen that is blank every time you open it stops being worth
 * opening. So the screen carries a second thing that is always true: the work
 * already handed in, filterable by course, with room to keep a note against it.
 * The queue keeps its place at the top when it has anything in it; it is not
 * replaced, because "unsure out loud" is the point of the product.
 */
export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function ReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSessionUser();
  const [params, { items, freshness }, decisions, submitted, timeFormat] = await Promise.all([
    searchParams,
    loadReviewQueue(user.id),
    loadDecisions(user.id),
    loadSubmitted(user.id),
    readTimeFormat(),
    ]);

  const now = new Date();
  // A course id that matches nothing simply shows everything, rather than an
  // error: a stale or hand-edited link should not break the page.
  const selectedCourseId = typeof params['course'] === 'string' ? params['course'] : null;

  return (
    <Shell
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
      {/* Only shown when there is a queue to explain. Two paragraphs about how
          to answer a question nobody is being asked read as instructions for a
          screen that is not there. */}
      {items.length === 0 ? null : (
        <div className="review-guidance">
          <p className="text-sm text-ink-soft"><strong className="font-medium text-ink">This is for me</strong> keeps the assignment in your relevant coursework.</p>
          <p className="text-sm text-ink-soft"><strong className="font-medium text-ink">Not for me</strong> removes it from your relevant coursework. You can undo either answer below.</p>
        </div>
      )}

      {items.length === 0 ? (
        // Quieter than a full empty state, because the screen is no longer
        // empty -- the handed-in list below is the reason to be here. A
        // page-sized "nothing to review" above a populated list would be
        // describing something other than what the student is looking at.
        submitted.items.length === 0 ? (
          <EmptyState
            icon={<CheckIcon className="size-6" />}
            title="Nothing to review"
            body="No assignments are waiting for a decision, and nothing is marked as handed in yet. Both appear here after a sync."
            action={
              <ButtonLink href="/" variant="secondary">Back to Today</ButtonLink>
            }
          />
        ) : (
          <p className="text-[13px] text-ink-soft">
            Nothing is waiting for a decision. Anything LockIn cannot place appears here.
          </p>
        )
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

      <SubmittedWork
        items={submitted.items}
        notes={submitted.notes}
        courses={submitted.courses}
        selectedCourseId={selectedCourseId}
        now={now}
        timeZone={freshness.timeZone}
        timeFormat={timeFormat}
      />
    </Shell>
  );
}
