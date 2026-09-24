// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A `mini-table` fed by the server: `record-list` answers `{ shape, rows,
 * columns }`, and a card whose config names no columns heads them from the
 * answer. It used to read only `data`, so a live card drew an empty body.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { miniTableConfigSchema } from './tables-config.js';
import { MiniTableWidget } from './widgets.js';

afterEach(cleanup);

describe('mini-table over a server record list', () => {
  it('draws the rows, in the columns the answer names', () => {
    const data = {
      shape: 'record-list',
      rows: [
        { name: 'Almond Croissant', price: 4.6 },
        { name: 'Banana Bread', price: 4.2 },
      ],
      columns: [
        { name: 'name', label: 'Name', logicalType: 'varchar', nullable: false, isPrimaryKey: false },
        { name: 'price', logicalType: 'decimal', nullable: false, isPrimaryKey: false },
      ],
      total: 2,
    };
    render(<MiniTableWidget instanceId="sold-out" config={miniTableConfigSchema.parse({ title: 'Sold out now' })} data={data} onEvent={() => undefined} />);
    expect(screen.getByText('Almond Croissant')).toBeDefined();
    expect(screen.getByText('Banana Bread')).toBeDefined();
    expect(screen.getByText(/4\.6/)).toBeDefined();
  });

  it('draws a card’s own columns with the answer’s words for a choice, and the card’s own words win', () => {
    const data = {
      shape: 'record-list',
      rows: [{ number: '1042', status: 'waiting', kind: 'walk_in', stage: 'seen' }],
      // The server reads a choice column's labels in the reader's language.
      columns: [
        { name: 'number', logicalType: 'varchar', nullable: false, isPrimaryKey: false },
        { name: 'status', logicalType: 'enum', nullable: false, isPrimaryKey: false, enumLabels: { waiting: 'Wartend' }, enumTones: { waiting: 'warn' } },
        { name: 'kind', logicalType: 'enum', nullable: false, isPrimaryKey: false, enumLabels: { walk_in: 'Laufkundschaft' } },
      ],
      total: 1,
    };
    const config = miniTableConfigSchema.parse({
      title: 'Waiting longest',
      columns: [
        { name: 'status', label: 'Status', logicalType: 'enum' },
        { name: 'kind', label: 'Kind', logicalType: 'enum', enumLabels: { walk_in: 'Walk-in' } },
        // A column the answer does not name is drawn as the card says.
        { name: 'stage', label: 'Stage', logicalType: 'enum' },
      ],
    });
    const { container } = render(<MiniTableWidget instanceId="waiting" config={config} data={data} onEvent={() => undefined} />);
    expect(screen.getByText('Wartend')).toBeDefined();
    expect(container.querySelector('[data-tone="warn"]')?.textContent).toBe('Wartend');
    expect(screen.getByText('Walk-in')).toBeDefined();
    expect(container.textContent).not.toContain('Laufkundschaft');
    expect(screen.getByText('seen')).toBeDefined();
  });
});
