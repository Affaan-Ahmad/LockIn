import { AppShell } from '@/components/shell/AppShell';
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
 */
export default function Loading() {
  return (
    <AppShell title="Today">
      <PageSkeleton rows={3} groups={2} />
    </AppShell>
  );
}
