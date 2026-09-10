// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The New-rule modal's trigger fields (42-automations-and-workflow-logs.md
 * D25, FILL F1/F4): "When" offers four events and no table; the table is a
 * searchable `Combobox` that appears for the three record events only.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../i18n/testing.js';
import type { SourceConnection, SourceTable, Sources } from '../api.js';
import { NewRuleModal } from './NewRuleModal.js';

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

const ONE: Sources = {
  connections: [
    connection('cnx_1', 'Northwind', [
      table('main.orders', 'orders'),
      table('main.order_details', 'order_details'),
      table('main.customers', 'customers', { watch: { created: null, updated: 'updated_at' } }),
    ]),
  ],
  templates: [],
  roles: [],
};

function renderModal(sources: Sources = ONE) {
  const onCreate = vi.fn().mockResolvedValue({ enabled: false });
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<NewRuleModal open sources={sources} onClose={onClose} onCreate={onCreate} onDone={onDone} />);
  return { onCreate, onClose, onDone, user: userEvent.setup() };
}

const trigger = (): HTMLSelectElement => screen.getByTestId('new-rule-trigger');
const tableBox = (): HTMLElement => screen.getByRole('combobox', { name: 'Table' });
const create = (): HTMLButtonElement => screen.getByTestId('new-rule-create');

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('NewRuleModal — the trigger fields', () => {
  it('offers four events and never names a table in them (D25)', () => {
    renderModal();
    expect([...trigger().options].map((option) => option.textContent)).toEqual([
      'When (trigger)',
      'A record is created',
      'A record is updated',
      'A record is deleted',
      'On a schedule',
    ]);
  });

  it('reveals the table picker for a record event and hides it for a schedule', async () => {
    const { user } = renderModal();
    expect(screen.queryByTestId('new-rule-table')).toBeNull();
    await user.selectOptions(trigger(), 'created');
    expect(screen.getByTestId('new-rule-table')).toBeDefined();
    await user.selectOptions(trigger(), 'schedule');
    expect(screen.queryByTestId('new-rule-table')).toBeNull();
  });

  it('the table picker searches (the reason it is a Combobox, not a Select)', async () => {
    const { user } = renderModal();
    await user.selectOptions(trigger(), 'created');
    await user.click(tableBox());
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual([
      'orders',
      'order_details',
      'customers',
    ]);
    await user.keyboard('ord');
    await waitFor(() => {
      expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual([
        'orders',
        'order_details',
      ]);
    });
  });

  it('prefixes the connection when there is more than one (F4)', async () => {
    const { user } = renderModal({
      ...ONE,
      connections: [
        connection('cnx_1', 'Northwind', [table('main.orders', 'orders')]),
        connection('cnx_2', 'Billing', [table('public.invoices', 'invoices')]),
      ],
    });
    await user.selectOptions(trigger(), 'created');
    await user.click(tableBox());
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual([
      'Northwind · orders',
      'Billing · invoices',
    ]);
  });

  it('leaves out a table the user cannot read', async () => {
    const { user } = renderModal({
      ...ONE,
      connections: [
        connection('cnx_1', 'Northwind', [
          table('main.orders', 'orders'),
          table('main.audit', 'audit', { canRead: false }),
        ]),
      ],
    });
    await user.selectOptions(trigger(), 'created');
    await user.click(tableBox());
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual(['orders']);
  });

  it('cannot be created until a record event has its table', async () => {
    const { user } = renderModal();
    await user.type(screen.getByTestId('new-rule-name'), 'Welcome new signups');
    expect(create().disabled).toBe(true);
    await user.selectOptions(trigger(), 'created');
    expect(create().disabled).toBe(true);
    await user.click(tableBox());
    await user.click(await screen.findByRole('option', { name: 'orders' }));
    expect(create().disabled).toBe(false);
  });

  it('a schedule needs no table', async () => {
    const { user } = renderModal();
    await user.type(screen.getByTestId('new-rule-name'), 'Nightly digest');
    await user.selectOptions(trigger(), 'schedule');
    expect(create().disabled).toBe(false);
  });

  it('submits the event and the table as one record trigger', async () => {
    const { user, onCreate } = renderModal();
    await user.type(screen.getByTestId('new-rule-name'), 'Chase the order');
    await user.selectOptions(trigger(), 'updated');
    await user.click(tableBox());
    await user.click(await screen.findByRole('option', { name: 'orders' }));
    await user.click(create());
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      name: 'Chase the order',
      trigger: {
        kind: 'record',
        event: 'updated',
        connectionId: 'cnx_1',
        table: 'main.orders',
        watch: true,
      },
    });
  });

  it('keeps the table when the event changes, and re-reads watch per event (D4)', async () => {
    const { user, onCreate } = renderModal();
    await user.type(screen.getByTestId('new-rule-name'), 'Greet the customer');
    await user.selectOptions(trigger(), 'updated');
    await user.click(tableBox());
    // `customers` has an updated_at and no creation stamp.
    await user.click(await screen.findByRole('option', { name: 'customers' }));
    await user.selectOptions(trigger(), 'created');
    expect((tableBox() as HTMLInputElement).value).toBe('customers');
    await user.click(create());
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      trigger: { kind: 'record', event: 'created', table: 'main.customers', watch: false },
    });
  });

  it('a delete is never watched (D4)', async () => {
    const { user, onCreate } = renderModal();
    await user.type(screen.getByTestId('new-rule-name'), 'Log the delete');
    await user.selectOptions(trigger(), 'deleted');
    await user.click(tableBox());
    await user.click(await screen.findByRole('option', { name: 'orders' }));
    await user.click(create());
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    expect(onCreate.mock.calls[0]?.[0]).toMatchObject({
      trigger: { kind: 'record', event: 'deleted', table: 'main.orders', watch: false },
    });
  });
});
