// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH TABS OF AN ADD-ON'S ROWS A RECORD HAS.
 *
 * An add-on's tab shows on the table a rule hands in to it as the row asked
 * about — the rule's own table when it maps the row itself, the table its
 * link column points at when it maps that — and on no table that only
 * carries the rule. A rule switched off keeps the tab. An app's table has it
 * only while the add-on is attached to that app and on. A caller who does not
 * read the add-on's table has no tab; one who does is told what they may do.
 */
import { overridesRepo, pagesRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { recordTabsFor, type RecordTabFact, type RecordTabsAsker } from '../src/add-ons/record-tabs.js';
import { loadAddOnInstalls, type AddOnInstalls } from '../src/apps/table-ref.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;

const PAIR = [
  { ref: 'source_table', type: 'text', maxLength: 128, rules: { tableRef: true } },
  { ref: 'source_row', type: 'text', maxLength: 64 },
];

/** The kit, keeping links for rows of other tables, with a tab that lists them wherever a rule hands a row in. */
function manifest(): Doc {
  const kit = ledgerKitManifest() as Doc & { addOn: Doc; requiredSchema: { tables: Doc[] } };
  kit.requiredSchema.tables = [
    ...kit.requiredSchema.tables,
    { ref: 'links', columns: [{ ref: 'id', type: 'int', role: 'pk' }, ...PAIR, { ref: 'account_id', type: 'fk', references: 'accounts' }, { ref: 'qty', type: 'decimal', scale: 3, default: 1 }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] },
    { ref: 'uses', columns: [{ ref: 'id', type: 'int', role: 'pk' }, ...PAIR, { ref: 'qty', type: 'decimal', scale: 3, default: 1 }] },
  ];
  kit.addOn = {
    ...kit.addOn,
    recordTabs: [
      {
        id: 'stock',
        label: { key: 'kit.tab.stock', fallback: 'Stock' },
        labels: { 'de-DE': 'Bestand', 'zh-TW': '庫存' },
        table: 'links',
        match: { table: 'source_table', row: 'source_row' },
        on: 'linked',
        columns: ['account_id', 'qty', 'note'],
        edit: ['qty'],
        form: ['account_id', 'qty'],
        add: { pick: { table: 'accounts', label: 'name' } },
        remove: true,
        empty: { key: 'kit.tab.empty', fallback: 'Nothing is linked yet.' },
        empties: { 'de-DE': 'Noch nichts verknüpft.' },
        summary: { words: 'units-left' },
        actions: [{ id: 'use', label: { key: 'kit.tab.use', fallback: 'Use stock' }, labels: { 'de-DE': 'Bestand verwenden' }, child: { table: 'uses', form: ['qty'] } }],
      },
    ],
  };
  return kit;
}

const adopt = (id: string, what: unknown, more: Doc = {}) => ({ id, into: { addOn: 'ledger-kit', ledger: 'units', action: 'adopt' }, map: { what, name: 'name' }, post: { on: { create: true } }, ...more });

describe.each(LEGS)('the tabs of an add-on\'s rows a record has — %s', (dialect, available) => {
  let w: LedgerWorld;
  let installs: AddOnInstalls;
  const id = (name: string) => w.target(name).table.id;
  const everything: RecordTabsAsker = { can: async () => true, permissions: { superAdmin: true } };
  const tabs = (name: string, over: { asker?: RecordTabsAsker; installs?: AddOnInstalls } = {}) => recordTabsFor(w.h.meta, over.installs ?? installs, over.asker ?? everything, w.target(name).view, id(name));
  /** What is installed, with the kit's manifest or its attachments changed. */
  const installed = (change: (addOn: NonNullable<ReturnType<AddOnInstalls['installed']>>) => NonNullable<ReturnType<AddOnInstalls['installed']>>, refOf?: AddOnInstalls['refOf']): AddOnInstalls => ({
    ...installs,
    installed: (connectionId, key) => {
      const addOn = installs.installed(connectionId, key);
      return addOn === null ? null : change(addOn);
    },
    ...(refOf === undefined ? {} : { refOf }),
  });

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(
      dialect,
      {
        // The dish is the row asked about: the rule sits on it and maps the row itself.
        dishes: { columns: 'name VARCHAR(40) NULL', postings: [adopt('dish', { row: true })] },
        // A meal is asked about through its lines: the rule sits on the lines and maps their link to the meal.
        meals: { columns: 'name VARCHAR(40) NULL', postings: [] },
        meal_lines: { columns: 'meal_id INT NULL, name VARCHAR(40) NULL, FOREIGN KEY (meal_id) REFERENCES meals(id)', postings: [adopt('line', 'meal_id')] },
        // A menu's rule is switched off; a note has none.
        menus: { columns: 'name VARCHAR(40) NULL', postings: [adopt('menu', { row: true })] },
        notes: { columns: 'name VARCHAR(40) NULL', postings: [] },
      },
      manifest(),
      async (h, idOf) => {
        await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.switchedOff', tableName: idOf('menus'), columnName: null, value: { postings: ['menu'] }, origin: 'user' } as never);
      },
    );
    installs = await loadAddOnInstalls(w.h.meta, async (connectionId) => ((await snapshotsRepo(w.h.meta).latest(connectionId))?.schema as { tables: { id: string; name: string }[] } | undefined) ?? null);
  }, 240_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('says its words in the reader\'s language where the add-on wrote them, and in English otherwise', async () => {
    const read = async (locale?: string) => {
      const [tab] = (await tabs('dishes', { asker: { ...everything, ...(locale === undefined ? {} : { locale }) } }))!;
      return [tab!.label, tab!.empty, tab!.actions.map((action) => action.label)];
    };
    // The tab is drawn before any code of the add-on runs: what the server hands over is what is shown.
    expect(await read('de_DE')).toEqual(['Bestand', 'Noch nichts verknüpft.', ['Bestand verwenden']]);
    // Another region of the reader's language will do; a language it was not written in gets the English, never a third one.
    expect(await read('de_AT')).toEqual(['Bestand', 'Noch nichts verknüpft.', ['Bestand verwenden']]);
    expect(await read('zh_TW')).toEqual(['庫存', 'Nothing is linked yet.', ['Use stock']]);
    expect(await read('fr_FR')).toEqual(['Stock', 'Nothing is linked yet.', ['Use stock']]);
    expect(await read()).toEqual(['Stock', 'Nothing is linked yet.', ['Use stock']]);
  });

  it.skipIf(!available)('the table a posting hands in has the tab; a table with none has not', async () => {
    const [tab, ...more] = (await tabs('dishes'))!;
    expect(more).toEqual([]);
    expect(tab).toMatchObject({
      addOn: 'ledger-kit',
      id: 'stock',
      label: 'Stock',
      labelKey: 'kit.tab.stock',
      tableId: id('ledger_kit_links'),
      key: 'id',
      // The pair a row is found by, and this table as the add-on's rows name it.
      match: { table: 'source_table', row: 'source_row', tableRef: id('dishes') },
      edit: ['qty'],
      add: [{ fk: 'account_id', table: id('ledger_kit_accounts'), key: 'id', label: 'name' }],
      remove: true,
      empty: 'Nothing is linked yet.',
      emptyKey: 'kit.tab.empty',
      summary: { words: 'units-left' },
      can: { read: true, create: true, update: true, delete: true },
    });
    expect(tab!.columns.map((column) => column.spec['name'])).toEqual(['account_id', 'qty', 'note']);
    expect(tab!.actions).toMatchObject([{ id: 'use', label: 'Use stock', labelKey: 'kit.tab.use', tableId: id('ledger_kit_uses'), can: true }]);
    expect(tab!.actions[0]!.form.map((column) => column.spec['name'])).toEqual(['qty']);
    expect(await tabs('notes')).toBeUndefined();
  });

  it.skipIf(!available)('a posting on the line table that maps a link puts the tab on the row it names, not on the line', async () => {
    expect((await tabs('meals'))!.map((tab) => tab.id)).toEqual(['stock']);
    expect(await tabs('meal_lines')).toBeUndefined();
  });

  it.skipIf(!available)('a table handed in as the row itself gets the one-row form; a table reached by a link gets the list', async () => {
    expect((await tabs('dishes'))![0]).toMatchObject({ mode: 'form', form: ['account_id', 'qty'] });
    expect((await tabs('meals'))![0]!.mode).toBe('list');
    // With no form declared, the row itself is a list too.
    const formless = installed((addOn) => ({ ...addOn, version: '1.0.1', manifest: { ...addOn.manifest, addOn: { ...addOn.manifest.addOn, recordTabs: (addOn.manifest.addOn as unknown as { recordTabs: Doc[] }).recordTabs.map(({ form: _form, remove: _remove, ...tab }) => tab) } } as never }));
    // (Nor are its rows removed there, when the tab does not say they may be.)
    expect((await tabs('dishes', { installs: formless }))![0]).toMatchObject({ mode: 'list', form: [], remove: false });
  });

  it.skipIf(!available)('a switched-off posting keeps the tab', async () => {
    expect(w.target('menus').table.table?.switchedOff?.postings).toEqual(['menu']);
    expect((await tabs('menus'))!.map((tab) => tab.id)).toEqual(['stock']);
  });

  it.skipIf(!available)('a tab on named tables shows on those, by their stored names, and on no other', async () => {
    const named = (on: string[]) => installed((addOn) => ({ ...addOn, version: `on-${on.join()}`, manifest: { ...addOn.manifest, addOn: { ...addOn.manifest.addOn, recordTabs: (addOn.manifest.addOn as unknown as { recordTabs: Doc[] }).recordTabs.map((tab) => ({ ...tab, on })) } } as never }));
    // A note has no rule, and is named: it has the tab. A dish has a rule, and is not: it has none.
    expect((await tabs('notes', { installs: named([id('notes')]) }))!.map((tab) => tab.id)).toEqual(['stock']);
    expect(await tabs('dishes', { installs: named([id('notes')]) })).toBeUndefined();
    // By the stored name, whatever the table is called: an app's table is `pos:dishes` for as long as it lives.
    const stored = named(['pos:dishes']);
    const asPos: AddOnInstalls = { ...stored, refOf: (connectionId, tableId) => (tableId === id('dishes') ? 'pos:dishes' : installs.refOf(connectionId, tableId)), installed: (connectionId, key) => ({ ...stored.installed(connectionId, key)!, hosts: new Map([['pos', true]]) }) };
    const [tab] = (await tabs('dishes', { installs: asPos }))!;
    expect(tab!.match.tableRef).toBe('pos:dishes');
  });

  it.skipIf(!available)('an app\'s table needs the add-on attached to that app, and on', async () => {
    const forApp = (hosts: Map<string, boolean>): AddOnInstalls => installed((addOn) => ({ ...addOn, hosts }), (connectionId, tableId) => (tableId === id('dishes') ? 'pos:dishes' : installs.refOf(connectionId, tableId)));
    expect(await tabs('dishes', { installs: forApp(new Map()) })).toBeUndefined();
    expect(await tabs('dishes', { installs: forApp(new Map([['pos', false]])) })).toBeUndefined();
    expect(await tabs('dishes', { installs: forApp(new Map([['hotel', true]])) })).toBeUndefined();
    expect((await tabs('dishes', { installs: forApp(new Map([['pos', true]])) }))!.map((tab) => tab.match.tableRef)).toEqual(['pos:dishes']);
    // The owner's own table asks nothing of an app; nor does an add-on that is not installed any more show a tab.
    expect((await tabs('meals', { installs: forApp(new Map()) }))!.map((tab) => tab.id)).toEqual(['stock']);
    expect(await tabs('meals', { installs: installed((addOn) => ({ ...addOn, status: 'disabled' as never })) })).toBeUndefined();
  });

  it.skipIf(!available)('a caller without read on the links table gets no tab; one who only reads it is told so', async () => {
    const links = `table:${w.h.connectionId}:${id('ledger_kit_links')}`;
    const asker = (granted: (permission: string) => boolean): RecordTabsAsker => ({ can: async (permission) => granted(permission), permissions: {} });
    expect(await tabs('dishes', { asker: asker((permission) => !permission.startsWith(links)) })).toBeUndefined();
    const [reader] = (await tabs('dishes', { asker: asker((permission) => permission === `${links}:read`) }))!;
    expect(reader!.can).toEqual({ read: true, create: false, update: false, delete: false });
    // The picker lists accounts, the button makes a use: neither is offered to who may not.
    expect(reader!.add).toEqual([]);
    expect(reader!.actions.map((action) => action.can)).toEqual([false]);
    // The columns a caller's read of the links does not show are not the tab's: nothing of them is told, nor edited.
    const part: RecordTabsAsker = { can: async () => true, permissions: { readLimits: { limited: [{ grant: `${links}:read`, limit: { readable: ['account_id', 'note'] } }], unlimited: new Set() } } };
    const [limited] = (await tabs('dishes', { asker: part }))!;
    expect(limited!.columns.map((column) => column.spec['name'])).toEqual(['account_id', 'note']);
    expect(limited!.edit).toEqual([]);
    expect(limited!.form).toEqual(['account_id']);
  });

  it.skipIf(!available)('a fault in working the tabs out leaves the page without them, and says so in the log', async () => {
    const warned: unknown[] = [];
    const broken: AddOnInstalls = { ...installs, tableOf: () => { throw new Error('boom'); } };
    expect(await tabs('dishes', { installs: broken, asker: { ...everything, log: { warn: (...args) => warned.push(args) } } })).toBeUndefined();
    expect(warned).toHaveLength(1);
  });
});

describe('the page reply', () => {
  let w: LedgerWorld;
  let served: Served;
  let cookie = '';
  beforeAll(async () => {
    w = await ledgerWorld('sqlite', { dishes: { columns: 'name VARCHAR(40) NULL', postings: [adopt('dish', { row: true })] }, notes: { columns: 'name VARCHAR(40) NULL', postings: [] } }, manifest());
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    const boss = await usersRepo(w.h.meta).create({ email: 'boss@tabs.dev', name: 'Boss', passwordHash: await adminPasswordHash() });
    await rolesRepo(w.h.meta).assignToUser(boss.id, (await rolesRepo(w.h.meta).findBySlug('super-admin'))!.id);
    cookie = sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'boss@tabs.dev', password: ADMIN_PASSWORD } })).headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    await served?.close();
    await w?.close();
  });
  const page = async (table: string) => {
    const made = await pagesRepo(w.h.meta).create({ connectionId: w.h.connectionId, slug: `tabs-${table}`, type: 'page-crud', title: table, config: { template: 'page-crud', source: { connectionId: w.h.connectionId, table: w.target(table).table.id }, config: { columns: [] } } });
    const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/pages/${made.id}`, headers: { cookie } });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { recordTabs?: RecordTabFact[] };
  };

  it('carries the tabs of a table that has some, and no such key for a table that has none', async () => {
    const dishes = await page('dishes');
    expect(dishes.recordTabs).toMatchObject([{ addOn: 'ledger-kit', id: 'stock', mode: 'form', match: { tableRef: w.target('dishes').table.id } }]);
    expect(await page('notes')).not.toHaveProperty('recordTabs');
  });
});
