import { AppShell } from '@/components/shell/AppShell';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

/** Placeholder shaped like the real list, so nothing shifts when data lands. */
export default function Loading() {
  return (
    <AppShell title="Upcoming">
      <PageSkeleton rows={3} groups={2} />
    </AppShell>
  );
}
