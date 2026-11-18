// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LANDING TABLE'S STAMP: a column of a landing table that is neither
 * nullable nor defaulted passes the add-on's contract when its role is a
 * moment Adminium stamps (`updated_at`, `created_at`), because Adminium fills
 * it on every write: the add-on installs, and a row its kit writes without the
 * column is stamped when made and again when changed, on SQLite, Postgres and
 * MySQL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { landingAddOn } from '../../../packages/manifest/test/landing-fixture.js';
import { createWriteService, type WriteContext, type WriteTarget } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

type Doc = Record<string, unknown>;

/** The landing add-on with an `updated_at` stamp on both tables and a `created_at` on the funnels, none nullable or defaulted. */
function stampedAddOn(): Doc {
  const doc = landingAddOn();
  const tables = (doc['requiredSchema'] as { tables: { ref: string; columns: Doc[] }[] }).tables;
  for (const table of tables) {
    table.columns = table.columns.filter((column) => column['ref'] !== 'updated_at');
    table.columns.push({ ref: 'updated_at', type: 'timestamptz', role: 'updated_at' });
  }
  tables.find((table) => table.ref === 'funnels')!.columns.push({ ref: 'made_on', type: 'timestamptz', role: 'created_at' });
  return doc;
}

/** A stamp as milliseconds, however the engine hands it back (a Date, or text with or without its zone). */
const at = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  const text = String(value).replace(' ', 'T');
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(text) ? text : `${text}Z`);
};

describe.each(LEGS)('a stamp on a landing table — %s', (dialect, available) => {
  let h: Harness;
  let funnels = '';
  let pages = '';
  const ctx: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'u1', label: 'pat' }, request: null };
  const targetOf = async (real: string): Promise<WriteTarget> => {
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    const handle = await h.manager.data(h.connectionId);
    return { connectionId: h.connectionId, view, table: view.table(real), db: handle.db, dialect: handle.dialect, timezone: 'UTC' };
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(stampedAddOn(), { bundled: true });
    const installed = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'landing-pages', version: '1.0.0', attachTo: ['dashboard'] } });
    expect(installed.statusCode, installed.body).toBe(200);
    for (const record of await h.meta.db.selectFrom('adminium_app_tables').select(['appKey', 'ref', 'tableName']).execute()) {
      if (record.appKey !== 'landing-pages') continue;
      if (record.ref === 'funnels') funnels = record.tableName;
      if (record.ref === 'pages') pages = record.tableName;
    }
  }, 300_000);

  afterAll(async () => {
    if (!available) return;
    await h?.close();
  });

  it.skipIf(!available)('stamps a funnel the kit writes without it, when made and when changed', async () => {
    const writes = createWriteService(writeStores(h.meta));
    const target = await targetOf(funnels);
    const made = await writes.create({ target, values: { name: 'Open day', steps: [] }, context: ctx, announce: async () => undefined });
    const key = made['id'];
    const [first] = await h.rows(`SELECT updated_at, made_on FROM ${funnels} WHERE id = ${String(key)}`);
    expect(first!['updated_at']).not.toBeNull();
    expect(first!['made_on']).not.toBeNull();
    // Changed a moment later: the stamp moves on, the made-on day stays.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await writes.update({ target, pk: { id: key }, values: { name: 'Open day, autumn' }, context: ctx, announce: async () => undefined });
    const [second] = await h.rows(`SELECT updated_at, made_on FROM ${funnels} WHERE id = ${String(key)}`);
    expect(at(second!['updated_at'])).toBeGreaterThan(at(first!['updated_at']));
    expect(at(second!['made_on'])).toBe(at(first!['made_on']));
  });

  it.skipIf(!available)('stamps a page the kit writes without it', async () => {
    const writes = createWriteService(writeStores(h.meta));
    const made = await writes.create({ target: await targetOf(pages), values: { name: 'Open day', slug: 'open-day', language: 'en-US', draft: { v: 1, title: 'Open day', description: '', blocks: [] } }, context: ctx, announce: async () => undefined });
    const [row] = await h.rows(`SELECT updated_at FROM ${pages} WHERE id = ${String(made['id'])}`);
    expect(row!['updated_at']).not.toBeNull();
  });
});
