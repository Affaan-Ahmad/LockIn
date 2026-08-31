import type { ReactNode } from 'react';

/**
 * Shared furniture for the legal pages.
 *
 * The facts that vary live here as named constants rather than scattered
 * through four documents, so changing one is a single edit.
 *
 * All of them are now filled in. What is still outstanding is not a value but a
 * review: nobody qualified has read these documents, and LEGAL_STATUS says so
 * on every page until somebody has.
 */

/**
 * Who is responsible for the data.
 *
 * A named individual, not a company. Saying so plainly is more honest than
 * implying an organisation that does not exist, and it is what a reader needs
 * in order to know who they are actually dealing with.
 */
export const CONTROLLER = 'Affaan Ahmad';

/**
 * A role address on the project's own domain, not the operator's personal one.
 *
 * Both names point at the same mailbox today. LockIn is run by one person, and
 * advertising a `security@` nobody reads is worse than not advertising one: it
 * publishes a promise to receive reports and then breaks it, and a researcher
 * who gets silence tends to publish instead.
 *
 * They stay as two constants rather than one so splitting them later is a
 * one-line change here rather than an edit to four documents.
 */
export const PRIVACY_CONTACT = 'contact@lockinapp.tech';
export const SECURITY_CONTACT = 'contact@lockinapp.tech';

export const JURISDICTION = 'Pakistan';

/** Bumped whenever a document changes materially. */
export const LAST_UPDATED = '31 August 2026';

/**
 * The honest status of these documents.
 *
 * Not boilerplate humility. They were drafted from the schema, the OAuth scope
 * list and the code, so they describe what LockIn actually does; they have not
 * been reviewed by anyone qualified to say whether they satisfy Pakistani law,
 * and nobody should be told otherwise.
 */
export const LEGAL_STATUS =
  'Draft. These documents describe what LockIn actually does, written from its own source code and database schema. They have not been reviewed by a lawyer and should not be relied on as legal advice or treated as a statement of compliance.';

export const LEGAL_PAGES = [
  { href: '/legal/terms', shortTitle: 'Terms', title: 'Terms and Conditions' },
  { href: '/legal/privacy', shortTitle: 'Privacy', title: 'Privacy policy' },
  { href: '/legal/cookies', shortTitle: 'Cookies', title: 'Cookie policy' },
  { href: '/legal/disclaimer', shortTitle: 'Disclaimer', title: 'Disclaimer' },
] as const;

export function LegalTitle({ children }: { readonly children: string }) {
  return (
    <>
      <h1 className="text-2xl font-semibold text-balance text-ink">{children}</h1>
      <p className="mt-2 text-sm text-ink-muted">Last updated {LAST_UPDATED}</p>
    </>
  );
}

export function Section({
  heading,
  children,
}: {
  readonly heading: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-ink">{heading}</h2>
      <div className="measure mt-2 flex flex-col gap-3 text-base text-ink-soft">{children}</div>
    </section>
  );
}

export function List({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="measure flex list-disc flex-col gap-2 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
