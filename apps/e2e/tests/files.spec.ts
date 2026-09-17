// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Files and storage against the built stack.
 *
 * ─── What this file proves, and why it is shaped the way it is ───────────────
 *
 * The server suite already covers the `/files` and `/storage` routes in
 * process (`apps/server/test/files-routes.test.ts` and
 * `files-storage-routes.test.ts`), and the dashboard suite mounts `StoragePage`
 * directly
 * (`studio/storage/storagePage.test.tsx`). Neither of those touches a real
 * socket, a real disk or the built bundle, and the three things this suite
 * exists for are exactly the three they cannot see:
 *
 *  1. **The wildcard body parser survives the real HTTP path.** `POST /files`
 *     registers `addContentTypeParser('*')` and reads `request.body` as a
 *     stream so the size cap fires before the bytes reach the heap. An inject
 *     test hands the handler a `Readable` that tears down cleanly; a socket
 *     does not — that difference is what made an over-size upload hang instead
 *     of answering 413. (Two distinct defects sit behind that: the spool's
 * `stream/promises.pipeline` teardown, defect 1, and the route reading
 *     `request.body` rather than `request.raw`. Only a real request re-proves
 *     either.)
 *  2. **The bytes make the round trip through the local driver.** Upload →
 *     `GET /files/:id/content` → compare buffers, on the built server writing
 *     to a real `<dataDir>/files` root.
 *  3. **`/studio/storage` mounts from the built bundle and is reachable from
 *     the product** — it is a lazily loaded route behind the Studio guard, and
 *     a lazy route fails in ways a direct mount cannot see (the same reason
 *     `data-io.spec.ts` exists).
 *
 * ─── What this file deliberately does NOT test, and why (read before adding) ─
 *
 * The seeded Northwind fixture **has no file column and no sidecar page**, so
 * the headline flow — "New → attach a PDF → Save, the grid shows a chip,
 * clicking downloads the PDF" — cannot be driven here at all:
 *
 *  - Generation seeds a `file` block only onto a grid column spec, and only
 *    for a `file-ref`/`image-url`-tagged TEXT column (`crud-body.ts`). Across
 *    all three engine fixtures the only Northwind column that qualifies is
 *    `employees.photo_path` (`categories.picture` and `employees.photo` are
 *    both binary, which the seeding rule excludes), and it does not survive
 *    `rankColumn`'s cut into `config.columns`. Verified against the seeded
 *    fixture by reading all 15 generated pages back over the API: zero
 *    `columns[].file`, zero `config.attachments`.
 *  - `config.attachments` (the sidecar panel on the record page) is seeded by
 *    nothing at all; it is authored only in Studio's EditPageScreen.
 *
 * Authoring one from a test would mean `PATCH /pages/:pageId/config` on a page
 * the rest of the suite shares — and that write leaves the envelope's embedded
 * `config.generatedHash` stale, which is exactly how `upsertGenerated` decides
 * a human edited a page and skips it (`skippedEdited`). The later
 * `POST /connections/:id/generate` in `llm-enrichment.spec.ts` would then be
 * regenerating a different set than it does today. A spec that quietly
 * re-shapes the fixture for everyone downstream is worse than a smaller honest
 * one, so this file stays out of the stored page config entirely. Closing that
 * gap is a SEED change
 * (a Northwind table with an `invoice_pdf_url`-shaped TEXT column, or a
 * boot-script `PATCH …/config` that turns `attachments` on for one page) and
 * belongs with whoever owns `scripts/e2e-server.mjs`.
 *
 * Also unreachable from here, with the reason each time:
 * - (every driver, same routes) — needs MinIO and a WebDAV stub as
 *  Playwright-visible services; the driver conformance suite is where that
 *  lives, and the s3 leg is `TEST_S3_URL`-gated.
 * - (grants, not globals) — the suite has one seeded super admin; a second,
 *  narrower user would have to be created and would outlive this file.
 *  `files-routes.test.ts` covers the 403 shapes.
 * - retention half and item 9 (Move files) — both are clock- or job-driven
 *  and finish long after a test would.
 * - The Files page's per-preset queries (37e /) — the page and its `/files`
 *  route exist, and the smoke test below visits it; what is out of reach here
 *  is asserting each rail preset's server round trip, which
 *  `filesPage.test.tsx` covers against a stubbed transport.
 *
 * ─── State ───────────────────────────────────────────────────────────────────
 *
 * The suite runs serially against one seeded server, so every row this file
 * creates it also removes: uploads are hard-listed by id and trashed at the
 * end, and the destination round trip deletes its row in a `finally`. The
 * destination it creates is never made default — a default would silently
 * redirect every later export and logo write in the run.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { filesStorageStatePath } from './constants.js';
import { navLink, seededConnectionId, signIn } from './helpers.js';

/*
 * This file runs as its OWN principal. The `api` rate bucket is 300 requests a
 * minute per principal, and these specs are the suite's expensive ones — real
 * uploads, a schema plan and apply, a create dialog. Sharing the default
 * session's budget tipped whole runs over the ceiling, and the 429 surfaced as
 * a rate-limit page in an unrelated spec. See tests/constants.ts.
 */
test.use({ storageState: filesStorageStatePath() });

/**
 * A 69-byte PDF: a real `%PDF-` signature, which is what the sniffing gate
 * reads. Built in code rather than committed as a fixture — the gate only ever
 * looks at the head, so a file on disk would buy nothing and cost a binary in
 * the tree.
 */
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

/** A 1×1 transparent PNG — a real signature, and small enough to inline. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** SVG is on the default allowlist and is the one type that never goes inline. */
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>');

/** Not on the allowlist under any name — the gate reads bytes, not extensions. */
const HTML_BYTES = Buffer.from('<html><body><script>alert(1)</script></body></html>');

interface FileView {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  destinationId: string | null;
  attachedAt: number | null;
  deletedAt: number | null;
  entity: { connectionId: string; table: string; recordId: string } | null;
  contentPath: string;
}

/**
 * The seeded table id, read off the page that is bound to it.
 *
 * NOT hard-coded: the schema prefix is engine-specific (`main.` / `public.` /
 * `adminium_e2e.`), and an upload names the table it belongs to because that
 * is what its grant is checked against. Deriving it from the page keeps this
 * file green on all three legs without a per-engine table of names.
 */
async function sourceTableOf(request: APIRequestContext, slug: string): Promise<string> {
  const list = await request.get('/api/v1/pages');
  expect(list.ok(), `GET /pages → ${list.status()}`).toBe(true);
  const { data } = (await list.json()) as { data: { id: string; slug: string }[] };
  const summary = data.find((p) => p.slug === slug);
  if (summary === undefined) {
    throw new Error(`no seeded page with slug ${slug}; saw ${data.map((p) => p.slug).join(', ')}`);
  }
  const detail = await request.get(`/api/v1/pages/${summary.id}`);
  expect(detail.ok(), `GET /pages/${summary.id} → ${detail.status()}`).toBe(true);
  const body = (await detail.json()) as { data: { source?: { table?: string } } };
  const table = body.data.source?.table;
  if (table === undefined) throw new Error(`page ${summary.id} is not table-bound`);
  return table;
}

/** `POST /files` — the metadata rides the query string, the body IS the file. */
async function upload(
  request: APIRequestContext,
  input: {
    filename: string;
    mime: string;
    body: Buffer;
    connectionId: string;
    table: string;
    /** Names the column's `file` block — the reply then carries the `ref` to store. */
    column?: string;
    /** Attaches on upload; omit for the create-form flow, where no record exists yet. */
    recordId?: string;
  },
) {
  const query = new URLSearchParams({
    filename: input.filename,
    connectionId: input.connectionId,
    table: input.table,
  });
  if (input.column !== undefined) query.set('column', input.column);
  if (input.recordId !== undefined) query.set('recordId', input.recordId);
  return request.post(`/api/v1/files?${query.toString()}`, {
    headers: { 'content-type': input.mime },
    data: input.body,
  });
}

/** Trash every id this file minted, so the next spec sees the fixture it expects. */
async function trash(request: APIRequestContext, ids: readonly string[]): Promise<void> {
  for (const id of ids) await request.delete(`/api/v1/files/${id}`);
}

test.describe('files routes', () => {
  test('an upload round-trips: bytes back out, attach, trash, restore', async ({ page }) => {
    await signIn(page);
    const connectionId = await seededConnectionId(page);
    const table = await sourceTableOf(page.request, 'employees');
    const created: string[] = [];

    try {
      // ── upload ────────────────────────────────────────────────────────────
      const posted = await upload(page.request, {
        filename: 'e2e-receipt.pdf',
        mime: 'application/pdf',
        body: PDF_BYTES,
        connectionId,
        table,
      });
      expect(posted.status(), await posted.text()).toBe(201);
      const { data: file } = (await posted.json()) as { data: FileView };
      created.push(file.id);

      // The MIME on the row is the SNIFFED one, never the client's claim, and
      // `destinationId: null` is the implicit destination — this server's disk
      // , which is what a deployment that configures nothing gets.
      expect(file.mime).toBe('application/pdf');
      expect(file.sizeBytes).toBe(PDF_BYTES.byteLength);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.destinationId).toBeNull();
      expect(file.entity, 'an upload with no recordId is unattached').toBeNull();
      expect(file.contentPath).toBe(`/api/v1/files/${file.id}/content`);

      // ── the bytes come back, and they come back as a download ─────────────
      const content = await page.request.get(file.contentPath);
      expect(content.status()).toBe(200);
      expect(Buffer.compare(await content.body(), PDF_BYTES), 'downloaded bytes').toBe(0);
      const headers = content.headers();
      expect(headers['content-type']).toContain('application/pdf');
      expect(headers['content-disposition']).toContain('attachment');
      expect(headers['content-disposition']).toContain('e2e-receipt.pdf');
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['etag']).toContain(file.sha256);

      // The checksum ETag is what makes a re-render free.
      const revalidated = await page.request.get(file.contentPath, {
        headers: { 'if-none-match': headers['etag'] ?? '' },
      });
      expect(revalidated.status()).toBe(304);

      // ── attach it to a record, then find it by that record ────────────────
      const attached = await page.request.post(`/api/v1/files/${file.id}/attach`, {
        data: { connectionId, table, recordId: '1' },
      });
      expect(attached.status(), await attached.text()).toBe(200);
      const { data: withEntity } = (await attached.json()) as { data: FileView };
      expect(withEntity.attachedAt).not.toBeNull();
      expect(withEntity.entity).toEqual({ connectionId, table, recordId: '1' });

      const byRecord = await page.request.get(
        `/api/v1/files?${new URLSearchParams({ connectionId, table, recordId: '1' }).toString()}`,
      );
      expect(byRecord.ok()).toBe(true);
      const { data: listed } = (await byRecord.json()) as { data: FileView[] };
      expect(listed.map((f) => f.id)).toContain(file.id);

      // ── trash is a round trip, not a delete ───────────────────────────────
      const deleted = await page.request.delete(`/api/v1/files/${file.id}`);
      expect(deleted.status(), await deleted.text()).toBe(200);
      const { data: trashed } = (await deleted.json()) as { data: FileView };
      expect(trashed.deletedAt).not.toBeNull();

      // A trashed file stops serving bytes immediately…
      expect((await page.request.get(file.contentPath)).status()).toBe(404);
      // …but the row is still there, under the Files page's trash preset.
      const inTrash = await page.request.get('/api/v1/files?state=trash');
      expect(inTrash.ok()).toBe(true);
      const { data: trashRows } = (await inTrash.json()) as { data: FileView[] };
      expect(trashRows.map((f) => f.id)).toContain(file.id);

      // …and Undo puts it back, bytes and all.
      const restored = await page.request.post(`/api/v1/files/${file.id}/restore`);
      expect(restored.status(), await restored.text()).toBe(200);
      expect(((await restored.json()) as { data: FileView }).data.deletedAt).toBeNull();
      const again = await page.request.get(file.contentPath);
      expect(again.status()).toBe(200);
      expect(Buffer.compare(await again.body(), PDF_BYTES)).toBe(0);
    } finally {
      await trash(page.request, created);
    }
  });

  test('the gate refuses what it must, and SVG never goes inline', async ({ page }) => {
    await signIn(page);
    const connectionId = await seededConnectionId(page);
    const table = await sourceTableOf(page.request, 'employees');
    const created: string[] = [];

    try {
      // An HTML document is not on the default allowlist under any name, and
      // the refusal names what the bytes actually are — the extension is not
      // consulted at any point.
      const html = await upload(page.request, {
        filename: 'not-really.png',
        mime: 'image/png',
        body: HTML_BYTES,
        connectionId,
        table,
      });
      expect(html.status()).toBe(415);
      const refusal = (await html.json()) as { error: { code: string } };
      expect(refusal.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

      /*
       * An upload belongs to a CONNECTION — and, since, need not belong to a
       * table. "No table, no upload" was the rule and this asserted the 422 it
       * produced; the owner reversed that, so a table-less upload from the
       * Files page is now a library file and the refusal moved to the thing
       * that really is required.
       */
      const noConnection = await page.request.post(
        `/api/v1/files?${new URLSearchParams({ filename: 'x.pdf' }).toString()}`,
        { headers: { 'content-type': 'application/pdf' }, data: PDF_BYTES },
      );
      expect(noConnection.status()).toBe(422);

      // A column names a table; naming one without the other is a request
      // whose reference shape nothing could resolve.
      const columnWithoutTable = await page.request.post(
        `/api/v1/files?${new URLSearchParams({ filename: 'x.pdf', connectionId, column: 'document_url' }).toString()}`,
        { headers: { 'content-type': 'application/pdf' }, data: PDF_BYTES },
      );
      expect(columnWithoutTable.status()).toBe(422);

      // A PNG may be displayed in place — that is what makes the SVG case
      // below a real assertion rather than a vacuous one.
      const png = await upload(page.request, {
        filename: 'e2e-dot.png',
        mime: 'image/png',
        body: PNG_BYTES,
        connectionId,
        table,
      });
      expect(png.status(), await png.text()).toBe(201);
      const pngFile = ((await png.json()) as { data: FileView }).data;
      created.push(pngFile.id);
      const pngInline = await page.request.get(`${pngFile.contentPath}?inline=1`);
      expect(pngInline.headers()['content-disposition']).toContain('inline');

      // An SVG is a script container, so it is a download even when the caller
      // asks for it inline.
      const svg = await upload(page.request, {
        filename: 'e2e-mark.svg',
        mime: 'image/svg+xml',
        body: SVG_BYTES,
        connectionId,
        table,
      });
      expect(svg.status(), await svg.text()).toBe(201);
      const svgFile = ((await svg.json()) as { data: FileView }).data;
      created.push(svgFile.id);
      const svgInline = await page.request.get(`${svgFile.contentPath}?inline=1`);
      expect(svgInline.status()).toBe(200);
      expect(svgInline.headers()['content-disposition']).toContain('attachment');
      expect(svgInline.headers()['content-disposition']).not.toContain('inline');
    } finally {
      await trash(page.request, created);
    }
  });
});

test.describe('a column-bound file — the sentence this feature exists for', () => {
  /**
   * "While creating an invoice, attach a PDF and store the link in the invoices
   * table" — the owner's original ask.
   *
   * It runs against `shippers.document_url`, a column the e2e seed adds
   * (`scripts/e2e-server.mjs`) precisely so this flow has somewhere to happen:
   * stock Northwind has no column the classifier calls a file, so without it
   * the suite could only ever prove the sidecar path.
   *
   * WHY THIS TEST EARNS ITS PLACE. The reconcile hook — the thing that turns a
   * text value in the customer's own column into an ATTACHED file — read the
   * stored page config one level too high and silently did nothing on every
   * real page. Every unit test passed, because they built page fixtures in the
   * shape the reader assumed rather than the shape `pagesRepo` stores. Only a
   * generated page could tell the difference, and this is the only place one
   * exists.
   */
  test('generation seeds the block, and saving the ref attaches the file', async ({ page }) => {
    await signIn(page);
    const connectionId = await seededConnectionId(page);
    const created: string[] = [];

    try {
      // ── the block is SEEDED, not configured by hand ──────────────────────
      const list = await page.request.get('/api/v1/pages');
      const { data: pages } = (await list.json()) as { data: { id: string; slug: string }[] };
      const shippers = pages.find((p) => p.slug === 'shippers');
      expect(shippers, 'the seed generates a shippers page').toBeDefined();

      const detail = await page.request.get(`/api/v1/pages/${String(shippers?.id)}`);
      const envelope = (await detail.json()) as {
        data: { source?: { table?: string }; config?: { columns?: { name: string; file?: unknown }[] } };
      };
      const table = envelope.data.source?.table ?? '';
      const column = envelope.data.config?.columns?.find((c) => c.name === 'document_url');
      // D14: the block is what turns the column into a file field, and
      // generation puts it there for a `file-ref`-tagged text column on a NEW
      // page. A column with no block renders exactly as it did before 37.
      expect(column?.file, 'generation seeds a file block on document_url').toEqual({ ref: 'url' });

      // ── upload against that column ───────────────────────────────────────
      const posted = await upload(page.request, {
        filename: 'e2e-contract.pdf',
        mime: 'application/pdf',
        body: PDF_BYTES,
        connectionId,
        table,
        column: 'document_url',
      });
      expect(posted.status(), await posted.text()).toBe(201);
      const uploaded = (await posted.json()) as { data: FileView; ref?: string };
      created.push(uploaded.data.id);

      // The SERVER mints the reference, in the shape the column is configured
      // for (D31: `url`). The browser never composes one.
      expect(uploaded.ref, 'a column upload carries the ref to store').toBeDefined();
      expect(uploaded.ref).toContain(`/api/v1/files/${uploaded.data.id}/content`);
      expect(uploaded.data.entity, 'not attached until the record names it').toBeNull();

      // ── save it into the customer's own column, as the form does ─────────
      const saved = await page.request.patch(
        `/api/v1/data/${connectionId}/${table}/1`,
        { data: { values: { document_url: uploaded.ref } } },
      );
      expect(saved.status(), await saved.text()).toBe(200);
      const row = (await saved.json()) as { data: Record<string, unknown> };
      expect(row.data['document_url'], 'the row carries the reference itself').toBe(uploaded.ref);

      // ── and THAT is what attaches it ─────────────────────────────────────
      const after = await page.request.get(`/api/v1/files/${uploaded.data.id}`);
      const { data: attached } = (await after.json()) as { data: FileView };
      expect(attached.attachedAt, 'the reconcile hook attached it on the write').not.toBeNull();
      expect(attached.entity).toEqual({ connectionId, table, recordId: '1' });

      // ── replacing the value trashes what it used to name (D12) ───────────
      const second = await upload(page.request, {
        filename: 'e2e-contract-v2.pdf',
        mime: 'application/pdf',
        body: PDF_BYTES,
        connectionId,
        table,
        column: 'document_url',
      });
      const replacement = (await second.json()) as { data: FileView; ref?: string };
      created.push(replacement.data.id);
      await page.request.patch(`/api/v1/data/${connectionId}/${table}/1`, {
        data: { values: { document_url: replacement.ref } },
      });

      const previous = await page.request.get(`/api/v1/files/${uploaded.data.id}`);
      const { data: superseded } = (await previous.json()) as { data: FileView };
      // Trash, never delete: the bytes belong to the retention sweep, and the
      // row stays addressable so it can be restored.
      expect(superseded.deletedAt, 'the replaced file went to the trash').not.toBeNull();
      const gone = await page.request.get(`/api/v1/files/${uploaded.data.id}/content`);
      expect(gone.status(), 'a trashed file 404s on content').toBe(404);

      // ── the grid draws it as a chip, not a bare link ─────────────────────
      await page.goto('/p/shippers');
      /*
       * Row 1 is the ONLY row carrying a file — the `finally` below clears its
       * `document_url` again — so the grid must draw exactly one chip. Asserting
       * the count is what makes the three assertions below unambiguous, and it
       * is stronger than the `.first()` it replaces: that one would have passed
       * just as happily if a second row had grown a chip it should not have.
       */
      const chip = page.locator('[data-part="cell-file"]');
      await expect(chip).toHaveCount(1);
      await expect(chip).toBeVisible();
      await expect(chip).toContainText('e2e-contract-v2.pdf');
      // The chip links to the SAME-ORIGIN content route (D24) — never to a
      // destination's public URL, which the dashboard's CSP would block.
      expect(await chip.getAttribute('href')).toBe(
        `/api/v1/files/${replacement.data.id}/content`,
      );
    } finally {
      // Put the fixture back: the suite runs serially against one seeded server.
      await page.request.patch(
        `/api/v1/data/${await seededConnectionId(page)}/main.shippers/1`,
        { data: { values: { document_url: null } } },
      );
      await trash(page.request, created);
    }
  });
});

test.describe('the Files page', () => {
  test('/files opens from the rail and states facts, not capacity', async ({ page }) => {
    await signIn(page);

    // Reached from the sidebar, not by URL: the route is lazy and behind the
    // Studio guard, so nav entry → route → chunk is the path that can break —
    // and a page nothing links to is the failure mode this repo has hit before.
    await page.goto('/');
    // Anchored: the seed's `shippers.document_url` makes that table file-shaped,
    // so generation also emits a "Shippers Files" archetype page whose label
    // contains this one. Substring matching would be ambiguous.
    await navLink(page, /^Files$/).click();
    await expect(page).toHaveURL(/\/files$/);
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();

    // The preset rail is the page's whole navigation model: every
    // entry is a distinct server query, so each must at least be present and
    // clickable before the per-preset assertions in `filesPage.test.tsx` mean
    // anything about a real screen.
    await expect(page.getByTestId('files-preset-all')).toBeVisible();
    await expect(page.getByTestId('files-preset-unattached')).toBeVisible();
    await expect(page.getByTestId('files-preset-trash')).toBeVisible();

    await page.getByTestId('files-preset-trash').click();
    // Trash carries the honest notice rather than an "Empty trash" button:
    // there is no purge route, and a looped DELETE over already-trashed rows
    // would change nothing (37e's refusal, pinned here against the real page).
    await expect(page.getByTestId('files-trash-notice')).toBeVisible();
    await expect(page.getByRole('button', { name: /empty/i })).toHaveCount(0);

    /*
     * The same copy gate the storage page gets — NARROWED by, not lifted. A
     * bucket has no capacity, so a denominator there would be a number with
     * nothing behind it and stays banned. This server's own disk genuinely
     * has a size, and the meter says so as "… on this disk".
     */
    const body = (await page.locator('main').innerText()).toLowerCase();
    // The tail runs to the end of the sentence, but a period INSIDE a figure
    // ("16.3 GB") is a decimal point, not a full stop — cutting there made this
    // pass or fail on how full the machine's disk happened to be.
    for (const found of body.match(/\d[\d.,]*\s*(bytes|b|kb|mb|gb|tb)\s+of\b(?:[^.\n]|\.(?=\d))*/g) ?? []) {
      expect(found, 'only a local disk may show a capacity').toContain('on this disk');
    }
    for (const banned of ['quota', 'free space', 'upgrade', 'premium', 'hosted storage']) {
      expect(body, `banned in shipped copy: ${banned}`).not.toContain(banned);
    }
  });
});

test.describe('storage destinations', () => {
  test('/studio/storage opens from the Studio hub and states facts, not capacity', async ({
    page,
  }) => {
    await signIn(page);

    // Reached the way an operator reaches it, not by URL: the route is lazy
    // and behind the Studio guard, so the card → route → chunk path is the
    // part that can break.
    await page.goto('/studio/settings');
    await page.getByRole('button', { name: 'Open storage' }).click();
    await expect(page).toHaveURL(/\/studio\/storage$/);

    await expect(page.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible();

    const list = page.getByTestId('studio-storage-list');
    await expect(list).toBeVisible();
    // The implicit destination is always the first entry and has no row in any
    // table; with no destination configured it is also the default.
    await expect(list.getByText("This server's disk")).toBeVisible();
    await expect(page.getByTestId('studio-storage-local-default')).toBeVisible();

    // Usage is a bare fact. "N used" — never a denominator, and never any of
    // the vocabulary bans (37 Appendix D). The positive half of this
    // assertion is what stops the negative half from passing vacuously.
    const usage = page.getByTestId('studio-storage-local-usage');
    await expect(usage).toContainText('used');
    const listText = (await list.innerText()).toLowerCase();
    expect(listText).not.toMatch(/\d[\d.,]*\s*(bytes|b|kb|mb|gb|tb)\s+of\b/);
    for (const banned of ['quota', 'free space', 'upgrade', 'premium', 'hosted storage']) {
      expect(listText, `banned in shipped copy: ${banned}`).not.toContain(banned);
    }
  });

  test('a directory on this server is tested before it is saved', async ({ page }) => {
    await signIn(page);
    await page.goto('/studio/storage');

    await page.getByTestId('studio-storage-add').click();
    // The editor opens on `s3` — the common case — so the local leg is a
    // deliberate choice, exactly as an operator makes it.
    await page.getByTestId('studio-storage-field-driver').selectOption('local');

    // A directory this server can write to. Under the OS temp dir because
    // `webServer` spawns the server on this same machine, and the driver
    // creates the root it is pointed at (so the path need not exist yet).
    await page
      .getByTestId('studio-storage-field-root')
      .fill(join(tmpdir(), 'adminium-e2e-storage-probe'));

    await page.getByTestId('studio-storage-draft-test').click();
    // A real write + read + delete against the local driver, reported as
    // latency. A failure would be a 200 whose body carries the driver's own
    // words, so assert the shape that only a success produces.
    await expect(page.getByTestId('studio-storage-draft-test-result')).toContainText(
      /Reached in \d+ms/,
      { timeout: 15_000 },
    );

    // Leave without saving: this suite's fixture has no destination rows and
    // the specs that follow expect none.
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('studio-storage-draft-test-result')).toBeHidden();
    const rows = await page.request.get('/api/v1/storage/destinations');
    expect(((await rows.json()) as { data: unknown[] }).data).toHaveLength(0);
  });

  test('a destination stores its credential and never hands it back', async ({ page }) => {
    await signIn(page);

    // The one leg an e2e run can reach: the credential goes IN on
    // create and comes back out of NO read. Points at a closed port on
    // loopback so nothing here depends on a bucket existing.
    const created = await page.request.post('/api/v1/storage/destinations', {
      data: {
        name: 'e2e probe bucket',
        driver: 's3',
        config: {
          endpoint: 'http://127.0.0.1:9',
          region: 'auto',
          bucket: 'e2e-probe',
          forcePathStyle: true,
        },
        secret: { accessKeyId: 'AKIAE2EPROBEKEY', secretAccessKey: 'e2e-probe-secret-value' },
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const destination = ((await created.json()) as { data: { id: string; hasSecret: boolean } }).data;

    try {
      expect(destination.hasSecret).toBe(true);
      // Never made default: a default would silently redirect every export and
      // logo write for the rest of the run.
      const listed = await page.request.get('/api/v1/storage/destinations');
      expect(listed.ok()).toBe(true);
      const raw = await listed.text();
      expect(raw).toContain(destination.id);
      expect(raw, 'the access key id must not be readable back').not.toContain('AKIAE2EPROBEKEY');
      expect(raw, 'the secret must not be readable back').not.toContain('e2e-probe-secret-value');

      // Test is the operator's feedback loop, and a failure is a 200 carrying
      // the driver's own message — an error status would send it through the
      // dashboard's error boundary and lose the only actionable part.
      const probe = await page.request.post(
        `/api/v1/storage/destinations/${destination.id}/test`,
      );
      expect(probe.status()).toBe(200);
      const result = ((await probe.json()) as { data: { ok: boolean; error?: string } }).data;
      expect(result.ok).toBe(false);
      expect(result.error ?? '').not.toBe('');
    } finally {
      const removed = await page.request.delete(
        `/api/v1/storage/destinations/${destination.id}`,
      );
      expect(removed.status(), await removed.text()).toBe(200);
    }
  });
});

/**
 * Uploading a file that belongs to no record, through the real dialog.
 *
 * The unit suite drives `UploadFilesDialog` against a stubbed
 * `XMLHttpRequest`; what it cannot prove is that the button exists on the
 * shipped page, that the route accepts a table-less upload from a browser
 * session, or that the row comes back listed. That is this test.
 */
test.describe('the Files page uploads', () => {
  test('puts two files into the workspace and lists them, attached to no record', async ({ page }) => {
    await signIn(page);
    const created: string[] = [];

    try {
      await page.goto('/files');
      await expect(page.getByTestId('files-preset-all')).toBeVisible();

      await page.getByTestId('files-upload-open').click();
      // The picker is visually hidden; Playwright sets files on it directly,
      // which is what a person's file chooser does.
      await page.locator('input[type="file"]').setInputFiles([
        { name: 'price-list.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES },
        { name: 'terms.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES },
      ]);
      await expect(page.getByTestId('files-upload-row')).toHaveCount(2);

      // Two phases: nothing has been sent yet.
      await page.getByTestId('files-upload-send').click();
      await expect(page.getByTestId('files-upload-done')).toBeVisible({ timeout: 15_000 });

      // Escape rather than a name: the modal has two "Close" affordances (the
      // header's X and the footer button), which is the ordinary pattern and
      // an ambiguous selector.
      await page.keyboard.press('Escape');
      /*
       * Wait for the modal to be GONE before reading the library behind it.
       * Its upload rows carry the same filenames the new library rows do, so
       * asserting while it is still mounted matches each name twice — which is
       * why `terms.pdf` needed a `.first()` here and `price-list.pdf` did not:
       * the SECOND row is the one still on screen when the first has already
       * settled. `.first()` hid that by picking whichever matched first, so the
       * assertion could pass against the dialog and never look at the library
       * at all. This also makes the Escape itself an assertion, which is what
       * the note above intends.
       */
      await expect(page.getByTestId('files-upload-row')).toHaveCount(0);
      await expect(page.getByText('price-list.pdf')).toBeVisible();
      await expect(page.getByText('terms.pdf')).toBeVisible();

      // The rows are LIBRARY files: a connection, no record, and claimed at
      // creation so the unattached sweep leaves them (D4).
      const listed = await page.request.get('/api/v1/files?limit=200');
      const { data } = (await listed.json()) as {
        data: { id: string; filename: string; entity: unknown; connectionId: string | null; attachedAt: number | null }[];
      };
      for (const name of ['price-list.pdf', 'terms.pdf']) {
        const row = data.find((file) => file.filename === name);
        expect(row, `${name} is listed`).toBeDefined();
        created.push(String(row?.id));
        expect(row?.entity).toBeNull();
        expect(row?.connectionId).not.toBeNull();
        expect(row?.attachedAt).not.toBeNull();
      }

      // And they are NOT in the "Not attached" preset — that one is about
      // uploads nothing ever claimed, which is a different state.
      const unattached = await page.request.get('/api/v1/files?state=unattached&limit=200');
      const pending = (await unattached.json()) as { data: { filename: string }[] };
      expect(pending.data.map((file) => file.filename)).not.toContain('price-list.pdf');
    } finally {
      await trash(page.request, created);
    }
  });

});

/**
 * The Attachments card, end to end — and the create dialog driven by a browser
 * ((b)+(e); closes).
 *
 * The finding: the column-bound flow was proved at the API level only — the
 * e2e uploaded with `page.request` and PATCHed the row with a reference it had
 * composed itself, so `PageCrudBinding`'s adapter → `RecordForm` submit → CRUD
 * insert had never run outside jsdom against a stub. This drives the real
 * dialog's real file input.
 *
 * It also drives the DDL: the card plans one `ALTER TABLE … ADD COLUMN`, shows
 * it, applies it, and only then does the page name the column.
 */
test.describe('attachments create the column and the dialog uses it', () => {
  test('plans one ALTER, applies it, and a real create dialog uploads two files into it', async ({
    page,
  }) => {
    test.slow();
    await signIn(page);
    const created: string[] = [];

    const list = await page.request.get('/api/v1/pages');
    const { data: pages } = (await list.json()) as { data: { id: string; slug: string }[] };
    const shippers = pages.find((entry) => entry.slug === 'shippers');
    expect(shippers, 'the seed generates a shippers page').toBeDefined();
    const pageId = String(shippers?.id);

    // The qualified table id from the PAGE, never a literal: it is `main.…` on
    // sqlite and `public.…` on postgres, and this suite runs on both.
    const envelope = (await (await page.request.get(`/api/v1/pages/${pageId}`)).json()) as {
      data: { source?: { table?: string } };
    };
    const table = String(envelope.data.source?.table);

    try {
      // ── the card creates the column ───────────────────────────────────────
      await page.goto(`/studio/pages/${pageId}`);
      await page.getByTestId('studio-pages-attachments-enabled').click();

      const name = page.getByTestId('studio-pages-attachments-column-name');
      await expect(name).toBeVisible();
      await name.fill('e2e_attachments');
      /*
       * Which branch this takes is decided by whether the column is already
       * there, and BOTH are real behaviour — creating it is the first run,
       * adopting it is what a CI retry hits after the first attempt left the
       * column behind (D7: turning attachments off never drops one). Asking
       * first makes the retry assert the right thing instead of failing on the
       * missing plan panel and hiding the original failure.
       */
      const label = await page.getByTestId('studio-pages-attachments-column-go').innerText();
      const willCreate = /create/i.test(label);

      await page.getByTestId('studio-pages-attachments-column-go').click();

      if (willCreate) {
        // D2: the SQL the operator authorises is the SQL that runs, so it is
        // on screen before anything is applied.
        const plan = page.getByTestId('studio-pages-attachments-plan');
        await expect(plan).toBeVisible();
        // Asserted ON the plan panel, not on the page. `getByText(/add column/i)`
        // matches the section heading as well as the statement, so `.first()`
        // could be satisfied by a panel that rendered its title and no SQL —
        // which is the one thing D2 says has to be on screen.
        await expect(plan).toContainText(/add column/i);
        await page.getByTestId('studio-pages-attachments-column-confirm').click();
      }
      await expect(page.getByTestId('studio-pages-attachments-bound')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('studio-pages-save').click();

      // ── the create dialog, driven as a person drives it ───────────────────
      await page.goto('/p/shippers');
      // `New row` exactly, not /new/i. PageCrud renders this CTA twice in the
      // source — the topbar (PageCrud.tsx:841) and the empty state (:885) — but
      // MUTUALLY EXCLUSIVELY: the empty state only exists with zero rows. The
      // seeded grid has rows, so the topbar CTA is the only match and the loose
      // regex that made `.first()` look necessary is what was really wrong.
      await page.getByRole('button', { name: 'New row' }).click();
      // Everything below is scoped to the dialog: the grid behind it carries
      // column headers whose accessible names ("Sort by Company Name") match
      // the same words the form's fields do.
      const dialog = page.getByRole('dialog');

      /*
       * The LIST field's picker specifically. This form has two file inputs
       * and that is correct: the seed's `document_url` is a single-value file
       * column (37) and `e2e_attachments` is the list this test just created.
       * A bare `input[type=file]` would be ambiguous — and picking the wrong
       * one would quietly test the old field.
       */
      const picker = dialog.locator('[data-part="file-list-field"] input[type="file"]');
      await expect(picker).toHaveCount(1);
      await picker.setInputFiles([
        { name: 'one.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES },
        { name: 'two.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES },
      ]);
      /*
       * Both chips, before Save — the upload happens on selection because the
       * server mints the reference the column stores.
       *
       * Scoped to the list field and matched as a LINK, not as text anywhere in
       * the dialog, and both halves of that are load-bearing. `FileField`
       * renders the filename TWICE while an upload is in flight: once in the
       * per-file progress row (`{row.name}`, a span) and once in the settled
       * chip (`{file.filename}`, the anchor that opens it). A bare
       * `getByText('two.pdf')` matches both, so under CI's starved CPU — where
       * the second file's progress row outlives the first's — this failed with
       * "resolved to 2 elements" on postgres AND mysql while passing locally on
       * every engine. The chip is the thing the test means: a file that is
       * uploaded, resolved and openable. A progress row is not.
       */
      const listField = dialog.locator('[data-part="file-list-field"]');
      await expect(listField.getByRole('link', { name: /one\.pdf/ })).toBeVisible({ timeout: 20_000 });
      await expect(listField.getByRole('link', { name: /two\.pdf/ })).toBeVisible({ timeout: 20_000 });

      /*
       * Fill everything the row needs. `shippers.shipper_id` is a NOT NULL key
       * with no default in the e2e fixture, so an insert that skips it fails
       * on the constraint rather than on anything this test is about.
       */
      const numbers = dialog.locator('[data-part="record-form"] input[type="number"]');
      for (let i = 0; i < (await numbers.count()); i += 1) {
        await numbers.nth(i).fill(String(9100 + i));
      }
      const texts = dialog.locator('[data-part="record-form"] input[type="text"]');
      for (let i = 0; i < (await texts.count()); i += 1) {
        await texts.nth(i).fill('E2E Freight');
      }
      const insert = page.waitForResponse(
        (res) => res.url().includes('/api/v1/data/') && res.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: /save|create|add/i }).last().click();
      // Asserted rather than polled around: a 500 here would otherwise surface
      // twenty seconds later as "the column is empty", which points at the
      // wrong thing entirely.
      expect((await insert).status(), 'the record was created').toBe(201);

      // ── the column holds a LIST, and both files are attached ──────────────
      const connectionId = await seededConnectionId(page);
      /*
       * ONE read, not a poll. The insert above already returned 201, and the
       * column's value is written BY that insert — the reconcile hook that
       * attaches the files runs post-commit, but the row is there the moment
       * the response lands. A poll here would fire twenty-odd times against a
       * suite that shares a 300-requests-per-minute bucket.
       */
      const rows = await page.request.get(
        `/api/v1/data/${connectionId}/${encodeURIComponent(table)}?limit=200`,
      );
      const body = (await rows.json()) as { data: Record<string, unknown>[] };
      const stored = body.data.find((entry) => typeof entry['e2e_attachments'] === 'string');
      expect(stored, 'the new record carries the attachments column').toBeDefined();
      // A JSON list, which is what a `multiple` column holds.
      expect(JSON.parse(String(stored?.['e2e_attachments'])) as unknown[]).toHaveLength(2);

      const listed = await page.request.get('/api/v1/files?limit=200');
      const files = (await listed.json()) as {
        data: { id: string; filename: string; attachedAt: number | null }[];
      };
      for (const filename of ['one.pdf', 'two.pdf']) {
        const row = files.data.find((entry) => entry.filename === filename);
        expect(row, `${filename} was uploaded`).toBeDefined();
        created.push(String(row?.id));
        // The reconcile hook attached it when the record was written.
        expect(row?.attachedAt, `${filename} is attached`).not.toBeNull();
      }
    } finally {
      // Put the page back: the suite runs serially against one seeded server.
      // The COLUMN stays — dropping one is the change Adminium will not make
      // on its own (D7), and an unused text column costs the next spec nothing.
      const detail = await page.request.get(`/api/v1/pages/${pageId}`);
      const envelope = (await detail.json()) as { data: { config?: Record<string, unknown> } };
      const body = { ...(envelope.data.config ?? {}) };
      delete body['attachments'];
      body['columns'] = ((body['columns'] as { name: string }[] | undefined) ?? []).filter(
        (column) => column.name !== 'e2e_attachments',
      );
      await page.request.patch(`/api/v1/pages/${pageId}/config`, { data: { config: body } });
      await trash(page.request, created);

      /*
       * ONE warm-up read, and no more than one.
       *
       * An apply re-reads the schema, so the next request to touch this
       * connection pays a reconnect; doing it here keeps that off an
       * unrelated spec. It is deliberately a single call: the `api` rate
       * bucket is 300 requests per minute PER PRINCIPAL (`plugins/core.ts`
       * RATE_BUCKETS), and this suite is one principal running serially
       * against one server — so it shares that budget end to end. An earlier
       * version of this cleanup polled up to 24 times and pushed the suite
       * over the ceiling, which surfaced as a 429 rendering the rate-limit
       * page in `workspace-settings` and looked for all the world like an
       * SMTP bug.
       */
      await page.request.get(`/api/v1/pages`);
    }
  });
});
