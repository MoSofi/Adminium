// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `PageRecordProps.panels` / `.actions` and `PageCrudProps.rowActions`
 * (34-invoices-add-on.md §7.8; 34-T15, 34-T16).
 *
 * Three seams that all say the same thing: the HOST owns what the content is,
 * the template owns where it sits. What is pinned here is the "where", because
 * the "what" is untestable from inside a component that deliberately knows
 * nothing about it — and because two of the three placements were chosen for
 * reasons a later refactor would not guess.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageRecord } from './PageRecord.js';
import type { CrudApi } from '../page-crud/crud-api.js';
import { gridColumnSpecSchema } from '../../families/tables/column-spec.js';
import type { GridColumnSpecInput } from '../../families/tables/column-spec.js';

/** Same shape as page-record.test.tsx: the schema fills the defaults a literal cannot. */
const spec = (input: GridColumnSpecInput) => gridColumnSpecSchema.parse(input);

const COLUMNS = [
  spec({ name: 'id', label: 'ID', logicalType: 'integer', primaryKey: true, nullable: false }),
  spec({ name: 'name', label: 'Name', logicalType: 'varchar', isDisplay: true }),
];

const RECORD = { id: 1, name: 'Acme' };

/** The shape `page-record.test.tsx` uses — `get` answers `{data, inboundCounts}`. */
function api(): CrudApi {
  return {
    list: () => Promise.resolve({ data: [RECORD], cursor: { next: null } }),
    get: () => Promise.resolve({ data: RECORD, inboundCounts: [] }),
    create: () => Promise.resolve({ data: null, undoToken: null }),
    update: () => Promise.resolve({ data: null, undoToken: null }),
    remove: () => Promise.resolve({ data: null, undoToken: null }),
    references: () => Promise.resolve([]),
    undo: () => Promise.resolve({ restoredIds: [1] }),
  } as unknown as CrudApi;
}

function renderRecord(props: Record<string, unknown> = {}) {
  return render(
    <PageRecord
      api={api()}
      columns={COLUMNS}
      source={{ connectionId: 'conn_1', table: 'public.orders' }}
      recordId="1"
      keyField="name"
      {...props}
    />,
  );
}

describe('host-supplied panels on the record page', () => {
  it('renders nothing extra when the host passes none', async () => {
    // A deployment with no `document-render` provider installed passes
    // nothing, and the page is what it always was.
    renderRecord();
    expect(await screen.findByRole('heading', { name: 'Acme' })).not.toBeNull();
    expect(screen.queryByTestId('record-host-panels')).toBeNull();
  });

  it('renders each panel under its own heading', async () => {
    renderRecord({
      panels: [
        { id: 'documents', title: 'Documents', content: <p>two invoices</p> },
        { id: 'certs', title: 'Certificates', content: <p>one certificate</p> },
      ],
    });
    expect(await screen.findByText('Documents')).not.toBeNull();
    expect(screen.getByText('two invoices')).not.toBeNull();
    expect(screen.getByTestId('record-panel-certs')).not.toBeNull();
  });

  it('puts them OUTSIDE the tab strip, so nothing is hidden behind a click', async () => {
    /*
     * The placement decision, pinned. A tab hides its contents until somebody
     * clicks it, and "which documents exist for this row" is a fact somebody
     * should see without hunting. Adding an unknown number of unknown tabs to
     * a stable row of three also turns it into a scrolling list.
     */
    const { container } = renderRecord({
      panels: [{ id: 'documents', title: 'Documents', content: <p>two invoices</p> }],
    });
    await screen.findByText('Documents');
    const panels = container.querySelector('[data-testid="record-host-panels"]');
    expect(panels).not.toBeNull();
    expect(panels?.closest('[role="tabpanel"]')).toBeNull();
  });
});

describe('host-supplied topbar actions', () => {
  it('renders them, and keeps Delete last', async () => {
    /*
     * The ordering that matters. A destructive control which moves because an
     * add-on was installed is a control somebody clicks by muscle memory and
     * means to have clicked something else.
     */
    renderRecord({
      canUpdate: true,
      canDelete: true,
      actions: [{ id: 'make', label: 'Make', content: <button type="button">Make</button> }],
    });
    await screen.findByRole('heading', { name: 'Acme' });

    const make = screen.getByTestId('record-action-make');
    const remove = screen.getByRole('button', { name: 'Delete' });
    // `compareDocumentPosition` rather than index arithmetic: it answers the
    // question actually being asked — is Delete after this, in the document.
    expect(
      make.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows the action bar for a read-only record that still has an action', async () => {
    // A read-only source is exactly the case a document action exists for:
    // the row cannot be edited and a document can still be drawn from it.
    renderRecord({
      canUpdate: false,
      canDelete: false,
      actions: [{ id: 'make', label: 'Make', content: <button type="button">Make</button> }],
    });
    expect(await screen.findByTestId('record-action-make')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});
