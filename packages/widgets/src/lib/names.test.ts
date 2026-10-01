// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { entityFromTable, plainTableName } from './names.js';

describe('a table’s name, for a person', () => {
  it('drops the schema and reads underscores as spaces', () => {
    expect(plainTableName('main.order_items')).toBe('order items');
    expect(plainTableName('public.clients')).toBe('clients');
    expect(plainTableName('orders')).toBe('orders');
  });

  it('names one row of it', () => {
    // The dialog read "New order_item" and the subtitle "Creates one row in main.orders".
    expect(entityFromTable('main.order_items')).toBe('order item');
    expect(entityFromTable('main.clients')).toBe('client');
    expect(entityFromTable('staff')).toBe('staff');
    expect(entityFromTable('s')).toBe('s');
  });
});
