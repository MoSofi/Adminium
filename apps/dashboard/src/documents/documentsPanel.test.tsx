// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * The Documents panel and Make button (34-invoices-add-on.md §7.8; 34-T15,
 * 34-T17's a11y half).
 *
 * ─── Accessibility is asserted HERE because nothing else can see this ──────
 *
 * `packages/ui/scripts/a11y-sweep.mjs` runs axe over the workspace Storybook,
 * whose globs are `packages/ui`, `packages/charts` and `packages/widgets` — no
 * `apps/dashboard` surface has ever been in it. So a dashboard screen's roles
 * and names are pinned by its own tests or by nothing at all. The names below
 * are the ones axe would check.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentsPanel, MakeDocumentButton } from './DocumentsPanel.js';
import { entityKey, type DocumentRow } from './documentsApi.js';

const fetchDocumentsForEntity = vi.hoisted(() => vi.fn());
const renderDocumentFor = vi.hoisted(() => vi.fn());
vi.mock('./documentsApi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./documentsApi.js')>()),
  fetchDocumentsForEntity,
  renderDocumentFor,
}));

function row(over: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 'doc_1',
    profileId: 'dpf_1',
    addOnKey: 'invoices',
    kind: 'invoice',
    connectionId: 'conn_1',
    entityTable: 'public.orders',
    entityId: 'id=1',
    subject: {},
    number: 'INV-1042',
    locale: 'en-US',
    format: 'pdf',
    status: 'rendered',
    error: null,
    delivery: null,
    renderedAt: 1,
    voidedAt: null,
    voidReason: null,
    createdAt: 1,
    redacted: false,
    hasContent: true,
    ...over,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentsPanel entityTable="public.orders" entityId="id=1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchDocumentsForEntity.mockReset();
  renderDocumentFor.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the documents panel', () => {
  it('says so plainly when a record has none', async () => {
    fetchDocumentsForEntity.mockResolvedValue([]);
    renderPanel();
    expect(await screen.findByText(/no documents have been drawn/i)).toBeTruthy();
  });

  it('lists a drawn document by its number, with named links', async () => {
    fetchDocumentsForEntity.mockResolvedValue([row()]);
    renderPanel();
    expect(await screen.findByText('INV-1042')).toBeTruthy();
    // NAMED links, not two identical icon buttons. "Download" and "Print" are
    // what a screen reader announces; two unnamed anchors would be two
    // identical, meaningless stops.
    expect(screen.getByRole('link', { name: /download/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /print/i })).toBeTruthy();
  });

  it('shows a REDACTED row, and offers no download for it', async () => {
    /*
     * The row's existence is a fact the record page must not lie about, and
     * its contents are not this caller's to read. A download button here would
     * lead to a 403 the server is right to send — a worse answer than none.
     */
    fetchDocumentsForEntity.mockResolvedValue([row({ redacted: true, subject: null })]);
    renderPanel();
    expect(await screen.findByText('INV-1042')).toBeTruthy();
    expect(screen.getByText(/you may not read this one/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
  });

  it('marks a voided document rather than hiding it', async () => {
    fetchDocumentsForEntity.mockResolvedValue([row({ status: 'voided' })]);
    renderPanel();
    expect(await screen.findByText(/voided/i)).toBeTruthy();
  });

  it('opens the print view in a new tab WITHOUT handing it this one', async () => {
    // The print view is a sandboxed page of add-on-drawn HTML. A new tab that
    // kept `window.opener` could navigate the tab that opened it.
    fetchDocumentsForEntity.mockResolvedValue([row()]);
    renderPanel();
    const print = await screen.findByRole('link', { name: /print/i });
    expect(print.getAttribute('target')).toBe('_blank');
    expect(print.getAttribute('rel')).toContain('noopener');
  });
});

describe('the Make button', () => {
  const profile = {
    id: 'dpf_1',
    addOnKey: 'invoices',
    kind: 'invoice',
    name: 'Invoice',
    connectionId: 'conn_1',
    table: 'public.orders',
    enabled: true,
  };

  function renderButton(profiles: (typeof profile)[]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MakeDocumentButton profiles={profiles} pk={{ id: 1 }} />
      </QueryClientProvider>,
    );
  }

  it('renders NOTHING when no mapping covers this table', () => {
    // An affordance that cannot do anything invites a click and then explains
    // itself (24 D6).
    const { container } = renderButton([]);
    expect(container.querySelector('button')).toBeNull();
  });

  it('names what it will make when there is one mapping', async () => {
    renderButton([profile]);
    expect(screen.getByRole('button', { name: /make invoice/i })).toBeTruthy();
  });

  it('names EACH mapping when there are several', () => {
    /*
     * A menu would be tidier and is wrong at two items: it hides both behind a
     * click to save a few pixels on a topbar that has room, and it turns two
     * distinct named actions into one unnamed one.
     */
    renderButton([profile, { ...profile, id: 'dpf_2', name: 'Proforma' }]);
    expect(screen.getByRole('button', { name: 'Invoice' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Proforma' })).toBeTruthy();
  });

  it('asks the server to draw the mapping that was clicked', async () => {
    renderDocumentFor.mockResolvedValue({ jobId: 'job_1' });
    const user = userEvent.setup();
    renderButton([profile, { ...profile, id: 'dpf_2', name: 'Proforma' }]);
    await user.click(screen.getByRole('button', { name: 'Proforma' }));
    await waitFor(() =>
      expect(renderDocumentFor).toHaveBeenCalledWith({ profileId: 'dpf_2', pk: { id: 1 } }),
    );
  });
});

describe('the register’s key for a source row', () => {
  it('is the same literal string the server writes', () => {
    /*
     * `entityKeyOf` in `packages/meta/src/repos/documents.ts` — pinned to this
     * exact string by `repos.documents.test.ts`. The two are restatements of
     * one format, so they are held to the literal rather than to each other:
     * the dashboard does not depend on `@adminium/meta`, and a test that
     * compared them would need to.
     */
    expect(entityKey({ order_id: 4118, line_no: 2 })).toBe('line_no=2|order_id=4118');
    // Sorted, because `jsonb` reorders keys on postgres and mysql.
    expect(entityKey({ line_no: 2, order_id: 4118 })).toBe(entityKey({ order_id: 4118, line_no: 2 }));
    // The single-key case every record page hits.
    expect(entityKey({ id: 7 })).toBe('id=7');
  });
});
