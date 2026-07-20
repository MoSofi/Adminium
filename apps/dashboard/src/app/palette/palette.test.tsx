/**
 * ⌘K palette (09-generated-app.md §5.2, M4-T06): fixed group order Actions →
 * Navigate → Recent → Records, client-side nav filtering, the DEBOUNCED async
 * Records group from `GET /api/v1/search` (loading row while in flight,
 * honest empty state after), Recent from localStorage (per-user key, dedup,
 * cap 8), keyboard navigation into a record route, query echoed in the empty
 * state, Ask AI hidden while `llm.enabled` is false, and selection dispatch.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@adminium/ui';

import { makeBootstrap } from '../../test/fixtures.js';
import { search, type SearchRecordHit } from '../../api/search.js';
import { CommandPaletteHost, SEARCH_DEBOUNCE_MS } from './CommandPaletteHost.js';
import { pushRecent, readRecent, recentStorageKey, RECENT_MAX } from './recent.js';

vi.mock('../../api/search.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/search.js')>();
  return { ...actual, search: vi.fn() };
});
const searchMock = vi.mocked(search);

const USER_ID = 'usr_test'; // makeBootstrap's user

function alfkiHit(): SearchRecordHit {
  return {
    connectionId: 'conn_1',
    table: 'public.customers',
    recordId: 'ALFKI',
    label: 'Alfreds Futterkiste',
    context: 'city Berlin · country Germany',
    pageSlug: 'customers',
  };
}

function recordGroups(hits: SearchRecordHit[]) {
  return [
    {
      type: 'record' as const,
      connectionId: 'conn_1',
      table: 'public.customers',
      pageSlug: 'customers',
      count: hits.length,
      hits,
    },
  ];
}

function renderPalette(overrides: Partial<Parameters<typeof CommandPaletteHost>[0]> = {}) {
  const onNavigate = vi.fn();
  const onNavigateRecord = vi.fn();
  const onSignOut = vi.fn();
  const onShowShortcuts = vi.fn();
  render(
    <ThemeProvider>
      <CommandPaletteHost
        open
        onOpenChange={() => undefined}
        bootstrap={makeBootstrap()}
        onNavigate={onNavigate}
        onNavigateRecord={onNavigateRecord}
        onSignOut={onSignOut}
        onShowShortcuts={onShowShortcuts}
        {...overrides}
      />
    </ThemeProvider>,
  );
  return { onNavigate, onNavigateRecord, onSignOut, onShowShortcuts };
}

beforeEach(() => {
  window.localStorage.clear();
  searchMock.mockReset();
  searchMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CommandPaletteHost', () => {
  it('renders Actions then Navigate with nav-tree entries and chord hints', () => {
    renderPalette();
    const groups = screen.getAllByRole('group').map((el) => el.getAttribute('aria-label'));
    expect(groups).toEqual(['Actions', 'Navigate']);
    expect(screen.getByRole('option', { name: /Customers/ })).toBeDefined();
    // First nav item gets the `G C` chord hint.
    expect(screen.getByText('G C')).toBeDefined();
  });

  it('filters client-side and echoes the query in the empty state', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'orders');
    expect(screen.getByRole('option', { name: /Orders/ })).toBeDefined();
    expect(screen.queryByRole('option', { name: /Sign out/ })).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, 'zzz-nothing');
    // The Searching row shows while the (mocked, empty) search is in flight;
    // once it settles with zero hits the honest empty state takes over.
    await waitFor(() => {
      expect(screen.getByText(/No results for "zzz-nothing"/)).toBeDefined();
    });
  });

  it('dispatches navigation and actions on selection', async () => {
    const { onNavigate, onSignOut } = renderPalette();
    await userEvent.click(screen.getByRole('option', { name: /Customers/ }));
    expect(onNavigate).toHaveBeenCalledWith('customers');
    await userEvent.click(screen.getByRole('option', { name: /Sign out/ }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('debounces the records search into one trailing call', () => {
    vi.useFakeTimers();
    renderPalette();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'al' } });
    fireEvent.change(input, { target: { value: 'alf' } });

    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(searchMock).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(searchMock).toHaveBeenCalledTimes(1);
    // 08 §2.9: the palette asks for records only, capped at 3 per group.
    expect(searchMock).toHaveBeenCalledWith('alf', { limit: 3, types: ['record'] });
  });

  it('shows a loading row, then the Records group; Enter opens the record route', async () => {
    searchMock.mockReturnValue(
      new Promise((resolve) => setTimeout(() => resolve(recordGroups([alfkiHit()])), 10)),
    );
    const { onNavigateRecord } = renderPalette();
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'alf');

    // In flight (debounce + deferred resolve): honest loading row, disabled.
    expect(screen.getByText('Searching records…')).toBeDefined();

    const option = await screen.findByRole('option', { name: /Alfreds Futterkiste/ });
    expect(option).toBeDefined();
    expect(screen.getByRole('group', { name: 'Records' })).toBeDefined();
    // §2.9 "record hits show row context" — the muted subtitle line.
    expect(screen.getByText('city Berlin · country Germany')).toBeDefined();
    expect(screen.queryByText('Searching records…')).toBeNull();

    // 'alf' filtered every static item out, so the record hit is the active
    // option — Enter navigates into /p/customers/r/ALFKI.
    await userEvent.keyboard('{Enter}');
    expect(onNavigateRecord).toHaveBeenCalledWith('customers', 'ALFKI');
    // The visit lands in the per-user Recent list.
    expect(readRecent(USER_ID)).toEqual([
      { type: 'record', label: 'Alfreds Futterkiste', href: '/p/customers/r/ALFKI' },
    ]);
  });

  it('renders the Recent group from localStorage and navigates its entries', async () => {
    window.localStorage.setItem(
      recentStorageKey(USER_ID),
      JSON.stringify([
        { type: 'record', label: 'Customers · ALFKI', href: '/p/customers/r/ALFKI' },
        { type: 'page', label: 'Orders', href: '/p/orders' },
      ]),
    );
    const { onNavigate, onNavigateRecord } = renderPalette();

    const groups = screen.getAllByRole('group').map((el) => el.getAttribute('aria-label'));
    expect(groups).toEqual(['Actions', 'Navigate', 'Recent']);

    await userEvent.click(screen.getByRole('option', { name: /Customers · ALFKI/ }));
    expect(onNavigateRecord).toHaveBeenCalledWith('customers', 'ALFKI');

    await userEvent.click(screen.getByRole('option', { name: /^Orders$/ }));
    expect(onNavigate).toHaveBeenCalledWith('orders');
  });

  it('hides the Ask AI footer while llm.enabled is false', () => {
    renderPalette();
    expect(screen.queryByText('Ask AI')).toBeNull();
  });

  it('shows the Ask AI footer when llm.enabled', () => {
    renderPalette({ bootstrap: makeBootstrap({ llm: { enabled: true } }) });
    expect(screen.getByText('Ask AI')).toBeDefined();
  });
});

describe('recent.ts (09 §5.2 localStorage shape)', () => {
  it('dedupes by href (move to front) and caps at 8 entries', () => {
    for (let i = 0; i < 10; i += 1) {
      pushRecent(USER_ID, { type: 'page', label: `Page ${i}`, href: `/p/page-${i}` });
    }
    let entries = readRecent(USER_ID);
    expect(entries).toHaveLength(RECENT_MAX);
    expect(entries[0]?.href).toBe('/p/page-9');

    // Re-visiting an existing href moves it to the front without growing.
    pushRecent(USER_ID, { type: 'page', label: 'Page 5', href: '/p/page-5' });
    entries = readRecent(USER_ID);
    expect(entries).toHaveLength(RECENT_MAX);
    expect(entries[0]?.href).toBe('/p/page-5');
  });

  it('is per-user and drops malformed stored payloads', () => {
    pushRecent('usr_a', { type: 'table', label: 'Orders', href: '/p/orders' });
    expect(readRecent('usr_b')).toEqual([]);

    window.localStorage.setItem(recentStorageKey('usr_c'), '{"not":"an array"}');
    expect(readRecent('usr_c')).toEqual([]);
    window.localStorage.setItem(
      recentStorageKey('usr_d'),
      JSON.stringify([{ type: 'bogus', label: 'x', href: '/x' }, { type: 'page', label: 'Ok', href: '/p/ok' }]),
    );
    expect(readRecent('usr_d')).toEqual([{ type: 'page', label: 'Ok', href: '/p/ok' }]);
  });
});
