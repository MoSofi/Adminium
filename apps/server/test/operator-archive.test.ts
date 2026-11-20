// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An operator project's archive: the project folder
 * lives INSIDE the data folder (`<data>/project`), and it travels and comes
 * back; with `--without-your-database` the user's own database travels
 * without its connection string, a restore asks for it again, and the next
 * boot gives it back from the environment, with no second connection.
 * On each meta engine.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { connectionsRepo, type MetaDb } from '@adminium/meta';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { createArchive } from '../src/archive/create.js';
import { restoreArchive } from '../src/archive/restore.js';
import { parseYourDatabase } from '../src/config/your-database.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerYourDatabase, YOURS_KEY } from '../src/project/your-database.js';
import { yourDatabaseStatus } from '../src/project/your-database-state.js';
import { AVAILABLE, CRYPTO, SECRET, SIGNING, makeDirs, makeStore, type Dirs, type EngineName } from './archive.helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const YOURS_URL = 'postgres://ava:her-password@db.example.com:6543/shop';
const MAIN_URL = 'postgres://trial_7f3a:pw@pg-trials:5432/trial_7f3a';

async function instance(engine: EngineName, migrated: boolean): Promise<{ meta: MetaDb; dirs: Dirs; projectRoot: string }> {
  const store = await makeStore(engine, migrated);
  cleanups.push(store.destroy);
  const dirs = await makeDirs();
  cleanups.push(dirs.cleanup);
  return { meta: store.meta, dirs, projectRoot: join(dirs.dataDir, 'project') };
}

const ENGINES = (['sqlite', 'postgres', 'mysql'] as const).filter((engine) => AVAILABLE[engine]);

describe.each(ENGINES)('an operator project archived and restored, meta on %s', (engine) => {
  it('carries the project folder from inside the data dir, and leaves the user database’s string out when asked', { timeout: 600_000 }, async () => {
    const from = await instance(engine, true);
    const connections = connectionsRepo(from.meta, CRYPTO);
    await connections.create({ name: 'main', engine: 'postgres', sourceKind: 'dsn', introspectDsn: MAIN_URL, dataDsn: null, readOnly: false, settings: {}, status: 'connected', projectKey: 'main', createdBy: null });
    await connections.create({ name: 'Harbor books', engine: 'postgres', sourceKind: 'dsn', introspectDsn: YOURS_URL, dataDsn: null, readOnly: false, settings: { intent: 'full-admin' }, status: 'connected', projectKey: YOURS_KEY, createdBy: null });
    // What the Designer built, in the operator project's folder.
    await mkdir(join(from.projectRoot, 'apps', 'shop'), { recursive: true });
    await writeFile(join(from.projectRoot, 'apps', 'shop', 'adminium.app.json'), '{"key":"shop"}\n');

    const archive = join(from.dirs.root, 'trial.zip');
    const made = await createArchive({ meta: from.meta, outPath: archive, dataDir: from.dirs.dataDir, projectRoot: from.projectRoot, kind: 'full', secret: SECRET, dsnCrypto: CRYPTO, signing: SIGNING, withoutConnectionStrings: [YOURS_KEY] });
    expect(made.manifest.project?.files).toContain('apps/shop/adminium.app.json');
    expect(made.warnings.join('\n')).toContain('Left out the connection string of “Harbor books”');
    // Nowhere in the file: not the password, not the encrypted string (a restore under the same secret could open it).
    const members = unzipSync(await readFile(archive));
    const path = made.manifest.meta.find((entry) => entry.table === 'adminium_connections')?.path ?? '';
    const dump = Buffer.from(members[path] ?? new Uint8Array()).toString('utf8');
    const rows = JSON.parse(dump) as { columns: string[]; rows: unknown[][] };
    const at = (name: string): number => rows.columns.indexOf(name);
    const yoursRow = rows.rows.find((row) => row[at('projectKey')] === YOURS_KEY);
    expect(yoursRow?.[at('introspectDsnEncrypted')]).toBeNull();
    expect(yoursRow?.[at('status')]).toBe('unconfigured');
    const mainRow = rows.rows.find((row) => row[at('projectKey')] === 'main');
    expect(typeof mainRow?.[at('introspectDsnEncrypted')]).toBe('string');

    // Any restore but an operator project's one-off keeps the rule: no project path inside the data dir.
    const ordinary = await instance(engine, false);
    await expect(
      restoreArchive({
        inPath: archive,
        meta: ordinary.meta,
        dataDir: ordinary.dirs.dataDir,
        projectRoot: ordinary.projectRoot,
        secret: SECRET,
        dsnCrypto: CRYPTO,
        signing: SIGNING,
        expect: 'full',
        blockLoopback: true,
        blockPrivate: true,
        databaseHosts: [{ host: 'pg-trials', port: 5432, wildcard: false }],
        lookup: async () => ['203.0.113.10'],
      }),
    ).rejects.toThrow(/project path inside the data dir/);
    expect(existsSync(join(ordinary.projectRoot, 'apps'))).toBe(false);

    const to = await instance(engine, false);
    const restored = await restoreArchive({
      inPath: archive,
      meta: to.meta,
      dataDir: to.dirs.dataDir,
      projectRoot: to.projectRoot,
      operatorProject: true,
      secret: SECRET,
      dsnCrypto: CRYPTO,
      signing: SIGNING,
      expect: 'full',
      blockLoopback: true,
      blockPrivate: true,
      databaseHosts: [{ host: 'pg-trials', port: 5432, wildcard: false }],
      lookup: async () => ['203.0.113.10'],
    });
    expect(restored.projectFiles).toBe(1);
    expect(existsSync(join(to.projectRoot, 'apps', 'shop', 'adminium.app.json'))).toBe(true);
    expect(restored.drafts).toEqual(['Harbor books']);

    // The next boot: the environment gives the string back, into the same row.
    const restoredConnections = connectionsRepo(to.meta, CRYPTO);
    const manager = new ConnectionManager({ meta: to.meta, crypto: CRYPTO, metaDsn: null, blockLoopback: false });
    cleanups.push(async () => manager.disposeAll());
    const yours = parseYourDatabase(JSON.stringify({ url: YOURS_URL, label: 'Harbor books' }));
    if (!yours.ok) throw new Error(yours.problem);
    const registered = await registerYourDatabase({ manager, meta: to.meta, yours: yours.value, status: yourDatabaseStatus(), log: () => undefined, warn: () => undefined });
    expect(registered).not.toBeNull();
    const all = await restoredConnections.list();
    expect(all.filter((row) => row.projectKey === YOURS_KEY)).toHaveLength(1);
    expect((await restoredConnections.getDsns(registered!.connectionId))?.introspectDsn).toBe(YOURS_URL);
    expect((await restoredConnections.getDsns(all.find((row) => row.projectKey === 'main')!.id))?.introspectDsn).toBe(MAIN_URL);
  });
});
