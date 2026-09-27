// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A `mini-table` over a parent limit's counts: each pool by its name, with
 * what is left and "taken of size" beside it — the columns the answer names.
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { miniTableConfigSchema } from './tables-config.js';
import { MiniTableWidget } from './widgets.js';

afterEach(cleanup);

const answer = {
  shape: 'record-list',
  rows: [
    { id: '1', label: 'Neon Standard', size: 260, taken: 246, held: 3, left: 14 },
    { id: '2', label: 'Balcony', size: 40, taken: 40, held: 0, left: 0 },
    { id: '3', label: 'Walk-ins', size: null, taken: 5, held: 0, left: null },
  ],
  columns: [
    { name: 'label', logicalType: 'varchar', nullable: true, isPrimaryKey: false },
    { name: 'left', logicalType: 'integer', nullable: true, isPrimaryKey: false, semantic: 'capacity-left' },
  ],
  total: 3,
};

const binding = { kind: 'capacity-counts', connectionId: 'c', source: { name: 'tickets' }, shape: 'record-list', capacity: { under: 'event_id', value: '1' } };

describe('what a pool has left, in a mini table', () => {
  it('draws each pool by its label, what is left, and what is taken of its size', () => {
    const { container } = render(<MiniTableWidget instanceId="types" config={miniTableConfigSchema.parse({ title: 'Tickets left', binding })} data={answer} onEvent={() => undefined} />);
    const cells = [...container.querySelectorAll('[data-part="cell-capacity-left"]')];
    expect(cells.map((cell) => cell.textContent)).toEqual(['14 left246 of 260 taken', '0 left40 of 40 taken', '5 taken']);
    expect(container.textContent).toContain('Neon Standard');
    // None left reads in the danger tone; some left does not.
    const left = [...container.querySelectorAll<HTMLElement>('[data-part="capacity-left"]')];
    expect(left.map((node) => node.dataset['empty'] === 'true')).toEqual([false, true]);
    expect(left[1]!.className).toContain('text-danger');
  });

  it('opens nothing: the rows are pools, not records of the bound table', () => {
    const onEvent = vi.fn();
    const { container } = render(<MiniTableWidget instanceId="types" config={miniTableConfigSchema.parse({ title: 'Tickets left', binding })} data={answer} onEvent={onEvent} />);
    expect(container.querySelector('button')).toBeNull();
    fireEvent.click(container.querySelector('[data-column="label"]')!);
    expect(onEvent).not.toHaveBeenCalled();
  });
});
