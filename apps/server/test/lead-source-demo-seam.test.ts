// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DEMO SOURCE SEAM can never be on in production.
 *
 *  - the boot refuses `ADMINIUM_LEAD_SOURCE_DEMO` when `NODE_ENV` is
 *    production, on a trial and on a hosted server, naming the variable;
 *    elsewhere it boots;
 *  - read at a call, it is off in production even on a server composed
 *    without that boot check: the add-on's own code answers;
 *  - on a test server, a call to an add-on it names is answered by the
 *    contract's demo (made-up companies), with the install's switch, key and
 *    loaded package still asked first; an add-on it does not name answers
 *    with its own code.
 */
import { DEMO_LEAD_COMPANIES } from '@adminium/add-on-contracts/testing/lead-source';
import type { LeadSource } from '@adminium/add-on-contracts';
import { manifestsRepo, type InstalledManifest, type ManifestsRepo } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { EnvValidationError, loadEnv } from '../src/config/env.js';
import { SourceGate } from '../src/lead-sources/caps.js';
import { withLeadSource, type LeadSourceDeps } from '../src/lead-sources/call.js';
import { LEAD_SOURCE_DEMO_ENV, leadSourceDemoFor, leadSourceDemoKeys, leadSourceDemoProblem } from '../src/lead-sources/demo-seam.js';
import { withSourceKey } from '../src/lead-sources/keys.js';
import { mutateSourceState } from '../src/lead-sources/state.js';
import { leadFinder } from '../../../packages/manifest/test/lead-finder-fixture.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const KEY = 'company-finder';
const silent = { write: () => true };

/** The variables the boot refuses, or none. */
function refused(raw: Record<string, string>): string[] {
  try {
    loadEnv({ ADMINIUM_SECRET: TEST_SECRET, ...raw }, silent);
    return [];
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    return error.issues.map((issue) => String(issue.path[0] ?? '(env)'));
  }
}

describe('the demo source seam at boot', () => {
  it('refuses the variable in production, naming it', () => {
    expect(refused({ NODE_ENV: 'production', [LEAD_SOURCE_DEMO_ENV]: KEY })).toContain(LEAD_SOURCE_DEMO_ENV);
    expect(refused({ NODE_ENV: ' Production ', [LEAD_SOURCE_DEMO_ENV]: KEY })).toContain(LEAD_SOURCE_DEMO_ENV);
  });

  it('refuses it on a trial and on a hosted server', () => {
    const trial = { ADMINIUM_TRIAL_MODE: 'on', ADMINIUM_TRIAL_ENDS_AT: '2026-12-01T00:00:00Z', ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.try.example.com', ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432', ADMINIUM_SETUP_TOKEN: 'a-long-enough-setup-token' };
    expect(refused(trial)).toEqual([]);
    expect(refused({ ...trial, [LEAD_SOURCE_DEMO_ENV]: KEY })).toEqual([LEAD_SOURCE_DEMO_ENV]);
    const hosted = { ADMINIUM_HOSTED_MODE: 'on', ADMINIUM_PUBLIC_ORIGIN: 'https://hollis.example.com', ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432' };
    expect(refused(hosted)).toEqual([]);
    expect(refused({ ...hosted, [LEAD_SOURCE_DEMO_ENV]: KEY })).toEqual([LEAD_SOURCE_DEMO_ENV]);
    expect(leadSourceDemoProblem({ ADMINIUM_TRIAL_MODE: 'on', [LEAD_SOURCE_DEMO_ENV]: KEY })).toMatch(/trial/);
    expect(leadSourceDemoProblem({ ADMINIUM_HOSTED_MODE: 'true', [LEAD_SOURCE_DEMO_ENV]: KEY })).toMatch(/hosted/);
  });

  it('boots with it on a test server, and with it unset or empty anywhere', () => {
    expect(refused({ NODE_ENV: 'test', [LEAD_SOURCE_DEMO_ENV]: KEY })).toEqual([]);
    expect(refused({ [LEAD_SOURCE_DEMO_ENV]: KEY })).toEqual([]);
    expect(refused({ NODE_ENV: 'production' })).toEqual([]);
    expect(refused({ NODE_ENV: 'production', [LEAD_SOURCE_DEMO_ENV]: ' , ' })).toEqual([]);
  });

  it('is read as off in production, a trial or a hosted server, whatever it says', async () => {
    expect(leadSourceDemoKeys({ [LEAD_SOURCE_DEMO_ENV]: `${KEY}, other` })).toEqual([KEY, 'other']);
    for (const where of [{ NODE_ENV: 'production' }, { ADMINIUM_TRIAL_MODE: '1' }, { ADMINIUM_HOSTED_MODE: 'yes' }]) {
      expect(leadSourceDemoKeys({ ...where, [LEAD_SOURCE_DEMO_ENV]: KEY })).toEqual([]);
      expect(await leadSourceDemoFor(KEY, { ...where, [LEAD_SOURCE_DEMO_ENV]: KEY })).toBeNull();
    }
    expect(await leadSourceDemoFor('another-add-on', { [LEAD_SOURCE_DEMO_ENV]: KEY })).toBeNull();
    expect(await leadSourceDemoFor(KEY, { [LEAD_SOURCE_DEMO_ENV]: KEY })).toBeTypeOf('function');
  });
});

/** The add-on's own code: it answers with one company nobody else has. */
const OWN = { ok: true as const, companies: [{ ref: 'own-1', name: 'The add-on’s own answer', natural: false, noMarketing: false }], next: null };
const runtime: AddOnRuntimeState = {
  providers: new Map([['lead-source@1', [{ addOnKey: KEY, contract: 'lead-source', version: 1, module: { createLeadSource: (): LeadSource => ({ checkKey: async () => ({ ok: true }), findCompanies: async () => OWN }) } }]]]),
  slots: new Map(),
  conflicts: [],
  problems: [],
  deciders: new Map(),
};
const FIND = { activity: '71111', place: { text: 'Leeds', country: 'GB' }, page: { cursor: null, size: 20 } };

describe.each(META_ENGINES)('the demo source seam at a call — $name', (engine) => {
  let handle: MetaHandle;
  let manifests: ManifestsRepo;
  let install: InstalledManifest;
  let deps: LeadSourceDeps;
  const find = (seamEnv: Record<string, string>) =>
    withLeadSource({ ...deps, seamEnv }, { install, source: 'companies-house', spender: 'usr_mara', signal: new AbortController().signal }, async (made) => (await made.findCompanies!(FIND)) as typeof OWN);

  beforeEach(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    manifests = manifestsRepo(handle.meta, addOnCredentialCryptoFromSecret('a-test-secret-that-is-long-enough-000'));
    install = await manifests.install({ manifestKey: KEY, version: '1.0.0', kind: 'add-on', source: 'file', document: leadFinder() });
    await manifests.setCredential(install.row.id, { kind: 'api-key', secret: withSourceKey(await manifests.getCredential(install.row.id), 'companies-house', 'test-key-companies-1') });
    const entries = (leadFinder().addOn as { sources: { id: string; hosts?: string[]; key?: string; gives: ('find' | 'fill' | 'people')[] }[] }).sources;
    await mutateSourceState(handle.meta, install.row.id, entries.find((one) => one.id === 'companies-house')!, (state) => ({ ...state, on: true }));
    deps = { meta: handle.meta, manifests, runtime: () => runtime, gate: new SourceGate(), fetchImpl: (async () => new Response('{}')) as typeof fetch };
  });
  afterEach(async () => {
    if (engine.available) await handle.destroy();
  });

  it.skipIf(!engine.available)('on a test server, the add-on it names is answered by the demo; in production, by its own code', async () => {
    const demo = await find({ [LEAD_SOURCE_DEMO_ENV]: KEY });
    if (!demo.ok) throw new Error(demo.message);
    expect(demo.companies.map((one) => one.name)).toEqual(DEMO_LEAD_COMPANIES.filter((one) => one.address?.country === 'GB' && one.address.town === 'Leeds').map((one) => one.name));
    expect(await find({ NODE_ENV: 'production', [LEAD_SOURCE_DEMO_ENV]: KEY })).toEqual(OWN);
    expect(await find({ [LEAD_SOURCE_DEMO_ENV]: 'another-add-on' })).toEqual(OWN);
    expect(await find({})).toEqual(OWN);
  });

  it.skipIf(!engine.available)('the switch, the key and the loaded package are still asked first', async () => {
    const entries = (leadFinder().addOn as { sources: { id: string; hosts?: string[]; key?: string; gives: ('find' | 'fill' | 'people')[] }[] }).sources;
    await mutateSourceState(handle.meta, install.row.id, entries.find((one) => one.id === 'companies-house')!, (state) => ({ ...state, on: false }));
    expect(await find({ [LEAD_SOURCE_DEMO_ENV]: KEY })).toMatchObject({ ok: false, code: 'SOURCE_OFF' });
    await mutateSourceState(handle.meta, install.row.id, entries.find((one) => one.id === 'companies-house')!, (state) => ({ ...state, on: true }));
    deps = { ...deps, runtime: () => null };
    expect(await find({ [LEAD_SOURCE_DEMO_ENV]: KEY })).toMatchObject({ ok: false, code: 'NOT_VOUCHED' });
  });
});
