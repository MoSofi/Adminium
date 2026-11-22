// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The carrier resolver and the locks, on their own: the order of the checks,
 * that a locked carrier's key is never read, which install is used on which
 * database, and that the locks are constants nothing can reach.
 */
import { readFileSync } from 'node:fs';

import { CarrierError, SHIPPING_CARRIER_CONTRACT, SHIPPING_CARRIER_VERSION, type ShippingCarrierContext } from '@adminium/add-on-contracts';
import { addOnManifestSchema } from '@adminium/manifest';
import { SERVER_SCOPE, auditRepo, createSqliteMetaDb, firstRun, type InstalledManifest } from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { CARRIER_HTTP_TIMEOUT_MS, askForRates, carrierHttpFor, cleanCarrierMessage, shippingCarrierFor, type ResolvedCarrier, type ShippingCarrierDeps } from '../src/shipping/carriers.js';
import { BACKGROUND_CARRIER_CALLS_ENABLED, DHL_CARRIER_KEY, DHL_REAL_MODE_ENABLED, INTERNATIONAL_ENABLED, carrierLocked } from '../src/shipping/locks.js';
import { ShippingRefusal } from '../src/shipping/refusals.js';
import { chooseActive, type AttachedCarrier } from '../src/shipping/shop.js';
import { addOnManifest } from './app-add-ons.helpers.js';

const CONN_A = 'conn_a';
const CONN_B = 'conn_b';
const carrierDoc = (key: string) =>
  addOnManifest(key, { categories: ['delivery'], capabilities: ['outbound-http'], addOn: { provides: [{ contract: 'shipping-carrier', version: 1, server: 'dist/server.js' }], network: { allow: ['api.carrier.example'] } } });

function install(key: string, scopeKey: string, over: Partial<InstalledManifest['row']> = {}, document: unknown = carrierDoc(key)): InstalledManifest {
  return { row: { id: `mft_${key}_${scopeKey}`, manifestKey: key, kind: 'add-on', status: 'installed', scopeKey, connectionId: scopeKey === SERVER_SCOPE ? null : scopeKey, ...over }, document, attachments: [] } as unknown as InstalledManifest;
}

const madeCarrier = { key: 'x', quote: vi.fn(async () => []), book: vi.fn(), track: vi.fn(), label: vi.fn(), cancel: vi.fn() };

function deps(installs: InstalledManifest[], modules: Record<string, unknown> = {}, credentials: Record<string, Record<string, unknown> | Error> = {}) {
  const getCredential = vi.fn(async (id: string) => {
    const held = credentials[id];
    if (held instanceof Error) throw held;
    return held === undefined ? null : { kind: 'api-key' as const, secret: held };
  });
  const seam: ShippingCarrierDeps = {
    runtime: () =>
      ({
        providers: new Map([[`${SHIPPING_CARRIER_CONTRACT}@${String(SHIPPING_CARRIER_VERSION)}`, Object.entries(modules).map(([addOnKey, module]) => ({ addOnKey, contract: SHIPPING_CARRIER_CONTRACT, version: SHIPPING_CARRIER_VERSION, module }))]]),
      }) as unknown as AddOnRuntimeState,
    manifests: {
      findInScope: vi.fn(async (key: string, scope: string) => installs.find((one) => one.row.manifestKey === key && one.row.scopeKey === scope) ?? null),
      getCredential,
    } as unknown as ShippingCarrierDeps['manifests'],
    httpFor: () => vi.fn() as never,
  };
  return { seam, getCredential };
}

const factory = (seen?: ShippingCarrierContext[]) => ({
  createShippingCarrier: (context: ShippingCarrierContext) => {
    seen?.push(context);
    return madeCarrier;
  },
});

async function refusal(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ShippingRefusal) return error.code;
    throw error;
  }
  return 'no refusal';
}

describe('the locks', () => {
  it('are literal false, and nothing is read into them', () => {
    expect(DHL_REAL_MODE_ENABLED).toBe(false);
    expect(BACKGROUND_CARRIER_CALLS_ENABLED).toBe(false);
    expect(INTERNATIONAL_ENABLED).toBe(false);
    const source = readFileSync(new URL('../src/shipping/locks.ts', import.meta.url), 'utf8');
    for (const name of ['DHL_REAL_MODE_ENABLED', 'BACKGROUND_CARRIER_CALLS_ENABLED', 'INTERNATIONAL_ENABLED']) expect(source).toContain(`export const ${name} = false;`);
    expect(source).not.toMatch(/process\.env|import\s|require\(/);
  });

  it('lock DHL and nothing else', () => {
    expect(DHL_CARRIER_KEY).toBe('shipping-dhl');
    expect(carrierLocked('shipping-dhl')).toBe(true);
    expect(carrierLocked('shipping-shippo')).toBe(false);
  });
});

describe('which carrier a shop uses', () => {
  const carrier = (key: string, on = true): AttachedCarrier => ({ key, name: key, locked: false, on, connected: true });

  it('keeps the choice while it is attached, even switched off, so a quote can say so', () => {
    expect(chooseActive('one', [carrier('one'), carrier('two')])).toBe('one');
    expect(chooseActive('one', [carrier('one', false), carrier('two')])).toBe('one');
  });

  it('never moves a shop to another carrier when its choice is taken away', () => {
    expect(chooseActive('gone', [carrier('other')])).toBeNull();
    expect(chooseActive('gone', [carrier('one'), carrier('two')])).toBeNull();
    expect(chooseActive('gone', [])).toBeNull();
  });

  it('uses the only carrier when nothing was chosen, and asks when there are two', () => {
    expect(chooseActive(null, [carrier('solo')])).toBe('solo');
    expect(chooseActive(null, [carrier('one'), carrier('two')])).toBeNull();
    expect(chooseActive(null, [])).toBeNull();
  });
});

describe('shippingCarrierFor', () => {
  it('never reads a locked carrier\'s credential, even one that is installed and saved', async () => {
    const dhl = install('shipping-dhl', CONN_A);
    const { seam, getCredential } = deps([dhl], { 'shipping-dhl': factory() }, { [dhl.row.id]: { api_key: 'a-saved-value' } });
    expect(await refusal(shippingCarrierFor(seam, 'shipping-dhl', CONN_A, '2026-11-21'))).toBe('CARRIER_LOCKED');
    expect(getCredential).not.toHaveBeenCalled();
    expect(seam.manifests.findInScope).not.toHaveBeenCalled();
  });

  it('checks in order, and reads the key only once everything before it passed', async () => {
    const key = 'carrier-one';
    const none = deps([]);
    expect(await refusal(shippingCarrierFor(none.seam, key, CONN_A, '2026-11-21'))).toBe('CARRIER_NOT_INSTALLED');

    const off = deps([install(key, CONN_A, { status: 'disabled' })], { [key]: factory() });
    expect(await refusal(shippingCarrierFor(off.seam, key, CONN_A, '2026-11-21'))).toBe('CARRIER_SWITCHED_OFF');

    const broken = deps([install(key, CONN_A, {}, { not: 'a manifest' })], { [key]: factory() });
    expect(await refusal(shippingCarrierFor(broken.seam, key, CONN_A, '2026-11-21'))).toBe('CARRIER_NOT_LOADED');

    const unloaded = deps([install(key, CONN_A)]);
    expect(await refusal(shippingCarrierFor(unloaded.seam, key, CONN_A, '2026-11-21'))).toBe('CARRIER_NOT_LOADED');

    const noFactory = deps([install(key, CONN_A)], { [key]: { other: true } });
    expect(await refusal(shippingCarrierFor(noFactory.seam, key, CONN_A, '2026-11-21'))).toBe('CARRIER_NO_FACTORY');

    for (const failed of [off, broken, unloaded, noFactory]) expect(failed.getCredential).not.toHaveBeenCalled();

    const noKey = deps([install(key, CONN_A)], { [key]: factory() });
    expect(await refusal(shippingCarrierFor(noKey.seam, key, CONN_A, '2026-11-21'))).toBe('CARRIER_NO_CREDENTIAL');
    expect(noKey.getCredential).toHaveBeenCalledTimes(1);
  });

  it('treats a key that cannot be read as no key, and a factory that throws as none', async () => {
    const key = 'carrier-one';
    const one = install(key, CONN_A);
    const unreadable = deps([one], { [key]: factory() }, { [one.row.id]: new Error('bad decrypt') });
    expect(await refusal(shippingCarrierFor(unreadable.seam, key, CONN_A, '2026-11-21'))).toBe('CARRIER_NO_CREDENTIAL');
    const wrong = deps([one], { [key]: factory() }, { [one.row.id]: { api_key: 42 } });
    expect(await refusal(shippingCarrierFor(wrong.seam, key, CONN_A, '2026-11-21'))).toBe('CARRIER_NO_CREDENTIAL');

    const throwing = deps([one], { [key]: { createShippingCarrier: () => { throw new Error('boom'); } } }, { [one.row.id]: { api_key: 'value-one' } });
    expect(await refusal(shippingCarrierFor(throwing.seam, key, CONN_A, '2026-11-21'))).toBe('CARRIER_NO_FACTORY');
    const hollow = deps([one], { [key]: { createShippingCarrier: () => ({}) } }, { [one.row.id]: { api_key: 'value-one' } });
    expect(await refusal(shippingCarrierFor(hollow.seam, key, CONN_A, '2026-11-21'))).toBe('CARRIER_NO_FACTORY');
  });

  it('uses the install on the order\'s database, else the server\'s, and never another database\'s', async () => {
    const key = 'carrier-one';
    const onA = install(key, CONN_A);
    const onB = install(key, CONN_B);
    const server = install(key, SERVER_SCOPE);
    const seen: ShippingCarrierContext[] = [];
    const both = deps([onA, onB, server], { [key]: factory(seen) }, { [onA.row.id]: { api_key: 'value-a' }, [onB.row.id]: { api_key: 'value-b' }, [server.row.id]: { api_key: 'value-s' } });
    expect((await shippingCarrierFor(both.seam, key, CONN_B, '2026-11-21')).install.row.id).toBe(onB.row.id);
    expect(seen.at(-1)?.credentials).toEqual({ api_key: 'value-b' });
    expect(seen.at(-1)?.todayIso).toBe('2026-11-21');
    expect((await shippingCarrierFor(both.seam, key, 'conn_c', '2026-11-21')).install.row.id).toBe(server.row.id);

    // Installed only on the other database, with no server-wide one: not "the only install".
    const elsewhere = deps([onB], { [key]: factory() }, { [onB.row.id]: { api_key: 'value-b' } });
    expect(await refusal(shippingCarrierFor(elsewhere.seam, key, CONN_A, '2026-11-21'))).toBe('CARRIER_NOT_INSTALLED');
    expect(elsewhere.getCredential).not.toHaveBeenCalled();
  });

  it('builds a new carrier each time, so a replaced key is used on the next call', async () => {
    const key = 'carrier-one';
    const one = install(key, CONN_A);
    const seen: ShippingCarrierContext[] = [];
    const held: Record<string, Record<string, unknown>> = { [one.row.id]: { api_key: 'value-old' } };
    const { seam } = deps([one], { [key]: factory(seen) }, held);
    await shippingCarrierFor(seam, key, CONN_A, '2026-11-21');
    held[one.row.id] = { api_key: 'value-new' };
    await shippingCarrierFor(seam, key, CONN_A, '2026-11-21');
    expect(seen.map((context) => context.credentials['api_key'])).toEqual(['value-old', 'value-new']);
  });
});

describe('what a carrier says', () => {
  const resolved = (quote: () => Promise<unknown>): ResolvedCarrier => ({ key: 'carrier-one', install: install('carrier-one', CONN_A), carrier: { ...madeCarrier, quote } as never, scrub: (text) => text.split('value-one').join('[hidden]') });
  const parcel = { weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1, contents: 'x' };
  const address = { name: 'n', lines: ['l'], city: 'c', postcode: 'p', country: 'GB' };
  const failure = async (quote: () => Promise<unknown>) => {
    try {
      await askForRates(resolved(quote), parcel, address, address, {});
    } catch (error) {
      return error as ShippingRefusal;
    }
    throw new Error('it did not refuse');
  };

  it('logs a carrier code cleaned of the saved key and of invisible characters', async () => {
    const log = vi.fn();
    const quote = () => Promise.reject(new CarrierError({ code: 'BAD value-one\u202E', carrierMessage: 'No' }));
    await expect(askForRates(resolved(quote), parcel, address, address, {}, log)).rejects.toBeInstanceOf(ShippingRefusal);
    expect(log).toHaveBeenCalledWith('a carrier refused a quote', { key: 'carrier-one', code: 'BAD [hidden]' });
  });

  it('reads a real CarrierError and a look-alike from another bundle the same way', async () => {
    const real = await failure(() => Promise.reject(new CarrierError({ code: 'BAD', carrierMessage: 'No such postcode', outcome: 'refused', reason: 'address' })));
    const lookalike = await failure(() => Promise.reject({ name: 'CarrierError', code: 'BAD', carrierMessage: 'No such postcode', reason: 'address' }));
    expect(real.code).toBe('CARRIER_REFUSED');
    expect(lookalike.details).toEqual(real.details);
    expect(real.details).toMatchObject({ carrierCode: 'BAD', reason: 'address', carrierMessage: 'No such postcode' });
  });

  it('marks no answer safe to retry', async () => {
    const said = await failure(() => Promise.reject(new CarrierError({ code: 'BAD', carrierMessage: 'Try again', retryable: true })));
    expect(JSON.stringify(said.details)).not.toContain('retry');
  });

  it('drops a reason outside the contract, and gives nothing of an unrecognised error', async () => {
    const odd = await failure(() => Promise.reject({ name: 'CarrierError', code: 'BAD', carrierMessage: 'No', reason: 'because' }));
    expect(odd.details).toMatchObject({ reason: null });
    for (const thrown of [new Error('raw words'), 'raw words', null, { name: 'CarrierError', code: 1, carrierMessage: 'raw words' }]) {
      const said = await failure(() => Promise.reject(thrown));
      expect(said.code).toBe('CARRIER_UNAVAILABLE');
      expect(JSON.stringify([said.message, said.details])).not.toContain('raw words');
    }
  });

  it('cleans a message of control and invisible characters, the saved key, and any length', () => {
    expect(cleanCarrierMessage('a\u0000b\u001bc\u007fd‮e​f')).toBe('a b c d e f');
    expect(cleanCarrierMessage('  many \n\t spaces  ')).toBe('many spaces');
    expect(cleanCarrierMessage('key value-one here', (text) => text.split('value-one').join('[hidden]'))).toBe('key [hidden] here');
    expect(cleanCarrierMessage('x'.repeat(500))).toHaveLength(300);
  });
});

describe('the client a carrier is handed', () => {
  it('reaches only the hosts its manifest allows, within 15 seconds', async () => {
    expect(CARRIER_HTTP_TIMEOUT_MS).toBe(15_000);
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    try {
      await firstRun(meta);
      const manifest = addOnManifestSchema.parse(carrierDoc('carrier-one'));
      const http = carrierHttpFor(meta, manifest, undefined);
      await expect(http('https://elsewhere.example/rates', { method: 'POST', body: '{}' })).rejects.toMatchObject({ name: 'AddOnEgressError', addOnKey: 'carrier-one' });
      const audit = await auditRepo(meta).list({ category: 'add-on' });
      expect(audit.map((row) => row.action)).toContain('add-on.egress-refused');
    } finally {
      await meta.db.destroy();
    }
  });
});
