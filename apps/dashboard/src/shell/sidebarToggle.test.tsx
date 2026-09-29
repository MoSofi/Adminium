// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sidebar's switch: the rail beside a wide page (remembered), a drawer over
 * a narrow one (closed again by Esc, by navigating, and by the window growing),
 * and the topbar button that reports which of the two it is moving.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ThemeProvider, TooltipProvider } from '@adminium/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { ShortcutsProvider } from './ShortcutsProvider.js';
import {
  SIDEBAR_DRAWER_ID,
  SIDEBAR_ID,
  SIDEBAR_STORAGE_KEY,
  WIDE_QUERY,
  useSidebarToggle,
} from './sidebarToggle.js';
import { SidebarDrawer } from './SidebarDrawer.js';
import { Topbar } from './Topbar.js';

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useRouter: () => ({ history: { push: vi.fn() } }), useNavigate: () => vi.fn() };
});

/** A viewport whose width the test moves, and that tells its listeners. */
function installViewport(wide: boolean) {
  let matches = wide;
  const listeners = new Set<() => void>();
  window.matchMedia = ((query: string) =>
    ({
      get matches() {
        return query === WIDE_QUERY ? matches : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  return {
    resize(next: boolean) {
      matches = next;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}

/** The hook wired the way AppShell wires it, with a stand-in rail and button. */
function Shell({ location }: { location: string }) {
  const sidebar = useSidebarToggle(location);
  return (
    <>
      <button
        type="button"
        aria-expanded={sidebar.expanded}
        {...(sidebar.controls === null ? {} : { 'aria-controls': sidebar.controls })}
        onClick={sidebar.toggle}
      >
        Toggle sidebar
      </button>
      <aside id={SIDEBAR_ID} data-shown={String(sidebar.railOpen)} />
      <SidebarDrawer open={sidebar.drawerOpen} onOpenChange={sidebar.setDrawerOpen}>
        <nav id={SIDEBAR_DRAWER_ID} aria-label="Primary">
          <a href="#orders">Orders</a>
        </nav>
      </SidebarDrawer>
    </>
  );
}

const toggleButton = () => screen.getByRole('button', { name: 'Toggle sidebar' });
const rail = () => document.getElementById(SIDEBAR_ID) as HTMLElement;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('on a wide window', () => {
  it('hides and shows the rail beside the page, and remembers the choice', async () => {
    installViewport(true);
    const user = userEvent.setup();
    const { unmount } = render(<Shell location="/p/orders" />);
    expect(rail().dataset['shown']).toBe('true');
    expect(toggleButton().getAttribute('aria-expanded')).toBe('true');
    expect(toggleButton().getAttribute('aria-controls')).toBe(SIDEBAR_ID);

    await user.click(toggleButton());
    expect(rail().dataset['shown']).toBe('false');
    expect(toggleButton().getAttribute('aria-expanded')).toBe('false');
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('closed');
    expect(screen.queryByRole('dialog')).toBeNull();

    unmount();
    render(<Shell location="/p/orders" />);
    expect(rail().dataset['shown']).toBe('false');
    await user.click(toggleButton());
    expect(rail().dataset['shown']).toBe('true');
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull();
  });

  it('still switches when the browser refuses storage', async () => {
    installViewport(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(<Shell location="/p/orders" />);
    expect(rail().dataset['shown']).toBe('true');
    await user.click(toggleButton());
    expect(rail().dataset['shown']).toBe('false');
  });
});

describe('on a narrow window', () => {
  it('opens the rail as a drawer over the page, and Esc closes it', async () => {
    installViewport(false);
    const user = userEvent.setup();
    render(<Shell location="/p/orders" />);
    expect(toggleButton().getAttribute('aria-expanded')).toBe('false');
    // Nothing to point at while the drawer is closed.
    expect(toggleButton().hasAttribute('aria-controls')).toBe(false);

    await user.click(toggleButton());
    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    expect(drawer.contains(screen.getByRole('link', { name: 'Orders' }))).toBe(true);
    expect(drawer.getAttribute('data-side')).toBe('start');
    expect(drawer.hasAttribute('aria-describedby')).toBe(false);
    expect(document.getElementById(SIDEBAR_DRAWER_ID)).not.toBeNull();
    // The remembered wide-window choice is not what this button moves here.
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes the drawer once a link in it has been followed', async () => {
    installViewport(false);
    const user = userEvent.setup();
    const { rerender } = render(<Shell location="/p/orders" />);
    await user.click(toggleButton());
    expect(screen.getByRole('dialog')).not.toBeNull();
    rerender(<Shell location="/p/customers" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes the drawer when the window grows wide enough for the rail', async () => {
    const viewport = installViewport(false);
    const user = userEvent.setup();
    render(<Shell location="/p/orders" />);
    await user.click(toggleButton());
    expect(screen.getByRole('dialog')).not.toBeNull();
    viewport.resize(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toggleButton().getAttribute('aria-expanded')).toBe('true');
    expect(rail().dataset['shown']).toBe('true');
  });
});

describe('the topbar menu button', () => {
  function renderTopbar(props: { expanded: boolean; controls: string | null; onToggle: () => void }) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { data: { items: [], unreadCount: 0, nextCursor: null } })),
      ),
    );
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ThemeProvider>
          <TooltipProvider>
            <ShortcutsProvider>
              <Topbar
                bootstrap={makeBootstrap()}
                title="Customers"
                onOpenPalette={() => {}}
                onToggleSidebar={props.onToggle}
                sidebarExpanded={props.expanded}
                sidebarControls={props.controls}
                onSignOut={() => {}}
                onOpenAccount={() => {}}
                onOpenPreferences={() => {}}
                onOpenStudio={() => {}}
                onOpenStudioSettings={() => {}}
                onOpenHelp={() => {}}
                onOpenChangelog={() => {}}
              />
            </ShortcutsProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  }

  it('leads the bar, says whether the sidebar is open, and switches it', async () => {
    installViewport(true);
    const onToggle = vi.fn();
    const user = userEvent.setup();
    renderTopbar({ expanded: true, controls: SIDEBAR_ID, onToggle });
    const button = toggleButton();
    expect(button.getAttribute('data-part')).toBe('topbar-sidebar-toggle');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(SIDEBAR_ID);
    const header = document.querySelector('[data-part="topbar"]') as HTMLElement;
    expect(header.firstElementChild?.contains(button)).toBe(true);
    await user.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('names no controlled element while there is none', () => {
    installViewport(false);
    renderTopbar({ expanded: false, controls: null, onToggle: () => {} });
    expect(toggleButton().getAttribute('aria-expanded')).toBe('false');
    expect(toggleButton().hasAttribute('aria-controls')).toBe(false);
  });
});
