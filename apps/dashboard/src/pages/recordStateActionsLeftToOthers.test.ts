// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { leftToOthers } from './RecordStateActions.js';

/**
 * A record's button the server says is left to somebody else: hidden from the
 * person the row names in a `notBy` staff column of its own, and shown only to
 * the person a `by` names. Presentation only — the save refuses it anyway — so
 * a column the reader is not shown, or a reader not known yet, hides nothing.
 */
describe('a button the row leaves to others', () => {
  const row = { id: 1, rep_id: 'usr_mara', asked_by_id: 'usr_omar', claimed_by_id: 'usr_dana' };

  it('is hidden from the person a notBy column names, and shown to everybody else', () => {
    expect(leftToOthers({ notBy: ['rep_id'] }, row, 'usr_mara')).toBe(true);
    expect(leftToOthers({ notBy: ['rep_id', 'asked_by_id'] }, row, 'usr_omar')).toBe(true);
    expect(leftToOthers({ notBy: ['rep_id'] }, row, 'usr_dana')).toBe(false);
    expect(leftToOthers({}, row, 'usr_mara')).toBe(false);
  });

  it('is shown only to the person a by column names', () => {
    expect(leftToOthers({ by: 'claimed_by_id' }, row, 'usr_dana')).toBe(false);
    expect(leftToOthers({ by: 'claimed_by_id' }, row, 'usr_mara')).toBe(true);
    // Nobody has claimed it: nobody is its claimer.
    expect(leftToOthers({ by: 'claimed_by_id' }, { ...row, claimed_by_id: null }, 'usr_dana')).toBe(true);
  });

  it('hides nothing on a column the reader is not shown, or before the row and the reader are known', () => {
    expect(leftToOthers({ notBy: ['owner_id'], by: 'manager_id' }, row, 'usr_mara')).toBe(false);
    expect(leftToOthers({ notBy: ['rep_id'] }, null, 'usr_mara')).toBe(false);
    expect(leftToOthers({ notBy: ['rep_id'] }, row, null)).toBe(false);
  });
});
