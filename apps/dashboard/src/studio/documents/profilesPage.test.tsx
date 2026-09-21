// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * `/studio/documents` — (a value typed here) and step 8 (draw one from a
 * row), plus the way back into a saved mapping that both of them need.
 *
 * ─── WHAT ONLY A RENDERED TEST CAN SEE ─────────────────────────────────────
 *
 * `mapping.ts` proves that a typed value survives the round trip and that the
 * right slots may take one. Neither says whether the control REACHES a screen:
 * this page shipped with `fromMapping` imported and never called, `Edit`
 * absent from the list and `updateProfile` written and never sent — three
 * layers of correct code with nothing on top. So the assertions below are
 * about what an operator can actually do.
 *
 * Accessibility is asserted here for the same reason the panel's test states:
 * the axe sweep's globs are `packages/ui`, `packages/charts` and
 * `packages/widgets`, so a dashboard screen's roles and names are pinned by
 * its own test or by nothing at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentProfilesPage } from './DocumentProfilesPage.js';
import type { DocumentKindOption, DocumentProfile } from './api.js';

const fetchKinds = vi.hoisted(() => vi.fn());
const fetchProfiles = vi.hoisted(() => vi.fn());
const createProfile = vi.hoisted(() => vi.fn());
const updateProfile = vi.hoisted(() => vi.fn());
const deleteProfile = vi.hoisted(() => vi.fn());
vi.mock('./api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api.js')>()),
  fetchKinds,
  fetchProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
}));

const sources = vi.hoisted(() => vi.fn());
vi.mock('../../automations/api.js', () => ({ automationsApi: { sources: () => sources() } }));

/* Step 6 asks the deployment whether it can send anything at all. */
const capabilities = vi.hoisted(() => ({ smtpConfigured: true }));
vi.mock('../../app/capabilities.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../app/capabilities.js')>()),
  useCapabilities: () => ({
    flags: { smtpConfigured: capabilities.smtpConfigured, networkFeaturesAllowed: true },
    resolved: true,
  }),
}));

/*
 * Step 8 is its own component with its own data. It is replaced here so this
 * file asks only whether the editor MOUNTS it with the right mapping — its own
 * behaviour is a separate question, and one that would drag a crud client and
 * a poll timer into every assertion below.
 */
const renderForRow = vi.hoisted(() => vi.fn());
vi.mock('./RenderForRow.js', () => ({
  RenderForRow: (props: { profileId: string | null; table: string }) => {
    renderForRow(props);
    return <div data-testid="render-for-row">{props.profileId ?? 'unsaved'}</div>;
  },
}));

const KIND: DocumentKindOption = {
  addOnKey: 'invoices',
  kind: 'invoice',
  label: { 'en-US': 'Invoice' },
  formats: ['pdf'],
  paper: ['a4'],
  coverage: 'full',
  outline: {
    slots: [
      { id: 'customerName', label: { 'en-US': 'Customer' }, type: 'text', required: true },
      { id: 'taxRate', label: { 'en-US': 'Tax rate' }, type: 'percent', required: false },
      { id: 'customerEmail', label: { 'en-US': 'Customer email' }, type: 'email', required: false },
      {
        id: 'items',
        label: { 'en-US': 'Lines' },
        type: 'collection',
        required: false,
        columns: [
          { id: 'desc', label: { 'en-US': 'Description' }, type: 'text', required: false },
          { id: 'qty', label: { 'en-US': 'Quantity' }, type: 'number', required: false },
        ],
      },
    ],
  },
};

const PROFILE: DocumentProfile = {
  id: 'dpf_1',
  addOnKey: 'invoices',
  kind: 'invoice',
  name: 'Order invoice',
  connectionId: 'conn_1',
  table: 'public.orders',
  mapping: { customerName: { column: 'customer' } },
  options: { literals: { taxRate: '20' } },
  trigger: { event: 'record.created' },
  deliver: { store: true },
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

const SOURCES = {
  connections: [
    {
      id: 'conn_1',
      name: 'main',
      tables: [
        {
          id: 'public.orders',
          label: 'Orders',
          canRead: true,
          /*
           * Two children, and the UNTAGGED one is listed second rather than
           * dropped: the engine's `line-items` rule needs two foreign keys plus
           * qty × rate numerics, so a one-FK child like `invoice_items` never
           * carries the tag and still has to be pickable.
           */
          children: [
            { table: 'public.invoice_items', column: 'invoice_id', lineItems: false },
            { table: 'public.order_lines', column: 'order_id', lineItems: true },
          ],
          columns: [
            { name: 'id', label: 'Id', logicalType: 'integer', isPk: true },
            { name: 'customer', label: 'Customer', logicalType: 'varchar' },
            { name: 'vat_rate', label: 'VAT rate', logicalType: 'numeric' },
          ],
        },
        {
          id: 'public.order_lines',
          label: 'Order lines',
          canRead: true,
          children: [],
          columns: [
            { name: 'line_id', label: 'Line', logicalType: 'integer', isPk: true },
            { name: 'order_id', label: 'Order', logicalType: 'integer' },
            { name: 'description', label: 'Description', logicalType: 'varchar' },
            { name: 'quantity', label: 'Quantity', logicalType: 'integer' },
          ],
        },
        {
          id: 'public.invoice_items',
          label: 'Invoice items',
          canRead: true,
          children: [],
          columns: [
            { name: 'item_id', label: 'Item', logicalType: 'integer', isPk: true },
            { name: 'invoice_id', label: 'Invoice', logicalType: 'integer' },
            { name: 'title', label: 'Title', logicalType: 'varchar' },
            /*
             * A column with the SAME NAME as one on the other child, so the
             * "clears the map" test below can tell a cleared map from a
             * carried-over value. Without it a stale `description` would simply
             * not match any option and the select would render empty anyway —
             * the test would pass while the bug it names was live.
             */
            { name: 'description', label: 'Description', logicalType: 'varchar' },
          ],
        },
      ],
    },
  ],
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentProfilesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capabilities.smtpConfigured = true;
  fetchKinds.mockResolvedValue([KIND]);
  fetchProfiles.mockResolvedValue([]);
  sources.mockResolvedValue(SOURCES);
  createProfile.mockResolvedValue(PROFILE);
  updateProfile.mockResolvedValue(PROFILE);
});

describe('a value typed into the mapping', () => {
  it('offers "a value I type" on an optional slot and sends what was typed', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Invoice' }));

    // Step 2 has to be answered before any slot exists to bind.
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Table' }), 'public.orders');

    const taxRate = await screen.findByRole('combobox', { name: 'Tax rate' });
    await user.selectOptions(taxRate, 'typed');

    const value = await screen.findByRole('textbox', { name: 'Value for Tax rate' });
    await user.type(value, '20');

    // The required slot still needs a column, or saving is refused.
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Customer' }),
      'column:customer',
    );
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));

    await waitFor(() => expect(createProfile).toHaveBeenCalled());
    const draft = createProfile.mock.calls[0]![0] as {
      mapping: Record<string, unknown>;
      options: { literals: Record<string, string> };
    };
    // The typed value goes to `options.literals`, NOT into `mapping` — the
    // mapping says which columns are read, and this one is read from nothing.
    expect(draft.options.literals).toEqual({ taxRate: '20' });
    expect(draft.mapping).toEqual({ customerName: { column: 'customer' } });
  });

  it('says the value does not move with the row', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Invoice' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Table' }), 'public.orders');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Tax rate' }), 'typed');

    // Without this line the control is indistinguishable from a column
    // picker, and every document quietly says the same thing.
    expect(await screen.findByText(/not read from your data/i)).toBeTruthy();
  });

  it('does NOT offer it on a required slot with no default', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Invoice' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Table' }), 'public.orders');

    const customer = await screen.findByRole('combobox', { name: 'Customer' });
    expect(within(customer).queryByText('A value I type')).toBeNull();
  });
});

describe('emailing the document', () => {
  async function openEditor() {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Invoice' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Table' }), 'public.orders');
    return user;
  }

  it('stores the chosen SLOT, which is what survives a frozen subject', async () => {
    const user = await openEditor();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Email it to' }),
      'customerEmail',
    );
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Customer' }),
      'column:customer',
    );
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));

    await waitFor(() => expect(createProfile).toHaveBeenCalled());
    const draft = createProfile.mock.calls[0]![0] as { deliver: Record<string, unknown> };
    expect(draft.deliver).toEqual({ store: true, emailSlot: 'customerEmail' });
  });

  it('leaves `emailSlot` OFF entirely when nobody is to be emailed', async () => {
    // Absent, not ''. The server reads "no slot named" as "this mapping never
    // wanted an email" and stamps nothing on the register row; an empty string
    // would stamp `not-sent:no-email` on every document it ever draws.
    const user = await openEditor();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Customer' }),
      'column:customer',
    );
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));

    await waitFor(() => expect(createProfile).toHaveBeenCalled());
    expect((createProfile.mock.calls[0]![0] as { deliver: unknown }).deliver).toEqual({ store: true });
  });

  it('DISABLES the choice and says why when no email server is set up', async () => {
    /*
     * Never hidden — "never hide, always explain" is the rule the capability
     * module exists to enforce, and a greyed control with no sentence beside it
     * is the exact failure it names.
     */
    capabilities.smtpConfigured = false;
    await openEditor();
    const select = await screen.findByRole('combobox', { name: 'Email it to' });
    expect((select as HTMLSelectElement).disabled).toBe(true);
    expect(await screen.findByText(/no email server set up/i)).toBeTruthy();
  });
});

describe('the child-table picker for a collection', () => {
  async function openEditorOnOrders() {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Invoice' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Table' }), 'public.orders');
    return user;
  }

  it('offers every child table, with the engine’s guess FIRST and never alone', async () => {
    await openEditorOnOrders();
    const lines = (await screen.findByRole('combobox', { name: 'Lines' })) as HTMLSelectElement;
    const options = [...lines.options].map((option) => option.textContent ?? '');

    // "No lines", then the tagged child, then the untagged one. If the tag
    // filtered instead of sorted, `invoice_items` would not be here at all —
    // and that is the one names by name.
    expect(options[0]).toContain('No lines');
    expect(options[1]).toContain('Order lines');
    expect(options[1]).toContain('looks like lines');
    expect(options[2]).toContain('Invoice items');
    expect(options[2]).not.toContain('looks like lines');
  });

  it('maps the line columns from the CHILD table, not the header', async () => {
    const user = await openEditorOnOrders();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Lines' }),
      'public.order_lines|order_id',
    );

    const desc = (await screen.findByRole('combobox', {
      name: 'Description of each line',
    })) as HTMLSelectElement;
    const offered = [...desc.options].map((option) => option.value);
    // A line's description lives on the child. Offering the order's own
    // columns would be offering one value repeated down every line.
    expect(offered).toContain('description');
    expect(offered).not.toContain('customer');
  });

  it('stores the table, the foreign key and the column map together', async () => {
    const user = await openEditorOnOrders();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Lines' }),
      'public.order_lines|order_id',
    );
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Description of each line' }),
      'description',
    );
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Customer' }),
      'column:customer',
    );
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));

    await waitFor(() => expect(createProfile).toHaveBeenCalled());
    const draft = createProfile.mock.calls[0]![0] as { mapping: Record<string, unknown> };
    expect(draft.mapping.items).toEqual({
      collection: {
        table: 'public.order_lines',
        fkColumn: 'order_id',
        // `qty` was left alone, and is ABSENT rather than mapped to '' — a
        // column named "" reads as null on every row.
        columns: { desc: 'description' },
      },
    });
  });

  it('clears the column map when the child table changes', async () => {
    /*
     * Carrying it over would leave a mapping naming columns of the table
     * somebody just moved away from: it passes every check on this page and
     * fails at render — or matches a same-named column and quietly draws the
     * wrong field.
     */
    const user = await openEditorOnOrders();
    const lines = await screen.findByRole('combobox', { name: 'Lines' });
    await user.selectOptions(lines, 'public.order_lines|order_id');
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Description of each line' }),
      'description',
    );
    await user.selectOptions(lines, 'public.invoice_items|invoice_id');

    const desc = (await screen.findByRole('combobox', {
      name: 'Description of each line',
    })) as HTMLSelectElement;
    expect(desc.value).toBe('');
  });

  it('says why there is no picker when nothing points at the table', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Invoice' }));
    // `order_lines` has no children of its own.
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Table' }),
      'public.order_lines',
    );

    // An empty select would send somebody looking for the option they are
    // missing; the fix is in the source database, not on this page.
    expect(await screen.findByText(/Nothing in your database points at this table/)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Lines' })).toBeNull();
  });
});

describe('a saved mapping can be opened again', () => {
  beforeEach(() => {
    fetchProfiles.mockResolvedValue([PROFILE]);
  });

  it('reads the stored mapping AND its typed values back into the form', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const customer = (await screen.findByRole('combobox', {
      name: 'Customer',
    })) as HTMLSelectElement;
    expect(customer.value).toBe('column:customer');
    // The typed value is the half that has no column to fall back on: a form
    // that lost it would silently drop the field on the next save.
    const value = await screen.findByRole('textbox', { name: 'Value for Tax rate' });
    expect((value as HTMLInputElement).value).toBe('20');
  });

  it('PUTs the existing mapping rather than making a second one', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(await screen.findByRole('button', { name: 'Save mapping' }));

    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(updateProfile.mock.calls[0]![0]).toBe('dpf_1');
    expect(createProfile).not.toHaveBeenCalled();
  });
});

describe('deleting a mapping', () => {
  beforeEach(() => {
    fetchProfiles.mockResolvedValue([PROFILE]);
    deleteProfile.mockReset();
  });

  it('asks first, by name, and deletes nothing on the click alone', async () => {
    deleteProfile.mockResolvedValue(undefined);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(deleteProfile).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole('textbox'), 'Order invoice');
    await user.click(within(dialog).getByRole('button', { name: 'Delete mapping' }));
    await waitFor(() => expect(deleteProfile).toHaveBeenCalledWith('dpf_1'));
  });

  it('says in the dialog why a delete was refused', async () => {
    deleteProfile.mockRejectedValue(new Error('Forbidden.'));
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Order invoice');
    await user.click(within(dialog).getByRole('button', { name: 'Delete mapping' }));

    const alert = await within(dialog).findByTestId('documents-delete-error');
    expect(alert.textContent).toContain('The mapping was not deleted');
    expect(alert.textContent).toContain('Forbidden.');
  });

  it('reports a failed load instead of claiming there are no mappings', async () => {
    fetchProfiles.mockRejectedValue(new Error('Request failed with status 500.'));
    mount();
    expect(await screen.findByTestId('documents-load-error')).toBeTruthy();
    expect(screen.queryByText('No mappings yet.')).toBeNull();
  });
});

describe('drawing one from a row', () => {
  it('hands the picker the SAVED mapping when there is one', async () => {
    fetchProfiles.mockResolvedValue([PROFILE]);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    await waitFor(() => expect(renderForRow).toHaveBeenCalled());
    const props = renderForRow.mock.calls.at(-1)![0] as { profileId: string | null; table: string };
    expect(props.profileId).toBe('dpf_1');
    expect(props.table).toBe('public.orders');
  });

  it('hands it nothing while the mapping is unsaved, because render needs an id', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Invoice' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Table' }), 'public.orders');

    await waitFor(() => expect(renderForRow).toHaveBeenCalled());
    expect((renderForRow.mock.calls.at(-1)![0] as { profileId: string | null }).profileId).toBeNull();
  });
});
