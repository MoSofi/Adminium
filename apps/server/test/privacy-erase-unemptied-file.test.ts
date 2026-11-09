// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A COPY'S FILE THE ERASURE CANNOT EMPTY IS NOT SAID TO GO.
 *
 * A shop keeps a proof of each customer's order (`proofs`), declared as
 * copies of her: her words, a sketch, and a picture. The picture column is
 * worked out by the database from another column (generated), so the
 * erasure cannot write a blank to it, and the file it names stays. The
 * search lists only the files the erasure takes (the sketch): the same
 * columns, by the same rule (`privacy/erase-values.ts` `erasedColumns`), as
 * the preview counts and the erasure deletes.
 *
 * On every engine this run can reach.
 */
import { filesRepo, newId, type StoredFile } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createConsentService } from '../src/consent/service.js';
import type { FileStore } from '../src/files/store.js';
import { erasePerson, previewErasure, type EraseDeps } from '../src/privacy/erase.js';
import { findPerson } from '../src/privacy/sources.js';
import { addOnHarness, appManifest, type Harness } from './app-add-ons.helpers.js';
import { TEST_SECRET } from './helpers.js';
import { createTestFileStore } from './helpers/file-store.js';
import { LEGS } from './invoicing-install.helpers.js';

const MARTA = 'marta@example.com';
const pk = { ref: 'id', type: 'int', role: 'pk' } as const;
const fileColumn = (ref: string) => ({ ref, type: 'text', maxLength: 64, nullable: true, rules: { file: { accept: ['pdf'], maxBytes: 1048576 } } });

function shop(): Record<string, unknown> {
  return appManifest('shop', {
    version: '1.0.0',
    compatibility: { minAdminiumVersion: '0.3.44', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'customers', keyField: 'name', columns: [pk, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
        {
          ref: 'proofs',
          columns: [pk, { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true }, { ref: 'words', type: 'text', maxLength: 80, nullable: true }, { ref: 'source', type: 'text', maxLength: 64, nullable: true }, fileColumn('sketch'), fileColumn('picture')],
        },
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
          { table: 'proofs', column: 'sketch', holds: 'details', via: 'customer_id' },
          { table: 'proofs', column: 'picture', holds: 'details', via: 'customer_id' },
        ],
      },
    ],
  });
}

/** The picture column made again as one the database works out from `source`. */
const GENERATED: Record<string, string[]> = {
  postgres: ['ALTER TABLE shop_proofs DROP COLUMN picture', 'ALTER TABLE shop_proofs ADD COLUMN picture varchar(64) GENERATED ALWAYS AS (source) STORED'],
  mysql: ['ALTER TABLE shop_proofs DROP COLUMN picture', 'ALTER TABLE shop_proofs ADD COLUMN picture varchar(64) GENERATED ALWAYS AS (source) STORED'],
  sqlite: ['ALTER TABLE shop_proofs DROP COLUMN picture', 'ALTER TABLE shop_proofs ADD COLUMN picture varchar(64) GENERATED ALWAYS AS (source) VIRTUAL'],
};

describe.each(LEGS)("a copy's file the erasure cannot empty — %s", (dialect, available) => {
  let h: Harness;
  let storage: FileStore;
  let deps: EraseDeps;
  const files: Record<string, StoredFile> = {};

  /** A file with bytes, kept for her proof. */
  const keep = async (name: string): Promise<string> => {
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
      entity: { connectionId: h.connectionId, table: 'shop_proofs', pk: { id: 1 }, label: '1' },
    } as never);
    return fileId;
  };
  const gone = async (name: string) => (await filesRepo(h.meta).findById(files[name]!.id)) === null && (await storage.head(files[name]!)) === null;
  const kept = async (name: string) => (await filesRepo(h.meta).findById(files[name]!.id)) !== null && (await storage.head(files[name]!)) !== null;

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageApp(shop());
    const installed = await h.install('shop', '1.0.0');
    expect(installed.statusCode, installed.body).toBe(200);
    for (const statement of GENERATED[dialect]!) await h.rows(statement);
    await h.introspect();
    storage = createTestFileStore({ dataDir: h.dataDir, meta: h.meta });
    deps = { meta: h.meta, manager: h.manager, consent: createConsentService({ meta: h.meta, secret: TEST_SECRET }), storage, secret: TEST_SECRET };
    await h.rows(`INSERT INTO shop_customers (id, name, email) VALUES (1, 'Marta Kovac', '${MARTA}')`);
    await h.rows(`INSERT INTO shop_proofs (id, customer_id, words, sketch, source) VALUES (1, 1, 'Marta & Jo', '${await keep('sketch')}', '${await keep('picture')}')`);
    expect((await h.rows('SELECT picture FROM shop_proofs WHERE id = 1'))[0]?.['picture']).toBe(files['picture']!.id);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await h?.close();
  });

  it.skipIf(!available)('lists only the file the erasure takes, as the preview counts it', async () => {
    const found = await findPerson(deps, MARTA);
    const listed = found.sources.filter((source) => source.kind === 'files');
    expect(listed.flatMap((source) => source.keys)).toEqual([files['sketch']!.id]);
    const preview = await previewErasure(deps, MARTA);
    expect(preview.goes.filter((item) => item.kind === 'files').reduce((n, item) => n + item.count, 0)).toBe(1);
  });

  it.skipIf(!available)('erases the file of the column it empties and leaves the other, as it said', async () => {
    const done = await erasePerson(deps, MARTA);
    expect(done.counts['files']).toBe(1);
    expect(await gone('sketch')).toBe(true);
    expect(await kept('picture')).toBe(true);
  });
});
