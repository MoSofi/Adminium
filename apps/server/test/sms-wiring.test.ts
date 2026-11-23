// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMS parts as the server puts them together, on every engine: the real
 * account table, what an install with no provider does (nothing), the sweep,
 * the catch-up at start, and where the sealed columns are declared. Provider
 * replies are stubs; no real provider is called.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { jobsRepo, settingsRepo, type MetaTableDump } from '@adminium/meta';

import { collectKnownSecrets } from '../src/apps/save/gates/secrets.js';
import { sanitizeDump } from '../src/archive/policy.js';
import { addressKeyRing } from '../src/consent/keys.js';
import { createInboundEventStore, createInboundWiring, INBOUND_PARSE_JOB, INBOUND_SWEEP_JOB } from '../src/inbound/index.js';
import { scrubSecretFields } from '../src/log-redaction.js';
import { customerHostAllows, pagesHostAllows } from '../src/plugins/surfaces.js';
import { createSmsAccountStore } from '../src/sms/account-store.js';
import { textSubject } from '../src/sms/consent/index.js';
import { sealCredentials, SmsSecret, smsSecretKey } from '../src/sms/credentials.js';
import type { SmsAccountFields } from '../src/sms/store.js';
import { createSmsWiring, type SmsWiringDeps } from '../src/sms/wiring.js';
import { trialPolicy } from '../src/trial/policy.js';
import { makeEnv } from './helpers.js';
import { describeSmsStoreContract } from './helpers/sms-store.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const SECRET = 'an-sms-wiring-test-secret-of-length';
const SID = `AC${'ab'.repeat(16)}`;
const TOKEN = 'made-up-token-for-these-tests';
const NUMBER = '+4915123456789';
const SENDER = '+14155552671';

const json = (status: number, value: unknown): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function accountFields(over: Partial<SmsAccountFields> = {}): SmsAccountFields {
  return {
    provider: 'twilio',
    sealedCredentials: sealCredentials({ provider: 'twilio', accountSid: SID, authToken: new SmsSecret(TOKEN) }, smsSecretKey(SECRET)),
    accountName: 'Lu•••ic',
    accountHint: '…abab',
    accountType: 'full',
    sender: { kind: 'number', value: SENDER },
    defaultCountry: null,
    check: { ok: true, reason: null, at: 1 },
    savedAt: 1,
    savedBy: null,
    ...over,
  };
}

for (const engine of META_ENGINES) {
  if (!engine.available) continue;
  describe(`the real account store — ${engine.name}`, () => {
    let contract: MetaHandle;
    // Made once, before the tests: migrating a MySQL store takes longer than one test may.
    beforeAll(async () => {
      contract = await engine.make();
    }, 120_000);
    afterAll(async () => {
      await contract.destroy();
    });
    describeSmsStoreContract(engine.name, async () => {
      await contract.meta.db.deleteFrom('adminium_sms_accounts').execute();
      return createSmsAccountStore(contract.meta);
    });
  });
}

describe.each(META_ENGINES)('the SMS parts together — $name', (engine) => {
  let handle: MetaHandle;
  let calls: string[];
  let networkFeatures: boolean;
  let operatorAllowed: boolean;

  const stubFetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return json(200, { messages: [], next_page_uri: null, data: [] });
  }) as typeof fetch;

  const wire = (over: Partial<SmsWiringDeps> = {}) => {
    const inbound = createInboundWiring({ meta: handle.meta, secret: SECRET });
    const sms = createSmsWiring({
      meta: handle.meta,
      secret: SECRET,
      inbound,
      networkFeatures,
      desktop: false,
      trustProxy: true,
      operator: () => (operatorAllowed ? { allowed: true, reason: null } : { allowed: false, reason: 'trial-mode' }),
      log: { info: () => undefined },
      fetch: stubFetch,
      ...over,
    });
    return Object.assign(sms, { enqueueSweep: inbound.enqueueSweep });
  };

  beforeAll(async () => {
    if (engine.available) handle = await engine.make();
  }, 120_000);
  afterAll(async () => {
    if (engine.available) await handle.destroy();
  });
  beforeEach(async () => {
    if (!engine.available) return;
    calls = [];
    networkFeatures = true;
    operatorAllowed = true;
    const { db } = handle.meta;
    await db.deleteFrom('adminium_sms_accounts').execute();
    await db.deleteFrom('adminium_inbound_events').execute();
    await db.deleteFrom('adminium_text_stop_list').execute();
    await db.deleteFrom('adminium_jobs').execute();
    await settingsRepo(handle.meta).set('phone.defaultCountry', null, { updatedBy: null });
  });

  it.runIf(engine.available)('keeps every field at its full width', async () => {
    const store = createSmsAccountStore(handle.meta);
    const fields = accountFields({ accountName: 'n'.repeat(32), accountHint: 'h'.repeat(16), sender: { kind: 'name', value: 'v'.repeat(64) }, defaultCountry: 'DE', check: { ok: false, reason: 'credentials-refused', at: 2 } });
    expect(await store.write(fields, null)).toMatchObject({ ...fields, revision: 1 });
    expect(await store.read()).toMatchObject(fields);
  });

  it.runIf(engine.available)('refuses a provider this version cannot read, and reads a bad sender kind as none', async () => {
    const store = createSmsAccountStore(handle.meta);
    await store.write(accountFields(), null);
    await handle.meta.db.updateTable('adminium_sms_accounts').set({ senderKind: 'other' }).execute();
    expect((await store.read())?.sender).toBeNull();
    await handle.meta.db.updateTable('adminium_sms_accounts').set({ provider: 'carrier-pigeon' }).execute();
    await expect(store.read()).rejects.toThrow(/provider/);
  });

  it.runIf(engine.available)('with no provider it calls nobody and queues nothing', async () => {
    const wiring = wire();
    expect(await wiring.enqueueSweep()).toBeNull();
    expect((await wiring.catchUpAtBoot())?.outcome).toBe('not-connected');
    expect(await wiring.channel.replyReach()).toMatchObject({ canReceiveStop: false, address: null });
    expect(calls).toEqual([]);
    expect(await handle.meta.db.selectFrom('adminium_jobs').select('id').execute()).toEqual([]);
  });

  it.runIf(engine.available)('skips the catch-up at start when network features are off', async () => {
    await createSmsAccountStore(handle.meta).write(accountFields(), null);
    networkFeatures = false;
    expect(await wire().catchUpAtBoot()).toBeNull();
    expect(calls).toEqual([]);
  });

  it.runIf(engine.available)('skips the catch-up at start when the operator has SMS off', async () => {
    await createSmsAccountStore(handle.meta).write(accountFields(), null);
    operatorAllowed = false;
    expect(await wire().catchUpAtBoot()).toBeNull();
    expect(calls).toEqual([]);
  });

  it.runIf(engine.available)('asks the provider at start when it may', async () => {
    await createSmsAccountStore(handle.meta).write(accountFields(), null);
    expect((await wire().catchUpAtBoot())?.outcome).toBe('done');
    expect(calls.length).toBeGreaterThan(0);
  });

  it.runIf(engine.available)('the sweep queues a stored event whose job was never queued', async () => {
    const wiring = wire();
    const { event } = await createInboundEventStore(handle.meta).put({ channel: 'sms', account: 'acct', providerId: 'a'.repeat(64), source: 'twilio', kind: 'reply', subject: null, sealedBody: 'enc:v1:sealed', occurredAt: null, receivedAt: 1 });
    const sweep = await wiring.enqueueSweep();
    expect(sweep).not.toBeNull();
    expect((await jobsRepo(handle.meta).findById(sweep!.id))?.kind).toBe(INBOUND_SWEEP_JOB);
    expect((await wiring.inbound.sweep()).requeued).toBe(1);
    const jobs = await handle.meta.db.selectFrom('adminium_jobs').select(['kind', 'dedupeKey']).where('kind', '=', INBOUND_PARSE_JOB).execute();
    expect(jobs).toEqual([{ kind: INBOUND_PARSE_JOB, dedupeKey: `inbound:${event.id}` }]);
  });

  it.runIf(engine.available)('a test text never reaches a stopped number', async () => {
    const wiring = wire();
    await createSmsAccountStore(handle.meta).write(accountFields(), null);
    await wiring.consent.stop.add({ phone: NUMBER, reason: 'text-stop', origin: 'twilio' });
    expect(await wiring.service.sendTest(NUMBER)).toMatchObject({ outcome: 'refused', reason: 'opted-out' });
    expect(calls).toEqual([]);
  });

  it.runIf(engine.available)('reads a local number in the default country, and the account\'s own choice comes first', async () => {
    const wiring = wire();
    expect(wiring.erasure.exact('0151 23456789', await wiring.defaultCountry())).toBeNull();
    await settingsRepo(handle.meta).set('phone.defaultCountry', 'DE', { updatedBy: null });
    expect(wiring.erasure.exact('0151 23456789', await wiring.defaultCountry())).toBe(NUMBER);
    const store = createSmsAccountStore(handle.meta);
    const row = await store.write(accountFields(), null);
    expect((await wiring.service.view())?.defaultCountry).toBe('DE');
    await store.write(accountFields({ defaultCountry: 'FR' }), row!.revision);
    expect((await wiring.service.view())?.defaultCountry).toBe('FR');
  });

  it.runIf(engine.available)('the save scan knows the key, a stopped number and a stored message', async () => {
    const wiring = wire();
    await createSmsAccountStore(handle.meta).write(accountFields(), null);
    await wiring.consent.stop.add({ phone: NUMBER, reason: 'text-stop', origin: 'twilio' });
    await wiring.inbound.accept({ channel: 'sms', account: 'acct', source: 'twilio', events: [{ providerId: 'scan-1', kind: 'reply', subject: textSubject(NUMBER), body: JSON.stringify({ v: 1, type: 'reply', from: '+4915123456780', to: SENDER, text: 'Please call me about the blue sofa', answered: false, via: 'webhook' }), occurredAt: 1 }] });
    const known = (await collectKnownSecrets(handle.meta, SECRET)).map((one) => one.value);
    expect(known).toEqual(expect.arrayContaining([TOKEN, NUMBER, '+4915123456780', 'Please call me about the blue sofa']));
  });

  it.runIf(engine.available)('an erasure narrowed to some apps takes only the log rows on the person\'s own row', async () => {
    const wiring = wire();
    const person = { connectionId: 'con_1', table: 'members', key: '1' };
    await wiring.consent.record({ phone: NUMBER, person, purpose: 'text-service', state: 'yes', source: 'form', detail: 'Till', wording: { text: 'Text me', version: 'v1' } });
    await wiring.consent.stop.add({ phone: NUMBER, reason: 'text-stop', origin: 'twilio' });
    await wiring.inbound.accept({ channel: 'sms', account: 'acct', source: 'twilio', events: [{ providerId: 'narrow-1', kind: 'reply', subject: textSubject(NUMBER), body: '{}', occurredAt: 1 }] });
    const erased = await wiring.erasure.erase({ phone: NUMBER, country: null, person, at: 5, everywhere: false });
    expect(erased).toMatchObject({ stopEntry: 0, inboundEvents: 0, deliveries: 0 });
    expect(erased.consentRows).toBeGreaterThan(0);
    expect((await wiring.consent.stop.entryFor(NUMBER, null))?.phone).toBe(NUMBER);
    expect(await wiring.inbound.countFrom(textSubject(NUMBER))).toBe(1);
  });

  it.runIf(engine.available)('stores a number only as a hash and a sealed copy', async () => {
    const wiring = wire();
    await wiring.consent.stop.add({ phone: NUMBER, reason: 'text-stop', origin: 'twilio' });
    const rows = await handle.meta.db.selectFrom('adminium_text_stop_list').selectAll().execute();
    expect(JSON.stringify(rows)).not.toContain(NUMBER.slice(1));
    expect(rows[0]!.phoneHash).toBe((await addressKeyRing(handle.meta, SECRET).hashForWrite(textSubject(NUMBER))).hash);
  });
});

describe('the operator\'s switch for text messages', () => {
  const HOST = 'hollis.try.example.com';
  const OWN = 'shop.hollis.example';
  const COMMON = { ADMINIUM_PUBLIC_ORIGIN: `https://${HOST}`, ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432', ADMINIUM_OPERATOR_DOMAINS: OWN, ADMINIUM_PUBLIC_API_ORIGINS: `https://${OWN}` };
  const TRIAL = { ...COMMON, ADMINIUM_TRIAL_MODE: 'on', ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token', ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z' };
  const HOSTED = { ...COMMON, ADMINIUM_HOSTED_MODE: 'on' };
  let handle: MetaHandle;
  let calls: string[];
  const stubFetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return json(200, { messages: [], next_page_uri: null, data: [] });
  }) as typeof fetch;
  const wired = (env: Record<string, string>) => {
    const policy = trialPolicy(makeEnv(env));
    return createSmsWiring({ meta: handle.meta, secret: SECRET, inbound: createInboundWiring({ meta: handle.meta, secret: SECRET }), networkFeatures: true, desktop: false, trustProxy: true, operator: () => policy.allows('smsProviders'), log: { info: () => undefined }, fetch: stubFetch });
  };

  beforeAll(async () => {
    handle = await META_ENGINES[0]!.make();
    await settingsRepo(handle.meta).set('system.publicOrigin', 'https://hollis.example.com', { updatedBy: null });
    await createSmsAccountStore(handle.meta).write(accountFields(), null);
  });
  afterAll(async () => {
    await handle.destroy();
  });
  beforeEach(() => {
    calls = [];
  });

  it('in trial mode: text messages are off, and no provider is asked', async () => {
    const wiring = wired(TRIAL);
    expect(await wiring.catchUpAtBoot()).toBeNull();
    expect(await wiring.channel.replyReach()).toMatchObject({ canReceiveStop: false, address: null });
    expect((await wiring.channel.reach()).open).toBe(false);
    expect(calls).toEqual([]);
  });

  it('on an ordinary server and a hosted one: text messages reach the provider', async () => {
    for (const env of [{}, HOSTED]) {
      calls = [];
      const wiring = wired(env);
      expect((await wiring.catchUpAtBoot())?.outcome).toBe('done');
      expect(calls.length).toBeGreaterThan(0);
    }
  });
});

describe('what leaves a server', () => {
  const table = (name: string, columns: string[], rows: unknown[][]): MetaTableDump => ({ table: name, kinds: {}, columns, rows });

  it('an export drops the account, and keeps a stopped number as its hash alone', () => {
    const tables = new Map<string, MetaTableDump>([
      ['adminium_sms_accounts', table('adminium_sms_accounts', ['id', 'sealedCredentials'], [['sms_1', 'enc:v1:keys']])],
      ['adminium_text_stop_list', table('adminium_text_stop_list', ['id', 'phoneHash', 'phoneEncrypted'], [['tsp_1', 'hash', 'enc:v1:number']])],
      ['adminium_inbound_events', table('adminium_inbound_events', ['id', 'sealedBody'], [['ibe_1', 'enc:v1:body']])],
    ]);
    sanitizeDump(tables, { kind: 'export', dialect: 'sqlite' });
    expect(tables.get('adminium_sms_accounts')!.rows).toEqual([]);
    expect(tables.get('adminium_text_stop_list')!.rows).toEqual([['tsp_1', 'hash', null]]);
    expect(tables.get('adminium_inbound_events')!.rows).toEqual([['ibe_1', null]]);
  });

  it('a restore that drops secrets keeps a stopped number\'s row, and never the account', () => {
    const tables = new Map<string, MetaTableDump>([
      ['adminium_sms_accounts', table('adminium_sms_accounts', ['id', 'sealedCredentials'], [['sms_1', 'enc:v1:keys']])],
      ['adminium_text_stop_list', table('adminium_text_stop_list', ['id', 'phoneHash', 'phoneEncrypted'], [['tsp_1', 'hash', 'enc:v1:number']])],
    ]);
    sanitizeDump(tables, { kind: 'full', dialect: 'sqlite', dropSecrets: true });
    expect(tables.get('adminium_sms_accounts')!.rows).toEqual([]);
    // Kept as it was: it no longer opens, but who said STOP is not lost.
    expect(tables.get('adminium_text_stop_list')!.rows).toEqual([['tsp_1', 'hash', 'enc:v1:number']]);
  });

  it('a provider reaches the door on a customer host and a pages host', () => {
    for (const allows of [customerHostAllows('/api/v1/inbound/sms/twilio/token', 'shop'), pagesHostAllows('/api/v1/inbound/sms/twilio/token')]) expect(allows).toBe(true);
    expect(customerHostAllows('/api/v1/sms/setup', 'shop')).toBe(false);
    expect(pagesHostAllows('/api/v1/sms/setup')).toBe(false);
  });

  it('the log censors a provider token, a number and the sealed columns at any depth', () => {
    const line = scrubSecretFields({ authToken: TOKEN, nested: { phone: NUMBER, e164: NUMBER, mobile: NUMBER, list: [{ sealedCredentials: 'enc:v1:a', sealedBody: 'enc:v1:b', phoneEncrypted: 'enc:v1:c' }] } });
    const text = JSON.stringify(line);
    for (const value of [TOKEN, NUMBER, 'enc:v1:']) expect(text).not.toContain(value);
  });
});
