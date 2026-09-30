// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plain text in a diner's own script, and a note that may hold a few digits:
 *
 *  - every plain-text column takes the punctuation a sentence is written
 *    with, in Latin, CJK and Arabic script ("少放辣，切六块", "من فضلك؟",
 *    "No onions!"), and still no digit in a name;
 *  - a column the app marks `{ "column": "note", "digits": 4, "max": 140 }`
 *    takes up to four digits in all ("2 without onions", "table 12") and 140
 *    characters, never a phone number, and never a web address however it is
 *    dotted (`evil。com`, `shop1.com`);
 *  - the same rule on every door that writes the column: the create, its
 *    lines, a change through the row's own link (`limits`), a signed-in
 *    person's change of their own order, and a hand-made endpoint.
 *
 * On every engine.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PLAIN_TEXT_REFUSED } from '../src/public-api/anonymous-caps.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

type Doc = Record<string, unknown>;

/** Names in a diner's own punctuation: every one taken. */
const NAMES = ['王小明', '李「阿明」', 'محمد، الأب', 'Zoë!', '¿Ana?', 'Robert "Bob" Smith', 'Ana; Kai', 'Kai: table'];
/** Names with a digit in them: a name holds none. */
const NUMBERED = ['Table 12', 'Ana 2', 'Kai ２'];
/** Notes: sentences, and up to four digits in all. */
const NOTES = ['少放辣，切六块。', 'بدون بصل، من فضلك؟', '2 without onions!', 'Ring flat 3B: door 12', '２個、辛さ控えめ', '「不要香菜」', 'x'.repeat(140)];
/** Notes refused: a phone number, too many digits, too long, a web address however it is dotted, a tag. */
const REFUSED_NOTES = ['Call 0800 123', '12345', '1 2 3 4 5', 'x'.repeat(141), 'evil。com', 'refund-desk。cafe now', 'shop1.com', 'go to evil.com!', 'evil.xyz?', '#1 please', 'a@b.co'];

const NOTE = { column: 'note', digits: 4, max: 140 };

/**
 * The shop: the order's name held to plain text as a name, its note as a note;
 * its lines' dish taking two digits; the note changed through the order's own
 * link under the same `limits`, and by the signed-in buyer with no `limits`
 * of its own (judged by the create's rule).
 */
function shop(): Doc {
  return shopManifest({
    entries: (entries) =>
      entries.map((entry) => {
        if (entry['table'] === 'orders' && entry['identity'] !== undefined) {
          const children = entry['children'] as { order_items: Doc };
          return {
            ...entry,
            anonymous: { perValue: { columns: ['email'], n: 20 }, plainText: ['name', NOTE] },
            children: { order_items: { ...children.order_items, plainText: [{ column: 'dish', digits: 2 }] } },
          };
        }
        if (entry['table'] === 'orders' && entry['key'] === 'link') return { ...entry, limits: { plainText: [NOTE] } };
        if (entry['table'] === 'orders' && entry['claimedBy'] !== undefined && (entry['methods'] as string[]).includes('GET')) {
          return { ...entry, methods: ['GET', 'PATCH'], writable: ['note'] };
        }
        return entry;
      }),
  });
}

describe.each(LEGS)("a diner's own punctuation, and a note's few digits — %s", (dialect, available) => {
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
  const order = (values: Doc, dish = 'Soup') => {
    n += 1;
    return { values: { email: `diner${String(n)}@fieldmail.io`, name: 'Lea', ...values }, children: { order_items: [{ values: { dish, qty: 1 } }] } };
  };
  const place = (payload: Doc, dry = false) => g.request('POST', `/records/${h.real('orders')}_verified_2${dry ? '/dry-run' : ''}`, { payload, proof: 'write' });
  const refusedFor = (res: { statusCode: number; body: string; json: () => unknown }, params: Doc) => {
    expect(res.statusCode, res.body).toBe(400);
    expect((res.json() as { error: unknown }).error).toEqual({ code: 'PUBLIC_WRITE_REFUSED', params, message: PLAIN_TEXT_REFUSED });
  };

  it.skipIf(!available)("a name takes a diner's own punctuation, and still no digit", async () => {
    for (const name of NAMES) {
      const res = await place(order({ name }));
      expect(res.statusCode, `${name}: ${res.body}`).toBe(201);
    }
    const before = await count('orders');
    for (const name of [...NUMBERED, 'x'.repeat(81)]) {
      refusedFor(await place(order({ name })), { column: 'name' });
      refusedFor(await place(order({ name }), true), { column: 'name' });
    }
    expect(await count('orders')).toBe(before);
  });

  it.skipIf(!available)('a note takes a few digits and its own length, and never a number to call or a web address', async () => {
    const before = await count('orders');
    for (const note of REFUSED_NOTES) {
      refusedFor(await place(order({ note })), { column: 'note' });
      refusedFor(await place(order({ note }), true), { column: 'note' });
    }
    expect(await count('orders')).toBe(before);
    for (const note of NOTES) {
      const res = await place(order({ note }));
      expect(res.statusCode, `${note}: ${res.body}`).toBe(201);
    }
    const stored = await h.rows(`select note from ${h.real('orders')} order by id desc`);
    expect(stored.slice(0, NOTES.length).map((r) => r['note']).reverse()).toEqual(NOTES);
  });

  it.skipIf(!available)("a line's dish takes the digits its own rule gives, named at the line", async () => {
    for (const dish of ['2 without onions', '辣度：2', 'Soup, 2 spoons']) expect((await place(order({}, dish))).statusCode, dish).toBe(201);
    for (const dish of ['Soup 123', 'evil。com', 'shop1.com']) {
      const res = await place(order({}, dish));
      expect(res.statusCode, `${dish}: ${res.body}`).toBe(400);
      expect((res.json() as { error: unknown }).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { child: 'order_items', index: 0, path: ['order_items', 0], column: 'dish' } });
    }
  });

  it.skipIf(!available)("a change through the row's own link holds the note to its limits", async () => {
    const made = await place(order({}));
    expect(made.statusCode, made.body).toBe(201);
    const { data, link: token } = made.json() as { data: { id: number }; link: { token: string } };
    const opened = await own.request('POST', '/claim/token', { payload: { token: token.token } });
    expect(opened.statusCode, opened.body).toBe(200);
    const session = (opened.json() as { data: { session: string } }).data.session;
    const change = (note: string) => own.request('PATCH', `/records/${h.real('orders')}_claimed/${String(data.id)}`, { session, payload: { values: { note } } });
    for (const note of REFUSED_NOTES) refusedFor(await change(note), { column: 'note' });
    for (const note of NOTES) expect((await change(note)).statusCode, note).toBe(200);
    expect((await h.rows(`select note from ${h.real('orders')} where id = ${String(data.id)}`))[0]!['note']).toBe(NOTES.at(-1));
  });

  it.skipIf(!available)("a signed-in buyer's change of their own order is judged by the create's rule for the note", async () => {
    const email = `signed${String(dialect)}@fieldmail.io`;
    const made = await place({ values: { email, name: 'Mia' }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } });
    expect(made.statusCode, made.body).toBe(201);
    const session = await g.signIn(email);
    const id = (made.json() as { data: { id: number } }).data.id;
    const change = (values: Doc) => g.request('PATCH', `/records/${h.real('orders')}_verified/${String(id)}`, { session, payload: { values } });
    for (const note of REFUSED_NOTES) refusedFor(await change({ note }), { column: 'note' });
    for (const note of NOTES) expect((await change({ note })).statusCode, note).toBe(200);
    // The account's name, which the order's name is filled from, is judged as a name: no digit.
    const me = Number((await h.rows(`select id from ${h.real('customers')} where email = '${email}'`))[0]!['id']);
    const account = (name: string) => g.request('PATCH', `/records/${h.real('customers')}_claimed/${String(me)}`, { session, payload: { values: { name } } });
    refusedFor(await account('Mia 2'), { column: 'name' });
    expect((await account('米娅，老师')).statusCode).toBe(200);
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

/** Save the `notes` endpoint with this `plain_text`; the reply as it came. */
async function saveEndpoint(s: ServedSource, plainText: unknown[]) {
  const list = await s.app.inject({ method: 'GET', url: `/api/v1/public-endpoints?connectionId=${s.connectionId}`, headers: { cookie: s.cookie } });
  const source = (list.json() as { sources: { id: string }[] }).sources.find((x) => x.id.endsWith('notes'))?.id ?? '';
  return s.app.inject({
    method: 'PUT',
    url: `/api/v1/public-endpoints/${s.connectionId}/notes`,
    headers: { cookie: s.cookie },
    payload: {
      definition: JSON.stringify({
        path: '/notes',
        source,
        methods: ['POST', 'PATCH', 'BATCH'],
        select: ['id', 'body'],
        pagination: { default_limit: 20, max_limit: 200, order: 'id.desc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 10000, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
        writable: ['body'],
        anonymous: { per_key_hour: 1000, plain_text: plainText },
      }),
    },
  });
}

for (const leg of SOURCE_LEGS) {
  describe.skipIf(!leg.available)(`a hand-made endpoint's note, one row and a batch [${leg.dialect}]`, () => {
    it('takes the digits and length its plain text gives, and refuses a column asking for more than the most', async () => {
      served = await leg.serve(SPEC);
      const s = served;
      for (const asked of [{ column: 'body', digits: 5 }, { column: 'body', max: 201 }, { column: 'body', digits: 2, links: true }]) {
        expect((await saveEndpoint(s, [asked])).statusCode, JSON.stringify(asked)).toBe(422);
      }
      const save = await saveEndpoint(s, [{ column: 'body', digits: 4, max: 100 }]);
      expect(save.statusCode, save.body).toBe(200);
      const key = await s.app.inject({
        method: 'POST',
        url: '/api/v1/public-keys',
        headers: { cookie: s.cookie },
        payload: { name: 'Site', connectionId: s.connectionId, access: [{ ref: 'notes', methods: ['POST', 'PATCH', 'BATCH'] }] },
      });
      expect(key.statusCode, key.body).toBe(201);
      const headers = { authorization: `Bearer ${(key.json() as { token: string }).token}`, origin: PUBLIC_ORIGIN };
      const one = (body: string) => s.app.inject({ method: 'POST', url: '/api/v1/public/records/notes', headers, payload: { values: { body } } });
      const batch = (rows: Doc[]) => s.app.inject({ method: 'POST', url: '/api/v1/public/records/notes/batch', headers, payload: { rows } });
      for (const body of ['Call 0800 123', '12345', 'x'.repeat(101), 'evil。com', 'shop1.com']) {
        const res = await one(body);
        expect(res.statusCode, `${body}: ${res.body}`).toBe(400);
        expect((res.json() as { error: unknown }).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'body' } });
        const rows = await batch([{ body: 'Ana' }, { body }]);
        expect((rows.json() as { error: unknown }).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { index: 1, column: 'body' } });
      }
      expect(await s.query('SELECT id FROM notes')).toEqual([]);
      const taken = ['2 without onions!', '少放辣，切六块。', 'بدون بصل، من فضلك؟', 'x'.repeat(100)];
      for (const body of taken) expect((await one(body)).statusCode, body).toBe(201);
      expect((await batch(taken.map((body) => ({ body })))).statusCode).toBe(200);
      expect((await s.query('SELECT body FROM notes ORDER BY id')).map((r) => r['body'])).toEqual([...taken, ...taken]);
    }, 120_000);
  });
}
