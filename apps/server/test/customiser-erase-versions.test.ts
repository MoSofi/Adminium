// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CUSTOMER'S DESIGN VERSIONS, ERASED WITH THEM, IN THE CUSTOMISER AS BUILT.
 *
 * A proof of a customer's design is a version of it (`design_versions`, its
 * words copied into `values`, its proof picture in `proof_file`), and each
 * version has its production files (`version_files`). The print shop says so
 * in its people entry: a copy on the design, and copies reached one and two
 * links further into the Customiser (`from: ["design_id"]`, `from:
 * ["version_id", "design_id"]`). Erasing the customer blanks the words on her
 * design and on each of its versions, empties the version's proof and
 * production file columns, and deletes those files — and leaves another
 * customer's design, versions and files whole. The search finds the versions
 * too, and the preview counts the files.
 *
 * The app's link into the add-on (`order_lines.design_id`, an `addOnLink`)
 * has no foreign key behind it. Each engine is run twice: once with the
 * snapshot's guess at that link (a column named after the table it points
 * at), and once without it — as a shop's own snapshot may hold no guess (the
 * Maker walk's had none) — where the link the app's manifest declares is what
 * leads to the versions. Either way her order line is the shop's record of a
 * sale, kept by law: its words are found and stay; the versions' words and
 * files go, and a deleted file is no longer served.
 *
 * The Customiser is taken from a checkout of the add-ons repository, built
 * (`ADMINIUM_ADD_ONS_REPO`, `npm run build` in `packages/customiser`); without
 * it the suite is skipped, by name. On every engine this run can reach.
 */
import { filesRepo, overridesRepo, rolesRepo, snapshotsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { builtAddOn } from './add-ons/harness.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const CUSTOMISER = 'customiser';
const built = builtAddOn(CUSTOMISER);
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;
const MARTA = 'marta@example.com';
const BEN = 'ben@example.com';
const VIA = 'order_lines.design_id';
const AT = '2026-11-01 10:00:00';

function printShop(): Doc {
  return {
    manifestVersion: 1,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    kind: 'app',
    key: 'printing',
    name: 'Print shop',
    version: '1.0.0',
    description: { key: 'mft.printing.desc', fallback: 'A shop.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.44', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'customers', keyField: 'name', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
        { ref: 'orders', columns: [pk, { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
        {
          ref: 'order_lines',
          keep: { law: 'tax' },
          columns: [
            pk,
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            { ref: 'lettering', type: 'text', maxLength: 80, nullable: true },
            { ref: 'design_id', type: 'int', nullable: true, rules: { addOnLink: { addOn: CUSTOMISER, table: 'designs' } } },
          ],
        },
      ],
    },
    pages: [{ ref: 'printing-home', template: 'page-dashboard', title: { key: 'mft.printing.page.home', fallback: 'Home' }, nav: { group: 'manifest:sample', icon: 'layout-dashboard', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
    addOns: { requires: [{ key: CUSTOMISER, range: '^1.0.0', reason: { 'en-US': 'Customers make their cards their own.' } }] },
    people: [
      {
        table: 'customers',
        kind: 'people',
        email: 'email',
        name: 'name',
        copies: [
          { table: 'orders', column: 'email', holds: 'email', via: 'customer_id' },
          { table: 'order_lines', column: 'lettering', holds: 'details', via: 'customer_id' },
          { addOn: CUSTOMISER, table: 'designs', column: 'values', holds: 'details', via: VIA },
          { addOn: CUSTOMISER, table: 'design_versions', column: 'values', holds: 'details', via: VIA, from: ['design_id'] },
          { addOn: CUSTOMISER, table: 'design_versions', column: 'proof_file', holds: 'details', via: VIA, from: ['design_id'] },
          { addOn: CUSTOMISER, table: 'version_files', column: 'file', holds: 'details', via: VIA, from: ['version_id', 'design_id'] },
        ],
      },
    ],
  };
}

const RUNS = LEGS.flatMap(([dialect, available]) => [[dialect, 'guessed', available] as const, [dialect, 'declared only', available] as const]);

describe.each(RUNS)("a customer's design versions, erased with them — %s, the link %s", (dialect, link, available) => {
  const runs = available && built !== null;
  let h: Harness;
  let served: Served;
  let cookie: string;
  const files: Record<string, string> = {};
  const send = (url: string, payload: Doc) => served.composed.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie }, payload });
  /** `values` and `version` are words SQL keeps for itself: each is named in the engine's quotes. */
  const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
  const versions = async () => h.rows(`SELECT id, ${q('values')} AS words, proof_file FROM customiser_design_versions ORDER BY id`);
  const productionFiles = async () => h.rows('SELECT id, file FROM customiser_version_files ORDER BY id');
  /** A file kept for one row of an add-on's table, its id written into the row. */
  const fileFor = async (name: string, table: string, id: number): Promise<string> => {
    const file = await filesRepo(h.meta).create({ filename: `${name}.pdf`, mime: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64), kind: 'upload', uploadedBy: null, entity: { connectionId: h.connectionId, table, pk: { id }, label: String(id) } } as never);
    files[name] = file.id;
    return file.id;
  };

  beforeAll(async () => {
    if (!runs) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(built!.manifest, { files: built!.files });
    await h.stageApp(printShop());
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: CUSTOMISER, version: built!.version }] });
    expect(installed.statusCode, installed.body).toBe(200);
    await h.rows(`INSERT INTO printing_customers (id, name, email) VALUES (1, 'Marta Kovac', '${MARTA}'), (2, 'Ben Other', '${BEN}')`);
    await h.rows(`INSERT INTO printing_orders (id, customer_id, email) VALUES (1, 1, '${MARTA}'), (2, 2, '${BEN}')`);
    await h.rows(
      `INSERT INTO customiser_designs (id, app, code, ${q('values')}, created_at, updated_at) VALUES (1, 'printing', 'AAAABBBBCCCCDDD1', '{"line1":"Marta & Jo"}', '${AT}', '${AT}'), (2, 'printing', 'AAAABBBBCCCCDDD2', '{"line1":"For Ben"}', '${AT}', '${AT}')`,
    );
    await h.rows(`INSERT INTO printing_order_lines (id, order_id, customer_id, lettering, design_id) VALUES (1, 1, 1, 'Marta & Jo', 1), (2, 2, 2, 'For Ben', 2)`);
    // Marta's design has two versions, Ben's one; each version one production file.
    await h.rows(
      `INSERT INTO customiser_design_versions (id, app, design_id, ${q('version')}, ${q('values')}, made_at) VALUES (1, 'printing', 1, 1, '{"line1":"Marta & Jo"}', '${AT}'), (2, 'printing', 1, 2, '{"line1":"Marta & Jo 1985"}', '${AT}'), (3, 'printing', 2, 1, '{"line1":"For Ben"}', '${AT}')`,
    );
    await h.rows(`INSERT INTO customiser_version_files (id, app, version_id, kind, name, made_at) VALUES (1, 'printing', 1, 'print', 'v1.pdf', '${AT}'), (2, 'printing', 2, 'print', 'v2.pdf', '${AT}'), (3, 'printing', 3, 'print', 'ben.pdf', '${AT}')`);
    for (const [name, table, id] of [['proof1', 'customiser_design_versions', 1], ['proof3', 'customiser_design_versions', 3]] as const) {
      await h.rows(`UPDATE ${table} SET proof_file = '${await fileFor(name, table, id)}' WHERE id = ${String(id)}`);
    }
    for (const [name, id] of [['file1', 1], ['file2', 2], ['file3', 3]] as const) {
      await h.rows(`UPDATE customiser_version_files SET file = '${await fileFor(name, 'customiser_version_files', id)}' WHERE id = ${String(id)}`);
    }
    if (link === 'declared only') {
      // The snapshot holds no guess at the line's link into the designs: only the app's manifest says where it leads.
      const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
      const relations = ((snapshot?.schema as { relations?: { from: { tableId: string; columns: string[] }; to: { tableId: string } }[] } | undefined)?.relations ?? []).filter(
        (relation) => relation.from.tableId.endsWith('printing_order_lines') && relation.from.columns.includes('design_id'),
      );
      for (const relation of relations) {
        await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'relation.remove' as never, tableName: relation.from.tableId, columnName: null, value: { fromColumn: 'design_id', toTable: relation.to.tableId } as never, origin: 'user' } as never);
      }
    }
    served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    const officer = await usersRepo(h.meta).create({ email: 'pia@shop.dev', name: 'Pia', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(officer.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.8.0.1', payload: { email: 'pia@shop.dev', password: ADMIN_PASSWORD } });
    cookie = sessionCookie(login.headers['set-cookie']);
  }, 240_000);
  afterAll(async () => {
    if (!runs) return;
    await served?.close();
    await h?.close();
  });

  it.skipIf(built !== null)('is skipped: no built Customiser (set ADMINIUM_ADD_ONS_REPO and run `npm run build` in packages/customiser)', () => {
    expect(built).toBeNull();
  });

  it.skipIf(!runs)("a search for her lists her design's versions and their files, and no one else's", async () => {
    const res = await send('/privacy/find', { address: MARTA });
    expect(res.statusCode, res.body).toBe(200);
    const sources = (res.json() as { data: { sources: { kind: string; table: string | null; keys: string[] }[] } }).data.sources.filter((source) => source.kind === 'copy');
    const keysOn = (table: string) => sources.filter((source) => (source.table ?? '').endsWith(table)).flatMap((source) => source.keys).sort();
    expect(keysOn('customiser_designs')).toEqual(['1']);
    expect(keysOn('customiser_design_versions')).toEqual(['1', '2']);
    expect(keysOn('customiser_version_files')).toEqual(['1', '2']);
  });

  it.skipIf(!runs)('erasing her blanks the words on her versions, empties their files and deletes them; Ben keeps his', async () => {
    const preview = await send('/privacy/erase/preview', { address: MARTA });
    expect(preview.statusCode, preview.body).toBe(200);
    const goes = (preview.json() as { data: { goes: { kind: string; table?: string; count: number }[] } }).data.goes;
    expect(goes.find((item) => (item.table ?? '').endsWith('customiser_design_versions'))?.count).toBe(2);
    expect(goes.find((item) => item.kind === 'files')?.count).toBe(3);
    const res = await send('/privacy/erase', { address: MARTA, confirm: MARTA });
    expect(res.statusCode, res.body).toBe(200);
    const after = await versions();
    expect(after.map((row) => [Number(row['id']), row['proof_file'] ?? null])).toEqual([
      [1, null],
      [2, null],
      [3, files['proof3']],
    ]);
    // Her words are gone from both of her versions (an empty value of the column's own), his are whole.
    expect(JSON.stringify(after.slice(0, 2).map((row) => row['words']))).not.toContain('Marta');
    expect(JSON.stringify(after[2]!['words'])).toContain('For Ben');
    expect((await productionFiles()).map((row) => row['file'] ?? null)).toEqual([null, null, files['file3']]);
    const left = (await h.meta.db.selectFrom('adminium_files').select('id').execute()).map((row) => row.id);
    expect(left).not.toContain(files['proof1']);
    expect(left).not.toContain(files['file1']);
    expect(left).not.toContain(files['file2']);
    expect(left).toEqual(expect.arrayContaining([files['proof3'], files['file3']]));
    // A deleted file is no longer served; his still is.
    for (const name of ['proof1', 'file1', 'file2']) {
      const content = await served.composed.app.inject({ method: 'GET', url: `/api/v1/files/${files[name]!}`, headers: { cookie } });
      expect(content.statusCode, name).toBe(404);
    }
    expect((await served.composed.app.inject({ method: 'GET', url: `/api/v1/files/${files['file3']!}`, headers: { cookie } })).statusCode).toBe(200);
    // Her order line is the shop's record of a sale: its words stay.
    expect((await h.rows('SELECT id, lettering FROM printing_order_lines ORDER BY id')).map((row) => row['lettering'])).toEqual(['Marta & Jo', 'For Ben']);
  });
});
