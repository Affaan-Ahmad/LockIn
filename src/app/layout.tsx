import type { ReactNode } from 'react';

/**
 * Minimal root layout.
 *
 * Next.js requires one for the app to build. There is deliberately no styling,
 * no component library and no design here: the frontend is a later milestone,
 * and building UI now would be work thrown away once the real design exists.
 */

export const metadata = {
  title: 'Assignment Scrapper',
  description: 'Personalised academic deadline layer over Google Classroom',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
