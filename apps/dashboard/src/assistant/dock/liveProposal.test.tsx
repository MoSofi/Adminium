// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A proposal in the thread, against a scripted server.
 *
 * WHAT IS WORTH PINNING HERE:
 *
 *  1. nothing of a proposal is drawn before the server has tried it, and the
 *     check is asked for once;
 *  2. the card says what would happen in this app's own counted words, and
 *     what cannot be done in the server's;
 *  3. a confirm sends the hash that was shown and the rows left ticked, and
 *     is never the focused or the default control;
 *  4. a refusal that carries the proposal as it now stands is drawn, and
 *     nothing is claimed to have been written;
 *  5. the undo is offered only with a token in hand, counts what it covers,
 *     and ends with its minute.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readProposal, type AssistantProposal } from '../api.js';
import { askTitle, cellText, doneTitle, fixRequest, referencesText, sharedChange, tableName } from '../proposalModel.js';
import { LiveProposal, type LiveProposalProps } from './LiveProposal.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}
let calls: Call[] = [];
let routes: Record<string, () => unknown> = {};
const ACTIONS = 'POST /api/v1/assistant/sessions/ast_1/turns/atn_1/actions';

class Refusal {
  constructor(
    readonly status: number,
    readonly details: Record<string, unknown>,
  ) {}
}

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown);
    calls.push({ url, method, body });
    const handler = routes[`${method} ${url.split('?')[0] ?? url}`];
    if (handler === undefined) throw new Error(`unscripted request: ${method} ${url}`);
    const answer = handler();
    if (answer instanceof Refusal) {
      const error = { error: { code: 'CONFLICT', message: 'raw server text', requestId: 'req', details: answer.details } };
      return Promise.resolve({ ok: false, status: answer.status, headers: { get: () => null }, json: async () => error, text: async () => JSON.stringify(error) } as unknown as Response);
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: async () => answer } as unknown as Response);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const change = (id: string, before: string, after: string, column = 'status') => ({
  do: 'row.change',
  connectionId: 'c1',
  table: 'main.invoices',
  id,
  values: { [column]: after },
  seen: { [column]: before },
  preview: { kind: 'change', before: { [column]: before }, after: { [column]: after } },
});
const refusedChange = (id: string, message: string, code = 'COLUMN_FORBIDDEN') => ({ do: 'row.change', connectionId: 'c1', table: 'main.invoices', id, values: { total: 1 }, refused: { code, message } });
const open = (actions: unknown[], extra: Record<string, unknown> = {}) => ({ state: 'open', title: 'Mark them paid', actions, madeAt: 1, hash: 'a'.repeat(64), checkedAt: 2, expiresAt: 9e15, ...extra });
const applied = (actions: unknown[], picked: number[], outcome: Record<string, unknown>) => ({ state: 'applied', title: 'Mark them paid', madeAt: 1, actions, picked, outcome, appliedAt: 3 });
const parsed = (raw: unknown): AssistantProposal => readProposal(raw) as AssistantProposal;

function show(proposal: unknown, overrides: Partial<LiveProposalProps> = {}) {
  const props: LiveProposalProps = {
    sessionId: 'ast_1',
    turnId: 'atn_1',
    proposal: parsed(proposal),
    name: 'Milo',
    atHome: true,
    homeTitle: 'Invoices',
    onOpenHome: vi.fn(),
    onAsk: vi.fn(),
    blocked: false,
    onChanged: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<LiveProposal {...props} />) };
}

describe('what a card says, worked out from the proposal alone', () => {
  it('draws a value as short text, and a table by the name a person uses', () => {
    expect(cellText(null)).toBe('—');
    expect(cellText('')).toBe('—');
    expect(cellText(12)).toBe('12');
    expect(cellText(false)).toBe('false');
    expect(cellText({ a: 1 })).toBe('{"a":1}');
    expect(cellText('x'.repeat(80))).toHaveLength(48);
    expect(tableName('main.orders')).toBe('orders');
    expect(tableName('orders')).toBe('orders');
  });

  it('counts what the confirm would do in its own words, whatever the model called it', () => {
    const three = parsed(open([change('1', 'sent', 'paid'), change('2', 'sent', 'paid'), change('3', 'sent', 'paid')])).actions;
    expect(askTitle(three)).toBe('Change 3 rows');
    expect(askTitle(three.slice(0, 1))).toBe('Change 1 row');
    expect(doneTitle(three, 3, 3)).toBe('Changed 3 rows.');
    expect(doneTitle(three, 2, 3)).toBe('Changed 2 of 3 rows.');
    const mixed = parsed(open([change('1', 'sent', 'paid'), { do: 'row.delete', id: '2', table: 'main.invoices', preview: { kind: 'delete', row: {}, references: [] } }])).actions;
    expect(askTitle(mixed)).toBe('Make 2 changes');
    const send = parsed(open([{ do: 'send.template', preview: { kind: 'send.template', id: 't1', name: 'News', subject: 'Hi', roles: [{ id: 'r', name: 'Staff' }], total: 14, skipped: 0 } }])).actions;
    expect(askTitle(send)).toBe('Send to 14 people');
    const save = parsed(open([{ do: 'doc.save', preview: { kind: 'doc.save', what: 'email', name: 'Welcome' } }])).actions;
    expect(askTitle(save)).toBe('Save as a new email template');
  });

  it('reads a list as one sentence only when every row changes the same column to the same value', () => {
    expect(sharedChange(parsed(open([change('1', 'sent', 'paid'), change('2', 'draft', 'paid')])).actions)).toEqual({ field: 'status', after: 'paid' });
    expect(sharedChange(parsed(open([change('1', 'sent', 'paid'), change('2', 'sent', 'void')])).actions)).toBeNull();
    expect(sharedChange(parsed(open([change('1', 'sent', 'paid'), change('2', 'a', 'b', 'note')])).actions)).toBeNull();
    expect(sharedChange(parsed(open([change('1', 'sent', 'paid')])).actions)).toBeNull();
  });

  it('says what a delete would touch, and asks for a fix by naming what was refused', () => {
    const gone = parsed(open([{ do: 'row.delete', id: 'ALFKI', table: 'main.customers', preview: { kind: 'delete', row: { name: 'Alfreds' }, references: [{ table: 'main.orders', count: 2 }, { table: 'main.notes', count: 1 }] } }]));
    expect(referencesText(gone.actions)).toBe('Other rows refer to this: 2 in orders, 1 in notes. They go or change with it, as on the page’s own delete.');
    expect(referencesText(parsed(open([change('1', 'a', 'b')])).actions)).toBeNull();
    const part = parsed(open([change('1', 'sent', 'paid'), refusedChange('9', 'You may not change total on invoices.')]));
    expect(fixRequest(part, 'Milo')).toBe('Some of that cannot be done. Propose it again without these:\n2. 9: You may not change total on invoices.');
  });

  it('reads nothing that is not a proposal, and keeps only what it knows of one', () => {
    expect(readProposal(null)).toBeNull();
    expect(readProposal({ state: 'made-up' })).toBeNull();
    expect(readProposal({ state: 'unchecked', madeAt: 1 })).toMatchObject({ state: 'unchecked', actions: [], hash: null });
    expect(readProposal({ state: 'superseded', title: 'x', count: 3 })).toMatchObject({ state: 'superseded', count: 3, actions: [] });
    expect(parsed(open([{ do: 'row.change', id: 7, preview: { kind: 'nonsense' } }, 'x'])).actions).toEqual([{ do: 'row.change', table: null, id: null, preview: null, refused: null }]);
  });
});

describe('a proposal that has not been tried yet', () => {
  it('shows nothing of it, asks the server once, and draws what comes back', async () => {
    routes[ACTIONS] = () => ({ proposal: open([change('INV-1', 'sent', 'paid')]) });
    const { props, rerender } = show({ state: 'unchecked', madeAt: 1 });
    expect(screen.getByText('Checking what would change…')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Change 1 row' })).toBeTruthy();
    rerender(<LiveProposal {...props} />);
    expect(calls.filter((call) => (call.body as { action?: string }).action === 'check')).toHaveLength(1);
    expect(props.onChanged).toHaveBeenCalled();
    // The model's own title is a quiet second line: the title is counted here.
    expect(screen.getByTestId('assistant-proposal-title').textContent).toBe('Change 1 row');
    expect(screen.getByText('Mark them paid')).toBeTruthy();
  });

  it('says so when the check itself fails, and offers nothing to confirm', async () => {
    routes[ACTIONS] = () => new Refusal(500, {});
    show({ state: 'unchecked', madeAt: 1 });
    expect(await screen.findByText('raw server text')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('a proposal that waits for a yes', () => {
  it('shows one change as old and new, focuses its title and never the confirm, and cancels on Escape', async () => {
    show(open([change('INV-0218', 'sent', 'paid')]));
    const row = screen.getByTestId('assistant-proposal-row');
    expect(within(row).getByText('INV-0218')).toBeTruthy();
    expect(within(row).getByText('status')).toBeTruthy();
    expect(within(row).getByText('sent')).toBeTruthy();
    expect(within(row).getByText('paid')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('assistant-proposal-title'));
    // Cancel comes first in the tab order.
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual(['Cancel', 'Change 1 row']);
    // One row: nothing to tick, no count.
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('assistant-proposal'), { key: 'Escape' });
    expect(await screen.findByText('Nothing was changed.')).toBeTruthy();
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('counts what is ticked, sends the hash and the ticked rows, and shows what the server then did', async () => {
    const actions = [change('INV-1', 'sent', 'paid'), change('INV-2', 'sent', 'paid'), change('INV-3', 'draft', 'paid')];
    routes[ACTIONS] = () => ({ proposal: applied(actions, [0, 2], { done: [{ index: 0, id: 'INV-1' }, { index: 2, id: 'INV-3' }], failed: [], notTried: [] }), undo: [{ index: 0, token: 'undo_a' }, { index: 2, token: 'undo_b' }] });
    routes['POST /api/v1/data/undo/undo_a'] = () => ({ restoredIds: ['INV-1'] });
    routes['POST /api/v1/data/undo/undo_b'] = () => ({ restoredIds: ['INV-3'] });
    const { props } = show(open(actions));
    const user = userEvent.setup();
    // The list is one sentence, and each row says what it held.
    expect(screen.getByTestId('assistant-proposal-group').textContent).toBe('status → paid on 3 rows');
    expect(screen.getByTestId('assistant-proposal-count').textContent).toBe('3 of 3 chosen');
    await user.click(screen.getByRole('checkbox', { name: 'INV-2' }));
    expect(screen.getByTestId('assistant-proposal-count').textContent).toBe('2 of 3 chosen');
    await user.click(screen.getByRole('button', { name: 'Change 2 rows' }));

    const sent = calls.find((call) => (call.body as { action?: string }).action === 'apply');
    expect(sent?.body).toEqual({ action: 'apply', hash: 'a'.repeat(64), pick: [0, 2] });
    const result = await screen.findByTestId('assistant-proposal-result');
    expect(within(result).getByText('Changed 2 rows.')).toBeTruthy();
    expect(within(result).getByText('INV-1, INV-3')).toBeTruthy();
    expect(props.onChanged).toHaveBeenCalled();

    await user.click(within(result).getByRole('button', { name: /Undo/ }));
    expect(await screen.findByText('Undone. Everything is as it was.')).toBeTruthy();
    expect(calls.filter((call) => call.url.includes('/data/undo/')).map((call) => call.url)).toEqual(['/api/v1/data/undo/undo_a', '/api/v1/data/undo/undo_b']);
  });

  it('cannot confirm with nothing ticked', async () => {
    show(open([change('INV-1', 'sent', 'paid'), change('INV-2', 'sent', 'paid')]));
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'INV-1' }));
    await user.click(screen.getByRole('checkbox', { name: 'INV-2' }));
    expect(screen.getByTestId('assistant-proposal-count').textContent).toBe('0 of 2 chosen');
    expect(screen.getByTestId('assistant-proposal-confirm').hasAttribute('disabled')).toBe(true);
  });

  it('says which part cannot be done, in the server`s words, and sends that back as the person`s next message', async () => {
    const { props } = show(open([change('INV-1', 'sent', 'paid'), refusedChange('INV-9', 'You may not change total on invoices.'), refusedChange('INV-8', '', 'SWITCHED_OFF')]));
    expect(screen.getByText('2 of 3 changes cannot be made.')).toBeTruthy();
    expect(screen.getByText('You may not change total on invoices.')).toBeTruthy();
    expect(screen.getByText('This is switched off for Milo in this workspace.')).toBeTruthy();
    // What can be done still can.
    expect(screen.getByRole('button', { name: 'Change 1 row' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ask Milo to fix this' }));
    expect(props.onAsk).toHaveBeenCalledWith(expect.stringContaining('2. INV-9: You may not change total on invoices.'));
  });

  it('draws what changed since it was shown, from the refusal itself, and writes nothing', async () => {
    const moved = open([change('INV-1', 'overdue', 'paid')], { hash: 'b'.repeat(64) });
    routes[ACTIONS] = () => new Refusal(409, { reason: 'proposal-changed', proposal: moved });
    show(open([change('INV-1', 'sent', 'paid')]));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Change 1 row' }));
    expect(await screen.findByText('This changed since you were shown it. Look again before confirming.')).toBeTruthy();
    expect(screen.getByText('overdue')).toBeTruthy();
    expect(screen.queryByTestId('assistant-proposal-result')).toBeNull();
    // The next confirm names the proposal as it now stands.
    routes[ACTIONS] = () => ({ proposal: applied([change('INV-1', 'overdue', 'paid')], [0], { done: [{ index: 0, id: 'INV-1' }], failed: [], notTried: [] }), undo: [] });
    await user.click(screen.getByRole('button', { name: 'Change 1 row' }));
    await screen.findByTestId('assistant-proposal-result');
    expect(calls.filter((call) => (call.body as { action?: string }).action === 'apply').map((call) => (call.body as { hash: string }).hash)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
    // No token came back: said plainly, and no button.
    expect(screen.getByText('This cannot be undone from here.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });

  it('shows a delete with what refers to the row, in the danger colour, and says it cannot be undone', () => {
    show(open([{ do: 'row.delete', table: 'main.customers', id: 'ALFKI', preview: { kind: 'delete', row: { customer_id: 'ALFKI', company_name: 'Alfreds Futterkiste' }, references: [{ table: 'main.orders', count: 12 }] } }]));
    expect(screen.getByTestId('assistant-proposal-title').textContent).toBe('Delete 1 row');
    expect(screen.getByText('Alfreds Futterkiste')).toBeTruthy();
    expect(screen.getByTestId('assistant-proposal-danger').textContent).toContain('12 in orders');
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    expect(screen.getByTestId('assistant-proposal-confirm').className).toContain('bg-danger');
  });

  it('shows a send as the mail, its subject and who gets it', async () => {
    const onOpenTemplate = vi.fn();
    show(open([{ do: 'send.template', preview: { kind: 'send.template', id: 'tpl_1', name: 'Menu update', subject: 'Our autumn menu', roles: [{ id: 'r1', name: 'Staff' }], total: 14, skipped: 1 } }]), { onOpenTemplate });
    expect(screen.getByTestId('assistant-proposal-title').textContent).toBe('Send to 14 people');
    expect(screen.getByText('Menu update')).toBeTruthy();
    expect(screen.getByText('Our autumn menu')).toBeTruthy();
    expect(screen.getByText('everyone with the role Staff (14 people)')).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open template' }));
    expect(onOpenTemplate).toHaveBeenCalledWith('tpl_1');
  });

  it('keeps a long list short in the panel and opens all of it large', async () => {
    const many = Array.from({ length: 9 }, (_, index) => change(`INV-${String(index)}`, 'sent', 'paid'));
    show(open(many));
    // More than fits: the group starts closed, and opening it shows the first six.
    expect(screen.queryAllByTestId('assistant-proposal-row')).toHaveLength(0);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('assistant-proposal-group'));
    expect(screen.getAllByTestId('assistant-proposal-row')).toHaveLength(6);
    expect(screen.getByText('3 more. Open large to see them all.')).toBeTruthy();
    await user.click(screen.getByTestId('assistant-proposal-large'));
    const sheet = await screen.findByTestId('assistant-proposal-sheet');
    expect(within(sheet).getAllByTestId('assistant-proposal-row')).toHaveLength(9);
  });

  it('waits, parked, while the person is on another page, and offers the way back', async () => {
    const { props } = show(open([change('INV-1', 'sent', 'paid')]), { atHome: false });
    expect(screen.getByText('Parked')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change 1 row' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Invoices to use this.' }));
    expect(props.onOpenHome).toHaveBeenCalled();
  });
});

describe('a proposal that is over', () => {
  it('says it was replaced, that it expired, or that it was more than can be confirmed at once', () => {
    show({ state: 'superseded', title: 'Mark them paid', madeAt: 1, count: 3 });
    expect(screen.getByText('Replaced')).toBeTruthy();
    expect(screen.getByText('Mark them paid')).toBeTruthy();
    cleanup();
    show({ state: 'expired', title: 'Mark them paid', madeAt: 1, count: 3 });
    expect(screen.getByText('This proposal is 30 minutes old. Ask again.')).toBeTruthy();
    cleanup();
    show({ state: 'refused', title: 'Mark them paid', madeAt: 1, actions: [{ do: 'row.change', id: '1' }], refusal: { code: 'OVER_CAP', message: 'x', count: 80, cap: 50 } });
    expect(screen.getByText('That is 80 changes; at most 50 can be confirmed at once. Use the page’s own bulk tools for more.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a confirmation that did part: what was not changed and why, and the way to ask for the rest', async () => {
    const actions = [change('INV-1', 'sent', 'paid'), change('INV-2', 'sent', 'paid'), change('INV-3', 'sent', 'paid')];
    const { props } = show(applied(actions, [0, 1, 2], { done: [{ index: 0, id: 'INV-1' }], failed: [{ index: 1, code: 'ROW_CHANGED', message: 'This invoice was paid in the meantime.' }], notTried: [2] }));
    const result = screen.getByTestId('assistant-proposal-result');
    expect(within(result).getByText('Changed 1 of 3 rows.')).toBeTruthy();
    expect(within(result).getByText('These 2 were not changed:')).toBeTruthy();
    expect(within(result).getByText('This invoice was paid in the meantime.')).toBeTruthy();
    // Read back after a reload: no token is held, so no undo is offered and none is claimed impossible.
    expect(within(result).queryByRole('button', { name: /Undo/ })).toBeNull();
    expect(within(result).queryByText('This cannot be undone from here.')).toBeNull();
    await userEvent.setup().click(within(result).getByRole('button', { name: 'Propose the rest again' }));
    expect(props.onAsk).toHaveBeenCalledWith(expect.stringContaining('INV-2: This invoice was paid in the meantime.'));
  });

  it('shows a confirmation that stopped part way as three groups', () => {
    const actions = [change('INV-1', 'sent', 'paid'), change('INV-2', 'sent', 'paid'), change('INV-3', 'sent', 'paid')];
    show({ ...applied(actions, [0, 1, 2], { done: [{ index: 0, id: 'INV-1' }], failed: [], notTried: [2], unsure: [1] }), state: 'interrupted' });
    expect(screen.getByText('This stopped part way.')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Check this one')).toBeTruthy();
    expect(screen.getByText('The save was cut off. It may or may not have changed.')).toBeTruthy();
    expect(screen.getByText('Not attempted')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Invoices' })).toBeTruthy();
  });

  it('counts the undo down, covers only what has a token, and ends with its minute', async () => {
    let clock = 1_000_000;
    const actions = [change('INV-1', 'sent', 'paid'), change('INV-2', 'sent', 'paid')];
    routes[ACTIONS] = () => ({ proposal: applied(actions, [0, 1], { done: [{ index: 0, id: 'INV-1' }, { index: 1, id: 'INV-2' }], failed: [], notTried: [] }), undo: [{ index: 0, token: 'undo_a' }] });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    show(open(actions), { now: () => clock });
    fireEvent.click(screen.getByRole('button', { name: 'Change 2 rows' }));
    const undo = await screen.findByRole('button', { name: /Undo 1 of 2/ });
    expect(undo.textContent).toContain('1:00');
    expect(screen.getByText('1 change cannot be undone from here.')).toBeTruthy();
    clock += 61_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull());
    expect(screen.getByText('The time to undo has passed.')).toBeTruthy();
  });
});
