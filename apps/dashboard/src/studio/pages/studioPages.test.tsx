// SPDX-License-Identifier: AGPL-3.0-only
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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../app/query.js';
import { createAppRouter } from '../../app/router.js';
import { gridColumnSpecSchema } from '@adminium/widgets';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap, makeCrudEnvelope } from '../../test/fixtures.js';
import { pageTemplateDefinitions } from '@adminium/widgets';

import { ICON_SHORTLIST, ensureIconCatalogue, isKnownIcon, searchIcons } from './IconPicker.js';
import { templateDefaultIcon } from './templateCatalog.js';
import {
  groupPages,
  movePage,
  slugify,
  slugifyInput,
  toNavOrderPayload,
  type PageSummaryDto,
} from './pagesApi.js';
import type { ProjectStatusDto } from './projectApi.js';

function page(overrides: Partial<PageSummaryDto> = {}): PageSummaryDto {
  return {
    id: 'page_1',
    connectionId: 'conn_1',
    connectionName: 'Production',
    connectionPaused: false,
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
  // The catalogue is a DYNAMIC import now — `import { icons } from
  // 'lucide-react'` in this module put all 1,611 icon modules into whatever
  // chunk reached it, which on the boot path was 112.6 KiB gzipped of entry
  // (see icon-resolver.ts). The picker fetches it when it opens; these tests
  // await the same call, so they check the loaded behaviour rather than the
  // shortlist-only frame before it lands.
  beforeAll(async () => {
    await ensureIconCatalogue();
  });

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
  /**
   * Config BODY the edit screen's `GET /pages/:id` answers with. Only the edit
   * route reads it — the list screen never fetches a document — so the default
   * keeps every existing test on the 404 it already expected.
   */
  config?: Record<string, unknown>;
  /**
   * `GET /storage/destinations` for the Attachments card's picker. Undefined
   * answers 403 — the common case, because `storage.manage` is a separate
   * grant from `pages.manage`, and the card has to degrade to "everything
   * follows the default" rather than to an error.
   */
  destinations?: { id: string; name: string; isDefault: boolean; disabled: boolean }[];
  /**
   * `schemaAuthoring` on the schema reply — what decides which MODE the
   * attachments card is in. Absent = authorable, which is both the
   * server's default and the tolerance `RemapEditor` applies to an older
   * server, so it is COLUMN mode unless a test says otherwise.
   */
  schemaAuthoring?: {
    authorable: boolean;
    reason: 'NO_LIVE_DATABASE' | 'READ_ONLY_ROLE' | 'NO_DDL_PRIVILEGE' | 'READ_ONLY_INTENT' | null;
  };
  /** `columnFacts` on the page reply — what the form designer draws from. */
  columnFacts?: {
    table: { labelSingular: string | null };
    columns: {
      spec: Record<string, unknown>;
      ordinal: number;
      writable: boolean;
      filledBy: 'database' | 'adminium' | null;
      required: boolean;
    }[];
    relations?: { relationId: string; label: string; targetTable: string; targetKey: string }[];
  };
  /** `POST /connections/:id/schema/plan` — the column setup's preview. */
  planReply?: () => Response;
  /** `POST /connections/:id/schema/apply` — the column setup's confirm. */
  applyReply?: () => Response;
  /** `GET /project/status`; undefined answers 404, as a server with no project folder does. */
  projectStatus?: ProjectStatusDto;
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
      // Before the blanket connections branch: `/connections/:id/schema` is a
      // different reply shape, and the edit screen reads `model.tables` off it
      // unguarded — answering it with the connection-list shape blanks the
      // whole screen through the route error boundary.
      if (path.startsWith('/api/v1/connections/') && path.endsWith('/schema/plan')) {
        return (
          options.planReply?.() ??
          jsonResponse(200, {
            steps: [
              {
                id: 's1',
                kind: 'add-column',
                table: 'public.customers',
                column: 'attachments',
                hazard: 'safe',
                requiresSuperAdmin: false,
                summary: 'Add column attachments (text)',
                rationale: 'Postgres adds a nullable column as metadata.',
                consequences: [],
                dependsOn: [],
                outsideTransaction: false,
                refusal: null,
                sql: ['alter table "public"."customers" add column "attachments" text'],
              },
            ],
            refusals: [],
            warnings: [],
            hazard: 'safe',
            requiresSuperAdmin: false,
            checksum: 'sum_1',
            ceilings: [],
            unfinished: null,
          })
        );
      }
      if (path.startsWith('/api/v1/connections/') && path.endsWith('/schema/apply')) {
        return (
          options.applyReply?.() ??
          jsonResponse(200, { changeId: 'chg_1', status: 'applied', steps: [], error: null, repaired: null })
        );
      }
      if (path.startsWith('/api/v1/connections/') && path.endsWith('/schema')) {
        return jsonResponse(200, {
          connectionId: 'conn_1',
          snapshotId: 'snap_1',
          checksum: 'x',
          createdAt: 1,
          source: 'introspection',
          model: {
            tables: [
              {
                id: 'public.customers',
                schema: 'public',
                name: 'customers',
                rowCountEstimate: null,
                primaryKey: ['id'],
                columns: [
                  { name: 'id', ordinal: 1, logicalType: 'integer', isPrimaryKey: true, nullable: false },
                  { name: 'name', ordinal: 2, logicalType: 'text', nullable: true },
                ],
              },
              // A second table so a test can rebind the page to something else.
              {
                id: 'public.invoices',
                schema: 'public',
                name: 'invoices',
                rowCountEstimate: null,
                primaryKey: ['id'],
                columns: [
                  { name: 'id', ordinal: 1, logicalType: 'integer', isPrimaryKey: true, nullable: false },
                ],
              },
            ],
          },
          appliedOverrides: 0,
          ...(options.schemaAuthoring === undefined
            ? {}
            : { schemaAuthoring: options.schemaAuthoring }),
        });
      }
      if (path.startsWith('/api/v1/connections')) return jsonResponse(200, { connections: [] });

      if (path === '/api/v1/storage/destinations') {
        return options.destinations === undefined
          ? jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'nope' } })
          : jsonResponse(200, { data: options.destinations });
      }

      if (path === '/api/v1/pages' && method === 'GET') {
        return options.status !== undefined && options.status !== 200
          ? jsonResponse(options.status, { error: { code: 'FORBIDDEN', message: 'nope' } })
          : jsonResponse(200, { data: rows });
      }
      if (path === '/api/v1/pages' && method === 'POST') {
        return jsonResponse(200, { data: page({ id: 'page_new', ...(body as object) }) });
      }
      if (path === '/api/v1/pages/nav-order') return jsonResponse(200, { data: { moved: 2 } });
      if (path === '/api/v1/project/status' && options.projectStatus !== undefined) {
        return jsonResponse(200, { data: options.projectStatus });
      }
      if (path === '/api/v1/project/resolve' && options.projectStatus !== undefined) {
        return jsonResponse(200, { data: { ...options.projectStatus, entries: [] } });
      }
      if (options.config !== undefined && path === `/api/v1/pages/${rows[0]?.id}` && method === 'GET') {
        return jsonResponse(200, {
          data: makeCrudEnvelope({ id: rows[0]?.id as string, config: options.config }),
          canEditLayout: true,
          // The live column facts the form designer derives its draft from.
          // Absent by default, which is what an older server sends and what
          // every test that predates the designer expects.
          ...(options.columnFacts === undefined ? {} : { columnFacts: options.columnFacts }),
        });
      }
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

  it('shows a page from the project code as code-owned: it opens the page, and offers no edits', async () => {
    const { user } = renderAt('/studio/pages', {
      pages: [page({ id: 'page_proj_revenue', slug: 'revenue', title: 'Revenue', origin: 'project', type: 'project-page', connectionId: null, connectionName: null })],
    });
    expect(await screen.findByText('/p/revenue')).toBeTruthy();
    expect(screen.getByText('Project code')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Revenue/ }).getAttribute('href')).toBe('/p/revenue');
    await user.click(screen.getByRole('button', { name: 'Actions for Revenue' }));
    expect(await screen.findByText('This page comes from pages/revenue.tsx. Change it there.')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Edit page' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete page' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Hide from sidebar' })).toBeNull();
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

  it('sends a chosen content width, and sends nothing when left on the default', async () => {
    // The Appearance card had only a padding control; width was template-owned
    // and unreachable from the UI. What matters on the wire is the ABSENT case:
    // an untouched page must keep following its template's column rather than
    // having today's default frozen into its envelope on create.
    const untouched = renderAt('/studio/pages', { pages: [] });
    await untouched.user.click(await screen.findByTestId('studio-pages-create'));
    await untouched.user.type(await screen.findByTestId('studio-pages-title'), 'Ops');
    await untouched.user.click(screen.getByTestId('studio-pages-create-submit'));
    await waitFor(() => {
      expect(untouched.calls.find((call) => call.method === 'POST')).toBeDefined();
    });
    expect(untouched.calls.find((call) => call.method === 'POST')?.body).not.toHaveProperty('width');

    cleanup();
    vi.unstubAllGlobals();

    const chosen = renderAt('/studio/pages', { pages: [] });
    await chosen.user.click(await screen.findByTestId('studio-pages-create'));
    await chosen.user.type(await screen.findByTestId('studio-pages-title'), 'Ops');
    await chosen.user.selectOptions(screen.getByTestId('studio-pages-width'), 'narrow');
    await chosen.user.click(screen.getByTestId('studio-pages-create-submit'));
    await waitFor(() => {
      expect(chosen.calls.find((call) => call.method === 'POST')?.body).toMatchObject({
        width: 'narrow',
      });
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

  /**
   * The owning data source, on BOTH tabs. With two connections the inventory
   * is one flat list and the organizer is bucketed by nav group, so neither
   * one said which database an "Orders" page came from — the same ambiguity
   * `shell/navSections.ts` exists to fix in the rail.
   */
  it('names the owning connection on every row of both tabs', async () => {
    const { user } = renderAt('/studio/pages', {
      pages: [
        page({ id: 'a', slug: 'orders', title: 'Orders', navGroup: 'library', connectionName: 'Production' }),
        page({
          id: 'b',
          slug: 'orders-eu',
          title: 'Orders EU',
          navGroup: 'library',
          connectionId: 'conn_2',
          connectionName: 'Warehouse',
        }),
      ],
    });

    await screen.findByTestId('studio-pages-count');
    const inventory = screen.getAllByTestId('studio-pages-connection');
    expect(inventory.map((chip) => chip.textContent)).toEqual(['Production', 'Warehouse']);

    // The organizer is the other half of the ask: reordering the rail is where
    // two same-named pages from different sources are easiest to confuse.
    await user.click(screen.getByRole('tab', { name: 'Sidebar order' }));
    await waitFor(() => {
      expect(
        screen.getAllByTestId('studio-pages-connection').map((chip) => chip.textContent),
      ).toEqual(['Production', 'Warehouse']);
    });
  });

  /**
   * Reported from a real deployment: a paused connection's pages still wore the
   * green "Live" pill. They are not live — `buildNavTree` drops every page of a
   * paused source out of the nav into `pausedPages` — so the pill was sending
   * the admin to the page when the fix was on the connection.
   */
  it('does not call a page on a paused connection Live, on either tab', async () => {
    const { user } = renderAt('/studio/pages', {
      pages: [
        page({ id: 'a', slug: 'orders', title: 'Orders', navGroup: 'library' }),
        page({
          id: 'b',
          slug: 'charges',
          title: 'Charges',
          navGroup: 'library',
          connectionId: 'conn_2',
          connectionName: 'Clinic',
          connectionPaused: true,
        }),
      ],
    });

    await screen.findByTestId('studio-pages-count');
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('Paused')).toBeTruthy();
    // One Live, not two: the paused row must not carry it as well.
    expect(screen.queryAllByText('Live')).toHaveLength(1);

    await user.click(screen.getByRole('tab', { name: 'Sidebar order' }));
    await waitFor(() => {
      expect(screen.getByText('Paused')).toBeTruthy();
    });
  });

  it('lets the pause outrank a page that is also hidden', async () => {
    // Both facts are true at once and the pill has one slot. Pause wins,
    // because un-hiding the page would still leave it serving nothing —
    // `buildNavTree` applies exactly this precedence.
    renderAt('/studio/pages', {
      pages: [
        page({ id: 'a', slug: 'charges', title: 'Charges', isEnabled: false, connectionPaused: true }),
      ],
    });

    await screen.findByTestId('studio-pages-count');
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it('separates a page with no data source from one whose connection is gone', async () => {
    // Both arrive as a null name and they are not the same fact: the first is a
    // hand-made page that never had a source, the second is an orphan left by a
    // deleted connection. Rendering both as "Shared" would hide the orphan on
    // the one screen an admin would go to find it.
    renderAt('/studio/pages', {
      pages: [
        page({ id: 'a', slug: 'notes', title: 'Notes', origin: 'user', connectionId: null, connectionName: null }),
        page({ id: 'b', slug: 'orphan', title: 'Orphan', connectionId: 'conn_gone', connectionName: null }),
      ],
    });

    await screen.findByTestId('studio-pages-count');
    expect(
      screen.getAllByTestId('studio-pages-connection').map((chip) => chip.textContent),
    ).toEqual(['Shared', 'Connection']);
  });

  it('carries a stored button label into the field and renames it in the one save', async () => {
    // "New row" is the database framing the template defaults to. On a page an
    // admin has called Invoices it is the last control still talking about
    // rows, and until now there was nowhere to change it — the template had
    // accepted a `labels` prop for a long time, but nothing could store one.
    const { user, calls } = renderAt('/studio/pages/page_1', {
      config: { columns: [], labels: { newRow: 'Add invoice' } },
    });

    await waitFor(() => {
      expect(
        (screen.getByTestId('studio-pages-new-row-label') as HTMLInputElement).value,
      ).toBe('Add invoice');
    });
    const field = screen.getByTestId('studio-pages-new-row-label');

    await user.clear(field);
    await user.type(field, 'New invoice');
    await user.click(screen.getByTestId('studio-pages-save'));

    await waitFor(() => {
      expect(
        calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config')),
      ).toBeDefined();
    });
    const write = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'));
    expect(write?.body).toMatchObject({
      config: { labels: { newRow: 'New invoice' } },
      expectedRevision: 3,
    });
  });

  it('clears the override instead of storing a blank button', async () => {
    // `labels?.newRow ?? t(…)` cannot fall back from a string that is present
    // but empty, so an emptied field has to DELETE the key. Storing `''` would
    // leave a nameless button and no way back to the translated default short
    // of hand-editing the page's JSON.
    const { user, calls } = renderAt('/studio/pages/page_1', {
      config: { columns: [], labels: { newRow: 'Add invoice' } },
    });

    await waitFor(() => {
      expect(
        (screen.getByTestId('studio-pages-new-row-label') as HTMLInputElement).value,
      ).toBe('Add invoice');
    });
    await user.clear(screen.getByTestId('studio-pages-new-row-label'));
    await user.click(screen.getByTestId('studio-pages-save'));

    await waitFor(() => {
      expect(
        calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config')),
      ).toBeDefined();
    });
    const body = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))
      ?.body as { config: Record<string, unknown> };
    // The whole block goes, not just the key — a page with no overrides carries
    // no `labels`, exactly as a freshly generated one does.
    expect(body.config).not.toHaveProperty('labels');
  });

  /*
   * THE FORM DESIGNER (plan 50 phase H).
   *
   * Two claims, and they are the two that decide whether a page keeps
   * following its table: a form nobody really changed must not be STORED, and
   * a form somebody designed must be.
   */
  const FACTS = {
    table: { labelSingular: 'Customer' },
    columns: [
      {
        spec: { name: 'id', logicalType: 'integer', primaryKey: true, hasDefault: true },
        ordinal: 1,
        writable: true,
        filledBy: 'database' as const,
        required: false,
      },
      {
        spec: { name: 'name', logicalType: 'varchar' },
        ordinal: 2,
        writable: true,
        filledBy: null,
        required: true,
      },
      {
        spec: { name: 'email', logicalType: 'varchar' },
        ordinal: 3,
        writable: true,
        filledBy: null,
        required: false,
      },
    ],
  };

  it('stores the form only once it says something the generated one does not', async () => {
    const { user, calls } = renderAt('/studio/pages/page_1', {
      config: { columns: [] },
      columnFacts: FACTS,
    });

    // The designer opens on the DERIVED form — what the dialog already draws —
    // rather than on an empty canvas somebody has to rebuild.
    const rows = await screen.findAllByTestId('form-field-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('name');

    await user.click(screen.getAllByTestId('form-field-down')[0] as HTMLElement);
    await user.click(screen.getByTestId('studio-pages-save'));

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))).toBeDefined();
    });
    const body = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))
      ?.body as { config: { form?: { sections: { fields: { column?: string }[] }[] } } };
    expect(body.config.form?.sections[0]?.fields.map((field) => field.column)).toEqual(['email', 'name']);
  });

  it('deletes the stored form when the draft goes back to the generated one', async () => {
    const stored = {
      v: 2,
      preset: 'sectioned',
      sections: [
        {
          id: 'main',
          columns: 2,
          fields: [
            { column: 'email', control: 'email' },
            { column: 'name', control: 'text', required: true },
          ],
        },
      ],
    };
    const { user, calls } = renderAt('/studio/pages/page_1', {
      config: { columns: [], form: stored },
      columnFacts: FACTS,
    });

    await screen.findAllByTestId('form-field-row');
    await user.click(screen.getByTestId('form-reset'));
    await user.click(screen.getByTestId('studio-pages-save'));

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))).toBeDefined();
    });
    const body = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))
      ?.body as { config: Record<string, unknown> };
    /*
     * The block is REMOVED, not stored as today's derivation: a frozen copy
     * stops following the table the day a column is added, which is the whole
     * reason the form is derived in the first place.
     */
    expect(body.config).not.toHaveProperty('form');
  });

  it('offers a column the form does not name, and adds it back', async () => {
    const stored = {
      v: 2,
      preset: 'sectioned',
      sections: [
        {
          id: 'main',
          label: 'Contact',
          columns: 2,
          fields: [{ column: 'name', control: 'text', required: true }],
        },
      ],
    };
    const { user, calls } = renderAt('/studio/pages/page_1', {
      config: { columns: [], form: stored },
      columnFacts: FACTS,
    });

    // F17: a designed form is a snapshot and the table moves.
    const add = await screen.findByTestId('form-missing-add');
    expect(add.textContent).toContain('email');
    await user.click(add);
    await user.click(screen.getByTestId('studio-pages-save'));

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))).toBeDefined();
    });
    const body = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))
      ?.body as { config: { form?: { sections: { fields: { column?: string }[] }[] } } };
    expect(body.config.form?.sections[0]?.fields.map((field) => field.column)).toEqual(['name', 'email']);
  });

  it('locks the label field while a retemplate is pending', async () => {
    // Saving a template change RECOMPOSES the body. A label written in the same
    // save would be rebuilt away by the PATCH that follows it, so the field
    // closes exactly as the Columns card does.
    const { user } = renderAt('/studio/pages/page_1', {
      config: { columns: [], labels: { newRow: 'Add invoice' } },
    });

    await waitFor(() => {
      expect(
        (screen.getByTestId('studio-pages-new-row-label') as HTMLInputElement).disabled,
      ).toBe(false);
    });
    // Rebinding the table, not the template: switching template away from
    // page-crud removes the field outright (the next test), so the gate that
    // needs pinning is the one that fires while it is still on screen.
    await user.selectOptions(screen.getByTestId('studio-pages-table'), 'public.invoices');
    expect(
      (screen.getByTestId('studio-pages-new-row-label') as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it('leaves the label field off a template that has no such button', async () => {
    renderAt('/studio/pages/page_1', {
      pages: [page({ type: 'page-dashboard' })],
      config: { layout: { v: 1, cols: 12, items: [] } },
    });
    await screen.findByTestId('studio-pages-template');
    expect(screen.queryByTestId('studio-pages-new-row-label')).toBeNull();
  });

  // --- attachments ----------------------

  /**
   * SIDECAR attachments — files linked on Adminium's side, needing no column
   * in the customer's table.
   *
   * After this is the FALLBACK mode, reached only when the connection's
   * schema cannot be authored, so every test below says so explicitly. The
   * behaviour itself is unchanged from 37: what a stored block puts on the
   * wire, and what turning the switch off leaves behind.
   */
  it('leaves the attachments card off a page with no records to attach to', async () => {
    // A dashboard page has no rows, so the block it would write is one the
    // record route can never read. Same reasoning as the Columns card.
    renderAt('/studio/pages/page_1', {
      pages: [page({ type: 'page-dashboard' })],
      config: { layout: { v: 1, cols: 12, items: [] } },
    });
    await screen.findByTestId('studio-pages-template');
    expect(screen.queryByTestId('studio-pages-attachments-enabled')).toBeNull();
  });

  it('writes config.attachments when the switch is turned on', async () => {
    const { user, calls } = renderAt('/studio/pages/page_1', {
      config: { columns: [] },
      schemaAuthoring: { authorable: false, reason: 'READ_ONLY_ROLE' as const },
    });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    await user.click(screen.getByTestId('studio-pages-save'));

    await waitFor(() => {
      expect(
        calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config')),
      ).toBeDefined();
    });
    const body = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))
      ?.body as { config: Record<string, unknown> };
    // Only `enabled` — the rest of the block is absent, which is how "follow
    // the workspace" is spelled. A key present with `undefined` would not
    // survive the JSON round-trip anyway.
    expect(body.config['attachments']).toEqual({ enabled: true });
  });

  it('carries the destination, accepted types and caps onto the wire', async () => {
    const { user, calls } = renderAt('/studio/pages/page_1', {
      config: { columns: [] },
      schemaAuthoring: { authorable: false, reason: 'READ_ONLY_ROLE' as const },
      destinations: [
        { id: 'dst_1', name: 'Product photos', isDefault: false, disabled: false },
        // Disabled destinations are not offered; naming one would store a
        // block whose uploads the server refuses.
        { id: 'dst_off', name: 'Retired bucket', isDefault: false, disabled: true },
      ],
    });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    const picker = (await screen.findByTestId(
      'studio-pages-attachments-destination',
    )) as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(['', 'local', 'dst_1']);

    await user.selectOptions(picker, 'dst_1');
    await user.click(within(screen.getByTestId('studio-pages-attachments-accept')).getByText('PDF'));
    await user.type(screen.getByTestId('studio-pages-attachments-max-bytes'), '5');
    await user.type(screen.getByTestId('studio-pages-attachments-max-count'), '3');
    await user.click(screen.getByTestId('studio-pages-save'));

    await waitFor(() => {
      expect(
        calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config')),
      ).toBeDefined();
    });
    const body = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))
      ?.body as { config: Record<string, unknown> };
    expect(body.config['attachments']).toEqual({
      enabled: true,
      destinationId: 'dst_1',
      accept: ['pdf'],
      // Typed in megabytes, stored in bytes — the unit the schema and the
      // upload route both speak.
      maxBytes: 5 * 1024 * 1024,
      maxCount: 3,
    });
  });

  it('leaves no attachments block behind when the switch goes back off', async () => {
    // The byte-identity case: a page that never carried the block must not
    // GAIN a disabled one just because somebody looked at the switch. The
    // label edit is only there to make the save happen at all.
    const { user, calls } = renderAt('/studio/pages/page_1', {
      config: { columns: [] },
      schemaAuthoring: { authorable: false, reason: 'READ_ONLY_ROLE' as const },
    });

    const toggle = await screen.findByTestId('studio-pages-attachments-enabled');
    await user.click(toggle);
    expect(screen.getByTestId('studio-pages-attachments-max-count')).toBeTruthy();
    await user.click(toggle);
    expect(screen.queryByTestId('studio-pages-attachments-max-count')).toBeNull();

    await user.type(screen.getByTestId('studio-pages-new-row-label'), 'New invoice');
    await user.click(screen.getByTestId('studio-pages-save'));

    await waitFor(() => {
      expect(
        calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config')),
      ).toBeDefined();
    });
    const body = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))
      ?.body as { config: Record<string, unknown> };
    expect(body.config).not.toHaveProperty('attachments');
  });

  it('keeps a configured block when an operator switches it off', async () => {
    // The other spelling of off, and the reason there are two: a page that HAS
    // been configured keeps its destination and caps through the switch, so
    // turning the panel back on does not mean setting it all up again.
    const { user, calls } = renderAt('/studio/pages/page_1', {
      config: { columns: [], attachments: { enabled: true, maxCount: 3 } },
    });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    await user.click(screen.getByTestId('studio-pages-save'));

    await waitFor(() => {
      expect(
        calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config')),
      ).toBeDefined();
    });
    const body = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))
      ?.body as { config: Record<string, unknown> };
    expect(body.config['attachments']).toEqual({ enabled: false, maxCount: 3 });
  });

  it('still offers the card when the destination list is refused', async () => {
    // `storage.manage` is a different grant from `pages.manage`. A
    // 403 there means the picker cannot be drawn — it must not mean the card
    // fails, because every attachment would follow the workspace default
    // regardless.
    const { user } = renderAt('/studio/pages/page_1', {
      config: { columns: [] },
      schemaAuthoring: { authorable: false, reason: 'READ_ONLY_ROLE' as const },
    });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    expect(screen.getByTestId('studio-pages-attachments-accept')).toBeTruthy();
    expect(screen.queryByTestId('studio-pages-attachments-destination')).toBeNull();
    expect(screen.queryByTestId('studio-pages-save-error')).toBeNull();
  });

  // --- attachments in COLUMN mode -------------------

  /**
   * The owner's model: turning attachments on adds a column to the customer's
   * own table, so the files appear in the New and Edit dialogs and not only on
   * the record page.
   *
   * The connection's `schemaAuthoring` is what selects this mode, and the stub
   * omits the field by default — which is `authorable`, matching both the
   * server's answer and the tolerance an older server gets.
   */
  it('asks for a column name instead of writing a block the moment the switch goes on', async () => {
    const { user, calls } = renderAt('/studio/pages/page_1', { config: { columns: [] } });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    expect(screen.getByTestId('studio-pages-attachments-setup')).toBeTruthy();
    // Nothing is planned until the operator asks for it.
    expect(calls.some((call) => call.path.endsWith('/schema/plan'))).toBe(false);
    // And the caps fields are not offered yet: there is no block to configure.
    expect(screen.queryByTestId('studio-pages-attachments-max-count')).toBeNull();
  });

  it('plans exactly one added text column — addColumns, never upsertTables', async () => {
    const { user, calls } = renderAt('/studio/pages/page_1', { config: { columns: [] } });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    await user.click(screen.getByTestId('studio-pages-attachments-column-go'));

    await waitFor(() => {
      expect(calls.find((call) => call.path.endsWith('/schema/plan'))).toBeDefined();
    });
    const plan = calls.find((call) => call.path.endsWith('/schema/plan'))?.body as {
      addColumns: { table: string; column: Record<string, unknown> }[];
      upsertTables: unknown[];
    };
    expect(plan.upsertTables).toEqual([]);
    expect(plan.addColumns).toHaveLength(1);
    expect(plan.addColumns[0]?.table).toBe('public.customers');
    // Nullable text with no default: a NOT NULL add is refused by name on a
    // table that already has rows, and a record simply has no attachments
    // until it has some.
    expect(plan.addColumns[0]?.column).toMatchObject({
      name: 'attachments',
      logicalType: 'text',
      nullable: true,
      default: null,
    });
  });

  it('shows the exact statement before running it, and runs it only on confirm', async () => {
    const { user, calls } = renderAt('/studio/pages/page_1', { config: { columns: [] } });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    await user.click(screen.getByTestId('studio-pages-attachments-column-go'));

    // D2: the SQL the operator authorises is the SQL that runs, so it is on
    // screen before anything is applied.
    expect(await screen.findByTestId('studio-pages-attachments-plan')).toBeTruthy();
    expect(screen.getByText(/add column "attachments" text/)).toBeTruthy();
    expect(calls.some((call) => call.path.endsWith('/schema/apply'))).toBe(false);

    await user.click(screen.getByTestId('studio-pages-attachments-column-confirm'));
    await waitFor(() => {
      expect(calls.find((call) => call.path.endsWith('/schema/apply'))).toBeDefined();
    });
    // The checksum from the plan, so a shape that moved in between is refused
    // rather than applied.
    expect((calls.find((call) => call.path.endsWith('/schema/apply'))?.body as { checksum: string }).checksum).toBe(
      'sum_1',
    );
  });

  it('writes the pointer and the column block AFTER the apply, in one save', async () => {
    const { user, calls } = renderAt('/studio/pages/page_1', { config: { columns: [] } });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    await user.click(screen.getByTestId('studio-pages-attachments-column-go'));
    await user.click(await screen.findByTestId('studio-pages-attachments-column-confirm'));
    await screen.findByTestId('studio-pages-attachments-bound');
    await user.click(screen.getByTestId('studio-pages-save'));

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))).toBeDefined();
    });
    // D6's ordering: the column exists before the page names it.
    const applyAt = calls.findIndex((call) => call.path.endsWith('/schema/apply'));
    const saveAt = calls.findIndex((call) => call.method === 'PATCH' && call.path.endsWith('/config'));
    expect(applyAt).toBeGreaterThanOrEqual(0);
    expect(saveAt).toBeGreaterThan(applyAt);

    const body = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))?.body as {
      config: Record<string, unknown>;
    };
    expect(body.config['attachments']).toEqual({ enabled: true, column: 'attachments' });
    // Both halves, in one document: the pointer above and the column's own
    // block, which is what the server's reconcile hook actually reads.
    // A `label` is not decoration: `gridColumnSpecSchema` requires one, and a
    // spec without it is DROPPED on the next read rather than refused on the
    // write — it would save cleanly and simply be gone.
    expect(body.config['columns']).toEqual([
      { name: 'attachments', label: 'Attachments', logicalType: 'text', file: { ref: 'id', multiple: true } },
    ]);
    // The PROPERTY behind that literal, so a future edit to the spec cannot
    // reintroduce the same silent loss with a different missing field.
    expect(
      gridColumnSpecSchema.safeParse((body.config['columns'] as unknown[])[0]).success,
    ).toBe(true);
  });

  it('adopts a column that already exists rather than planning DDL for it', async () => {
    const { user, calls } = renderAt('/studio/pages/page_1', { config: { columns: [] } });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    const name = screen.getByTestId('studio-pages-attachments-column-name');
    await user.clear(name);
    // `name` is a real text column on the stub's customers table.
    await user.type(name, 'name');
    await user.click(screen.getByTestId('studio-pages-attachments-column-go'));

    await screen.findByTestId('studio-pages-attachments-bound');
    // Nothing to run: the column is there and can hold a reference.
    expect(calls.some((call) => call.path.endsWith('/schema/plan'))).toBe(false);
    expect(calls.some((call) => call.path.endsWith('/schema/apply'))).toBe(false);
  });

  it('refuses a name the database cannot take, before any round trip', async () => {
    const { user, calls } = renderAt('/studio/pages/page_1', { config: { columns: [] } });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    const name = screen.getByTestId('studio-pages-attachments-column-name');
    await user.clear(name);
    await user.type(name, 'Attachments!');
    expect(screen.getByTestId('studio-pages-attachments-column-go').hasAttribute('disabled')).toBe(true);

    // An existing column of the wrong type is refused too, and says why.
    await user.clear(name);
    await user.type(name, 'id');
    expect(screen.getByText(/cannot hold a file reference/i)).toBeTruthy();
    expect(calls.some((call) => call.path.endsWith('/schema/plan'))).toBe(false);
  });

  it('surfaces the server’s refusal and writes nothing when the plan is denied', async () => {
    // The card cannot know whether THIS operator holds `schema.ddl` — the
    // dashboard is told a connection's authorability, never a person's grants
    // — so the plan call is how that question gets asked.
    const { user, calls } = renderAt('/studio/pages/page_1', {
      config: { columns: [] },
      planReply: () =>
        jsonResponse(403, {
          error: {
            code: 'FORBIDDEN',
            message: 'You need schema.ddl to change this connection’s schema.',
            requestId: 'req_1',
          },
        }),
    });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    await user.click(screen.getByTestId('studio-pages-attachments-column-go'));

    expect((await screen.findByTestId('studio-pages-attachments-error')).textContent).toContain('schema.ddl');
    expect(calls.some((call) => call.path.endsWith('/schema/apply'))).toBe(false);
    // And crucially: nothing bound, so a save cannot write a page that claims
    // attachments and names no column.
    expect(screen.queryByTestId('studio-pages-attachments-bound')).toBeNull();
  });

  it('explains the sidecar rather than offering a column on an unauthorable source', async () => {
    const { user } = renderAt('/studio/pages/page_1', {
      config: { columns: [] },
      schemaAuthoring: { authorable: false, reason: 'NO_LIVE_DATABASE' as const },
    });

    await user.click(await screen.findByTestId('studio-pages-attachments-enabled'));
    expect(screen.queryByTestId('studio-pages-attachments-setup')).toBeNull();
    // The server's own reason, rendered — not a disabled control with no
    // explanation beside it.
    expect(screen.getByText(/created from a schema file/i)).toBeTruthy();
    expect(screen.getByTestId('studio-pages-attachments-accept')).toBeTruthy();
  });

  it('unbinds on OFF and never plans a drop', async () => {
    const { user, calls } = renderAt('/studio/pages/page_1', {
      config: {
        columns: [
          { name: 'attachments', label: 'Attachments', logicalType: 'text', file: { ref: 'id', multiple: true } },
        ],
        attachments: { enabled: true, column: 'attachments' },
      },
    });

    const toggle = await screen.findByTestId('studio-pages-attachments-enabled');
    await user.click(toggle);
    await user.click(screen.getByTestId('studio-pages-save'));

    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))).toBeDefined();
    });
    const body = calls.find((call) => call.method === 'PATCH' && call.path.endsWith('/config'))?.body as {
      config: Record<string, unknown>;
    };
    // D7: the pointer goes, the column's `file` block goes — that block is
    // what the reconcile hook reads, and leaving it would keep attaching and
    // trashing files for a page that no longer offers them.
    expect(body.config['attachments']).toEqual({ enabled: false });
    expect(body.config['columns']).toEqual([
      { name: 'attachments', label: 'Attachments', logicalType: 'text' },
    ]);
    // The COLUMN itself is untouched. Dropping one is the step Adminium
    // cannot take back.
    expect(calls.some((call) => call.path.endsWith('/schema/apply'))).toBe(false);
  });
});

describe('StudioPagesPage on a server that runs a project folder', () => {
  beforeAll(installTestI18n);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pages = [
    page({ id: 'page_orders', slug: 'orders', title: 'Orders' }),
    page({ id: 'page_customers', slug: 'customers', title: 'Customers' }),
    page({ id: 'page_extra', slug: 'extra', title: 'Extra', origin: 'user' }),
  ];
  const status: ProjectStatusDto = {
    mode: 'server',
    entries: [
      { path: 'pages/orders.json', kind: 'page', name: 'orders', pageId: 'page_orders', status: 'changed-on-server', serverEditedAt: 1 },
      { path: 'pages/customers.json', kind: 'page', name: 'customers', pageId: 'page_customers', status: 'conflict', serverEditedAt: 2 },
      { path: 'pages/extra.json', kind: 'page', name: 'extra', pageId: 'page_extra', status: 'not-in-project', serverEditedAt: null },
    ],
    outside: [{ pageId: 'page_other', slug: 'other', connectionId: 'conn_2', reason: 'its database is not in adminium.config.ts' }],
  };

  it('says what changed here, how to pull it, and flags each page', async () => {
    renderAt('/studio/pages', { pages, projectStatus: status });
    const changed = await screen.findByTestId('studio-pages-project-changed');
    expect(changed.textContent).toContain('1 page was changed on this server');
    expect(within(changed).getByTestId('studio-pages-pull-command').textContent).toBe(
      `npm run pull -- --from ${window.location.origin}`,
    );
    const outside = screen.getByTestId('studio-pages-project-outside');
    expect(outside.textContent).toContain('2 pages are not in the project');
    expect(outside.textContent).toContain('Add it to adminium.config.ts');
    const flags = screen.getAllByTestId('studio-pages-project-flag').map((badge) => badge.textContent);
    expect(flags).toEqual(['Changed on server', 'Conflict', 'Not in project']);
  });

  it('settles a conflict with the button the admin picks', async () => {
    const { user, calls } = renderAt('/studio/pages', { pages, projectStatus: status });
    const conflicts = await screen.findByTestId('studio-pages-project-conflicts');
    expect(conflicts.textContent).toContain('Customers');
    await user.click(within(conflicts).getByRole('button', { name: 'Use project copy' }));
    await waitFor(() => {
      expect(calls.filter((call) => call.path === '/api/v1/project/resolve')).toEqual([
        { method: 'POST', path: '/api/v1/project/resolve', body: { path: 'pages/customers.json', keep: 'project' } },
      ]);
    });
  });

  it('in dev lists only files it could not apply, with no pull command', async () => {
    renderAt('/studio/pages', {
      pages,
      projectStatus: {
        mode: 'dev',
        entries: [{ path: 'pages/orders.json', kind: 'page', name: 'orders', pageId: 'page_orders', status: 'invalid', serverEditedAt: null, problems: ['title.fallback: Too small'] }],
        outside: [],
      },
    });
    const invalid = await screen.findByTestId('studio-pages-project-invalid');
    expect(invalid.textContent).toContain('pages/orders.json: title.fallback: Too small');
    expect(screen.queryByTestId('studio-pages-pull-command')).toBeNull();
    expect(screen.queryByTestId('studio-pages-project-flag')).toBeNull();
  });

  it('shows nothing about projects on a server that runs none', async () => {
    renderAt('/studio/pages', { pages });
    await screen.findByText('Orders');
    expect(screen.queryByTestId('studio-pages-project')).toBeNull();
  });
});
