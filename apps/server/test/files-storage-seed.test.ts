// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-boot storage-destination seed.
 *
 * The behaviours that matter are the ones the `ADMINIUM_SOURCE_URL` seed
 * learned the hard way: it runs ONCE, it never overrides what somebody
 * configured, a bad value warns instead of stopping the boot, and it says out
 * loud what it did. The Fly/Tigris fallback is here for a fifth reason — `fly
 * storage create` writes those five variables and tells the user they are
 * finished, so reading them is the difference between zero-config and a
 * support thread.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, destinationsRepo, firstRun, type MetaDb } from '@adminium/meta';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { seedStorageDestination, type StorageSeedEnv } from '../src/config/storage-seed.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { storageCryptoFromSecret } from '../src/files/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { TEST_STORAGE_CRYPTO } from './helpers/file-store.js';

let meta: MetaDb;
let logs: string[];
let warnings: string[];

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  logs = [];
  warnings = [];
});

const seed = (env: StorageSeedEnv) =>
  seedStorageDestination({
    meta,
    crypto: TEST_STORAGE_CRYPTO,
    env,
    log: (m) => logs.push(m),
    warn: (m) => warnings.push(m),
    now: 1_750_000_000_000,
  });

const repo = () => destinationsRepo(meta, TEST_STORAGE_CRYPTO);

describe('ADMINIUM_STORAGE_URL', () => {
  it('seeds an s3 destination and makes it the default', async () => {
    const result = await seed({
      ADMINIUM_STORAGE_URL:
        's3://acme-files/invoices?endpoint=https://nyc3.digitaloceanspaces.com&region=nyc3&accessKey=AKIAEXAMPLE&secretKey=super-secret&publicBaseUrl=https://cdn.acme.io',
    });

    expect(result.kind).toBe('seeded');
    const stored = await repo().findDefault();
    expect(stored?.name).toBe('acme-files');
    expect(stored?.driver).toBe('s3');
    expect(stored?.config).toEqual({
      endpoint: 'https://nyc3.digitaloceanspaces.com',
      region: 'nyc3',
      bucket: 'acme-files',
      prefix: 'invoices',
      // A custom endpoint defaults to path-style — self-hosted targets are the
      // common case there — and Spaces accepts both.
      forcePathStyle: true,
      publicBaseUrl: 'https://cdn.acme.io',
    });
    expect(stored?.hasSecret).toBe(true);
    expect(await repo().getSecret(stored?.id ?? '')).toBe('{"accessKeyId":"AKIAEXAMPLE","secretAccessKey":"super-secret"}');

    // Says what it did, and never the credential.
    expect(logs.join('\n')).toContain('storage destination seeded from ADMINIUM_STORAGE_URL: acme-files');
    expect(logs.join('\n')).not.toContain('super-secret');
  });

  it('defaults an endpoint-less s3 URL to AWS, virtual-host style', async () => {
    await seed({ ADMINIUM_STORAGE_URL: 's3://acme-files?region=eu-west-1&accessKey=AK&secretKey=SK' });
    const stored = await repo().findDefault();
    expect(stored?.config).toEqual({ region: 'eu-west-1', bucket: 'acme-files', forcePathStyle: false });
  });

  it('defaults a custom endpoint’s region to auto — what R2 and Tigris want', async () => {
    await seed({ ADMINIUM_STORAGE_URL: 's3://b?endpoint=https://x.r2.cloudflarestorage.com&accessKey=AK&secretKey=SK' });
    expect((await repo().findDefault())?.config).toMatchObject({ region: 'auto' });
  });

  it('honours an explicit pathStyle either way', async () => {
    await seed({ ADMINIUM_STORAGE_URL: 's3://b?endpoint=https://x.example.com&accessKey=AK&secretKey=SK&pathStyle=0' });
    expect((await repo().findDefault())?.config).toMatchObject({ forcePathStyle: false });
  });

  it('seeds a webdav destination with its credential', async () => {
    await seed({ ADMINIUM_STORAGE_URL: 'webdavs://ava:hunter2@nas.example.com/remote.php/dav/files/ava' });
    const stored = await repo().findDefault();
    expect(stored?.driver).toBe('webdav');
    expect(stored?.name).toBe('nas.example.com');
    // `webdavs://` is the transport; the stored config is what the driver dials.
    expect(stored?.config).toEqual({ url: 'https://nas.example.com/remote.php/dav/files/ava' });
    expect(await repo().getSecret(stored?.id ?? '')).toBe('{"username":"ava","password":"hunter2"}');
  });

  it('allows an anonymous webdav share', async () => {
    await seed({ ADMINIUM_STORAGE_URL: 'webdav://nas.local/public' });
    const stored = await repo().findDefault();
    expect(stored?.config).toEqual({ url: 'http://nas.local/public' });
    expect(stored?.hasSecret).toBe(false);
  });

  it('seeds a local directory that is not the default one', async () => {
    await seed({ ADMINIUM_STORAGE_URL: 'file:///srv/adminium/files' });
    const stored = await repo().findDefault();
    expect(stored?.driver).toBe('local');
    expect(stored?.name).toBe('files');
    expect(stored?.config).toEqual({ root: '/srv/adminium/files' });
  });

  it('warns and lets the boot continue on a value it cannot use', async () => {
    for (const [value, expected] of [
      ['not-a-url', 'it is not a URL'],
      ['postgres://x/y', 'not one Adminium stores files with'],
      ['s3://bucket?accessKey=AK', 'the secret key is required'],
      ['s3://?accessKey=AK&secretKey=SK', 'the bucket name is missing'],
      ['file://relative/path', 'an absolute path is required'],
    ] as const) {
      warnings = [];
      const result = await seed({ ADMINIUM_STORAGE_URL: value });
      expect(result.kind, value).toBe('refused');
      expect(warnings.join('\n'), value).toContain(expected);
    }
    // Nothing was stored by any of them.
    expect(await repo().isEmpty()).toBe(true);
  });
});

describe('the once-only gate', () => {
  it('changes nothing on a second boot', async () => {
    const url = 's3://acme-files?endpoint=https://x.example.com&accessKey=AK&secretKey=SK';
    const first = await seed({ ADMINIUM_STORAGE_URL: url });
    expect(first.kind).toBe('seeded');

    logs = [];
    const second = await seed({ ADMINIUM_STORAGE_URL: url });
    expect(second.kind).toBe('skipped');
    // The CHANNEL is the assertion, not just the text. `composeServer` routes
    // `log` to debug, and on desktop and every embedder that is the only call
    // site — so on `log` this line is invisible exactly where it is the only
    // explanation for "I set the variable and nothing happened".
    expect(warnings.join('\n')).toContain('already has a storage destination');
    expect(logs.join('\n')).not.toContain('already has a storage destination');
    expect(await repo().list()).toHaveLength(1);
  });

  it('never overrides a destination somebody configured in Studio', async () => {
    // ANY row means storage is configured — not just a default. A seed that
    // added a second one would be exactly the surprise the source seed's
    // fourth answer rules out.
    await repo().create({ name: 'Mine', driver: 'local', config: { root: '/srv/mine' } });

    const result = await seed({ ADMINIUM_STORAGE_URL: 's3://other?endpoint=https://x.example.com&accessKey=AK&secretKey=SK' });
    expect(result.kind).toBe('skipped');
    expect((await repo().list()).map((d) => d.name)).toEqual(['Mine']);
  });

  it('does nothing at all when nothing is configured', async () => {
    const result = await seed({});
    expect(result).toEqual({ kind: 'skipped', reason: 'nothing-configured' });
    expect(logs).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe('the AWS quartet (Fly + Tigris, zero-config)', () => {
  const FLY: StorageSeedEnv = {
    AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
    AWS_REGION: 'auto',
    BUCKET_NAME: 'adminium-prod',
    AWS_ACCESS_KEY_ID: 'tid_example',
    AWS_SECRET_ACCESS_KEY: 'tsec_example',
  };

  it('seeds from exactly what `fly storage create` writes', async () => {
    const result = await seed(FLY);
    expect(result.kind).toBe('seeded');
    const stored = await repo().findDefault();
    expect(stored?.name).toBe('adminium-prod');
    expect(stored?.config).toEqual({
      endpoint: 'https://fly.storage.tigris.dev',
      region: 'auto',
      bucket: 'adminium-prod',
      // Tigris and R2 both issue per-bucket hostnames.
      forcePathStyle: false,
    });
    expect(logs.join('\n')).toContain('seeded from the AWS storage variables: adminium-prod');
  });

  it('defaults the region to auto when only that one is missing', async () => {
    const { AWS_REGION: _region, ...withoutRegion } = FLY;
    await seed(withoutRegion);
    expect((await repo().findDefault())?.config).toMatchObject({ region: 'auto' });
  });

  it('ignores a half-configured environment rather than guessing', async () => {
    for (const missing of ['AWS_ENDPOINT_URL_S3', 'BUCKET_NAME', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const) {
      const partial = { ...FLY, [missing]: undefined };
      const result = await seed(partial);
      expect(result, missing).toEqual({ kind: 'skipped', reason: 'nothing-configured' });
    }
    expect(await repo().isEmpty()).toBe(true);
  });

  it('yields to an explicit ADMINIUM_STORAGE_URL', async () => {
    await seed({ ...FLY, ADMINIUM_STORAGE_URL: 'file:///srv/explicit' });
    const stored = await repo().findDefault();
    expect(stored?.driver).toBe('local');
    expect(stored?.config).toEqual({ root: '/srv/explicit' });
  });
});

describe('the boot cannot fail over it', () => {
  /**
   * `adminium start` is a container's PID 1 and `--skip-migrate` is a supported
   * way to run it, so the gate query — which reads
   * `adminium_storage_destinations`, a table migration 0024 creates — has to be
   * survivable on a store that predates 0024. Before the catch-all it threw
   * "no such table" straight out of `run()` and crash-looped the container,
   * over a variable whose entire job is to save a trip to Studio.
   */
  it('warns instead of throwing on a store that predates migration 0024', async () => {
    await meta.db.schema.dropTable('adminium_storage_destinations').execute();

    for (const env of [
      { ADMINIUM_STORAGE_URL: 'file:///srv/adminium/files' },
      {
        AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
        BUCKET_NAME: 'adminium-prod',
        AWS_ACCESS_KEY_ID: 'tid_example',
        AWS_SECRET_ACCESS_KEY: 'tsec_example',
      },
    ] satisfies StorageSeedEnv[]) {
      warnings = [];
      const result = await seed(env);
      expect(result.kind).toBe('refused');
      // The operator gets the driver's own message, which names the table.
      expect(warnings.join('\n')).toContain('Could not seed the storage destination');
      expect(warnings.join('\n')).toContain('adminium_storage_destinations');
    }
  });

  it('still does nothing at all on an unmigrated store with nothing configured', async () => {
    // The cheap path stays cheap: no configuration means the store is never
    // read, so an unmigrated store does not even produce a warning.
    await meta.db.schema.dropTable('adminium_storage_destinations').execute();
    expect(await seed({})).toEqual({ kind: 'skipped', reason: 'nothing-configured' });
    expect(warnings).toEqual([]);
  });
});

/**
 * THE CALL SITE, not the function. Every assertion above passed while the seed
 * had exactly one caller — `cli/commands/start.ts` — so the desktop app and
 * every other embedder of `composeServer` read `ADMINIUM_STORAGE_URL` and the
 * `AWS_*` quartet with nothing at all. These go through the real composition
 * root for that reason: what was missing was a caller, and a unit suite never
 * asks who calls the top.
 */
describe('composeServer seeds the destination too', () => {
  let composed: ComposedServer | undefined;

  afterEach(async () => {
    await composed?.app.close();
    composed = undefined;
  });

  async function compose(overrides: Record<string, string>): Promise<MetaDb> {
    // A store of its own: `composeServer` boots a whole server against it, and
    // the shared `meta` above is deliberately bare.
    const composedMeta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(composedMeta);
    const metaStore: MetaStoreHandle = {
      meta: composedMeta,
      url: 'sqlite::memory:',
      engine: 'sqlite',
      source: 'embedded',
      close: async () => Promise.resolve(),
    };
    const manager = new ConnectionManager({
      meta: composedMeta,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
    });
    const runService = createRunService({ meta: composedMeta });
    composed = await composeServer({
      env: makeEnv(overrides),
      metaStore,
      manager,
      runService,
      applyService: createApplyService({ meta: composedMeta, runService }),
      allowed: null,
      logger: false,
      // The ping's schedule would otherwise hold the process open past the test.
      telemetry: false,
    });
    return composedMeta;
  }

  /** The rows compose wrote, read back through the crypto compose used. */
  const composedRepo = (m: MetaDb) => destinationsRepo(m, storageCryptoFromSecret(TEST_SECRET));

  it('seeds from ADMINIUM_STORAGE_URL on a boot that never touches the CLI', async () => {
    const composedMeta = await compose({ ADMINIUM_STORAGE_URL: 'file:///srv/adminium/composed' });
    const stored = await composedRepo(composedMeta).findDefault();
    expect(stored?.driver).toBe('local');
    expect(stored?.config).toEqual({ root: '/srv/adminium/composed' });
  });

  it('seeds from the AWS quartet — the Fly case, where nothing runs `adminium start`', async () => {
    const composedMeta = await compose({
      AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
      BUCKET_NAME: 'adminium-prod',
      AWS_ACCESS_KEY_ID: 'tid_example',
      AWS_SECRET_ACCESS_KEY: 'tsec_example',
    });
    const stored = await composedRepo(composedMeta).findDefault();
    expect(stored?.name).toBe('adminium-prod');
    expect(stored?.driver).toBe('s3');
    // The credential survived the round trip through the real key derivation.
    expect(await composedRepo(composedMeta).getSecret(stored?.id ?? '')).toBe(
      '{"accessKeyId":"tid_example","secretAccessKey":"tsec_example"}',
    );
  });

  it('leaves the store alone when nothing is configured', async () => {
    // The pre-wave-0024 state, which every other suite composes into: no rows,
    // so the implicit local disk stays the only answer.
    const composedMeta = await compose({});
    expect(await composedRepo(composedMeta).isEmpty()).toBe(true);
  });
});
