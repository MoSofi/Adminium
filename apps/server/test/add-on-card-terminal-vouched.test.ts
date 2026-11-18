// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A card terminal loads only from a vouched package, as a payment provider
 * does: it is handed the shop's reader keys and takes payments in person, so a
 * hand-uploaded look-alike is left out, by name and never imported.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addOnManifestSchema, type AddOnManifest } from '@adminium/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TrustSources } from '../src/add-ons/decide.js';
import { VOUCHED_CONTRACTS, buildAddOnRuntime } from '../src/add-ons/runtime.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';

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
    compatibility: { minAdminiumVersion: '0.3.60', requires: ['outbound-http'] },
    capabilities: ['outbound-http'],
    addOn: {
      attaches: [{ app: '*' }],
      provides: [{ contract: 'card-terminal', version: 1, server: 'dist/server.js' }],
      connect: { kind: 'api-key' },
      network: { allow: ['readers.example'] },
      publicSettings: [],
    },
  });
}

const NOBODY: TrustSources = { bundled: [], recorded: {} };
let dataDir: string;
let store: AddOnStore;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'card-terminal-vouched-'));
  store = createAddOnStore({ dataDir });
});
afterEach(async () => rm(dataDir, { recursive: true, force: true }));

async function stage(key: string) {
  const manifest = manifestFor(key);
  const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'dist/server.js': 'export {}' });
  const integrity = sha512Integrity(tarball);
  await store.stage({ key, version: '1.0.0', tarball, expectedIntegrity: integrity });
  return { integrity, installed: [{ manifest, version: '1.0.0' }] };
}

describe('a card terminal at load', () => {
  it('is one of the contracts only a vouched package may provide', () => {
    expect(VOUCHED_CONTRACTS.has('card-terminal')).toBe(true);
    expect(VOUCHED_CONTRACTS.has('payment-provider')).toBe(true);
  });

  it('is left out, by name and unimported, when nobody vouches for its package', async () => {
    const { installed } = await stage('readers-x');
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
    expect(runtime.problems).toMatchObject([{ addOnKey: 'readers-x', reason: 'UNTRUSTED_PROVIDER', contract: 'card-terminal@1' }]);
    expect(runtime.providers.get('card-terminal@1')).toBeUndefined();
  });

  it('is left out when the runtime is told of nobody, and in production on a developer\'s say', async () => {
    const { installed } = await stage('readers-x');
    expect((await buildAddOnRuntime({ store, installed, importModule: async () => ({}) })).problems.map((p) => p.reason)).toEqual(['UNTRUSTED_PROVIDER']);
    const prod = await buildAddOnRuntime({ store, installed, trust: { ...NOBODY, devKeys: 'readers-x', nodeEnv: 'production' }, importModule: async () => ({}) });
    expect(prod.problems.map((p) => p.reason)).toEqual(['UNTRUSTED_PROVIDER']);
  });

  it('is imported when its exact bytes are vouched for, and not when other bytes are', async () => {
    const { installed, integrity } = await stage('readers-x');
    const module = { createCardTerminal: () => null };
    const loaded = await buildAddOnRuntime({ store, installed, trust: { ...NOBODY, recorded: { 'readers-x@1.0.0': integrity } }, importModule: async () => module });
    expect(loaded.problems).toEqual([]);
    expect(loaded.providers.get('card-terminal@1')?.[0]).toMatchObject({ addOnKey: 'readers-x', module });

    const other = await buildAddOnRuntime({ store, installed, trust: { ...NOBODY, recorded: { 'readers-x@1.0.0': 'sha512-other' } }, importModule: async () => module });
    expect(other.problems.map((p) => p.reason)).toEqual(['UNTRUSTED_PROVIDER']);
  });
});
