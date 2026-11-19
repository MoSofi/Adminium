// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN UPDATE TO THE RELEASE THAT MADE EVERY PROVIDER NEED A VOUCHED PACKAGE
 * DROPS NOTHING THAT RAN, on each meta engine.
 *
 *  - a package installed before, whose provider ran (a document kind, event
 *    code), keeps loading: its tree is recorded as trusted once, at the first
 *    boot, and its kept copy beside it;
 *  - a package that needed a vouched package already (a payment provider, a
 *    stranger's door) is not carried over: nothing of it ran (judged by
 *    `carriedOverByRelease`, below);
 *  - a tree changed on disk is not carried over;
 *  - a look-alike staged after the boot began is refused, and the Add-ons
 *    list says so;
 *  - the carry-over runs once.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateManifest, type AddOnManifest } from '@adminium/manifest';
import { manifestsRepo, settingsRepo, type ManifestsRepo } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { trustSources } from '../src/add-ons/decider-trust.js';
import { buildAddOnRuntime } from '../src/add-ons/runtime.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { carriedOverByRelease, carryOverTrust, trustCarryOverCandidates } from '../src/add-ons/trust-carry-over.js';
import { packageTarball } from './app-bundle-helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const PLAIN = { encrypt: (value: string) => value, decrypt: (value: string) => value };

/** A package that provides one contract, or has event code, and nothing else. */
function manifestFor(key: string, part: { contract?: string; events?: true }): AddOnManifest {
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
    compatibility: { minAdminiumVersion: '0.3.0' },
    addOn: {
      attaches: [{ app: '*' }],
      ...(part.contract === undefined ? {} : { provides: [{ contract: part.contract, version: 1, server: 'dist/server.js' }] }),
      ...(part.events === undefined ? {} : { events: [{ on: 'record.created', server: 'dist/server.js' }] }),
      connect: { kind: 'none' },
    },
  } as unknown as AddOnManifest;
}

describe('which packages the release carries over', () => {
  it('those whose code ran before and is refused now: a newly vouched provider, or event code', () => {
    for (const contract of ['document-render', 'artwork-source', 'shipping-carrier', 'product-personalizer']) expect(carriedOverByRelease(manifestFor('one', { contract })), contract).toBe(true);
    expect(carriedOverByRelease(manifestFor('one', { events: true }))).toBe(true);
  });

  it('never one that needed a vouched package already, nor one with a stranger’s door, nor one with no imported code', () => {
    for (const contract of ['payment-provider', 'card-terminal']) expect(carriedOverByRelease(manifestFor('one', { contract })), contract).toBe(false);
    for (const door of ['forms', 'chat', 'landing']) {
      const manifest = manifestFor('one', { contract: 'document-render' });
      (manifest.addOn as unknown as Record<string, unknown>)[door] = {};
      expect(carriedOverByRelease(manifest), door).toBe(false);
    }
    expect(carriedOverByRelease(manifestFor('one', {}))).toBe(false);
  });
});

describe.each(META_ENGINES)('the trust carry-over at the first boot of the release — $name', (engine) => {
  let handle: MetaHandle;
  let dataDir: string;
  let store: AddOnStore;
  let manifests: ManifestsRepo;

  /** Staged and installed as an older release left it: a tree, an install row, no trust record. */
  async function installed(key: string, part: Parameters<typeof manifestFor>[1]) {
    const manifest = manifestFor(key, part);
    expect(validateManifest(manifest).ok, key).toBe(true);
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'dist/server.js': 'export function createDocumentRenderer() { return {}; }\n' });
    await store.stage({ key, version: '1.0.0', tarball, expectedIntegrity: sha512Integrity(tarball) });
    const row = await manifests.install({ manifestKey: key, version: '1.0.0', kind: 'add-on', source: 'file', document: manifest });
    return { manifest, row };
  }
  const runtimeOf = async (keys: { manifest: AddOnManifest }[]) =>
    buildAddOnRuntime({ store, installed: keys.map(({ manifest }) => ({ manifest, version: '1.0.0' })), trust: await trustSources(handle.meta, {}), importModule: async () => ({}) });

  beforeEach(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    dataDir = await mkdtemp(join(tmpdir(), 'trust-carry-over-'));
    store = createAddOnStore({ dataDir });
    manifests = manifestsRepo(handle.meta, PLAIN);
  });
  afterEach(async () => {
    if (!engine.available) return;
    await handle.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });

  it.skipIf(!engine.available)('keeps loading what ran before, and refuses a look-alike staged after', async () => {
    const documents = await installed('invoices-like', { contract: 'document-render' });
    const events = await installed('events-like', { events: true });
    const changed = await installed('changed-like', { contract: 'artwork-source' });
    // Its kept copy, packed from its tree.
    const copy = sha512Integrity(Buffer.from('the kept copy of invoices-like'));
    await manifests.setPackageCopy(documents.row.row.id, { fileId: 'file_kept_copy_1', integrity: copy });
    // A tree edited on disk after it was unpacked.
    await writeFile(join(dataDir, 'add-ons', 'changed-like', '1.0.0', 'dist', 'server.js'), 'export const edited = true;\n');

    // Without the carry-over, the update drops them: what the release changed.
    expect((await runtimeOf([documents, events])).problems.map((problem) => problem.reason)).toEqual(['UNTRUSTED_PROVIDER']);

    // The boot begins: what is installed now is what may be carried over.
    const candidates = await trustCarryOverCandidates(handle.meta, manifests);
    expect(candidates).not.toBeNull();
    // A look-alike uploaded by hand after the boot began.
    const lookAlike = await installed('invoices-look-alike', { contract: 'document-render' });

    const carried = await carryOverTrust({ meta: handle.meta, manifests, store }, candidates!);
    expect(carried.sort()).toEqual(['events-like@1.0.0', 'invoices-like@1.0.0']);
    const recorded = await settingsRepo(handle.meta).get('addOns.deciderTrust');
    expect(Object.keys(recorded).sort()).toEqual(['events-like@1.0.0', 'invoices-like@1.0.0']);
    expect((await settingsRepo(handle.meta).get('addOns.keptCopyTrust'))['invoices-like@1.0.0']).toBe(copy);

    const runtime = await runtimeOf([documents, changed, lookAlike]);
    expect(runtime.providers.get('document-render@1')?.map((one) => one.addOnKey)).toEqual(['invoices-like']);
    expect(runtime.problems.map((problem) => [problem.addOnKey, problem.reason]).sort()).toEqual([
      ['changed-like', 'TREE_MODIFIED'],
      ['invoices-look-alike', 'UNTRUSTED_PROVIDER'],
    ]);

    // Once: the next boot carries nothing over, whatever is installed then.
    expect(await settingsRepo(handle.meta).get('addOns.trustCarriedOver')).toBe(true);
    expect(await trustCarryOverCandidates(handle.meta, manifests)).toBeNull();
  });
});
