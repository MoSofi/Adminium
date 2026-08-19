// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * TRACK FCS — `chrome` family unit tests (annex §11).
 *
 * The QA harness (qa/*) already proves the generic contracts for every
 * delivered widget (four states, config fuzz, determinism, chunk budget). These
 * cover what is SPECIFIC to this family:
 *   · grouping/ordering that must never silently DROP a payload group
 *   · breadcrumb collapse keeping head + tail
 *   · diacritic-insensitive filtering and highlight spans over NFD-expanding text
 *   · href safety (a `javascript:` URL out of the database must not render)
 *   · modified-click passthrough (⌘-click must stay a real browser navigation)
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvatarStackWidget, peopleOf } from './AvatarStackWidget.js';
import { BreadcrumbWidget, crumbsOf } from './Breadcrumb.js';
import { commandEntriesOf, groupEntries } from './CommandPaletteWidget.js';
import { GlobalSearchWidget, facetCounts, filterResults, searchResultsOf } from './GlobalSearch.js';
import { NavCardWidget, navCardsOf } from './NavCard.js';
import { ShortcutsPanelWidget, displayKey } from './ShortcutsPanel.js';
import { SidebarNavWidget, navGroupsOf } from './SidebarNav.js';
import { TabBarWidget, tabsOf } from './TabBar.js';
import { collapseTrail, fold, highlightParts, isSafeHref, matches } from './chrome-lib.js';
import {
  avatarStackConfigSchema,
  breadcrumbConfigSchema,
  commandPaletteConfigSchema,
  globalSearchConfigSchema,
  navCardConfigSchema,
  shortcutsPanelConfigSchema,
  sidebarNavConfigSchema,
  tabBarConfigSchema,
} from './chrome-config.js';

afterEach(cleanup);

function cfg<T>(schema: { parse: (value: unknown) => T }, overrides: Record<string, unknown> = {}): T {
  return schema.parse(overrides);
}

const noop = () => {};

// ── href safety ────────────────────────────────────────────────────────────

describe('isSafeHref — hrefs come from the DATABASE, so they are untrusted', () => {
  it('allows relative paths, fragments and queries', () => {
    expect(isSafeHref('/orders')).toBe(true);
    expect(isSafeHref('#section')).toBe(true);
    expect(isSafeHref('?tab=open')).toBe(true);
  });

  it('allows explicit http(s) URLs', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://example.com')).toBe(true);
  });

  it('rejects script-bearing schemes', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('JaVaScRiPt:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHref('vbscript:msgbox')).toBe(false);
  });

  it('rejects empty/absent', () => {
    expect(isSafeHref(undefined)).toBe(false);
    expect(isSafeHref('   ')).toBe(false);
  });

  it('a nav row carrying a javascript: href renders no link target', () => {
    const groups = navGroupsOf(
      { rows: [{ group: 'g', label: 'Evil', href: 'javascript:alert(1)' }], total: 1 },
      cfg(sidebarNavConfigSchema),
    );
    expect(groups[0]?.items[0]?.href).toBeUndefined();
  });

  it('a search row carrying a javascript: href renders no link target', () => {
    const results = searchResultsOf(
      { rows: [{ label: 'Evil', href: 'javascript:alert(1)' }], total: 1 },
      cfg(globalSearchConfigSchema),
    );
    expect(results[0]?.href).toBeUndefined();
  });
});

// ── sidebar-nav ────────────────────────────────────────────────────────────

describe('navGroupsOf (annex §11)', () => {
  const rows = [
    { group: 'library', label: 'Products', href: '/products' },
    { group: 'workspace', label: 'Orders', href: '/orders', badge: 12 },
    { group: 'workspace', label: 'Customers', href: '/customers' },
  ];

  it('orders groups per config', () => {
    const groups = navGroupsOf(
      { rows, total: 3 },
      cfg(sidebarNavConfigSchema, { groups: [{ key: 'workspace', label: 'Workspace' }, { key: 'library', label: 'Library' }] }),
    );
    expect(groups.map((g) => g.key)).toEqual(['workspace', 'library']);
    expect(groups[0]?.label).toBe('Workspace');
  });

  it('renders a payload group the config order OMITS rather than dropping it', () => {
    // A newly-included table must never vanish from the nav just because
    // nobody updated the group list.
    const groups = navGroupsOf({ rows, total: 3 }, cfg(sidebarNavConfigSchema, { groups: [{ key: 'workspace' }] }));
    expect(groups.map((g) => g.key)).toEqual(['workspace', 'library']);
  });

  it('skips rows with no label (nothing to render)', () => {
    const groups = navGroupsOf({ rows: [{ group: 'g', href: '/x' }], total: 1 }, cfg(sidebarNavConfigSchema));
    expect(groups).toHaveLength(0);
  });
});

describe('SidebarNavWidget', () => {
  const data = { rows: [{ group: 'workspace', label: 'Orders', href: '/orders', badge: 12 }], total: 1 };

  it('marks the active item with aria-current, not just a colour', () => {
    render(
      <SidebarNavWidget
        config={cfg(sidebarNavConfigSchema, { activeHref: '/orders' })}
        instanceId="t"
        onEvent={noop}
        data={data}
      />,
    );
    expect(screen.getByRole('link', { name: /Orders/ }).getAttribute('aria-current')).toBe('page');
  });

  it('routes a plain primary click through onEvent', () => {
    const onEvent = vi.fn();
    render(<SidebarNavWidget config={cfg(sidebarNavConfigSchema)} instanceId="t" onEvent={onEvent} data={data} />);
    fireEvent.click(screen.getByRole('link', { name: /Orders/ }), { button: 0 });
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/orders' });
  });

  it('leaves a ⌘-click to the browser — "open in new tab" must keep working', () => {
    const onEvent = vi.fn();
    render(<SidebarNavWidget config={cfg(sidebarNavConfigSchema)} instanceId="t" onEvent={onEvent} data={data} />);
    fireEvent.click(screen.getByRole('link', { name: /Orders/ }), { button: 0, metaKey: true });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('renders its empty copy with no rows', () => {
    render(
      <SidebarNavWidget
        config={cfg(sidebarNavConfigSchema, { emptyTitle: 'No nav yet' })}
        instanceId="t"
        onEvent={noop}
        data={{ rows: [], total: 0 }}
      />,
    );
    expect(screen.getByText('No nav yet')).toBeTruthy();
  });
});

// ── breadcrumb ─────────────────────────────────────────────────────────────

describe('collapseTrail (annex §11 maxDepth)', () => {
  const trail = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('leaves a short trail untouched', () => {
    expect(collapseTrail(['a', 'b'], 6)).toEqual(['a', 'b']);
  });

  it('does not collapse at exactly maxDepth', () => {
    expect(collapseTrail(trail, 6)).toEqual(trail);
  });

  it('always keeps the head (how you escape) and the tail (where you are)', () => {
    const out = collapseTrail(trail, 4);
    expect(out[0]).toBe('a');
    expect(out[1]).toBeNull();
    expect(out[out.length - 1]).toBe('f');
  });

  it('never returns more entries than maxDepth', () => {
    expect(collapseTrail(trail, 4)).toHaveLength(4);
    expect(collapseTrail(trail, 3)).toHaveLength(3);
  });
});

describe('BreadcrumbWidget', () => {
  it('renders the trail and routes clicks through onEvent', () => {
    const onEvent = vi.fn();
    render(
      <BreadcrumbWidget
        config={cfg(breadcrumbConfigSchema)}
        instanceId="t"
        onEvent={onEvent}
        data={{ rows: [{ name: 'Files', href: '/files' }, { name: 'Photos', href: '/files/photos' }], total: 2 }}
      />,
    );
    fireEvent.click(screen.getByText('Files'));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/files' });
  });

  it('renders the collapsed middle as a non-interactive ellipsis', () => {
    render(
      <BreadcrumbWidget
        config={cfg(breadcrumbConfigSchema, { maxDepth: 3 })}
        instanceId="t"
        onEvent={noop}
        data={{ rows: [1, 2, 3, 4, 5].map((n) => ({ name: `L${n}`, href: `/l${n}` })), total: 5 }}
      />,
    );
    const ellipsis = screen.getByText('…');
    expect(ellipsis.closest('a')).toBeNull();
  });

  it('renders nothing for an empty trail', () => {
    const { container } = render(
      <BreadcrumbWidget config={cfg(breadcrumbConfigSchema)} instanceId="t" onEvent={noop} data={{ rows: [], total: 0 }} />,
    );
    expect(container.querySelector('[data-widget="breadcrumb"]')).toBeNull();
  });

  it('projects rows, skipping label-less ones', () => {
    expect(crumbsOf({ rows: [{ name: 'A' }, { href: '/b' }], total: 2 }, cfg(breadcrumbConfigSchema))).toHaveLength(1);
  });
});

// ── command-palette ────────────────────────────────────────────────────────

describe('groupEntries (annex §11 fixed group order)', () => {
  const entries = commandEntriesOf(
    {
      rows: [
        { id: '1', group: 'recent', label: 'R' },
        { id: '2', group: 'actions', label: 'A' },
        { id: '3', group: 'navigate', label: 'N' },
        { id: '4', group: 'metrics', label: 'M' },
      ],
      total: 4,
    },
    cfg(commandPaletteConfigSchema),
  );

  it('renders in the configured order', () => {
    const groups = groupEntries(entries, ['actions', 'navigate', 'recent'], 6);
    expect(groups.map((g) => g.key)).toEqual(['actions', 'navigate', 'recent', 'metrics']);
  });

  it('appends groups the order omits rather than dropping them', () => {
    const groups = groupEntries(entries, ['actions'], 6);
    expect(groups.map((g) => g.key)).toContain('metrics');
  });

  it('drops empty groups', () => {
    const groups = groupEntries(entries, ['actions', 'people'], 6);
    expect(groups.map((g) => g.key)).not.toContain('people');
  });

  it('caps each group at maxPerGroup', () => {
    const many = commandEntriesOf(
      { rows: Array.from({ length: 10 }, (_, n) => ({ id: `x${n}`, group: 'actions', label: `A${n}` })), total: 10 },
      cfg(commandPaletteConfigSchema),
    );
    expect(groupEntries(many, ['actions'], 3)[0]?.entries).toHaveLength(3);
  });

  it('defaults an unrecognised group to navigate rather than dropping the entry', () => {
    const odd = commandEntriesOf({ rows: [{ id: '1', group: 'wat', label: 'X' }], total: 1 }, cfg(commandPaletteConfigSchema));
    expect(odd[0]?.group).toBe('navigate');
  });
});

// ── global-search ──────────────────────────────────────────────────────────

describe('search filtering (annex §11)', () => {
  const results = searchResultsOf(
    {
      rows: [
        { id: '1', type: 'record', label: 'Order #10248', snippet: 'Shipped to Chevalier' },
        { id: '2', type: 'people', label: 'José Álvarez', snippet: 'Owner' },
        { id: '3', type: 'record', label: 'Order #10249', snippet: 'Delivered' },
      ],
      total: 3,
    },
    cfg(globalSearchConfigSchema),
  );

  it('matches on the label', () => {
    expect(filterResults(results, '10248', null)).toHaveLength(1);
  });

  it('matches on the snippet, not just the label', () => {
    expect(filterResults(results, 'shipped', null).map((r) => r.id)).toEqual(['1']);
  });

  it('is diacritic-insensitive — "jose" finds "José"', () => {
    expect(filterResults(results, 'jose', null).map((r) => r.id)).toEqual(['2']);
  });

  it('is case-insensitive', () => {
    expect(filterResults(results, 'ORDER', null)).toHaveLength(2);
  });

  it('an empty query matches everything', () => {
    expect(filterResults(results, '', null)).toHaveLength(3);
  });

  it('the type facet narrows the set', () => {
    expect(filterResults(results, '', 'people')).toHaveLength(1);
  });

  it('facet counts respect the query but ignore the type facet itself', () => {
    const counts = facetCounts(results, 'order');
    expect(counts.get('record')).toBe(2);
    expect(counts.get('people')).toBeUndefined();
  });
});

describe('fold / highlightParts', () => {
  it('folds case and diacritics', () => {
    expect(fold('José')).toBe('jose');
    expect(matches('Ünïcodé', 'unicode')).toBe(true);
  });

  it('returns null when there is no match', () => {
    expect(highlightParts('Orders', 'zzz')).toBeNull();
    expect(highlightParts('Orders', '')).toBeNull();
  });

  it('splits on the match span', () => {
    expect(highlightParts('Order #10248', '10248')).toEqual({ before: 'Order #', match: '10248', after: '' });
  });

  it('is case-insensitive but preserves the ORIGINAL casing in the parts', () => {
    expect(highlightParts('Orders', 'ORD')).toEqual({ before: '', match: 'Ord', after: 'ers' });
  });

  it('keeps the span aligned on text whose NFD form EXPANDS (é → e + combining acute)', () => {
    // Folding "José" gives "jose" (4 chars) from 4 code points, but the NFD
    // intermediate is 5 — slicing a folded index into the original would drift.
    const parts = highlightParts('José Álvarez', 'alvarez');
    expect(parts?.match).toBe('Álvarez');
    expect(parts?.before).toBe('José ');
  });
});

describe('GlobalSearchWidget', () => {
  const data = {
    rows: [
      { id: '1', type: 'record', label: 'Order #10248', snippet: 'Shipped', href: '/orders/10248' },
      { id: '2', type: 'people', label: 'Ana', snippet: 'Owner', href: '/people/2' },
    ],
    total: 2,
  };

  it('page variant renders the facet rail with counts and a summary', () => {
    render(
      <GlobalSearchWidget
        config={cfg(globalSearchConfigSchema, { variant: 'page' })}
        instanceId="t"
        onEvent={noop}
        data={data}
      />,
    );
    expect(document.querySelector('[data-part="facet-rail"]')).toBeTruthy();
    expect(document.querySelector('[data-part="search-summary"]')?.textContent).toContain('2 results');
  });

  it('page variant narrows results when a facet is pressed', () => {
    render(
      <GlobalSearchWidget
        config={cfg(globalSearchConfigSchema, { variant: 'page' })}
        instanceId="t"
        onEvent={noop}
        data={data}
      />,
    );
    fireEvent.click(document.querySelector('[data-part="facet"][data-type="people"]') as Element);
    expect(document.querySelectorAll('[data-part="search-result"]')).toHaveLength(1);
    expect(screen.getByText('Ana')).toBeTruthy();
  });

  it('routes a result click through onEvent', () => {
    const onEvent = vi.fn();
    render(
      <GlobalSearchWidget
        config={cfg(globalSearchConfigSchema, { variant: 'page' })}
        instanceId="t"
        onEvent={onEvent}
        data={data}
      />,
    );
    fireEvent.click(document.querySelector('[data-part="search-result"]') as Element, { button: 0 });
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/orders/10248' });
  });

  /**
   * The dropdown variant is a combobox with a listbox popup, and every claim
   * below is a real keyboard behaviour rather than an attribute: the field used
   * to be a `PopoverTrigger` on a `<div>` (a dialog trigger by announcement,
   * activatable by nothing) whose panel could not be dismissed, whose rows
   * could not be reached with the arrow keys, and whose only tab stops sat
   * inside Radix's LOOPING FocusScope — i.e. a Tab trap.
   */
  describe('dropdown variant — combobox semantics', () => {
    // "o" hits both rows: the label "Order #10248" and Ana's snippet "Owner".
    const openWith = async (text = 'o', onEvent: (event: unknown) => void = noop) => {
      render(
        <GlobalSearchWidget
          config={cfg(globalSearchConfigSchema, { variant: 'dropdown' })}
          instanceId="t"
          onEvent={onEvent as never}
          data={data}
        />,
      );
      const input = screen.getByRole('combobox') as HTMLInputElement;
      await userEvent.click(input);
      await userEvent.keyboard(text);
      return input;
    };

    it('names the field a combobox and stamps no dialog-trigger attributes on a div', () => {
      render(
        <GlobalSearchWidget
          config={cfg(globalSearchConfigSchema, { variant: 'dropdown' })}
          instanceId="t"
          onEvent={noop}
          data={data}
        />,
      );
      expect(screen.getByRole('combobox').tagName).toBe('INPUT');
      // The old PopoverTrigger put both of these on the wrapper <div>.
      expect(document.querySelector('[aria-haspopup]')).toBeNull();
      expect(document.querySelector('div[type="button"]')).toBeNull();
    });

    it('opens a listbox the field points at, and closes it again on Escape', async () => {
      const input = await openWith();
      const listbox = screen.getByRole('listbox');
      expect(input.getAttribute('aria-expanded')).toBe('true');
      expect(input.getAttribute('aria-controls')).toBe(listbox.id);
      expect(screen.getAllByRole('option')).toHaveLength(2);

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(input.getAttribute('aria-expanded')).toBe('false');
      // Escape dismisses the panel WITHOUT throwing the query away…
      expect(input.value).toBe('o');
      // …and an arrow key brings it back, so the dismiss is never a dead end.
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getByRole('listbox')).toBeTruthy();
    });

    it('clears the field on a second Escape (APG)', async () => {
      const input = await openWith();
      await userEvent.keyboard('{Escape}{Escape}');
      expect(input.value).toBe('');
    });

    it('moves the active option with the arrow keys, wrapping at the ends', async () => {
      const input = await openWith();
      const ids = screen.getAllByRole('option').map((option) => option.id);
      expect(input.getAttribute('aria-activedescendant')).toBe(ids[0]);
      expect(screen.getAllByRole('option')[0]?.getAttribute('aria-selected')).toBe('true');

      await userEvent.keyboard('{ArrowDown}');
      expect(input.getAttribute('aria-activedescendant')).toBe(ids[1]);
      expect(screen.getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true');

      await userEvent.keyboard('{ArrowDown}');
      expect(input.getAttribute('aria-activedescendant')).toBe(ids[0]);
      await userEvent.keyboard('{ArrowUp}');
      expect(input.getAttribute('aria-activedescendant')).toBe(ids[1]);
    });

    it('opens the row under the cursor on Enter', async () => {
      const onEvent = vi.fn();
      await openWith('o', onEvent);
      await userEvent.keyboard('{ArrowDown}{Enter}');
      expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/people/2' });
      // Choosing closes the panel — the result page is what the user is now on.
      expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('keeps focus in the field and leaves no tab stop inside the panel', async () => {
      const input = await openWith();
      // Radix would otherwise autofocus the panel's first tabbable on open,
      // pulling the caret out of the field on the FIRST keystroke.
      expect(document.activeElement).toBe(input);
      // Rows are reached by aria-activedescendant, never by Tab: a tabbable row
      // inside a `loop: true` FocusScope can never be Tabbed back out of.
      for (const option of screen.getAllByRole('option')) expect(option.tabIndex).toBe(-1);
    });

    it('survives a click back into the field', async () => {
      const input = await openWith();
      // Radix treats the anchor as "outside" (only a Trigger is exempt), so
      // without the guard, clicking into your own query to fix a typo would
      // dismiss the results you were reading.
      await userEvent.click(input);
      expect(screen.getByRole('listbox')).toBeTruthy();
    });

    it('announces "no results" as a status rather than an empty listbox', async () => {
      const input = await openWith('zzz');
      expect(screen.queryByRole('listbox')).toBeNull();
      // A listbox may own nothing but options, so the empty-state card lives in
      // a status region and the combobox reports itself collapsed.
      expect(screen.getByRole('status')).toBeTruthy();
      expect(input.getAttribute('aria-expanded')).toBe('false');
      expect(input.getAttribute('aria-activedescendant')).toBeNull();
    });
  });
});

// ── tab-bar ────────────────────────────────────────────────────────────────

describe('TabBarWidget', () => {
  const data = {
    rows: [
      { key: 'all', label: 'All', count: 248 },
      { key: 'open', label: 'Open', count: 31, href: '/orders?tab=open' },
    ],
    total: 2,
  };

  it('renders tabs from the payload', () => {
    render(<TabBarWidget config={cfg(tabBarConfigSchema)} instanceId="t" onEvent={noop} data={data} />);
    expect(screen.getByRole('tab', { name: /All/ })).toBeTruthy();
  });

  it('defaults the active tab to the first when config names none', () => {
    render(<TabBarWidget config={cfg(tabBarConfigSchema)} instanceId="t" onEvent={noop} data={data} />);
    expect(screen.getByRole('tab', { name: /All/ }).getAttribute('aria-selected')).toBe('true');
  });

  // Radix's TabsTrigger selects on mousedown/keydown, not on a synthetic
  // `click`, so these go through userEvent (a real pointer sequence) — a bare
  // fireEvent.click would pass vacuously without ever activating the tab.
  it('emits drill-through for a LINK tab', async () => {
    const onEvent = vi.fn();
    render(<TabBarWidget config={cfg(tabBarConfigSchema)} instanceId="t" onEvent={onEvent} data={data} />);
    await userEvent.click(screen.getByRole('tab', { name: /Open/ }));
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/orders?tab=open' });
  });

  it('does NOT navigate for a filter tab that carries no href', async () => {
    const onEvent = vi.fn();
    render(
      <TabBarWidget
        config={cfg(tabBarConfigSchema, { activeKey: 'open' })}
        instanceId="t"
        onEvent={onEvent}
        data={data}
      />,
    );
    await userEvent.click(screen.getByRole('tab', { name: /All/ }));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('renders nothing with no tabs', () => {
    const { container } = render(
      <TabBarWidget config={cfg(tabBarConfigSchema)} instanceId="t" onEvent={noop} data={{ rows: [], total: 0 }} />,
    );
    expect(container.querySelector('[data-widget="tab-bar"]')).toBeNull();
  });

  it('projects rows, skipping label-less ones', () => {
    expect(tabsOf({ rows: [{ key: 'a' }], total: 1 }, cfg(tabBarConfigSchema))).toHaveLength(0);
  });
});

// ── nav-card ───────────────────────────────────────────────────────────────

describe('NavCardWidget', () => {
  const data = { rows: [{ name: 'Orders', desc: 'Browse orders', icon: 'table', href: '/orders', tint: 'accent' }], total: 1 };

  it('renders a card and routes its click', () => {
    const onEvent = vi.fn();
    render(<NavCardWidget config={cfg(navCardConfigSchema)} instanceId="t" onEvent={onEvent} data={data} />);
    fireEvent.click(screen.getByRole('link', { name: /Orders/ }), { button: 0 });
    expect(onEvent).toHaveBeenCalledWith({ type: 'drill-through', href: '/orders' });
  });

  it('falls back to an accent tint for an unrecognised tint value', () => {
    const items = navCardsOf({ rows: [{ name: 'X', tint: 'chartreuse' }], total: 1 }, cfg(navCardConfigSchema));
    expect(items[0]?.tint).toBe('accent');
  });

  it('renders its empty copy with no rows', () => {
    render(
      <NavCardWidget
        config={cfg(navCardConfigSchema, { emptyTitle: 'Nothing here' })}
        instanceId="t"
        onEvent={noop}
        data={{ rows: [], total: 0 }}
      />,
    );
    expect(screen.getByText('Nothing here')).toBeTruthy();
  });
});

// ── shortcuts-panel ────────────────────────────────────────────────────────

describe('shortcuts-panel (annex §11)', () => {
  it('resolves the MOD token to the platform glyph the HOST chose', () => {
    expect(displayKey('MOD', 'Ctrl')).toBe('Ctrl');
    expect(displayKey('MOD', '⌘')).toBe('⌘');
    expect(displayKey('K', 'Ctrl')).toBe('K');
  });

  it('renders the built-in sheet with the configured modifier', () => {
    render(
      <ShortcutsPanelWidget config={cfg(shortcutsPanelConfigSchema, { modKey: 'Ctrl' })} instanceId="t" onEvent={noop} data={{}} />,
    );
    expect(screen.getByText('Open command palette')).toBeTruthy();
    expect(screen.getAllByText('Ctrl').length).toBeGreaterThan(0);
    expect(screen.queryByText('⌘')).toBeNull();
  });

  it('renders a sequence chord with a "then" separator', () => {
    render(
      <ShortcutsPanelWidget
        config={cfg(shortcutsPanelConfigSchema, {
          groups: [{ group: 'Nav', entries: [{ label: 'Go to orders', keys: ['G', 'O'], isSequence: true }] }],
        })}
        instanceId="t"
        onEvent={noop}
        data={{}}
      />,
    );
    expect(screen.getByText('then')).toBeTruthy();
  });

  it('renders a simultaneous combo WITHOUT a "then" separator', () => {
    render(
      <ShortcutsPanelWidget
        config={cfg(shortcutsPanelConfigSchema, {
          groups: [{ group: 'General', entries: [{ label: 'Save', keys: ['MOD', 'S'], isSequence: false }] }],
        })}
        instanceId="t"
        onEvent={noop}
        data={{}}
      />,
    );
    expect(screen.queryByText('then')).toBeNull();
  });

  it('renders repeated keys within one chord (e.g. "G then G")', () => {
    expect(() =>
      render(
        <ShortcutsPanelWidget
          config={cfg(shortcutsPanelConfigSchema, {
            groups: [{ group: 'Nav', entries: [{ label: 'Top', keys: ['G', 'G'], isSequence: true }] }],
          })}
          instanceId="t"
          onEvent={noop}
          data={{}}
        />,
      ),
    ).not.toThrow();
  });
});

// ── avatar-stack ───────────────────────────────────────────────────────────

describe('AvatarStackWidget', () => {
  const rows = ['Ana Trujillo', 'Bo Lien', 'Carlos Diaz', 'Dana Wu'].map((name, n) => ({ name, online: n < 2 }));

  it('renders the online caption in the presence variant', () => {
    render(
      <AvatarStackWidget
        config={cfg(avatarStackConfigSchema, { presence: true, onlineLabel: '{count} online' })}
        instanceId="t"
        onEvent={noop}
        data={{ rows, total: 4 }}
      />,
    );
    expect(screen.getByText('2 online')).toBeTruthy();
  });

  it('omits the caption without the presence variant', () => {
    render(<AvatarStackWidget config={cfg(avatarStackConfigSchema)} instanceId="t" onEvent={noop} data={{ rows, total: 4 }} />);
    expect(document.querySelector('[data-part="presence-caption"]')).toBeNull();
  });

  it('falls back to an initials column when no name column exists', () => {
    const people = peopleOf({ rows: [{ initials: 'AT' }], total: 1 }, cfg(avatarStackConfigSchema));
    expect(people[0]?.name).toBe('AT');
  });

  it('renders nothing with no people', () => {
    const { container } = render(
      <AvatarStackWidget config={cfg(avatarStackConfigSchema)} instanceId="t" onEvent={noop} data={{ rows: [], total: 0 }} />,
    );
    expect(container.querySelector('[data-widget="avatar-stack"]')).toBeNull();
  });
});

// ── payload leniency (04 §3) ───────────────────────────────────────────────

describe('malformed payloads never throw into the error boundary', () => {
  const cases: [string, unknown][] = [
    ['null', null],
    ['a string', 'nope'],
    ['an array', [1, 2, 3]],
    ['a number', 42],
    ['an empty object', {}],
    ['rows of nonsense', { rows: [null, 'x', 3], total: 3 }],
  ];

  for (const [label, data] of cases) {
    it(`sidebar-nav tolerates ${label}`, () => {
      expect(() =>
        render(<SidebarNavWidget config={cfg(sidebarNavConfigSchema)} instanceId="t" onEvent={noop} data={data} />),
      ).not.toThrow();
    });

    it(`global-search tolerates ${label}`, () => {
      expect(() =>
        render(
          <GlobalSearchWidget
            config={cfg(globalSearchConfigSchema, { variant: 'page' })}
            instanceId="t"
            onEvent={noop}
            data={data}
          />,
        ),
      ).not.toThrow();
    });

    it(`nav-card tolerates ${label}`, () => {
      expect(() =>
        render(<NavCardWidget config={cfg(navCardConfigSchema)} instanceId="t" onEvent={noop} data={data} />),
      ).not.toThrow();
    });

    it(`tab-bar tolerates ${label}`, () => {
      expect(() =>
        render(<TabBarWidget config={cfg(tabBarConfigSchema)} instanceId="t" onEvent={noop} data={data} />),
      ).not.toThrow();
    });

    it(`breadcrumb tolerates ${label}`, () => {
      expect(() =>
        render(<BreadcrumbWidget config={cfg(breadcrumbConfigSchema)} instanceId="t" onEvent={noop} data={data} />),
      ).not.toThrow();
    });
  }
});

// ── chrome localization ────────────────────────────────────────────────────

describe('chrome family chrome localization (ui:widgets.chrome.*)', () => {
  it('resolves bundle strings inside I18nProvider and falls back to English outside', async () => {
    const { createI18n } = await import('@adminium/i18n');
    const { I18nProvider } = await import('@adminium/i18n/react');
    const i18n = await createI18n({
      locale: 'de_DE',
      loadBundle: async (_tag, ns) =>
        ns === 'ui'
          ? {
              widgets: {
                chrome: {
                  sidebarNav: { emptyTitle: 'Noch keine Navigation', emptyBody: 'Tabellen erscheinen hier.' },
                },
              },
            }
          : null,
    });
    render(
      <I18nProvider i18n={i18n}>
        <SidebarNavWidget config={cfg(sidebarNavConfigSchema)} instanceId="t" onEvent={noop} data={{ rows: [], total: 0 }} />
      </I18nProvider>,
    );
    expect(screen.getByText('Noch keine Navigation')).toBeTruthy();

    cleanup();
    render(<SidebarNavWidget config={cfg(sidebarNavConfigSchema)} instanceId="t" onEvent={noop} data={{ rows: [], total: 0 }} />);
    expect(screen.getByText('No navigation yet')).toBeTruthy();
  });
});
