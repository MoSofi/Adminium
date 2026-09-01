// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two acquisition job kinds (32-add-on-distribution.md D10, 32-T08).
 *
 * These run the handlers through the real registry (so the payload schema, the
 * `internal` flag and the progress contract are all exercised as the worker
 * would exercise them) against a real in-memory meta store, a real store on a
 * temp dir, and a stub catalog client. What is deliberately NOT stubbed is the
 * store: a download's whole point is that the bytes it fetched survive verify
 * and hardened unpack, so the test asserts the package landed on disk.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { gzipSync } from 'fflate';
import { auditRepo, createSqliteMetaDb, firstRun, jobsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Catalog, CatalogClient, CatalogEntry, PinnedRelease } from '../src/add-ons/catalog.js';
import { AddOnCatalogError } from '../src/add-ons/catalog.js';
import { createAddOnStore, sha512Integrity, type AddOnStore } from '../src/add-ons/store.js';
import {
  ADD_ON_DOWNLOAD_KIND,
  CATALOG_REFRESH_KIND,
  downloadDedupeKey,
  enqueueAddOnDownload,
  enqueueCatalogRefresh,
  registerAddOnAcquireHandlers,
} from '../src/jobs/add-on-acquire.js';
import { createJobRegistry, type JobHandlerContext } from '../src/jobs/registry.js';

const BLOCK = 512;

function put(block: Uint8Array, at: number, length: number, value: string): void {
  block.set(Buffer.from(value, 'latin1').subarray(0, length), at);
}

function packageTarball(files: Record<string, string>): Uint8Array {
  const members: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = Buffer.from(content, 'utf8');
    const header = new Uint8Array(BLOCK);
    put(header, 0, 100, `package/${path}`);
    put(header, 100, 8, '0000644\0');
    put(header, 124, 12, `${body.length.toString(8).padStart(11, '0')}\0`);
    put(header, 136, 12, '00000000000\0');
    put(header, 156, 1, '0');
    put(header, 257, 6, 'ustar\0');
    put(header, 263, 2, '00');
    header.set(Buffer.from('        ', 'latin1'), 148);
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += header[i] ?? 0;
    put(header, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
    const padding = (BLOCK - (body.length % BLOCK)) % BLOCK;
    const member = new Uint8Array(BLOCK + body.length + padding);
    member.set(header, 0);
    member.set(body, BLOCK);
    members.push(member);
  }
  const out = new Uint8Array(members.reduce((n, m) => n + m.byteLength, 0) + BLOCK * 2);
  let at = 0;
  for (const member of members) {
    out.set(member, at);
    at += member.byteLength;
  }
  return gzipSync(out);
}

const TARBALL = packageTarball({
  'manifest.json': JSON.stringify({ kind: 'add-on', key: 'design-studio', version: '1.0.0' }),
  'package.json': JSON.stringify({ name: '@adminiumjs/add-on-design-studio' }),
  'dist/client.js': 'export const mount = () => {};',
});
const INTEGRITY = sha512Integrity(TARBALL);

const ENTRY: CatalogEntry = {
  key: 'design-studio',
  npmPackage: '@adminiumjs/add-on-design-studio',
  version: '1.0.0',
  integrity: INTEGRITY,
  provides: [],
  attaches: [{ app: 'printing', range: '^1.0.0' }],
  categories: ['design'],
  capabilities: [],
  connect: { kind: 'none' },
  network: { allow: [] },
  name: { en_US: 'Design Studio' },
  tagline: { en_US: 'A small in-browser artwork editor.' },
};

const CATALOG: Catalog = {
  schemaVersion: 1,
  generatedAt: '2026-08-29T00:00:00Z',
  addOns: [ENTRY],
};

/** A catalog client stub with per-test overrides. */
function stubCatalog(overrides: Partial<CatalogClient> = {}): CatalogClient {
  return {
    isEnabled: async () => true,
    networkFeaturesAllowed: () => true,
    fetchCatalog: async () => CATALOG,
    pinRelease: async (entry): Promise<PinnedRelease> => ({
      key: entry.key,
      npmPackage: entry.npmPackage,
      version: entry.version,
      integrity: entry.integrity,
      tarballUrl: `https://registry.npmjs.org/${entry.npmPackage}/-/x-${entry.version}.tgz`,
    }),
    fetchTarball: async () => TARBALL,
    ...overrides,
  };
}

/** A job context standing in for the worker's, recording progress. */
function context(overrides: Partial<JobHandlerContext> = {}): JobHandlerContext & {
  steps: Array<{ pct: number; step?: string | undefined }>;
} {
  const steps: Array<{ pct: number; step?: string | undefined }> = [];
  return {
    jobId: 'job_test',
    kind: ADD_ON_DOWNLOAD_KIND,
    attempt: 1,
    maxAttempts: 3,
    signal: new AbortController().signal,
    progress: (pct, info) => steps.push({ pct, step: info?.step }),
    log: () => {},
    steps,
    ...overrides,
  } as JobHandlerContext & { steps: typeof steps };
}

let meta: MetaDb;
let dataDir: string;
let store: AddOnStore;

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  dataDir = await mkdtemp(join(tmpdir(), 'adminium-jobs-'));
  store = createAddOnStore({ dataDir });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function registryWith(catalog: CatalogClient) {
  const registry = createJobRegistry();
  registerAddOnAcquireHandlers(registry, { meta, store, catalog });
  return registry;
}

const auditRows = async () => auditRepo(meta).list({ category: 'add-on', limit: 50 });

describe('catalog-refresh', () => {
  it('caches the feed and audits the refresh', async () => {
    const registry = registryWith(stubCatalog());
    const entry = registry.get(CATALOG_REFRESH_KIND);
    const result = await entry!.run({}, context({ kind: CATALOG_REFRESH_KIND }));

    expect(result).toEqual({ refreshed: true, count: 1 });
    const cached = await store.readCatalogCache();
    expect(cached?.document).toEqual(CATALOG);

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['add-on.catalog-refreshed']);
    expect(rows[0]?.changes).toMatchObject({ after: { count: 1 } });
  });

  it('is a no-op — not a failure — when the catalog is off', async () => {
    const fetchCatalog = vi.fn();
    const registry = registryWith(
      stubCatalog({ isEnabled: async () => false, fetchCatalog: fetchCatalog as never }),
    );
    const result = await registry
      .get(CATALOG_REFRESH_KIND)!
      .run({}, context({ kind: CATALOG_REFRESH_KIND }));

    expect(result).toEqual({ refreshed: false, reason: 'disabled' });
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(await store.readCatalogCache()).toBeNull();
    // A skipped tick writes no audit row: nothing happened.
    expect(await auditRows()).toEqual([]);
  });

  it('audits a failed refresh rather than failing silently', async () => {
    const registry = registryWith(
      stubCatalog({
        fetchCatalog: async () => {
          throw new AddOnCatalogError('CATALOG_UNREACHABLE', 'adminium.dev did not answer');
        },
      }),
    );
    await expect(
      registry.get(CATALOG_REFRESH_KIND)!.run({}, context({ kind: CATALOG_REFRESH_KIND })),
    ).rejects.toMatchObject({ reason: 'CATALOG_UNREACHABLE' });

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['add-on.catalog-refresh-failed']);
  });

  it('is registered as an ordinary kind, enqueueable by its route', () => {
    expect(registryWith(stubCatalog()).get(CATALOG_REFRESH_KIND)?.internal).toBe(false);
  });
});

describe('add-on-download', () => {
  beforeEach(async () => {
    await store.writeCatalogCache(CATALOG, 1_700_000_000_000);
  });

  it('is INTERNAL-ONLY, so POST /jobs cannot hand-craft its payload', () => {
    expect(registryWith(stubCatalog()).get(ADD_ON_DOWNLOAD_KIND)?.internal).toBe(true);
  });

  it('pins, downloads, verifies, unpacks and stages the package', async () => {
    const registry = registryWith(stubCatalog());
    const ctx = context();
    const result = await registry
      .get(ADD_ON_DOWNLOAD_KIND)!
      .run({ key: 'design-studio', version: '1.0.0' }, ctx);

    expect(result).toMatchObject({ key: 'design-studio', version: '1.0.0', integrity: INTEGRITY });
    const client = await store.readFile('design-studio', '1.0.0', 'dist/client.js');
    expect(client.toString('utf8')).toBe('export const mount = () => {};');
    // The tree pin was recorded, so 26's install can re-verify it.
    await expect(store.verifyTree('design-studio', '1.0.0')).resolves.toBeDefined();

    expect(ctx.steps.map((s) => s.step)).toEqual([
      'catalog',
      'pin',
      'download',
      'verify',
      'staged',
    ]);
    expect(ctx.steps.at(-1)?.pct).toBe(100);

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['add-on.staged']);
    expect(rows[0]?.changes).toMatchObject({
      after: { key: 'design-studio', version: '1.0.0', source: 'npm' },
    });
  });

  it('refuses a version the cached catalog does not offer', async () => {
    const registry = registryWith(stubCatalog());
    await expect(
      registry.get(ADD_ON_DOWNLOAD_KIND)!.run({ key: 'design-studio', version: '9.9.9' }, context()),
    ).rejects.toMatchObject({ reason: 'UNKNOWN_ADD_ON' });
    expect(await store.keys()).toEqual([]);
  });

  it('refuses before any download when no catalog has been fetched', async () => {
    const fresh = createAddOnStore({ dataDir: await mkdtemp(join(tmpdir(), 'adminium-empty-')) });
    const fetchTarball = vi.fn();
    const registry = createJobRegistry();
    registerAddOnAcquireHandlers(registry, {
      meta,
      store: fresh,
      catalog: stubCatalog({ fetchTarball: fetchTarball as never }),
    });

    await expect(
      registry.get(ADD_ON_DOWNLOAD_KIND)!.run({ key: 'design-studio', version: '1.0.0' }, context()),
    ).rejects.toMatchObject({ reason: 'UNKNOWN_ADD_ON' });
    expect(fetchTarball).not.toHaveBeenCalled();
  });

  it('audits a verify refusal when the registry and the ledger disagree', async () => {
    const registry = registryWith(
      stubCatalog({
        pinRelease: async () => {
          throw new AddOnCatalogError('LEDGER_MISMATCH', 'registry and ledger disagree');
        },
      }),
    );
    await expect(
      registry.get(ADD_ON_DOWNLOAD_KIND)!.run({ key: 'design-studio', version: '1.0.0' }, context()),
    ).rejects.toMatchObject({ reason: 'LEDGER_MISMATCH' });

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['add-on.verify-refused']);
    expect(rows[0]?.changes).toMatchObject({ after: { reason: 'LEDGER_MISMATCH' } });
    expect(await store.keys()).toEqual([]);
  });

  it('audits an unpack refusal when the delivered bytes are not what was pinned', async () => {
    const tampered = packageTarball({ 'manifest.json': '{}', 'dist/client.js': 'PWNED' });
    const registry = registryWith(stubCatalog({ fetchTarball: async () => tampered }));

    await expect(
      registry.get(ADD_ON_DOWNLOAD_KIND)!.run({ key: 'design-studio', version: '1.0.0' }, context()),
    ).rejects.toMatchObject({ reason: 'INTEGRITY_MISMATCH' });

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['add-on.unpack-refused']);
    expect(rows[0]?.changes).toMatchObject({ after: { reason: 'INTEGRITY_MISMATCH' } });
    expect(await store.keys()).toEqual([]);
  });

  it('stops on cancellation without staging anything', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const registry = registryWith(stubCatalog());
    await expect(
      registry
        .get(ADD_ON_DOWNLOAD_KIND)!
        .run({ key: 'design-studio', version: '1.0.0' }, context({ signal: aborted.signal })),
    ).rejects.toThrow(/cancelled/);
    expect(await store.keys()).toEqual([]);
  });

  it("hands the job's cancellation down into the network calls", async () => {
    // Checking `ctx.signal.aborted` BETWEEN steps cannot interrupt an await
    // that is already running, so a cancelled job used to keep a socket open
    // and keep filling memory until the request timeout fired. The signal has
    // to reach the client.
    const seen: Array<AbortSignal | undefined> = [];
    const registry = registryWith(
      stubCatalog({
        pinRelease: async (entry, signal) => {
          seen.push(signal);
          return {
            key: entry.key,
            npmPackage: entry.npmPackage,
            version: entry.version,
            integrity: entry.integrity,
            tarballUrl: `https://registry.npmjs.org/x/-/x-${entry.version}.tgz`,
          };
        },
        fetchTarball: async (_pinned, signal) => {
          seen.push(signal);
          return TARBALL;
        },
      }),
    );

    const ctx = context();
    await registry.get(ADD_ON_DOWNLOAD_KIND)!.run({ key: 'design-studio', version: '1.0.0' }, ctx);
    expect(seen).toHaveLength(2);
    for (const signal of seen) expect(signal).toBe(ctx.signal);
  });

  it('audits a transport failure on the tarball leg', async () => {
    const registry = registryWith(
      stubCatalog({
        fetchTarball: async () => {
          throw new AddOnCatalogError('REDIRECTED', 'the registry tried to bounce us');
        },
      }),
    );
    await expect(
      registry.get(ADD_ON_DOWNLOAD_KIND)!.run({ key: 'design-studio', version: '1.0.0' }, context()),
    ).rejects.toMatchObject({ reason: 'REDIRECTED' });

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(['add-on.download-failed']);
    expect(rows[0]?.changes).toMatchObject({ after: { reason: 'REDIRECTED' } });
  });

  it('refuses a payload whose key is not a legal add-on key', () => {
    const registry = registryWith(stubCatalog());
    const schema = registry.get(ADD_ON_DOWNLOAD_KIND)!.schema;
    expect(schema.safeParse({ key: '../etc', version: '1.0.0' }).success).toBe(false);
    expect(schema.safeParse({ key: 'design-studio', version: '1.0.0' }).success).toBe(true);
  });
});

describe('enqueue idempotency (D10)', () => {
  it('returns the same job for a second download of the same key@version', async () => {
    const first = await enqueueAddOnDownload(meta, { key: 'design-studio', version: '1.0.0' });
    const second = await enqueueAddOnDownload(meta, { key: 'design-studio', version: '1.0.0' });
    expect(second.id).toBe(first.id);
    expect(first.dedupeKey).toBe(downloadDedupeKey('design-studio', '1.0.0'));
  });

  it('treats a different version as a different download', async () => {
    const first = await enqueueAddOnDownload(meta, { key: 'design-studio', version: '1.0.0' });
    const second = await enqueueAddOnDownload(meta, { key: 'design-studio', version: '1.0.1' });
    expect(second.id).not.toBe(first.id);
  });

  it('keeps one catalog refresh in flight at a time', async () => {
    const first = await enqueueCatalogRefresh(meta);
    const second = await enqueueCatalogRefresh(meta, { userId: 'usr_1' });
    expect(second.id).toBe(first.id);
  });

  it('enqueues the download through the repo, not through POST /jobs', async () => {
    const job = await enqueueAddOnDownload(meta, {
      key: 'design-studio',
      version: '1.0.0',
      userId: 'usr_1',
    });
    const stored = await jobsRepo(meta).findById(job.id);
    expect(stored?.kind).toBe(ADD_ON_DOWNLOAD_KIND);
    expect(stored?.payload).toMatchObject({ key: 'design-studio', userId: 'usr_1' });
  });
});
