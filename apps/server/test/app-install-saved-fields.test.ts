// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FIELDS A HAND-BUILT DASHBOARD IS DESCRIBED WITH, INSTALLED.
 *
 * A time of day and a decimal's digits are made by the installer on every
 * engine; a link no foreign key keeps is made as a plain column and linked by
 * Adminium; a hidden column, an int read as a yes or a no, a link's name, a
 * left-out table and postings kept switched off are the app's rules on its
 * tables — written at install, changed by an update while nobody changed
 * them, taken back at uninstall. Existing customers are never switched on by
 * a file, and say so. An answer keeps its line under it; a mail keeps its
 * kind, purpose, brand and the package's files it carries.
 *
 * A page's envelope and views install with the app and are written again by
 * an update (`app-install-saved-pages.test.ts` reads them in full).
 *
 * SQLite always runs; Postgres runs with TEST_POSTGRES_URL, MySQL with
 * TEST_MYSQL_URL (`./app-install-harness.ts`).
 */
import { createHash } from 'node:crypto';

import { EMAIL_BRAND_MARKS } from '@adminium/manifest';
import { emailMarkSchema, emailTemplatesRepo, filesRepo, manifestsRepo, optionListsRepo, overridesRepo, validateOverrideInput, type SchemaOverride } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import type { FileStore } from '../src/files/store.js';
import { EXISTING_CUSTOMERS_KEPT, markRules, relationRules } from '../src/apps/manifest-rules.js';
import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';

type Doc = Record<string, unknown>;

const page = { ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'orders' } };

function shop(version = '1.0.0', over: Doc = {}): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version,
    publisher: { id: 'local', name: 'Made here' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: {
      tables: [
        { ref: 'customers', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true, relation: { constraint: false, label: 'Buyer' } },
            { ref: 'total', type: 'decimal', scale: 2, precision: 10, nullable: true },
            { ref: 'opens_at', type: 'time', nullable: true },
            { ref: 'gift', type: 'int', yesNo: true, nullable: true },
            { ref: 'note', type: 'text', nullable: true, hidden: true },
          ],
        },
        { ref: 'notes', exclude: true, columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'body', type: 'text', nullable: true }] },
      ],
    },
    pages: [page],
    frontends: [{ side: 'staff', kind: 'spa' }],
    ...over,
  };
}

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

/** Each column's type as the engine keeps it, with a decimal's digits and places. */
async function columnTypes(h: Harness, dialect: Dialect, table: string): Promise<Record<string, string>> {
  if (dialect === 'sqlite') {
    const rows = await h.rows(`SELECT name, type FROM pragma_table_info('${table}')`);
    return Object.fromEntries(rows.map((row) => [String(row['name']), String(row['type']).toLowerCase()]));
  }
  const schema = dialect === 'postgres' ? 'current_schema()' : 'DATABASE()';
  const rows = await h.rows(
    `SELECT column_name AS name, data_type AS type, numeric_precision AS p, numeric_scale AS s FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = '${table}'`,
  );
  return Object.fromEntries(
    rows.map((row) => {
      const type = String(row['type']).toLowerCase();
      return [String(row['name']), type === 'numeric' || type === 'decimal' ? `decimal(${String(row['p'])},${String(row['s'])})` : type];
    }),
  );
}

/** The app's own rules on the connection, as op → the value it wrote, keyed by the column (or the link) it holds. */
async function appRules(h: Harness): Promise<Record<string, Record<string, unknown>>> {
  const rows = (await overridesRepo(h.meta).listForConnection(h.connectionId)).filter((o: SchemaOverride) => o.origin === 'app' && o.status === 'active');
  return Object.fromEntries(
    rows.map((o) => {
      const table = o.tableName.split('.').at(-1)!;
      const column = o.columnName ?? (typeof o.value['fromColumn'] === 'string' ? o.value['fromColumn'] : '');
      return [`${o.op} ${table}${column === '' ? '' : `.${column}`}`, o.value];
    }),
  );
}

/** The engine's own CREATE for the hand-made tables an install reuses, with rows in them. */
const HAND_MADE: Record<Dialect, string[]> = {
  sqlite: [
    'CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(80))',
    'CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total REAL, opens_at TIME, gift INTEGER, note TEXT)',
    'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)',
  ],
  postgres: [
    'CREATE TABLE customers (id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name varchar(80))',
    'CREATE TABLE orders (id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, customer_id integer, total numeric(10,2), opens_at time, gift smallint, note text)',
    'CREATE TABLE notes (id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, body text)',
  ],
  mysql: [
    'CREATE TABLE customers (id int NOT NULL AUTO_INCREMENT PRIMARY KEY, name varchar(80))',
    'CREATE TABLE orders (id int NOT NULL AUTO_INCREMENT PRIMARY KEY, customer_id int, total decimal(10,2), opens_at time, gift smallint, note text)',
    'CREATE TABLE notes (id int NOT NULL AUTO_INCREMENT PRIMARY KEY, body text)',
  ],
};

describe.each(ENGINES)('a dashboard\'s tables, installed on %s', (dialect, available) => {
  it.skipIf(!available)('makes a time of day, a decimal\'s digits and a link no foreign key keeps, and writes the app\'s marks', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    const reply = await h.install(shop());
    expect(reply.statusCode, reply.body).toBe(200);

    const types = await columnTypes(h, dialect, 'orders');
    expect(types['opens_at']).toMatch(/^time/);
    expect(types['total']).toBe(dialect === 'sqlite' ? 'real' : 'decimal(10,2)');

    // A link no foreign key keeps: an order may name a customer that is not there, on every engine.
    await h.run(`INSERT INTO customers (name) VALUES ('Ada')`);
    await h.run(`INSERT INTO orders (customer_id, total, opens_at, gift) VALUES (999, 12.5, '09:30:00', 1)`);
    const [order] = await h.rows('SELECT customer_id, total, opens_at, gift FROM orders');
    expect(Number(order!['customer_id'])).toBe(999);
    expect(Number(order!['total'])).toBe(12.5);
    expect(String(order!['opens_at'])).toMatch(/^09:30(:00)?/);

    const rules = await appRules(h);
    const customers = (await overridesRepo(h.meta).listForConnection(h.connectionId)).find((o) => o.op === 'relation.add')?.value['toTable'];
    expect(String(customers)).toMatch(/customers$/);
    expect(rules).toMatchObject({
      'relation.add orders.customer_id': { fromColumn: 'customer_id', toColumn: 'id', cardinality: 'many-to-one' },
      'relation.label orders.customer_id': { fromColumn: 'customer_id', label: 'Buyer' },
      'column.hidden orders.note': { hidden: true },
      'column.yesNo orders.gift': { yesNo: true },
      'table.exclude notes': { excluded: true },
    });
  });

  it.skipIf(!available)('reuses tables that hold rows as they are: no foreign key, no change of type, the rows kept', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    for (const statement of HAND_MADE[dialect]) await h.run(statement);
    await h.run(`INSERT INTO customers (name) VALUES ('Ada')`);
    await h.run(`INSERT INTO orders (customer_id, total, opens_at, gift, note) VALUES (1, 3.25, '18:00:00', 0, 'keep me')`);
    // Adminium has read the tables, as it has on any database it was pointed at.
    await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
    const before = await columnTypes(h, dialect, 'orders');

    const reuse = { action: 'reuse' };
    await h.stage(shop());
    const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId, choices: { customers: reuse, orders: reuse, notes: reuse } } });
    expect(plan.statusCode, plan.body).toBe(200);
    const tables = (JSON.parse(plan.body) as { plan: { tables: { ref: string; action: string; edits: unknown[] }[] } }).plan.tables;
    // Nothing is asked of the tables: the link stays a plain column, the time and the decimal are what they are.
    expect(tables.map((t) => [t.ref, t.action, t.edits])).toEqual([
      ['customers', 'reuse', []],
      ['orders', 'reuse', []],
      ['notes', 'reuse', []],
    ]);

    const reply = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId, choices: { customers: reuse, orders: reuse, notes: reuse } } });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(await columnTypes(h, dialect, 'orders')).toEqual(before);
    expect(await h.rows('SELECT note FROM orders')).toEqual([{ note: 'keep me' }]);
    await h.run(`INSERT INTO orders (customer_id) VALUES (999)`);
    expect(await appRules(h)).toMatchObject({ 'relation.add orders.customer_id': { toColumn: 'id' }, 'column.yesNo orders.gift': { yesNo: true } });
  });

  it.skipIf(!available)('changes the marks an update changes, keeps those the operator changed, and takes the rest back at uninstall', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    expect((await h.install(shop())).statusCode).toBe(200);

    // The operator renames the link themselves: theirs from now on.
    const overrides = overridesRepo(h.meta);
    const label = (await overrides.listForConnection(h.connectionId)).find((o) => o.op === 'relation.label')!;
    await overrides.delete(label.id);
    await overrides.create({ connectionId: h.connectionId, op: 'relation.label', tableName: label.tableName, value: { fromColumn: 'customer_id', label: 'Client' }, origin: 'user' });

    // 1.1.0 shows the note again, stops leaving notes out, names the link otherwise and keeps a real foreign key.
    const next = shop('1.1.0');
    const tables = (next['requiredSchema'] as { tables: Doc[] }).tables;
    delete tables[2]!['exclude'];
    const columns = tables[1]!['columns'] as Doc[];
    columns[1] = { ...columns[1], relation: { label: 'Customer' } };
    columns[5] = { ...columns[5], hidden: false };
    await h.stage(next);
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
    expect(updated.statusCode, updated.body).toBe(200);
    const after = await appRules(h);
    expect(after['column.hidden orders.note']).toEqual({ hidden: false });
    expect(after['table.exclude notes']).toBeUndefined();
    expect(after['relation.add orders.customer_id']).toBeUndefined();
    expect(after['relation.label orders.customer_id']).toBeUndefined();
    const held = (await overrides.listForConnection(h.connectionId)).filter((o) => o.op === 'relation.label' && o.status === 'active');
    expect(held.map((o) => [o.origin, o.value['label']])).toEqual([['user', 'Client']]);
    const skipped = (JSON.parse(updated.body) as { app: { rules: { skipped: { op: string; reason: string }[] } } }).app.rules.skipped;
    expect(skipped).toContainEqual(expect.objectContaining({ op: 'relation.label', reason: 'The operator already keeps a rule for this column.' }));

    const gone = await h.inject({ method: 'DELETE', url: '/apps/shop' });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await appRules(h)).toEqual({});
    // The operator's own stays, and so do the tables and their rows.
    expect((await overrides.listForConnection(h.connectionId)).filter((o) => o.status === 'active' && o.op === 'relation.label').map((o) => o.origin)).toEqual(['user']);
    expect(Object.keys(await columnTypes(h, dialect, 'orders'))).toContain('opens_at');
  });
});

describe('postings kept switched off, a link\'s target, and existing customers', () => {
  it('keeps postings switched off as the store keeps the owner\'s switch', () => {
    const [off] = markRules({ ref: 'orders', switchedOff: { postings: ['line'], adjust: true } }, 'main.orders');
    expect(off).toMatchObject({ op: 'table.switchedOff', column: '', value: { postings: ['line'], adjust: true } });
    expect(() => validateOverrideInput({ connectionId: 'c', op: off!.op, tableName: off!.table, columnName: null, value: off!.value })).not.toThrow();
    expect(markRules({ ref: 'orders', switchedOff: { adjust: true } }, 'main.orders')[0]?.value).toEqual({ postings: [], adjust: true });
    expect(markRules({ ref: 'orders' }, 'main.orders')).toEqual([]);
  });

  it('names a link\'s target as missing when it is not here, or is keyed by more than one column', () => {
    const relation = { constraint: false as const, remove: undefined, label: 'Buyer' };
    expect(relationRules('orders', 'main.orders', 'customer_id', relation, 'customers', undefined).map((rule) => [rule.op, rule.missing])).toEqual([
      ['relation.add', ['customers']],
      ['relation.label', undefined],
    ]);
    expect(relationRules('orders', 'main.orders', 'customer_id', relation, 'customers', { id: 'main.customers', primaryKey: ['a', 'b'] })[0]?.missing).toEqual(['customers']);
    const removed = relationRules('orders', 'main.orders', 'customer_id', { remove: true }, 'customers', { id: 'main.customers', primaryKey: ['id'] });
    expect(removed).toEqual([{ ref: 'orders', table: 'main.orders', column: 'customer_id', op: 'relation.remove', value: { fromColumn: 'customer_id', toTable: 'main.customers' } }]);
    for (const rule of [...removed, ...relationRules('orders', 'main.orders', 'customer_id', relation, 'customers', { id: 'main.customers', primaryKey: ['id'] })]) {
      expect(() => validateOverrideInput({ connectionId: 'c', op: rule.op, tableName: rule.table, columnName: null, value: rule.value })).not.toThrow();
    }
  });

  it('writes the switch, and never switches existing customers on: it says so instead', async () => {
    harness = await installHarness('sqlite');
    const h = harness;
    const m = shop('1.0.0', { people: [{ table: 'customers', kind: 'people', email: 'email' }] });
    const tables = (m['requiredSchema'] as { tables: Doc[] }).tables;
    tables[0] = { ...tables[0], keyField: 'name', existingCustomers: true, columns: [...(tables[0]!['columns'] as Doc[]), { ref: 'email', type: 'text', maxLength: 200, nullable: true }] };
    const reply = await h.install(m);
    expect(reply.statusCode, reply.body).toBe(200);
    const skipped = (JSON.parse(reply.body) as { rules: { skipped: { op: string; reason: string }[] } }).rules.skipped;
    expect(skipped).toContainEqual(expect.objectContaining({ op: 'table.existingCustomers', reason: EXISTING_CUSTOMERS_KEPT }));
    expect((await overridesRepo(h.meta).listForConnection(h.connectionId)).some((o) => o.op === 'table.existingCustomers')).toBe(false);
  });
});

describe('an answer\'s line and an app\'s mail', () => {
  /** A library that keeps the bytes in memory and says what it kept. */
  const library = (): FileStore & { kept: Map<string, Buffer> } => {
    const kept = new Map<string, Buffer>();
    return {
      kept,
      write: async (input: { id: string; bytes: Buffer | string }) => {
        const bytes = Buffer.from(input.bytes);
        kept.set(input.id, bytes);
        return { storageKey: input.id, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), destinationId: null, storage: 'memory' };
      },
    } as unknown as FileStore & { kept: Map<string, Buffer> };
  };
  const PDF = '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n';
  const BRAND = { name: 'Shop', mark: 'leaf', accent: '#1f7a4d', fromName: 'The shop', fromEmail: 'hello@shop.test' };
  const mailing = (version: string, attachments: Doc[], over: Doc = {}): Doc =>
    shop(version, {
      optionLists: { sizes: { label: 'Sizes', values: [{ value: 's', label: 'Small', description: 'Up to 250 ml' }, { value: 'l', label: 'Large' }] } },
      emailTemplates: [
        {
          key: 'shop-news',
          name: 'News',
          kind: 'campaign',
          category: 'marketing',
          brand: BRAND,
          attachments,
          locales: { 'en-US': { subject: 'News', blocks: [{ block: 'email.text', data: { text: 'Hello' } }] }, 'de-DE': { subject: 'Neues', blocks: [{ block: 'email.text', data: { text: 'Hallo' } }] } },
          ...over,
        },
      ],
    });

  it('names a brand\'s marks as the template store does', () => {
    expect([...EMAIL_BRAND_MARKS].sort()).toEqual([...emailMarkSchema.options].sort());
  });

  it('keeps the line, the kind, the purpose, the brand and the files, and lets go of a file no mail names', async () => {
    const files = library();
    harness = await installHarness('sqlite', { library: files });
    const h = harness;
    const reply = await h.install(mailing('1.0.0', [{ file: 'emails/terms.pdf' }]), {}, { 'emails/terms.pdf': PDF });
    expect(reply.statusCode, reply.body).toBe(200);

    expect((await optionListsRepo(h.meta).findByKey('shop-sizes'))?.items).toEqual([{ value: 's', label: 'Small', description: 'Up to 250 ml' }, { value: 'l', label: 'Large' }]);

    const templates = emailTemplatesRepo(h.meta);
    const en = (await templates.findByKeyLocale('shop-news', 'en_US'))!;
    const de = (await templates.findByKeyLocale('shop-news', 'de_DE'))!;
    expect(en).toMatchObject({ kind: 'campaign', category: 'marketing', brand: BRAND, managedBy: 'shop' });
    expect(en.attachments).toHaveLength(1);
    const [attached] = en.attachments as { id: string; kind: 'file'; fileId: string }[];
    // One file for both languages, kept in the library with the package's bytes and claimed.
    expect(de.attachments).toEqual(en.attachments);
    expect(files.kept.get(attached!.fileId)?.toString()).toBe(PDF);
    const file = (await filesRepo(h.meta).findById(attached!.fileId))!;
    expect(file).toMatchObject({ filename: 'terms.pdf', mime: 'application/pdf', deletedAt: null });
    expect(file.attachedAt).not.toBeNull();

    // An update that carries the same file keeps the same one; a new file is kept and the old one goes to the bin.
    await h.stage(mailing('1.1.0', [{ file: 'emails/terms.pdf' }], { name: 'News!' }), { 'emails/terms.pdf': PDF });
    expect((await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} })).statusCode).toBe(200);
    const same = (await templates.findByKeyLocale('shop-news', 'en_US'))!;
    expect(same.name).toBe('News!');
    expect(same.attachments).toEqual(en.attachments);
    expect(files.kept.size).toBe(1);

    await h.stage(mailing('1.2.0', [{ file: 'emails/terms.pdf' }]), { 'emails/terms.pdf': `${PDF}% v2\n` });
    expect((await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} })).statusCode).toBe(200);
    const fresh = (await templates.findByKeyLocale('shop-news', 'en_US'))!.attachments as { fileId: string }[];
    expect(fresh[0]!.fileId).not.toBe(attached!.fileId);
    expect((await filesRepo(h.meta).findById(attached!.fileId))?.deletedAt).not.toBeNull();

    // The operator edits the German one: the uninstall leaves it, and the file it still names stays in the library.
    const german = (await templates.findByKeyLocale('shop-news', 'de_DE'))!;
    await templates.upsert('shop-news', 'de_DE', { name: german.name, subject: 'Neues von uns', blocks: german.blocks, enabled: true });
    const gone = await h.inject({ method: 'DELETE', url: '/apps/shop' });
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await templates.findByKeyLocale('shop-news', 'en_US')).toBeNull();
    expect((await templates.findByKeyLocale('shop-news', 'de_DE'))?.subject).toBe('Neues von uns');
    expect((await filesRepo(h.meta).findById(fresh[0]!.fileId))?.deletedAt).toBeNull();
  });

  it('takes the files away with the last mail that names them', async () => {
    const files = library();
    harness = await installHarness('sqlite', { library: files });
    const h = harness;
    expect((await h.install(mailing('1.0.0', [{ file: 'emails/terms.pdf' }]), {}, { 'emails/terms.pdf': PDF })).statusCode).toBe(200);
    const fileId = ((await emailTemplatesRepo(h.meta).findByKeyLocale('shop-news', 'en_US'))!.attachments[0] as { fileId: string }).fileId;
    expect((await h.inject({ method: 'DELETE', url: '/apps/shop' })).statusCode).toBe(200);
    expect((await filesRepo(h.meta).findById(fileId))?.deletedAt).not.toBeNull();
  });

  it('refuses a file the package lacks, a kind no mail carries, and files where there is no library', async () => {
    harness = await installHarness('sqlite', { library: library() });
    // Each is said by the check, before a table is made.
    const refused = async (reply: { statusCode: number; body: string }, words: string) => {
      expect(reply.statusCode, reply.body).toBe(422);
      expect(JSON.parse(reply.body)).toMatchObject({ error: { details: { reason: 'PLAN_REFUSED' } } });
      expect(reply.body).toContain(words);
      expect(await harness!.rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orders'`)).toEqual([]);
    };
    await refused(await harness.install(mailing('1.0.0', [{ file: 'emails/terms.pdf' }])), 'carries \\"emails/terms.pdf\\", which its package does not hold');
    await harness.close();
    harness = await installHarness('sqlite', { library: library() });
    await refused(
      await harness.install(mailing('1.0.0', [{ file: 'emails/logo.svg' }]), {}, { 'emails/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }),
      'which is not a kind of file an email carries',
    );
    await harness.close();
    harness = await installHarness('sqlite');
    await refused(await harness.install(mailing('1.0.0', [{ file: 'emails/terms.pdf' }]), {}, { 'emails/terms.pdf': PDF }), 'this server has no Files library to keep it in');
  });
});

describe('a page\'s envelope and views', () => {
  const ENVELOPE = { v: 1, kind: 'crud', template: 'page-crud', config: { pageSize: 50 } };
  const VIEWS = [{ v: 1, kind: 'filters', name: 'Open', isDefault: true, config: { filters: [] } }];

  it('are planned and installed: the page as arranged, its views shared', async () => {
    harness = await installHarness('sqlite');
    const h = harness;
    const m = shop('1.0.0', { pages: [{ ...page, envelope: ENVELOPE, views: VIEWS }], provenance: { lineage: 'lin_8f2kq1x9a0', savedAt: '2026-11-05T10:00:00Z', adminiumVersion: '0.3.49' } });
    await h.stage(m);
    const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } });
    expect(plan.statusCode, plan.body).toBe(200);
    const install = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } });
    expect(install.statusCode, install.body).toBe(200);
    const [orders] = await h.meta.db.selectFrom('adminium_pages').select(['id', 'config']).where('slug', '=', 'orders').execute();
    expect((JSON.parse(String(orders!.config)) as { config: { pageSize: number } }).config.pageSize).toBe(50);
    const views = await h.meta.db.selectFrom('adminium_views').select(['name', 'userId']).where('pageId', '=', orders!.id).execute();
    expect(views).toEqual([{ name: 'Open', userId: null }]);
  });

  it('are written by an update too, and the provenance alone installs and is kept with the app', async () => {
    harness = await installHarness('sqlite');
    const h = harness;
    const provenance = { lineage: 'lin_8f2kq1x9a0', savedAt: '2026-11-05T10:00:00Z', adminiumVersion: '0.3.49', label: 'First' };
    expect((await h.install(shop('1.0.0', { provenance }))).statusCode).toBe(200);
    const stored = (await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).list('app')).find((m) => m.row.manifestKey === 'shop');
    expect((stored?.document as { provenance?: unknown } | undefined)?.provenance).toEqual(provenance);
    // The same dashboard saved again: its lineage is the one installed.
    await h.stage(shop('1.1.0', { pages: [{ ...page, envelope: ENVELOPE }], provenance: { ...provenance, savedAt: '2026-11-06T10:00:00Z' } }));
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
    expect(updated.statusCode, updated.body).toBe(200);
  });
});
