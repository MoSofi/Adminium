// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Files on a row (`column.file`) through the doors that save more than one
 * row, or save it through a before hook: a bulk edit is judged as a single
 * save is (the release review's H1: the bulk path once skipped the judge, so
 * another record's file, a colleague's upload or an unclean picture could be
 * named and then kept by a later save).
 */
import { parseDatabaseModel } from '@adminium/engine';
import { filesRepo, overridesRepo, permissionsRepo, rolesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { png } from './picture-images.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

type Who = PersonName | 'owner';
type Reply = { statusCode: number; body: string; rawPayload: Buffer };

const OWN = { reach: 'own' } as const;
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
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


    it('a bulk edit is judged as a single save: no other record’s file, no colleague’s upload, no unclean picture, no other kind', async () => {
      const editor = await rolesRepo(w.meta).create({ slug: 'bulk-editor', name: 'Bulk editor' });
      await permissionsRepo(w.meta).grant(editor.id, 'table', `${w.connectionId}/${w.id('deliveries')}`, { read: true, create: false, update: false, delete: false, export: false, import: false } as never);
      await permissionsRepo(w.meta).grant(editor.id, 'table', `${w.connectionId}/${signOffs}`, { read: true, create: true, update: true, delete: false, export: false, import: false } as never);
      await w.give('dana', 'bulk-editor');
      const aSig = await uploaded('kim', png().bytes);
      const a = await create('kim', { signature: aSig });
      expect(a.res.statusCode, a.res.body).toBe(201);
      const b = await create('owner', {});
      expect(b.res.statusCode, b.res.body).toBe(201);
      const held = async () => (await w.rows(`SELECT signature, photos FROM sign_offs WHERE id = ${String(b.id)}`))[0]!;
      const before = await held();
      const unclean = await uploaded('dana', png({ text: 'GPS 51.5074 N', exif: true }).bytes, { column: null });
      const samFresh = await uploaded('sam', png().bytes);
      const pdf = await uploaded('dana', PDF, { column: null, filename: 'x.pdf', type: 'application/pdf' });
      for (const values of [{ signature: aSig }, { photos: [unclean] }, { signature: samFresh }, { signature: pdf }]) {
        const res = await call('dana', 'POST', `${rows()}/bulk`, { action: 'update', ids: [b.id], values });
        expect(res.statusCode, `${JSON.stringify(values)} ${res.body}`).not.toBe(200);
        expect(await held(), JSON.stringify(values)).toEqual(before);
      }
      // Nothing was taken: A keeps its signature, the colleague's upload is still nobody's and still not hers to read.
      expect(await fileOf(aSig)).toMatchObject({ entityTable: signOffs, entityId: String(a.id), deletedAt: null });
      expect((await call('dana', 'GET', `files/${samFresh}/content`)).statusCode).toBe(404);
    });
  });
}
