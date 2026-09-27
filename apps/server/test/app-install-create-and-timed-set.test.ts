// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a new row must meet to be created and the fixed values a timed move
 * writes, through a real install on every engine: stored exactly as the
 * manifest says them (a key the store dropped would leave the rule unrun),
 * each settings table at its real id, every link a state reads resolved in
 * the model the write path reads, and the live check naming what a database
 * lacks.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { mapTableRefs } from '../src/apps/real-refs.js';
import { statesRuleIssue } from '../src/connections/column-rules-validation.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { venueManifest, venueTables, type Doc } from './venue-moves.fixture.js';

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

const statesOf = (ref: string) => venueTables().find((t) => t['ref'] === ref)!['states'] as Doc;

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`created rows and timed values, stored on ${dialect}`, () => {
    it('keep every key, each table at its real id, and every link resolved', async () => {
      const h = await installInvoicing(dialect, venueManifest());
      open = h;
      expect((h.reply['rules'] as { skipped: unknown[] }).skipped).toEqual([]);
      const stored = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o) => o.origin === 'app');
      const idOf = (ref: string) => stored.find((o) => o.tableName === `venue_${ref}` || o.tableName.endsWith(`.venue_${ref}`))!.tableName;
      const schemaOf = idOf('orders').includes('.') ? `${idOf('orders').split('.')[0]!}.` : '';
      const real = (ref: string) => `${schemaOf}venue_${ref}`;
      const expected = <T,>(value: T): T => mapTableRefs(value, real).value;
      const states = (ref: string) => stored.find((o) => o.op === 'table.states' && o.tableName === idOf(ref))!.value as Doc;

      expect(states('check_ins')).toEqual(expected(statesOf('check_ins')));
      expect(states('orders')).toEqual(expected(statesOf('orders')));
      expect((states('orders')['timed'] as Doc[])[2]!['set']).toEqual({ cancel_code: 'unpaid' });
      expect(JSON.stringify(states('check_ins'))).toContain(`"table":"${real('settings')}"`);

      const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
      const model = applyOverrides(parseDatabaseModel(snapshot!.schema), stored);
      const checkIns = model.tables.find((t) => t.id === idOf('check_ins'))!;
      expect(checkIns.states?.create).toEqual(expected(statesOf('check_ins')['create']));
      expect(checkIns.stateLinks).toEqual([{ via: 'ticket_id', table: idOf('tickets'), key: 'id' }]);
      expect(checkIns.unresolvedStateLinks).toBeUndefined();
      const stays = model.tables.find((t) => t.id === idOf('stays'))!;
      expect(stays.stateLinks).toEqual([{ via: 'room_id', table: idOf('rooms'), key: 'id' }]);

      // A database that lost the link a create reads through is told so before a rule is kept.
      const unlinked = { ...(snapshot!.schema as object), relations: (snapshot!.schema as { relations: { from: { tableId: string } }[] }).relations.filter((r) => r.from.tableId !== idOf('check_ins')) };
      const lost = parseDatabaseModel(unlinked);
      const table = lost.tables.find((t) => t.id === idOf('check_ins'))!;
      expect(statesRuleIssue(states('check_ins'), table, lost)).toContain('ticket_id does not point at another table');
      // A timed move's value for a column the table lacks.
      const orders = lost.tables.find((t) => t.id === idOf('orders'))!;
      const broken = { ...states('orders'), timed: [{ from: 'held', to: 'expired', at: { column: 'held_until' }, set: { nope: 'x' } }] };
      expect(statesRuleIssue(broken, orders, lost)).toContain('has no column "nope"');
      // And a model that lost the link refuses the moves that read through it.
      const effective = applyOverrides(lost, stored);
      expect(effective.tables.find((t) => t.id === idOf('check_ins'))!.unresolvedStateLinks).toEqual(['ticket_id']);
    });
  });
}
