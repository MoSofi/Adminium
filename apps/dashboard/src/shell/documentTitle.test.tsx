// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The browser tab's name. Every screen used to render a tab reading
 * "Adminium", so a strip of open tabs said nothing about which page each one
 * was — these assert the composition that fixes it, and the two orderings that
 * made the naive version (an effect per screen writing `document.title`) wrong.
 */
import { render, waitFor } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PageActions,
  PageActionsProvider,
  usePageDocumentTitle,
  usePageTitle,
} from './PageActionsProvider.js';
import {
  setDocumentAppName,
  setDocumentPageTitle,
  useDocumentPageTitle,
} from './documentTitle.js';

/** The half of the Topbar that names the tab, plus its path-derived fallback. */
function Topbar({ derived }: { derived: string }) {
  const published = usePageTitle();
  const publishedDocumentTitle = usePageDocumentTitle();
  useDocumentPageTitle(publishedDocumentTitle ?? published ?? derived);
  return <h1>{published ?? derived}</h1>;
}

function Shell({ derived = 'Home', children }: { derived?: string; children?: ReactNode }) {
  return (
    <PageActionsProvider>
      <Topbar derived={derived} />
      <main>{children}</main>
    </PageActionsProvider>
  );
}

afterEach(() => {
  setDocumentPageTitle(null);
  setDocumentAppName('Adminium');
});

describe('the browser tab', () => {
  it('names the page ahead of the workspace', async () => {
    render(
      <Shell>
        <PageActions title="Audit log" />
      </Shell>,
    );
    await waitFor(() => expect(document.title).toBe('Audit log · Adminium'));
  });

  it('falls back to the shell-derived name, and to the workspace alone with no page', async () => {
    const { unmount } = render(<Shell derived="Home" />);
    await waitFor(() => expect(document.title).toBe('Home · Adminium'));
    unmount();
    expect(document.title).toBe('Adminium');
  });

  it('lets a screen name the tab differently from its heading', async () => {
    render(
      <Shell>
        {/* The record page: h1 is the record, the tab needs the page too. */}
        <PageActions title="Northwind" documentTitle="Northwind · Customers" />
      </Shell>,
    );
    await waitFor(() => expect(document.title).toBe('Northwind · Customers · Adminium'));
  });

  it('follows a rebrand without losing the page', async () => {
    render(
      <Shell>
        <PageActions title="Audit log" />
      </Shell>,
    );
    await waitFor(() => expect(document.title).toBe('Audit log · Adminium'));
    setDocumentAppName('Northwind Ops');
    expect(document.title).toBe('Audit log · Northwind Ops');
  });

  /*
   * The ordering that a per-screen `document.title = …` effect gets wrong.
   * React runs child effects before parent ones, so on a cold load the screen
   * names the tab and the root — where branding lives, above the whole router
   * — immediately overwrites it with the bare workspace name. Composing in one
   * module instead of in a component is what makes that unrepresentable.
   */
  it('survives branding resolving after the page has already named itself', async () => {
    // Exactly `useBrandedDocumentTitle`'s shape, in exactly its position: an
    // effect in a component wrapping the router, so React runs it AFTER the
    // page's.
    function Root({ children }: { children: ReactNode }) {
      useEffect(() => setDocumentAppName('Northwind Ops'), []);
      return <>{children}</>;
    }
    render(
      <Root>
        <Shell>
          <PageActions title="Audit log" />
        </Shell>
      </Root>,
    );
    await waitFor(() => expect(document.title).toBe('Audit log · Northwind Ops'));
  });

  it('gives the name back when the screen unmounts, without clobbering the next one', async () => {
    function Routes() {
      const [onAudit, setOnAudit] = useState(true);
      return (
        <Shell>
          <button type="button" onClick={() => setOnAudit(false)}>
            go
          </button>
          {onAudit ? <PageActions title="Audit log" /> : <PageActions title="Files" />}
        </Shell>
      );
    }
    const { getByText } = render(<Routes />);
    await waitFor(() => expect(document.title).toBe('Audit log · Adminium'));
    getByText('go').click();
    await waitFor(() => expect(document.title).toBe('Files · Adminium'));
  });
});
