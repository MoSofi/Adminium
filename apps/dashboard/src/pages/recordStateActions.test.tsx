// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * THE BUTTONS OF A RECORD. The page shows the actions the server offered for
 * the state the row is in, sends an action's id and the state it saw — never
 * where a move leads or what an action writes — and says a refusal where the
 * reader will see it: on the field it names, or under the record's heading.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../app/api.js';
import type { StateActionFact } from '../api/pages.js';
import { jsonResponse } from '../test/fixtures.js';
import { RecordStateActions, type RecordStateActionsProps } from './RecordStateActions.js';
import { recordRefusal, refusedFields } from './recordRefusal.js';

const pushed: string[] = [];
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ history: { push: (to: string) => void pushed.push(to) } }) }));

const ACTIONS: StateActionFact[] = [
  { id: 'cancel', kind: 'move', label: 'Cancel order', tone: 'danger', confirm: 'Cancel it?', from: ['draft', 'sent'] },
  { id: 'send', kind: 'move', label: 'Send', tone: 'primary', from: ['draft'] },
  { id: 'close', kind: 'move', label: 'Close order', tone: 'neutral', from: ['sent'], ask: [{ column: 'reason', label: 'Reason', required: true }, { column: 'note', label: 'Note', required: false }] },
  { id: 'send-again', kind: 'set', label: 'Send again', tone: 'neutral', from: ['sent'] },
  { id: 'receive', kind: 'link', label: 'Receive', tone: 'neutral', from: ['sent'], href: '/add-ons/stock/stock-receive?po=' },
  { id: 'add-line', kind: 'child', label: 'Add a line', tone: 'neutral', from: ['draft', 'sent'], child: { table: 'public.shop_order_lines', via: 'order_id', form: ['qty'] }, set: { kind: 'extra' } },
];

interface Call {
  method: string;
  path: string;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- a request body read freely
}

function serve(answer: (call: Call) => Response = () => jsonResponse(200, { data: { id: 12 }, undoToken: null })): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const call = { method: init?.method ?? 'GET', path: decodeURIComponent(new URL(String(input), 'http://adminium.test').pathname), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) };
      calls.push(call);
      return answer(call);
    }),
  );
  return calls;
}

function mount(over: Partial<RecordStateActionsProps> = {}) {
  const onDone = vi.fn();
  const onRefused = vi.fn();
  render(<RecordStateActions actions={ACTIONS} state="sent" connectionId="cnx_1" table="public.shop_orders" recordId="12" onDone={onDone} onRefused={onRefused} {...over} />);
  return { onDone, onRefused };
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushed.length = 0;
});

describe('the buttons of a record', () => {
  it('shows only the actions of the row\'s state: the main one first, the dangerous one last, the rest under More', async () => {
    mount({ state: 'sent' });
    // Three beside Edit, in the order of their weight; the others one click away.
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Close order', 'Send again', 'Receive', 'More']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'More' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Add a line', 'Cancel order']);
    expect(screen.queryByText('Send')).toBeNull();
  });

  it('a draft shows the draft\'s; a state nothing is offered in shows nothing at all', () => {
    const { unmount } = render(<RecordStateActions actions={ACTIONS} state="draft" connectionId="c" table="t" recordId="1" onDone={() => undefined} onRefused={() => undefined} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Send', 'Add a line', 'Cancel order']);
    unmount();
    const none = render(<RecordStateActions actions={ACTIONS} state="done" connectionId="c" table="t" recordId="1" onDone={() => undefined} onRefused={() => undefined} />);
    expect(none.container.innerHTML).toBe('');
  });

  it('a page that changes nothing offers only the ways out of it', () => {
    mount({ state: 'sent', linksOnly: true });
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Receive']);
  });

  it('an action that asks nothing acts at once: its id and the state the page saw, and nothing else', async () => {
    const calls = serve();
    const { onDone, onRefused } = mount({ state: 'sent' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ method: 'POST', path: '/api/v1/data/cnx_1/public.shop_orders/12/actions/send-again', body: { from: 'sent' } }]);
    // A refusal said earlier is taken away by an action that went through.
    expect(onRefused).toHaveBeenLastCalledWith(null);
  });

  it('asks before a danger action, and does nothing when it is called off', async () => {
    const user = userEvent.setup();
    const calls = serve();
    const { onDone } = mount({ state: 'draft' });
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Cancel it?')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel order' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(calls[0]).toMatchObject({ path: '/api/v1/data/cnx_1/public.shop_orders/12/actions/cancel', body: { from: 'draft' } });
  });

  it('asks for what the action asks for, sends only what was typed, and re-reads the record after a move', async () => {
    const user = userEvent.setup();
    const calls = serve();
    const { onDone } = mount({ state: 'sent' });
    await user.click(screen.getByRole('button', { name: 'Close order' }));
    const dialog = await screen.findByRole('dialog');
    // A required field left empty is said on the field, before anything is sent.
    await user.click(within(dialog).getByRole('button', { name: 'Close order' }));
    expect(within(dialog).getByText('Fill this in first.')).toBeTruthy();
    expect(calls).toEqual([]);
    await user.type(within(dialog).getByLabelText(/Reason/), 'Collected');
    await user.click(within(dialog).getByRole('button', { name: 'Close order' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // The optional note was left empty: it is no value at all.
    expect(calls[0]!.body).toEqual({ from: 'sent', values: { reason: 'Collected' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a field refusal lands on its field and keeps what was typed', async () => {
    const user = userEvent.setup();
    serve(() => jsonResponse(422, { error: { code: 'VALIDATION_FAILED', message: 'Some values were refused.', requestId: 'r', details: { fields: { reason: { code: 'too-long', message: 'At most 200 characters.' } } } } }));
    const { onDone, onRefused } = mount({ state: 'sent' });
    await user.click(screen.getByRole('button', { name: 'Close order' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Reason/), 'Because');
    await user.click(within(dialog).getByRole('button', { name: 'Close order' }));
    expect(await within(dialog).findByText('At most 200 characters.')).toBeTruthy();
    expect((within(dialog).getByLabelText(/Reason/) as HTMLInputElement).value).toBe('Because');
    expect(onRefused).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a refused move closes the dialog and says why under the heading, in the reader\'s words', async () => {
    const user = userEvent.setup();
    serve(() => jsonResponse(409, { error: { code: 'STATE_MOVE_REFUSED', message: 'A shop_orders row goes from sent to cancelled only with at least 1 public.shop_order_lines row(s).', requestId: 'r', details: { column: 'status', from: 'sent', to: 'cancelled', requires: 'public.shop_order_lines', min: 1 } } }));
    const { onRefused, onDone } = mount({ state: 'sent' });
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel order' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel order' }));
    await waitFor(() => expect(onRefused).toHaveBeenCalledWith('Add at least 1 row(s) of shop order lines first.'));
    expect(screen.queryByRole('dialog')).toBeNull();
    // The row may have moved on: the page reads it again either way.
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a link carries the record\'s id and asks the server nothing', async () => {
    const calls = serve();
    mount({ state: 'sent', recordId: 'PO 7/1' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Receive' }));
    expect(pushed).toEqual(['/add-ons/stock/stock-receive?po=PO%207%2F1']);
    expect(calls).toEqual([]);
  });

  it('a child form posts what was typed, the fixed values and the parent\'s key — to the child\'s own table', async () => {
    const user = userEvent.setup();
    const calls = serve();
    const { onDone } = mount({ state: 'draft' });
    await user.click(screen.getByRole('button', { name: 'Add a line' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Qty'), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Add a line' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ method: 'POST', path: '/api/v1/data/cnx_1/public.shop_order_lines', body: { values: { qty: '3', kind: 'extra', order_id: '12' } } }]);
  });
});

describe('why an action was refused', () => {
  const refusal = (code: string, details?: unknown, status = 409, message = 'The server said so.') => new ApiError(status, code, message, 'r', details);

  it('says one sentence a case, and the server\'s own for the rest', () => {
    expect(recordRefusal(refusal('STATE_MOVE_REFUSED', { requires: 'main.shop_order_lines', min: 2 }))).toBe('Add at least 2 row(s) of shop order lines first.');
    expect(recordRefusal(refusal('STATE_MOVE_REFUSED', { roles: ['shop-manager'] }))).toBe('Your role may not do this.');
    expect(recordRefusal(refusal('STATE_MOVE_REFUSED', { from: 'done', to: 'sent', named: 'sent' }))).toBe('Someone else changed this record; it is done now. Look again.');
    expect(recordRefusal(refusal('STATE_MOVE_REFUSED', { from: 'sent', to: 'sent' }))).toBe('This is already done.');
    expect(recordRefusal(refusal('STATE_MOVE_REFUSED', { requires: { time: true } }))).toBe('This cannot be done yet.');
    expect(recordRefusal(refusal('ROW_CHANGED', { column: 'status' }))).toBe('This record changed while you were looking at it. Look again.');
    expect(recordRefusal(refusal('RECORD_LOCKED', { column: 'note' }))).toBe('This record is locked, so this cannot be changed.');
    expect(recordRefusal(refusal('COLUMN_FORBIDDEN', { column: 'status' }, 403))).toBe('Your role may not change this.');
    expect(recordRefusal(refusal('NOT_FOUND', {}, 404))).toBe('This record, or this action, is no longer there.');
    expect(recordRefusal(refusal('SOMETHING_NEW', {}))).toBe('The server said so.');
    expect(recordRefusal(new Error('offline'))).toBe('offline');
  });

  it('never prints a value the server left out: a role that does not read the state is told nothing of it', () => {
    // What the server sends such a role: the column and what the move waits for, no state.
    const said = recordRefusal(refusal('STATE_MOVE_REFUSED', { column: 'status', requires: 'main.shop_order_lines' }, 409, 'This move cannot be made now.'));
    expect(said).toBe('This cannot be done yet.');
    expect(recordRefusal(refusal('STATE_MOVE_REFUSED', { column: 'status' }, 409, 'This move cannot be made now.'))).toBe('This move cannot be made now.');
    // "Somebody moved it" with the state it is in now left out: no sentence with a hole in it.
    expect(recordRefusal(refusal('STATE_MOVE_REFUSED', { column: 'status', named: 'sent' }, 409, 'This move cannot be made now.'))).toBe('This move cannot be made now.');
  });

  it('a ledger\'s refusal is said as every other save says it', () => {
    expect(recordRefusal(refusal('POSTING_REFUSED', { reason: 'no-such-reason' })).length).toBeGreaterThan(0);
    expect(recordRefusal(refusal('POSTING_REFUSED', { reason: 'no-such-reason' }))).not.toBe('The server said so.');
  });

  it('reads the fields a refusal names, and none from a refusal that names none', () => {
    expect(refusedFields(refusal('VALIDATION_FAILED', { fields: { reason: { code: 'required' }, note: { code: 'too-long', message: 'Too long.' } } }, 422))).toEqual({ reason: 'Fill this in first.', note: 'Too long.' });
    expect(refusedFields(refusal('VALIDATION_FAILED', {}, 422))).toBeNull();
    expect(refusedFields(refusal('STATE_MOVE_REFUSED', { fields: { a: {} } }, 409))).toBeNull();
  });
});
