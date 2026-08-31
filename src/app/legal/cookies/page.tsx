import { LegalTitle, List, PRIVACY_CONTACT, Section } from '../content';

/**
 * The cookie policy, which is short because the cookie list is short.
 *
 * LockIn sets no analytics, advertising or tracking cookies, so there is no
 * consent banner. Adding one anyway would be theatre: asking permission for
 * something that needs none trains people to click through the dialogs that do
 * matter. If a non-essential cookie is ever added, the banner arrives with it.
 */
export const metadata = {
  title: 'Cookie policy · LockIn',
  description: 'The cookies LockIn sets, which are only the ones that keep you signed in.',
};

export default function CookiesPage() {
  return (
    <article>
      <LegalTitle>Cookie policy</LegalTitle>

      <Section heading="The short version">
        <p>
          LockIn sets cookies for one purpose: keeping you signed in. There are no analytics
          cookies, no advertising cookies and no third-party trackers, which is why you are not
          being asked to accept anything.
        </p>
      </Section>

      <Section heading="What is actually set">
        <List
          items={[
            'Authentication cookies issued by Supabase, which hold your session so the server can confirm on each request that it is really you.',
          ]}
        />
        <p>
          These are strictly necessary. Blocking them does not degrade LockIn, it signs you out:
          there is no version of the product that works without knowing whose coursework to show.
        </p>
      </Section>

      <Section heading="Storage on your device">
        <p>
          One preference is kept in your browser&rsquo;s local storage rather than in a cookie: your
          choice of light or dark theme. It never leaves your device and is never sent to the
          server.
        </p>
      </Section>

      <Section heading="Turning them off">
        <p>
          Your browser can block or clear cookies for this site at any time. Doing so signs you out.
          It does not delete your data, which is removed by deleting your account in Settings.
        </p>
        <p>Questions go to {PRIVACY_CONTACT}.</p>
      </Section>
    </article>
  );
}
