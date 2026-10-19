// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A row's files through the writes that take a value back or take rows away,
 * and through the daily sweep. Each is read from the file rows themselves, on
 * every engine this run can reach — a row that names a file in the bin shows
 * a broken picture now and loses it for good when the trash is emptied.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { filesRepo, overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FILES_RETENTION_SCHEDULE_NAME } from '../src/compose.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { png } from './picture-images.js';
import { ENGINES, world, type World } from './row-limit-world.js';

type Reply = { statusCode: number; body: string };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a dish's photo through undo and bulk delete [${dialect}]`, () => {
    let w: World;
    let dishes: string;
    let fill = 0;
    const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: w.owner.cookie, ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) }) as unknown as Reply;
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    const rows = (): string => `data/${w.connectionId}/${encodeURIComponent(dishes)}`;
    /** A photo of its own for the dish column: each upload different bytes. */
    const photo = async (): Promise<string> => {
      fill += 1;
      const query = new URLSearchParams({ connectionId: w.connectionId, table: 'dishes', column: 'photo', filename: `dish-${String(fill)}.png` });
      const res = await call('POST', `files?${query.toString()}`, png({ fill }).bytes, { 'content-type': 'image/png' });
      expect(res.statusCode, res.body).toBe(201);
      return json<{ data: { id: string } }>(res).data.id;
    };
    let nextId = 0;
    const dish = async (photoId: string | null): Promise<{ id: number; undoToken: string | null }> => {
      nextId += 1;
      const res = await call('POST', rows(), { values: { id: nextId, name: `Dish ${String(nextId)}`, photo: photoId } });
      expect(res.statusCode, res.body).toBe(201);
      return { id: nextId, undoToken: json<{ undoToken: string | null }>(res).undoToken };
    };
    const undo = async (token: string | null): Promise<void> => {
      expect(token).not.toBeNull();
      const res = await call('POST', `data/undo/${token!}`);
      expect(res.statusCode, res.body).toBe(200);
    };
    const fileOf = async (id: string) => filesRepo(w.meta).findById(id);
    const photoOf = async (id: number) => (await w.rows(`SELECT photo FROM dishes WHERE id = ${String(id)}`))[0]?.['photo'] ?? null;

    beforeAll(async () => {
      w = await world(dialect);
      await w.run(`CREATE TABLE dishes (id INTEGER PRIMARY KEY, name VARCHAR(120) NOT NULL, photo VARCHAR(64), gallery ${dialect === 'sqlite' ? 'TEXT' : 'JSON'})`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      const snapshot = parseDatabaseModel((await snapshotsRepo(w.meta).latest(w.connectionId))!.schema);
      dishes = snapshot.tables.find((one) => one.name === 'dishes')!.id;
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.file', tableName: dishes, columnName: 'photo', value: { accept: ['png'], maxBytes: 64 * 1024 }, origin: 'app' } as never);
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.file', tableName: dishes, columnName: 'gallery', value: { accept: ['png'], maxBytes: 64 * 1024, maxCount: 4 }, origin: 'app' } as never);
    }, 180_000);
    afterAll(async () => w?.close());

    it('an undone change of photo puts the old photo back, out of the bin, and lets go of the new one', async () => {
      const first = await photo();
      const row = await dish(first);
      expect(await fileOf(first)).toMatchObject({ entityTable: dishes, entityId: String(row.id), deletedAt: null });
      const second = await photo();
      const changed = await call('PATCH', `${rows()}/${String(row.id)}`, { values: { photo: second } });
      expect(changed.statusCode, changed.body).toBe(200);
      // The change bins the photo it replaced.
      expect((await fileOf(first))?.deletedAt).not.toBeNull();
      await undo(json<{ undoToken: string | null }>(changed).undoToken);
      expect(await photoOf(row.id)).toBe(first);
      // The photo the row names again is out of the bin and still the row's…
      expect(await fileOf(first)).toMatchObject({ entityTable: dishes, entityId: String(row.id), deletedAt: null });
      // …and the one the undo took away goes to the bin, as a replaced photo does.
      expect((await fileOf(second))?.deletedAt).not.toBeNull();
    });

    it('an undone new row takes its photo to the bin with it', async () => {
      const own = await photo();
      const row = await dish(own);
      expect(await fileOf(own)).toMatchObject({ entityId: String(row.id), deletedAt: null });
      await undo(row.undoToken);
      expect(await photoOf(row.id)).toBeNull();
      expect((await fileOf(own))?.deletedAt).not.toBeNull();
    });

    it('a bulk delete takes each row’s photo to the bin, and its undo brings them back', async () => {
      const [first, second] = [await photo(), await photo()];
      const [a, b] = [await dish(first), await dish(second)];
      const res = await call('POST', `${rows()}/bulk`, { action: 'delete', ids: [a.id, b.id] });
      expect(res.statusCode, res.body).toBe(200);
      expect((await fileOf(first))?.deletedAt).not.toBeNull();
      expect((await fileOf(second))?.deletedAt).not.toBeNull();
      await undo(json<{ undoToken: string | null }>(res).undoToken);
      expect(await photoOf(a.id)).toBe(first);
      expect(await fileOf(first)).toMatchObject({ entityId: String(a.id), deletedAt: null });
      expect(await fileOf(second)).toMatchObject({ entityId: String(b.id), deletedAt: null });
    });

    it('a bulk change of photo holds the new one and lets go of the old', async () => {
      const old = await photo();
      const row = await dish(old);
      const fresh = await photo();
      const res = await call('POST', `${rows()}/bulk`, { action: 'update', ids: [row.id], values: { photo: fresh } });
      expect(res.statusCode, res.body).toBe(200);
      expect(await fileOf(fresh)).toMatchObject({ entityTable: dishes, entityId: String(row.id), deletedAt: null });
      expect((await fileOf(old))?.deletedAt).not.toBeNull();
    });

    it('a row whose save could not attach its photo keeps it through the sweep', async () => {
      const [lost, listed, loose] = [await photo(), await photo(), await photo()];
      nextId += 1;
      const id = nextId;
      // Saved, and the reconcile after the commit never ran (the meta store was away a moment): nothing holds the uploads.
      await w.run(`INSERT INTO dishes (id, name, photo, gallery) VALUES (${String(id)}, 'Saved', '${lost}', '${JSON.stringify([listed])}')`);
      // A day and more later, the sweep.
      for (const file of [lost, listed, loose]) await w.meta.db.updateTable('adminium_files').set({ createdAt: Date.now() - 30 * 3_600_000 }).where('id', '=', file).execute();
      await w.scheduler.trigger(FILES_RETENTION_SCHEDULE_NAME);
      expect(await fileOf(lost)).toMatchObject({ entityTable: dishes, entityId: String(id), deletedAt: null });
      expect(await fileOf(listed)).toMatchObject({ entityTable: dishes, entityId: String(id), deletedAt: null });
      // An upload no row names is still the sweep's.
      expect((await fileOf(loose))?.deletedAt).not.toBeNull();
    });
  });
}
