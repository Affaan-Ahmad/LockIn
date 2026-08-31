'use client';

import { AlertIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';

/**
 * What a student sees when a screen fails to render.
 *
 * Says what is and is not true rather than apologising. "Your data is safe" is
 * the thing they actually want to know, and it is accurate: every screen here
 * only reads, so a failed render cannot have lost anything.
 *
 * The error object is never printed. A server error message can carry a table
 * name, a constraint or part of a query, and the browser is the one place none
 * of that belongs.
 *
 * Nothing is logged from here either. Next has already logged the real error
 * server-side against this same digest, so a console call in the browser would
 * add a second, less useful copy of an error the operator can already read.
 * The digest is shown instead, which is what makes a support report traceable.
 */
export default function Error({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[30rem] flex-col justify-center px-5 py-12">
      <span className="surface-sunken flex size-14 items-center justify-center rounded-pill text-danger">
        <AlertIcon className="size-6" />
      </span>
      <h1 className="mt-5 text-[1.5rem] leading-tight font-bold text-ink">
        This screen didn&rsquo;t load
      </h1>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-soft">
        Nothing was changed and nothing was lost. Your coursework and your decisions are stored on
        the server, not in this page.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <a href="/">
          <Button variant="ghost">Go to Today</Button>
        </a>
      </div>
      {error.digest === undefined ? null : (
        <p className="mt-6 text-[0.75rem] text-ink-muted">
          Reference <span className="font-mono">{error.digest}</span>
        </p>
      )}
    </main>
  );
}
