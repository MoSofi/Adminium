// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/changelog` (M10-T06): renders from the checked-in feed (not a literal in the
 * component), formats dates through the Intl layer, and — the keeper worth a
 * regression test — hides releases a filter leaves empty rather than showing an
 * empty card that implies a change nobody made.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { RELEASES, availableTags, filterReleases, type Release } from './releases.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

async function renderPage(locale = 'en_US') {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      if (String(input).startsWith('/api/v1/bootstrap')) {
        const boot = makeBootstrap({ nav: { groups: [] } });
        return Promise.resolve(
          jsonResponse(200, { data: { ...boot, prefs: { ...boot.prefs, locale } } }),
        );
      }
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
      );
    }),
  );
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/changelog'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// --- the feed itself ---------------------------------------------------------

describe('the release feed', () => {
  it('parses at import — a malformed feed is a build error, not a broken page', () => {
    // `RELEASES` is Zod-parsed at module load; reaching this line proves it.
    expect(RELEASES.length).toBeGreaterThan(0);
    for (const release of RELEASES) {
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(release.changes.length).toBeGreaterThan(0);
    }
  });

  it('is ordered newest-first', () => {
    const dates = RELEASES.map((release) => release.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe('filterReleases', () => {
  const feed: Release[] = [
    {
      version: '2.0.0',
      date: '2026-01-02',
      title: 'Two',
      summary: 's',
      changes: [
        { tag: 'New', text: 'a new thing' },
        { tag: 'Security', text: 'a security thing' },
      ],
    },
    {
      version: '1.0.0',
      date: '2026-01-01',
      title: 'One',
      summary: 's',
      changes: [{ tag: 'New', text: 'another new thing' }],
    },
  ];

  it('passes everything through when unfiltered', () => {
    expect(filterReleases(feed, null)).toHaveLength(2);
  });

  it('keeps only the matching changes inside a release', () => {
    const [only] = filterReleases(feed, 'Security');
    expect(only?.version).toBe('2.0.0');
    expect(only?.changes).toEqual([{ tag: 'Security', text: 'a security thing' }]);
  });

  it('DROPS releases the filter empties — an empty card implies a change nobody made', () => {
    const result = filterReleases(feed, 'Security');
    expect(result).toHaveLength(1);
    expect(result.map((release) => release.version)).not.toContain('1.0.0');
  });

  it('returns nothing when no release carries the tag', () => {
    expect(filterReleases(feed, 'Fixed')).toEqual([]);
  });

  it('never mutates the source feed', () => {
    const before = JSON.stringify(feed);
    filterReleases(feed, 'New');
    expect(JSON.stringify(feed)).toBe(before);
  });

  it('offers a chip only for tags the feed actually uses', () => {
    expect(availableTags(feed)).toEqual(['New', 'Security']);
  });
});

// --- the page ----------------------------------------------------------------

describe('ChangelogPage', () => {
  it('renders every release from the checked-in feed', async () => {
    await renderPage();
    expect(await screen.findByRole('heading', { name: 'Changelog' })).toBeDefined();

    const nodes = await screen.findAllByTestId('changelog-release');
    expect(nodes).toHaveLength(RELEASES.length);
    // Versions come from the data file — not a literal in the component.
    for (const release of RELEASES) {
      expect(screen.getAllByText(release.version).length).toBeGreaterThan(0);
    }
  });

  // The date appears twice per release by design: the version gutter (≥sm) and
  // an inline restatement for narrow screens where the gutter is hidden.
  it('formats dates through the Intl layer, not as a hardcoded string', async () => {
    await renderPage('en_US');
    await screen.findByRole('heading', { name: 'Changelog' });
    // US order, month-first — never the comp's hardcoded "Jul 10".
    expect(screen.getAllByText('Jul 21, 2026').length).toBeGreaterThan(0);
  });

  it('renders the same ISO date in the de-DE order for a German viewer', async () => {
    await renderPage('de_DE');
    await screen.findByRole('heading', { name: 'Changelog' });
    // Day-first and dotted — the same `2026-07-21` from the feed, localized.
    expect(screen.getAllByText('21.07.2026').length).toBeGreaterThan(0);
    expect(screen.queryByText('Jul 21, 2026')).toBeNull();
  });

  it('filters the rendered feed down to one tag', async () => {
    // Release-level emptying is asserted against the synthetic feed in the
    // `filterReleases` block above; the shipped feed is a single 0.1.0 entry
    // (see releases.ts — no other release was ever tagged), so what this proves
    // here is that the chip really narrows what the PAGE renders.
    const user = userEvent.setup();
    await renderPage();
    await screen.findByRole('heading', { name: 'Changelog' });

    const before = screen.getAllByTestId('changelog-change').length;
    await user.click(screen.getByRole('radio', { name: 'Security' }));

    const after = screen.getAllByTestId('changelog-change');
    expect(after.length).toBeLessThan(before);
    expect(after.length).toBeGreaterThan(0);
    // Every surviving change really is a Security change.
    for (const change of after) {
      expect(change.getAttribute('data-tag')).toBe('Security');
    }
  });

  it('returns to the full feed when the filter clears', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByRole('heading', { name: 'Changelog' });

    await user.click(screen.getByRole('radio', { name: 'Security' }));
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.getAllByTestId('changelog-release')).toHaveLength(RELEASES.length);
  });
});
