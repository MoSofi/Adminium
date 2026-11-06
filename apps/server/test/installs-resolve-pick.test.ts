// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install a caller means, when it has only a key and a database, or not
 * even a database: never the first of several.
 *
 *  - an add-on's state on a database is that database's install (else the
 *    one kept per server): Fernhill's copy stopped in an update leaves
 *    Kiln's saves writing;
 *  - with no database, the install kept per server, else the key's only one;
 *    with several and none per server, none.
 */
import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, manifestsRepo, SERVER_SCOPE, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addOnStateOn, serverWideOrOnly } from '../src/installs/resolve.js';

const PLAIN = { encrypt: (v: string) => v, decrypt: (v: string) => v };
let meta: MetaDb;

beforeEach(async () => {
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
});
afterEach(async () => {
  await meta.db.destroy();
});

const addOn = (scopeKey: string, instanceSlug: string, status: 'installed' | 'installing', version = '1.0.0') =>
  manifestsRepo(meta, PLAIN).install({ manifestKey: 'stock', version, kind: 'add-on', source: 'file', document: { key: 'stock' }, scopeKey, instanceSlug, status });

describe('the install a database uses', () => {
  it('reads an add-on’s state from the install on that database, never another copy’s', async () => {
    await addOn('con_fernhill', '', 'installing', '1.1.0');
    await addOn('con_kiln', 'kiln', 'installed');
    expect(await addOnStateOn(meta, 'stock', 'con_kiln')).toEqual({ version: '1.0.0', status: 'installed' });
    expect(await addOnStateOn(meta, 'stock', 'con_fernhill')).toEqual({ version: '1.1.0', status: 'installing' });
    // A database with no install of its own: none, unless one is kept per server.
    expect(await addOnStateOn(meta, 'stock', 'con_other')).toBeNull();
    await manifestsRepo(meta, PLAIN).install({ manifestKey: 'pay', version: '2.0.0', kind: 'add-on', source: 'file', document: { key: 'pay' }, scopeKey: SERVER_SCOPE });
    expect(await addOnStateOn(meta, 'pay', 'con_other')).toEqual({ version: '2.0.0', status: 'installed' });
  });

  it('with no database: the one kept per server, else the only one, else none', async () => {
    const repo = manifestsRepo(meta, PLAIN);
    expect(await serverWideOrOnly(repo, 'stock')).toBeNull();
    const only = await addOn('con_fernhill', '', 'installed');
    expect((await serverWideOrOnly(repo, 'stock'))?.row.id).toBe(only.row.id);
    // Two copies, none kept per server: no guess.
    await addOn('con_kiln', 'kiln', 'installed');
    expect(await serverWideOrOnly(repo, 'stock')).toBeNull();
    const server = await repo.install({ manifestKey: 'pay', version: '2.0.0', kind: 'add-on', source: 'file', document: { key: 'pay' }, scopeKey: SERVER_SCOPE });
    expect((await serverWideOrOnly(repo, 'pay'))?.row.id).toBe(server.row.id);
  });
});
