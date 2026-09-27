// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A status move that moved another row too is not offered an Undo that would
 * take back only half of it, on every engine.
 *
 * A stay's check-out turns its room to cleaning (`states.effects`); the app
 * lists the move back (departed → in_house, marked `undo`). The dashboard's
 * Undo of a status move is made as that move back — which would put the stay
 * back in the house and leave its room being cleaned. So:
 *
 *  - a check-out that turned a room to cleaning answers no undo token, on
 *    the single change and on a bulk change of the one row;
 *  - a check-out of a stay with no room (the effect moved nothing) still
 *    answers one, and the Undo takes the stay back;
 *  - the move back, named by the state it saw, is still the app's to make.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function manifest(): Record<string, unknown> {
  return invoicingManifest([
    {
      ref: 'rooms',
      columns: [id, { ref: 'number', type: 'text', maxLength: 8 }, { ref: 'status', type: 'enum', enum: ['ready', 'occupied', 'cleaning'], default: 'ready' }],
      states: { column: 'status', initial: 'ready', moves: { ready: ['occupied'], occupied: ['cleaning'], cleaning: ['ready'] } },
    },
    {
      ref: 'stays',
      columns: [
        id,
        { ref: 'room_id', type: 'fk', references: 'rooms', nullable: true },
        { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'departed'], default: 'booked' },
      ],
      states: {
        column: 'status',
        initial: 'booked',
        moves: { booked: ['in_house'], in_house: ['departed'], departed: [{ to: 'in_house', undo: true }] },
        effects: [{ on: { to: 'departed' }, via: 'room_id', set: { status: 'cleaning' } }],
      },
    },
  ]);
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an undo that would take back half a move, on ${dialect}`, () => {
    let h: InvoicingHarness;
    let served: Served;
    let cookie: string;

    const tableId = (ref: string) => served.composed.app.inject({ method: 'GET', url: `/api/v1/connections/${h.connectionId}/schema`, headers: { cookie } }).then((reply) => {
      const tables = (reply.json() as { model: { tables: { id: string; name: string }[] } }).model.tables;
      return tables.find((t) => t.name === h.real(ref))!.id;
    });
    const url = async (ref: string, rowId?: unknown) => `/api/v1/data/${h.connectionId}/${encodeURIComponent(await tableId(ref))}${rowId === undefined ? '' : `/${String(rowId)}`}`;
    const patch = async (rowId: unknown, payload: Record<string, unknown>) =>
      served.composed.app.inject({ method: 'PATCH', url: await url('stays', rowId), headers: { cookie }, payload });
    const row = async (ref: string, rowId: unknown) => (await h.rows(`SELECT * FROM ${h.real(ref)} WHERE id = ${String(rowId)}`))[0]!;
    let n = 0;

    /** A stay in the house, in a room of its own (or none). */
    async function inHouse(withRoom: boolean): Promise<{ stay: unknown; room: unknown }> {
      n += 1;
      let room: unknown = null;
      if (withRoom) {
        await h.rows(`INSERT INTO ${h.real('rooms')} (number, status) VALUES ('R${String(n)}', 'occupied')`);
        room = (await h.rows(`SELECT id FROM ${h.real('rooms')} WHERE number = 'R${String(n)}'`))[0]!['id'];
      }
      await h.rows(`INSERT INTO ${h.real('stays')} (room_id, status) VALUES (${room === null ? 'NULL' : String(room)}, 'in_house')`);
      const stay = (await h.rows(`SELECT MAX(id) AS id FROM ${h.real('stays')}`))[0]!['id'];
      return { stay, room };
    }

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest(), undefined, {}, { database: 'stays_undo' });
      served = await servePublic(h, null);
      const desk = await usersRepo(h.meta).create({ email: 'desk@hotel.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
      await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
      const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@hotel.dev', password: ADMIN_PASSWORD } });
      cookie = sessionCookie(login.headers['set-cookie']);
    }, 180_000);

    afterAll(async () => {
      await served?.close();
      await h?.close();
    });

    it('answers no undo for a check-out that turned its room to cleaning; the move back stays the app’s to make', async () => {
      const { stay, room } = await inHouse(true);
      const out = await patch(stay, { values: { status: 'departed' }, from: 'in_house' });
      expect(out.statusCode, out.body).toBe(200);
      expect((await row('rooms', room))['status']).toBe('cleaning');
      expect((out.json() as { undoToken: string | null }).undoToken).toBeNull();
      // Named by the state it saw, the move back is made — the room is the desk's to deal with.
      const back = await patch(stay, { values: { status: 'in_house' }, from: 'departed' });
      expect(back.statusCode, back.body).toBe(200);
      expect((await row('stays', stay))['status']).toBe('in_house');
    });

    it('answers no undo for the same check-out made as a bulk change of the one row', async () => {
      const { stay, room } = await inHouse(true);
      const bulk = await served.composed.app.inject({
        method: 'POST',
        url: `${await url('stays')}/bulk`,
        headers: { cookie },
        payload: { action: 'update', ids: [String(stay)], values: { status: 'departed' } },
      });
      expect(bulk.statusCode, bulk.body).toBe(200);
      expect((await row('rooms', room))['status']).toBe('cleaning');
      expect((bulk.json() as { undoToken: string | null }).undoToken).toBeNull();
    });

    it('still answers one when the move moved nothing else, and the Undo takes the stay back', async () => {
      const { stay } = await inHouse(false);
      const out = await patch(stay, { values: { status: 'departed' }, from: 'in_house' });
      expect(out.statusCode, out.body).toBe(200);
      const token = (out.json() as { undoToken: string | null }).undoToken;
      expect(token).not.toBeNull();
      const undone = await served.composed.app.inject({ method: 'POST', url: `/api/v1/data/undo/${token!}`, headers: { cookie } });
      expect(undone.statusCode, undone.body).toBe(200);
      expect((await row('stays', stay))['status']).toBe('in_house');
    });
  });
}
