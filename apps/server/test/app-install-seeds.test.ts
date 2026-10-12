// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S STARTING ROWS ARE WRITTEN BY ITS INSTALL (plan 67, question H).
 *
 * An app's manifest could always carry `seeds`, and an install took them and
 * wrote none: only an add-on's were written. An app whose rules read a
 * settings row (a snag's due day is "raised on, plus the setting") therefore
 * could not be used until somebody made that row by hand.
 *
 * Here, on every engine: the install writes them after the rules, into empty
 * tables only; an update writes those of the tables it brings and leaves the
 * rest to their owner; a refused row stops the install at the "seeds" step
 * with none of them written, and the same install taken up again writes
 * none twice.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

const tables = (withUnits: boolean): Record<string, unknown>[] => [
  {
    ref: 'settings',
    columns: [id, { ref: 'snag_days', type: 'int', default: 5 }, { ref: 'threshold_pct', type: 'decimal', scale: 2, default: 5 }, { ref: 'week_starts', type: 'enum', enum: ['mon', 'sun'], default: 'mon' }, { ref: 'depot_name', type: 'text', maxLength: 80, nullable: true }],
  },
  { ref: 'reasons', columns: [id, { ref: 'label', type: 'text', maxLength: 80 }, { ref: 'position', type: 'int', default: 0 }] },
  // A row that reads the settings as it is made: the reason an app needs the settings row from the first second.
  {
    ref: 'snags',
    columns: [id, { ref: 'text', type: 'text', maxLength: 200 }, { ref: 'reason_id', type: 'fk', references: 'reasons', nullable: true }, { ref: 'due_days', type: 'int', nullable: true, rules: { default: { from: { table: 'settings', column: 'snag_days' } } } }],
  },
  ...(withUnits ? [{ ref: 'units', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] }] : []),
];
const seeds = (withUnits: boolean, lateLabel = 'Late'): Record<string, unknown>[] => [
  { table: 'settings', rows: [{}] },
  { table: 'reasons', rows: [{ '@label': 'late', label: { '@t': { 'en-US': lateLabel, 'de-DE': 'Verspätet' } }, position: 1 }, { label: 'Damaged', position: 2 }] },
  { table: 'snags', rows: [{ text: 'A first snag, to show the form', reason_id: { '@ref': 'late' } }] },
  ...(withUnits ? [{ table: 'units', rows: [{ name: 'each' }, { name: 'metre' }] }] : []),
];
const manifest = (version: string, withUnits = false, lateLabel = 'Late'): Record<string, unknown> => ({
  ...invoicingManifest(tables(withUnits)),
  version,
  compatibility: { minAdminiumVersion: '0.3.27' },
  pages: [{ ref: 'studio-reasons', template: 'page-crud', title: { key: 't', fallback: 'Reasons' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'reasons' } }],
  seeds: seeds(withUnits, lateLabel),
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an app's starting rows, written by its install [${dialect}]`, () => {
    let h: InvoicingHarness & { reply: Record<string, unknown> };
    const stage = async (doc: Record<string, unknown>): Promise<void> => {
      const tarball = packageTarball({ 'manifest.json': JSON.stringify(doc), 'staff/index.html': '<!doctype html><html><body></body></html>' });
      const staged = await h.app.inject({ method: 'POST', url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
      expect(staged.statusCode, staged.body).toBe(200);
    };
    const count = async (table: string): Promise<number> => Number((await h.rows(`SELECT COUNT(*) AS n FROM ${table}`))[0]!['n']);

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest('0.2.0'));
    }, 240_000);
    afterAll(async () => {
      await h?.close();
    });

    it('writes them at install and says so: the settings row of defaults, a text in the installer\'s language, a row that names an earlier one', async () => {
      expect((h.reply as { seeds?: unknown }).seeds).toEqual({ written: { settings: 1, reasons: 2, snags: 1 }, kept: [] });
      const settings = await h.rows('SELECT snag_days, threshold_pct, week_starts, depot_name FROM studio_settings');
      expect(settings).toHaveLength(1);
      expect([Number(settings[0]!['snag_days']), Number(settings[0]!['threshold_pct']), settings[0]!['week_starts'], settings[0]!['depot_name']]).toEqual([5, 5, 'mon', null]);
      const reasons = await h.rows('SELECT id, label, position FROM studio_reasons ORDER BY position');
      expect(reasons.map((row) => row['label'])).toEqual(['Late', 'Damaged']);
      // The snag found its reason by label, and took its due days from the settings row written a moment before it.
      const snag = (await h.rows('SELECT reason_id, due_days FROM studio_snags'))[0]!;
      expect([Number(snag['reason_id']), Number(snag['due_days'])]).toEqual([Number(reasons[0]!['id']), 5]);
    });

    it('an update writes the rows of the tables it brings, and leaves every other table to its owner', async () => {
      // The owner's own doing since the install: a setting changed, a reason removed.
      await h.rows('UPDATE studio_settings SET snag_days = 9');
      await h.rows("DELETE FROM studio_snags");
      await h.rows("DELETE FROM studio_reasons WHERE label = 'Damaged'");
      await stage(manifest('0.2.1', true, 'Late, renamed by the publisher'));
      const plan = await h.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'studio', version: '0.2.1', connectionId: h.connectionId } });
      expect(plan.statusCode, plan.body).toBe(200);
      const updated = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
      expect(updated.statusCode, updated.body).toBe(200);
      expect((updated.json() as { app: { seeds?: unknown } }).app.seeds).toEqual({ written: { units: 2 }, kept: [] });
      expect((await h.rows('SELECT name FROM studio_units ORDER BY id')).map((row) => row['name'])).toEqual(['each', 'metre']);
      expect(Number((await h.rows('SELECT snag_days FROM studio_settings'))[0]!['snag_days'])).toBe(9);
      expect((await h.rows('SELECT label FROM studio_reasons')).map((row) => row['label'])).toEqual(['Late']);
      // The table the owner emptied is not filled again: it was not this version's to bring.
      expect(await count('studio_snags')).toBe(0);
    }, 240_000);

    it('a refused row stops the install at the seeds step with none of them written, and nothing is removed', async () => {
      // A second app in the same database, one of whose rows names a reason that is not there.
      const second = (broken: boolean): Record<string, unknown> => ({
        ...manifest('0.1.0'),
        key: 'depot',
        name: 'Depot',
        pages: [{ ref: 'depot-reasons', template: 'page-crud', title: { key: 't', fallback: 'Reasons' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'reasons' } }],
        seeds: [...seeds(false), ...(broken ? [{ table: 'snags', rows: [{ text: 'Points nowhere', reason_id: 999_999 }] }] : [])],
      });
      await stage(second(true));
      const body = { key: 'depot', version: '0.1.0', connectionId: h.connectionId };
      expect((await h.app.inject({ method: 'POST', url: '/apps/plan', payload: body })).statusCode).toBe(200);
      const stopped = await h.app.inject({ method: 'POST', url: '/apps/install', payload: body });
      expect(stopped.statusCode, stopped.body).toBe(409);
      expect(stopped.body).toContain('APP_INSTALL_INCOMPLETE');
      expect(stopped.body).toMatch(/stopped at the seeds step: A starting row for \\"snags\\" was refused by the database/);
      // Not in the database's own words: no constraint and no database is named.
      expect(stopped.body).not.toMatch(/fk_|constraint|adminium_invoicing/i);
      // One transaction: the rows before the refused one are not there either.
      expect([await count('depot_settings'), await count('depot_reasons'), await count('depot_snags')]).toEqual([0, 0, 0]);
      // Taken up again it stops at the same step, the tables still there and still empty.
      const again = await h.app.inject({ method: 'POST', url: '/apps/install', payload: body });
      expect(again.statusCode, again.body).toBe(409);
      expect(again.body).toMatch(/stopped at the seeds step/);
      expect([await count('depot_settings'), await count('depot_reasons'), await count('depot_snags')]).toEqual([0, 0, 0]);
    }, 240_000);
  });
}
