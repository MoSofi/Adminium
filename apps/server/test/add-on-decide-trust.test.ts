// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's deciding code is loaded only from bytes somebody vouches for,
 * and it is compiled, never imported. What is vouched for: the packages this
 * build bundles, the ones recorded when the seed staged them or the catalogue
 * verified them, and (outside production) a developer's own.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addOnManifestSchema, type AddOnManifest } from '@adminium/manifest';
import { MANIFEST_STATUSES, createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BUNDLED_PINS } from '../src/add-ons/bundled-pins.js';
import { callDecider, type TrustSources } from '../src/add-ons/decide.js';
import { recordDeciderTrust, trustSources } from '../src/add-ons/decider-trust.js';
import { buildAddOnRuntime, deciderFor } from '../src/add-ons/runtime.js';
import { createAddOnStore, seedBundledPackages, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';

const ROWS = 'module.exports = { rows: function (input) { return { rows: [], asked: input.asked }; } };';
const BOTH = 'module.exports = { rows: function () { return { rows: [] }; }, adjust: function () { return { applied: [] }; } };';
const ADJUST = 'module.exports = { adjust: function () { return {}; } };';

function manifestFor(key: string, provides: { contract: string; version: number; server: string }[]): AddOnManifest {
  return addOnManifestSchema.parse({
    kind: 'add-on',
    manifestVersion: 1,
    key,
    name: key,
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: `addon.${key}.line`, fallback: 'x' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, provides },
  });
}

let dataDir: string;
let store: AddOnStore;
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'add-on-decide-'));
  store = createAddOnStore({ dataDir });
});
afterEach(async () => rm(dataDir, { recursive: true, force: true }));

/** Stages a package; answers its manifest and the hash of its tarball. */
async function stage(key: string, files: Record<string, string>, provides: { contract: string; version: number; server: string }[]) {
  const manifest = manifestFor(key, provides);
  const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), ...files });
  const integrity = sha512Integrity(tarball);
  await store.stage({ key, version: '1.0.0', tarball, expectedIntegrity: integrity });
  return { manifest, integrity, installed: [{ manifest, version: '1.0.0' }] };
}
const NOBODY: TrustSources = { bundled: [], recorded: {} };
const POSTS = [{ contract: 'posting-rows', version: 1, server: 'dist/server.js' }];

describe('the packages this build bundles', () => {
  it('are the release\'s own list, entry for entry', async () => {
    const bundle = JSON.parse(await readFile(join(import.meta.dirname, '..', '..', '..', 'scripts', 'release', 'add-ons-bundle.json'), 'utf8')) as { addOns: unknown[] };
    expect(BUNDLED_PINS).toEqual(bundle.addOns);
    expect(BUNDLED_PINS.length).toBeGreaterThan(0);
  });
});

describe('an add-on\'s deciding file, at load', () => {
  it('is compiled and never imported when its package is vouched for', async () => {
    const { installed, integrity } = await stage('kit', { 'dist/server.js': ROWS }, POSTS);
    const imported: string[] = [];
    const runtime = await buildAddOnRuntime({
      store,
      installed,
      trust: { ...NOBODY, recorded: { 'kit@1.0.0': integrity } },
      importModule: async (path) => {
        imported.push(path);
        return {};
      },
    });
    expect(runtime.problems).toEqual([]);
    expect(imported).toEqual([]);
    // Not a provider module either: nothing may call it but the decider's own door.
    expect(runtime.providers.get('posting-rows@1')).toBeUndefined();
    const decider = deciderFor(runtime, 'kit', 'rows');
    expect(decider).toMatchObject({ key: 'kit', version: '1.0.0', kinds: ['rows'] });
    expect(callDecider('rows', decider!, { asked: 7 })).toEqual({ rows: [], asked: 7 });
    expect(deciderFor(runtime, 'kit', 'adjust')).toBeNull();
    expect(deciderFor(runtime, 'other', 'rows')).toBeNull();
    expect(deciderFor(null, 'kit', 'rows')).toBeNull();
  });

  it.each([
    ['nobody vouches for it', NOBODY],
    ['another version is recorded', { ...NOBODY, recorded: { 'kit@1.0.1': 'x' } }],
    ['other bytes are recorded for it', { ...NOBODY, recorded: { 'kit@1.0.0': 'sha512-other' } }],
    ['it is on a developer\'s list, in production', { ...NOBODY, devKeys: 'kit', nodeEnv: 'production' }],
  ] as const)('is left out, by name, when %s', async (_name, trust) => {
    const { installed } = await stage('kit', { 'dist/server.js': ROWS }, POSTS);
    const runtime = await buildAddOnRuntime({ store, installed, trust });
    expect(runtime.problems).toMatchObject([{ addOnKey: 'kit', reason: 'UNTRUSTED_DECIDER', contract: 'posting-rows@1' }]);
    expect(runtime.problems[0]!.message).toContain('that code was not loaded');
    expect(deciderFor(runtime, 'kit', 'rows')).toBeNull();
  });

  it('is left out when the runtime is told of nobody at all', async () => {
    const { installed } = await stage('kit', { 'dist/server.js': ROWS }, POSTS);
    const runtime = await buildAddOnRuntime({ store, installed });
    expect(runtime.problems.map((problem) => problem.reason)).toEqual(['UNTRUSTED_DECIDER']);
  });

  it('loads on a developer\'s say outside production, whatever its bytes', async () => {
    const { installed } = await stage('kit', { 'dist/server.js': ROWS }, POSTS);
    const runtime = await buildAddOnRuntime({ store, installed, trust: { ...NOBODY, devKeys: 'kit', nodeEnv: 'test' } });
    expect(runtime.problems).toEqual([]);
    expect(deciderFor(runtime, 'kit', 'rows')).not.toBeNull();
  });

  it('is compiled once when one file answers both questions', async () => {
    const { installed } = await stage('kit', { 'dist/server.js': BOTH }, [...POSTS, { contract: 'price-adjust', version: 1, server: 'dist/server.js' }]);
    const runtime = await buildAddOnRuntime({ store, installed, trust: { ...NOBODY, devKeys: 'kit' } });
    expect(runtime.problems).toEqual([]);
    expect(runtime.deciders.get('kit')).toHaveLength(1);
    expect(deciderFor(runtime, 'kit', 'rows')).toBe(deciderFor(runtime, 'kit', 'adjust'));
  });

  it('keeps two files apart when an add-on ships one for each question', async () => {
    const { installed } = await stage('kit', { 'dist/server.js': ROWS, 'dist/adjust.js': ADJUST }, [...POSTS, { contract: 'price-adjust', version: 1, server: 'dist/adjust.js' }]);
    const runtime = await buildAddOnRuntime({ store, installed, trust: { ...NOBODY, devKeys: 'kit' } });
    expect(runtime.problems).toEqual([]);
    expect(runtime.deciders.get('kit')).toHaveLength(2);
    expect(deciderFor(runtime, 'kit', 'rows')!.kinds).toEqual(['rows']);
    expect(deciderFor(runtime, 'kit', 'adjust')!.kinds).toEqual(['adjust']);
  });

  it('is a load problem when the file does not answer the question its contract asks', async () => {
    const { installed } = await stage('kit', { 'dist/server.js': ADJUST }, POSTS);
    const runtime = await buildAddOnRuntime({ store, installed, trust: { ...NOBODY, devKeys: 'kit' } });
    expect(runtime.problems).toMatchObject([{ addOnKey: 'kit', reason: 'IMPORT_FAILED' }]);
    expect(runtime.problems[0]!.message).toContain('exports no "rows"');
    expect(deciderFor(runtime, 'kit', 'rows')).toBeNull();
  });

  it('is not loaded once its bytes on disk are not the ones that were installed', async () => {
    const { installed } = await stage('kit', { 'dist/server.js': ROWS }, POSTS);
    await writeFile(join(store.dirFor('kit', '1.0.0'), 'dist', 'server.js'), `${ROWS}\n// edited`);
    const runtime = await buildAddOnRuntime({ store, installed, trust: { ...NOBODY, devKeys: 'kit' } });
    expect(runtime.problems).toMatchObject([{ addOnKey: 'kit', reason: 'TREE_MODIFIED' }]);
    expect(deciderFor(runtime, 'kit', 'rows')).toBeNull();
  });

  it('leaves every other add-on\'s server code loading as it always did', async () => {
    const { installed } = await stage('plain', { 'dist/server.js': 'export const render = 1;' }, [{ contract: 'document-render', version: 1, server: 'dist/server.js' }]);
    const imported: string[] = [];
    const runtime = await buildAddOnRuntime({ store, installed, importModule: async (path) => (imported.push(path), { render: 1 }) });
    expect(runtime.problems).toEqual([]);
    expect(imported).toHaveLength(1);
    expect(runtime.deciders.size).toBe(0);
  });
});

describe('what vouches for a package, as this server keeps it', () => {
  let meta: MetaDb;
  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
  });
  afterEach(async () => meta.db.destroy());

  it('starts with the build\'s own bundle and nothing recorded', async () => {
    const sources = await trustSources(meta, {});
    expect(sources.bundled).toBe(BUNDLED_PINS);
    expect(sources.recorded).toEqual({});
    expect(sources.devKeys).toBeUndefined();
  });

  it('remembers a package that was vouched for, by key and version', async () => {
    const one = { key: 'kit', version: '1.0.0', integrity: `sha512-${'A'.repeat(86)}==` };
    const two = { key: 'other-kit', version: '2.1.0-rc.1', integrity: `sha512-${'B'.repeat(86)}==` };
    await recordDeciderTrust(meta, one);
    await recordDeciderTrust(meta, two);
    await recordDeciderTrust(meta, one);
    expect(await settingsRepo(meta).get('addOns.deciderTrust')).toEqual({ 'kit@1.0.0': one.integrity, 'other-kit@2.1.0-rc.1': two.integrity });
    const sources = await trustSources(meta, { ADMINIUM_ADD_ON_DEV_TRUST: 'dev-kit', NODE_ENV: 'development' });
    expect(sources.recorded['kit@1.0.0']).toBe(one.integrity);
    expect(sources.devKeys).toBe('dev-kit');
    expect(sources.nodeEnv).toBe('development');
  });

  it('the bundled seed tells of each package it stages, with the hash of its tarball', async () => {
    const bundleDir = await mkdtemp(join(tmpdir(), 'add-on-bundle-'));
    try {
      const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifestFor('kit', POSTS)), 'dist/server.js': ROWS });
      await writeFile(join(bundleDir, 'kit-1.0.0.tgz'), tarball);
      await writeFile(join(bundleDir, 'kit-1.0.0.tgz.integrity'), sha512Integrity(tarball));
      const seen: unknown[] = [];
      const first = await seedBundledPackages(store, bundleDir, () => undefined, 'add-on', async (pkg) => void seen.push(pkg));
      expect(first.seeded).toEqual(['kit@1.0.0']);
      expect(seen).toEqual([{ key: 'kit', version: '1.0.0', integrity: sha512Integrity(tarball) }]);
      await recordDeciderTrust(meta, seen[0] as { key: string; version: string; integrity: string });
      const runtime = await buildAddOnRuntime({ store, installed: [{ manifest: manifestFor('kit', POSTS), version: '1.0.0' }], trust: await trustSources(meta, {}) });
      expect(runtime.problems).toEqual([]);
      expect(deciderFor(runtime, 'kit', 'rows')).not.toBeNull();
      // A failure to record is said, and the seed goes on.
      await store.removeKey('kit');
      const lines: string[] = [];
      const again = await seedBundledPackages(store, bundleDir, (message) => lines.push(message), 'add-on', async () => Promise.reject(new Error('no meta')));
      expect(again.seeded).toEqual(['kit@1.0.0']);
      expect(lines).toEqual(['bundled add-on was seeded, but could not be recorded as trusted']);
    } finally {
      await rm(bundleDir, { recursive: true, force: true });
    }
  });

  it('an add-on that is being changed has a status of its own', () => {
    expect(MANIFEST_STATUSES).toContain('updating');
  });
});
