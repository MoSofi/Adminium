// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COUNT, AND THE SALES MADE WHILE IT IS UNDER WAY.
 *
 * A count is made with its lines in one save. Each count typed is a mark of
 * its own: Adminium takes what the books hold for that line at that moment
 * and keeps it beside the count. Posting adjusts by the difference between
 * the two — so a sale made after the mark is not undone — and a posted count
 * can be reversed, line by line.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { item, levelOf, movementsOf, n, opening, place, pointOf, said } from './world.js';

const inventory = builtAddOn('inventory');

describe.each(LEGS)('counting — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let floor: number;
  let pen: number;
  let card: number;
  const start = async (levels: unknown[]) => {
    const count = n((await w.create('counts', { place_id: floor, scope: 'all' })).row['id']);
    const lines: number[] = [];
    for (const level of levels) lines.push(n((await w.create('count_lines', { count_id: count, level_id: level })).row['id']));
    return { count, lines };
  };
  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    floor = await place(w, 'Shop floor');
    pen = await item(w, 'Pen, black');
    card = await item(w, 'Greeting card');
    await opening(w, floor, [
      { item_id: pen, qty_typed: 74, unit_cost: 0.45 },
      { item_id: card, qty_typed: 34, unit_cost: 0.9 },
    ]);
  }, 240_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('a count started before a sale does not undo it', async () => {
    const penLevel = (await levelOf(w, pen, floor, null))?.['id'];
    const cardLevel = (await levelOf(w, card, floor, null))?.['id'];
    const { count, lines } = await start([penLevel, cardLevel]);
    // A line knows its item and what the books held when the count began.
    const fresh = await w.one('count_lines', lines[0]);
    expect([fresh['item_name'], n(fresh['expected']), n(fresh['is_counted'])]).toEqual(['Pen, black', 74, 0]);
    expect([n((await w.one('counts', count))['lines']), n((await w.one('counts', count))['uncounted'])]).toEqual([2, 2]);
    // No role may write a count onto a line: a count is typed as a mark.
    const marked = await w.create('count_marks', { count_line_id: lines[0], counted: 71 });
    expect(marked.posted.map(said)).toEqual(['stock count-mark post planned']);
    const line = await w.one('count_lines', lines[0]);
    expect([n(line['counted']), n(line['qty_when_counted']), n(line['difference']), n(line['value']), n(line['is_counted']), n(line['differs'])]).toEqual([71, 74, -3, -1.35, 1, 1]);
    // Two are sold after the mark.
    await w.create('uses', { item_id: pen, qty: 2, place_id: floor, kind: 'sold' });
    expect(n((await pointOf(w, pen, floor))['on_hand'])).toBe(72);
    // The count cannot be posted with a line uncounted.
    await expect(w.update('counts', count, { status: 'posting' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
    await w.create('count_marks', { count_line_id: lines[1], counted: 34 });
    expect(n((await w.one('counts', count))['uncounted'])).toBe(0);
    await w.update('counts', count, { status: 'posting' });
    const posted = await w.update('count_lines', lines[0], { status: 'posted' });
    expect(posted.posted.map(said)).toEqual(['stock count post planned']);
    await w.update('count_lines', lines[1], { status: 'posted' });
    await w.update('counts', count, { status: 'posted' });
    // 74 counted as 71 is three short; the two sold since stand: 72 − 3.
    expect(n((await pointOf(w, pen, floor))['on_hand'])).toBe(69);
    expect((await movementsOf(w, pen)).slice(-2)).toEqual(['sold -2', 'adjusted -3']);
    // A line that agrees writes no movement.
    expect(await movementsOf(w, card)).toEqual(['opening 34']);
    const done = await w.one('counts', count);
    expect([done['status'], n(done['differences']), n(done['value']), n(done['unposted'])]).toEqual(['posted', 1, -1.35, 0]);
  });

  it.skipIf(!run)('a count typed again takes a new snapshot, and a cleared one un-counts the line', async () => {
    const level = (await levelOf(w, card, floor, null))?.['id'];
    const { count, lines } = await start([level]);
    await w.create('count_marks', { count_line_id: lines[0], counted: 30 });
    await w.create('uses', { item_id: card, qty: 4, place_id: floor, kind: 'sold' });
    await w.create('count_marks', { count_line_id: lines[0], counted: 30 });
    const again = await w.one('count_lines', lines[0]);
    expect([n(again['qty_when_counted']), n(again['difference'])]).toEqual([30, 0]);
    await w.create('count_marks', { count_line_id: lines[0], counted: null });
    const cleared = await w.one('count_lines', lines[0]);
    expect([cleared['counted'], cleared['qty_when_counted'], n(cleared['is_counted'])]).toEqual([null, null, 0]);
    expect(n((await w.one('counts', count))['uncounted'])).toBe(1);
    // An open count is cancelled with nothing written to stock.
    await w.update('counts', count, { status: 'cancelled' });
    expect(n((await pointOf(w, card, floor))['on_hand'])).toBe(30);
    // A mark for a count that is no longer open is refused.
    await expect(w.create('count_marks', { count_line_id: lines[0], counted: 1 })).rejects.toMatchObject({ code: expect.stringMatching(/POSTING_REFUSED|STATE_MOVE_REFUSED/) });
  });

  it.skipIf(!run)('a posted count is reversed line by line, and the books read as before it', async () => {
    const level = (await levelOf(w, pen, floor, null))?.['id'];
    const { count, lines } = await start([level]);
    const before = n((await pointOf(w, pen, floor))['on_hand']);
    await w.create('count_marks', { count_line_id: lines[0], counted: before + 5 });
    await w.update('counts', count, { status: 'posting' });
    await w.update('count_lines', lines[0], { status: 'posted' });
    await w.update('counts', count, { status: 'posted' });
    expect(n((await pointOf(w, pen, floor))['on_hand'])).toBe(before + 5);
    await w.update('counts', count, { status: 'reversing' });
    const reversed = await w.update('count_lines', lines[0], { status: 'reversed' });
    expect(reversed.posted.map(said)).toEqual(['stock count reverse planned']);
    await w.update('counts', count, { status: 'reversed' });
    expect(n((await pointOf(w, pen, floor))['on_hand'])).toBe(before);
    expect((await movementsOf(w, pen)).slice(-2)).toEqual(['adjusted 5', 'adjusted -5']);
  });
});
