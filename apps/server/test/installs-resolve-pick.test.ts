// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The install a caller means, when it has only a key and a database, or not
 * even a database: never the first of several.
 *
 *  - an add-on's state on a database is that database's install (else the
 *    one kept per server): Fernhill's copy stopped in an update leaves
 *    Kiln's saves writing;
 *  - with no database, the install kept per server, else the key's only one;
 *    with several and none per server, none;
 *  - a side's own install id in the header, asked about another key, means
 *    that key's install on the side's database (else the one kept per
 *    server); an id from a row or a body stays exact.
 */
import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, manifestsRepo, SERVER_SCOPE, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addOnStateOn, resolveInstall, selectorOf, serverWideOrOnly } from '../src/installs/resolve.js';

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

describe('a side that sends its own install on every call', () => {
  const app = (scopeKey: string, instanceSlug: string) =>
    manifestsRepo(meta, PLAIN).install({ manifestKey: 'desk', version: '1.0.0', kind: 'app', source: 'file', document: { key: 'desk' }, scopeKey, instanceSlug });
  const header = (installId: string, query: Record<string, string> = {}) => selectorOf({ headers: { 'x-adminium-install': installId }, query });

  it('names the add-on’s install on the app’s database, and never the other copy', async () => {
    const repo = manifestsRepo(meta, PLAIN);
    const fernhillDesk = await app('con_fernhill', '');
    const kilnDesk = await app('con_kiln', 'kiln');
    const fernhill = await addOn('con_fernhill', '', 'installed');
    const kiln = await addOn('con_kiln', 'kiln', 'installed');
    // No selector: which one? Never a guess.
    await expect(resolveInstall(repo, 'stock', {}, { kind: 'add-on' })).rejects.toMatchObject({ code: 'APP_INSTALL_AMBIGUOUS' });
    expect((await resolveInstall(repo, 'stock', header(kilnDesk.row.id), { kind: 'add-on' }))?.row.id).toBe(kiln.row.id);
    expect((await resolveInstall(repo, 'stock', header(fernhillDesk.row.id), { kind: 'add-on' }))?.row.id).toBe(fernhill.row.id);
    // The add-on's own id still names itself; the app's id still names the app.
    expect((await resolveInstall(repo, 'stock', header(kiln.row.id), { kind: 'add-on' }))?.row.id).toBe(kiln.row.id);
    expect((await resolveInstall(repo, 'desk', header(kilnDesk.row.id), { kind: 'app' }))?.row.id).toBe(kilnDesk.row.id);
    // The header and the database agree: one install. They disagree: refused, not settled.
    expect((await resolveInstall(repo, 'stock', header(kilnDesk.row.id, { connectionId: 'con_kiln' }), { kind: 'add-on' }))?.row.id).toBe(kiln.row.id);
    await expect(resolveInstall(repo, 'stock', header(kilnDesk.row.id, { connectionId: 'con_fernhill' }), { kind: 'add-on' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('finds none where the app’s database has no copy, and an unknown id is none', async () => {
    const repo = manifestsRepo(meta, PLAIN);
    const lone = await app('con_lone', '');
    await addOn('con_fernhill', '', 'installed');
    // The key's only install is on another database: not this side's.
    expect(await resolveInstall(repo, 'stock', header(lone.row.id), { kind: 'add-on' })).toBeNull();
    expect(await resolveInstall(repo, 'stock', header('man_nowhere'), { kind: 'add-on' })).toBeNull();
  });

  it('reaches an add-on kept once per server from any database', async () => {
    const repo = manifestsRepo(meta, PLAIN);
    const desk = await app('con_kiln', '');
    const pay = await repo.install({ manifestKey: 'pay', version: '2.0.0', kind: 'add-on', source: 'file', document: { key: 'pay' }, scopeKey: SERVER_SCOPE });
    expect((await resolveInstall(repo, 'pay', header(desk.row.id), { kind: 'add-on' }))?.row.id).toBe(pay.row.id);
    expect((await resolveInstall(repo, 'pay', {}, { kind: 'add-on' }))?.row.id).toBe(pay.row.id);
  });

  it('keeps an id from a row or a body exact: another key’s id there names nothing', async () => {
    const repo = manifestsRepo(meta, PLAIN);
    const desk = await app('con_kiln', '');
    await addOn('con_kiln', '', 'installed');
    expect(await resolveInstall(repo, 'stock', { installId: desk.row.id }, { kind: 'add-on' })).toBeNull();
  });
});
