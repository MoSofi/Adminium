// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page → topbar channel. Pages had no way to put anything in the header
 * before it, so what these assert is the wiring itself: that a node published
 * from deep inside the routed outlet lands in the HEADER's DOM (not merely
 * somewhere on the page), that the subtitle reaches the header as a value, and
 * that both clear when the publishing page unmounts — the leak that would
 * otherwise show one page's controls on the next.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PageActions, PageActionsProvider, PageActionsSlot, usePageAssistant, usePageSubtitle } from './PageActionsProvider.js';

/** Stands in for the Topbar: the slot plus a subtitle read from the channel. */
function Header() {
  const subtitle = usePageSubtitle();
  return (
    <header data-part="topbar">
      <h1>Support tickets</h1>
      {subtitle === null ? null : <div data-part="topbar-subtitle">{subtitle}</div>}
      <PageActionsSlot />
    </header>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <PageActionsProvider>
      <Header />
      <main>{children}</main>
    </PageActionsProvider>
  );
}

describe('page actions channel', () => {
  it('renders a page-published node inside the header and a subtitle beside the title', async () => {
    render(
      <Shell>
        <PageActions subtitle="public.tickets">
          <button type="button">Export</button>
        </PageActions>
      </Shell>,
    );

    const exported = await screen.findByRole('button', { name: 'Export' });
    // The claim is placement, not existence — a node rendered where it sits
    // would pass a bare `findByRole`.
    expect(exported.closest('[data-part="topbar-page-actions"]')).not.toBeNull();
    expect(exported.closest('[data-part="topbar"]')).not.toBeNull();
    expect(screen.getByText('public.tickets').getAttribute('data-part')).toBe('topbar-subtitle');
  });

  it('clears both when the publishing page unmounts', async () => {
    function Case({ mounted }: { mounted: boolean }) {
      return (
        <Shell>
          {mounted ? (
            <PageActions subtitle="public.tickets">
              <button type="button">Export</button>
            </PageActions>
          ) : null}
        </Shell>
      );
    }
    const { rerender } = render(<Case mounted />);
    await screen.findByRole('button', { name: 'Export' });

    rerender(<Case mounted={false} />);

    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
    await waitFor(() => expect(screen.queryByText('public.tickets')).toBeNull());
  });

  it('is inert outside a provider, so a page renders standalone in tests', () => {
    render(
      <PageActions subtitle="public.tickets">
        <button type="button">Export</button>
      </PageActions>,
    );
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });
});

describe('what a page tells the assistant, through the same channel', () => {
  let headerRenders = 0;
  /** Stands in for the shell's Ask button: the one reader. */
  function Reader() {
    const page = usePageAssistant();
    return <output data-testid="page-assistant">{page === null ? 'none' : JSON.stringify(page)}</output>;
  }
  function CountedHeader() {
    headerRenders += 1;
    usePageSubtitle();
    return <header />;
  }
  function Frame({ children }: { children: ReactNode }) {
    return (
      <PageActionsProvider>
        <CountedHeader />
        <Reader />
        <main>{children}</main>
      </PageActionsProvider>
    );
  }
  const shown = () => screen.getByTestId('page-assistant').textContent;
  const base = { context: 'data', host: { connectionIds: ['c1'], pageId: 'page_1' } };

  it('publishes the page, folds in what it is showing, and clears both when the page goes', async () => {
    function Case({ step }: { step: 'none' | 'page' | 'view' | 'record' }) {
      return (
        <Frame>
          {step === 'none' ? null : <PageActions assistant={{ ...base, host: { ...base.host } }} />}
          {step === 'view' ? <PageActions assistantView={{ q: 'ada', order: 'name.asc', selectedIds: ['1', '2'] }} /> : null}
          {step === 'record' ? <PageActions assistantView={{ recordId: '7' }} /> : null}
        </Frame>
      );
    }
    const { rerender } = render(<Case step="none" />);
    expect(shown()).toBe('none');

    rerender(<Case step="page" />);
    await waitFor(() => expect(JSON.parse(shown()!)).toEqual({ ...base, shown: {} }));

    rerender(<Case step="view" />);
    await waitFor(() =>
      expect(JSON.parse(shown()!)).toEqual({ context: 'data', host: { ...base.host, view: { q: 'ada', order: 'name.asc', selectedIds: ['1', '2'] } }, shown: {} }),
    );

    // Another view replaces the first whole: a record page says nothing of ticked rows.
    rerender(<Case step="record" />);
    await waitFor(() => expect(JSON.parse(shown()!).host.view).toEqual({ recordId: '7' }));

    rerender(<Case step="none" />);
    await waitFor(() => expect(shown()).toBe('none'));
  });

  it('carries, for the person, what the frame calls the page and what its binding counts on it', async () => {
    function Case({ rows }: { rows: number | null }) {
      return (
        <Frame>
          <PageActions assistant={base} assistantShown={{ title: 'Customers' }} />
          <PageActions assistantView={{ q: 'ada' }} assistantShown={{ rows }} />
        </Frame>
      );
    }
    const { rerender } = render(<Case rows={null} />);
    await waitFor(() => expect(JSON.parse(shown()!).shown).toEqual({ title: 'Customers', rows: null }));
    rerender(<Case rows={214} />);
    await waitFor(() => expect(JSON.parse(shown()!).shown).toEqual({ title: 'Customers', rows: 214 }));
    // None of it is in what is sent to the server.
    expect(JSON.stringify(JSON.parse(shown()!).host)).not.toContain('214');
  });

  it('a view with no page is nothing: only a page that said what it is has an assistant', async () => {
    render(
      <Frame>
        <PageActions assistantView={{ q: 'ada' }} />
      </Frame>,
    );
    await act(async () => undefined);
    expect(shown()).toBe('none');
  });

  it('does not re-render the header when a grid changes what it shows', async () => {
    function Case({ q }: { q: string }) {
      return (
        <Frame>
          <PageActions assistant={base} assistantView={{ q }} />
        </Frame>
      );
    }
    const { rerender } = render(<Case q="a" />);
    await waitFor(() => expect(shown()).toContain('"q":"a"'));
    const before = headerRenders;
    // The page renders again with an equal object: nothing is published at all.
    rerender(<Case q="a" />);
    // A different search: the reader follows, the header does not render for it.
    rerender(<Case q="ab" />);
    await waitFor(() => expect(shown()).toContain('"q":"ab"'));
    // The frame itself re-rendered twice above (rerender), and that is all the header saw.
    expect(headerRenders - before).toBeLessThanOrEqual(2);
  });

  it('reads as nothing outside a provider', () => {
    render(<Reader />);
    expect(shown()).toBe('none');
  });
});
