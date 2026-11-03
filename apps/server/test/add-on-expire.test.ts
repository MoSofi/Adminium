// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S ROWS LET GO WHEN THEY EXPIRE, on a clock the test holds.
 *
 * The design kit's designs expire 90 days after their last change unless
 * ordered. The daily sweep lets go of a draft past its time and its files go
 * to the bin with it; it keeps an ordered one however old, a draft within its
 * time, one with no moment at all, one an order line still names, and one
 * another row of the add-on still points at. On every engine this run can
 * reach, through the real installer; and the server runs it daily.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADD_ON_EXPIRE_SWEEP_NAME, sweepExpiredRows } from '../src/add-ons/expire.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { DESIGN_KIT, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const DAY = 86_400_000;
/** The test's own today. */
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
/** A moment as Adminium stores one on each engine: ISO on SQLite and Postgres, a UTC datetime on MySQL. */
const stored = (dialect: string, at: number) => (dialect === 'mysql' ? new Date(at).toISOString().replace('T', ' ').replace('Z', '') : new Date(at).toISOString());

describe.each(LEGS)("an add-on's rows that expire — %s", (dialect, available) => {
  let h: Harness;
  const trashed: string[] = [];
  const daysAgo = (days: number) => stored(dialect, NOW - days * DAY);
  const left = async () => (await h.rows('SELECT id FROM design_kit_designs ORDER BY id')).map((row) => Number(row['id']));

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    // A child table of the kit's own, so one design is still pointed at by a row of the database.
    const kit = designKitManifest();
    const tables = (kit['requiredSchema'] as { tables: Record<string, unknown>[] }).tables;
    tables.push({ ref: 'layers', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'design_id', type: 'fk', references: 'designs' }] });
    await h.stageAddOn(kit);
    await h.stageApp(designShopManifest('printing'));
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    const row = (id: number, state: string, at: string | null) => `(${String(id)}, 'CODE${String(id).padStart(12, '0')}', 'printing', '${state}', 'Words ${String(id)}', ${at === null ? 'NULL' : `'${at}'`})`;
    await h.rows(
      'INSERT INTO design_kit_designs (id, code, app, state, name_text, updated_at) VALUES ' +
        [row(1, 'draft', daysAgo(100)), row(2, 'ordered', daysAgo(400)), row(3, 'draft', daysAgo(10)), row(4, 'draft', null), row(5, 'draft', daysAgo(91)), row(6, 'draft', daysAgo(95)), row(7, 'draft', daysAgo(88))].join(', '),
    );
    // Design 5 is still on an order line; design 6 still has a layer.
    await h.rows(`INSERT INTO printing_orders (id, name) VALUES (1, 'Ben')`);
    await h.rows(`INSERT INTO printing_order_lines (id, order_id, qty, design_id) VALUES (1, 1, 1, 5)`);
    await h.rows(`INSERT INTO design_kit_layers (id, design_id) VALUES (1, 6)`);
  }, 240_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('lets go of a draft past its 90 days, its files to the bin, and keeps every other', async () => {
    const swept = await sweepExpiredRows({
      meta: h.meta,
      manager: h.manager,
      now: () => NOW,
      files: {
        trashForRecord: async (input) => {
          trashed.push(`${input.entity.label}:${String(input.row['name_text'])}`);
          return [];
        },
      },
    });
    expect(swept).toEqual({ 'design-kit:designs': 1 });
    // Ordered (400 days), within its time (10 and 88 days), no moment, on an order line, pointed at by a layer: kept.
    expect(await left()).toEqual([2, 3, 4, 5, 6, 7]);
    expect(trashed).toEqual(['1:Words 1']);
    // A second run on the same day has nothing more to let go.
    expect(await sweepExpiredRows({ meta: h.meta, manager: h.manager, now: () => NOW })).toEqual({});
  });

  it.skipIf(!available)('once the line lets go of its design, the next day lets go of the design', async () => {
    await h.rows('UPDATE printing_order_lines SET design_id = NULL WHERE id = 1');
    expect(await sweepExpiredRows({ meta: h.meta, manager: h.manager, now: () => NOW + DAY })).toEqual({ 'design-kit:designs': 1 });
    expect(await left()).toEqual([2, 3, 4, 6, 7]);
  });

  it.skipIf(!available)('the server runs it daily', async () => {
    // A draft long past its time on the real clock, which the server's own run goes by.
    const stale = stored(dialect, Date.now() - 1000 * DAY);
    await h.rows(`INSERT INTO design_kit_designs (id, code, app, state, name_text, updated_at) VALUES (8, 'CODE000000000008', 'printing', 'draft', 'Stale', '${stale}')`);
    const served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    try {
      await served.composed.jobs.scheduler.trigger(ADD_ON_EXPIRE_SWEEP_NAME);
      for (let round = 0; round < 5; round += 1) {
        await h.meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never).execute();
        if ((await served.composed.jobs.worker.runOnce()) === 0) break;
      }
      expect(await left()).not.toContain(8);
      // The ordered design and the one with no moment stay, whatever the day.
      expect(await left()).toEqual(expect.arrayContaining([2, 4, 6]));
    } finally {
      await served.close();
    }
  });
});
