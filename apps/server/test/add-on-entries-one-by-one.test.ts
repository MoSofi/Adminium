// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON ENTRY AN APP'S KEY CANNOT REACH IS LEFT OUT ON ITS OWN.
 *
 * The cards kit here has two entries on its app's key: a card's balance read
 * by its code (anyone may type one), and the cards a signed-in person holds,
 * read at level `verified`. A shop whose sign-in sends no code can never
 * raise a session to `verified`, so its key cannot take the second entry —
 * and it must still take the first. Said in the reply and in the audit, with
 * why. A shop whose sign-in does send a code takes both. On the install of an
 * app the add-on is here for, and on attaching the add-on to an app already
 * installed. On every engine this run can reach.
 */
import { auditRepo, publicEndpointsRepo, publicKeysRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { grantEachEntry } from '../src/apps/manifest-public.js';
import { KeyCreateRefused } from '../src/public-api/endpoint-service.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { BALANCE_REF, CARDS_KIT, cardsKitManifest, shopManifest } from './fixtures/cards-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

/** The cards the signed-in person holds, by the address their session proved. */
const HELD_REF = 'cards_kit_cards_verified';
const SIGN_IN_REF = 'shop_members_claimed';

/** The cards kit with one more entry on the app's key: the cards a person holds, read at `verified`. */
function kitWithHeldCards(): Record<string, unknown> {
  const kit = cardsKitManifest();
  const schema = structuredClone(kit['requiredSchema']) as { tables: { ref: string; columns: unknown[] }[] };
  schema.tables[0]!.columns.push({ ref: 'recipient_email', type: 'text', maxLength: 200, nullable: true, rules: { normalize: 'email' } });
  return {
    ...kit,
    compatibility: { minAdminiumVersion: '0.3.71' },
    requiredSchema: schema,
    publicAccess: [
      ...(kit['publicAccess'] as unknown[]),
      { table: 'cards', methods: ['GET'], level: 'verified', heldBy: { address: 'recipient_email' }, select: ['id', 'balance'] },
    ],
  };
}

/** The shop with a sign-in of its own: by a member's code and mobile, and with `verifies`, a code emailed to them too. */
function shopWithSignIn(verifies: boolean, over: Record<string, unknown> = {}): Record<string, unknown> {
  const shop = shopManifest(over);
  const schema = structuredClone(shop['requiredSchema']) as { tables: unknown[] };
  schema.tables.push({
    ref: 'members',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'code', type: 'text', maxLength: 16, nullable: true },
      { ref: 'mobile', type: 'text', maxLength: 32, nullable: true },
      { ref: 'email', type: 'text', maxLength: 200, nullable: true, rules: { normalize: 'email' } },
    ],
  });
  const claim = verifies ? { match: ['code', 'mobile'], verify: 'email-code', email: 'email' } : { match: ['code', 'mobile'] };
  return {
    ...shop,
    requiredSchema: schema,
    addOns: { suggests: [{ key: CARDS_KIT, range: '*', reason: { 'en-US': 'Sell and take gift cards.' } }] },
    publicAccess: [...(shop['publicAccess'] as unknown[]), { table: 'members', methods: ['GET'], select: ['id', 'code'], claim }],
  };
}

describe('each entry on its own, whatever the refusal names', () => {
  type Grant = { ref: string; methods: readonly string[] };
  /** A key that refuses a POST on `b` by name, and `c` beside `a` without naming either. */
  const service = (writes: Grant[][]) => ({
    setManagedAccess: async (input: { access: readonly Grant[] }) => {
      const refs = input.access.map((grant) => grant.ref);
      if (input.access.some((grant) => grant.ref === 'b' && grant.methods.includes('POST'))) throw new KeyCreateRefused([{ code: 'B', message: 'b cannot go', ref: 'b' }, { code: 'B2', message: 'nor here', ref: 'b' }]);
      if (refs.includes('a') && refs.includes('c')) throw new KeyCreateRefused([{ code: 'AC', message: 'a and c cannot go together' }]);
      writes.push(input.access.map((grant) => ({ ...grant })));
      return { gained: refs.filter((ref) => ref !== 'own'), lost: [] };
    },
  });

  it('leaves out only what cannot go, keeps what the key held of it, and writes the rest', async () => {
    const writes: Grant[][] = [];
    const told: string[][] = [];
    const result = await grantEachEntry({
      service: service(writes) as never,
      connectionId: 'c1',
      keyId: 'k1',
      base: [{ ref: 'own', methods: ['GET'] }],
      adding: [
        { ref: 'a', methods: ['GET'], held: [] },
        { ref: 'b', methods: ['GET', 'POST'], held: ['GET'] },
        { ref: 'c', methods: ['GET'], held: [] },
      ],
      onWritten: async ({ gained }) => {
        told.push(gained);
      },
    });
    expect(result.refused).toEqual([
      { ref: 'b', reason: 'b cannot go; nor here' },
      { ref: 'c', reason: 'a and c cannot go together' },
    ]);
    // `a` was written on its own; `b` kept the GET it held; `c` was never given.
    expect(writes).toEqual([[{ ref: 'own', methods: ['GET'] }, { ref: 'a', methods: ['GET'] }, { ref: 'b', methods: ['GET'] }]]);
    expect(told).toEqual([['a', 'b']]);
  });

  it('asks once when nothing is refused', async () => {
    const writes: Grant[][] = [];
    const result = await grantEachEntry({ service: service(writes) as never, connectionId: 'c1', keyId: 'k1', base: [], adding: [{ ref: 'a', methods: ['GET'], held: [] }] });
    expect(result).toEqual({ gained: ['a'], lost: [], refused: [] });
    expect(writes).toHaveLength(1);
  });
});

describe.each(LEGS)('an add-on entry the key cannot reach is left out alone — %s', (dialect, available) => {
  let h: Harness;
  afterEach(async () => {
    if (available) await h.close();
  });

  /** The refs a key holds, sorted. */
  const held = async (keyId: string): Promise<string[]> => {
    const key = (await publicKeysRepo(h.meta).findById(keyId))!;
    const refs = new Map((await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).map((endpoint) => [endpoint.id, endpoint.ref]));
    const access = (typeof key.access === 'string' ? JSON.parse(key.access) : key.access) as Record<string, string[]>;
    return Object.keys(access).map((id) => refs.get(id) ?? id).sort();
  };
  /** What the audit says was left off the key, by ref. */
  const leftOutAudited = async (): Promise<{ ref: string; reason: string }[]> =>
    (await auditRepo(h.meta).list({ limit: 200 }))
      .filter((row) => row.action === 'public-key.left-out')
      .flatMap((row) => {
        const changes = (typeof row.changes === 'string' ? JSON.parse(row.changes) : row.changes) as { after: { skipped: { ref: string; reason: string }[] } };
        return changes.after.skipped;
      });
  const unreachable = expect.stringContaining('needs a verified session');

  /** The shop installed with the kit brought along and public access allowed: the key is made with the kit here. */
  const installWithKit = async (verifies: boolean) => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(kitWithHeldCards());
    await h.stageApp(shopWithSignIn(verifies));
    const installed = await h.install('shop', '1.0.0', { addOns: [{ key: CARDS_KIT, version: '1.0.0' }], publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    return installed;
  };
  /** The shop installed alone, then the kit attached to it with public access allowed: the live key is given the kit's entries. */
  const attachKit = async (verifies: boolean) => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shopWithSignIn(verifies));
    const installed = await h.install('shop', '1.0.0', { publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    await h.stageAddOn(kitWithHeldCards());
    const attached = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: ['shop'], publicAccess: true } });
    expect(attached.statusCode, attached.body).toBe(200);
    return { keyId: installed.json().publicAccess.keyId as string, attached };
  };

  it.skipIf(!available)('an install with the kit here: the code lookup is on the key, the verified read is left out and said', async () => {
    const installed = await installWithKit(false);
    const keyId = installed.json().publicAccess.keyId as string;
    expect(await held(keyId)).toEqual([BALANCE_REF, SIGN_IN_REF, 'shop_products'].sort());
    expect(installed.json().publicAccess.skipped).toEqual([{ ref: HELD_REF, reason: unreachable }]);
    expect(await leftOutAudited()).toEqual([{ ref: HELD_REF, reason: unreachable }]);
  });

  it.skipIf(!available)('the kit attached to a shop already installed: the code lookup is on the live key, the verified read is left out and said', async () => {
    const { keyId, attached } = await attachKit(false);
    expect(await held(keyId)).toEqual([BALANCE_REF, SIGN_IN_REF, 'shop_products'].sort());
    expect(attached.json().publicAccessByApp.shop).toEqual({ granted: [BALANCE_REF], withdrawn: [], skipped: [{ ref: HELD_REF, reason: unreachable }] });
    expect(await leftOutAudited()).toEqual([{ ref: HELD_REF, reason: unreachable }]);
  });

  it.skipIf(!available)('an update of the shop gives its live key the kit\'s code lookup, and leaves the verified read out alone', async () => {
    // Attached with no say: the key holds nothing of the kit's.
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shopWithSignIn(false));
    const installed = await h.install('shop', '1.0.0', { publicAccess: true });
    const keyId = installed.json().publicAccess.keyId as string;
    await h.stageAddOn(kitWithHeldCards());
    expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: CARDS_KIT, version: '1.0.0', attachTo: ['shop'] } })).statusCode).toBe(200);
    expect(await held(keyId)).toEqual([SIGN_IN_REF, 'shop_products'].sort());
    // The shop's next version, allowed: its key gains what the kit serves through it, as far as it can.
    await h.stageApp(shopWithSignIn(false, { version: '1.0.1' }));
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { to: '1.0.1', publicAccess: true } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(await held(keyId)).toEqual([BALANCE_REF, SIGN_IN_REF, 'shop_products'].sort());
    expect(updated.json().app.publicAccess.skipped).toEqual([{ ref: HELD_REF, reason: unreachable }]);
  });

  it.skipIf(!available)('a shop whose sign-in sends a code takes both, on install and on attach', async () => {
    const installed = await installWithKit(true);
    expect(await held(installed.json().publicAccess.keyId as string)).toEqual([BALANCE_REF, HELD_REF, SIGN_IN_REF, 'shop_products'].sort());
    expect(installed.json().publicAccess.skipped).toEqual([]);
    await h.close();
    const { keyId, attached } = await attachKit(true);
    expect(await held(keyId)).toEqual([BALANCE_REF, HELD_REF, SIGN_IN_REF, 'shop_products'].sort());
    expect(attached.json().publicAccessByApp.shop).toEqual({ granted: [BALANCE_REF, HELD_REF].sort(), withdrawn: [], skipped: [] });
    expect(await leftOutAudited()).toEqual([]);
  });
});
