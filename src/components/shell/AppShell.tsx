import type { ReactNode } from 'react';
import Link from 'next/link';

import { SettingsIcon } from '@/components/icons';
import { PageEntrance } from '@/components/ui/Motion';
import { Footer } from './Footer';
import { Nav } from './Nav';
import { SidebarNav } from './SidebarNav';

export interface AppShellProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly reviewCount?: number;
  readonly headerAside?: ReactNode;
  readonly rail?: ReactNode;
  readonly children: ReactNode;
}

/** One content tree: CSS places it before first paint, without viewport JavaScript. */
export function AppShell({
  title, subtitle, reviewCount = 0, headerAside, rail, children,
}: AppShellProps) {
  return (
    <div className="workspace">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <aside className="workspace-sidebar"><SidebarNav reviewCount={reviewCount} /></aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <div className="workspace-heading">
            <h1>{title}</h1>
            {subtitle === undefined ? null : <p>{subtitle}</p>}
          </div>
          <div className="workspace-utilities">
            {headerAside}
            <Link href="/settings" aria-label="Settings" className="mobile-settings">
              <SettingsIcon />
            </Link>
          </div>
        </header>
        <main id="main-content" className="workspace-main">
          <div className={rail === undefined ? 'workspace-content' : 'workspace-layout'}>
            <PageEntrance>{children}</PageEntrance>
            {rail === undefined ? null : (
              <aside className="workspace-context" aria-label="Coursework context">{rail}</aside>
            )}
          </div>
        </main>
        <div className="workspace-footer"><Footer inShell /></div>
      </div>
      <div className="mobile-navigation"><Nav reviewCount={reviewCount} /></div>
    </div>
  );
}
