import { Shell } from '@/components/shell/Shell';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

/**
 * Shown while Today is being built on the server.
 *
 * Streams immediately, so the shell, the navigation and the page frame paint
 * while the deadline queries are still in flight. Without it the browser sits
 * on the previous screen for the length of the round trip and the app feels
 * like it ignored the tap.
 *
 * The title is real. A skeleton heading would be a placeholder standing in for
 * a string that is already known, which is just a slower way to render it.
 *
 * In a `(today)` route group, and that grouping is load-bearing. A `loading.tsx`
 * wraps its whole directory, so at the root this one wrapped the legal pages
 * too -- and because it asks which skin to draw, that one cookie read opted
 * four deliberately static pages into being rendered on demand. The group puts
 * the boundary around Today and nothing else. The URL is unchanged: parenthesised
 * segments do not appear in the path.
 */
export default function Loading() {
  return (
    <Shell title="Today">
      <PageSkeleton rows={3} groups={2} />
    </Shell>
  );
}
