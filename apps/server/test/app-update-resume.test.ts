// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN UPDATE THAT STOPS AFTER ITS VERSION MOVED IS FINISHED BY RUNNING IT AGAIN.
 *
 * An update records the new version before it writes the version's pages,
 * rules, roles, mails, documents, keys and starting rows, because those are
 * written for it. That stage used to log a failure and carry on, so a part
 * of the new version could go missing with nothing to say so, and running
 * the update again found "no newer version". Now, on every engine: a part
 * that cannot be written stops the update with a coded 409 naming the step,
 * the unfinished update stays recorded, and the same update run again
 * finishes it — the starting rows of the tables the version brings included,
 * and nothing written twice.
 */
import { appUpdatesRepo, manifestsRepo, pagesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

// The mails step fails once when asked to: a part of the new version that cannot be written.
const fault = vi.hoisted(() => ({ armed: false }));
vi.mock('../src/apps/manifest-outbox.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/apps/manifest-outbox.js')>();
  return {
    ...real,
    installOutbox: async (...args: Parameters<typeof real.installOutbox>) => {
      if (fault.armed) {
        fault.armed = false;
        throw new Error('The mail store could not be reached.');
      }
      return real.installOutbox(...args);
    },
  };
});

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const id = { ref: 'id', type: 'int', role: 'pk' };
const tables = (withUnits: boolean): Record<string, unknown>[] => [
  { ref: 'reasons', columns: [id, { ref: 'label', type: 'text', maxLength: 80 }] },
  ...(withUnits ? [{ ref: 'units', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] }] : []),
];
const manifest = (version: string, withUnits = false): Record<string, unknown> => ({
  ...invoicingManifest(tables(withUnits)),
  version,
  compatibility: { minAdminiumVersion: '0.3.28' },
  pages: [
    { ref: 'studio-reasons', template: 'page-crud', title: { key: 't', fallback: 'Reasons' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'reasons' } },
    ...(withUnits ? [{ ref: 'studio-units', template: 'page-crud', title: { key: 'u', fallback: 'Units' }, nav: { group: 'library', icon: 'list', order: 2 }, bindings: { rows: 'units' } }] : []),
  ],
  seeds: [{ table: 'reasons', rows: [{ label: 'Late' }] }, ...(withUnits ? [{ table: 'units', rows: [{ name: 'each' }, { name: 'metre' }] }] : [])],
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an update stopped after its version moved [${dialect}]`, () => {
    let h: InvoicingHarness;
    const stage = async (doc: Record<string, unknown>): Promise<void> => {
      const tarball = packageTarball({ 'manifest.json': JSON.stringify(doc), 'staff/index.html': '<!doctype html><html><body></body></html>' });
      const staged = await h.app.inject({ method: 'POST', url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
      expect(staged.statusCode, staged.body).toBe(200);
    };
    const installRow = async () => (await manifestsRepo(h.meta, CRYPTO).listByKey('studio'))[0]!;
    const count = async (table: string): Promise<number> => Number((await h.rows(`SELECT COUNT(*) AS n FROM ${h.real(table)}`))[0]!['n']);

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest('0.2.0'));
    }, 240_000);
    afterAll(async () => {
      fault.armed = false;
      await h?.close();
    });

    it('stops with the step named, keeps the update recorded, and the same update run again finishes it', async () => {
      await stage(manifest('0.2.1', true));
      fault.armed = true;
      const stopped = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
      expect(stopped.statusCode, stopped.body).toBe(409);
      expect(stopped.body).toContain('APP_UPDATE_INCOMPLETE');
      expect(stopped.body).toContain('stopped at the pages step: The mail store could not be reached.');
      expect(stopped.body).toContain('Update it again to finish.');

      // The version moved and its table is there; what comes after the failed part is not written yet.
      const row = await installRow();
      expect(row.row.version).toBe('0.2.1');
      expect(await appUpdatesRepo(h.meta).find(row.row.id)).toMatchObject({ fromVersion: '0.2.0', toVersion: '0.2.1', fromTables: ['reasons'], stoppedAt: 'pages' });
      expect(await count('units')).toBe(0);

      // Run again: no newer version is staged, and the unfinished update is finished.
      const finished = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
      expect(finished.statusCode, finished.body).toBe(200);
      expect(finished.json()).toMatchObject({ from: '0.2.0', to: '0.2.1', app: { version: '0.2.1', seeds: { written: { units: 2 }, kept: [] } } });
      expect((await h.rows(`SELECT name FROM ${h.real('units')} ORDER BY id`)).map((one) => one['name'])).toEqual(['each', 'metre']);
      expect(await appUpdatesRepo(h.meta).find(row.row.id)).toBeNull();
      // The page the version brings is there once.
      expect((await pagesRepo(h.meta).listAll()).filter((page) => page.slug === 'studio-units')).toHaveLength(1);

      // Finished, the same call finds nothing newer to do.
      const again = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
      expect(again.statusCode, again.body).toBe(404);
      expect(await count('units')).toBe(2);
    }, 240_000);
  });
}
