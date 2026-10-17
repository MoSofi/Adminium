// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two stores the rules keep for people, on every available dialect:
 *
 * - A rule's spells (`adminium_automation_spells`): a row that starts to
 *   match opens a spell, one that stops matching on a whole tick closes it,
 *   and one that matches again opens the next; a start that did not become a
 *   run is taken back as if the tick never saw it.
 * - When a person is told (`adminium_notification_schedules`): quiet hours, a
 *   day and time for summaries, and the two switches (quiet hours off keeps
 *   the hours; "not me" keeps the day). A row with nothing set is not kept.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, automationSpellsRepo, automationsRepo, notificationSchedulesRepo, usersRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const TRIGGER = { kind: 'record', event: 'created', connectionId: 'cnx_1', table: 'public.users', watch: true } as const;
const GRAPH = { version: 1, nodes: [{ id: 'n1', kind: 'trigger', title: 'When a user signs up' }] } as const;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`spells and schedules [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('opens a spell when a row starts to match, closes it on a whole tick, and opens the next when it matches again', async () => {
      const rule = await automationsRepo(t.meta).create({ connectionId: null, name: 'Rule', trigger: TRIGGER as never, graph: GRAPH as never });
      const spells = automationSpellsRepo(t.meta);
      expect(await spells.settle(rule.id, ['1', '2'], { at: 1000, complete: true })).toEqual([
        { rowKey: '1', spell: 1 },
        { rowKey: '2', spell: 1 },
      ]);
      // Still matching: nothing starts, the tick is noted.
      expect(await spells.settle(rule.id, ['1', '2'], { at: 2000, complete: true })).toEqual([]);
      // Row 2 stops matching, but the tick did not read every row: its spell stays open.
      expect(await spells.settle(rule.id, ['1'], { at: 3000, complete: false })).toEqual([]);
      expect((await spells.listFor(rule.id)).map((row) => [row.rowKey, row.spell, row.open])).toEqual([
        ['1', 1, true],
        ['2', 1, true],
      ]);
      // A whole tick without it: closed.
      await spells.settle(rule.id, ['1'], { at: 4000, complete: true });
      expect((await spells.listFor(rule.id)).map((row) => [row.rowKey, row.spell, row.open, row.lastTick])).toEqual([
        ['1', 1, true, 4000],
        ['2', 1, false, 2000],
      ]);
      // It matches again: the second spell.
      expect(await spells.settle(rule.id, ['1', '2'], { at: 5000, complete: true })).toEqual([{ rowKey: '2', spell: 2 }]);
    });

    it('takes back a start that did not become a run: a first spell goes, a later one is as it was', async () => {
      const rule = await automationsRepo(t.meta).create({ connectionId: null, name: 'Rule', trigger: TRIGGER as never, graph: GRAPH as never });
      const spells = automationSpellsRepo(t.meta);
      const [first] = await spells.settle(rule.id, ['7'], { at: 1000, complete: true });
      await spells.undoStart(rule.id, first!);
      expect(await spells.listFor(rule.id)).toEqual([]);
      await spells.settle(rule.id, ['7'], { at: 2000, complete: true });
      await spells.settle(rule.id, [], { at: 3000, complete: true });
      const [second] = await spells.settle(rule.id, ['7'], { at: 4000, complete: true });
      expect(second).toEqual({ rowKey: '7', spell: 2 });
      await spells.undoStart(rule.id, second!);
      expect((await spells.listFor(rule.id)).map((row) => [row.rowKey, row.spell, row.open])).toEqual([['7', 1, false]]);
    });

    it('keeps when a person is told, with both switches, and keeps no row with nothing set', async () => {
      const userId = (await usersRepo(t.meta).create({ email: 'ann@example.test', name: 'Ann', passwordHash: 'x' })).id;
      const schedules = notificationSchedulesRepo(t.meta);
      expect(await schedules.find(userId)).toBeNull();
      const quiet = { '1': { from: '18:30', to: '08:00' } };
      expect(await schedules.set(userId, { timezone: 'Europe/Berlin', quiet, digestDay: 1, digestTime: '07:00' }, 1000)).toEqual({
        userId,
        timezone: 'Europe/Berlin',
        quiet,
        digestDay: 1,
        digestTime: '07:00',
        quietOff: false,
        summariesOff: false,
        updatedAt: 1000,
      });
      // Quiet hours off keep their hours; "not me" keeps the day and time.
      expect(await schedules.set(userId, { timezone: 'Europe/Berlin', quiet, digestDay: 1, digestTime: '07:00', quietOff: true, summariesOff: true }, 2000)).toMatchObject({ quiet, quietOff: true, summariesOff: true, digestDay: 1, updatedAt: 2000 });
      // The same values again: still one row, as it was (MySQL counts no row changed).
      expect(await schedules.set(userId, { timezone: 'Europe/Berlin', quiet, digestDay: 1, digestTime: '07:00', quietOff: true, summariesOff: true }, 2000)).toMatchObject({ quietOff: true, summariesOff: true });
      // Off with no hours to keep is simply no quiet hours.
      expect(await schedules.set(userId, { timezone: null, quiet: null, digestDay: null, digestTime: null, quietOff: true, summariesOff: true }, 3000)).toMatchObject({ quiet: null, quietOff: false, summariesOff: true });
      // Nothing set at all: the row goes.
      expect(await schedules.set(userId, { timezone: null, quiet: {}, digestDay: null, digestTime: null })).toBeNull();
      expect(await schedules.find(userId)).toBeNull();
    });
  });
}
