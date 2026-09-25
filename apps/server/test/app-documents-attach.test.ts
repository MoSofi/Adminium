// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on connected to an app AFTER the app was installed, on SQLite,
 * Postgres and MySQL.
 *
 * A practice installs without the add-on it only suggests, so its insurer
 * receipt is off. Connecting the add-on later — from the add-ons page or the
 * app's own add-ons card — must switch the receipt on there and then, without
 * waiting for the app's next update to make its document. Switching the add-on
 * off for the app turns the receipt off again, the way it does for a document
 * the install made.
 *
 * Connecting an add-on makes only what is missing of the documents that need
 * THAT add-on: a profile the operator renamed or remapped stays as they left
 * it, one they deleted stays deleted when some other add-on is connected, and
 * nothing is ever removed on the way — not even when the app's tables cannot
 * be read at that moment.
 */
import { documentProfilesRepo, manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { installedShapes, makeAppProfiles } from '../src/documents/app-profiles.js';

import { addOnHarness, addOnManifest, appManifest, ENGINES, type Harness } from './app-add-ons.helpers.js';
import { standInProvider } from './app-documents.helpers.js';

const clinic = () =>
  appManifest('clinic', {
    name: 'Clinic',
    requiredSchema: {
      tables: [
        {
          ref: 'payments',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'patient', type: 'text', maxLength: 120, nullable: true },
            { ref: 'insurer', type: 'text', maxLength: 120, nullable: true },
            { ref: 'amount', type: 'decimal', scale: 2, nullable: true },
          ],
        },
      ],
    },
    addOns: {
      suggests: [
        { key: 'invoices', range: '>=1.0.0', reason: { 'en-US': 'Prints receipts for insurers.' } },
        { key: 'labels', range: '>=1.0.0', reason: { 'en-US': 'Prints labels.' } },
      ],
    },
    documents: [
      {
        kind: 'insurer-receipt',
        addOn: 'invoices',
        table: 'payments',
        name: 'Receipt for the insurer',
        mapping: { insurer: { column: 'insurer' }, patient: { column: 'patient' }, amount: { column: 'amount' } },
      },
      {
        kind: 'receipt',
        addOn: 'invoices',
        table: 'payments',
        name: 'Receipt for the patient',
        mapping: { amount: { column: 'amount' } },
      },
    ],
  });

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`an add-on connected to an installed app on ${dialect}`, () => {
    const setUp = async () => {
      const { drawn, runtime } = standInProvider();
      h = await addOnHarness(dialect, { documents: { runtime: () => runtime } });
      await h.stageAddOn(addOnManifest('invoices', { name: 'Invoices & Receipts' }));
      await h.stageAddOn(addOnManifest('labels', { name: 'Labels' }));
      await h.stageApp(clinic());
      const installed = await h.install('clinic', '0.2.0');
      expect(installed.statusCode, installed.body).toBe(200);
      await h.rows(`insert into payments (id, patient, insurer, amount) values (1, 'Cormac', 'Laya', '60.00')`);
      return { harness: h, drawn };
    };
    const draw = (harness: Harness) =>
      harness.inject({ method: 'POST', url: '/apps/clinic/documents/render', payload: { kind: 'insurer-receipt', ref: 'payments', pk: { id: 1 } } });
    const off = async (harness: Harness) => {
      const res = await draw(harness);
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json().error.code).toBe('FEATURE_OFF');
    };

    it('draws the receipt once the add-on is connected, and stops when it is switched off for the app', async () => {
      const { harness, drawn } = await setUp();
      await off(harness);

      // Installed for the dashboard only: still not the practice's.
      const installed = await harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'invoices', version: '1.0.0', attachTo: [] } });
      expect(installed.statusCode, installed.body).toBe(200);
      await off(harness);

      const attached = await harness.inject({ method: 'POST', url: '/add-ons/invoices/attachments', payload: { app: 'clinic' } });
      expect(attached.statusCode, attached.body).toBe(200);
      const first = await draw(harness);
      expect(first.statusCode, first.body).toBe(201);
      expect(drawn.at(-1)!.subject).toMatchObject({ fields: { insurer: 'Laya', patient: 'Cormac', amount: 6000 } });

      // Switched off for the app: off again, the profile kept as an install's is.
      const switchedOff = await harness.inject({ method: 'PATCH', url: '/add-ons/invoices', payload: { attachedTo: 'clinic', enabled: false } });
      expect(switchedOff.statusCode, switchedOff.body).toBe(200);
      await off(harness);
      const kept = await documentProfilesRepo(harness.meta).listOwnedBy(harness.connectionId, 'clinic');
      expect(kept.map((p) => p.kind).sort()).toEqual(['insurer-receipt', 'receipt']);

      const back = await harness.inject({ method: 'PATCH', url: '/add-ons/invoices', payload: { attachedTo: 'clinic', enabled: true } });
      expect(back.statusCode, back.body).toBe(200);
      expect((await draw(harness)).statusCode).toBe(200);
    }, 90_000);

    it('draws the receipt when the add-on is installed straight onto the app', async () => {
      const { harness } = await setUp();
      await off(harness);
      const installed = await harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'invoices', version: '1.0.0', attachTo: ['clinic'] } });
      expect(installed.statusCode, installed.body).toBe(200);
      const res = await draw(harness);
      expect(res.statusCode, res.body).toBe(201);
      // Made once, however often the add-on is connected again.
      expect((await harness.inject({ method: 'POST', url: '/add-ons/invoices/attachments', payload: { app: 'clinic' } })).statusCode).toBe(200);
      expect(await documentProfilesRepo(harness.meta).listOwnedBy(harness.connectionId, 'clinic')).toHaveLength(2);
    }, 90_000);

    it('leaves the operator’s edits and deletions alone, and makes only what the connected add-on is missing', async () => {
      const { harness } = await setUp();
      const repo = documentProfilesRepo(harness.meta);
      const owned = async () => (await repo.listOwnedBy(harness.connectionId, 'clinic')).sort((a, b) => a.kind.localeCompare(b.kind));
      expect((await harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'invoices', version: '1.0.0', attachTo: ['clinic'] } })).statusCode).toBe(200);
      const [insurer, patient] = await owned();
      expect([insurer!.kind, patient!.kind]).toEqual(['insurer-receipt', 'receipt']);

      // The operator renames and remaps one, and deletes the other.
      await repo.patch(insurer!.id, { name: 'Insurer copy', mapping: { insurer: { column: 'insurer' }, amount: { column: 'amount' } } });
      expect((await harness.inject({ method: 'DELETE', url: `/documents/profiles/${patient!.id}` })).statusCode).toBe(204);
      const edited = (await repo.findById(insurer!.id))!;

      // Another add-on connected to the app: nothing of theirs changes, nothing comes back.
      const labels = await harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'labels', version: '1.0.0', attachTo: ['clinic'] } });
      expect(labels.statusCode, labels.body).toBe(200);
      expect(await owned()).toEqual([edited]);

      // The add-on the documents need, connected again: the missing one is made, the edited one kept.
      expect((await harness.inject({ method: 'POST', url: '/add-ons/invoices/attachments', payload: { app: 'clinic' } })).statusCode).toBe(200);
      const after = await owned();
      expect(after.map((p) => p.kind)).toEqual(['insurer-receipt', 'receipt']);
      expect(after[0]).toEqual(edited);
      expect(after[1]!.name).toBe('Receipt for the patient');
    }, 90_000);

    it('removes nothing when the app’s tables cannot be read', async () => {
      const { harness } = await setUp();
      const repo = documentProfilesRepo(harness.meta);
      expect((await harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'invoices', version: '1.0.0', attachTo: ['clinic'] } })).statusCode).toBe(200);
      const [one] = await repo.listOwnedBy(harness.connectionId, 'clinic');
      await repo.patch(one!.id, { options: { locale: 'de-DE' } });
      const before = (await repo.listOwnedBy(harness.connectionId, 'clinic')).sort((a, b) => a.id.localeCompare(b.id));

      // An update's sync that finds none of the app's tables: every profile is still asked for.
      const manifest = (await manifestsRepo(harness.meta, { encrypt: (v) => v, decrypt: (v) => v }).findByKey('clinic'))!.document as never;
      const synced = await makeAppProfiles({ meta: harness.meta, manifest, connectionId: harness.connectionId, realId: () => null, shapes: await installedShapes(harness.meta) });
      expect(synced.removed).toEqual([]);

      // The schema cannot be read at all while an add-on is connected.
      await harness.meta.db.deleteFrom('adminium_schema_snapshots' as never).execute();
      expect((await harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'labels', version: '1.0.0', attachTo: ['clinic'] } })).statusCode).toBe(200);
      expect((await harness.inject({ method: 'POST', url: '/add-ons/invoices/attachments', payload: { app: 'clinic' } })).statusCode).toBe(200);
      expect((await repo.listOwnedBy(harness.connectionId, 'clinic')).sort((a, b) => a.id.localeCompare(b.id))).toEqual(before);
    }, 90_000);
  });
}
