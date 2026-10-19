// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A row's files through the writes nobody made by hand: a rule's step and a
 * timed move. Neither can judge a file it names — no person sent it — so it
 * takes nothing new,
 * but what it clears or replaces is let go as a person's change lets it go:
 * to the bin when it was this row's. Read from the file rows themselves, on
 * every engine this run can reach.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { filesRepo, overridesRepo, snapshotsRepo, type Automation } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runUpdateAction } from '../src/automations/actions/record-write.js';
import type { ActionContext } from '../src/automations/actions/types.js';
import { TRACE_EN } from '../src/automations/trace.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { runTimedMoves } from '../src/states/timed-moves.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { png } from './picture-images.js';
import { ENGINES, world, type World } from './row-limit-world.js';

type Reply = { statusCode: number; body: string };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a dish's photo through writes nobody made by hand [${dialect}]`, () => {
    let w: World;
    let dishes: string;
    let fill = 0;
    let nextId = 0;
    const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: { cookie: w.owner.cookie, ...headers }, ...(payload === undefined ? {} : { payload: payload as never }) }) as unknown as Reply;
    const json = <T = Record<string, unknown>>(res: Reply): T => JSON.parse(res.body) as T;
    /** A photo of its own for the dish column: each upload different bytes. */
    const photo = async (): Promise<string> => {
      fill += 1;
      const query = new URLSearchParams({ connectionId: w.connectionId, table: 'dishes', column: 'photo', filename: `dish-${String(fill)}.png` });
      const res = await call('POST', `files?${query.toString()}`, png({ fill }).bytes, { 'content-type': 'image/png' });
      expect(res.statusCode, res.body).toBe(201);
      return json<{ data: { id: string } }>(res).data.id;
    };
    /** A dish saved by a person, holding its photo. */
    const dish = async (photoId: string): Promise<number> => {
      nextId += 1;
      const res = await call('POST', `data/${w.connectionId}/${encodeURIComponent(dishes)}`, { values: { id: nextId, name: `Dish ${String(nextId)}`, photo: photoId } });
      expect(res.statusCode, res.body).toBe(201);
      expect(await fileOf(photoId)).toMatchObject({ entityTable: dishes, entityId: String(nextId), deletedAt: null });
      return nextId;
    };
    const fileOf = async (id: string) => filesRepo(w.meta).findById(id);
    const rowOf = async (id: number) => (await w.rows(`SELECT * FROM dishes WHERE id = ${String(id)}`))[0]!;
    const view = async (): Promise<SnapshotView> => {
      const snapshot = (await snapshotsRepo(w.meta).latest(w.connectionId))!;
      const overrides = await overridesRepo(w.meta).listForConnection(w.connectionId, { status: 'active' });
      return new SnapshotView(w.connectionId, applyOverrides(parseDatabaseModel(snapshot.schema), overrides), new Map());
    };

    beforeAll(async () => {
      w = await world(dialect);
      const moment = dialect === 'postgres' ? 'TIMESTAMPTZ' : 'DATETIME';
      await w.run(`CREATE TABLE dishes (id INTEGER PRIMARY KEY, name VARCHAR(120) NOT NULL, photo VARCHAR(64), status VARCHAR(20) NOT NULL DEFAULT 'on', off_at ${moment})`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      const snapshot = parseDatabaseModel((await snapshotsRepo(w.meta).latest(w.connectionId))!.schema);
      dishes = snapshot.tables.find((one) => one.name === 'dishes')!.id;
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.file', tableName: dishes, columnName: 'photo', value: { accept: ['png'], maxBytes: 64 * 1024 }, origin: 'app' } as never);
      // A dish taken off the menu at its moment loses its photo.
      await overridesRepo(w.meta).create({
        connectionId: w.connectionId,
        op: 'table.states',
        tableName: dishes,
        value: { column: 'status', initial: 'on', moves: { on: ['off'], off: ['on'] }, timed: [{ from: 'on', to: 'off', at: { column: 'off_at' }, set: { photo: null } }] },
        origin: 'app',
      } as never);
    }, 180_000);
    afterAll(async () => w?.close());

    describe("a rule's step", () => {
      const step = async (id: number, values: Record<string, unknown>): Promise<void> => {
        const at = await view();
        const table = at.table(dishes);
        const { db, dialect: spoken } = await w.manager.data(w.connectionId);
        const ctx: ActionContext = {
          meta: w.meta,
          manager: w.manager,
          app: w.app,
          rule: { id: 'aut_photo', name: 'Clear the photo' } as Automation,
          runId: 'run_photo',
          hops: 0,
          now: Date.now(),
          source: {
            connectionId: w.connectionId,
            view: at,
            db,
            dialect: spoken,
            table,
            record: { connectionId: w.connectionId, table: dishes, pk: { id }, label: String(id) },
            row: await rowOf(id),
          },
          tokens: {},
          text: TRACE_EN,
          secret: '',
        };
        await runUpdateAction({ kind: 'record.update', values } as never, ctx);
      };

      // A rule names no new file in an app's own file column: the write is refused before it (`files/column-judge.ts`).
      it('that clears the photo lets it go to the bin', async () => {
        const own = await photo();
        const id = await dish(own);
        await step(id, { photo: '' });
        expect((await rowOf(id))['photo'] ?? '').toBe('');
        expect((await fileOf(own))?.deletedAt).not.toBeNull();
      });

      it('that clears a photo another row holds leaves it with that row', async () => {
        const theirs = await photo();
        const holder = await dish(theirs);
        nextId += 1;
        const id = nextId;
        await w.run(`INSERT INTO dishes (id, name, photo) VALUES (${String(id)}, 'Pasted', '${theirs}')`);
        await step(id, { photo: '' });
        expect(await fileOf(theirs)).toMatchObject({ entityId: String(holder), deletedAt: null });
      });
    });

    describe('a timed move', () => {
      it('whose values clear the photo lets it go to the bin', async () => {
        const own = await photo();
        const id = await dish(own);
        await w.run(`UPDATE dishes SET off_at = '2026-01-05 12:00:00' WHERE id = ${String(id)}`);
        const tick = await runTimedMoves({ meta: w.meta, manager: w.manager, app: w.app }, w.connectionId, {}, new Date('2026-01-06T12:00:00Z'));
        expect(tick.moved).toBeGreaterThanOrEqual(1);
        expect(await rowOf(id)).toMatchObject({ status: 'off', photo: null });
        expect((await fileOf(own))?.deletedAt).not.toBeNull();
      });
    });

  });
}
