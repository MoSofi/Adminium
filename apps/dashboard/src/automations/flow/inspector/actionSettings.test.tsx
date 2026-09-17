// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The action inspector's one table picker — Create record's target: a
 * searchable `Combobox` over the tables this step could actually write,
 * which is the TRIGGER's connection and nothing else (`runner.ts`
 * `openSource`).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import type { SourceColumn, SourceConnection, SourceTable, Sources } from '../../api.js';
import type { Action } from '../../model/graph.js';
import { ActionSettings } from './ActionSettings.js';

function column(name: string, over: Partial<SourceColumn> = {}): SourceColumn {
  return {
    name,
    label: name,
    logicalType: 'varchar',
    isPk: false,
    pii: false,
    emailLike: false,
    dateLike: false,
    ...over,
  };
}

function table(id: string, label: string, over: Partial<SourceTable> = {}): SourceTable {
  return {
    id,
    label,
    canRead: true,
    canCreate: true,
    canUpdate: true,
    watch: { created: 'created_at', updated: 'updated_at' },
    columns: [],
    children: [],
    pageSlug: null,
    ...over,
  };
}

function connection(id: string, name: string, tables: SourceTable[]): SourceConnection {
  return { id, name, dialect: 'sqlite', timezone: 'UTC', tables };
}

const SOURCES: Sources = {
  connections: [
    connection('cnx_1', 'Northwind', [
      table('main.orders', 'orders', { columns: [column('ship_city'), column('secret', { pii: true })] }),
      table('main.order_details', 'order_details'),
      table('main.customers', 'customers'),
      table('main.audit', 'audit', { canCreate: false }),
    ]),
    connection('cnx_2', 'Billing', [table('public.invoices', 'invoices')]),
  ],
  templates: [],
  roles: [],
};

const CREATE: Extract<Action, { kind: 'record.create' }> = {
  kind: 'record.create',
  table: null,
  values: {},
};

function renderSettings(action: Action, connectionId: string | null = 'cnx_1') {
  const onChange = vi.fn();
  render(
    <ActionSettings
      action={action}
      sources={SOURCES}
      table={null}
      connectionId={connectionId}
      onChange={onChange}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

const tableBox = (): HTMLElement => screen.getByRole('combobox', { name: 'Table' });

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('ActionSettings — the Create-record table picker', () => {
  it('offers the trigger connection’s creatable tables, and searches them', async () => {
    const { user } = renderSettings(CREATE);
    await user.click(tableBox());
    const list = await screen.findByRole('listbox');
    // `main.audit` cannot be created in; `public.invoices` is another
    // connection, which this step could never write.
    expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual([
      'orders',
      'order_details',
      'customers',
    ]);
    await user.keyboard('cust');
    await waitFor(() => {
      expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual(['customers']);
    });
  });

  it('follows the trigger when the rule is on another connection', async () => {
    const { user } = renderSettings(CREATE, 'cnx_2');
    await user.click(tableBox());
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual(['invoices']);
  });

  it('picking a table drops the values, which named the old table’s columns', async () => {
    const { user, onChange } = renderSettings({
      ...CREATE,
      table: 'main.customers',
      values: { company_name: 'Acme' },
    });
    expect((tableBox() as HTMLInputElement).value).toBe('customers');
    await user.click(tableBox());
    await user.click(await screen.findByRole('option', { name: 'orders' }));
    expect(onChange).toHaveBeenCalledWith({ table: 'main.orders', values: {} });
  });

  it('the column lists read the picked table', async () => {
    const { user } = renderSettings({ ...CREATE, table: 'main.orders' });
    await user.click(screen.getByRole('combobox', { name: 'Add a value' }));
    // A pii column is never offered as a write target.
    expect(
      [...(screen.getByRole('combobox', { name: 'Add a value' }) as HTMLSelectElement).options].map(
        (option) => option.textContent,
      ),
    ).toEqual(['Add a value', 'ship_city']);
  });

  it('Update field writes to the trigger’s own record, so it has no table picker', () => {
    renderSettings({ kind: 'record.update', values: {} });
    expect(screen.queryByRole('combobox', { name: 'Table' })).toBeNull();
  });
});
