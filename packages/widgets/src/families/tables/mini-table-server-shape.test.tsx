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
});
