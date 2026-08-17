// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A minimal stand-in for the app shell's topbar, for tests that render ONE page
 * component rather than the whole router.
 *
 * Pages publish their heading and subtitle to the topbar through the
 * `PageActions` channel (shell/PageActionsProvider.tsx) instead of drawing a
 * second `<h1>` under the shell's own. That means a page rendered bare has no
 * heading at all — not a regression, but it does mean a test that asserts on
 * one has to provide the half of the shell that renders it. This is that half,
 * and no more: same channel, same three reads the real Topbar does.
 */
import type { ReactNode } from 'react';

import {
  PageActionsProvider,
  PageActionsSlot,
  usePageSubtitle,
  usePageTitle,
} from '../shell/PageActionsProvider.js';

function PublishedHeader() {
  const title = usePageTitle();
  const subtitle = usePageSubtitle();
  return (
    <header data-part="topbar">
      {title === null ? null : <h1>{title}</h1>}
      {subtitle === null ? null : <p data-part="topbar-subtitle">{subtitle}</p>}
      <PageActionsSlot />
    </header>
  );
}

export function ShellHarness({ children }: { children: ReactNode }) {
  return (
    <PageActionsProvider>
      <PublishedHeader />
      <main>{children}</main>
    </PageActionsProvider>
  );
}
