/**
 * The page → topbar channel. Pages had no way to put anything in the header
 * before it, so what these assert is the wiring itself: that a node published
 * from deep inside the routed outlet lands in the HEADER's DOM (not merely
 * somewhere on the page), that the subtitle reaches the header as a value, and
 * that both clear when the publishing page unmounts — the leak that would
 * otherwise show one page's controls on the next.
 */
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { PageActions, PageActionsProvider, PageActionsSlot, usePageSubtitle } from './PageActionsProvider.js';

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
