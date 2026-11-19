// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One call to one source of a lead source add-on (`withLeadSource`), on every
 * engine this run can reach.
 *
 * Each call is handed that source's key and no other, and a client that
 * reaches that source's hosts and no other: the people source cannot reach
 * the register's host (refused, and audited as any add-on's refusal is) nor
 * see the register's key. A 429 pauses that source alone; a third call in
 * flight on one source is refused `BUSY`; the 101st paid call of the day is
 * refused by name; a switched-off source, a missing key, a package that did
 * not load and the website are each refused before anything is asked; a
 * throw is the source being unavailable, and its own "rate limited" pauses it.
 */
import { auditRepo, manifestsRepo, type InstalledManifest, type ManifestsRepo } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { SourceGate } from '../src/lead-sources/caps.js';
import { withLeadSource, type LeadSourceDeps } from '../src/lead-sources/call.js';
import { withSourceKey } from '../src/lead-sources/keys.js';
import type { LeadSource, LeadSourceContext } from '@adminium/add-on-contracts';
import { DEFAULT_DAILY_CAP, mutateSourceState, sourceStateOf, type LeadSourceEntry, type SourcesState } from '../src/lead-sources/state.js';
import { leadFinder } from '../../../packages/manifest/test/lead-finder-fixture.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const KEY = 'company-finder';
const REGISTER_KEY = 'test-key-companies-1';
const PEOPLE_KEY = 'test-key-people-2';
const REGISTER_HOST = 'api.company-information.service.gov.uk';
const PEOPLE_HOST = 'api.hunter.io';

/** What each made source was handed, and what its calls should do. */
const seen: LeadSourceContext[] = [];
let behave: (context: LeadSourceContext) => LeadSource = (context) => ({ checkKey: async () => ({ ok: true, account: context.source }) });

const runtime: AddOnRuntimeState = {
  providers: new Map([['lead-source@1', [{ addOnKey: KEY, contract: 'lead-source', version: 1, module: { createLeadSource: (context: LeadSourceContext) => (seen.push(context), behave(context)) } }]]]),
  slots: new Map(),
  conflicts: [],
  problems: [],
  deciders: new Map(),
};

describe.each(META_ENGINES)('one call to one source — $name', (engine) => {
  let handle: MetaHandle;
  let manifests: ManifestsRepo;
  let install: InstalledManifest;
  let hosts: string[];
  let deps: LeadSourceDeps;
  const stop = new AbortController();

  const call = <T>(source: string, run: (made: LeadSource) => Promise<T>, spender = 'usr_mara') => withLeadSource(deps, { install, source, spender, signal: stop.signal }, run as never);

  beforeEach(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    manifests = manifestsRepo(handle.meta, addOnCredentialCryptoFromSecret('a-test-secret-that-is-long-enough-000'));
    install = await manifests.install({ manifestKey: KEY, version: '1.0.0', kind: 'add-on', source: 'file', document: leadFinder() });
    let envelope = await manifests.getCredential(install.row.id);
    for (const [source, value] of [['companies-house', REGISTER_KEY], ['hunter', PEOPLE_KEY]] as const) {
      await manifests.setCredential(install.row.id, { kind: 'api-key', secret: withSourceKey(envelope, source, value) });
      envelope = await manifests.getCredential(install.row.id);
    }
    const entries = (leadFinder().addOn as { sources: { id: string; hosts?: string[]; key?: string; gives: ('find' | 'fill' | 'people')[]; paid?: boolean }[] }).sources;
    for (const id of ['companies-house', 'hunter']) await mutateSourceState(handle.meta, install.row.id, entries.find((one) => one.id === id)!, (state) => ({ ...state, on: true }));
    seen.length = 0;
    hosts = [];
    behave = (context) => ({ checkKey: async () => ({ ok: true, account: context.source }) });
    deps = {
      meta: handle.meta,
      manifests,
      runtime: () => runtime,
      gate: new SourceGate(),
      fetchImpl: (async (input: string | URL) => {
        hosts.push(new URL(String(input)).host);
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    };
  });
  afterEach(async () => {
    if (engine.available) await handle.destroy();
  });

  it.skipIf(!engine.available)("hands the people source its own key and a client that cannot reach the register's host", async () => {
    const answer = await call('hunter', async (made) => {
      void made;
      const context = seen.at(-1)!;
      await expect(context.http(`https://${REGISTER_HOST}/search/companies?q=x`)).rejects.toMatchObject({ reason: 'HOST_NOT_ALLOWED' });
      const fine = await context.http(`https://${PEOPLE_HOST}/v2/account`);
      return { ok: true as const, status: fine.status };
    });
    expect(answer).toEqual({ ok: true, status: 200 });
    expect(hosts).toEqual([PEOPLE_HOST]);
    const context = seen.at(-1)!;
    expect(context.source).toBe('hunter');
    expect(context.key).toBe(PEOPLE_KEY);
    // Nothing it was handed holds the register's key.
    expect(JSON.stringify({ ...context, http: undefined, signal: undefined })).not.toContain(REGISTER_KEY);
    // The refusal is audited as any add-on's is, naming the one host it may reach.
    const refused = (await auditRepo(handle.meta).list({ category: 'add-on' })).filter((entry) => entry.action === 'add-on.egress-refused');
    expect(JSON.stringify(refused)).toContain(REGISTER_HOST);
    expect(JSON.stringify(refused)).toContain(`"declared":["${PEOPLE_HOST}"]`);
  });

  it.skipIf(!engine.available)('pauses only the source whose service answered 429', async () => {
    deps.fetchImpl = (async (input: string | URL) => {
      const host = new URL(String(input)).host;
      return host === PEOPLE_HOST ? new Response('slow down', { status: 429, headers: { 'retry-after': '30' } }) : new Response('{}', { status: 200 });
    }) as typeof fetch;
    const ask = (source: string, host: string) => call(source, async () => ({ ok: true as const, status: (await seen.at(-1)!.http(`https://${host}/x`)).status }));
    expect(await ask('hunter', PEOPLE_HOST)).toEqual({ ok: true, status: 429 });
    expect(await ask('hunter', PEOPLE_HOST)).toMatchObject({ ok: false, code: 'PAUSED', retryAfterSeconds: 30 });
    expect(await ask('companies-house', REGISTER_HOST)).toEqual({ ok: true, status: 200 });
  });

  it.skipIf(!engine.available)('refuses a third call in flight on one source BUSY, and lets another source answer', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = () => call('hunter', async () => (await held, { ok: true as const }));
    const first = slow();
    const second = slow();
    // Both are in, and answering.
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(await call('hunter', async () => ({ ok: true as const }))).toMatchObject({ ok: false, code: 'BUSY' });
    expect(await call('companies-house', async () => ({ ok: true as const }))).toEqual({ ok: true });
    release();
    expect(await Promise.all([first, second])).toEqual([{ ok: true }, { ok: true }]);
    expect(await call('hunter', async () => ({ ok: true as const }))).toEqual({ ok: true });
  });

  it.skipIf(!engine.available)('refuses the 101st paid call of the day by name', async () => {
    const entries = (leadFinder().addOn as { sources: { id: string; gives: ('find' | 'fill' | 'people')[]; paid?: boolean }[] }).sources;
    // Each person may spend the whole day here, so the day's cap is what refuses.
    await mutateSourceState(handle.meta, install.row.id, entries.find((one) => one.id === 'hunter')!, (state) => ({ ...state, personShare: 100 }));
    for (let n = 0; n < 100; n += 1) expect(await call('hunter', async () => ({ ok: true as const }))).toEqual({ ok: true });
    const refused = await call('hunter', async () => ({ ok: true as const }));
    expect(refused).toMatchObject({ ok: false, code: 'DAILY_CAP', used: 100, cap: 100 });
    // Nothing was asked of it.
    expect(seen).toHaveLength(100);
  });

  it.skipIf(!engine.available)('refuses before asking: switched off, no key, not loaded, the website', async () => {
    const entries = (leadFinder().addOn as { sources: { id: string; gives: ('find' | 'fill' | 'people')[] }[] }).sources;
    await mutateSourceState(handle.meta, install.row.id, entries.find((one) => one.id === 'hunter')!, (state) => ({ ...state, on: false }));
    expect(await call('hunter', async () => ({ ok: true as const }))).toMatchObject({ ok: false, code: 'SOURCE_OFF' });
    await manifests.setCredential(install.row.id, { kind: 'api-key', secret: withSourceKey(await manifests.getCredential(install.row.id), 'companies-house', null) });
    expect(await call('companies-house', async () => ({ ok: true as const }))).toMatchObject({ ok: false, code: 'KEY_NOT_SET' });
    expect(await call('website', async () => ({ ok: true as const }))).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(await call('nowhere', async () => ({ ok: true as const }))).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    // A source that needs no key is on, and answers, at once.
    expect(await call('france', async () => ({ ok: true as const }))).toEqual({ ok: true });
    expect(seen.at(-1)?.key).toBeNull();
    deps.runtime = () => ({ ...runtime, providers: new Map() });
    expect(await call('france', async () => ({ ok: true as const }))).toMatchObject({ ok: false, code: 'NOT_VOUCHED' });
    expect(seen).toHaveLength(1);
  });

  it.skipIf(!engine.available)('reads a throw as the source being unavailable, and pauses a source that said it is rate limited', async () => {
    expect(
      await call('france', async () => {
        throw new Error(`boom ${REGISTER_KEY}`);
      }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE', message: 'france could not be reached.' });
    expect(await call('france', async () => ({ ok: false as const, code: 'RATE_LIMITED' as const, message: 'later', retryAfterSeconds: 5 }))).toMatchObject({ code: 'RATE_LIMITED' });
    expect(await call('france', async () => ({ ok: true as const }))).toMatchObject({ ok: false, code: 'PAUSED', retryAfterSeconds: 5 });
  });

  it.skipIf(!engine.available)('keeps a key that travels in the query string out of the audit rows, the log and the reply', async () => {
    // A key a URL must encode, as a service that takes its key in the query is handed it.
    const KEYED = 'test key/companies+7';
    await manifests.setCredential(install.row.id, { kind: 'api-key', secret: withSourceKey(await manifests.getCredential(install.row.id), 'companies-house', KEYED) });
    const logs: string[] = [];
    deps.log = (message, fields) => logs.push(JSON.stringify([message, fields]));
    deps.fetchImpl = (async (input: string | URL) => {
      throw new Error(`connect ECONNREFUSED for ${String(input)}`);
    }) as typeof fetch;
    const query = (host: string) => `https://${host}/search?q=kestrel&api_token=${encodeURIComponent(seen.at(-1)!.key!)}`;
    const quoted = async (host: string) =>
      call('companies-house', async () => {
        try {
          await seen.at(-1)!.http(query(host));
          return { ok: true as const };
        } catch (error) {
          // A careless adapter hands back what it was told, and the URL it asked, as its refusal.
          return { ok: false as const, code: 'UNAVAILABLE' as const, message: `${(error as Error).message} asking ${query(host)} with ${seen.at(-1)!.key!}, token ${encodeURIComponent(seen.at(-1)!.key!)}` };
        }
      });
    // A host this source may not reach, and a call to its own host that fails.
    const refused = await quoted('api.hunter.io');
    const failed = await quoted(REGISTER_HOST);
    const thrown = await call('companies-house', async () => {
      throw new Error(`boom ${query(REGISTER_HOST)}`);
    });
    expect(refused).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(failed).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(thrown).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    const rows = (await auditRepo(handle.meta).list({ category: 'add-on' })).filter((entry) => entry.action === 'add-on.egress-refused');
    expect(rows.map((row) => (row.changes as { after: { reason: string } }).after.reason).sort()).toEqual(['HOST_NOT_ALLOWED', 'REQUEST_FAILED']);
    const everywhere = JSON.stringify({ refused, failed, thrown, rows, logs });
    for (const form of [KEYED, encodeURIComponent(KEYED), 'api_token=']) expect(everywhere).not.toContain(form);
  });

  it.skipIf(!engine.available)('keeps the slot of a source that ignores its signal until its work ends: hung calls never pass the cap', async () => {
    deps.deadlineMs = 10;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // It never looks at its signal: only `release` ends its work.
    const deaf = () => call('hunter', async () => (await held, { ok: true as const }));
    const answers = await Promise.all([deaf(), deaf()]);
    // Both replies gave up waiting…
    expect(answers).toEqual([expect.objectContaining({ ok: false, code: 'UNAVAILABLE' }), expect.objectContaining({ ok: false, code: 'UNAVAILABLE' })]);
    // …but both are still running: a third is refused, and nothing more is asked of the source.
    expect(await call('hunter', async () => ({ ok: true as const }))).toMatchObject({ ok: false, code: 'BUSY' });
    expect(seen).toHaveLength(2);
    release();
    await vi.waitFor(async () => expect(await call('hunter', async () => ({ ok: true as const }))).toEqual({ ok: true }));
  });

  it.skipIf(!engine.available)('takes the key out of every word of a success too, the shape kept', async () => {
    const answer = await call('hunter', async () => ({
      ok: true as const,
      account: `the account of ${PEOPLE_KEY}`,
      people: [{ name: 'Ida Marsh', email: 'ida.marsh@kestrel-yard.example', sources: [`https://www.kestrel-yard.example/team?ref=${encodeURIComponent(PEOPLE_KEY)}&page=2`] }],
      count: 1,
    }));
    expect(JSON.stringify(answer)).not.toContain(PEOPLE_KEY);
    expect(answer).toEqual({
      ok: true,
      account: 'the account of [the saved key]',
      people: [{ name: 'Ida Marsh', email: 'ida.marsh@kestrel-yard.example', sources: ['https://www.kestrel-yard.example/team?ref=[the saved key]&page=2'] }],
      count: 1,
    });
  });

  it.skipIf(!engine.available)("stops a source's request with the caller's Stop", async () => {
    const mine = new AbortController();
    deps.fetchImpl = ((_input: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    let stopped: unknown = null;
    const pending = withLeadSource(deps, { install, source: 'france', spender: 'usr_mara', signal: mine.signal }, async () => {
      try {
        // The client takes no signal of its own: the call's Stop is tied into it.
        await seen.at(-1)!.http('https://recherche-entreprises.api.gouv.fr/search');
      } catch (error) {
        stopped = error;
        throw error;
      }
      return { ok: true as const };
    });
    setTimeout(() => mine.abort(), 10);
    expect(await pending).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(stopped).toMatchObject({ reason: 'REQUEST_FAILED', message: expect.stringContaining('was stopped') });
    expect(seen.at(-1)?.signal.aborted).toBe(true);
    // A Stop is not a refusal: nothing is audited for it.
    expect(JSON.stringify((await auditRepo(handle.meta).list({ category: 'add-on' })).filter((entry) => entry.action === 'add-on.egress-refused'))).not.toContain('recherche-entreprises');
  });
});

describe('a source the package made paid after its state was kept', () => {
  it('reads with the default cap, never uncapped', () => {
    const hunter = (leadFinder().addOn as { sources: LeadSourceEntry[] }).sources.find((one) => one.id === 'hunter')!;
    const kept = { lastFour: '1234', savedAt: 1, checkedAt: 1, verdict: 'accepted' as const, on: true, dailyCap: null, personShare: 50 };
    expect(sourceStateOf({ sources: { hunter: kept } } as unknown as SourcesState, hunter).dailyCap).toBe(DEFAULT_DAILY_CAP);
    // A free source keeps its stored no-cap; a set cap is kept as set.
    expect(sourceStateOf({ sources: { hunter: kept } } as unknown as SourcesState, { ...hunter, paid: false }).dailyCap).toBeNull();
    expect(sourceStateOf({ sources: { hunter: { ...kept, dailyCap: 7 } } } as unknown as SourcesState, hunter).dailyCap).toBe(7);
  });
});
