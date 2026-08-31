import Link from 'next/link';

import { Button } from '@/components/ui/Button';

/**
 * An address that does not exist.
 *
 * Deliberately plain, and deliberately not styled as an error. A student who
 * mistypes a URL has not done anything wrong, and a page that treats a wrong
 * address like a failure teaches them to distrust the ones that work.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[30rem] flex-col justify-center px-5 py-12">
      <h1 className="text-[1.5rem] leading-tight font-bold text-ink">There is nothing here</h1>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-soft">
        That address does not match any screen in LockIn.
      </p>
      <div className="mt-6">
        <Link href="/">
          <Button variant="primary">Go to Today</Button>
        </Link>
      </div>
    </main>
  );
}
