// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A date's bounds (`column.bounds`): said in words, and kept — with its
 * column — through a Studio save, which rewrites every row.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFetch, renderEditor } from './test-harness.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const row = (op: string, columnName: string, value: Record<string, unknown>, id: string) => ({
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

describe('a date’s bounds', () => {
  it('says them in words, and a save keeps them on their column', async () => {
    const harness = installFetch({
      overridesRows: () => [
        row('column.bounds', 'body', { notAfter: 'today', notBefore: { column: 'issued_on', via: 'invoice_id' } }, 'ovr_bounds'),
        row('column.code', 'body', { length: 4 }, 'ovr_code'),
      ],
    });
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: /Order notes/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Body/ }));
    const decided = await screen.findByTestId('rules-decided');
    expect(decided.textContent).toContain('Never later than today; Never before invoice_id → issued_on');

    fireEvent.click(screen.getByTestId('rule-column.code').querySelector('button')!);
    await userEvent.click(screen.getByRole('button', { name: 'Save overrides' }));
    await waitFor(() => expect(harness.putBodies).toHaveLength(1));
    const { overrides } = harness.putBodies[0] as { overrides: { op: string; columnName?: string; value: unknown }[] };
    expect(overrides).toEqual([
      { op: 'column.bounds', tableName: 'public.order_notes', columnName: 'body', value: { notAfter: 'today', notBefore: { column: 'issued_on', via: 'invoice_id' } } },
    ]);
  });
});
