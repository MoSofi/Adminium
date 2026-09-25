// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A signed-in client reads the payment instructions of an add-on their app
 * needs — through the app's own key, after a verified sign-in, and only the
 * settings the add-on's author marked for a browser. Before sign-in, at the
 * lookup level, for an add-on the app does not name or has not attached,
 * through another key: nothing, one answer.
 */
import { addOnSettingsRepo, manifestsRepo, publicSessionsRepo, readJson } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generatePublicSessionToken } from '../src/public-api/keys.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };

function manifest(): Record<string, unknown> {
  return {
    ...invoicingManifest([
      {
        ref: 'clients',
        columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'contact_name', type: 'text', maxLength: 120 }, { ref: 'email', type: 'text', maxLength: 254, unique: true }],
      },
    ]),
    publicAccess: [{ table: 'clients', methods: ['GET'], select: ['contact_name'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true }],
  };
}

/** An add-on as the store keeps it: settings, and the ones marked for a browser. */
function addOn(key: string): Record<string, unknown> {
  return {
    kind: 'add-on',
    key,
    version: '1.1.0',
    settings: [
      { key: 'payment_instructions', type: 'text', default: 'Pay by bank transfer.' },
      { key: 'business_name', type: 'text' },
      { key: 'internal_note', type: 'text', default: 'not for clients' },
      { key: 'bank_token', type: 'text', secret: true, default: 'sk_live_never' },
    ],
    // `bank_token` listed by mistake: the validator refuses it, and this read does not rely on that.
    addOn: { publicSettings: ['payment_instructions', 'business_name', 'bank_token'] },
  };
}

describe.each(LEGS)('an add-on’s public settings, for a signed-in client — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let keyId: string;
  const read = (key: string, session?: string) => served.get(`/add-ons/${key}/settings`, session);
  const session = async (level: 'lookup' | 'verified') => {
    const minted = generatePublicSessionToken();
    await publicSessionsRepo(h.meta).create({
      keyId,
      tokenHash: minted.tokenHash,
      grants: JSON.stringify({ ref: `${h.real('clients')}_claimed`, column: 'id', value: 1 }),
      expiresAt: Date.now() + 30 * 60_000,
      level,
      kind: 'link',
    });
    return minted.token;
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    keyId = (h.reply['publicAccess'] as { keyId: string }).keyId;
    const manifests = manifestsRepo(h.meta, CRYPTO);
    // The app names two add-ons; one is attached to it, one to another app only.
    const app = (await manifests.findByKey('studio'))!;
    const document = { ...(readJson<Record<string, unknown>>(app.row.manifest) ?? {}), addOns: { requires: [{ key: 'invoices', range: '*', reason: { key: 'r', fallback: 'r' } }], suggests: [{ key: 'calendars', range: '*', reason: { key: 'r', fallback: 'r' } }] } };
    await h.meta.db.updateTable('adminium_manifests').set({ manifest: JSON.stringify(document) as never }).where('id', '=', app.row.id).execute();
    await manifests.install({ manifestKey: 'invoices', version: '1.1.0', kind: 'add-on', source: 'file', document: addOn('invoices'), attachTo: ['studio'] });
    await manifests.install({ manifestKey: 'calendars', version: '1.0.0', kind: 'add-on', source: 'file', document: addOn('calendars'), attachTo: ['clinic'] });
    await manifests.install({ manifestKey: 'loyalty', version: '1.0.0', kind: 'add-on', source: 'file', document: addOn('loyalty'), attachTo: ['studio'] });
    await addOnSettingsRepo(h.meta).patch('invoices', { business_name: 'Northwind Studio', payment_instructions: 'IBAN GB00 0000 0000 0000' }, addOn('invoices')['settings'] as never);
    served = await servePublic(h, keyId);
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('shows a verified client the settings marked for a browser, and nothing else', async () => {
    const res = await read('invoices', await session('verified'));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: { settings: { payment_instructions: 'IBAN GB00 0000 0000 0000', business_name: 'Northwind Studio' } } });
  });

  it.skipIf(!available)('shows nothing before sign-in, and asks a lookup session to verify first', async () => {
    const anonymous = await read('invoices');
    expect(anonymous.statusCode).toBe(404);
    expect(served.codeOf(anonymous)).toBe('PUBLIC_REF_NOT_FOUND');
    const lookup = await read('invoices', await session('lookup'));
    expect(lookup.statusCode).toBe(403);
    expect(served.codeOf(lookup)).toBe('PUBLIC_CLAIM_LEVEL');
  });

  it.skipIf(!available)('answers one 404 for an add-on this app does not name, has not attached, or that does not exist', async () => {
    const verified = await session('verified');
    const unknown = await read('nothing-here', verified);
    expect(unknown.statusCode).toBe(404);
    // Named by the app, attached only to another app.
    expect((await read('calendars', verified)).body).toBe(unknown.body);
    // Attached to this app, never named by it.
    expect((await read('loyalty', verified)).body).toBe(unknown.body);
  });
});
