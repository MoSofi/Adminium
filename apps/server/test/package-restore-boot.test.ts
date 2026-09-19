// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The whole point of 0037, end to end: a package that only ever existed on the
 * local disk survives a deploy that empties it.
 *
 * TWO REAL BOOTS against ONE meta store and ONE storage destination, with the
 * data directory wiped in between — which is what a redeploy on a host with no
 * persistent disk actually is. The unit suites prove `keep` and `restore` in
 * isolation; what only a boot can prove is that they run in the right ORDER.
 * 0.2.9 built the add-on runtime 60-90 ms before the bundled seed restored
 * files, and the add-on stayed dark until an unrelated toggle. A restore that
 * lands after the runtime is built has the same defect one step along, and a
 * mocked boot would not notice.
 *
 * The destination is a `file://` one pointing OUTSIDE the data directory, so it
 * survives the wipe exactly as a bucket would. That is a real driver writing
 * real objects, not a stand-in.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { packStagedTree } from '../src/add-ons/pack.js';
import { createAddOnStore, sha512Integrity } from '../src/add-ons/store.js';
import type { ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { createSqliteMetaDb, firstRun, manifestsRepo, type MetaDb } from '@adminium/meta';
import { makeEnv, TEST_SECRET } from './helpers.js';

const KEY = 'render-kit';
const VERSION = '1.0.0';
const MARKER = 'restored-add-on-marker';

function addOnManifest() {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: KEY,
    name: 'Render Kit',
    version: VERSION,
    publisher: { name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: `addon.${KEY}.line`, fallback: 'x' },
    categories: ['data'],
    compatibility: { minAdminiumVersion: '1.0.0', requires: [] },
    addOn: {
      attaches: [{ app: '*' }],
      provides: [{ contract: 'document-render', version: 1, server: 'dist/server.js' }],
      consumes: [],
      slots: [],
      events: [],
      connect: { kind: 'none' },
      scopes: [],
    },
  };
}

interface LogLine {
  level: number;
  msg: string;
  key?: string;
}

let root: string;
let dataDir: string;
let bucket: string;
let meta: MetaDb;
let lines: LogLine[] = [];

async function boot(): Promise<ComposedServer> {
  const { composeServer } = await import('../src/compose.js');
  const runService = createRunService({ meta });
  const metaStore: MetaStoreHandle = {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
  const composed = await composeServer({
    env: makeEnv({
      ADMINIUM_DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      // Outside the data directory, so it survives the wipe — a bucket in
      // every way that matters to this test.
      ADMINIUM_STORAGE_URL: `file://${bucket}`,
    }),
    metaStore,
    manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    staticRoot: join(root, 'dashboard'),
    logger: pino({ level: 'info' }, { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) }),
    telemetry: false,
    onMetaRelocated: () => {
      /* never relocates */
    },
  });
  await composed.app.ready();
  return composed;
}

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const until = Date.now() + 5_000;
  let value = await read();
  while (!done(value) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 25));
    value = await read();
  }
  return value;
}

const repo = () => manifestsRepo(meta, addOnCredentialCryptoFromSecret(TEST_SECRET));

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'package-restore-boot-'));
  dataDir = join(root, 'data');
  bucket = join(root, 'bucket');
  await Promise.all([mkdir(dataDir), mkdir(bucket), mkdir(join(root, 'dashboard'))]);
  await writeFile(join(root, 'dashboard', 'index.html'), '<!doctype html><title>dash</title>');

  // An add-on installed the ordinary way: bytes staged into the store, a row
  // in the meta store naming them.
  const src = join(root, 'src');
  await mkdir(join(src, 'dist'), { recursive: true });
  await writeFile(join(src, 'manifest.json'), JSON.stringify(addOnManifest()), 'utf8');
  await writeFile(join(src, 'dist/server.js'), `export default { marker: '${MARKER}' };\n`, 'utf8');
  const { tarball } = await packStagedTree(src);
  const store = createAddOnStore({ dataDir });
  await store.stage({ key: KEY, version: VERSION, tarball, expectedIntegrity: sha512Integrity(tarball) });

  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await repo().install({
    manifestKey: KEY,
    version: VERSION,
    kind: 'add-on',
    source: 'marketplace',
    document: addOnManifest(),
    // Attached to a host, as a real install is: the runtime builds providers
    // from attachments, so an unattached add-on would prove nothing here.
    attachTo: ['desk'],
  });
});

afterAll(async () => {
  await meta?.db.destroy();
  await rm(root, { recursive: true, force: true });
});

describe('an installed package across a deploy that empties the data directory', () => {
  it('first boot: keeps a copy in the storage destination and records it', async () => {
    const composed = await boot();
    try {
      const row = await eventually(
        async () => (await repo().list('add-on'))[0],
        (r) => r?.row.packageIntegrity != null,
      );
      expect(row?.row.packageIntegrity, JSON.stringify(lines.slice(-6))).toMatch(/^sha512-/);
      expect(row?.row.packageFileId).toMatch(/^file_/);
    } finally {
      await composed.app.close();
    }
  });

  it('second boot, data directory wiped: stages it back before anything reads the store', async () => {
    // The deploy. Everything installed is gone; the meta row and the bucket
    // are not.
    await rm(join(dataDir, 'add-ons'), { recursive: true, force: true });
    expect(await createAddOnStore({ dataDir }).versions(KEY)).toEqual([]);

    lines = [];
    const composed = await boot();
    try {
      const versions = await eventually(
        () => createAddOnStore({ dataDir }).versions(KEY),
        (v) => v.length > 0,
      );
      expect(versions, JSON.stringify(lines.slice(-8))).toEqual([VERSION]);

      // Byte for byte, not merely present.
      const back = await createAddOnStore({ dataDir }).readFile(KEY, VERSION, 'dist/server.js');
      expect(back.toString('utf8')).toContain(MARKER);

      /*
       * THE ORDERING, PROVED THROUGH THE GATE THE WIRING ACTUALLY USES.
       *
       * The restore, the add-on runtime build and this report all hang off one
       * promise in `compose.ts`: the runtime is `packagesReady.then(...)` and
       * the report is `void packagesReady.then(...)`. So a report that does NOT
       * name this add-on is a report that ran after the restore finished — and
       * the runtime, gated on the same promise, did too. Before the restore
       * existed this same boot logged "installed add-on is not on this server"
       * for this key, which is what makes its absence a signal rather than a
       * silence.
       *
       * NOT asserted here: that the add-on's PROVIDER is live. That needs a
       * host app and a document profile, which is the add-on runtime's own
       * subject and proves nothing extra about ordering once both sides are
       * known to be behind the same gate.
       */
      expect(lines.some((l) => /restored a package from its copy/.test(l.msg))).toBe(true);
      expect(
        lines.filter((l) => /is not on this server/.test(l.msg) && l.key === KEY),
        'the report must not still name a package that came back',
      ).toEqual([]);

      // The copy is not re-uploaded on a boot that restored from it: the row
      // already names one, so the keep pass walks past it.
      expect(lines.some((l) => /kept a copy of an installed package/.test(l.msg))).toBe(false);
    } finally {
      await composed.app.close();
    }
  });
});
