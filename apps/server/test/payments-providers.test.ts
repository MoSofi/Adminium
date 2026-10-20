// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A payment provider loads only from a vouched package, is chosen by key,
 * is built per operation with its own egress client and this mode's
 * credential, and is guarded: every answer parsed, a throw a refusal.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createDemoPaymentBackend,
  createDemoPaymentProvider,
  providerError,
  type PaymentProvider,
  type PaymentProviderContext,
  type ProviderError,
} from '@adminium/add-on-contracts';
import { addOnManifestSchema, type AddOnManifest } from '@adminium/manifest';
import type { CredentialEnvelope, InstalledManifest } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TrustSources } from '../src/add-ons/decide.js';
import { buildAddOnRuntime, type AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { lastFour, modeCredentials, withField } from '../src/payments/credentials.js';
import { DEMO_CREDENTIALS, checkoutUrlAllowed, guardProvider, paymentProviderFor, type PaymentSeamDeps } from '../src/payments/providers.js';
import { packageTarball } from './app-bundle-helpers.js';

const PROVIDES = [{ contract: 'payment-provider', version: 1, server: 'dist/provider.js' }];

function manifestFor(key: string): AddOnManifest {
  return addOnManifestSchema.parse({
    kind: 'add-on',
    manifestVersion: 1,
    key,
    name: key,
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: `addon.${key}.line`, fallback: 'x' },
    categories: ['payments'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    capabilities: ['outbound-http'],
    addOn: {
      attaches: [{ app: '*', range: '*' }],
      connect: { kind: 'api-key' },
      provides: PROVIDES,
      network: { allow: ['checkout.pay.example', 'api.pay.example'] },
      publicSettings: [],
    },
  });
}

const NOBODY: TrustSources = { bundled: [], recorded: {} };
let dataDir: string;
let store: AddOnStore;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'payments-providers-'));
  store = createAddOnStore({ dataDir });
});
afterEach(async () => rm(dataDir, { recursive: true, force: true }));

async function stage(key: string) {
  const manifest = manifestFor(key);
  const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'dist/provider.js': 'export {}' });
  const integrity = sha512Integrity(tarball);
  await store.stage({ key, version: '1.0.0', tarball, expectedIntegrity: integrity });
  return { manifest, integrity, installed: [{ manifest, version: '1.0.0' }] };
}

describe('a payment provider at load', () => {
  it('is left out, by name and unimported, when nobody vouches for its package', async () => {
    const { installed } = await stage('pay-x');
    const imported: string[] = [];
    const runtime = await buildAddOnRuntime({
      store,
      installed,
      trust: NOBODY,
      importModule: async (path) => {
        imported.push(path);
        return {};
      },
    });
    expect(imported).toEqual([]);
    expect(runtime.problems).toMatchObject([{ addOnKey: 'pay-x', reason: 'UNTRUSTED_PROVIDER', contract: 'payment-provider@1' }]);
    expect(runtime.providers.get('payment-provider@1')).toBeUndefined();
  });

  it('is left out when the runtime is told of nobody at all, and in production on a developer\'s say', async () => {
    const { installed } = await stage('pay-x');
    expect((await buildAddOnRuntime({ store, installed })).problems.map((p) => p.reason)).toEqual(['UNTRUSTED_PROVIDER']);
    const prod = await buildAddOnRuntime({ store, installed, trust: { ...NOBODY, devKeys: 'pay-x', nodeEnv: 'production' } });
    expect(prod.problems.map((p) => p.reason)).toEqual(['UNTRUSTED_PROVIDER']);
  });

  it('is imported when its exact bytes are vouched for, and not when other bytes are', async () => {
    const { installed, integrity } = await stage('pay-x');
    const module = { createPaymentProvider: () => null };
    const loaded = await buildAddOnRuntime({
      store,
      installed,
      trust: { ...NOBODY, recorded: { 'pay-x@1.0.0': integrity } },
      importModule: async () => module,
    });
    expect(loaded.problems).toEqual([]);
    expect(loaded.providers.get('payment-provider@1')?.[0]).toMatchObject({ addOnKey: 'pay-x', module });

    const other = await buildAddOnRuntime({
      store,
      installed,
      trust: { ...NOBODY, recorded: { 'pay-x@1.0.0': 'sha512-other' } },
      importModule: async () => module,
    });
    expect(other.problems.map((p) => p.reason)).toEqual(['UNTRUSTED_PROVIDER']);
  });
});

// ─── The seam ───────────────────────────────────────────────────────────────

const backend = createDemoPaymentBackend();
const STORED = { secretKey: 'demo_test_vouched01', webhookSecret: 'demo_whsec_vouched01' };

function seam(over: Partial<Omit<PaymentSeamDeps, 'runtime'>> & { status?: string; credential?: CredentialEnvelope | null; state?: AddOnRuntimeState | null } = {}): PaymentSeamDeps & { calls: string[]; logs: string[] } {
  const calls: string[] = [];
  const logs: string[] = [];
  const manifest = manifestFor('pay-x');
  const row = { id: 'man_1', status: over.status ?? 'installed' } as InstalledManifest['row'];
  const runtime: AddOnRuntimeState =
    over.state ??
    ({
      providers: new Map([
        [
          'payment-provider@1',
          [
            {
              addOnKey: 'pay-x',
              contract: 'payment-provider',
              version: 1,
              module: {
                createPaymentProvider: (ctx: PaymentProviderContext): PaymentProvider => {
                  calls.push(`made ${ctx.mode} ${ctx.credentials['secretKey'] ?? ''}`);
                  return { ...createDemoPaymentProvider(ctx), key: 'pay-x' };
                },
              },
            },
          ],
        ],
      ]),
      slots: new Map(),
      conflicts: [],
      problems: [],
      deciders: new Map(),
    } as AddOnRuntimeState);
  return {
    runtime: () => (over.state === null ? null : runtime),
    manifests: {
      findByKey: async (key) => (key === 'pay-x' ? ({ row, document: manifest, attachments: [] } as InstalledManifest) : null),
      getCredential: async () =>
        over.credential === undefined ? { kind: 'api-key', secret: { payments: 1, test: STORED } } : over.credential,
    },
    httpFor: () => backend.http,
    demo: over.demo === undefined ? backend : over.demo,
    log: (message) => logs.push(message),
    calls,
    logs,
  };
}

describe('the provider a key names', () => {
  it('is built for one call with this mode\'s credential, and works', async () => {
    const deps = seam();
    const found = await paymentProviderFor(deps, 'pay-x', 'test');
    if (!found.ok) throw new Error(found.message);
    expect(found.redirectHosts).toEqual(['checkout.pay.example', 'api.pay.example']);
    expect(deps.calls).toEqual(['made test demo_test_vouched01']);
    const check = await found.provider.checkCredentials();
    expect(check).toMatchObject({ ok: true, livemode: false });
  });

  it.each([
    ['not installed', 'nope', {}, 'NOT_INSTALLED'],
    ['switched off', 'pay-x', { status: 'disabled' }, 'SWITCHED_OFF'],
    ['not loaded', 'pay-x', { state: null }, 'NOT_LOADED'],
    ['without a key for the mode', 'pay-x', { credential: null }, 'NO_CREDENTIAL'],
  ] as const)('is refused when %s', async (_name, key, over, code) => {
    const found = await paymentProviderFor(seam(over as never), key, 'test');
    expect(found.ok ? 'found' : found.code).toBe(code);
  });

  it('is refused in live mode when only a test key is saved', async () => {
    const found = await paymentProviderFor(seam(), 'pay-x', 'live');
    expect(found.ok ? 'found' : found.code).toBe('NO_CREDENTIAL');
  });

  it('refuses a module with no factory', async () => {
    const runtime = {
      providers: new Map([['payment-provider@1', [{ addOnKey: 'pay-x', contract: 'payment-provider', version: 1, module: { other: 1 } }]]]),
      slots: new Map(),
      conflicts: [],
      problems: [],
      deciders: new Map(),
    } as AddOnRuntimeState;
    const found = await paymentProviderFor(seam({ state: runtime }), 'pay-x', 'test');
    expect(found.ok ? 'found' : found.code).toBe('NO_FACTORY');
  });

  it('offers the built-in demo in test mode only, with no key of its own to save', async () => {
    const test = await paymentProviderFor(seam(), 'demo', 'test');
    expect(test.ok).toBe(true);
    const live = await paymentProviderFor(seam(), 'demo', 'live');
    expect(live.ok ? 'found' : live.code).toBe('DEMO_IS_TEST_ONLY');
    const none = await paymentProviderFor(seam({ demo: null }), 'demo', 'test');
    expect(none.ok ? 'found' : none.code).toBe('NOT_INSTALLED');
    expect(DEMO_CREDENTIALS.secretKey).toMatch(/^demo_test_/);
  });
});

describe('a guarded provider', () => {
  const real = createDemoPaymentProvider({ http: backend.http, credentials: STORED, mode: 'test' });

  it('turns a throw into a retryable refusal, logged by call name only', async () => {
    const logs: { message: string; fields: Record<string, unknown> }[] = [];
    const guarded = guardProvider(
      { ...real, status: async () => Promise.reject(new Error(`boom ${STORED.secretKey}`)) },
      (message, fields) => logs.push({ message, fields }),
    );
    const answer = (await guarded.status('cs_1')) as ProviderError;
    expect(answer).toMatchObject({ ok: false, code: 'UNAVAILABLE', retryable: true });
    expect(JSON.stringify(logs)).not.toContain(STORED.secretKey);
    expect(logs[0]).toEqual({ message: 'payment provider call threw', fields: { key: 'demo', call: 'status' } });
  });

  it('treats an answer outside the contract as the service being unavailable', async () => {
    const guarded = guardProvider({ ...real, status: async () => ({ ok: true, ref: 'cs_1', status: 'paid' }) as never });
    expect(((await guarded.status('cs_1')) as ProviderError).code).toBe('UNAVAILABLE');
    const lying = guardProvider({
      ...real,
      status: async () => ({
        ok: true,
        ref: 'cs_1',
        status: 'succeeded',
        attemptId: 'a',
        amount: null,
        currency: null,
        livemode: false,
        paymentRef: null,
        paidWith: null,
        settledAt: null,
        failureMessage: null,
      }),
    });
    // A success that does not say what was taken is outside the contract.
    expect(((await lying.status('cs_1')) as ProviderError).code).toBe('UNAVAILABLE');
    const badMinor = guardProvider({ ...real, toMinor: () => ({ minor: '12.5', currency: 'EUR' }) });
    expect((badMinor.toMinor('12.5', 'EUR') as ProviderError).code).toBe('UNAVAILABLE');
  });

  it('passes a refusal through as data', async () => {
    const guarded = guardProvider({ ...real, status: async () => providerError('NOT_FOUND', 'No such checkout.') });
    expect(await guarded.status('x')).toEqual({ ok: false, code: 'NOT_FOUND', providerMessage: 'No such checkout.', retryable: false });
  });
});

describe('where a customer may be sent', () => {
  const hosts = ['checkout.pay.example'];
  it.each([
    ['https://checkout.pay.example/c/pay/cs_1', true],
    ['http://checkout.pay.example/c/pay/cs_1', false],
    ['https://evil.example/c/pay/cs_1', false],
    ['https://user@checkout.pay.example/', false],
    ['https://checkout.pay.example.evil.example/', false],
    ['not a url', false],
  ])('%s → %s', (url, ok) => {
    expect(checkoutUrlAllowed(url, hosts)).toBe(ok);
  });

  it('sends nobody anywhere when the provider names no host', () => {
    expect(checkoutUrlAllowed('https://checkout.pay.example/', [])).toBe(false);
  });
});

describe('a payment add-on\'s credentials', () => {
  it('keeps each mode\'s fields apart, trims a paste, and removes a field', () => {
    let secret = withField(null, 'test', 'secretKey', '  rk_test_123456a1B2  ');
    secret = withField({ kind: 'api-key', secret }, 'live', 'secretKey', 'rk_live_99999xQ4');
    secret = withField({ kind: 'api-key', secret }, 'test', 'webhookSecret', 'whsec_1');
    expect(modeCredentials({ kind: 'api-key', secret }, 'test')).toEqual({ secretKey: 'rk_test_123456a1B2', webhookSecret: 'whsec_1' });
    expect(modeCredentials({ kind: 'api-key', secret }, 'live')).toEqual({ secretKey: 'rk_live_99999xQ4' });
    secret = withField({ kind: 'api-key', secret }, 'live', 'secretKey', null);
    expect(modeCredentials({ kind: 'api-key', secret }, 'live')).toBeNull();
    expect(lastFour('rk_test_123456a1B2')).toBe('a1B2');
  });

  it('reads a generic connect envelope as no payment credential at all', () => {
    expect(modeCredentials({ kind: 'api-key', secret: { api_key: 'x' } }, 'test')).toBeNull();
    expect(modeCredentials(null, 'test')).toBeNull();
  });
});
