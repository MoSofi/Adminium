// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The provider registry and the module loader (26-T09, §5.2, D4).
 *
 * This is the module that runs other people's code, so the tests that matter
 * are the ones about WHAT gets loaded and WHEN loading is refused — not the
 * happy-path map. O1 was ratified in-process, which makes the loading
 * discipline the whole of the control: only the installed bundle, only a path
 * the manifest declares, only after the bytes are re-checked against the pin
 * recorded at unpack.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gzipSync } from 'fflate';
import { addOnManifestSchema, type AddOnManifest } from '@adminium/manifest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAddOnRuntime,
  importServerHalf,
  resolveProvider,
  type InstalledAddOn,
} from '../src/add-ons/runtime.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';

const BLOCK = 512;

function put(b: Uint8Array, at: number, len: number, v: string): void {
  b.set(Buffer.from(v, 'latin1').subarray(0, len), at);
}

function packageTarball(files: Record<string, string>): Uint8Array {
  const members: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.from(content, 'utf8');
    const h = new Uint8Array(BLOCK);
    put(h, 0, 100, `package/${path}`);
    put(h, 100, 8, '0000644\0');
    put(h, 124, 12, `${body.length.toString(8).padStart(11, '0')}\0`);
    put(h, 136, 12, '00000000000\0');
    put(h, 156, 1, '0');
    put(h, 257, 6, 'ustar\0');
    put(h, 263, 2, '00');
    h.set(Buffer.from('        ', 'latin1'), 148);
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += h[i] ?? 0;
    put(h, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
    const pad = (BLOCK - (body.length % BLOCK)) % BLOCK;
    const m = new Uint8Array(BLOCK + body.length + pad);
    m.set(h, 0);
    m.set(body, BLOCK);
    members.push(m);
  }
  const out = new Uint8Array(members.reduce((n, m) => n + m.byteLength, 0) + BLOCK * 2);
  let at = 0;
  for (const m of members) {
    out.set(m, at);
    at += m.byteLength;
  }
  return gzipSync(out);
}

/** A valid add-on manifest with the slots/provides these tests vary. */
function manifestFor(
  key: string,
  over: {
    slots?: Array<{ slot: string; client: string; order?: number }>;
    provides?: Array<{ contract: string; version: number; server: string }>;
  } = {},
): AddOnManifest {
  const parsed = addOnManifestSchema.safeParse({
    kind: 'add-on',
    manifestVersion: 1,
    key,
    name: key,
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: `addon.${key}.line`, fallback: 'x' },
    categories: ['delivery'],
    compatibility: { minAdminiumVersion: '1.0.0', requires: [] },
    addOn: {
      attaches: [{ app: 'printing', range: '^1.0.0' }],
      provides: over.provides ?? [],
      consumes: [],
      slots: over.slots ?? [{ slot: 'settings.add-on.panel', client: 'dist/client.js', order: 10 }],
      events: [],
      connect: { kind: 'none' },
      scopes: [],
    },
  });
  if (!parsed.success) throw new Error(`bad fixture: ${parsed.error.message}`);
  return parsed.data;
}

let dataDir: string;
let store: AddOnStore;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'add-on-runtime-'));
  store = createAddOnStore({ dataDir });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

/** Stages a package with a real server half on disk. */
async function stage(key: string, serverSource = 'export const book = () => "ok";'): Promise<void> {
  const tarball = packageTarball({
    'manifest.json': JSON.stringify({ key }),
    'package.json': '{}',
    'dist/client.js': 'export const register = () => {};',
    'dist/server.js': serverSource,
  });
  await store.stage({
    key,
    version: '1.0.0',
    tarball,
    expectedIntegrity: sha512Integrity(tarball),
  });
}

const installed = (manifest: AddOnManifest): InstalledAddOn => ({ manifest, version: '1.0.0' });

/** A stub importer, so these tests never actually execute add-on code. */
function stubImport(seen: string[]) {
  return async (path: string): Promise<unknown> => {
    seen.push(path);
    return { loadedFrom: path };
  };
}

describe('26-T09: loading a server half (D4)', () => {
  it('loads only from the installed package on local disk', async () => {
    await stage('shipping-dhl');
    const seen: string[] = [];
    const state = await buildAddOnRuntime({
      store,
      installed: [
        installed(
          manifestFor('shipping-dhl', {
            provides: [{ contract: 'shipping-carrier', version: 1, server: 'dist/server.js' }],
          }),
        ),
      ],
      importModule: stubImport(seen),
    });

    expect(state.problems).toEqual([]);
    expect(seen).toHaveLength(1);
    // The path is under the store root and nowhere else — D4 verbatim.
    expect(seen[0]).toBe(join(dataDir, 'add-ons', 'shipping-dhl', '1.0.0', 'dist/server.js'));
    expect(resolveProvider(state, 'shipping-carrier', 1)?.addOnKey).toBe('shipping-dhl');
  });

  it('REFUSES to import a server half edited on disk after install', async () => {
    // The check that decides whether code the process is about to EXECUTE is
    // the code that was installed. More consequential than the serve-time one:
    // that protects a browser, this protects the server.
    await stage('shipping-dhl');
    await writeFile(
      join(store.dirFor('shipping-dhl', '1.0.0'), 'dist', 'server.js'),
      'globalThis.pwned = true;',
    );

    const seen: string[] = [];
    const state = await buildAddOnRuntime({
      store,
      installed: [
        installed(
          manifestFor('shipping-dhl', {
            provides: [{ contract: 'shipping-carrier', version: 1, server: 'dist/server.js' }],
          }),
        ),
      ],
      importModule: stubImport(seen),
    });

    // Never imported at all — the refusal is before the import, not after.
    expect(seen).toEqual([]);
    expect(state.problems).toEqual([
      expect.objectContaining({ addOnKey: 'shipping-dhl', reason: 'TREE_MODIFIED' }),
    ]);
    expect(resolveProvider(state, 'shipping-carrier', 1)).toBeNull();
  });

  it('refuses a path the package does not actually contain', async () => {
    await stage('shipping-dhl');
    const state = await buildAddOnRuntime({
      store,
      installed: [
        installed(
          manifestFor('shipping-dhl', {
            provides: [{ contract: 'shipping-carrier', version: 1, server: 'dist/absent.js' }],
          }),
        ),
      ],
      importModule: stubImport([]),
    });
    expect(state.problems[0]?.reason).toBe('TREE_MODIFIED');
  });

  it('contains a failure to one add-on rather than failing the whole build', async () => {
    // A boot that dies because one bundle is corrupt takes the instance with
    // it, which is far worse than one missing integration.
    await stage('shipping-dhl');
    await stage('import-canva');
    await writeFile(
      join(store.dirFor('shipping-dhl', '1.0.0'), 'dist', 'server.js'),
      'broken',
    );

    const state = await buildAddOnRuntime({
      store,
      installed: [
        installed(
          manifestFor('shipping-dhl', {
            provides: [{ contract: 'shipping-carrier', version: 1, server: 'dist/server.js' }],
          }),
        ),
        installed(
          manifestFor('import-canva', {
            provides: [{ contract: 'artwork-source', version: 1, server: 'dist/server.js' }],
          }),
        ),
      ],
      importModule: stubImport([]),
    });

    expect(state.problems).toHaveLength(1);
    expect(state.problems[0]?.addOnKey).toBe('shipping-dhl');
    // The healthy one still loaded.
    expect(resolveProvider(state, 'artwork-source', 1)?.addOnKey).toBe('import-canva');
  });

  it('records an import that throws, without letting it escape', async () => {
    await stage('shipping-dhl');
    const state = await buildAddOnRuntime({
      store,
      installed: [
        installed(
          manifestFor('shipping-dhl', {
            provides: [{ contract: 'shipping-carrier', version: 1, server: 'dist/server.js' }],
          }),
        ),
      ],
      importModule: async () => {
        throw new Error('SyntaxError: unexpected token');
      },
    });
    expect(state.problems[0]).toMatchObject({ reason: 'IMPORT_FAILED' });
    expect(state.problems[0]?.message).toContain('SyntaxError');
  });

  it('importServerHalf verifies before it imports, in that order', async () => {
    await stage('shipping-dhl');
    const order: string[] = [];
    const spy = vi.spyOn(store, 'readVerifiedFile');
    spy.mockImplementation(async (...args) => {
      order.push('verify');
      return { bytes: Buffer.from('x'), sha256: 'x' };
    });
    await importServerHalf(store, 'shipping-dhl', '1.0.0', 'dist/server.js', async (p) => {
      order.push('import');
      return { p };
    });
    expect(order).toEqual(['verify', 'import']);
    spy.mockRestore();
  });
});

describe('26-T09: the provider registry (§5.2)', () => {
  it('allows two add-ons to implement one contract, and picks deterministically', async () => {
    // `artwork-source@1` already has two implementations in the shipped set, so
    // this is the normal case rather than a conflict.
    await stage('import-canva');
    await stage('design-studio');
    const state = await buildAddOnRuntime({
      store,
      installed: [
        installed(
          manifestFor('import-canva', {
            provides: [{ contract: 'artwork-source', version: 1, server: 'dist/server.js' }],
          }),
        ),
        installed(
          manifestFor('design-studio', {
            provides: [{ contract: 'artwork-source', version: 1, server: 'dist/server.js' }],
          }),
        ),
      ],
      importModule: stubImport([]),
    });

    expect(state.problems).toEqual([]);
    expect(state.providers.get('artwork-source@1')).toHaveLength(2);
    // Lowest key, so two instances of the same deployment agree.
    expect(resolveProvider(state, 'artwork-source', 1)?.addOnKey).toBe('design-studio');
  });

  it('reports a contract this build does not know instead of crashing', async () => {
    // Reachable after an Adminium upgrade that moved the contract registry
    // under an already-installed add-on. Degrade, never crash.
    await stage('shipping-dhl');
    const manifest = manifestFor('shipping-dhl');
    // Bypass the schema deliberately — this state cannot be authored, only
    // arrived at.
    (manifest.addOn as { provides: unknown[] }).provides = [
      { contract: 'shipping-carrier', version: 99, server: 'dist/server.js' },
    ];
    const state = await buildAddOnRuntime({
      store,
      installed: [installed(manifest)],
      importModule: stubImport([]),
    });
    expect(state.problems[0]).toMatchObject({ reason: 'CONTRACT_UNKNOWN' });
    expect(state.providers.size).toBe(0);
  });

  it('returns null for a contract nobody provides', async () => {
    const state = await buildAddOnRuntime({ store, installed: [], importModule: stubImport([]) });
    expect(resolveProvider(state, 'shipping-carrier', 1)).toBeNull();
  });
});

describe('26-T09: slot fills and SLOT_CONFLICT', () => {
  it('renders every fill of a multi slot, ordered stably', async () => {
    await stage('a-thing');
    await stage('b-thing');
    const state = await buildAddOnRuntime({
      store,
      installed: [
        installed(
          manifestFor('b-thing', {
            slots: [{ slot: 'artwork.sources', client: 'dist/client.js', order: 10 }],
          }),
        ),
        installed(
          manifestFor('a-thing', {
            slots: [{ slot: 'artwork.sources', client: 'dist/client.js', order: 10 }],
          }),
        ),
      ],
      importModule: stubImport([]),
    });

    // Same `order`, so the tie breaks on key — NOT on install sequence, which
    // differs between two instances of one deployment.
    expect(state.slots.get('artwork.sources')?.map((f) => f.addOnKey)).toEqual([
      'a-thing',
      'b-thing',
    ]);
    expect(state.conflicts).toEqual([]);
  });

  it('orders a multi slot by `order` before key', async () => {
    await stage('a-thing');
    await stage('b-thing');
    const state = await buildAddOnRuntime({
      store,
      installed: [
        installed(
          manifestFor('a-thing', {
            slots: [{ slot: 'artwork.sources', client: 'dist/client.js', order: 50 }],
          }),
        ),
        installed(
          manifestFor('b-thing', {
            slots: [{ slot: 'artwork.sources', client: 'dist/client.js', order: 10 }],
          }),
        ),
      ],
      importModule: stubImport([]),
    });
    expect(state.slots.get('artwork.sources')?.map((f) => f.addOnKey)).toEqual([
      'b-thing',
      'a-thing',
    ]);
  });

  it('records SLOT_CONFLICT by name when a single slot is claimed twice', async () => {
    // `order.dispatch.panel` is one of the two `single` slots in the registry;
    // `order.dispatch.panel` is `multi` and would render both.
    // Never a silent override: an operator looking at a slot filled by an
    // add-on they did not expect must be able to find out why.
    await stage('a-thing');
    await stage('b-thing');
    const state = await buildAddOnRuntime({
      store,
      installed: [
        installed(
          manifestFor('a-thing', {
            slots: [{ slot: 'order.dispatch.panel', client: 'dist/client.js', order: 50 }],
          }),
        ),
        installed(
          manifestFor('b-thing', {
            slots: [{ slot: 'order.dispatch.panel', client: 'dist/client.js', order: 10 }],
          }),
        ),
      ],
      importModule: stubImport([]),
    });

    expect(state.slots.get('order.dispatch.panel')?.map((f) => f.addOnKey)).toEqual([
      'b-thing',
    ]);
    expect(state.conflicts).toEqual([
      { slot: 'order.dispatch.panel', winner: 'b-thing', loser: 'a-thing' },
    ]);
  });

  it('does not report a conflict when a single slot has one claimant', async () => {
    await stage('a-thing');
    const state = await buildAddOnRuntime({
      store,
      installed: [
        installed(
          manifestFor('a-thing', {
            slots: [{ slot: 'order.dispatch.panel', client: 'dist/client.js', order: 10 }],
          }),
        ),
      ],
      importModule: stubImport([]),
    });
    expect(state.conflicts).toEqual([]);
    expect(state.slots.get('order.dispatch.panel')).toHaveLength(1);
  });
});
