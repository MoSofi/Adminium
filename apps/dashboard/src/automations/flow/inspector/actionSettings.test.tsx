// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The action inspector's one table picker — Create record's target: a
 * searchable `Combobox` over the tables this step could actually write,
 * which is the TRIGGER's connection and nothing else (`runner.ts`
 * `openSource`).
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

describe('ActionSettings — a webhook header value', () => {
  const HOOK: Extract<Action, { kind: 'webhook' }> = {
    kind: 'webhook',
    url: 'https://crm.example.test/hook',
    method: 'POST',
    bodyKind: 'json',
    body: null,
    headerName: 'Authorization',
    headerValueEncrypted: null,
  };
  const valueBox = (): HTMLInputElement => screen.getByTestId('hook-header-value');

  it('is typed write-only, and says a saved one is there without showing it', async () => {
    const { onChange, user } = renderSettings({ ...HOOK, headerValueSet: true });
    expect(valueBox().type).toBe('password');
    expect(valueBox().value).toBe('');
    expect(valueBox().placeholder).toBe('••••••••');
    await user.type(valueBox(), 'x');
    expect(onChange).toHaveBeenLastCalledWith({ headerValue: 'x' });
  });

  it('shows no dots when nothing is saved, and waits for a header name', () => {
    renderSettings({ ...HOOK, headerName: null });
    expect(valueBox().placeholder).toBe('');
    expect(valueBox().disabled).toBe(true);
  });
});

describe('ActionSettings — an email step’s placeholders', () => {
  const ORDERS = table('main.orders', 'orders', { columns: [column('name'), column('total')] });
  const WITH_TEMPLATES: Sources = {
    ...SOURCES,
    templates: [
      { key: 'thanks', name: 'Thanks', placeholders: ['first_name', 'total', 'appName'], ownedByApp: false },
      { key: 'ready', name: 'Order ready', placeholders: ['order.number'], ownedByApp: true },
      { key: 'plain', name: 'Plain', placeholders: [], ownedByApp: false },
    ],
  };

  function renderEmail(action: Extract<Action, { kind: 'email' }>) {
    const onChange = vi.fn();
    render(<ActionSettings action={action} sources={WITH_TEMPLATES} table={ORDERS} connectionId="cnx_1" onChange={onChange} />);
    return { onChange, user: userEvent.setup() };
  }

  const state = (name: string): string | null => screen.getByTestId(`email-ph-state-${name}`).textContent;

  it('lists what the template reads and says what fills each one', () => {
    renderEmail({ kind: 'email', templateKey: 'thanks', to: null });
    expect(state('first_name')).toBe('Not filled');
    expect(state('total')).toBe('From this record');
    expect(state('appName')).toBe('Filled by the rule');
    // Only the one the record does not fill asks what should.
    expect(screen.getAllByRole('combobox', { name: /^Fill / }).map((box) => box.getAttribute('aria-label'))).toEqual([
      'Fill {{first_name}} with',
    ]);
  });

  it('fills one from a column, or from a text typed for it', async () => {
    const { user, onChange } = renderEmail({ kind: 'email', templateKey: 'thanks', to: null });
    await user.selectOptions(screen.getByTestId('email-ph-fill-first_name'), 'name');
    expect(onChange).toHaveBeenLastCalledWith({ vars: { first_name: '{{record.name}}' } });
    await user.selectOptions(screen.getByTestId('email-ph-fill-first_name'), 'A text');
    expect(onChange).toHaveBeenLastCalledWith({ vars: { first_name: '' } });
  });

  it('shows a mapped one as filled by the step, with its text to edit, and un-fills it', async () => {
    const { user, onChange } = renderEmail({ kind: 'email', templateKey: 'thanks', to: null, vars: { first_name: 'friend' } });
    expect(state('first_name')).toBe('Filled by this step');
    expect((screen.getByRole('textbox', { name: 'Text for {{first_name}}' }) as HTMLInputElement).value).toBe('friend');
    await user.selectOptions(screen.getByTestId('email-ph-fill-first_name'), 'Not filled');
    expect(onChange).toHaveBeenLastCalledWith({ vars: {} });
  });

  it('says so when the template is an app’s own, and shows nothing for a template that reads nothing', () => {
    const { unmount } = render(
      <ActionSettings action={{ kind: 'email', templateKey: 'ready', to: null }} sources={WITH_TEMPLATES} table={ORDERS} connectionId="cnx_1" onChange={vi.fn()} />,
    );
    expect(screen.getByTestId('email-placeholders').textContent).toContain('This template belongs to an app');
    expect(state('order.number')).toBe('Not filled');
    unmount();
    renderEmail({ kind: 'email', templateKey: 'plain', to: null });
    expect(screen.queryByTestId('email-placeholders')).toBeNull();
  });

  it('picking another template keeps only the entries it reads', async () => {
    const { user, onChange } = renderEmail({ kind: 'email', templateKey: 'thanks', to: null, vars: { first_name: 'friend' } });
    await user.selectOptions(screen.getByTestId('email-template'), 'Order ready');
    expect(onChange).toHaveBeenLastCalledWith({ templateKey: 'ready', vars: {} });
  });
});

describe('ActionSettings — an email step that reaches the row a link points at', () => {
  const CUSTOMER = [column('name', { label: 'Name' }), column('email', { label: 'Email', emailLike: true, pii: true }), column('tier', { label: 'Tier' })];
  const ORDERS = table('main.orders', 'orders', {
    columns: [column('customer_id', { label: 'Customer' }), column('contact', { label: 'Contact', emailLike: true }), column('total', { label: 'Total' })],
    links: [{ column: 'customer_id', table: 'main.customers', label: 'customers', columns: CUSTOMER }],
  });
  const WITH: Sources = { ...SOURCES, templates: [{ key: 'thanks', name: 'Thanks', placeholders: ['first_name', 'customer_id.tier'], ownedByApp: false }], templatesOff: 2 };

  function renderEmail(action: Extract<Action, { kind: 'email' }>, sources: Sources = WITH) {
    const onChange = vi.fn();
    render(<ActionSettings action={action} sources={sources} table={ORDERS} connectionId="cnx_1" onChange={onChange} />);
    return { onChange, user: userEvent.setup() };
  }

  it('offers the address of the linked row beside the record`s own, and only address columns of it', async () => {
    const { user, onChange } = renderEmail({ kind: 'email', templateKey: 'thanks', to: { kind: 'field', column: '' } });
    const select = screen.getByTestId('email-to-column');
    const options = within(select).getAllByRole('option').map((option) => [option.getAttribute('value'), option.textContent]);
    // The record's own address column first; then the one a link leads to. The customer's name and tier are not addresses.
    expect(options).toEqual([
      ['', 'Column'],
      ['contact', 'Contact'],
      ['customer_id', 'Customer'],
      ['total', 'Total'],
      ['customer_id.email', 'Customer → Email'],
    ]);
    expect(within(select).getByRole('group', { name: 'Customer (customers)' })).toBeTruthy();
    await user.selectOptions(select, 'customer_id.email');
    expect(onChange).toHaveBeenLastCalledWith({ to: { kind: 'field', column: 'customer_id.email' } });
  });

  it('warns under the column when it holds no addresses, and not when it does, one hop away too', () => {
    renderEmail({ kind: 'email', templateKey: 'thanks', to: { kind: 'field', column: 'customer_id' } });
    expect(screen.getByTestId('email-to-not-address').textContent).toContain('does not look like it holds email addresses');
    cleanup();
    renderEmail({ kind: 'email', templateKey: 'thanks', to: { kind: 'field', column: 'customer_id.email' } });
    expect(screen.queryByTestId('email-to-not-address')).toBeNull();
    cleanup();
    // A step that already names a linked column that is no address keeps it in the list, and is warned.
    renderEmail({ kind: 'email', templateKey: 'thanks', to: { kind: 'field', column: 'customer_id.name' } });
    expect((screen.getByTestId('email-to-column') as HTMLSelectElement).value).toBe('customer_id.name');
    expect(screen.getByTestId('email-to-not-address')).toBeTruthy();
  });

  it('knows a placeholder the linked row fills, and fills another from it', async () => {
    const { user, onChange } = renderEmail({ kind: 'email', templateKey: 'thanks', to: null });
    expect(screen.getByTestId('email-ph-state-customer_id.tier').textContent).toBe('From this record');
    await user.selectOptions(screen.getByTestId('email-ph-fill-first_name'), 'Customer → Name');
    expect(onChange).toHaveBeenLastCalledWith({ vars: { first_name: '{{record.customer_id.name}}' } });
  });

  it('says how many templates are switched off and where they are, and nothing when none is', () => {
    renderEmail({ kind: 'email', templateKey: null, to: null });
    const line = screen.getByTestId('email-templates-off');
    expect(line.textContent).toContain('2 templates are switched off and not shown.');
    expect(within(line).getByRole('link', { name: 'Open Email templates' }).getAttribute('href')).toBe('/email-templates');
    cleanup();
    renderEmail({ kind: 'email', templateKey: null, to: null }, { ...WITH, templatesOff: 0 });
    expect(screen.queryByTestId('email-templates-off')).toBeNull();
  });
});

