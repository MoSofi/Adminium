/**
 * `/help` (M10-T06): local search over the checked-in index, category cards
 * that double as filter toggles (the `ia-mapping.md` §4 keeper), the filtered
 * empty state, and the deep links out to docs.adminium.ai.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { createAppRouter } from '../app/router.js';
import { installTestI18n } from '../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import { KB_ARTICLES, countByCategory, filterArticles, type KbArticle } from './articles.js';

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

async function renderPage() {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: unknown) => {
      if (String(input).startsWith('/api/v1/bootstrap')) {
        return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
      }
      return Promise.resolve(
        jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_t' } }),
      );
    }),
  );
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: ['/help'] }),
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

// --- the index ---------------------------------------------------------------

const resolve = (article: KbArticle) => ({
  title: article.titleFallback,
  excerpt: article.excerptFallback,
});

describe('the KB index', () => {
  it('parses at import and every article points somewhere', () => {
    expect(KB_ARTICLES.length).toBeGreaterThan(0);
    for (const article of KB_ARTICLES) {
      expect(article.docsPath).not.toBe('');
      expect(article.docsPath.startsWith('/')).toBe(false);
    }
  });

  it('has unique ids — the list keys depend on it', () => {
    const ids = KB_ARTICLES.map((article) => article.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('derives category counts rather than hardcoding them (the comp’s “142 articles”)', () => {
    const counts = countByCategory(KB_ARTICLES);
    const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
    expect(total).toBe(KB_ARTICLES.length);
  });
});

describe('filterArticles', () => {
  it('returns everything for an empty query and no category', () => {
    expect(filterArticles(KB_ARTICLES, { category: null, query: '', resolve })).toHaveLength(
      KB_ARTICLES.length,
    );
  });

  it('matches titles case-insensitively', () => {
    const result = filterArticles(KB_ARTICLES, { category: null, query: 'DOCKER', resolve });
    expect(result.map((article) => article.id)).toContain('docker');
  });

  it('matches the excerpt too, not just the title', () => {
    // "ADMINIUM_SECRET" appears only in the secrets article's excerpt.
    const result = filterArticles(KB_ARTICLES, { category: null, query: 'ADMINIUM_SECRET', resolve });
    expect(result.map((article) => article.id)).toEqual(['secrets']);
  });

  it('ignores surrounding whitespace', () => {
    expect(filterArticles(KB_ARTICLES, { category: null, query: '   docker  ', resolve })).toEqual(
      filterArticles(KB_ARTICLES, { category: null, query: 'docker', resolve }),
    );
  });

  it('narrows to a category', () => {
    const result = filterArticles(KB_ARTICLES, { category: 'trouble', query: '', resolve });
    expect(result.length).toBeGreaterThan(0);
    for (const article of result) expect(article.category).toBe('trouble');
  });

  it('applies category AND query together', () => {
    const result = filterArticles(KB_ARTICLES, { category: 'selfhost', query: 'docker', resolve });
    expect(result.map((article) => article.id)).toEqual(['docker']);
    // ...and the same query outside that category finds nothing.
    expect(filterArticles(KB_ARTICLES, { category: 'trouble', query: 'docker', resolve })).toEqual([]);
  });

  it('returns nothing for a miss', () => {
    expect(
      filterArticles(KB_ARTICLES, { category: null, query: 'zzzznotathing', resolve }),
    ).toEqual([]);
  });
});

// --- the page ----------------------------------------------------------------

describe('KnowledgeBasePage', () => {
  it('lists the whole index and links each article to the docs site', async () => {
    await renderPage();
    expect(await screen.findByRole('heading', { name: 'Knowledge Base' })).toBeDefined();

    expect(screen.getAllByTestId('kb-article')).toHaveLength(KB_ARTICLES.length);

    // The path is the REAL docs route. This used to assert `/self-host/docker`,
    // which the docs site does not publish — the test pinned the 404 rather than
    // catching it. `docs-contract.test.ts` (apps/server) checks every article's
    // path against the docs content tree; this one just proves the link renders.
    const link = screen.getByRole('link', { name: /Self-host with Docker/ });
    expect(link.getAttribute('href')).toBe('https://docs.adminium.ai/self-hosting/docker-compose');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('filters the list as you search — across titles AND excerpts', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByRole('heading', { name: 'Knowledge Base' });

    await user.type(screen.getByTestId('kb-search'), 'docker');
    const ids = screen
      .getAllByTestId('kb-article')
      .map((row) => row.getAttribute('data-article'))
      .sort();

    // Two hits, and the pair is the point: "docker" is in the Docker guide's
    // TITLE and in the install guide's EXCERPT ("…or docker run…"). A
    // title-only search would silently miss the second.
    expect(ids).toEqual(['docker', 'install']);
  });

  it('shows the empty state — with a docs escape hatch — when nothing matches', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByRole('heading', { name: 'Knowledge Base' });

    await user.type(screen.getByTestId('kb-search'), 'zzzznotathing');
    expect(await screen.findByTestId('kb-empty')).toBeDefined();
    expect(screen.queryAllByTestId('kb-article')).toHaveLength(0);

    // A dead end is a bug — but so is an escape hatch that 404s, which is what
    // this used to assert: it required the href to CARRY the query, i.e. to be
    // `/search?q=zzzznotathing`. The docs site's search is a pagefind modal, so
    // no `/search` route exists and that link was itself a dead end, handed to
    // the user at the exact moment in-app help had already failed them. The docs
    // home is reachable and has the search control on it.
    // Scoped to the empty state — the page header offers the same destination.
    const escape = within(screen.getByTestId('kb-empty')).getByRole('link', {
      name: /Open the docs/,
    });
    expect(escape.getAttribute('href')).toBe('https://docs.adminium.ai');
  });

  it('uses the category cards as filter toggles — click filters, click again clears', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByRole('heading', { name: 'Knowledge Base' });

    const all = screen.getAllByTestId('kb-article').length;

    await user.click(screen.getByRole('button', { name: /Troubleshooting/ }));
    const filtered = screen.getAllByTestId('kb-article');
    expect(filtered.length).toBeLessThan(all);
    expect(screen.getByRole('heading', { name: 'Troubleshooting' })).toBeDefined();

    // The same card again releases the filter (toggle, not one-way select).
    await user.click(screen.getByRole('button', { name: /Troubleshooting/ }));
    expect(screen.getAllByTestId('kb-article')).toHaveLength(all);
  });

  it('clears both the category and the query from one control', async () => {
    const user = userEvent.setup();
    await renderPage();
    await screen.findByRole('heading', { name: 'Knowledge Base' });

    await user.click(screen.getByRole('button', { name: /Self-hosting/ }));
    await user.type(screen.getByTestId('kb-search'), 'docker');
    expect(screen.getAllByTestId('kb-article')).toHaveLength(1);

    await user.click(screen.getByTestId('kb-clear-filter'));
    expect(screen.getAllByTestId('kb-article')).toHaveLength(KB_ARTICLES.length);
  });

  it('does not print ⌘K on the hero search — that shortcut opens the command palette', async () => {
    await renderPage();
    await screen.findByRole('heading', { name: 'Knowledge Base' });

    // Scoped to the hero's own pill: the SHELL topbar legitimately shows ⌘K
    // (it really does open the palette), so an unscoped query would match it
    // and this test would be asserting nothing about this page.
    const pill = screen.getByTestId('kb-search').parentElement;
    expect(pill).not.toBeNull();
    expect(within(pill as HTMLElement).queryByText('⌘K')).toBeNull();
    expect((pill as HTMLElement).querySelector('kbd')).toBeNull();
  });
});
