// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH TABLES ARE ADMINIUM'S OWN.
 *
 * No rule reads or writes one of Adminium's own tables. Which those are is
 * told by the table's own name. It was once told by the table's whole id,
 * database or schema included — so on a MySQL database called
 * `adminium_shop` every table was "Adminium's own", and a rule that added a
 * row to any of them could not be saved or shipped.
 */
import { describe, expect, it } from 'vitest';

import { isOwnTable } from '../src/automations/validate.js';

describe('Adminium\'s own tables, to a rule', () => {
  it('are the ones whose own name starts with adminium_', () => {
    expect(isOwnTable({ name: 'adminium_users' })).toBe(true);
    expect(isOwnTable({ name: 'adminium_automation_runs' })).toBe(true);
  });

  it('are not every table of a database or a schema that happens to be called so', () => {
    // The id of such a table is `adminium_shop.orders`: the name is what is asked.
    expect(isOwnTable({ name: 'orders' })).toBe(false);
    expect(isOwnTable({ name: 'inventory_reorder_requests' })).toBe(false);
  });

  it('are not a table that merely has the word in its name', () => {
    expect(isOwnTable({ name: 'my_adminium_notes' })).toBe(false);
    expect(isOwnTable({ name: 'adminiums' })).toBe(false);
  });
});
