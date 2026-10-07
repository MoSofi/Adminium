// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COUNT OF SIX HUNDRED LINES.
 *
 * A sheet has no size limit because nothing about it is one transaction: the
 * count is made with its lines, each count typed is a save, each line posts
 * in a save of its own, and so does each line of its undo. Six hundred
 * batches of one item on one shelf, counted, posted and put back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { inDays, item, n, opening, place, pointOf } from './world.js';

const inventory = builtAddOn('inventory');
const LINES = 600;

describe.each(LEGS)('a count of six hundred lines — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let room: number;
  let vial: number;
  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    room = await place(w, 'Cold room');
    vial = await item(w, 'Vial', { tracks_batches: true });
    // Six hundred batches of two each, loaded as one opening receipt.
    await opening(w, room, Array.from({ length: LINES }, (_unused, index) => ({ item_id: vial, qty_typed: 2, unit_cost: 1, batch_code: `B${String(index + 1).padStart(4, '0')}`, expires_on: inDays(300) })));
  }, 900_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('posts line by line and can be undone line by line', async () => {
    expect(n((await pointOf(w, vial, room))['on_hand'])).toBe(2 * LINES);
    const levels = (await w.rowsOf('levels', `item_id = ${String(vial)} and place_id = ${String(room)} order by id`)).filter((level) => n(level['qty']) > 0);
    expect(levels).toHaveLength(LINES);
    const count = n((await w.create('counts', { place_id: room, scope: 'all' })).row['id']);
    const lines: number[] = [];
    for (const level of levels) lines.push(n((await w.create('count_lines', { count_id: count, level_id: level['id'] })).row['id']));
    // Every third batch is one short; the rest agree.
    for (const [index, line] of lines.entries()) await w.create('count_marks', { count_line_id: line, counted: index % 3 === 0 ? 1 : 2 });
    const short = Math.ceil(LINES / 3);
    const sheet = await w.one('counts', count);
    expect([n(sheet['lines']), n(sheet['uncounted']), n(sheet['differences']), n(sheet['value'])]).toEqual([LINES, 0, short, -short]);

    await w.update('counts', count, { status: 'posting' });
    for (const line of lines) await w.update('count_lines', line, { status: 'posted' });
    // The sheet reads posted only once no line is out.
    expect(n((await w.one('counts', count))['unposted'])).toBe(0);
    await w.update('counts', count, { status: 'posted' });
    expect(n((await pointOf(w, vial, room))['on_hand'])).toBe(2 * LINES - short);
    // One movement a line that differs, none for a line that agrees.
    expect(await w.rowsOf('movements', `item_id = ${String(vial)} and kind = 'adjusted'`)).toHaveLength(short);

    await w.update('counts', count, { status: 'reversing' });
    for (const line of lines) await w.update('count_lines', line, { status: 'reversed' });
    await w.update('counts', count, { status: 'reversed' });
    expect(n((await pointOf(w, vial, room))['on_hand'])).toBe(2 * LINES);
    expect(await w.rowsOf('movements', `item_id = ${String(vial)} and kind = 'adjusted'`)).toHaveLength(2 * short);
  }, 1_800_000);

  it.skipIf(!run)('a line cannot post while its sheet is not being posted: the sheet is no single transaction to hide in', async () => {
    const [level] = await w.rowsOf('levels', `item_id = ${String(vial)} and place_id = ${String(room)} order by id`);
    const count = n((await w.create('counts', { place_id: room, scope: 'all' })).row['id']);
    const line = n((await w.create('count_lines', { count_id: count, level_id: level?.['id'] })).row['id']);
    await w.create('count_marks', { count_line_id: line, counted: 2 });
    await expect(w.update('count_lines', line, { status: 'posted' })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
  });
});
