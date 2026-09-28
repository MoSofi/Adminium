// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest's change of their own stay, over the public API of a small hotel
 * installed by the real installer, on every engine, at a fixed time in the
 * house's own zone (Dublin):
 *
 *  - two changes on one key, each its own entry and window: the dates until
 *    the free-cancellation line (`cancel_by`, stamped from the arrival), a
 *    note until the arrival day's check-in time — each writes only its own;
 *  - the dates' window is judged on the stay as it stands before the change:
 *    inside the line, moving the stay a week later is refused (its new line
 *    would be ahead); outside it, moving into the 48 hours goes through and
 *    answers the new line;
 *  - the quote of a change answers the new line, the new nights and the
 *    extras that follow them, as the save then leaves them;
 *  - a night with no room is named;
 *  - an extra taken off and put back is counted again: a parking space gone
 *    meanwhile refuses it, by night, and so does what it must agree with;
 *  - an extra is added only until the arrival day's check-in time.
 *
 * Another guest's stay answers every door as a stay that is not there.
 */
import { validateManifest } from '@adminium/manifest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { ROOM_TOTAL, wrenManifest, wrenTables } from './wren-house-fixture.js';

type Doc = Record<string, unknown>;
const ZONE = 'Europe/Dublin';
/** Monday 20 July 2026, 10:00 in Dublin. */
const NOW = Date.parse('2026-07-20T09:00:00.000Z');
const WINDOW_FROM_PARENT = { stay_id: { before: { column: 'arrive', time: { table: 'settings', column: 'arrive_from' } } } };
const STAY_SELECT = ['id', 'status', 'arrive', 'depart', 'guests', 'nights', 'room_total', 'extras_total', 'total', 'cancel_by', 'note'];
const EXTRA_SELECT = ['id', 'stay_id', 'extra_id', 'label', 'nights', 'guests', 'amount', 'state'];

function hotel(): Doc {
  const tables = wrenTables();
  const table = (ref: string) => tables.find((t) => t['ref'] === ref)!;
  const columns = (ref: string) => table(ref)['columns'] as Doc[];
  columns('settings').push({ ref: 'arrive_from', type: 'text', maxLength: 5, default: '15:00' }, { ref: 'cancel_days', type: 'int', default: 2 });
  columns('room_types').push({ ref: 'rooms', type: 'int', default: 1 });
  columns('extras').push({ ref: 'spaces', type: 'int', nullable: true }, { ref: 'max_guests', type: 'int', nullable: true });
  // An extra is on the stay or taken off it (the hotel's own shape): counted, and added up, only while on.
  columns('stay_extras').push({ ref: 'state', type: 'enum', enum: ['on', 'off'], default: 'on' });
  const extrasTotal = columns('stays').find((c) => c['ref'] === 'extras_total')!;
  extrasTotal['rules'] = { rollup: { from: 'stay_extras', via: 'stay_id', sum: 'amount', where: { column: 'state', eq: 'on' } } };
  tables.unshift({
    ref: 'customers',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'email', type: 'text', maxLength: 254, nullable: true, unique: true, rules: { normalize: 'email', validation: { format: 'email' } } },
      { ref: 'name', type: 'text', maxLength: 120, nullable: true },
    ],
  });
  columns('stays').push(
    { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
    { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'cancelled'], default: 'booked' },
    {
      ref: 'cancel_by',
      type: 'timestamptz',
      nullable: true,
      rules: { stamp: { set: { moment: { column: 'arrive', time: { table: 'settings', column: 'arrive_from' }, minus: { days: { table: 'settings', column: 'cancel_days' } } } }, on: { columns: ['arrive'] } } },
    },
  );
  table('stays')['capacity'] = { kind: 'night', from: 'arrive', to: 'depart', countWhere: { column: 'status', values: ['booked', 'in_house'] }, pool: { via: 'room_type_id', size: { column: 'rooms' } } };
  table('stay_extras')['capacity'] = {
    kind: 'night',
    from: { via: 'stay_id', column: 'arrive' },
    to: { via: 'stay_id', column: 'depart' },
    countWhere: [{ column: 'state', values: ['on'] }, { column: 'status', values: ['booked', 'in_house'], via: 'stay_id' }],
    pool: { via: 'extra_id', size: { column: 'spaces' } },
  };
  void ROOM_TOTAL;
  const manifest = wrenManifest(tables);
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  const mine = { level: 'verified', claimedBy: { table: 'customers', column: 'customer_id' } };
  manifest['publicAccess'] = [
    { table: 'customers', methods: ['GET', 'PATCH'], select: ['name', 'email'], writable: ['name'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true },
    { table: 'stays', methods: ['GET'], ...mine, select: STAY_SELECT },
    // The dates, until the free-cancellation line; the new price first.
    { table: 'stays', methods: ['PATCH'], ...mine, select: STAY_SELECT, writable: ['arrive', 'depart'], writableWhen: { status: ['booked'], cancel_by: { before: {} } }, dryRun: true, expect: 'total' },
    // A note for the house, until the arrival day's check-in time.
    { table: 'stays', methods: ['PATCH'], ...mine, select: STAY_SELECT, writable: ['note'], writableWhen: { status: ['booked'], arrive: { before: { time: { table: 'settings', column: 'arrive_from' } } } } },
    // An extra added, until the arrival day's check-in time.
    // The extras a guest sees: only those on the stay.
    { table: 'stay_extras', methods: ['GET'], level: 'verified', visibleWith: { table: 'stays', via: 'stay_id' }, select: EXTRA_SELECT, filters: [{ column: 'state', op: 'eq', value: 'on' }] },
    { table: 'stay_extras', methods: ['POST'], level: 'verified', visibleWith: { table: 'stays', via: 'stay_id' }, select: EXTRA_SELECT, writable: ['stay_id', 'extra_id'], writableWhen: WINDOW_FROM_PARENT },
    // Taken off and put back, until then too, agreeing with what the extra allows.
    {
      table: 'stay_extras',
      methods: ['PATCH'],
      level: 'verified',
      visibleWith: { table: 'stays', via: 'stay_id' },
      select: EXTRA_SELECT,
      writable: ['state'],
      writableValues: { state: ['on', 'off'] },
      writableWhen: WINDOW_FROM_PARENT,
      agrees: [{ column: 'guests', lte: { via: 'extra_id', column: 'max_guests' } }],
    },
    { table: 'extras', methods: ['GET'], select: ['id', 'label', 'each', 'per'] },
  ];
  return manifest;
}

describe('the hotel', () => {
  it('validates, two changes on one key and a child create inside its parent\'s window among them', () => {
    const result = validateManifest(hotel());
    expect(result.ok ? [] : result.issues).toEqual([]);
  });
});

describe.each(LEGS)("a guest's change of their own stay — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let shop: Served;
  let g: ReturnType<typeof guest>;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let ana: string;
  let ben: string;
  const t = (ref: string) => `wren_${ref}`;
  const ids: Record<string, number> = {};
  let refs: Record<string, string>;
  let clock = NOW;

  const at = (ms: number) => {
    clock = ms;
    if (vi.isFakeTimers()) vi.setSystemTime(ms);
    else vi.useFakeTimers({ now: ms, toFake: ['Date'] });
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, hotel());
    await h.meta.db.updateTable('adminium_connections').set({ timezone: ZONE }).where('id', '=', h.connectionId).execute();
    await mailReady(h.meta);
    w = await writerFor(h, ZONE);
    await w.create('settings', { tax_rate: '0.000', arrive_from: '15:00', cancel_days: 2 });
    await w.create('room_types', { code: 'garden', name: 'Garden', base_rate: '100.00', sleeps: 2, rooms: 5 });
    await w.create('room_types', { code: 'harbour', name: 'Harbour', base_rate: '180.00', sleeps: 2, rooms: 1 });
    await w.create('extras', { label: 'Breakfast', each: '10.00', per: 'person-night' });
    await w.create('extras', { label: 'Parking', each: '14.00', per: 'night', spaces: 1 });
    await w.create('extras', { label: 'Cot', each: '5.00', per: 'stay', max_guests: 2 });
    await w.create('customers', { email: 'ana@guests.ie', name: 'Ana' });
    await w.create('customers', { email: 'ben@guests.ie', name: 'Ben' });
    at(NOW);
    const stay = async (name: string, customer: number, values: Doc) => {
      const row = await w.create('stays', { first_name: name, customer_id: customer, guests: 2, ...values });
      ids[name] = Number(row['id']);
    };
    await stay('later', 1, { room_type_id: 1, arrive: '2026-07-30', depart: '2026-08-02' });
    await stay('soon', 1, { room_type_id: 1, arrive: '2026-07-21', depart: '2026-07-23' });
    await stay('quoted', 1, { room_type_id: 1, arrive: '2026-08-20', depart: '2026-08-22' });
    await stay('harbour', 1, { room_type_id: 2, arrive: '2026-08-12', depart: '2026-08-14' });
    await stay('bens', 2, { room_type_id: 2, arrive: '2026-08-10', depart: '2026-08-11' });
    await stay('bensParked', 2, { room_type_id: 1, arrive: '2026-07-31', depart: '2026-08-02', guests: 3 });
    await stay('anasParked', 1, { room_type_id: 1, arrive: '2026-07-30', depart: '2026-08-02' });
    const extra = async (name: string, stayName: string, extraId: number, state = 'on') => {
      const row = await w.create('stay_extras', { stay_id: ids[stayName], extra_id: extraId, state });
      ids[name] = Number(row['id']);
    };
    await extra('breakfast', 'quoted', 1);
    await extra('offCot', 'quoted', 3, 'off');
    await extra('parking', 'anasParked', 2);
    await extra('bensParking', 'bensParked', 2, 'off');
    await extra('bensCot', 'bensParked', 3, 'off');
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    shop = await servePublic(h, keys['customer']!);
    g = guest(shop, h);
    // Signed in on the house's clock: every later sign-in is newer.
    ana = await g.signIn('ana@guests.ie');
    ben = await g.signIn('ben@guests.ie');
    const config = (await g.request('GET', '/config')).json() as { data: { refs: Record<string, { actions: string[]; writable: string[] }> } };
    const find = (prefix: string, test: (r: { actions: string[]; writable: string[] }) => boolean) => Object.entries(config.data.refs).find(([ref, r]) => ref.startsWith(prefix) && test(r))![0];
    refs = {
      stays: find(t('stays'), (r) => r.actions.includes('read')),
      dates: find(t('stays'), (r) => r.actions.includes('update') && r.writable.includes('arrive')),
      note: find(t('stays'), (r) => r.actions.includes('update') && r.writable.includes('note')),
      addExtra: find(t('stay_extras'), (r) => r.actions.includes('create')),
      extras: find(t('stay_extras'), (r) => r.actions.includes('read') && !r.actions.includes('update') && !r.actions.includes('create')),
      extra: find(t('stay_extras'), (r) => r.actions.includes('update') && r.writable.includes('state')),
    };
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    vi.useRealTimers();
    await shop.close();
    await h.close();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const patch = (ref: string, id: number, values: Doc, session: string, more: Doc = {}) => {
    at(clock);
    return g.request('PATCH', `/records/${ref}/${String(id)}`, { payload: { values, ...more }, session });
  };
  const quote = (ref: string, id: number, values: Doc, session: string) => {
    at(clock);
    return g.request('POST', `/records/${ref}/${String(id)}/dry-run`, { payload: { values }, session });
  };
  const stayOf = async (name: string) => (await h.rows(`select arrive, depart, note, cancel_by, total from ${h.real('stays')} where id = ${String(ids[name])}`))[0]!;
  /** A stored or answered instant as ISO: SQLite keeps the server's own wall clock, MySQL's driver hands back UTC. */
  const instant = (value: unknown) => {
    if (value instanceof Date) return value.toISOString();
    const text = String(value);
    if (text.includes('T')) return new Date(text).toISOString();
    return new Date(dialect === 'sqlite' ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`).toISOString();
  };
  /** A session signed in at the clock set now (a session unused for half an hour ends). */
  const signedIn = async (email: string) => {
    at(clock);
    return g.signIn(email);
  };

  it.skipIf(!available)('judges the dates on the stay before the change: inside the line nothing moves; outside it the stay moves into the 48 hours', async () => {
    clock = NOW;
    // Inside the line (it passed on Sunday at 15:00): a week later is refused, and nothing changed.
    const inside = await patch(refs['dates']!, ids['soon']!, { arrive: '2026-08-05', depart: '2026-08-07' }, ana);
    expect(inside.statusCode, inside.body).toBe(409);
    expect(inside.json()).toMatchObject({ error: { code: 'PUBLIC_TOO_LATE', params: { at: '2026-07-19T14:00:00.000Z' } } });
    expect(await quote(refs['dates']!, ids['soon']!, { arrive: '2026-08-05', depart: '2026-08-07' }, ana)).toMatchObject({ statusCode: 409 });
    expect(instant((await stayOf('soon'))['cancel_by'])).toBe('2026-07-19T14:00:00.000Z');
    // Outside it: into the 48 hours, and the answer carries the new line.
    const moved = await patch(refs['dates']!, ids['later']!, { arrive: '2026-07-21', depart: '2026-07-24' }, ana);
    expect(moved.statusCode, moved.body).toBe(200);
    expect(instant((moved.json() as { data: Doc }).data['cancel_by'])).toBe('2026-07-19T14:00:00.000Z');
    // Now inside: moving it again is refused.
    expect((await patch(refs['dates']!, ids['later']!, { arrive: '2026-07-30', depart: '2026-08-02' }, ana)).statusCode).toBe(409);
  });

  it.skipIf(!available)("adds an extra until the arrival day's check-in time, and not after", async () => {
    clock = Date.parse('2026-07-21T13:30:00.000Z');
    const session = await signedIn('ana@guests.ie');
    const early = await g.request('POST', `/records/${refs['addExtra']!}`, { payload: { values: { stay_id: ids['soon'], extra_id: 1 } }, session });
    expect(early.statusCode, early.body).toBe(201);
    clock = Date.parse('2026-07-21T14:30:00.000Z');
    const late = await g.request('POST', `/records/${refs['addExtra']!}`, { payload: { values: { stay_id: ids['soon'], extra_id: 3 } }, session: await signedIn('ana@guests.ie') });
    expect(late.statusCode, late.body).toBe(409);
    expect(late.json()).toMatchObject({ error: { code: 'PUBLIC_TOO_LATE', params: { at: '2026-07-21T14:00:00.000Z' } } });
    expect(Number((await h.rows(`select count(*) as n from ${h.real('stay_extras')} where stay_id = ${String(ids['soon'])}`))[0]!['n'])).toBe(1);
  });

  it.skipIf(!available)('keeps each change to its own entry and window', async () => {
    clock = NOW;
    // The note, inside the cancellation line but before the arrival day's check-in time.
    const noted = await patch(refs['note']!, ids['soon']!, { note: 'Late arrival' }, ana);
    expect(noted.statusCode, noted.body).toBe(200);
    expect((await stayOf('soon'))['note']).toBe('Late arrival');
    expect((await patch(refs['note']!, ids['soon']!, { arrive: '2026-07-22' }, ana)).statusCode).toBe(400);
    expect((await patch(refs['dates']!, ids['quoted']!, { note: 'x' }, ana)).statusCode).toBe(400);
    // Past the arrival day's check-in time the note is closed too.
    clock = Date.parse('2026-07-21T14:30:00.000Z');
    const late = await patch(refs['note']!, ids['soon']!, { note: 'Later still' }, await signedIn('ana@guests.ie'));
    expect(late.statusCode, late.body).toBe(409);
    expect(late.json()).toMatchObject({ error: { code: 'PUBLIC_TOO_LATE', params: { at: '2026-07-21T14:00:00.000Z' } } });
  });

  it.skipIf(!available)('quotes the new line, the new nights and the extras that follow them, as the save leaves them', async () => {
    clock = NOW;
    const asked = { arrive: '2026-08-20', depart: '2026-08-23' };
    const q = await quote(refs['dates']!, ids['quoted']!, asked, ana);
    expect(q.statusCode, q.body).toBe(200);
    const body = q.json() as { data: Doc; nights: { date: string; rate: string }[]; children: Record<string, { data: Doc }[]> };
    expect(instant(body.data['cancel_by'])).toBe('2026-08-18T14:00:00.000Z');
    expect(body.nights.map((n) => n.date)).toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
    // Only what the guest's own list of the stay's extras shows: the cot taken off is no row of it.
    const listed = ((await g.request('GET', `/records/${refs['extras']!}`, { session: ana })).json() as { data: Doc[] }).data.filter((row) => row['stay_id'] === ids['quoted']);
    expect(listed.map((row) => row['id'])).toEqual([ids['breakfast']]);
    for (const [ref, rows] of Object.entries(body.children)) expect(rows.map((row) => row.data['id']), ref).not.toContain(ids['offCot']);
    const extras = body.children[refs['extras']!]!;
    expect(extras).toHaveLength(1);
    expect(extras[0]!.data).toMatchObject({ id: ids['breakfast'], nights: 3, guests: 2 });
    expect(Number(extras[0]!.data['amount'])).toBe(60);
    // Nothing was kept.
    expect(String((await stayOf('quoted'))['depart'])).toContain('2026-08-22');
    const saved = await patch(refs['dates']!, ids['quoted']!, asked, ana, { expect: { total: String(body.data['total']) } });
    expect(saved.statusCode, saved.body).toBe(200);
    const row = (await h.rows(`select nights, amount from ${h.real('stay_extras')} where id = ${String(ids['breakfast'])}`))[0]!;
    expect([Number(row['nights']), Number(row['amount'])]).toEqual([3, 60]);
    expect(Number((saved.json() as { data: Doc }).data['total'])).toBe(Number(body.data['total']));
  });

  it.skipIf(!available)('names the night that has no room', async () => {
    clock = NOW;
    const asked = { arrive: '2026-08-09', depart: '2026-08-11' };
    for (const res of [await quote(refs['dates']!, ids['harbour']!, asked, ana), await patch(refs['dates']!, ids['harbour']!, asked, ana)]) {
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json()).toMatchObject({ error: { code: 'PUBLIC_NO_ROOM', params: { column: 'room_type_id', night: '2026-08-10' } } });
    }
  });

  it.skipIf(!available)('counts an extra put back again, by night, and holds it to what the extra allows', async () => {
    clock = NOW;
    // Ana's parking holds the one space on 31 July and 1 August: Ben's cannot come back.
    const back = await patch(refs['extra']!, ids['bensParking']!, { state: 'on' }, ben);
    expect(back.statusCode, back.body).toBe(409);
    expect(back.json()).toMatchObject({ error: { code: 'PUBLIC_NO_ROOM', params: { night: '2026-07-31' } } });
    // Ana takes hers off: Ben's comes back.
    expect((await patch(refs['extra']!, ids['parking']!, { state: 'off' }, ana)).statusCode).toBe(200);
    expect((await patch(refs['extra']!, ids['bensParking']!, { state: 'on' }, ben)).statusCode).toBe(200);
    // A cot for two guests at most, on a stay of three: refused.
    const cot = await patch(refs['extra']!, ids['bensCot']!, { state: 'on' }, ben);
    expect(cot.statusCode, cot.body).toBe(400);
    expect(cot.json()).toMatchObject({ error: { code: 'PUBLIC_WRITE_REFUSED', params: { column: 'guests' } } });
  });

  it.skipIf(!available)("answers another guest's stay, at every door, as a stay that is not there", async () => {
    clock = NOW;
    const doors = async (id: number) => [
      await patch(refs['dates']!, id, { arrive: '2026-08-25', depart: '2026-08-26' }, ben),
      await quote(refs['dates']!, id, { arrive: '2026-08-25', depart: '2026-08-26' }, ben),
      await patch(refs['note']!, id, { note: 'mine' }, ben),
    ];
    const theirs = await doors(ids['quoted']!);
    const nobodys = await doors(999_999);
    expect(theirs.map((r) => r.statusCode)).toEqual([404, 404, 404]);
    expect(theirs.map((r) => JSON.parse(r.body) as unknown)).toEqual(nobodys.map((r) => JSON.parse(r.body) as unknown));
    at(clock);
    const add = await g.request('POST', `/records/${refs['addExtra']!}`, { payload: { values: { stay_id: ids['quoted'], extra_id: 1 } }, session: ben });
    expect(add.statusCode).not.toBe(201);
  });
});
