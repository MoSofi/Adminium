/**
 * Studio → Pages.
 *
 * Two halves, both worth pinning:
 *
 * - the pure algebra (`movePage`, `groupPages`, `toNavOrderPayload`, `slugify`),
 *   which is what the reorder UI is built on and is testable without a DOM;
 *   and
 * - the rendered surface, where the regressions live: a create form that lets
 *   a duplicate slug through, a delete confirm that does not say a generated
 *   page comes back, an ungrouped page that is invisible in both the sidebar
 *   AND the manager.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { pageTemplateDefinitions } from '@adminium/widgets';

import { ICON_SHORTLIST, isKnownIcon, searchIcons } from './IconPicker.js';
import { templateDefaultIcon } from './templateCatalog.js';
import {
  groupPages,
  movePage,
  slugify,
  slugifyInput,
  toNavOrderPayload,
  type PageSummaryDto,
} from './pagesApi.js';

function page(overrides: Partial<PageSummaryDto> = {}): PageSummaryDto {
  return {
    id: 'page_1',
    connectionId: 'conn_1',
    slug: 'customers',
    type: 'page-crud',
    title: 'Customers',
    icon: 'table',
    navGroup: 'library',
    navOrder: 0,
    origin: 'generated',
    manifestId: null,
    isEnabled: true,
    revision: 3,
    updatedAt: 1,
    ...overrides,
  };
}

describe('icon picker catalogue', () => {
  it('every shortlisted name is a real lucide icon', () => {
    // `lucideByName` falls back to `File` for an unknown name, so a typo in the
    // shortlist would render a plausible-looking wrong glyph instead of
    // failing. Nothing else would catch it.
    const unknown = ICON_SHORTLIST.filter((name) => !isKnownIcon(name));
    expect(unknown).toEqual([]);
  });

  it('every template default icon is a real lucide icon', () => {
    // The preview shows this glyph before the admin picks one, and the server
    // stamps the same name on create. A typo would render the `File` fallback
    // in the preview and store a dead name on the page — both silent.
    const unknown = pageTemplateDefinitions
      .map((definition) => templateDefaultIcon(definition.id))
      .filter((name) => !isKnownIcon(name));
    expect(unknown).toEqual([]);
  });

  it('searches beyond the shortlist so nothing is unreachable', () => {
    // The grid shows a curated ~90; the catalogue is ~1,500. Search has to
    // reach the rest or the shortlist becomes a cap.
    expect(ICON_SHORTLIST).not.toContain('anchor');
    expect(searchIcons('anchor')).toContain('anchor');
    // An empty query is the shortlist, in order.
    expect(searchIcons('')[0]).toBe(ICON_SHORTLIST[0]);
    expect(searchIcons('zzzznope')).toEqual([]);
  });

  it('puts shortlist hits before catalogue hits and never repeats one', () => {
    const results = searchIcons('cal');
    expect(results.indexOf('calendar')).toBeLessThan(results.indexOf('calculator'));
    expect(new Set(results).size).toBe(results.length);
  });
});

describe('page-manager algebra', () => {
  it('movePage is a no-op at the ends rather than wrapping around', () => {
    const list = ['a', 'b', 'c'];
    expect(movePage(list, 0, -1)).toEqual(['a', 'b', 'c']);
    expect(movePage(list, 2, 1)).toEqual(['a', 'b', 'c']);
    expect(movePage(list, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(movePage(list, 2, -1)).toEqual(['a', 'c', 'b']);
    // Never mutates its input — the draft state depends on a fresh array.
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('groupPages sorts by navOrder and surfaces rows the sidebar would drop', () => {
    const result = groupPages([
      page({ id: 'b', slug: 'b', navGroup: 'library', navOrder: 5 }),
      page({ id: 'a', slug: 'a', navGroup: 'library', navOrder: 1 }),
      // `buildNavTree` silently drops anything outside the five fixed keys, so
      // a page filed here renders at its URL and appears in no group at all.
      page({ id: 'lost', slug: 'lost', navGroup: 'nowhere' }),
      page({ id: 'none', slug: 'none', navGroup: null }),
    ]);
    const library = result.groups.find((group) => group.key === 'library');
    expect(library?.pages.map((row) => row.id)).toEqual(['a', 'b']);
    expect(result.ungrouped.map((row) => row.id)).toEqual(['lost', 'none']);
  });

  it('toNavOrderPayload omits ungrouped pages instead of inventing a group', () => {
    const grouped = groupPages([
      page({ id: 'a', slug: 'a', navGroup: 'library' }),
      page({ id: 'lost', slug: 'lost', navGroup: null }),
    ]);
    expect(toNavOrderPayload(grouped.groups)).toEqual([{ pageId: 'a', navGroup: 'library' }]);
  });

  it('slugify produces a kebab slug the server will accept', () => {
    expect(slugify('Ops Overview')).toBe('ops-overview');
    expect(slugify('  Café  Réservations ')).toBe('cafe-reservations');
    expect(slugify('!!!')).toBe('');
    // MAX_SLUG_LENGTH is 31; a longer one is unrepresentable by `pageIdFor`,
    // and a trailing dash left by the cut would fail the kebab regex.
    const long = slugify('a'.repeat(40));
    expect(long).toHaveLength(31);
    expect(slugify(`${'ab '.repeat(12)}`)).not.toMatch(/-$/);
  });

  it('slugifyInput keeps the dash the user just typed', () => {
    // The reported bug: the field promised dashes but refused them. `slugify`
    // strips trailing dashes, and running it per keystroke on a controlled
    // input rewrote `ops-` to `ops` before the next character could arrive, so
    // a dash could never survive long enough to be followed by anything.
    expect(slugifyInput('ops-')).toBe('ops-');
    expect(slugifyInput('ops-o')).toBe('ops-o');
    expect(slugifyInput('ops-overview')).toBe('ops-overview');
    // Typing a space or punctuation is the same pending separator, collapsed.
    expect(slugifyInput('ops ')).toBe('ops-');
    expect(slugifyInput('ops---')).toBe('ops-');
    // Leading separators still cannot start a slug.
    expect(slugifyInput('-')).toBe('');
    expect(slugifyInput('')).toBe('');
    // The pending dash never reaches the wire.
    expect(slugify(slugifyInput('ops-'))).toBe('ops');
    // And it cannot push the value past the length cap.
    expect(slugifyInput('a'.repeat(31))).toHaveLength(31);
  });
});

interface StubOptions {
  pages?: PageSummaryDto[];
  status?: number;
}

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

function stubFetch(options: StubOptions = {}): Recorded[] {
  const calls: Recorded[] = [];
  const rows = options.pages ?? [page()];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? 'GET';
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ method, path, body });

      // The real router boots the whole shell, so these two answer for it.
      if (path.startsWith('/api/v1/bootstrap')) {
        return jsonResponse(200, { data: makeBootstrap({ roles: ['super-admin'] }) });
      }
      if (path.startsWith('/api/v1/connections')) return jsonResponse(200, { connections: [] });

      if (path === '/api/v1/pages' && method === 'GET') {
        return options.status !== undefined && options.status !== 200
          ? jsonResponse(options.status, { error: { code: 'FORBIDDEN', message: 'nope' } })
          : jsonResponse(200, { data: rows });
      }
      if (path === '/api/v1/pages' && method === 'POST') {
        return jsonResponse(200, { data: page({ id: 'page_new', ...(body as object) }) });
      }
      if (path === '/api/v1/pages/nav-order') return jsonResponse(200, { data: { moved: 2 } });
      if (method === 'DELETE') return jsonResponse(200, { data: { ok: true } });
      if (method === 'PATCH') return jsonResponse(200, { data: rows[0] });
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope' } });
    }),
  );
  return calls;
}

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

/**
 * Full-router harness. These screens ARE routes now — the list links to
 * `/studio/pages/$pageId`, create is `/studio/pages/new` — so mounting the
 * components bare would fail on the missing router context and, worse, would
 * stop proving that the routes resolve at all.
 */
function renderAt(path: string, options: StubOptions = {}) {
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const calls = stubFetch(options);
  const queryClient = createQueryClient();
  const router = createAppRouter(queryClient, {
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), calls };
}

describe('StudioPagesPage', () => {
  beforeAll(installTestI18n);
  afterAll(() => {
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists pages with their origin and visibility', async () => {
    renderAt('/studio/pages', {
      pages: [
        page({ id: 'a', slug: 'customers', title: 'Customers' }),
        page({ id: 'b', slug: 'notes', title: 'Notes', origin: 'user', isEnabled: false }),
      ],
    });

    // Gate on a list-only testid, not on a title: the full router also renders
    // the shell, whose sidebar carries page names from the bootstrap fixture —
    // `findByText('Customers')` would resolve against the nav before the list
    // had fetched anything.
    expect(await screen.findByTestId('studio-pages-count')).toBeTruthy();
    expect(await screen.findByText('/p/notes')).toBeTruthy();
    // Origin is not decoration: it tells the admin whether a delete sticks.
    expect(screen.getByText('Generated')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByText('Hidden')).toBeTruthy();
    expect(screen.getByTestId('studio-pages-count').textContent).toContain('2');
  });

  it('explains the missing permission instead of showing an empty list', async () => {
    // A 403 here is the common case: `pages.manage` is a new key that no
    // built-in role holds. An empty table would read as "you have no pages".
    renderAt('/studio/pages', { status: 403 });
    const alert = await screen.findByTestId('studio-pages-error');
    expect(alert.textContent).toContain('Manage pages');
    expect(screen.queryByTestId('studio-pages-empty')).toBeNull();
  });

  it('does not blame permissions for a failure that is not a 403', async () => {
    // Caught on a real server: an older build with no /pages route 404s, and
    // the page told the admin to go edit a role matrix that was never at fault.
    renderAt('/studio/pages', { status: 404 });
    const alert = await screen.findByTestId('studio-pages-error');
    expect(alert.textContent).not.toContain('Manage pages');
  });

  it('derives a slug from the title and blocks a duplicate before the request', async () => {
    const { user, calls } = renderAt('/studio/pages', { pages: [page({ slug: 'reports' })] });

    await user.click(await screen.findByTestId('studio-pages-create'));
    await user.type(await screen.findByTestId('studio-pages-title'), 'Reports');
    expect((screen.getByTestId('studio-pages-slug') as HTMLInputElement).value).toBe('reports');

    const submit = screen.getByTestId('studio-pages-create-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    await user.clear(screen.getByTestId('studio-pages-title'));
    await user.type(screen.getByTestId('studio-pages-title'), 'Weekly reports');
    expect((screen.getByTestId('studio-pages-slug') as HTMLInputElement).value).toBe(
      'weekly-reports',
    );
    await user.click(screen.getByTestId('studio-pages-create-submit'));

    await waitFor(() => {
      const post = calls.find((call) => call.method === 'POST');
      expect(post?.body).toMatchObject({ slug: 'weekly-reports', title: 'Weekly reports' });
    });
  });

  it('lets a dash be typed into the address field, character by character', async () => {
    // End-to-end version of the slugifyInput unit test: the bug only showed up
    // through a CONTROLLED input, where the rewritten value came back as the
    // next render's value and ate the dash.
    const { user, calls } = renderAt('/studio/pages', { pages: [] });

    await user.click(await screen.findByTestId('studio-pages-create'));
    await user.type(await screen.findByTestId('studio-pages-title'), 'Ops');
    const slugField = screen.getByTestId('studio-pages-slug') as HTMLInputElement;
    await user.clear(slugField);
    await user.type(slugField, 'ops-overview');
    expect(slugField.value).toBe('ops-overview');

    await user.click(screen.getByTestId('studio-pages-create-submit'));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
        slug: 'ops-overview',
      });
    });
  });

  it('never sends a trailing dash left mid-typing', async () => {
    const { user, calls } = renderAt('/studio/pages', { pages: [] });

    await user.click(await screen.findByTestId('studio-pages-create'));
    await user.type(await screen.findByTestId('studio-pages-title'), 'Ops');
    const slugField = screen.getByTestId('studio-pages-slug') as HTMLInputElement;
    await user.clear(slugField);
    await user.type(slugField, 'ops-');
    expect(slugField.value).toBe('ops-');

    await user.click(screen.getByTestId('studio-pages-create-submit'));
    await waitFor(() => {
      // `ops-` is not a legal kebab slug — the route schema would 422 it.
      expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ slug: 'ops' });
    });
  });

  it('warns that deleting a generated page only lasts until the next run', async () => {
    const { user } = renderAt('/studio/pages', {
      pages: [page({ origin: 'generated', title: 'Customers' })],
    });

    await screen.findByTestId('studio-pages-count');
    await user.click(await screen.findByRole('button', { name: 'Actions for Customers' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete page' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/come back the next time you regenerate/i)).toBeTruthy();
  });

  it('sends the whole rail once, not one request per move', async () => {
    const { user, calls } = renderAt('/studio/pages', {
      pages: [
        page({ id: 'a', slug: 'a', title: 'Alpha', navGroup: 'library', navOrder: 0 }),
        page({ id: 'b', slug: 'b', title: 'Beta', navGroup: 'library', navOrder: 1 }),
        page({ id: 'c', slug: 'c', title: 'Gamma', navGroup: 'library', navOrder: 2 }),
      ],
    });

    await user.click(await screen.findByRole('tab', { name: 'Sidebar order' }));
    await user.click(await screen.findByRole('button', { name: 'Move Gamma up' }));
    await user.click(screen.getByRole('button', { name: 'Move Gamma up' }));

    // Still nothing written — the draft is local until Save.
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);

    await user.click(screen.getByTestId('studio-pages-save-order'));
    await waitFor(() => {
      const put = calls.filter((call) => call.method === 'PUT');
      expect(put).toHaveLength(1);
      expect(put[0]?.body).toEqual({
        items: [
          { pageId: 'c', navGroup: 'library' },
          { pageId: 'a', navGroup: 'library' },
          { pageId: 'b', navGroup: 'library' },
        ],
      });
    });
  });

  it('names templates in human words, not the id', async () => {
    // The whole point of the catalogue: `page-crud` humanizes to "Crud", which
    // is jargon for what the locale bundle has always called "Records". The
    // picker used to show the jargon while the right word sat unused.
    renderAt('/studio/pages/new');
    const select = (await screen.findByTestId('studio-pages-template')) as HTMLSelectElement;
    const labels = [...select.options].map((option) => option.textContent);
    expect(labels).toContain('Records');
    expect(labels).toContain('List & detail');
    expect(labels).not.toContain('Crud');
    expect(labels).not.toContain('Master detail');
  });

  it('previews the chosen template and follows a change', async () => {
    const { user } = renderAt('/studio/pages/new');
    const select = await screen.findByTestId('studio-pages-template');

    // The preview names the template and explains it — the description is the
    // half a name cannot carry.
    expect(await screen.findByText(/rows in a searchable table/i)).toBeTruthy();

    await user.selectOptions(select, 'page-board');
    expect(await screen.findByText(/cards in columns by status/i)).toBeTruthy();
    // And the old one is gone, i.e. it tracks rather than accumulates.
    expect(screen.queryByText(/rows in a searchable table/i)).toBeNull();
  });

  it('shows the typed title and bound table in the preview chrome', async () => {
    const { user } = renderAt('/studio/pages/new');
    // Before anything is typed the preview says so rather than rendering blank.
    expect(await screen.findByText('Untitled page')).toBeTruthy();
    await user.type(await screen.findByTestId('studio-pages-title'), 'Shipping');
    expect(await screen.findByText('Shipping')).toBeTruthy();
  });

  it('flags pages that belong to no sidebar group', async () => {
    const { user } = renderAt('/studio/pages', { pages: [page({ id: 'lost', slug: 'lost', title: 'Lost', navGroup: null })] });
    await user.click(await screen.findByRole('tab', { name: 'Sidebar order' }));
    expect(await screen.findByTestId('studio-pages-ungrouped')).toBeTruthy();
  });
});
