// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PICTURE IN AN ADD-ON'S DOCUMENT, on SQLite, Postgres and MySQL.
 *
 * A crew's sign-off keeps the customer's drawn signature in a file column
 * (`rules.file`). The app's "signed copy" is drawn by an add-on whose outline
 * has a `picture` slot mapped to that column. The add-on never reads the file
 * store: the server hands it the picture — a PNG or a JPEG, as a data URL
 * with its size in pixels, cleaned of where it was taken — or nothing.
 *
 * Nothing is: a file that is not a picture by its type or by its bytes, one
 * larger than the column takes, one of ANOTHER record written into the
 * column behind Adminium's back, or one in the trash. And the picture reaches
 * only a reader who may read the row and the column: a role that reads the
 * sign-offs but not the signature column is drawn nothing at all, as for any
 * column a document prints. The register keeps what was printed without the
 * bytes; the app's install stops at a picture slot mapped to a column that
 * holds no picture.
 */
import { createHash } from 'node:crypto';

import { parseDatabaseModel } from '@adminium/engine';
import { documentProfilesRepo, documentsRepo, filesRepo, newId, permissionsRepo, rolesRepo, snapshotsRepo, usersRepo, type User } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';

import { addOnHarness, addOnManifest, appManifest, ENGINES, type Harness } from './app-add-ons.helpers.js';
import { jpeg, png } from './picture-images.js';

type Doc = Record<string, unknown>;

/** The signed copy's outline: who signed, and the signature as a picture. */
const SLOTS = [
  { id: 'signer', type: 'text', required: true },
  { id: 'signature', type: 'picture', required: false },
];

const crew = (mapping: Doc = { signer: { column: 'signer' }, signature: { column: 'signature' } }) =>
  appManifest('crew', {
    name: 'Crew',
    // A column's file rule is read from 0.3.28 on.
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      tables: [
        {
          ref: 'sign_offs',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'signer', type: 'text', maxLength: 120, nullable: true },
            // Pictures and PDFs, up to 4 KiB each.
            { ref: 'signature', type: 'text', nullable: true, rules: { file: { accept: ['png', 'jpeg', 'pdf'], maxBytes: 4096 } } },
            { ref: 'scan', type: 'text', nullable: true, rules: { file: { accept: ['pdf'], maxBytes: 4096 } } },
            { ref: 'note', type: 'text', maxLength: 200, nullable: true },
          ],
        },
      ],
    },
    addOns: { suggests: [{ key: 'papers', range: '>=1.0.0', reason: { 'en-US': 'Draws the signed copy.' } }] },
    documents: [{ kind: 'signed-copy', addOn: 'papers', table: 'sign_offs', name: 'Signed copy', mapping }],
  });

/** An add-on that draws a signed copy and prints the subject it was given. */
function papers() {
  const drawn: { kind: string; subject: Doc }[] = [];
  const module = {
    key: 'papers',
    kinds: () => [{ id: 'signed-copy', formats: ['html'], paper: ['a4'] }],
    describe: () => ({ slots: SLOTS }),
    render: (input: { kind: string; subject: Doc }) => {
      drawn.push({ kind: input.kind, subject: input.subject });
      return Promise.resolve([{ format: 'html', filename: 'signed-copy.html', mediaType: 'text/html; charset=utf-8', bytes: new TextEncoder().encode('<p>signed</p>'), locale: 'en-US', warnings: [] }]);
    },
  };
  const runtime = {
    providers: new Map([['document-render@1', [{ addOnKey: 'papers', contract: 'document-render', version: 1, module }]]]),
    slots: new Map(),
    conflicts: [],
    problems: [],
  } as unknown as AddOnRuntimeState;
  return { drawn, runtime };
}

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a picture in an add-on's document on ${dialect}`, () => {
    let drawn: ReturnType<typeof papers>['drawn'];
    let tableId: string;

    const setUp = async (manifest = crew()) => {
      const made = papers();
      drawn = made.drawn;
      h = await addOnHarness(dialect, { documents: { runtime: () => made.runtime } });
      await h.stageAddOn(addOnManifest('papers', { name: 'Papers' }));
      await h.stageApp(manifest);
      const installed = await h.install('crew', '0.2.0');
      expect(installed.statusCode, installed.body).toBe(200);
      const attached = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'papers', version: '1.0.0', attachTo: ['crew'] } });
      expect(attached.statusCode, attached.body).toBe(200);
      tableId = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema).tables.find((table) => table.name === 'sign_offs')!.id;
      return h;
    };

    /** A file kept for a record of `sign_offs` (by its key), as an upload attached to it: its id. */
    const keep = async (harness: Harness, bytes: Buffer, mime: string, recordId: number | null, filename = 'signature.png'): Promise<string> => {
      const id = newId('file');
      const written = await harness.pipeline!.storage.write({ id, kind: 'upload', filename, mime, bytes });
      await filesRepo(harness.meta).create({
        id,
        filename,
        mime,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        kind: 'upload',
        uploadedBy: harness.owner.id,
        storageKey: written.storageKey,
        destinationId: null,
        storage: written.storage,
        ...(recordId === null ? {} : { entity: { connectionId: harness.connectionId, table: tableId, pk: { id: recordId }, label: String(recordId) } }),
      });
      return id;
    };
    const signOff = (harness: Harness, id: number, signature: string | null) =>
      harness.rows(`insert into sign_offs (id, signer, signature) values (${String(id)}, 'Maria Lopez', ${signature === null ? 'null' : `'${signature}'`})`);
    const draw = (harness: Harness, id: number, as?: User) =>
      harness.inject({ method: 'POST', url: '/apps/crew/documents/render', payload: { kind: 'signed-copy', ref: 'sign_offs', pk: { id } }, ...(as === undefined ? {} : { as }) });
    /** What the add-on was handed for the signature on the last draw. */
    const handed = () => (drawn.at(-1)!.subject['fields'] as Doc)['signature'];
    /** Somebody with these grants on the sign-offs. */
    const person = async (harness: Harness, name: string, actions: Doc | null): Promise<User> => {
      const member = await usersRepo(harness.meta).create({ email: `${name}@test`, name });
      const role = await rolesRepo(harness.meta).create({ slug: name, name } as never);
      if (actions !== null) {
        await permissionsRepo(harness.meta).grant(role.id, 'table', `${harness.connectionId}/${tableId}`, { read: false, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
      }
      await rolesRepo(harness.meta).assignToUser(member.id, role.id);
      return member;
    };

    it('hands the add-on the signature as a cleaned PNG or JPEG, with its size, and the register keeps no bytes', async () => {
      const harness = await setUp();
      const signature = png({ width: 3, height: 2, text: 'GPS 51.5074 N, 14 Elm Row' });
      await signOff(harness, 1, await keep(harness, signature.bytes, 'image/png', 1));
      const res = await draw(harness, 1);
      expect(res.statusCode, res.body).toBe(201);
      expect(handed()).toEqual({ mediaType: 'image/png', dataUrl: `data:image/png;base64,${signature.clean.toString('base64')}`, width: 3, height: 2 });
      expect(Buffer.from(String((handed() as Doc)['dataUrl']).split(',')[1]!, 'base64').toString('latin1')).not.toContain('Elm Row');
      expect((drawn.at(-1)!.subject['fields'] as Doc)['signer']).toBe('Maria Lopez');

      const stored = await documentsRepo(harness.meta).findById((res.json() as { id: string }).id);
      expect((stored!.subject as { fields: Doc }).fields['signature']).toEqual({
        mediaType: 'image/png',
        width: 3,
        height: 2,
        sha256: createHash('sha256').update(signature.clean).digest('hex'),
      });

      const photo = jpeg({ width: 40, height: 20 });
      await signOff(harness, 2, await keep(harness, photo.bytes, 'image/jpeg', 2, 'signature.jpg'));
      expect((await draw(harness, 2)).statusCode).toBe(201);
      expect(handed()).toMatchObject({ mediaType: 'image/jpeg', width: 40, height: 20, dataUrl: `data:image/jpeg;base64,${photo.clean.toString('base64')}` });
    }, 120_000);

    it('hands nothing for a file that is no picture, too large, another record\'s, or in the trash', async () => {
      const harness = await setUp();
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
      // A PDF the column takes: a file, and no picture.
      await signOff(harness, 3, await keep(harness, pdf, 'application/pdf', 3, 'signature.pdf'));
      // Called a PNG, and not one by its bytes.
      await signOff(harness, 4, await keep(harness, pdf, 'image/png', 4));
      // A PNG larger than the column's 4 KiB.
      await signOff(harness, 5, await keep(harness, png({ text: 'x'.repeat(6000) }).bytes, 'image/png', 5));
      // Row 1's signature, written into row 6 by hand: another record's file.
      const theirs = await keep(harness, png().bytes, 'image/png', 1);
      await signOff(harness, 1, theirs);
      await signOff(harness, 6, theirs);
      // Kept for no record at all.
      await signOff(harness, 7, await keep(harness, png().bytes, 'image/png', null));
      // In the trash.
      const trashed = await keep(harness, png().bytes, 'image/png', 8);
      await signOff(harness, 8, trashed);
      await filesRepo(harness.meta).markDeleted(trashed);

      for (const id of [3, 4, 5, 6, 7, 8]) {
        const res = await draw(harness, id);
        expect(res.statusCode, `${String(id)}: ${res.body}`).toBe(201);
        expect(handed(), `row ${String(id)}`).toBeUndefined();
        expect((drawn.at(-1)!.subject['fields'] as Doc)['signer']).toBe('Maria Lopez');
      }
      // The row whose file it is: drawn with it.
      expect((await draw(harness, 1)).statusCode).toBe(201);
      expect(handed()).toMatchObject({ mediaType: 'image/png' });
    }, 120_000);

    it('reaches only a reader who may read the row and the signature column', async () => {
      const harness = await setUp();
      await signOff(harness, 1, await keep(harness, png({ width: 2, height: 2 }).bytes, 'image/png', 1));
      const clerk = await person(harness, 'clerk', { read: true });
      // Reads the sign-offs, and not the signature.
      const half = await person(harness, 'half', { read: true, readLimit: { readable: ['id', 'signer', 'note'] } });
      const nobody = await person(harness, 'nobody', null);

      const seen = await draw(harness, 1, clerk);
      expect(seen.statusCode, seen.body).toBe(201);
      expect(handed()).toMatchObject({ mediaType: 'image/png', width: 2, height: 2 });
      const before = drawn.length;
      for (const reader of [half, nobody]) {
        const res = await draw(harness, 1, reader);
        expect(res.statusCode, `${reader.name}: ${res.body}`).toBe(404);
        // And no stored copy of it reaches them by its own address either.
        const content = await harness.inject({ method: 'GET', url: `/documents/${(seen.json() as { id: string }).id}/content`, as: reader });
        expect([403, 404], `${reader.name}: ${content.body}`).toContain(content.statusCode);
      }
      expect(drawn).toHaveLength(before);
    }, 120_000);

    it('stops the install of an app whose picture slot maps a column that holds no picture', async () => {
      for (const mapping of [
        // A text column.
        { signer: { column: 'signer' }, signature: { column: 'note' } },
        // A file column that takes no PNG or JPEG.
        { signer: { column: 'signer' }, signature: { column: 'scan' } },
      ]) {
        const made = papers();
        h = await addOnHarness(dialect, { documents: { runtime: () => made.runtime } });
        await h.stageAddOn(addOnManifest('papers', { name: 'Papers' }));
        expect((await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'papers', version: '1.0.0', attachTo: [] } })).statusCode).toBe(200);
        await h.stageApp(crew(mapping));
        const refused = await h.install('crew', '0.2.0', { addOns: [{ key: 'papers', version: '1.0.0' }] });
        // The install stops where the documents are made, naming the slot, as for any mapping the add-on refuses.
        expect(refused.statusCode, refused.body).toBe(409);
        expect(refused.json().error.code).toBe('APP_INSTALL_INCOMPLETE');
        expect(refused.json().error.details.cause).toContain('"signature" of the "papers" add-on\'s signed-copy is a picture');
        expect(await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'crew')).toEqual([]);
        await h.close();
        h = undefined;
      }
    }, 120_000);
  });
}
