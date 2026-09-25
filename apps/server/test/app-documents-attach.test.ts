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
 */
import { documentProfilesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

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
    addOns: { suggests: [{ key: 'invoices', range: '>=1.0.0', reason: { 'en-US': 'Prints receipts for insurers.' } }] },
    documents: [
      {
        kind: 'insurer-receipt',
        addOn: 'invoices',
        table: 'payments',
        name: 'Receipt for the insurer',
        mapping: { insurer: { column: 'insurer' }, patient: { column: 'patient' }, amount: { column: 'amount' } },
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
      expect(kept.map((p) => p.kind)).toEqual(['insurer-receipt']);

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
      expect(await documentProfilesRepo(harness.meta).listOwnedBy(harness.connectionId, 'clinic')).toHaveLength(1);
    }, 90_000);
  });
}
