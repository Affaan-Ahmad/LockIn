import { AppShell } from '@/components/shell/AppShell';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

/** Placeholder shaped like the real list, so nothing shifts when data lands. */
export default function Loading() {
  return (
    <AppShell title="Courses">
      <PageSkeleton rows={5} groups={1} />
    </AppShell>
  );
}
