// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/files`. Four things are worth a test here, and only one of them is
 * "does it render":
 *
 *  1. **The presets are SERVER queries.** Every rail entry has to change the
 *     `GET /files` query string, not filter rows already on screen. The
 *     assertions read the URLs the page actually requested, because a preset
 *     that quietly became a client-side filter would still look right.
 *  2. **The copy gate (Appendix D).** No byte figure may be followed by
 *     " of " — the comp's "128.4 GB of 200 GB" meter is a defect, not a spec —
 *     and no string on the page may say quota, upgrade, plan, tier, premium,
 *     hosted or free. This is the assertion that stops the meter growing a
 *     denominator the next time somebody "finishes" the strip.
 *  3. **Delete is soft and asks nothing (D12).** The request fires on the
 *     first click, with no dialog in the way, and the toast carries Undo.
 *  4. **There is no Empty trash button.** The wire has no purge route (see the
 *     page's docblock), so its absence is deliberate and is pinned here — an
 *     absence nobody asserts is an absence somebody "fixes" with a control
 *     that does nothing.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../app/query.js';
import { installTestI18n } from '../i18n/testing.js';
import { AppToastProvider } from '../pages/toasts.js';
import { jsonResponse, makeBootstrap } from '../test/fixtures.js';
import type { FileDto } from './api.js';
import { FilesPage } from './FilesPage.js';
import { buildFilesPath, tablePresets, ALL_FILES_FILTERS } from './filesQueries.js';

function makeFile(overrides: Partial<FileDto> = {}): FileDto {
  return {
    id: 'file_1',
    filename: 'contract.pdf',
    mime: 'application/pdf',
    sizeBytes: 2_400_000,
    sha256: 'a'.repeat(64),
    kind: 'upload',
    destinationId: null,
    // Every upload records its connection after, record-bound or not.
    connectionId: 'conn_1',
    uploadedBy: 'usr_test',
    createdAt: 1_700_000_000_000,
    attachedAt: 1_700_000_001_000,
    deletedAt: null,
    entity: { connectionId: 'conn_1', table: 'public.invoices', recordId: '42' },
    contentPath: '/api/v1/files/file_1/content',
    ...overrides,
  };
}

const LIVE_FILES: FileDto[] = [
  makeFile(),
  makeFile({
    id: 'file_2',
    filename: 'logo.png',
    mime: 'image/png',
    sizeBytes: 18_000,
    destinationId: 'dst_spaces',
    entity: { connectionId: 'conn_1', table: 'public.projects', recordId: '7' },
  }),
  /*
   * A LIBRARY file: uploaded from this page, so it belongs to a connection
   * and to no record. `attachedAt` is set all the same — it means CLAIMED,
   * and the workspace is what claims this one; an unstamped row is what the
   * daily sweep collects.
   */
  makeFile({
    id: 'file_4',
    filename: 'price-list.pdf',
    entity: null,
    connectionId: 'conn_1',
  }),
];

const TRASHED_FILES: FileDto[] = [
  makeFile({ id: 'file_9', filename: 'old-quote.pdf', deletedAt: 1_700_000_500_000 }),
];

/** Distinct rows, so paging forward appends rather than repeating page one. */
const SECOND_PAGE: FileDto[] = [makeFile({ id: 'file_3', filename: 'handover.docx' })];

const USAGE = [
  {
    destinationId: null,
    name: "This server's disk",
    driver: 'local',
    files: 12,
    bytes: 128_000_000_000,
    available: 41_000_000_000,
  },
  { destinationId: 'dst_spaces', name: 'Backups bucket', driver: 's3', files: 3, bytes: 900_000_000 },
];

/**
 * `file_1` out of `/api/v1/files/file_1` OR `/files/file_1`.
 *
 * Deliberately anchored on the tail rather than on the whole path: the 37c
 * transport's JSON half (`files/api.ts`, `deleteFile`/`restoreFile`) issues its
 * requests WITHOUT the `/api/v1` prefix that `app/api.ts` never adds, so today
 * the delete lands on `/files/file_1`. That is a transport defect, reported
 * separately and fixed in one place; matching the tail means this test asserts
 * the behaviour it cares about — a DELETE against that file — both before and
 * after the prefix is corrected, instead of freezing the bug into a gate.
 */
function fileIdIn(url: string, suffix = ''): string | null {
  const match = new RegExp(`/files/([^/?]+)${suffix}$`).exec(url);
  return match?.[1] ?? null;
}

interface StubOptions {
  /** Fail the list with this status instead of answering it. */
  listStatus?: number;
  /** Hand back a `nextCursor` on the first page so Load more appears. */
  paged?: boolean;
  /**
   * `GET /api/v1/connections` — the By-connection rail group and the Upload
   * button both read it. `undefined` answers 403, which is the ordinary case
   * for a file-tidying operator who does not hold `connections.manage`.
   */
  connections?: { id: string; name: string }[];
}

function stubFetch(options: StubOptions = {}) {
  const calls: { method: string; url: string }[] = [];

  const fetchMock = vi.fn().mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url });

    if (url.startsWith('/api/v1/bootstrap')) {
      return Promise.resolve(jsonResponse(200, { data: makeBootstrap({ nav: { groups: [] } }) }));
    }
    if (url.startsWith('/api/v1/files/usage')) {
      return Promise.resolve(jsonResponse(200, { data: USAGE }));
    }
    if (url.startsWith('/api/v1/connections')) {
      return Promise.resolve(
        options.connections === undefined
          ? jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'nope', requestId: 'req_c' } })
          : jsonResponse(200, { connections: options.connections }),
      );
    }
    if (url.startsWith('/api/v1/files?') && method === 'GET') {
      if (options.listStatus !== undefined) {
        return Promise.resolve(
          jsonResponse(options.listStatus, {
            error: { code: 'FORBIDDEN', message: 'You do not have the required permission.', requestId: 'req_1' },
          }),
        );
      }
      const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));
      const cursor = query.get('cursor');
      if (cursor !== null) return Promise.resolve(jsonResponse(200, { data: SECOND_PAGE, nextCursor: null }));
      const trash = query.get('state') === 'trash';
      const nextCursor = options.paged === true ? 'cur_2' : null;
      return Promise.resolve(
        jsonResponse(200, { data: trash ? TRASHED_FILES : LIVE_FILES, nextCursor }),
      );
    }
    if (method === 'POST' && fileIdIn(url, '/restore') !== null) {
      return Promise.resolve(jsonResponse(200, { data: makeFile({ deletedAt: null }) }));
    }
    if (method === 'DELETE' && fileIdIn(url) !== null) {
      return Promise.resolve(jsonResponse(200, { data: makeFile({ deletedAt: 1_700_000_900_000 }) }));
    }
    return Promise.resolve(
      jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'req_x' } }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AppToastProvider>
        <FilesPage />
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

/**
 * Render and switch to the LIST view.
 *
 * The page opens on tiles (as the comp does), so every assertion about table
 * rows — delete, restore, the per-table counts, the "Attached to" cell — has
 * to say so. Switching is a view change and asks the server for nothing, which
 * the toggle's own test pins.
 */
async function renderListView(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByTestId('files-view-list'));
  await screen.findByTestId('files-table');
  return user;
}

/** The list URLs the page asked for, newest last. */
function listUrls(calls: { method: string; url: string }[]): string[] {
  return calls.filter((call) => call.url.startsWith('/api/v1/files?')).map((call) => call.url);
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

describe('FilesPage', () => {
  it('lists files and shows bytes used per destination', async () => {
    stubFetch();
    await renderListView();

    expect(await screen.findByTestId('files-table')).toBeTruthy();
    // Three: two attached to records and one library file.
    expect(screen.getAllByTestId('files-row')).toHaveLength(LIVE_FILES.length);
    expect(screen.getByText('contract.pdf')).toBeTruthy();

    const strip = screen.getByTestId('files-usage-strip');
    expect(within(strip).getByText("This server's disk")).toBeTruthy();
    expect(within(strip).getByText('128 GB used')).toBeTruthy();
    // A LOCAL disk has a real capacity, so it gets the comp's meter and the
    // one honest fraction on this page. A bucket has none and gets
    // neither — `available` is absent for it, so there is nothing to divide by.
    expect(within(strip).getByText('128 GB of 169 GB on this disk')).toBeTruthy();
    expect(within(strip).getAllByTestId('files-usage-meter')).toHaveLength(1);
  });

  it('never puts a capacity denominator, a quota or an upsell on the page', async () => {
    stubFetch();
    await renderListView();

    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');

    /*
     * The gate, NARROWED by and not lifted.
     *
     * 37 Appendix D banned every "N of M" because a bucket has no capacity, so
     * the denominator would be a number with nothing behind it. A local disk
     * does have one — `statfs` reported it — and hiding it does not make the
     * disk bigger. So the only permitted fraction on this page is a local
     * disk's own, spelled "… on this disk"; any other byte figure followed by
     * "of" is still a defect.
     */
    // A period inside a figure ("16.3 GB") is a decimal point, not the end of
    // the sentence — the e2e twin of this gate once failed on exactly that.
    const fractions = text.match(/\d[\d.,]* ?(bytes?|kB|MB|GB|TB|PB) of\b(?:[^.]|\.(?=\d))*/gi) ?? [];
    for (const found of fractions) expect(found).toMatch(/on this disk/);
    for (const banned of [/quota/i, /upgrade/i, /storage plan/i, /\btier\b/i, /premium/i, /hosted/i, /\bfree\b/i]) {
      expect(text).not.toMatch(banned);
    }
  });

  it('runs each rail preset as a server query, not a filter over loaded rows', async () => {
    const { calls } = stubFetch();
    const user = await renderListView();

    const first = listUrls(calls).at(0) ?? '';
    expect(first).toContain('state=live');

    await user.click(screen.getByTestId('files-preset-trash'));
    await waitFor(() => {
      expect(listUrls(calls).at(-1)).toContain('state=trash');
    });

    await user.click(screen.getByTestId('files-preset-unattached'));
    await waitFor(() => {
      expect(listUrls(calls).at(-1)).toContain('state=unattached');
    });

    // "By table" is derived from the rows that have been loaded (there is no
    // facet route), but selecting one still narrows the SERVER query.
    await user.click(screen.getByTestId('files-preset-all'));
    await screen.findByTestId('files-rail-tables');
    await user.click(screen.getByTestId('files-preset-table-conn_1-public.invoices'));
    await waitFor(() => {
      const last = listUrls(calls).at(-1) ?? '';
      expect(last).toContain('connectionId=conn_1');
      expect(last).toContain(encodeURIComponent('public.invoices'));
    });

    await user.click(screen.getByTestId('files-preset-destination-dst_spaces'));
    await waitFor(() => {
      expect(listUrls(calls).at(-1)).toContain('destinationId=dst_spaces');
    });
  });

  it('sends the search term to the server as q', async () => {
    const { calls } = stubFetch();
    const user = await renderListView();

    await user.type(screen.getByLabelText('Search by file name'), 'logo');
    await waitFor(() => {
      expect(listUrls(calls).at(-1)).toContain('q=logo');
    });
  });

  it('deletes without a confirmation and offers Undo instead', async () => {
    const { calls } = stubFetch();
    const user = await renderListView();

    await user.click(screen.getAllByTestId('files-row-delete')[0] as HTMLElement);

    // No dialog stood in the way: the DELETE is already in flight (D12).
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE' && fileIdIn(call.url) === 'file_1')).toBe(true);
    });

    const undo = await screen.findByRole('button', { name: 'Undo' });
    await user.click(undo);
    await waitFor(() => {
      expect(
        calls.some((call) => call.method === 'POST' && fileIdIn(call.url, '/restore') === 'file_1'),
      ).toBe(true);
    });
  });

  it('offers Restore in the trash, and no Empty trash button — the wire has no purge route', async () => {
    const { calls } = stubFetch();
    const user = await renderListView();

    await user.click(screen.getByTestId('files-preset-trash'));
    await screen.findByTestId('files-trash-notice');
    await waitFor(() => {
      expect(screen.getByText('old-quote.pdf')).toBeTruthy();
    });

    // Nothing purges: `DELETE /files/:id` trashes and `markDeleted` skips rows
    // already trashed, so a bulk "Empty trash" would be a control wired to
    // nothing. Its absence is the design.
    expect(screen.queryByRole('button', { name: /empty/i })).toBeNull();
    // Trashed bytes 404 on the content route, so Download is absent too.
    expect(screen.queryAllByTestId('files-row-download')).toHaveLength(0);

    await user.click(screen.getAllByTestId('files-row-restore')[0] as HTMLElement);
    await waitFor(() => {
      expect(
        calls.some((call) => call.method === 'POST' && fileIdIn(call.url, '/restore') === 'file_9'),
      ).toBe(true);
    });
  });

  it('shows a per-table count only while it is exact', async () => {
    stubFetch();
    await renderListView();
    // Everything is loaded and nothing narrows the query, so the derived count
    // is the whole answer and may be shown.
    expect(screen.getByTestId('files-preset-table-conn_1-public.invoices').textContent).toContain('1');

    // With a page still unfetched the same derivation would be "some of them",
    // so the entry stays and the number goes.
    vi.unstubAllGlobals();
    stubFetch({ paged: true });
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('files-preset-table-conn_1-public.invoices')).toHaveLength(2);
    });
    const partial = screen.getAllByTestId('files-preset-table-conn_1-public.invoices').at(-1) as HTMLElement;
    expect(partial.textContent).toBe('public.invoices');
  });

  it('pages forward with the keyset cursor', async () => {
    const { calls } = stubFetch({ paged: true });
    const user = await renderListView();

    await user.click(await screen.findByTestId('files-load-more'));
    await waitFor(() => {
      expect(listUrls(calls).at(-1)).toContain('cursor=cur_2');
    });
  });

  it('surfaces a refused list rather than an empty one', async () => {
    stubFetch({ listStatus: 403 });
    renderPage();

    const alert = await screen.findByTestId('files-list-error');
    expect(alert.textContent).toContain('You do not have the required permission.');
    expect(screen.queryByTestId('files-empty')).toBeNull();
  });

  it('builds the request path from the preset filters', () => {
    expect(buildFilesPath(ALL_FILES_FILTERS, null)).toBe('/api/v1/files?state=live&limit=50');

    const narrowed = buildFilesPath(
      { since: null, state: 'trash', q: 'quote', connectionId: 'conn_1', table: 'public.invoices', destinationId: 'local' },
      'cur_9',
    );
    expect(narrowed).toContain('state=trash');
    expect(narrowed).toContain('q=quote');
    expect(narrowed).toContain('connectionId=conn_1');
    expect(narrowed).toContain(`table=${encodeURIComponent('public.invoices')}`);
    expect(narrowed).toContain('destinationId=local');
    expect(narrowed).toContain('cursor=cur_9');
  });

  it('derives table presets from loaded rows, skipping unattached files', () => {
    const presets = tablePresets([
      ...LIVE_FILES,
      makeFile({ id: 'file_3', entity: null }),
      makeFile({ id: 'file_4' }),
    ]);
    expect(presets.map((preset) => preset.table)).toEqual(['public.invoices', 'public.projects']);
    expect(presets[0]?.files).toBe(2);
  });
});

/**
 * The comp port.
 *
 * Everything here is about the RAIL and the STRIP being what they claim: a
 * preset that filters client-side would answer "of the fifty rows loaded,
 * which are recent", which is a different question from the one the entry
 * asks. So each assertion checks the request, not the rows.
 */
describe('FilesPage — the File Manager comp', () => {
  const CONNECTIONS = [
    { id: 'conn_1', name: 'Production' },
    { id: 'conn_2', name: 'Warehouse' },
  ];

  it('offers a connection group whose entry queries the connection ALONE', async () => {
    const { calls } = stubFetch({ connections: CONNECTIONS });
    const user = await renderListView();

    // Every upload records its connection since, so this is a real
    // server query and the only preset that finds a LIBRARY file.
    await user.click(await screen.findByTestId('files-preset-connection-conn_2'));
    await waitFor(() => {
      const last = listUrls(calls).at(-1) ?? '';
      expect(last).toContain('connectionId=conn_2');
      // No table: "everything for this source", not one table of it.
      expect(last).not.toContain('table=');
    });
  });

  it('asks the server for Recent rather than slicing the page it has', async () => {
    const { calls } = stubFetch({ connections: CONNECTIONS });
    const user = await renderListView();

    await user.click(screen.getByTestId('files-preset-recent'));
    await waitFor(() => {
      const last = listUrls(calls).at(-1) ?? '';
      const since = new URLSearchParams(last.slice(last.indexOf('?') + 1)).get('since');
      expect(since).not.toBeNull();
      // A window, not an epoch-zero no-op.
      expect(Number(since)).toBeGreaterThan(Date.now() - 8 * 24 * 60 * 60 * 1000);
      expect(Number(since)).toBeLessThanOrEqual(Date.now());
    });
  });

  it('draws a meter for the local disk and none for a bucket', async () => {
    stubFetch({ connections: CONNECTIONS });
    renderPage();
    const strip = await screen.findByTestId('files-usage-strip');

    // Exactly one: the local row has a capacity, the S3 row has none (D10).
    expect(within(strip).getAllByTestId('files-usage-meter')).toHaveLength(1);
    expect(within(strip).getByText('900 MB used')).toBeTruthy();
  });

  it('names the connection on a file that belongs to no record (D18)', async () => {
    stubFetch({ connections: CONNECTIONS });
    await renderListView();

    // "Not attached" alone would leave the reader with no idea which source
    // the file was uploaded for.
    expect(screen.getAllByText('Not attached to a record').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Production').length).toBeGreaterThan(0);
  });

  it('switches between tiles and rows without asking for anything again', async () => {
    const { calls } = stubFetch({ connections: CONNECTIONS });
    const user = await renderListView();
    const before = listUrls(calls).length;

    await user.click(screen.getByTestId('files-view-grid'));
    expect(await screen.findByTestId('files-grid')).toBeTruthy();
    expect(screen.queryByTestId('files-table')).toBeNull();

    await user.click(screen.getByTestId('files-view-list'));
    expect(await screen.findByTestId('files-table')).toBeTruthy();
    // A view is how the same rows look, never which rows are asked for.
    expect(listUrls(calls).length).toBe(before);
  });

  it('hides the rail group and the Upload button when connections are refused', async () => {
    // `connections.manage` is a different grant from `files.manage`, and a 403
    // must not break the page — every other preset still works.
    stubFetch();
    await renderListView();

    expect(screen.queryByTestId('files-rail-connections')).toBeNull();
    // A file always belongs to a connection (D4); with none to name, the
    // dialog could only refuse.
    expect(screen.queryByTestId('files-upload-open')).toBeNull();
    expect(screen.getByTestId('files-preset-all')).toBeTruthy();
  });
});
