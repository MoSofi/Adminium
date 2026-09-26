// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An installed app updated in place, with rows in it, to a version that adds
 * to it — what a studio sees the morning after, on every engine this run can
 * reach.
 *
 * The update gives the app's own guest key the new public entry the operator
 * allowed (and nothing it does not declare); keeps the key a shared link opens
 * rows with, so every link already sent still opens; adds its new columns
 * with the one-of-a-kind rule and the default a fresh install has; rebuilds a
 * SQLite table without quoting its text defaults again; and leaves the sample
 * rows it widened reading as the sample wrote them.
 */
import { auditRepo, publicKeysRepo, schemaChangesRepo } from '@adminium/meta';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { desiredTableSchema, parseEnumCheck, type DatabaseModel, type TableModel } from '@adminium/engine';

import { createAppStore } from '../src/apps/store.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { applyServerEdit } from '../src/schema-ddl/programmatic.js';
import { TEST_SECRET } from './helpers.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { sha512Integrity } from '../src/add-ons/store.js';
import type { FileStore } from '../src/files/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

const TOKEN = 'HARBRXNKSTWYZ2026'.slice(0, 16);
const id = { ref: 'id', type: 'int', role: 'pk' };

/**
 * 0.2.0; the 0.2.1 that links a line to the hours it bills, once each, and
 * takes enquiries from the web; and a 0.2.2 that no longer shares projects by
 * link.
 */
function manifest(version: '0.2.0' | '0.2.1' | '0.2.2'): Record<string, unknown> {
  const next = version !== '0.2.0';
  const links = version !== '0.2.2';
  const lines = [
    id,
    { ref: 'description', type: 'text', maxLength: 80 },
    ...(next
      ? [
          // One line per hour entry: what stops the same hours being billed twice.
          { ref: 'time_entry_id', type: 'fk', references: 'time_entries', nullable: true, unique: true },
          { ref: 'ref_no', type: 'text', maxLength: 20, nullable: true, unique: true },
          // A code Adminium makes: unique as a fresh install keeps it, and as wide as its codes.
          { ref: 'line_code', type: 'text', nullable: true, rules: { code: { prefix: 'L-', length: 6 } } },
          { ref: 'copies', type: 'int', default: 1 },
          // A switch: off on every line already there, as on a new install.
          { ref: 'flagged', type: 'bool', default: false },
        ]
      : []),
  ];
  return {
    ...invoicingManifest([
      {
        ref: 'projects',
        columns: [
          id,
          { ref: 'name', type: 'text', maxLength: 120 },
          { ref: 'share_token', type: 'text', maxLength: 16, nullable: true, unique: true, rules: { code: { length: 16 } } },
        ],
      },
      { ref: 'time_entries', columns: [id, { ref: 'hours', type: 'int' }] },
      { ref: 'invoice_lines', columns: lines },
      {
        ref: 'messages',
        columns: [
          id,
          { ref: 'subject', type: 'text', maxLength: 80 },
          // Grows a value in 0.2.1, which SQLite takes by rebuilding the table.
          { ref: 'status', type: 'enum', enum: next ? ['queued', 'sent', 'held'] : ['queued', 'sent'], default: 'queued' },
        ],
      },
      { ref: 'faqs', columns: [id, { ref: 'question', type: 'text', maxLength: 120 }] },
      { ref: 'enquiries', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'email', type: 'text', maxLength: 120 }] },
    ]),
    version,
    compatibility: { minAdminiumVersion: '0.3.0', updatesFrom: '>=0.2.0' },
    sampleData: { file: 'seeds/studio.sample.json' },
    ...(links ? { publicKeys: { handover: {} } } : {}),
    publicAccess: [
      { table: 'faqs', methods: ['GET'], select: ['question'] },
      ...(links ? [{ table: 'projects', methods: ['GET'], select: ['name'], claim: { by: 'token', column: 'share_token' }, key: 'handover' }] : []),
      ...(next ? [{ table: 'enquiries', methods: ['POST'], select: ['id'], writable: ['name', 'email'] }] : []),
    ],
  };
}

const SAMPLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    { ref: 'time_entries', rows: [{ hours: 2 }, { hours: 3 }] },
    { ref: 'invoice_lines', rows: [{ description: 'Logo' }, { description: 'Poster' }] },
    { ref: 'messages', rows: [{ subject: 'Welcome' }, { subject: 'Reminder', status: 'sent' }] },
    { ref: 'faqs', rows: [{ question: 'How long does a logo take?' }] },
  ],
};
const FILES = { 'seeds/studio.sample.json': JSON.stringify(SAMPLE) };

describe.each(LEGS)('an app updated in place — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let keys: Record<string, string>;
  let plan: { checksum: string; publicAccess: { endpoints: { ref: string; onUpdate?: string }[] } };
  let updated: { app: { publicAccess: { granted?: Record<string, string[]>; skipped: unknown[]; keys: Record<string, string> } } };
  const stageVersion = async (version: '0.2.1' | '0.2.2') => {
    const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest(version)), 'staff/index.html': '<!doctype html><html></html>', ...FILES });
    const staged = await h.app.inject({
      method: 'POST',
      url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(tarball),
    });
    expect(staged.statusCode, staged.body).toBe(200);
  };
  const introspected = async (ref: string) => {
    const adapter = await h.manager.introspectAdapter(h.connectionId);
    try {
      const model = await adapter.introspect({ tableFilter: (t) => t.name === h.real(ref), collectRowEstimates: false, collectActivityStats: false });
      return model.tables.find((t) => t.name === h.real(ref))!;
    } finally {
      await adapter.close();
    }
  };
  const claim = () =>
    served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim/token', headers: served.headers(), payload: { token: TOKEN } });

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest('0.2.0'), undefined, FILES);
    keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    expect(Object.keys(keys).sort()).toEqual(['customer', 'handover']);
    const service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
    await service.add((await findSampleApp(h.meta, 'studio'))!, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });
    // The studio's own project, whose handover link has been sent.
    await h.rows(`INSERT INTO ${h.real('projects')} (name, share_token) VALUES ('Harbour rebrand', '${TOKEN}')`);
    served = await servePublic(h, keys['handover']!);
    const before = await claim();
    expect(before.statusCode, before.body).toBe(200);

    await stageVersion('0.2.1');
    const planned = await h.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'studio', version: '0.2.1', connectionId: h.connectionId } });
    expect(planned.statusCode, planned.body).toBe(200);
    plan = planned.json().plan;
    // The operator ticked "Allow this public access" on the check.
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update', payload: { planChecksum: plan.checksum, publicAccess: true } });
    expect(res.statusCode, res.body).toBe(200);
    updated = res.json();
  }, 180_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('shows the check what the new version adds to the public access, and what its keys hold already', () => {
    const states = Object.fromEntries(plan.publicAccess.endpoints.map((e) => [e.ref, e.onUpdate]));
    expect(states).toEqual({ studio_faqs: 'held', studio_projects_claimed: 'held', studio_enquiries: 'granted' });
  });

  it.skipIf(!available)('gives the guests’ key the new enquiry form it was allowed, and the reply and the audit say so', async () => {
    expect(updated.app.publicAccess.granted).toEqual({ customer: ['studio_enquiries'] });
    expect(updated.app.publicAccess.skipped).toEqual([]);
    // No key made again: the two the install made are the app's still.
    expect(updated.app.publicAccess.keys).toEqual({});
    await served.useKey(keys['customer']!);
    const sent = await served.post('/records/studio_enquiries', { values: { name: 'Rosa Vento', email: 'rosa@example.com' } });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(await h.rows(`SELECT name FROM ${h.real('enquiries')}`)).toEqual([{ name: 'Rosa Vento' }]);
    // What it does not declare, it does not get: the lines stay out of reach.
    expect((await served.get('/records/studio_invoice_lines')).statusCode).toBeGreaterThanOrEqual(400);
    const audit = await auditRepo(h.meta).list({ limit: 200 });
    expect(audit.filter((row) => row.action === 'public-key.grant').map((row) => (row.changes as { after: unknown }).after)).toEqual([
      expect.objectContaining({ keyId: keys['customer'], purpose: 'customer', granted: ['studio_enquiries'] }),
    ]);
  });

  it.skipIf(!available)('keeps the key a shared link opens rows with: the link already sent still opens', async () => {
    expect((await publicKeysRepo(h.meta).findById(keys['handover']!))!.revokedAt).toBeNull();
    await served.useKey(keys['handover']!);
    const after = await claim();
    expect(after.statusCode, after.body).toBe(200);
  });

  it.skipIf(!available)('adds a column that must be one of a kind with its unique rule, as a fresh install has it', async () => {
    const entry = (await h.rows(`SELECT id FROM ${h.real('time_entries')} ORDER BY id`))[0]!['id'];
    await h.rows(`INSERT INTO ${h.real('invoice_lines')} (description, time_entry_id, ref_no) VALUES ('Two hours', ${String(entry)}, 'R-1')`);
    // The same hours on a second line, and the same reference: both refused by the database.
    await expect(h.rows(`INSERT INTO ${h.real('invoice_lines')} (description, time_entry_id) VALUES ('Again', ${String(entry)})`)).rejects.toThrow();
    await expect(h.rows(`INSERT INTO ${h.real('invoice_lines')} (description, ref_no) VALUES ('Again', 'R-1')`)).rejects.toThrow();
    await h.rows(`INSERT INTO ${h.real('invoice_lines')} (description, line_code) VALUES ('Coded', 'L-ABC123')`);
    await expect(h.rows(`INSERT INTO ${h.real('invoice_lines')} (description, line_code) VALUES ('Coded again', 'L-ABC123')`)).rejects.toThrow();
    // Empty is not a value: any number of lines bill no hours.
    await h.rows(`INSERT INTO ${h.real('invoice_lines')} (description) VALUES ('Printing')`);
    await h.rows(`INSERT INTO ${h.real('invoice_lines')} (description) VALUES ('Framing')`);
  });

  it.skipIf(!available)('adds a column with its default, for the rows already there and the ones to come', async () => {
    const rows = await h.rows(`SELECT description, copies, flagged FROM ${h.real('invoice_lines')} WHERE description IN ('Logo', 'Printing') ORDER BY description`);
    const off = (value: unknown) => value === false || value === 0 || value === '0';
    expect(rows.map((row) => [row['description'], Number(row['copies']), off(row['flagged'])])).toEqual([
      ['Logo', 1, true],
      ['Printing', 1, true],
    ]);
  });

  it.skipIf(!available)('adds them in place on SQLite, never rebuilding the table, and reads each back as one of a kind', async () => {
    // What the update ran, per table: the lines' columns and their rules, and on SQLite the one rebuild a new choice value needs.
    const steps = (await schemaChangesRepo(h.meta).listForConnection(h.connectionId)).flatMap((change) => change.steps);
    const on = (ref: string) => steps.filter((step) => step.table.endsWith(h.real(ref))).map((step) => step.kind);
    expect(on('invoice_lines')).not.toContain('rebuild-table');
    expect(on('invoice_lines').filter((kind) => kind === 'add-column')).toHaveLength(5);
    expect(on('invoice_lines').filter((kind) => kind === (dialect === 'sqlite' ? 'add-index' : 'add-unique'))).toHaveLength(3);
    expect(on('messages').includes('rebuild-table')).toBe(dialect === 'sqlite');
    if (dialect === 'sqlite') {
      const indexes = await h.rows(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${h.real('invoice_lines')}' ORDER BY name`);
      expect(indexes.map((i) => [i['name'], /^CREATE UNIQUE INDEX/.test(String(i['sql']))])).toEqual([
        ['uq_studio_invoice_lines_line_code', true],
        ['uq_studio_invoice_lines_ref_no', true],
        ['uq_studio_invoice_lines_time_entry_id', true],
      ]);
    }
    const unique = Object.fromEntries((await introspected('invoice_lines')).columns.map((c) => [c.name, c.isUnique]));
    expect(unique).toMatchObject({ time_entry_id: true, ref_no: true, line_code: true, copies: false, flagged: false, description: false });
  });

  it.skipIf(!available)('keeps a text default as it was when the update rebuilds the table', async () => {
    await h.rows(`INSERT INTO ${h.real('messages')} (subject) VALUES ('Mounting')`);
    expect(await h.rows(`SELECT status FROM ${h.real('messages')} WHERE subject = 'Mounting'`)).toEqual([{ status: 'queued' }]);
    if (dialect === 'sqlite') {
      const declared = await h.rows(`SELECT dflt_value FROM pragma_table_info('${h.real('messages')}') WHERE name = 'status'`);
      expect(declared).toEqual([{ dflt_value: "'queued'" }]);
    }
  });

  it.skipIf(!available)('reads the sample rows it widened as the sample wrote them: only a value put there since is a change', async () => {
    const remove = async () => (await h.app.inject({ method: 'POST', url: '/apps/studio/sample-data/remove-plan' })).json() as { changed: { ref: string; columns: string[] }[] };
    expect((await remove()).changed).toEqual([]);
    const logo = (await h.rows(`SELECT id FROM ${h.real('invoice_lines')} WHERE description = 'Logo'`))[0]!['id'];
    await h.rows(`UPDATE ${h.real('invoice_lines')} SET copies = 2 WHERE id = ${String(logo)}`);
    expect((await remove()).changed.map((c) => [c.ref, c.columns])).toEqual([['invoice_lines', ['copies']]]);
  });

  it.skipIf(!available)('takes the shared link’s key back once a version no longer declares it', async () => {
    await stageVersion('0.2.2');
    // The next version finds the added columns as it declares them: nothing to add again.
    const next = await h.app.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'studio', version: '0.2.2', connectionId: h.connectionId } });
    expect(next.statusCode, next.body).toBe(200);
    const tables = (next.json() as { plan: { problems: unknown[]; tables: { ref: string; edits: unknown[] }[] } }).plan;
    expect(tables.problems).toEqual([]);
    expect(tables.tables.filter((t) => t.edits.length > 0)).toEqual([]);
    const res = await h.app.inject({ method: 'POST', url: '/apps/studio/update' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await publicKeysRepo(h.meta).findById(keys['handover']!))!.revokedAt).not.toBeNull();
    expect((await publicKeysRepo(h.meta).findById(keys['customer']!))!.revokedAt).toBeNull();
    // A server that never saw the key (this one's resolver still holds it for its 30 s): the link is closed.
    const fresh = await servePublic(h, keys['handover']!);
    try {
      const refused = await fresh.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim/token', headers: fresh.headers(), payload: { token: TOKEN } });
      expect(refused.statusCode).toBe(401);
    } finally {
      await fresh.close();
    }
  });

  it.skipIf(!available)('renames such a column in the schema editor, still one of a kind, and then removes it', async () => {
    const deps = { meta: h.meta, manager: h.manager, crypto: dsnCryptoFromSecret(TEST_SECRET) };
    const table = (model: DatabaseModel) => model.tables.find((t) => t.name === h.real('invoice_lines'))!;
    const renamed = await applyServerEdit(
      deps,
      h.connectionId,
      (model) => ({ renames: { tables: [], columns: [{ table: table(model).id, from: 'ref_no', to: 'ref_code' }] } }),
      { superAdmin: true, createdBy: null },
    );
    expect(renamed.status, JSON.stringify(renamed)).toBe('applied');
    // A schema change hands out a new connection: read through the one there is now.
    const run = async (statement: string) => sql.raw(statement).execute((await h.manager.data(h.connectionId)).db);
    await run(`INSERT INTO ${h.real('invoice_lines')} (description, ref_code) VALUES ('Renamed', 'R-9')`);
    await expect(run(`INSERT INTO ${h.real('invoice_lines')} (description, ref_code) VALUES ('Renamed again', 'R-9')`)).rejects.toThrow();
    expect((await introspected('invoice_lines')).columns.find((c) => c.name === 'ref_code')?.isUnique).toBe(true);

    // Removed as the table designer removes a column, from the schema as it now reads: the table restated without it, or its index.
    await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
    const removed = await applyServerEdit(deps, h.connectionId, (model) => ({ upsertTables: [restated(model, table(model), 'ref_code')] }), {
      superAdmin: true,
      createdBy: null,
    });
    expect(removed.status, JSON.stringify(removed)).toBe('applied');
    expect(removed.steps.map((step) => step.kind)).toEqual(dialect === 'sqlite' ? ['drop-index', 'drop-column'] : expect.arrayContaining(['drop-column']));
    const left = (await introspected('invoice_lines')).columns.map((c) => c.name);
    expect(left).not.toContain('ref_code');
    expect(left).toEqual(expect.arrayContaining(['time_entry_id', 'line_code', 'copies', 'flagged']));
    // The rest keep theirs.
    expect((await introspected('invoice_lines')).columns.find((c) => c.name === 'line_code')?.isUnique).toBe(true);
  });
});

/** A table as the designer restates it, less one column and whatever names it. */
function restated(model: DatabaseModel, table: TableModel, drop: string) {
  const enumValues: Record<string, string[]> = {};
  for (const check of table.checks) {
    const parsed = parseEnumCheck(check.expression, table.columns.map((c) => c.name));
    if (parsed !== null && parsed.column !== drop) enumValues[parsed.column] = parsed.values;
  }
  return desiredTableSchema.parse({
    id: table.id,
    schema: table.schema,
    name: table.name,
    comment: table.comment,
    columns: table.columns
      .filter((c) => c.name !== drop)
      .map((c) => ({
        name: c.name,
        logicalType: c.logicalType,
        nullable: c.nullable,
        default: c.default,
        maxLength: c.maxLength,
        numericPrecision: c.numericPrecision,
        numericScale: c.numericScale,
        comment: c.comment,
      })),
    primaryKey: table.primaryKey,
    uniques: table.uniques.filter((u) => !u.columns.includes(drop)),
    indexes: table.indexes
      .filter((i) => !i.primary && !i.name.startsWith('sqlite_autoindex_') && !i.columns.includes(drop))
      .map((i) => ({ name: i.name, columns: i.columns, unique: i.unique })),
    foreignKeys: model.relations
      .filter((r) => r.kind === 'declared-fk' && r.from.tableId === table.id && !r.from.columns.includes(drop))
      .map((r) => ({ name: r.constraintName, columns: r.from.columns, toTable: r.to.tableId, toColumns: r.to.columns, onDelete: r.onDelete, onUpdate: r.onUpdate })),
    enumValues,
  });
}
