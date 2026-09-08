import { Shell } from '@/components/shell/Shell';
import { PageSkeleton } from '@/components/ui/PageSkeleton';

/** Placeholder shaped like the day's class list, so nothing shifts when it lands. */
export default function Loading() {
  return (
    <Shell title="Timetable">
      <PageSkeleton rows={4} groups={1} />
    </Shell>
  );
}
