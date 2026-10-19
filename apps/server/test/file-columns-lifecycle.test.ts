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
      await w.run('CREATE TABLE dishes (id INTEGER PRIMARY KEY, name VARCHAR(120) NOT NULL, photo VARCHAR(64))');
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      const snapshot = parseDatabaseModel((await snapshotsRepo(w.meta).latest(w.connectionId))!.schema);
      dishes = snapshot.tables.find((one) => one.name === 'dishes')!.id;
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.file', tableName: dishes, columnName: 'photo', value: { accept: ['png'], maxBytes: 64 * 1024 }, origin: 'app' } as never);
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
  });
}
