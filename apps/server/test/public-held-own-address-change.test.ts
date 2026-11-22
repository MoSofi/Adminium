// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON WHO CHANGES THEIR OWN ADDRESS, confirmed by a code at the new one,
 * keeps what they hold: a pack held by their key goes with them, so the next
 * owner of the old mailbox cannot prove that address and spend it.
 */
import { rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { installedCustomerKey } from '../src/public-api/customer-key.js';
import { addOnHarness, addOnManifest, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { guest, mailOf, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const WALLET = 'wallet';
const OLD = 'nell.old@fieldmail.io';
const NEW = 'nell.new@fieldmail.io';
const pk = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number, more: Doc = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });

const wallet = (): Doc =>
  addOnManifest(WALLET, {
    compatibility: { minAdminiumVersion: '0.3.71', requires: [] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'passes',
          holders: { live: { status: 'status', open: ['issued'], left: 'uses_left', until: 'expires_on' }, people: [{ email: 'holder_email', name: 'holder_name', key: 'holder_key', forgotten: 'holder_forgotten' }] },
          columns: [
            pk,
            { ref: 'status', type: 'enum', enum: ['issued', 'used', 'expired', 'voided'], default: 'issued' },
            { ref: 'uses_left', type: 'int', nullable: true },
            { ref: 'expires_on', type: 'date', nullable: true },
            text('holder_email', 254),
            text('holder_key', 64, { rules: { customerKey: { of: 'holder_email' } } }),
            text('holder_name', 80),
            { ref: 'holder_forgotten', type: 'bool', default: false },
          ],
        },
      ],
    },
  });

describe.each(LEGS)('a pack and its holder’s own new address — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let g: ReturnType<typeof guest>;

  const tick = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));
  const lastCode = async () => /\b(\d{6})\b/.exec((await mailOf(h.meta)).filter((m) => m.template === 'sign-in-code').at(-1)!.subject)![1]!;

  beforeAll(async () => {
    if (!available) return;
    vi.useFakeTimers({ toFake: ['Date'] });
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = WALLET;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const shop = shopManifest({
      entries: (entries) => entries.filter((entry) => entry['table'] === 'customers' && entry['claim'] !== undefined).map((entry) => ({ ...entry, claim: { match: ['email'], verify: 'email-code', email: 'email' } })),
    });
    (shop['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.71';
    (shop['outbox'] as Doc)['classes'] = { 'order-placed': 'service' };
    shop['frontends'] = [{ side: 'staff', kind: 'none' }];
    // Only the sign-in entry is served here: the fixture's key for shared links has no entry left to open.
    delete shop['publicKeys'];
    await h.stageApp(shop);
    const installed = await h.install('shop', String(shop['version']));
    expect(installed.statusCode, installed.body).toBe(200);
    const keyId = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    await h.stageAddOn(wallet());
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: WALLET, version: '1.0.0', attachTo: ['shop'] } });
    expect(added.statusCode, added.body).toBe(200);
    await mailReady(h.meta);
    served = await servePublic(h as never, keyId, { ADMINIUM_DATA_DIR: h.dataDir });
    g = guest(served, h as never);
    expect(await rolesRepo(h.meta).findBySlug('super-admin')).not.toBeNull();
    await h.rows(`insert into shop_customers (id, email, name) values (1, '${OLD}', 'Nell Vale')`);
    const until = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    await h.rows(`insert into wallet_passes (id, status, uses_left, expires_on, holder_email, holder_key, holder_name) values (1, 'issued', 4, '${until}', '${OLD}', '${installedCustomerKey(h.connectionId, OLD)}', 'Nell Vale')`);
  }, 300_000);

  afterAll(async () => {
    vi.useRealTimers();
    if (!available) return;
    delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('goes with them, and the old address holds nothing', async () => {
    const claimed = await g.request('POST', '/claim', { payload: { match: { email: OLD } }, proof: 'claim' });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const session = (claimed.json() as { data: { session: string } }).data.session;
    tick(31_000);
    const code = await g.request('POST', '/claim/code', { session, payload: { purpose: 'verify' } });
    expect(code.statusCode, code.body).toBe(200);
    const verified = await g.request('POST', '/claim/verify', { session, payload: { code: await lastCode() } });
    expect(verified.statusCode, verified.body).toBe(200);
    tick(31_000);
    const asked = await g.request('POST', '/claim/code', { session, payload: { purpose: 'email-change', email: NEW } });
    expect(asked.statusCode, asked.body).toBe(200);
    const changed = await g.request('POST', '/claim/verify', { session, payload: { purpose: 'email-change', code: await lastCode() } });
    expect(changed.statusCode, changed.body).toBe(200);
    const [row] = await h.rows('select holder_email, holder_key, uses_left from wallet_passes where id = 1');
    expect([row!['holder_email'], row!['holder_key'], Number(row!['uses_left'])]).toEqual([NEW, installedCustomerKey(h.connectionId, NEW), 4]);
  });
});
