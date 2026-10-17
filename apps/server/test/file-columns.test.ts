// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A column that holds files (`column.file`), on a real database of each
 * engine: a crew's sign-off, with the customer's signature (one PNG) and the
 * job's photos (a list of up to three pictures).
 *
 * Kim is on crew 1 and Sam on crew 2; each reads the sign-offs of their own
 * crew's deliveries and makes new ones. The firm's owner reads everything.
 *
 * Every door a file could be taken through, as an attacker would try it:
 *
 *  - a picture is kept without its camera notes, from the upload on, and the
 *    column takes only its own kinds and sizes;
 *  - a write names only a file its writer uploaded and no record holds yet:
 *    not another sign-off's signature (the file stays with its record), not
 *    somebody else's upload (the owner's neither), not a file that is not
 *    there, nor one uploaded elsewhere unclean, of another kind, too large,
 *    or twice;
 *  - an import names no new file at all;
 *  - a file a record keeps is not taken off, renamed or thrown away by
 *    itself, even by whoever uploaded it; one no record holds yet is;
 *  - a file is read with its record: somebody who does not reach the row
 *    reads none of its files;
 *  - a record removed takes its files with it; one changed lets go of the
 *    file it no longer names.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { filesRepo, overridesRepo, permissionsRepo, rolesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { gif, jpeg, png, pngChunk } from './picture-images.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string; rawPayload: Buffer };

const OWN = { reach: 'own' } as const;
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
/** A clean PNG of some 6 KB: what the cleaning keeps (its picture data) is what makes it large. */
function bigPng(): Buffer {
  const { clean } = png();
  const at = clean.length - 12;
  return Buffer.concat([clean.subarray(0, at), pngChunk('IDAT', Buffer.alloc(6000, 7)), clean.subarray(at)]);
}

/** What a camera writes beside a picture, as the fixtures spell it. */
const CAMERA = /GPS|Elm Row|kitchen|xmpmeta|IPTC/;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a column that holds files: a sign-off's signature and photos [${dialect}]`, () => {
    let w: World;
    let signOffs: string;
    const JSON_TYPE = dialect === 'sqlite' ? 'TEXT' : 'JSON';
    const cookies = new Map<Who, string>();
    const as = async (who: Who): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const call = async (who: Who, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: await as(who), ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) }) as unknown as Reply;
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const rows = (): string => `data/${w.connectionId}/${encodeURIComponent(signOffs)}`;

    /** Upload bytes for a column of the sign-offs (or for the table alone, with `column: null`); answers the reply and the file's id. */
    const upload = async (who: Who, bytes: Buffer, opts: { column?: string | null; filename?: string; type?: string } = {}): Promise<{ res: Reply; id: string }> => {
      const column = opts.column === undefined ? 'signature' : opts.column;
      const query = new URLSearchParams({ connectionId: w.connectionId, table: 'sign_offs', filename: opts.filename ?? 'signature.png', ...(column === null ? {} : { column }) });
      const res = await call(who, 'POST', `files?${query.toString()}`, bytes, { 'content-type': opts.type ?? 'image/png' });
      return { res, id: res.statusCode === 201 ? json<{ data: { id: string } }>(res).data.id : '' };
    };
    const uploaded = async (who: Who, bytes: Buffer, opts: { column?: string | null; filename?: string; type?: string } = {}): Promise<string> => {
      const { res, id } = await upload(who, bytes, opts);
      expect(res.statusCode, res.body).toBe(201);
      return id;
    };
    let nextId = 100;
    const create = async (who: Who, values: Record<string, unknown>): Promise<{ res: Reply; id: number }> => {
      nextId += 1;
      return { res: await call(who, 'POST', rows(), { values: { id: nextId, delivery_id: 1, signer_name: 'Ada Customer', ...values } }), id: nextId };
    };
    const refusedWith = (res: Reply, column: string, code: string): void => {
      expect(res.statusCode, res.body).toBe(422);
      expect(json<{ error: { code: string; details: { fields: Record<string, { code: string }> } } }>(res).error).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { [column]: { code } } } });
    };
    const fileOf = async (id: string) => filesRepo(w.meta).findById(id);

    beforeAll(async () => {
      w = await world(dialect);
      // As an app's install makes them: the signature's id in text, the photos' list in JSON (TEXT on SQLite).
      await w.run(`CREATE TABLE sign_offs (id INTEGER PRIMARY KEY, delivery_id INTEGER NOT NULL, signer_name VARCHAR(120) NOT NULL, signature VARCHAR(64), photos ${JSON_TYPE}, note VARCHAR(200), retry_key VARCHAR(64) UNIQUE, FOREIGN KEY (delivery_id) REFERENCES deliveries(id))`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      const snapshot = parseDatabaseModel((await snapshotsRepo(w.meta).latest(w.connectionId))!.schema);
      signOffs = snapshot.tables.find((one) => one.name === 'sign_offs')!.id;
      const overrides = overridesRepo(w.meta);
      await overrides.create({ connectionId: w.connectionId, op: 'column.file', tableName: signOffs, columnName: 'signature', value: { accept: ['png'], maxBytes: 4096 }, origin: 'app' } as never);
      await overrides.create({ connectionId: w.connectionId, op: 'column.file', tableName: signOffs, columnName: 'photos', value: { accept: ['jpeg', 'png', 'gif'], maxBytes: 64 * 1024, maxCount: 3 }, origin: 'app' } as never);
      await overrides.create({ connectionId: w.connectionId, op: 'column.retryKey', tableName: signOffs, columnName: 'retry_key', value: { retryKey: true }, origin: 'app' } as never);
      // A sign-off is its delivery's, and a delivery its crew's.
      await overrides.create({ connectionId: w.connectionId, op: 'table.belongs', tableName: signOffs, value: { ways: [{ via: 'delivery_id' }] }, origin: 'user' });
      const role = await rolesRepo(w.meta).create({ slug: 'fitter', name: 'Fitter' });
      await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${w.id('deliveries')}`, { read: true, create: false, update: false, delete: false, export: false, import: false, rowLimit: { read: OWN } } as never);
      await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${signOffs}`, { read: true, create: true, update: false, delete: false, export: false, import: false, rowLimit: { read: OWN } } as never);
      await w.give('kim', 'fitter');
      await w.give('sam', 'fitter');
    }, 180_000);
    afterAll(async () => w?.close());

    it('keeps a picture without its camera notes, and takes only the column’s own kinds and sizes', async () => {
      const signed = await uploaded('kim', png({ text: 'GPS 51.5074 N', exif: true }).bytes);
      const kept = await fileOf(signed);
      expect(kept).toMatchObject({ mime: 'image/png', uploadedBy: w.people.kim, attachedAt: null });
      const bytes = (await call('kim', 'GET', `files/${signed}/content`)).rawPayload;
      expect(bytes.equals(png({ text: 'GPS 51.5074 N', exif: true }).clean)).toBe(true);
      expect(bytes.toString('latin1')).not.toMatch(CAMERA);
      // The reference handed back is the file's own id: what the column holds.
      expect(json<{ ref: string }>((await upload('kim', png().bytes)).res).ref).toMatch(/^file_/);
      const photo = await uploaded('kim', jpeg().bytes, { column: 'photos', filename: 'job.jpg', type: 'image/jpeg' });
      expect((await call('kim', 'GET', `files/${photo}/content`)).rawPayload.toString('latin1')).not.toMatch(CAMERA);
      // Not a kind the signature takes, by its bytes whatever it is called; not larger than it allows.
      expect((await upload('kim', PDF, { filename: 'signature.png', type: 'image/png' })).res.statusCode).toBe(415);
      expect((await upload('kim', jpeg().bytes, { type: 'image/jpeg' })).res.statusCode).toBe(415);
      expect((await upload('kim', png({ width: 64, height: 64, text: 'x'.repeat(5000) }).bytes)).res.statusCode).toBe(413);
      // Not a picture at all, though its bytes start as one.
      expect((await upload('kim', png().bytes.subarray(0, 40))).res.statusCode).toBe(415);
    });

    it('takes a sign-off naming the crew member’s own fresh uploads, and hangs them on it', async () => {
      const signature = await uploaded('kim', png().bytes);
      const photos = [await uploaded('kim', jpeg().bytes, { column: 'photos', type: 'image/jpeg' }), await uploaded('kim', gif().bytes, { column: 'photos', type: 'image/gif' })];
      const { res, id } = await create('kim', { signature, photos });
      expect(res.statusCode, res.body).toBe(201);
      for (const file of [signature, ...photos]) expect(await fileOf(file)).toMatchObject({ entityTable: signOffs, entityId: String(id) });
      // Read back alike on every engine: the signature its id, the photos a list.
      const read = json<{ data: Record<string, unknown> }>(await call('kim', 'GET', `${rows()}/${String(id)}`)).data;
      expect(read).toMatchObject({ signature, photos });
      expect((await call('kim', 'GET', `files/${signature}/content`)).statusCode).toBe(200);
      expect((await call('owner', 'GET', `files/${photos[0]!}/content`)).statusCode).toBe(200);
    });

    it('signs off as one request with a retry key: sent again after a lost reply, it answers the first sign-off and its files', async () => {
      const signature = await uploaded('kim', png().bytes);
      const photo = await uploaded('kim', jpeg().bytes, { column: 'photos', type: 'image/jpeg' });
      nextId += 1;
      const values = { id: nextId, delivery_id: 1, signer_name: 'Ada Customer', signature, photos: [photo] };
      const first = await call('kim', 'POST', rows(), { values, clientKey: 'sign-off-delivery-1-the-only-one' });
      expect(first.statusCode, first.body).toBe(201);
      // The reply was lost; the phone sends the very same request again. The files are the first sign-off's now.
      const again = await call('kim', 'POST', rows(), { values, clientKey: 'sign-off-delivery-1-the-only-one' });
      expect(again.statusCode, again.body).toBe(200);
      expect(json<{ replayed?: boolean; data: Record<string, unknown> }>(again)).toMatchObject({ replayed: true, data: { id: nextId, signature, photos: [photo] } });
      expect(await w.rows(`SELECT id FROM sign_offs WHERE retry_key IS NOT NULL AND id = ${String(nextId)}`)).toHaveLength(1);
      // And the phone, unsure, asking to throw the files away is told the record holds them.
      expect((await call('kim', 'DELETE', `files/${signature}`)).statusCode).toBe(409);
    });

    it('refuses a file another sign-off holds, and that sign-off keeps it', async () => {
      const signature = await uploaded('kim', png().bytes);
      const first = await create('kim', { signature });
      expect(first.res.statusCode, first.res.body).toBe(201);
      // Kim reads job one's sign-off, so he reads its signature's id: he signs another job with it.
      refusedWith((await create('kim', { signature })).res, 'signature', 'file-not-here');
      refusedWith((await create('kim', { photos: [signature] })).res, 'photos', 'file-not-here');
      // So does the owner, who reaches every row: a record's file is no other record's.
      refusedWith((await create('owner', { signature })).res, 'signature', 'file-not-here');
      expect(await fileOf(signature)).toMatchObject({ entityId: String(first.id), deletedAt: null });
      expect((await call('kim', 'GET', `files/${signature}/content`)).statusCode).toBe(200);
    });

    it('refuses somebody else’s upload, a file that is not there, and anything that is not a file’s id', async () => {
      const sams = await uploaded('sam', png().bytes);
      refusedWith((await create('kim', { signature: sams })).res, 'signature', 'file-not-here');
      // Not even the owner names a file somebody else uploaded.
      refusedWith((await create('owner', { signature: sams })).res, 'signature', 'file-not-here');
      expect(await fileOf(sams)).toMatchObject({ attachedAt: null, deletedAt: null });
      // An id that names no file is refused exactly as one that is somebody else's.
      refusedWith((await create('kim', { signature: 'file_01JZZZZZZZZZZZZZZZZZZZZZZZ' })).res, 'signature', 'file-not-here');
      for (const value of [`/api/v1/files/${sams}/content`, 'https://example.com/a.png', [await uploaded('kim', png().bytes)], 42]) {
        refusedWith((await create('kim', { signature: value })).res, 'signature', 'file-not-here');
      }
      // Text where a list goes: refused, as the column's own type where the database keeps JSON, else as no file.
      refusedWith((await create('kim', { photos: 'not a list' })).res, 'photos', dialect === 'sqlite' ? 'file-not-here' : 'invalid');
    });

    it('refuses a file uploaded elsewhere that the column would not take: unclean, of another kind, too large', async () => {
      // Uploaded for the table and no column: kept as it came, camera notes and all.
      const unclean = await uploaded('kim', png({ text: 'GPS 51.5074 N', exif: true }).bytes, { column: null });
      refusedWith((await create('kim', { photos: [unclean] })).res, 'photos', 'file-not-here');
      const pdf = await uploaded('kim', PDF, { column: null, filename: 'job.pdf', type: 'application/pdf' });
      refusedWith((await create('kim', { signature: pdf })).res, 'signature', 'file-type');
      // A clean picture larger than the signature allows, cleaned by the photos' upload (which allows more).
      const large = await uploaded('kim', bigPng(), { column: 'photos' });
      expect((await fileOf(large))!.sizeBytes).toBeGreaterThan(4096);
      refusedWith((await create('kim', { signature: large })).res, 'signature', 'file-too-large');
    });

    it('refuses a list past its count, one file named twice, and one file in two columns', async () => {
      const four = await Promise.all([0, 1, 2, 3].map(() => uploaded('kim', png().bytes, { column: 'photos' })));
      refusedWith((await create('kim', { photos: four })).res, 'photos', 'too-many-files');
      refusedWith((await create('kim', { photos: [four[0], four[0]] })).res, 'photos', 'file-not-here');
      const res = (await create('kim', { signature: four[1], photos: [four[1]] })).res;
      expect(res.statusCode, res.body).toBe(422);
      for (const id of four) expect(await fileOf(id)).toMatchObject({ attachedAt: null });
    });

    it('lets an import name no new file, whoever runs it', async () => {
      const mine = await uploaded('owner', png().bytes);
      const csv = `id,delivery_id,signer_name,signature\n901,1,Imported,${mine}\n`;
      const sent = await call('owner', 'POST', 'imports/upload?filename=sign-offs.csv', csv, { 'content-type': 'text/csv' });
      expect(sent.statusCode, sent.body).toBe(201);
      const made = await call('owner', 'POST', 'imports', {
        fileId: json<{ data: { fileId: string } }>(sent).data.fileId,
        connectionId: w.connectionId,
        table: signOffs,
        mapping: { columns: ['id', 'delivery_id', 'signer_name', 'signature'].map((name) => ({ from: name, to: name })) },
        options: { skipInvalid: true },
      });
      expect(made.statusCode, made.body).toBe(201);
      const importId = json<{ data: { import: { id: string } } }>(made).data.import.id;
      expect((await call('owner', 'POST', `imports/${importId}/run`)).statusCode).toBe(202);
      await w.jobs();
      expect(await w.rows('SELECT id FROM sign_offs WHERE id = 901')).toEqual([]);
      expect(await fileOf(mine)).toMatchObject({ attachedAt: null });
    });

    it('keeps a record’s file from being taken off, renamed or thrown away by itself, even by whoever uploaded it', async () => {
      const signature = await uploaded('kim', png().bytes);
      const { res, id } = await create('kim', { signature });
      expect(res.statusCode, res.body).toBe(201);
      for (const [method, url, payload] of [
        ['DELETE', `files/${signature}`, undefined],
        ['POST', `files/${signature}/detach`, undefined],
        ['PATCH', `files/${signature}`, { filename: 'other.png' }],
        ['POST', `files/${signature}/attach`, { connectionId: w.connectionId, table: signOffs, recordId: '1' }],
      ] as const) {
        for (const who of ['kim', 'owner'] as const) {
          const told = await call(who, method, url, payload);
          // Hanging a file on a record asks the right to change the table first, which Kim does not hold.
          if (who === 'kim' && url.endsWith('/attach')) {
            expect(told.statusCode, told.body).toBe(403);
            continue;
          }
          expect(told.statusCode, `${who} ${method} ${url}: ${told.body}`).toBe(409);
          expect(json<{ error: { code: string } }>(told).error.code).toBe('FILE_HELD');
        }
      }
      expect(await fileOf(signature)).toMatchObject({ entityId: String(id), deletedAt: null, filename: 'signature.png' });
      // One no record holds yet is its uploader's to throw away (a refused sign-off's files); nobody else's.
      const spare = await uploaded('kim', png().bytes);
      expect((await call('sam', 'DELETE', `files/${spare}`)).statusCode).toBe(404);
      expect((await call('kim', 'DELETE', `files/${spare}`)).statusCode).toBe(200);
      expect((await call('kim', 'GET', `files/${spare}/content`)).statusCode).toBe(404);
    });

    it('reads a file only with its record: nobody who does not reach the row reads its files', async () => {
      const signature = await uploaded('kim', png().bytes);
      const photo = await uploaded('kim', jpeg().bytes, { column: 'photos', type: 'image/jpeg' });
      const { res } = await create('kim', { signature, photos: [photo] });
      expect(res.statusCode, res.body).toBe(201);
      // Sam is on crew 2: the sign-off of crew 1's delivery is not there for him, nor are its files.
      for (const file of [signature, photo]) {
        expect((await call('sam', 'GET', `files/${file}/content`)).statusCode).toBe(404);
        expect((await call('sam', 'GET', `files/${file}`)).statusCode).toBe(404);
        expect((await call('dana', 'GET', `files/${file}/content`)).statusCode).toBe(404);
        expect((await call('kim', 'GET', `files/${file}/content`)).statusCode).toBe(200);
      }
      // Before a record holds it, an upload is its uploader's alone.
      const fresh = await uploaded('kim', png().bytes);
      expect((await call('sam', 'GET', `files/${fresh}/content`)).statusCode).toBe(404);
    });

    it('lets go of a file the record no longer names, and of every file when it is removed', async () => {
      const first = await uploaded('owner', png().bytes);
      const photo = await uploaded('owner', jpeg().bytes, { column: 'photos', type: 'image/jpeg' });
      const { res, id } = await create('owner', { signature: first, photos: [photo] });
      expect(res.statusCode, res.body).toBe(201);
      // A correction: a new signature, the photos kept as they are.
      const second = await uploaded('owner', png().bytes);
      const changed = await call('owner', 'PATCH', `${rows()}/${String(id)}`, { values: { signature: second, photos: [photo] } });
      expect(changed.statusCode, changed.body).toBe(200);
      expect((await fileOf(first))!.deletedAt).not.toBeNull();
      expect(await fileOf(second)).toMatchObject({ entityId: String(id), deletedAt: null });
      expect(await fileOf(photo)).toMatchObject({ entityId: String(id), deletedAt: null });
      // A change that leaves the file columns alone leaves their files alone.
      expect((await call('owner', 'PATCH', `${rows()}/${String(id)}`, { values: { note: 'Gate code 4411' } })).statusCode).toBe(200);
      expect(await fileOf(second)).toMatchObject({ deletedAt: null });
      const removed = await call('owner', 'DELETE', `${rows()}/${String(id)}`);
      expect(removed.statusCode, removed.body).toBe(200);
      for (const file of [second, photo]) {
        expect((await fileOf(file))!.deletedAt).not.toBeNull();
        expect((await call('owner', 'GET', `files/${file}/content`)).statusCode).toBe(404);
      }
    });
  });
}
