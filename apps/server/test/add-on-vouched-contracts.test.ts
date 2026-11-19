// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every registered contract with a server half loads only from a package
 * Adminium can vouch for: its code runs in this process and may be handed
 * keys. For each contract id of the registry, a package nobody vouches for is
 * left out by name and never imported; the same package, vouched for, loads.
 * The deciding contracts are compiled rather than imported, under a gate of
 * their own (`add-on-decide-trust.test.ts`).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONTRACT_IDS } from '@adminium/add-on-contracts';
import type { AddOnManifest } from '@adminium/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DECIDER_CONTRACTS, type TrustSources } from '../src/add-ons/decide.js';
import { VOUCHED_CONTRACTS, buildAddOnRuntime } from '../src/add-ons/runtime.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';

/** The contracts imported as modules: every one the registry holds but those that decide inside a save. */
const IMPORTED = CONTRACT_IDS.filter((id) => DECIDER_CONTRACTS[id] === undefined);

/** A package that provides one contract and nothing else: all the runtime reads of it. */
function manifestFor(key: string, contract: string): AddOnManifest {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key,
    name: key,
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: `addon.${key}.line`, fallback: 'x' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '0.3.66' },
    addOn: { attaches: [{ app: '*' }], provides: [{ contract, version: 1, server: 'dist/server.js' }], connect: { kind: 'none' } },
  } as unknown as AddOnManifest;
}

const NOBODY: TrustSources = { bundled: [], recorded: {} };
let dataDir: string;
let store: AddOnStore;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'vouched-contracts-'));
  store = createAddOnStore({ dataDir });
});
afterEach(async () => rm(dataDir, { recursive: true, force: true }));

async function stage(key: string, contract: string) {
  const manifest = manifestFor(key, contract);
  const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'dist/server.js': 'export {}' });
  const integrity = sha512Integrity(tarball);
  await store.stage({ key, version: '1.0.0', tarball, expectedIntegrity: integrity });
  return { integrity, installed: [{ manifest, version: '1.0.0' }] };
}

describe('the contracts only a vouched package may provide', () => {
  it('are every registered contract that does not decide inside a save', () => {
    expect([...VOUCHED_CONTRACTS].sort()).toEqual([...IMPORTED].sort());
    // Those named before the rule was turned round, and the one that came with it, among them.
    expect(IMPORTED).toEqual(expect.arrayContaining(['payment-provider', 'card-terminal', 'lead-source', 'artwork-source', 'shipping-carrier', 'product-personalizer', 'document-render']));
    for (const decider of Object.keys(DECIDER_CONTRACTS)) expect(VOUCHED_CONTRACTS.has(decider), decider).toBe(false);
  });

  for (const contract of IMPORTED) {
    it(`leaves out "${contract}" from a package nobody vouches for, unimported, and loads it when its bytes are vouched for`, async () => {
      const key = `provider-${contract}`;
      const { installed, integrity } = await stage(key, contract);
      const imported: string[] = [];
      const importModule = async (path: string) => {
        imported.push(path);
        return {};
      };

      const refused = await buildAddOnRuntime({ store, installed, trust: NOBODY, importModule });
      expect(imported).toEqual([]);
      expect(refused.problems).toMatchObject([{ addOnKey: key, reason: 'UNTRUSTED_PROVIDER', contract: `${contract}@1` }]);
      expect(refused.providers.get(`${contract}@1`)).toBeUndefined();

      // Told of nobody at all, it is left out the same.
      expect((await buildAddOnRuntime({ store, installed, importModule })).problems.map((problem) => problem.reason)).toEqual(['UNTRUSTED_PROVIDER']);
      expect(imported).toEqual([]);

      const loaded = await buildAddOnRuntime({ store, installed, trust: { ...NOBODY, recorded: { [`${key}@1.0.0`]: integrity } }, importModule });
      expect(loaded.problems).toEqual([]);
      expect(imported).toHaveLength(1);
      expect(loaded.providers.get(`${contract}@1`)?.[0]).toMatchObject({ addOnKey: key });
    });
  }
});
