#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Build the Kiln Street Pottery instance from nothing, over the API of a
 * running Adminium server. See README.md for what it makes and why.
 *
 *   node build.mjs --url http://127.0.0.1:4790 --email owner@kilnstreet.test --password <pw> \
 *     [--setup] [--session <file>] [--db <file.db> | --dsn <url>] [--replace]
 *
 * Also importable: `buildKiln(options)` returns what it made (ids and refs).
 */
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { signIn } from './client.mjs';
import * as K from './kiln.mjs';

const say = (line) => process.stdout.write(`[kiln] ${line}\n`);

/** An empty SQLite file for the connection to open (the adapter never creates one). */
function emptySqliteFile(path, replace) {
  if (existsSync(path) && statSync(path).size > 0) {
    if (!replace) throw new Error(`${path} already holds a database: pass --replace to start it again`);
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(path + suffix, { force: true });
  }
  writeFileSync(path, '');
}

/** The table id the snapshot gives `name` (`main.x` on SQLite, `public.x` on Postgres, `<db>.x` on MySQL). */
async function tableIds(c, connId) {
  const schema = await c.get(`/connections/${connId}/schema`);
  const ids = {};
  for (const t of schema.model.tables ?? []) ids[t.name] = t.id;
  return { snapshotId: schema.snapshotId, ids, schema };
}

/** Plan, then apply exactly that plan. Returns the apply reply. */
async function planAndApply(c, connId, edit) {
  const plan = await c.post(`/connections/${connId}/schema/plan`, edit);
  if (plan.refusals.length > 0) throw new Error(`the schema plan was refused: ${JSON.stringify(plan.refusals)}`);
  const applied = await c.post(`/connections/${connId}/schema/apply`, { ...edit, checksum: plan.checksum, acknowledgeRows: true });
  if (applied.status !== 'applied') throw new Error(`the schema apply ended ${applied.status}: ${JSON.stringify(applied.error)}`);
  return applied;
}

/** Write rows in order; returns their ids. Rows the server did not reach in time are sent again. */
async function insertRows(c, connId, tableId, rows) {
  const ids = new Array(rows.length).fill(null);
  let pending = rows.map((row, index) => ({ row, index }));
  for (let round = 0; pending.length > 0; round += 1) {
    if (round === 3) throw new Error(`${tableId}: ${String(pending.length)} rows not written after 3 rounds`);
    const reply = await c.post(`/data/${connId}/${tableId}/one-by-one`, { creates: pending.map((p) => p.row) });
    const again = [];
    for (const result of reply.results) {
      const p = pending[result.index];
      if (result.ok) ids[p.index] = result.id;
      else if (result.error?.code === 'NOT_RUN') again.push(p);
      else throw new Error(`${tableId} row ${String(p.index)}: ${JSON.stringify(result.error)}`);
    }
    pending = again;
  }
  return ids;
}

export async function buildKiln(options) {
  const { url, email, password, sessionFile = null, setup = false, replace = false, addOn = true } = options;
  const business = options.name ?? K.BUSINESS;
  const c = await signIn({ url, email, password, sessionFile, setup });
  say(`signed in at ${url}`);

  // ── 1. the database and its connection ────────────────────────────────────
  let dsn = options.dsn ?? null;
  let engine = options.engine ?? null;
  if (dsn === null) {
    const file = resolve(options.db ?? 'kiln-street.db');
    emptySqliteFile(file, replace);
    dsn = `sqlite:${file}`;
    engine = 'sqlite';
  }
  if (engine === null) engine = dsn.startsWith('postgres') ? 'postgres' : dsn.startsWith('mysql') ? 'mysql' : 'sqlite';
  const existing = (await c.get('/connections')).connections.find((x) => x.name === business);
  if (existing !== undefined) throw new Error(`a connection named "${business}" is already here: build on a fresh server`);
  const conn = await c.post('/connections', { name: business, engine, dsn });
  if (conn.readOnly || conn.status === 'error') throw new Error(`the new connection is not writable: ${JSON.stringify(conn).slice(0, 600)}`);
  await c.patch(`/connections/${conn.id}`, { timezone: K.TIMEZONE, currency: K.CURRENCY });
  // An empty database: introspect it (generate does that first) so Studio has a base snapshot.
  await c.post(`/connections/${conn.id}/generate`, {});
  say(`connection ${conn.id} (${engine})`);

  // ── 2. tables made in Studio: two plan + apply rounds, then adopted as pages ─
  let base = await tableIds(c, conn.id);
  if (!base.schema.schemaAuthoring.authorable) throw new Error(`Studio cannot make tables here: ${String(base.schema.schemaAuthoring.reason)}`);
  const round1 = await planAndApply(c, conn.id, { baseSnapshotId: base.snapshotId, upsertTables: K.PARENT_TABLES });
  base = await tableIds(c, conn.id);
  const prefix = base.ids.members.slice(0, base.ids.members.length - 'members'.length);
  const round2 = await planAndApply(c, conn.id, { baseSnapshotId: round1.snapshotId, upsertTables: K.CHILD_TABLES(prefix) });
  const adopted = await c.post(`/connections/${conn.id}/schema/adopt`, { tables: [...round1.createdTables, ...round2.createdTables] });
  const { ids: T } = await tableIds(c, conn.id);
  say(`tables ${K.TABLES.map((t) => T[t]).join(', ')}; pages ${JSON.stringify(adopted.result)}`);

  // ── 3. rows ────────────────────────────────────────────────────────────────
  const rows = {};
  rows.members = await insertRows(c, conn.id, T.members, K.MEMBERS);
  rows.classes = await insertRows(c, conn.id, T.classes, K.CLASSES);
  rows.firings = await insertRows(c, conn.id, T.firings, K.FIRINGS);
  const member = (n) => (n === null ? null : rows.members[n - 1]);
  const firing = (n) => (n === null ? null : rows.firings[n - 1]);
  rows.pieces = await insertRows(c, conn.id, T.pieces, K.PIECES.map((p) => ({ ...p, member_id: member(p.member_id), firing_id: firing(p.firing_id) })));
  rows.shop_orders = await insertRows(c, conn.id, T.shop_orders, K.SHOP_ORDERS.map((o) => ({ ...o, member_id: member(o.member_id) })));
  say(`rows ${K.TABLES.map((t) => `${t} ${String(rows[t].length)}`).join(', ')}`);

  // ── 4. an option list, bound to pieces.glaze; labels in two languages ───────
  await c.post('/option-lists', K.OPTION_LIST);
  // The PUT replaces every override, so what the server proposed (masks on emails) is carried over.
  const kept = (await c.get(`/connections/${conn.id}/overrides`)).overrides.map((o) => ({
    op: o.op, tableName: o.tableName, columnName: o.columnName, value: o.value, status: o.status,
  }));
  const ours = [
    { op: 'column.options', tableName: T.pieces, columnName: 'glaze', value: { list: K.OPTION_LIST.key } },
    ...Object.entries(K.TABLE_LABELS).map(([table, [[one, many], [un, plusieurs]]]) => ({
      op: 'table.label', tableName: T[table], columnName: null,
      value: { label: { en_US: one, [K.LOCALE]: un }, labelPlural: { en_US: many, [K.LOCALE]: plusieurs } },
    })),
    ...K.COLUMN_LABELS.map(([table, column, en, other]) => ({
      op: 'column.label', tableName: T[table], columnName: column, value: { label: { en_US: en, [K.LOCALE]: other } },
    })),
  ];
  const mine = new Set(ours.map((o) => `${o.op}|${o.tableName}|${o.columnName ?? ''}`));
  await c.put(`/connections/${conn.id}/overrides`, {
    overrides: [...kept.filter((o) => !mine.has(`${o.op}|${o.tableName}|${o.columnName ?? ''}`)), ...ours],
  });
  say(`option list "${K.OPTION_LIST.key}" on ${T.pieces}.glaze; ${String(ours.length - 1)} labels in en_US + ${K.LOCALE}`);

  // ── 5. the second language: en_US and fr_FR on, the rest off; edited wording ─
  const manifest = await c.get('/i18n/manifest');
  for (const l of manifest.locales ?? manifest.data?.locales ?? []) {
    const on = l.locale === 'en_US' || l.locale === K.LOCALE;
    if (l.enabled !== on) await c.patch(`/i18n/locales/${l.locale}`, { enabled: on });
  }
  for (const w of K.UI_WORDING) await c.put('/i18n/keys', { locale: K.LOCALE, ...w });
  say(`languages en_US + ${K.LOCALE}; ${String(K.UI_WORDING.length)} wording edit(s)`);

  // ── 6. a public endpoint: upcoming classes, read-only ──────────────────────
  await c.put('/public-api', { enabled: true });
  const endpoint = {
    path: `/${K.ENDPOINT.ref}`,
    source: T.classes,
    methods: ['GET'],
    select: K.ENDPOINT.select,
    filters: [],
    pagination: { default_limit: 20, max_limit: 100, order: K.ENDPOINT.order },
    auth: { role: 'anon' },
    rate_limit: { requests: 120, window: '1m' },
    response: { shape: 'object', envelope: 'data' },
  };
  await c.put(`/public-endpoints/${conn.id}/${K.ENDPOINT.ref}`, { definition: JSON.stringify(endpoint) });
  say(`public endpoint /${K.ENDPOINT.ref} over ${T.classes}`);

  // ── 7 and 8 (unless left out): the add-on, and a receipt drawn by it ───────
  let invoices = null;
  let profile = null;
  if (addOn) {
    // ── 7. an add-on: the bundled Invoices & Receipts ──────────────────────────
    // The server stages its bundled add-ons just after it starts listening: give it a few seconds.
    const staged = (a) => a !== undefined && (a.state === 'staged' || a.state === 'installed');
    invoices = undefined;
    for (let tries = 0; tries < 20; tries += 1) {
      invoices = (await c.get('/add-ons/catalog')).addOns.find((a) => a.key === 'invoices');
      if (staged(invoices)) break;
      await new Promise((done) => setTimeout(done, 500));
    }
    if (!staged(invoices)) {
      throw new Error('the invoices add-on is not staged on this server: start it with its bundled add-ons (README.md, "The add-on")');
    }
    if (invoices.state !== 'installed') await c.post('/add-ons', { key: 'invoices', version: invoices.version, attachTo: [] });
    say(`add-on invoices ${invoices.version}`);

    // ── 8. a document profile: a receipt for each shop order ───────────────────
    const kinds = (await c.get('/documents/kinds')).kinds.filter((k) => k.addOnKey === 'invoices');
    const kind = kinds.find((k) => k.kind === 'receipt') ?? kinds.find((k) => k.kind === 'invoice') ?? kinds[0];
    if (kind === undefined) throw new Error('the invoices add-on offers no document kind here');
    profile = await c.post('/documents/profiles', {
      addOnKey: 'invoices', kind: kind.kind, name: 'Shop receipt', connectionId: conn.id, table: T.shop_orders, mapping: {},
    });
    say(`document profile "${profile.name}" (${kind.kind}) on ${T.shop_orders}`);
  }

  // ── 9. a payment profile: shop orders are payable; pay at the counter ──────
  const payable = await c.post('/payments/payables', {
    connectionId: conn.id,
    tableId: T.shop_orders,
    mapping: {
      label: 'number',
      amount: { column: 'total', unit: null },
      currency: { connection: true },
      due: null,
      payments: { kind: 'kept' },
      status: { column: 'status', paid: 'paid', refunded: 'refunded' },
      customerEmail: 'customer_email',
      customerCountry: null,
      pageFields: ['number', 'ordered_on'],
    },
  });
  await c.put('/payments/ways/manual/cash-on-delivery', {
    enabled: true,
    rules: { countries: [], currencies: [], min: null, max: null, onlyFor: [] },
    // Keyed by language tag (`en-US`), not by locale id (`en_US`): the pay page reads it that way.
    label: K.WAY_LABEL,
    details: { note: 'Collect and pay at 14 Kiln Street, Tuesday to Saturday.' },
    position: 0,
  });
  say(`payable ${T.shop_orders} (profile ${payable.data.id}); pay at the counter`);

  return {
    connectionId: conn.id,
    engine,
    tables: T,
    rows,
    optionList: K.OPTION_LIST.key,
    locale: K.LOCALE,
    endpointRef: K.ENDPOINT.ref,
    addOn: invoices === null ? null : { key: 'invoices', version: invoices.version },
    documentProfileId: profile === null ? null : profile.id,
    payableProfileId: payable.data.id,
    client: c,
  };
}

// ── command line ─────────────────────────────────────────────────────────────

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
      setup: { type: 'boolean', default: false },
      session: { type: 'string' },
      db: { type: 'string' },
      dsn: { type: 'string' },
      replace: { type: 'boolean', default: false },
    },
  });
  const email = values.email ?? process.env.KILN_EMAIL;
  const password = values.password ?? process.env.KILN_PASSWORD;
  if (values.url === undefined || email === undefined || password === undefined) {
    process.stderr.write('usage: node build.mjs --url <server> --email <admin> --password <pw> [--setup] [--session <file>] [--db <file> | --dsn <url>] [--replace]\n');
    process.exit(2);
  }
  try {
    const made = await buildKiln({
      url: values.url, email, password, setup: values.setup, sessionFile: values.session ?? null,
      db: values.db, dsn: values.dsn ?? null, replace: values.replace,
    });
    delete made.client;
    process.stdout.write(`${JSON.stringify(made, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`[kiln] FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
