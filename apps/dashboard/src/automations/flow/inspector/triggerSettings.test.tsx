// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The trigger inspector's two table pickers (42-automations-and-workflow-
 * logs.md D25, D4, D5): both are searchable `Combobox`es; the record one
 * carries its connection in the value, the for-each one lists only the
 * connection a scan could actually read.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import type { SourceConnection, SourceTable, Sources } from '../../api.js';
import type { Trigger } from '../../model/graph.js';
import { TriggerSettings } from './TriggerSettings.js';

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

const TWO: Sources = {
  ...ONE,
  connections: [
    connection('cnx_1', 'Northwind', [table('main.orders', 'orders')]),
    // Same table id as the first connection — by id alone the write picked
    // whichever connection came first.
    connection('cnx_2', 'Billing', [table('main.orders', 'orders'), table('main.invoices', 'invoices')]),
  ],
};

const RECORD: Extract<Trigger, { kind: 'record' }> = {
  kind: 'record',
  event: 'created',
  connectionId: 'cnx_1',
  table: '',
  watch: false,
};

const SCHEDULE: Extract<Trigger, { kind: 'schedule' }> = {
  kind: 'schedule',
  connectionId: null,
  schedule: { kind: 'interval', everyMinutes: '15' },
};

function renderSettings(trigger: Trigger, sources: Sources = ONE, table: SourceTable | null = null) {
  const onChange = vi.fn();
  render(<TriggerSettings trigger={trigger} sources={sources} table={table} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

const tableBox = (): HTMLElement => screen.getByRole('combobox', { name: 'Table' });
const whenBox = (): HTMLSelectElement => screen.getByTestId('trig-kind');
const forEachBox = (): HTMLElement => screen.getByRole('combobox', { name: 'For each record of' });

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('TriggerSettings — the table pickers', () => {
  it('the record trigger searches its tables', async () => {
    const { user } = renderSettings(RECORD);
    await user.click(tableBox());
    const list = await screen.findByRole('listbox');
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

  it('picking a table clears the changed column and re-reads watch for the event (D4)', async () => {
    const { user, onChange } = renderSettings({ ...RECORD, event: 'created', changedColumn: 'x' });
    await user.click(tableBox());
    // `customers` has an updated_at and no creation stamp: a create cannot be watched.
    await user.click(await screen.findByRole('option', { name: 'customers' }));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'record',
      event: 'created',
      connectionId: 'cnx_1',
      table: 'main.customers',
      changedColumn: null,
      watch: false,
    });
  });

  it('an update on the same table IS watched', async () => {
    const { user, onChange } = renderSettings({ ...RECORD, event: 'updated' });
    await user.click(tableBox());
    await user.click(await screen.findByRole('option', { name: 'customers' }));
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ table: 'main.customers', watch: true });
  });

  it('carries the connection in the value, so two connections stay apart (F4)', async () => {
    const { user, onChange } = renderSettings(RECORD, TWO);
    await user.click(tableBox());
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual([
      'Northwind · orders',
      'Billing · orders',
      'Billing · invoices',
    ]);
    await user.click(within(list).getByRole('option', { name: 'Billing · orders' }));
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      connectionId: 'cnx_2',
      table: 'main.orders',
    });
  });

  it('shows the table already on the trigger', () => {
    renderSettings({ ...RECORD, table: 'main.orders' }, TWO);
    expect((tableBox() as HTMLInputElement).value).toBe('Northwind · orders');
  });

  it('the for-each picker offers the no-table row and the scanned connection only', async () => {
    const { user } = renderSettings(SCHEDULE, TWO);
    await user.click(forEachBox());
    const list = await screen.findByRole('listbox');
    // `connectionId` is null, so the scan would read the first connection.
    expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual([
      'No table — one run per tick',
      'orders',
    ]);
  });

  it('picking a for-each table pins the connection the scan resolves against (D5)', async () => {
    const { user, onChange } = renderSettings({ ...SCHEDULE, connectionId: 'cnx_2' }, TWO);
    await user.click(forEachBox());
    await user.click(await screen.findByRole('option', { name: 'invoices' }));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'schedule',
      connectionId: 'cnx_2',
      schedule: { kind: 'interval', everyMinutes: '15' },
      forEach: { table: 'main.invoices', where: [], once: true },
    });
  });

  it('the no-table row clears for-each', async () => {
    const { user, onChange } = renderSettings({
      ...SCHEDULE,
      connectionId: 'cnx_1',
      forEach: { table: 'main.orders', where: [], once: true },
    });
    expect((forEachBox() as HTMLInputElement).value).toBe('orders');
    await user.click(forEachBox());
    await user.click(await screen.findByRole('option', { name: 'No table — one run per tick' }));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'schedule',
      connectionId: 'cnx_1',
      schedule: { kind: 'interval', everyMinutes: '15' },
    });
  });
});

describe('TriggerSettings — "When"', () => {
  it('is ONE control offering the three events and the clock', () => {
    renderSettings({ ...RECORD, table: 'main.orders' });
    // It used to be two selects both named "When", the first of which always
    // read "A record is created" whatever the event was.
    expect(screen.getAllByRole('combobox', { name: 'When' })).toHaveLength(1);
    expect([...whenBox().options].map((option) => option.textContent)).toEqual([
      'A record is created',
      'A record is updated',
      'A record is deleted',
      'On a schedule',
    ]);
  });

  it('shows the event the trigger actually carries', () => {
    renderSettings({ ...RECORD, event: 'updated', table: 'main.orders' });
    expect(whenBox().value).toBe('updated');
  });

  it('changing the event keeps the table', async () => {
    const { user, onChange } = renderSettings({ ...RECORD, table: 'main.orders', watch: true });
    await user.selectOptions(whenBox(), 'deleted');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'record', event: 'deleted', table: 'main.orders' }),
    );
  });

  it('drops a watch the new event cannot honour, and never turns one on (D4)', async () => {
    // `customers` has an updated_at and no creation stamp.
    const customers = ONE.connections[0]?.tables[2] ?? null;
    const { user, onChange } = renderSettings(
      { ...RECORD, event: 'updated', table: 'main.customers', watch: true },
      ONE,
      customers,
    );
    await user.selectOptions(whenBox(), 'created');
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ event: 'created', watch: false });

    onChange.mockClear();
    await user.selectOptions(whenBox(), 'deleted');
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ event: 'deleted', watch: false });
  });

  it('keeps an explicit "off" when the new event could be watched', async () => {
    const orders = ONE.connections[0]?.tables[0] ?? null;
    const { user, onChange } = renderSettings(
      { ...RECORD, event: 'created', table: 'main.orders', watch: false },
      ONE,
      orders,
    );
    await user.selectOptions(whenBox(), 'updated');
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ event: 'updated', watch: false });
  });

  it('switches to a schedule and back, carrying the connection', async () => {
    const { user, onChange } = renderSettings({ ...RECORD, table: 'main.orders' });
    await user.selectOptions(whenBox(), 'schedule');
    expect(onChange).toHaveBeenCalledWith({
      kind: 'schedule',
      connectionId: 'cnx_1',
      schedule: { kind: 'interval', everyMinutes: '15' },
    });

    const back = renderSettings({ ...SCHEDULE, connectionId: 'cnx_1' });
    await back.user.selectOptions(screen.getAllByTestId('trig-kind')[1] as HTMLSelectElement, 'updated');
    expect(back.onChange).toHaveBeenCalledWith({
      kind: 'record',
      event: 'updated',
      connectionId: 'cnx_1',
      table: '',
      watch: false,
    });
  });
});
