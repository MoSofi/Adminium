// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COPY'S FILES IN THE BIN, ERASED WITH THE PERSON, AND COUNTED ALIKE.
 *
 * A shop keeps a proof of each customer's order (`proofs`, her words in
 * `words` and a picture of them in `picture`), declared as copies of her. A
 * proof made again sets `picture` a second time: the first picture leaves the
 * row's column for the bin, still the row's, and it shows her words as much
 * as the new one. Erasing her takes both, bytes and row; the search lists
 * the same files the preview counts and the erasure takes.
 *
 * The bin does not say which column a file was in, so the audit log's
 * images of the row's writes say it: a binned file goes when a column of
 * hers on the row held it. A document staff attached to her proof and
 * removed again, never in a column, stays the bin's (it may be put back).
 *
 * And what stays: a quote of hers (`quotes`) holds her picture as a copy and
 * the shop's terms in a file column that is no copy of hers; the terms stay,
 * the terms they replaced too, while the picture her quote held before goes.
 * A proof of hers that names Ben's picture does not take it: naming a file
 * is not taking it. Ben's proofs keep theirs, the binned one too. Her own
 * row's files go, the binned one too.
 *
 * On every engine this run can reach.
 */
import { auditRepo, filesRepo, newId, type StoredFile } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createConsentService } from '../src/consent/service.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import type { FileStore } from '../src/files/store.js';
import { erasePerson, previewErasure, type EraseDeps } from '../src/privacy/erase.js';
import { findPerson } from '../src/privacy/sources.js';
import { addOnHarness, appManifest, type Harness } from './app-add-ons.helpers.js';
import { TEST_SECRET } from './helpers.js';
import { createTestFileStore } from './helpers/file-store.js';
import { LEGS } from './invoicing-install.helpers.js';

const MARTA = 'marta@example.com';
const BEN = 'ben@example.com';
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;
const fileColumn = (ref: string) => ({ ref, type: 'text', maxLength: 64, nullable: true, rules: { file: { accept: ['pdf'], maxBytes: 1048576 } } });

function shop(): Record<string, unknown> {
  return appManifest('shop', {
    version: '1.0.0',
    compatibility: { minAdminiumVersion: '0.3.44', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'customers', keyField: 'name', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }, fileColumn('passport')] },
        { ref: 'proofs', columns: [pk, { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true }, { ref: 'words', type: 'text', maxLength: 80, nullable: true }, fileColumn('picture')] },
        { ref: 'quotes', columns: [pk, { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true }, fileColumn('picture'), fileColumn('terms')] },
      ],
    },
    people: [
      {
        table: 'customers',
        kind: 'people',
        email: 'email',
        name: 'name',
        copies: [
          { table: 'proofs', column: 'words', holds: 'details', via: 'customer_id' },
          { table: 'proofs', column: 'picture', holds: 'details', via: 'customer_id' },
          { table: 'quotes', column: 'picture', holds: 'details', via: 'customer_id' },
        ],
      },
    ],
  });
}

describe.each(LEGS)("a copy's files in the bin, erased with the person — %s", (dialect, available) => {
  let h: Harness;
  let storage: FileStore;
  let deps: EraseDeps;
  const files: Record<string, StoredFile> = {};

  /** A file with bytes, kept for one row of the shop's tables (by its bare name, as a store may keep it). */
  const keep = async (name: string, table: string, id: number): Promise<string> => {
    const fileId = newId('file');
    const bytes = await storage.write({ id: fileId, kind: 'upload', filename: `${name}.pdf`, mime: 'application/pdf', bytes: `%PDF ${name}` });
    files[name] = await filesRepo(h.meta).create({
      id: fileId,
      storageKey: bytes.storageKey,
      filename: `${name}.pdf`,
      mime: 'application/pdf',
      sizeBytes: bytes.sizeBytes,
      sha256: bytes.sha256,
      kind: 'upload',
      uploadedBy: null,
      attachedAt: Date.now(),
      entity: { connectionId: h.connectionId, table, pk: { id }, label: String(id) },
    } as never);
    return fileId;
  };
  /** What a removed attachment, or a column set again, does to the file: to the bin, still the row's (`files/reconcile.ts`). */
  const bin = async (name: string) => {
    expect(await filesRepo(h.meta).markDeleted(files[name]!.id)).toBe(true);
  };
  /** The table's id, as a write's audit entry names it. */
  const tableId = async (name: string) => (await loadSnapshotView(h.meta, h.connectionId)).model.tables.find((table) => table.name === name)!.id;
  /** A column set again, as a save does it: its audit entry, the old file to the bin, the new one in the column. */
  const remake = async (table: string, id: number, column: string, before: string, after: string) => {
    await keep(before, table, id);
    await auditRepo(h.meta).append({
      actorKind: 'user',
      actorId: h.owner.id,
      actorLabel: 'Owner',
      category: 'data',
      action: 'record.update',
      connectionId: h.connectionId,
      entity: { connectionId: h.connectionId, table: await tableId(table), pk: { id }, label: String(id) },
      changes: { before: { id, [column]: files[before]!.id }, after: { id, [column]: await keep(after, table, id) } },
    });
    await bin(before);
    await h.rows(`UPDATE ${table} SET ${column} = '${files[after]!.id}' WHERE id = ${String(id)}`);
  };
  const gone = async (name: string) => (await filesRepo(h.meta).findById(files[name]!.id)) === null && (await storage.head(files[name]!)) === null;
  const kept = async (name: string) => (await filesRepo(h.meta).findById(files[name]!.id)) !== null && (await storage.head(files[name]!)) !== null;
  const filesCounted = async () => {
    const found = await findPerson(deps, MARTA);
    const listed = found.sources.filter((source) => source.kind === 'files');
    const preview = await previewErasure(deps, MARTA);
    return { listed: listed.reduce((n, source) => n + source.count, 0), keys: listed.flatMap((source) => source.keys).sort(), goes: preview.goes.filter((item) => item.kind === 'files').reduce((n, item) => n + item.count, 0) };
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    storage = createTestFileStore({ dataDir: h.dataDir, meta: h.meta });
    deps = { meta: h.meta, manager: h.manager, consent: createConsentService({ meta: h.meta, secret: TEST_SECRET }), storage, secret: TEST_SECRET };
    await h.rows(`INSERT INTO shop_customers (id, name, email) VALUES (1, 'Marta Kovac', '${MARTA}'), (2, 'Ben Other', '${BEN}')`);
    await h.rows(`INSERT INTO shop_proofs (id, customer_id, words) VALUES (1, 1, 'Marta & Jo'), (2, 2, 'For Ben'), (3, 1, 'Marta again')`);
    await h.rows(`INSERT INTO shop_quotes (id, customer_id) VALUES (1, 1)`);
    // Her own row: a passport on file, and one replaced before.
    await keep('ownold', 'shop_customers', 1);
    await bin('ownold');
    await h.rows(`UPDATE shop_customers SET passport = '${await keep('ownnew', 'shop_customers', 1)}' WHERE id = 1`);
    // Her proof, made twice: the first picture is in the bin. And a document attached to it and removed, never in a column.
    await remake('shop_proofs', 1, 'picture', 'proofold', 'proofnew');
    await keep('proofdoc', 'shop_proofs', 1);
    await bin('proofdoc');
    // Ben's proof, made twice too.
    await remake('shop_proofs', 2, 'picture', 'benold', 'bennew');
    // A proof of hers that names Ben's picture: it is his row's.
    await h.rows(`UPDATE shop_proofs SET picture = '${files['bennew']!.id}' WHERE id = 3`);
    // Her quote: her picture made twice, the shop's terms written twice, and a removed attachment of the quote's.
    await remake('shop_quotes', 1, 'picture', 'quotepicold', 'quotepic');
    await remake('shop_quotes', 1, 'terms', 'termsold', 'terms');
    await keep('quoteold', 'shop_quotes', 1);
    await bin('quoteold');
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await h?.close();
  });

  it.skipIf(!available)('lists the files the preview counts: her rows, her copies, and what the bin keeps of them', async () => {
    const counted = await filesCounted();
    const theirs = ['ownold', 'ownnew', 'proofold', 'proofnew', 'quotepicold', 'quotepic'].map((name) => files[name]!.id).sort();
    expect(counted.keys).toEqual(theirs);
    expect(counted.listed).toBe(6);
    expect(counted.goes).toBe(counted.listed);
  });

  it.skipIf(!available)('erases a proof made again with her: the picture it replaced too, bytes and row; what is not hers stays', async () => {
    const done = await erasePerson(deps, MARTA);
    expect(done.filesFailed).toBe(0);
    expect(done.counts['files']).toBe(6);
    for (const name of ['ownold', 'ownnew', 'proofold', 'proofnew', 'quotepicold', 'quotepic']) expect(await gone(name), name).toBe(true);
    for (const name of ['bennew', 'benold', 'terms', 'termsold', 'quoteold', 'proofdoc']) expect(await kept(name), name).toBe(true);
    expect((await h.rows('SELECT id, picture FROM shop_proofs ORDER BY id')).map((row) => row['picture'] ?? null)).toEqual([null, files['bennew']!.id, null]);
    // Nothing more of hers is listed, and nothing more is counted.
    expect(await filesCounted()).toMatchObject({ listed: 0, goes: 0 });
  });
});
