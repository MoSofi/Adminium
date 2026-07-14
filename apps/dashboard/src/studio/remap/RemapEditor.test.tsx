/**
 * Remap editor integration: tree rendering from a schema fixture (labels,
 * type chips, badges), the label-edit → diff bar → save → PUT-exact-document
 * flow, the post-save live preview (applied labels re-read from
 * GET /connections/:id/schema), the regenerate action with counts, and 422
 * mapping into the danger banner.
 */
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../../test/fixtures.js';
import { makeModel, makeOverrideRow, makeSchemaReply } from './fixtures.js';
import { installFetch, renderEditor } from './test-harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('schema tree', () => {
  it('renders tables, applied labels, type chips and PK/FK/PII badges', async () => {
    installFetch();
    renderEditor();

    // Tables (derived labels) + snapshot header.
    expect(await screen.findByText('Customers')).toBeDefined();
    expect(screen.getByText('Orders')).toBeDefined();
    expect(screen.getByText('Order notes')).toBeDefined();
    expect(screen.getByText('3 tables · 0 overrides applied')).toBeDefined();

    // Expand customers → columns with chips + badges.
    await userEvent.click(screen.getByRole('button', { name: /Customers/  }));
    expect(await screen.findByText('Email')).toBeDefined();
    expect(screen.getAllByText('uuid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PK').length).toBeGreaterThan(0);
    expect(screen.getAllByText('UNIQUE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PII').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Masked').length).toBeGreaterThan(0);
  });

  it('search filters the table list', async () => {
    installFetch();
    renderEditor();
    await screen.findByText('Customers');

    await userEvent.type(screen.getByLabelText('Search tables and columns'), 'order_notes');
    expect(screen.queryByText('Customers')).toBeNull();
    expect(screen.getByText('Order notes')).toBeDefined();
  });

  it('shows applied labels coming from the server (overrides applied)', async () => {
    const model = makeModel();
    const customers = model.tables.find((table) => table.id === 'public.customers');
    if (customers !== undefined) customers.label = 'Clients';
    installFetch({
      schema: () => makeSchemaReply(model, 1),
      overridesRows: () => [
        makeOverrideRow({ op: 'table.label', tableName: 'public.customers', value: { label: 'Clients' } }),
      ],
    });
    renderEditor();

    expect(await screen.findByText('Clients')).toBeDefined();
    expect(screen.getByText('3 tables · 1 overrides applied')).toBeDefined();
  });
});

describe('edit → save → regenerate', () => {
  it('stages a table label, PUTs the exact document, re-reads applied labels, regenerates with counts', async () => {
    let saved = false;
    const harness = installFetch({
      schema: () => {
        const model = makeModel();
        if (saved) {
          const customers = model.tables.find((table) => table.id === 'public.customers');
          if (customers !== undefined) customers.label = 'Clients';
        }
        return makeSchemaReply(model, saved ? 1 : 0);
      },
      overridesRows: () =>
        saved
          ? [makeOverrideRow({ op: 'table.label', tableName: 'public.customers', value: { label: 'Clients' } })]
          : [],
      onPut: () => {
        saved = true;
        return undefined;
      },
    });
    renderEditor();

    await userEvent.click(await screen.findByRole('button', { name: /Customers/  }));
    const input = await screen.findByLabelText('Display label');
    await userEvent.type(input, 'Clients');

    expect(await screen.findByText('1 change')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));

    // Exact full-document PUT (server overridesPutBody contract).
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));
    expect(harness.putBodies[0]).toEqual({
      overrides: [{ op: 'table.label', tableName: 'public.customers', value: { label: 'Clients' } }],
    });

    // Success toast + live preview: the APPLIED label comes back from GET /schema.
    expect(await screen.findByText('Schema overrides saved')).toBeDefined();
    await waitFor(() => expect(screen.getByText('3 tables · 1 overrides applied')).toBeDefined());
    expect(screen.getAllByText('Clients').length).toBeGreaterThan(0);

    // Regenerate: counts from the generate reply + generated_hash copy.
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate pages' }));
    expect(await screen.findByText('1 created · 2 updated · 2 unchanged')).toBeDefined();
    expect(
      screen.getByText(
        'Pages you edited by hand are preserved — only pages with an untouched generated_hash were regenerated in place.',
      ),
    ).toBeDefined();
    expect(harness.generateCalls).toBe(1);
  });

  it('revert-all clears the buffer without saving', async () => {
    const harness = installFetch();
    renderEditor();

    await userEvent.click(await screen.findByRole('button', { name: /Customers/  }));
    await userEvent.type(await screen.findByLabelText('Display label'), 'Clients');
    expect(await screen.findByText('1 change')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Revert all' }));
    expect(screen.queryByText('1 change')).toBeNull();
    expect(harness.putBodies).toHaveLength(0);
  });

  it('maps a 422 back to a danger banner and keeps the change staged', async () => {
    installFetch({
      onPut: () =>
        jsonResponse(422, {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Unknown table "public.customers".',
            details: {
              item: { op: 'table.label', tableName: 'public.customers', columnName: null, value: { label: 'Clients' } },
            },
          },
        }),
    });
    renderEditor();

    await userEvent.click(await screen.findByRole('button', { name: /Customers/  }));
    await userEvent.type(await screen.findByLabelText('Display label'), 'Clients');
    await userEvent.click(await screen.findByRole('button', { name: 'Save overrides' }));

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByText('Save failed: Unknown table "public.customers".')).toBeDefined();
    // The rejected change is still staged for correction.
    expect(screen.getByText('1 change')).toBeDefined();
  });
});
