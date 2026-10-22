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

  const toBox = (): HTMLElement => screen.getByRole('combobox', { name: 'Address columns' });

  it('lists what holds an address first, this table`s and then the linked row`s, and can be searched', async () => {
    const { user, onChange } = renderEmail({ kind: 'email', templateKey: 'thanks', to: { kind: 'field', column: '' } });
    await user.click(toBox());
    const list = await screen.findByRole('listbox');
    const rows = within(list).getAllByRole('option').map((row) => row.textContent);
    // The record's own address, then the customer's (never the customer's name or tier), then the table's other columns.
    expect(rows).toEqual([
      'contactContact · This table · orders',
      'customer_id → emailFrom Customer · customers.email',
      'customer_idCustomer · This table · orders',
      'totalTotal · This table · orders',
    ]);
    await user.keyboard('email');
    await waitFor(() => {
      expect(within(list).getAllByRole('option')).toHaveLength(1);
    });
    await user.click(within(list).getByRole('option'));
    expect(onChange).toHaveBeenLastCalledWith({ to: { kind: 'field', column: 'customer_id.email' } });
  });

  it('says in the comp`s words when the column is not an address, and not when it is, one hop away too', async () => {
    const { user } = renderEmail({ kind: 'email', templateKey: 'thanks', to: { kind: 'field', column: 'customer_id' } });
    expect(screen.getByRole('alert').textContent).toBe('customer_id is not an address. Choose a column that holds one.');
    expect(toBox().getAttribute('aria-invalid')).toBe('true');
    cleanup();
    renderEmail({ kind: 'email', templateKey: 'thanks', to: { kind: 'field', column: 'customer_id.email' } });
    expect(screen.queryByTestId('email-to-not-address')).toBeNull();
    cleanup();
    // A step that already names a linked column that is no address keeps it in the list, and is warned.
    renderEmail({ kind: 'email', templateKey: 'thanks', to: { kind: 'field', column: 'customer_id.name' } });
    expect(screen.getByTestId('email-to-not-address')).toBeTruthy();
    await user.click(toBox());
    expect(within(await screen.findByRole('listbox')).getAllByRole('option').map((row) => row.textContent)).toContain('customer_id → nameFrom Customer · customers.name');
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


describe('ActionSettings — the people listed on the record', () => {
  const DEALS = table('main.deals', 'Deals', {
    columns: [column('owner_id', { label: 'Owner', staff: true })],
    listings: [
      { table: 'main.deal_members', label: 'People on deals' },
      { table: 'main.covers', label: 'Covers' },
    ],
  });
  const WITH: Sources = { ...SOURCES, templates: [{ key: 'news', name: 'News', placeholders: [], ownedByApp: false }] };

  function renderStep(action: Action, of: SourceTable = DEALS) {
    const onChange = vi.fn();
    render(<ActionSettings action={action} sources={WITH} table={of} connectionId="cnx_1" onChange={onChange} />);
    return { onChange, user: userEvent.setup() };
  }

  it('offers a notice to them where the table lists people, and picks which listing', async () => {
    const { user, onChange } = renderStep({ kind: 'notification', to: null, title: 'Hello', body: null });
    await user.selectOptions(screen.getByTestId('notif-mode'), 'The people listed on this record');
    expect(onChange).toHaveBeenLastCalledWith({ to: { listed: '' } });
    cleanup();
    const again = renderStep({ kind: 'notification', to: { listed: '' }, title: 'Hello', body: null });
    expect(within(screen.getByTestId('notif-listed')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Choose a table…', 'People on deals', 'Covers']);
    await again.user.selectOptions(screen.getByTestId('notif-listed'), 'People on deals');
    expect(again.onChange).toHaveBeenLastCalledWith({ to: { listed: 'main.deal_members' } });
    expect(screen.getByText(/only those who can sign in and open this record are told/)).toBeTruthy();
  });

  it('offers a mail to each of them, and nothing of the kind where the table lists nobody', async () => {
    const { user, onChange } = renderStep({ kind: 'email', templateKey: 'news', to: null, vars: {} });
    await user.selectOptions(screen.getByTestId('email-to-kind'), 'The people listed on this record');
    expect(onChange).toHaveBeenLastCalledWith({ to: { kind: 'listed', table: '' } });
    cleanup();
    renderStep({ kind: 'email', templateKey: 'news', to: null, vars: {} }, table('main.orders', 'Orders'));
    expect(within(screen.getByTestId('email-to-kind')).queryByText('The people listed on this record')).toBeNull();
    cleanup();
    // A step that already says it keeps it, and its table, whatever the table lists now.
    renderStep({ kind: 'notification', to: { listed: 'main.gone' }, title: 'Hello', body: null }, table('main.orders', 'Orders'));
    expect((screen.getByTestId('notif-mode') as HTMLSelectElement).value).toBe('listed');
    expect((screen.getByTestId('notif-listed') as HTMLSelectElement).value).toBe('main.gone');
  });
});

describe('ActionSettings — a notice an app tells in several languages', () => {
  const NOTICE: Action = { kind: 'notification', to: { roles: [] }, title: 'Won: {{record.name}}', body: 'Card.', locales: { 'en-US': { title: 'Won', body: 'Card.' }, 'de-DE': { title: 'Gewonnen', body: 'Karte.' } } };

  it('says which languages it carries, and a change of its words makes one text for everybody', async () => {
    const { user, onChange } = renderSettings(NOTICE);
    expect(screen.getByTestId('notif-languages').textContent).toContain('German');
    await user.type(screen.getByTestId('notif-title'), '!');
    expect(onChange).toHaveBeenLastCalledWith({ title: 'Won: {{record.name}}!', locales: undefined });
    cleanup();
    // A step written here carries no other language, and says nothing of it.
    renderSettings({ kind: 'notification', to: { roles: [] }, title: 'Hello', body: null });
    expect(screen.queryByTestId('notif-languages')).toBeNull();
  });
});
