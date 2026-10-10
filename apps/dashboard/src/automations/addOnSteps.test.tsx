// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A step an add-on gives, in the builder (comp `Milo Automations`, 05): its
 * own group in the step menu, its fields drawn from the add-on's description,
 * the add-on's name over its card, and what the card says once the add-on is
 * gone. What the server offers is `Sources`; nothing here asks a server.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installTestI18n } from '../i18n/testing.js';
import type { SourceStep, SourceTable, Sources } from './api.js';
import { FlowBuilder, type FlowBuilderProps } from './flow/FlowBuilder.js';
import { ActionSettings } from './flow/inspector/ActionSettings.js';
import { StepPicker } from './flow/StepPicker.js';
import { addOnNameOf, addOnStepTiles, columnOfInput, inputMode, isStepReady, stepOf, type StepAction } from './model/addOnSteps.js';
import type { Graph } from './model/graph.js';
import { subLineFor } from './model/summaries.js';
import { firstIncompleteNode } from './model/validate.js';

const words = (text: string) => ({ 'en-US': text, 'de-DE': `${text} (de)` });
const column = (name: string, emailLike = false) => ({ name, label: name, logicalType: 'varchar', isPk: false, pii: false, emailLike, dateLike: false });

const ORDERS: SourceTable = {
  id: 'main.orders',
  label: 'orders',
  canRead: true,
  canCreate: true,
  canUpdate: true,
  watch: { created: null, updated: null },
  columns: [column('id'), column('customer_id'), column('note'), column('contact_email', true)],
  links: [{ column: 'customer_id', table: 'main.customers', label: 'customers', columns: [column('email', true), column('first_name')] }],
  children: [],
  pageSlug: null,
} as unknown as SourceTable;

const VOUCHER: SourceStep = {
  addOn: 'offers',
  addOnName: 'Offers & gift cards',
  key: 'issue-voucher',
  name: words('Issue a voucher'),
  does: words('Sends a voucher from one of your offers'),
  table: 'main.offers_vouchers',
  canCreate: true,
  inputs: [
    { key: 'to', label: words('Send to'), kind: 'email', required: true },
    { key: 'name', label: words('Name on the voucher'), kind: 'text', required: false },
    { key: 'worth', label: words('Worth'), kind: 'choice', required: true, options: [{ value: 'percent', label: words('A percentage') }, { value: 'amount', label: words('An amount') }] },
    { key: 'value', label: words('Value'), kind: 'number', required: true },
  ],
};

const sources = (steps: SourceStep[] = [VOUCHER]): Sources => ({ connections: [{ id: 'cnx_1', name: 'Juniper', dialect: 'sqlite', timezone: 'UTC', tables: [ORDERS], steps }], templates: [], roles: [] });
const action = (inputs: Record<string, string> = {}): StepAction => ({ kind: 'add-on.step', addOn: 'offers', step: 'issue-voucher', addOnName: 'Offers & gift cards', inputs });
const noop = (): void => undefined;

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(cleanup);

describe('what the builder knows of a step an add-on gives', () => {
  it('finds it among what is installed, names its add-on, and knows when it is gone', () => {
    expect(stepOf(sources(), 'cnx_1', action())).toBe(VOUCHER);
    expect(stepOf(sources([]), 'cnx_1', action())).toBeNull();
    expect(stepOf(sources(), 'cnx_2', action())).toBeNull();
    expect(addOnNameOf(null, action())).toBe('Offers & gift cards');
    expect(addOnNameOf(null, { ...action(), addOnName: '' })).toBe('offers');
  });

  it('a step is ready when every input it needs is filled; one whose add-on is gone never is', () => {
    const filled = action({ to: '{{record.customer_id.email}}', worth: 'percent', value: '10' });
    expect(isStepReady(filled, VOUCHER)).toBe(true);
    expect(isStepReady(action({ to: 'a@b.example', worth: 'percent' }), VOUCHER)).toBe(false);
    expect(isStepReady(filled, null)).toBe(false);
    const graph = { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'T' }, { id: 'v', kind: 'action', title: 'Issue a voucher', onError: false, action: filled }] } as unknown as Graph;
    expect(firstIncompleteNode(graph, (one) => stepOf(sources(), 'cnx_1', one))).toBeNull();
    expect(firstIncompleteNode(graph, (one) => stepOf(sources([]), 'cnx_1', one))?.id).toBe('v');
  });

  it('reads how an input is filled, and says where the step sends to', () => {
    expect(columnOfInput('{{record.customer_id.email}}')).toBe('customer_id.email');
    expect(columnOfInput('Dear {{record.note}}')).toBeNull();
    expect(inputMode(VOUCHER.inputs[0]!, '')).toBe('column');
    expect(inputMode(VOUCHER.inputs[0]!, 'a@b.example')).toBe('text');
    expect(inputMode(VOUCHER.inputs[3]!, '')).toBe('text');
    const node = { id: 'v', kind: 'action', title: 'Issue a voucher', onError: false, action: action({ to: '{{record.customer_id.email}}' }) } as never;
    expect(subLineFor(node, ORDERS)).toBe('→ customer_id → email');
  });
});

describe('the step menu', () => {
  it('lists what add-ons give in a group of its own, each named with its add-on; with none the group is not there', async () => {
    const onPick = vi.fn();
    const { rerender } = render(<StepPicker target={{ index: 2 }} contextLine="At the end of the flow" onPick={onPick} onClose={noop} addOnSteps={addOnStepTiles(sources(), 'cnx_1')} />);
    expect(screen.getByText('From add-ons')).toBeDefined();
    const tile = screen.getByTestId('step-pick-add-on:offers:issue-voucher');
    expect(tile.textContent).toBe('Offers & gift cards: Issue a voucherSends a voucher from one of your offers');
    await userEvent.setup().click(tile);
    expect(onPick.mock.calls[0]![0]).toMatchObject({ label: 'Issue a voucher', action: { kind: 'add-on.step', addOn: 'offers', step: 'issue-voucher', addOnName: 'Offers & gift cards', inputs: {} } });
    rerender(<StepPicker target={{ index: 2 }} contextLine="At the end of the flow" onPick={onPick} onClose={noop} addOnSteps={addOnStepTiles(sources([]), 'cnx_1')} />);
    expect(screen.queryByText('From add-ons')).toBeNull();
  });
});

describe('the step\'s card on the flow', () => {
  const graph = { version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When an order changes' }, { id: 'v', kind: 'action', title: 'Issue a voucher', onError: false, action: action() }] } as unknown as Graph;
  const props = (over: Partial<FlowBuilderProps> = {}): FlowBuilderProps => ({ graph, selectedId: null, runningId: null, ranIds: [], incompleteId: null, onSelect: noop, onRemove: noop, onInsert: noop, onMoveTo: noop, onMoveIntoBranch: noop, subFor: () => '', ...over });

  it('wears its add-on\'s name where another step says ACTION', () => {
    render(<FlowBuilder {...props({ addOnFor: (node) => (node.id === 'v' ? { name: 'Offers & gift cards', gone: null } : null) })} />);
    expect(screen.getByTestId('flow-node-add-on').textContent).toBe('Offers & gift cards');
    expect(screen.queryByTestId('flow-node-gone')).toBeNull();
  });

  it('once the add-on is gone it says so, and offers to remove the step', async () => {
    const onRemove = vi.fn();
    render(<FlowBuilder {...props({ onRemove, addOnFor: (node) => (node.id === 'v' ? { name: 'Offers & gift cards', gone: 'The add-on Offers & gift cards is no longer installed.' } : null) })} />);
    const strip = screen.getByTestId('flow-node-gone');
    expect(strip.getAttribute('role')).toBe('alert');
    expect(strip.textContent).toContain('The add-on Offers & gift cards is no longer installed.');
    await userEvent.setup().click(within(strip).getByRole('button', { name: 'Remove step' }));
    expect(onRemove).toHaveBeenCalledWith('v');
  });
});

describe('the step\'s fields', () => {
  const settings = (current: StepAction, from: Sources = sources()) => {
    const onChange = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ActionSettings action={current} sources={from} table={ORDERS} connectionId="cnx_1" onChange={onChange} />
      </QueryClientProvider>,
    );
    return onChange;
  };

  it('are the add-on\'s own: each input by its label, what is not needed marked, a choice with its options', () => {
    settings(action({ to: '{{record.customer_id.email}}', worth: 'percent' }));
    expect(screen.getByText('Offers & gift cards: Issue a voucher')).toBeDefined();
    expect(screen.getByTestId('add-on-step-does').textContent).toBe('Sends a voucher from one of your offers');
    expect(screen.getByRole('group', { name: 'Send to' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Name on the voucher (optional)' })).toBeDefined();
    expect((screen.getByTestId('add-on-input-to-mode') as HTMLSelectElement).value).toBe('column');
    const to = screen.getByTestId('add-on-input-to');
    expect(`${to.textContent ?? ''} ${(to as HTMLInputElement).value ?? ''} ${to.outerHTML}`).toContain('customer_id → email');
    const worth = screen.getByTestId('add-on-input-worth') as HTMLSelectElement;
    expect([...worth.options].map((option) => option.textContent)).toEqual(['Choose…', 'A percentage', 'An amount']);
    expect(worth.value).toBe('percent');
    // A number is typed unless a column is asked for.
    expect((screen.getByTestId('add-on-input-value-mode') as HTMLSelectElement).value).toBe('text');
  });

  it('write what is typed or chosen into the step\'s inputs, and take an emptied one out', async () => {
    const user = userEvent.setup();
    const onChange = settings(action({ worth: 'percent', value: '1' }));
    await user.type(screen.getByTestId('add-on-input-value'), '0');
    expect(onChange).toHaveBeenLastCalledWith({ inputs: { worth: 'percent', value: '10' } });
    await user.selectOptions(screen.getByTestId('add-on-input-worth'), 'amount');
    expect(onChange).toHaveBeenLastCalledWith({ inputs: { worth: 'amount', value: '1' } });
    await user.selectOptions(screen.getByTestId('add-on-input-worth'), '');
    expect(onChange).toHaveBeenLastCalledWith({ inputs: { value: '1' } });
  });

  it('warn when the column an address is read from holds none', () => {
    settings(action({ to: '{{record.note}}' }));
    expect(screen.getByRole('alert').textContent).toContain('note is not an address. Choose a column that holds one.');
  });

  it('say that the person may not use the step when their role cannot add the add-on\'s rows', () => {
    settings(action(), sources([{ ...VOUCHER, canCreate: false }]));
    expect(screen.getByTestId('add-on-step-no-right').textContent).toBe('Your role may not add rows for Offers & gift cards, so a rule of yours cannot use this step.');
  });

  it('once the add-on is gone: the sentence and the note, and no field to fill', () => {
    settings(action({ to: 'a@b.example' }), sources([]));
    expect(screen.getByTestId('add-on-step-gone').textContent).toBe('The add-on Offers & gift cards is no longer installed.');
    expect(screen.getByText('The step keeps its settings. If the add-on comes back, the step works again; until then the rule cannot be switched on.')).toBeDefined();
    expect(screen.queryByTestId('add-on-input-to')).toBeNull();
  });
});
