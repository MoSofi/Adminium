// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SIDE SENDS ITS OWN INSTALL ON EVERY CALL, add-on routes included.
 *
 * Two databases, Fernhill (the engine under test) and Kiln (SQLite), each
 * with the app and the add-ons. An app's side sends `X-Adminium-Install:
 * <its own install>` on every call; on an add-on's route that means the
 * add-on's install on the app's database:
 *  - a look-up finds the row of that database's copy;
 *  - a settings write lands on that copy, and only for a caller who holds
 *    that copy's grant: the header opens nothing by itself;
 *  - a document is drawn from that copy's row;
 *  - the stock words are asked of that database (the header, or
 *    `?connectionId=`), never answered "which one?".
 * With no selector, two copies still answer `APP_INSTALL_AMBIGUOUS`; an id
 * that names no install is none.
 */
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { addOnSettingsRepo, manifestsRepo, rolesRepo, usersRepo, type User } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import type { LedgerRuntime } from '../src/ledgers/registry.js';
import { addOnLookUpRoutes } from '../src/routes/add-ons/look-up.js';
import { wordsRoutes } from '../src/routes/words/index.js';
import { addOnHarness, appManifest, CRYPTO, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { vaultKitManifest } from './fixtures/vault-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;

const stockKit = (): Doc => ({
  ...stockKitManifest(),
  settings: [{ key: 'tone', type: 'string' }],
  documents: [{ kind: 'stock-label', addOn: 'stock-kit', table: 'items', name: 'Stock label', mapping: { title: { column: 'name' } } }],
});

describe.each(LEGS)('a side’s own install on add-on routes — %s', (dialect, available) => {
  let h: Harness;
  let kiln: string;
  const ids = { deskFernhill: '', deskKiln: '', stockFernhill: '', stockKiln: '' };
  const drawn: Doc[] = [];
  /** The databases the stock words were asked about, in order. */
  const asked: string[] = [];

  beforeAll(async () => {
    if (!available) return;
    const state = { providers: new Map<string, unknown[]>(), slots: new Map(), conflicts: [], problems: [], deciders: new Map() };
    const module = {
      key: 'stock-kit',
      kinds: () => [{ id: 'stock-label', formats: ['html'], paper: ['a6'] }],
      describe: () => ({ slots: [{ id: 'title', type: 'text' }] }),
      render: (input: { subject: Doc }) => {
        drawn.push(input.subject);
        return Promise.resolve([{ format: 'html', filename: 'label.html', mediaType: 'text/html; charset=utf-8', bytes: new TextEncoder().encode('<p>label</p>'), locale: 'en-US', warnings: [] }]);
      },
    };
    // The words route's own runtime, kept to what it is asked: which database, then "no such words".
    const ledgers = {
      manifestOf: (connectionId: string) => {
        asked.push(connectionId);
        return null;
      },
    } as unknown as LedgerRuntime;
    h = await addOnHarness(dialect, {
      unbuiltWords: {},
      documents: { runtime: () => state as never },
      onRebuild: () => state.providers.set('document-render@1', [{ addOnKey: 'stock-kit', contract: 'document-render', version: 1, module }]),
      routes: ({ meta, manager }) => [addOnLookUpRoutes({ meta, manager }), wordsRoutes({ meta, manager, ledgers })],
    });
    // Kiln: a database of its own, whatever the engine under test.
    const file = join(h.dataDir, 'kiln.db');
    new BetterSqlite3(file).close();
    kiln = (await h.manager.connections.create({ name: 'Kiln', engine: 'sqlite', introspectDsn: `sqlite:${file}`, dataDsn: `sqlite:${file}` })).id;
    await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: kiln });

    await h.stageApp(appManifest('desk'));
    for (const connectionId of [h.connectionId, kiln]) {
      const app = await h.install('desk', '0.2.0', { connectionId });
      expect(app.statusCode, app.body).toBe(200);
    }
    await h.stageAddOn(stockKit());
    await h.stageAddOn(vaultKitManifest());
    for (const key of ['stock-kit', 'vault']) {
      for (const connectionId of [h.connectionId, kiln]) {
        const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key, version: '1.0.0', attachTo: [], connectionId } });
        expect(added.statusCode, added.body).toBe(200);
      }
    }
    const manifests = manifestsRepo(h.meta, CRYPTO);
    const on = async (key: string, connectionId: string) => (await manifests.findInScope(key, connectionId))!.row.id;
    ids.deskFernhill = await on('desk', h.connectionId);
    ids.deskKiln = await on('desk', kiln);
    ids.stockFernhill = await on('stock-kit', h.connectionId);
    ids.stockKiln = await on('stock-kit', kiln);

    const flag = dialect === 'postgres' ? 'true' : '1';
    await h.rows(`INSERT INTO stock_kit_items (id, name) VALUES (1, 'Flour')`);
    await h.rows(`INSERT INTO vault_codes (id, code, active, max_uses) VALUES (1, 'SUMMER10', ${flag}, 100)`);
    const { db } = await h.manager.data(kiln);
    await sql.raw(`INSERT INTO stock_kit_items (id, name) VALUES (1, 'Kiln clay')`).execute(db);
    await sql.raw(`INSERT INTO vault_codes (id, code, active, max_uses) VALUES (7, 'SUMMER10', 1, 100)`).execute(db);
  }, 240_000);
  afterAll(async () => {
    if (available) await h?.close();
  });

  const side = (installId: string) => ({ 'x-adminium-install': installId });

  it.skipIf(!available)('a look-up finds the row of the copy on the side’s database', async () => {
    const look = (headers: Record<string, string>) => h.inject({ method: 'POST', url: '/add-ons/vault/look-up', payload: { value: 'SUMMER10' }, headers });
    const none = await look({});
    expect(none.statusCode, none.body).toBe(409);
    expect(none.json().error.code).toBe('APP_INSTALL_AMBIGUOUS');
    const atKiln = await look(side(ids.deskKiln));
    expect(atKiln.statusCode, atKiln.body).toBe(200);
    expect(atKiln.json()).toMatchObject({ found: true, kind: 'code', key: '7' });
    const atFernhill = await look(side(ids.deskFernhill));
    expect(atFernhill.json()).toMatchObject({ found: true, key: '1' });
  });

  it.skipIf(!available)('a settings write lands on that copy, for a caller who holds that copy’s grant only', async () => {
    const put = (headers: Record<string, string>, tone: string, as?: User) => h.inject({ method: 'PUT', url: '/add-ons/stock-kit/settings', payload: { values: { tone } }, headers, ...(as === undefined ? {} : { as }) });
    const saved = await put(side(ids.deskKiln), 'kiln');
    expect(saved.statusCode, saved.body).toBe(200);
    const settings = addOnSettingsRepo(h.meta);
    expect(await settings.valuesForInstall(ids.stockKiln)).toEqual({ tone: 'kiln' });
    expect(await settings.valuesForInstall(ids.stockFernhill)).toEqual({});

    // Fernhill's stock manager: Fernhill's copy, and not Kiln's, whatever the header says.
    const clerk = await usersRepo(h.meta).create({ email: 'clerk@fernhill.test', name: 'Clerk' });
    const roles = rolesRepo(h.meta);
    await roles.assignToUser(clerk.id, (await roles.findBySlug('stock-kit-manager'))!.id);
    expect((await put(side(ids.deskFernhill), 'fernhill', clerk)).statusCode).toBe(200);
    expect(await settings.valuesForInstall(ids.stockFernhill)).toEqual({ tone: 'fernhill' });
    expect((await put(side(ids.deskKiln), 'taken', clerk)).statusCode).toBe(403);
    expect(await settings.valuesForInstall(ids.stockKiln)).toEqual({ tone: 'kiln' });
    // An id that names no install is none, as before.
    expect((await put(side('man_nowhere'), 'lost')).statusCode).toBe(404);
  });

  it.skipIf(!available)('a document is drawn from the row of the side’s copy', async () => {
    const render = (headers: Record<string, string>) => h.inject({ method: 'POST', url: '/add-ons/stock-kit/documents/render', payload: { kind: 'stock-label', table: 'items', key: 1 }, headers });
    expect((await render({})).statusCode).toBe(409);
    drawn.length = 0;
    const atKiln = await render(side(ids.deskKiln));
    expect(atKiln.statusCode, atKiln.body).toBe(201);
    expect(JSON.stringify(drawn)).toContain('Kiln clay');
    expect(JSON.stringify(drawn)).not.toContain('Flour');
  });

  it.skipIf(!available)('the stock words are asked of the side’s database, by the header or by ?connectionId=', async () => {
    const words = (query: string, headers: Record<string, string> = {}) => h.inject({ method: 'GET', url: `/words/stock-kit/units-left?table=${encodeURIComponent('stock-kit:items')}&ids=1${query}`, headers });
    asked.length = 0;
    const none = await words('');
    expect(none.statusCode, none.body).toBe(409);
    expect(none.json().error.code).toBe('APP_INSTALL_AMBIGUOUS');
    // Past the install, this runtime knows no words: 404, asked of the right database.
    expect((await words('', side(ids.deskKiln))).statusCode).toBe(404);
    expect((await words(`&connectionId=${encodeURIComponent(h.connectionId)}`)).statusCode).toBe(404);
    expect((await words('', side(ids.stockKiln))).statusCode).toBe(404);
    expect(asked).toEqual([kiln, h.connectionId, kiln]);
    // Two selectors naming two copies: refused, not settled.
    expect((await words(`&connectionId=${encodeURIComponent(h.connectionId)}`, side(ids.deskKiln))).statusCode).toBe(422);
  });
});
