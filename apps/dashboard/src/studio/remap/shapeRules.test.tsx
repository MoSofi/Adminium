// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A rule an add-on's shape set: the inspector says whose it is, and switching
 * it off asks first, naming what stops being guaranteed. A rule nobody's
 * shape set comes off at once, as before.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFetch, renderEditor } from './test-harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const row = (op: string, columnName: string | null, value: Record<string, unknown>, id: string) => ({
  id,
  op,
  tableName: 'public.order_notes',
  columnName,
  value,
  origin: 'app',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
});

const rows = () => [
  row('column.sequence', 'body', { gapless: true }, 'ovr_seq'),
  row('column.code', 'body', { length: 4 }, 'ovr_code'),
  row('table.states', null, { column: 'body', initial: 'draft', moves: { draft: ['sent'] }, lock: { when: ['sent'] } }, 'ovr_states'),
];

const setBy = (op: string, columnName: string | null, guarantee: string) => ({
  tableName: 'public.order_notes',
  columnName,
  op,
  addOn: 'invoices',
  addOnName: 'Invoices & Receipts',
  guarantee,
});

async function openBody(): Promise<void> {
  renderEditor();
  await userEvent.click(await screen.findByRole('button', { name: /Order notes/ }));
  await userEvent.click(await screen.findByRole('button', { name: /Body/ }));
  await screen.findByTestId('column-rules');
}

describe('a rule an add-on’s shape set', () => {
  it('says whose it is, and asks before switching it off, naming what stops being guaranteed', async () => {
    const harness = installFetch({
      overridesRows: rows,
      shapeRules: () => [setBy('column.sequence', 'body', 'numbers'), setBy('table.states', null, 'edits')],
    });
    await openBody();
    const sequence = await screen.findByTestId('rule-column.sequence');
    await waitFor(() => expect(sequence.textContent).toContain('Set by Invoices & Receipts'));
    const states = screen.getByTestId('rule-table.states');
    expect(states.textContent).toContain('Changes only by the moves its rules allow; the row is locked while it is sent');
    expect(states.textContent).toContain('Set by Invoices & Receipts');
    // The code rule is nobody's shape's: no label.
    expect(screen.getByTestId('rule-column.code').textContent).not.toContain('Set by');

    // Remove asks first; "Keep it" keeps it.
    fireEvent.click(sequence.querySelector('button')!);
    const ask = await screen.findByTestId('rule-confirm');
    expect(ask.textContent).toContain('Switch off a rule set by Invoices & Receipts?');
    expect(ask.textContent).toContain('Numbers may repeat or skip.');
    expect(ask.textContent).toContain('no update of the app or the add-on puts it back');
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByTestId('rule-confirm')).toBeNull();
    expect(screen.getByTestId('rule-column.sequence')).toBeTruthy();

    // The states rule names its own promise; "Switch it off" takes it.
    fireEvent.click(screen.getByTestId('rule-table.states').querySelector('button')!);
    expect((await screen.findByTestId('rule-confirm')).textContent).toContain('Sent invoices can be edited.');
    await userEvent.click(screen.getByRole('button', { name: 'Switch it off' }));

    // A rule no shape set comes off at once.
    fireEvent.click(screen.getByTestId('rule-column.code').querySelector('button')!);
    expect(screen.queryByTestId('rule-confirm')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));
    const { overrides } = harness.putBodies[0] as { overrides: { op: string }[] };
    expect(overrides.map((o) => o.op)).toEqual(['column.sequence']);
  });
});
