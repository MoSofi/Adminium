// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A name a stranger types on a public create is judged by the rule a child
 * row's note is: no web address, handle or path — on every door that takes
 * one, on every engine. A name like "refund-desk.com Smith" would otherwise
 * be printed in the venue's own confirmation email, sent to any address.
 *
 *  - an order with its lines, a person found by address (the tree's door),
 *    and its dry run;
 *  - a single create with no lines;
 *  - a change through the row's own link (`limits.plainText`);
 *  - a batch through a hand-made endpoint.
 *
 * Names with dots, hyphens, apostrophes and brackets still pass, and a child
 * row's note is judged as before.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

type Doc = Record<string, unknown>;

/** Web addresses, a handle, a link, and lookalike dots: every one refused. */
const LINKS = ['refund-desk.com Smith', 'Smith www.x.io', 'a@b.co', 'https://x', 'EVIL.COM', 'пример.рф', 'shop.co.uk', 'evil．com'];
/** Names: every one taken. "x dot com" names no place a link can go, and a child row's note takes it too. */
const NAMES = ["Anna-Marie O'Brien", 'Zoë (table)', 'x dot com', 'J.R.R. Tolkien'];

/** The shop, its order's name held to plain text, its lines' dish too, a note changed through the own link, and a one-row enquiry. */
function shop(): Doc {
  const manifest = shopManifest({
    entries: (entries) => [
      ...entries.map((entry) => {
        if (entry['table'] === 'orders' && entry['identity'] !== undefined) {
          const children = entry['children'] as { order_items: Doc };
          return {
            ...entry,
            anonymous: { perValue: { columns: ['email'], n: 20 }, plainText: ['name'] },
            children: { order_items: { ...children.order_items, plainText: ['dish'] } },
          };
        }
        if (entry['table'] === 'orders' && entry['key'] === 'link') return { ...entry, limits: { plainText: ['note'] } };
        return entry;
      }),
      { table: 'enquiries', methods: ['POST'], select: ['id'], writable: ['name', 'body'], anonymous: { perKeyHour: 1000, plainText: ['name'] } },
    ],
  });
  (manifest['requiredSchema'] as { tables: Doc[] }).tables.push({
    ref: 'enquiries',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 80 },
      { ref: 'body', type: 'text', maxLength: 200, nullable: true },
    ],
  });
  return manifest;
}

describe.each(LEGS)('a stranger\'s name is judged link-free on every public door — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let customer: Served;
  let link: Served;
  let g: ReturnType<typeof guest>;
  let own: ReturnType<typeof guest>;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shop());
    await mailReady(h.meta);
    const keys = (h.reply['publicAccess'] as { keys: Record<string, string> }).keys;
    customer = await servePublic(h, keys['customer']!);
    link = await servePublic(h, keys['link']!);
    g = guest(customer, h);
    own = guest(link, h, 40_000);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await customer.close();
    await link.close();
    await h.close();
  });

  const count = async (ref: string) => Number((await h.rows(`select count(*) as n from ${h.real(ref)}`))[0]!['n']);
  const order = (name: string, dish = 'Soup') => {
    n += 1;
    return { values: { email: `guest${String(n)}@fieldmail.io`, name }, children: { order_items: [{ values: { dish, qty: 1 } }] } };
  };
  const place = (payload: Doc, dry = false) => g.request('POST', `/records/${h.real('orders')}_verified_2${dry ? '/dry-run' : ''}`, { payload, proof: 'write' });
  const refusedFor = (res: { statusCode: number; body: string; json: () => unknown }, params: Doc) => {
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: unknown }).error).toEqual({ code: 'PUBLIC_WRITE_REFUSED', params, message: expect.any(String) });
  };

  it.skipIf(!available)('an order with its lines: a name with a web address is refused, saved or tried, and nothing is written or mailed', async () => {
    const [orders, people, messages] = [await count('orders'), await count('customers'), await count('messages')];
    for (const name of LINKS) {
      refusedFor(await place(order(name)), { column: 'name' });
      refusedFor(await place(order(name), true), { column: 'name' });
    }
    expect([await count('orders'), await count('customers'), await count('messages')]).toEqual([orders, people, messages]);
    for (const name of NAMES) {
      const res = await place(order(name));
      expect(res.statusCode, `${name}: ${res.body}`).toBe(201);
    }
    // Each taken order found or made its person by address, and queued its confirmation.
    expect(await count('orders')).toBe(orders + NAMES.length);
    expect(await count('messages')).toBe(messages + NAMES.length);
  });

  it.skipIf(!available)("a line's note is judged as it always was: the same rule, named at the line", async () => {
    refusedFor(await place(order('Lea', 'refund-desk.com')), { child: 'order_items', index: 0, path: ['order_items', 0], column: 'dish' });
    refusedFor(await place(order('Lea', 'a@b.co')), { child: 'order_items', index: 0, path: ['order_items', 0], column: 'dish' });
    for (const dish of NAMES) expect((await place(order('Lea', dish))).statusCode, dish).toBe(201);
  });

  it.skipIf(!available)('a single create with no lines: the same rule, the same refusal', async () => {
    const before = await count('enquiries');
    for (const name of LINKS) refusedFor(await g.request('POST', `/records/${h.real('enquiries')}`, { payload: { values: { name, body: 'Hello' } } }), { column: 'name' });
    expect(await count('enquiries')).toBe(before);
    for (const name of NAMES) {
      const res = await g.request('POST', `/records/${h.real('enquiries')}`, { payload: { values: { name, body: 'Hello' } } });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(201);
    }
  });

  it.skipIf(!available)("a change through the row's own link: the same rule", async () => {
    const made = await place(order('Mia'));
    expect(made.statusCode, made.body).toBe(201);
    const { data, link: own_ } = made.json() as { data: { id: number }; link: { token: string } };
    const opened = await own.request('POST', '/claim/token', { payload: { token: own_.token } });
    expect(opened.statusCode, opened.body).toBe(200);
    const session = (opened.json() as { data: { session: string } }).data.session;
    const change = (note: string) => own.request('PATCH', `/records/${h.real('orders')}_claimed/${String(data.id)}`, { session, payload: { values: { note } } });
    for (const note of LINKS) refusedFor(await change(note), { column: 'note' });
    for (const note of NAMES) expect((await change(note)).statusCode, note).toBe(200);
  });
});

const SPEC: SourceSpec = {
  ddl: {
    sqlite: ['CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body VARCHAR(100) NOT NULL)'],
    postgres: ['CREATE TABLE notes (id serial PRIMARY KEY, body varchar(100) NOT NULL)'],
    mysql: ['CREATE TABLE notes (id INT AUTO_INCREMENT PRIMARY KEY, body VARCHAR(100) NOT NULL)'],
  },
  seed: [],
};

let served: ServedSource | null = null;
afterEach(async () => {
  await served?.close();
  served = null;
});

/** A hand-made endpoint anyone may write, its `body` held to plain text; a key with POST and BATCH. */
async function setUp(s: ServedSource): Promise<string> {
  const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
  const source = (list.json() as { sources: { id: string }[] }).sources.find((x) => x.id.endsWith('notes'))?.id ?? '';
  const save = await s.app.inject({
    method: 'PUT',
    url: `/api/v1/public-endpoints/${s.connectionId}/notes`,
    headers: { cookie: s.cookie },
    payload: {
      definition: JSON.stringify({
        path: '/notes',
        source,
        methods: ['POST', 'BATCH'],
        select: ['id', 'body'],
        pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 10000, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
        writable: ['body'],
        anonymous: { per_key_hour: 1000, plain_text: ['body'] },
      }),
    },
  });
  expect(save.statusCode, save.body).toBe(200);
  const key = await s.app.inject({
    method: 'POST',
    url: '/api/v1/public-keys',
    headers: { cookie: s.cookie },
    payload: { name: 'Site', connectionId: s.connectionId, access: [{ ref: 'notes', methods: ['POST', 'BATCH'] }] },
  });
  expect(key.statusCode, key.body).toBe(201);
  return (key.json() as { token: string }).token;
}

for (const leg of SOURCE_LEGS) {
  describe.skipIf(!leg.available)(`a hand-made endpoint's plain text, one row and a batch [${leg.dialect}]`, () => {
    it('refuses a web address in one row and in any row of a batch, naming the row, and writes nothing', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      const token = await setUp(s);
      const headers = { authorization: `Bearer ${token}`, origin: PUBLIC_ORIGIN };
      const one = (body: string) => s.app.inject({ method: 'POST', url: '/api/v1/public/records/notes', headers, payload: { values: { body } } });
      const batch = (rows: Doc[]) => s.app.inject({ method: 'POST', url: '/api/v1/public/records/notes/batch', headers, payload: { rows } });
      for (const body of LINKS) {
        const res = await one(body);
        expect(res.statusCode, `${body}: ${res.body}`).toBe(400);
        expect((res.json() as { error: unknown }).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'body' } });
        const rows = await batch([{ body: 'Ana' }, { body }]);
        expect(rows.statusCode, `${body}: ${rows.body}`).toBe(400);
        expect((rows.json() as { error: unknown }).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { index: 1, column: 'body' } });
      }
      expect(await s.query('SELECT id FROM notes')).toEqual([]);
      for (const body of NAMES) expect((await one(body)).statusCode, body).toBe(201);
      const taken = await batch(NAMES.map((body) => ({ body })));
      expect(taken.statusCode, taken.body).toBe(200);
      expect((await s.query('SELECT body FROM notes ORDER BY id')).map((r) => r['body'])).toEqual([...NAMES, ...NAMES]);
    }, 120_000);
  });
}
