// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A record the app holds to an agreement of its own — a stay's guests no
 * more than its room sleeps, declared on the guests' create entry — is held
 * to it on every door a desk writes one through: a create with links, a
 * create of one record per value, a change, a change with links, a bulk
 * change. Judged on the row as the write leaves it, inside the write: a
 * refused one keeps nothing. On every engine.
 */
import { publicEndpointsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { asUser } from './connections-helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };

function inn(): Record<string, unknown> {
  const manifest = invoicingManifest([
    { ref: 'room_types', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'sleeps', type: 'int', default: 2 }] },
    {
      ref: 'stays',
      columns: [id, { ref: 'room_type_id', type: 'fk', references: 'room_types' }, { ref: 'guests', type: 'int', default: 1 }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }],
    },
    { ref: 'tags', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }] },
    { ref: 'stay_tags', columns: [id, { ref: 'stay_id', type: 'fk', references: 'stays' }, { ref: 'tag_id', type: 'fk', references: 'tags' }] },
  ]);
  manifest['key'] = 'inn';
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [
    { table: 'room_types', methods: ['GET'], select: ['id', 'name', 'sleeps'] },
    { table: 'stays', methods: ['POST'], humanCheck: true, writable: ['room_type_id', 'guests'], select: ['id'], agrees: [{ column: 'guests', lte: { via: 'room_type_id', column: 'sleeps' } }] },
  ];
  return manifest;
}

describe.each(LEGS)("a desk's record held to the app's agreement on every door — %s", (dialect, available) => {
  let h: InvoicingHarness;
  let r: DataRoutes;
  let tagged: string;
  const count = async () => Number((await h.rows(`select count(*) as n from ${h.real('stays')}`))[0]!['n']);
  const guests = async (key: unknown) => Number((await h.rows(`select guests from ${h.real('stays')} where id = ${String(key)}`))[0]!['guests']);
  const refused = (res: { statusCode: number; body: string; json: <T>() => T }) => {
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json<{ error: { details: Record<string, unknown> } }>().error.details).toMatchObject({ fields: { guests: { code: 'too-many' } } });
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, inn());
    await h.rows(`INSERT INTO ${h.real('room_types')} (id, name, sleeps) VALUES (1, 'Double', 2), (2, 'Family', 4)`);
    await h.rows(`INSERT INTO ${h.real('tags')} (id, name) VALUES (1, 'late')`);
    r = await dataRoutesOver(h, dialect);
    for (const row of await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)) {
      await publicEndpointsRepo(r.t.meta).create({ connectionId: r.connectionId, ref: row.ref, origin: row.origin, definition: row.definition, managedBy: row.managedBy });
    }
    const model = (await r.t.app.inject({ method: 'GET', url: `/api/v1/connections/${r.connectionId}/schema`, headers: asUser(r.t.users.admin) })).json<{
      model: { relations: { id: string; from: { tableId: string }; through: { tableId: string } | null }[] };
    }>().model;
    tagged = model.relations.find((x) => x.through?.tableId === r.table('stay_tags') && x.from.tableId === r.table('stays'))!.id;
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await r.close();
    await h.close();
  });

  it.runIf(available)('a create with links, and one of a record per value', async () => {
    const before = await count();
    refused(await r.post('stays', { values: { room_type_id: 1, guests: 3 }, links: { [tagged]: ['1'] } }));
    refused(await r.post('stays', { values: { room_type_id: 1, guests: 3 }, repeat: { column: 'note', values: ['a', 'b'] } }));
    expect(await count()).toBe(before);
    const fits = await r.post('stays', { values: { room_type_id: 2, guests: 3 }, links: { [tagged]: ['1'] } });
    expect(fits.statusCode, fits.body).toBe(201);
    const each = await r.post('stays', { values: { room_type_id: 1, guests: 2 }, repeat: { column: 'note', values: ['a', 'b'] } });
    expect(each.statusCode, each.body).toBe(201);
    expect(await count()).toBe(before + 3);
  });

  it.runIf(available)('a change, a change with links, and a bulk change', async () => {
    const made = await r.post('stays', { values: { room_type_id: 1, guests: 2 } });
    expect(made.statusCode, made.body).toBe(201);
    const stay = made.json<{ data: { id: unknown } }>().data.id;
    refused(await r.patch('stays', stay, { values: { guests: 3 } }));
    refused(await r.patch('stays', stay, { values: { guests: 3 }, links: { [tagged]: ['1'] } }));
    const bulk = await r.t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${r.connectionId}/${r.table('stays')}/bulk`,
      headers: asUser(r.t.users.admin),
      payload: { action: 'update', ids: [stay], values: { guests: 5 } },
    });
    refused(bulk);
    expect(await guests(stay)).toBe(2);
    // The room changes with the guests: the family room sleeps four.
    const moved = await r.patch('stays', stay, { values: { guests: 3, room_type_id: 2 } });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(await guests(stay)).toBe(3);
  });
});
