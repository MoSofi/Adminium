// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The condition card's "Count of" table picker (42-automations-and-workflow-
 * logs.md FILL F5, D25's residual): searchable, and scoped to the rule's own
 * connection — `register.ts`'s `countRelated` loads the snapshot view of the
 * connection the event came from, so a table from any other one is a
 * run-time "unknown table".
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../../../i18n/testing.js';
import type { SourceConnection, SourceTable, Sources } from '../../api.js';
import type { Condition, FlowNode, Trigger } from '../../model/graph.js';
import { ConditionCard } from './ConditionCard.js';
import { StepInspector } from '../StepInspector.js';

function table(id: string, label: string): SourceTable {
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
  };
}

function connection(id: string, name: string, tables: SourceTable[]): SourceConnection {
  return { id, name, dialect: 'sqlite', timezone: 'UTC', tables };
}

const NORTHWIND = [
  table('main.orders', 'orders'),
  table('main.order_details', 'order_details'),
  table('main.customers', 'customers'),
];

const SOURCES: Sources = {
  connections: [
    connection('cnx_1', 'Northwind', NORTHWIND),
    connection('cnx_2', 'Billing', [table('public.invoices', 'invoices')]),
  ],
  templates: [],
  roles: [],
};

const COUNT: Condition = {
  left: { count: { table: '', matchColumn: '', equalsField: '' } },
  op: 'gt',
  right: 0,
};

const countBox = (): HTMLElement => screen.getByRole('combobox', { name: 'Count of' });

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});

describe('ConditionCard — the counted table', () => {
  it('searches the tables it is given', async () => {
    const user = userEvent.setup();
    render(<ConditionCard condition={COUNT} columns={[]} tables={NORTHWIND} onChange={vi.fn()} />);
    await user.click(countBox());
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual([
      'orders',
      'order_details',
      'customers',
    ]);
    await user.keyboard('deta');
    await waitFor(() => {
      expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual([
        'order_details',
      ]);
    });
  });

  it('picking a table clears the match column, which named the old one’s', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionCard
        condition={{ ...COUNT, left: { count: { table: 'main.orders', matchColumn: 'order_id', equalsField: 'id' } } }}
        columns={[]}
        tables={NORTHWIND}
        onChange={onChange}
      />,
    );
    expect((countBox() as HTMLInputElement).value).toBe('orders');
    await user.click(countBox());
    await user.click(await screen.findByRole('option', { name: 'customers' }));
    expect(onChange).toHaveBeenCalledWith({
      ...COUNT,
      left: { count: { table: 'main.customers', matchColumn: '', equalsField: 'id' } },
    });
  });
});

describe('StepInspector — what the condition card may count', () => {
  const node: FlowNode = {
    id: 'n2',
    kind: 'condition',
    title: 'Only if',
    onError: false,
    condition: COUNT,
  };

  function renderInspector(trigger: Trigger) {
    render(
      <StepInspector
        node={node}
        trigger={trigger}
        sources={SOURCES}
        table={null}
        onClose={vi.fn()}
        onTitle={vi.fn()}
        onSub={vi.fn()}
        onCondition={vi.fn()}
        onBranchLabel={vi.fn()}
        onToggleError={vi.fn()}
        onAction={vi.fn()}
        onTrigger={vi.fn()}
        onWait={vi.fn()}
        onMove={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    return userEvent.setup();
  }

  it('offers the trigger connection’s tables and no others', async () => {
    const user = renderInspector({
      kind: 'record',
      event: 'created',
      connectionId: 'cnx_1',
      table: 'main.orders',
      watch: false,
    });
    await user.click(countBox());
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual([
      'orders',
      'order_details',
      'customers',
    ]);
  });

  it('follows the rule onto another connection', async () => {
    const user = renderInspector({
      kind: 'record',
      event: 'created',
      connectionId: 'cnx_2',
      table: 'public.invoices',
      watch: false,
    });
    await user.click(countBox());
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option').map((row) => row.textContent)).toEqual(['invoices']);
  });
});
