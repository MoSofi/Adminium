// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * "Render for row…".
 *
 * The two things worth pinning here are the two that are silently wrong rather
 * than broken: which key the row is drawn by, and whether the drawn document
 * is reachable afterwards. A picker that sends the wrong key draws SOMEBODY's
 * document, and one that never surfaces the result looks like a slow queue.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RenderForRow } from './RenderForRow.js';
import type { ColumnFacts } from './mapping.js';

const list = vi.hoisted(() => vi.fn());
vi.mock('../../api/crud.js', () => ({ createCrudApi: () => ({ list }) }));

const renderDocumentFor = vi.hoisted(() => vi.fn());
const fetchDocumentsForEntity = vi.hoisted(() => vi.fn());
vi.mock('../../documents/documentsApi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../documents/documentsApi.js')>()),
  renderDocumentFor,
  fetchDocumentsForEntity,
}));

/*
 * A table keyed by something that is NOT called `id`. That is the whole point
 * of the fixture: the record page addresses rows as `{id: …}`, and a picker
 * that copied it would send a key this table does not have.
 */
const COLUMNS: ColumnFacts[] = [
  { name: 'order_no', label: 'Order no', logicalType: 'varchar', nullable: false, primaryKey: true },
  { name: 'customer', label: 'Customer', logicalType: 'varchar', nullable: true },
  { name: 'secret', label: 'Secret', logicalType: 'varchar', nullable: true, pii: true },
];

function mount(profileId: string | null = 'dpf_1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RenderForRow
        profileId={profileId}
        connectionId="conn_1"
        table="public.orders"
        columns={COLUMNS}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({ data: [{ order_no: 'SO-9', customer: 'Acme', secret: 'shh' }] });
  renderDocumentFor.mockResolvedValue({ jobId: 'job_1' });
  fetchDocumentsForEntity.mockResolvedValue([]);
});

describe('drawing a document from a chosen row', () => {
  it('sends the table’s OWN primary key, not an assumed `id`', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Draw this one' }));

    await waitFor(() => expect(renderDocumentFor).toHaveBeenCalled());
    expect(renderDocumentFor.mock.calls[0]![0]).toEqual({
      profileId: 'dpf_1',
      pk: { order_no: 'SO-9' },
    });
  });

  it('asks the register for the row under the key the SERVER stores', async () => {
    // `entityKeyOf` in the meta repo writes `<column>=<value>`; asking for the
    // bare value matches nothing, which is indistinguishable from "still
    // drawing" and was exactly the shape of the record panel's own bug.
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Draw this one' }));

    await waitFor(() => expect(fetchDocumentsForEntity).toHaveBeenCalled());
    expect(fetchDocumentsForEntity.mock.calls[0]![0]).toEqual({
      entityTable: 'public.orders',
      entityId: 'order_no=SO-9',
    });
  });

  it('offers the drawn document at the sandboxed print route once it exists', async () => {
    // The row has nothing before the draw, and the document afterwards. Both
    // halves matter: the component reads the register once BEFORE it renders,
    // so that it can tell this document from any the row already had.
    fetchDocumentsForEntity.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 'doc_9', status: 'rendered', error: null, hasContent: true },
    ]);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Draw this one' }));

    const link = await screen.findByRole('link', { name: 'Open it' });
    expect(link.getAttribute('href')).toBe('/api/v1/documents/doc_9/print');
    // A new tab that kept `window.opener` could navigate this one, and the
    // print view is add-on-drawn HTML.
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('waits for the NEW document when the row already had one', async () => {
    /*
     * The register is newest-first, so a row that was drawn last week hands
     * the poll a finished document on its very first tick. Somebody checking a
     * mapping they just changed would open the old one and see the old mistake
     * — or the old correctness, which is worse.
     */
    const old = { id: 'doc_old', status: 'rendered', error: null, hasContent: true };
    // Here the before-read DOES return a document — that is the whole case.
    fetchDocumentsForEntity.mockResolvedValue([old]);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Draw this one' }));

    await waitFor(() => expect(renderDocumentFor).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Open it' })).toBeNull();

    // …and it stops waiting as soon as a document that is NOT the old one lands.
    fetchDocumentsForEntity.mockResolvedValue([
      { id: 'doc_new', status: 'rendered', error: null, hasContent: true },
      old,
    ]);
    const link = await screen.findByRole('link', { name: 'Open it' }, { timeout: 3000 });
    expect(link.getAttribute('href')).toBe('/api/v1/documents/doc_new/print');
  });

  it('says why a document FAILED rather than leaving the spinner up', async () => {
    fetchDocumentsForEntity.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 'doc_9', status: 'failed', error: 'taxRate is not a number', hasContent: false },
    ]);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Draw this one' }));

    expect(await screen.findByText(/taxRate is not a number/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open it' })).toBeNull();
  });

  it('hides PII from the row preview, and never fetches anything unsaved', async () => {
    mount(null);
    expect(await screen.findByText(/Save the mapping first/)).toBeTruthy();
    // A mapping with no id cannot be rendered, so asking for its rows is a
    // query nobody can act on.
    expect(list).not.toHaveBeenCalled();
  });

  it('leaves a masked column out of the row it shows', async () => {
    mount();
    expect(await screen.findByText(/SO-9 · Acme/)).toBeTruthy();
    expect(screen.queryByText(/shh/)).toBeNull();
  });
});
