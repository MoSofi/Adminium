// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A name a stranger types on a public create is judged by the rule a child
 * row's note is: no web address, handle or path — on every door that takes
 * one, on every engine. A name like "refund-desk.com Smith" would otherwise
 * be printed in the venue's own confirmation email, sent to any address.
 *
 *  - an order with its lines, a person found by address (the tree's door),
 *    and its dry run, signed in or not;
 *  - a single create with no lines;
 *  - a change through the row's own link or a signed-in person's rows,
 *    writing the create's own plain-text column (a buyer's name) or its
 *    `limits.plainText`;
 *  - a batch through a hand-made endpoint, its creates and its changes.
 *
 * Names with dots, initials, hyphens, apostrophes and brackets still pass,
 * and a child row's note is judged by the same rule.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PLAIN_TEXT_REFUSED } from '../src/public-api/anonymous-caps.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { guest, mailReady, shopManifest } from './person-fixture.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { PUBLIC_ORIGIN, SOURCE_LEGS, type ServedSource, type SourceSpec } from './public-source-dialects.js';

type Doc = Record<string, unknown>;

/** Web addresses, a handle, a link, and lookalike dots: every one refused. */
const LINKS = [
  'refund-desk.com Smith',
  'Smith www.x.io',
  'a@b.co',
  'https://x',
  'EVIL.COM',
  'пример.рф',
  'shop.co.uk',
  'evil．com',
  // Dressed up: a trailing hyphen, an invisible mark, a variation selector, fullwidth letters.
  'refund-desk.com- Smith',
  'refund-desk.co\u034Fm Smith',
  'refund-desk.com\uFE0F Smith',
  'refund-desk.ｃｏｍ Smith',
  // Endings a venue would be called by, and one in another script.
  'refund-desk.cafe Smith',
  'refund-desk.restaurant Smith',
  'refund-desk.中国',
  // One capital, then an ending an address is always read in.
  'X.Com',
  'J.Co',
];
/** Names: every one taken. "x dot com" names no place a link can go, and a child row's note takes it too. */
const NAMES = ["Anna-Marie O'Brien", 'Zoë (table)', 'x dot com', 'J.R.R. Tolkien', 'W.Hu', 'K.Y.Ng', 'A.Page', 'M.De Vries'];

/**
 * The shop, shaped as a box office's orders: the order's name and buyer's name
 * held to plain text on its create, its lines' dish too; the buyer's name
 * changed through the order's own link and by the signed-in buyer, with only
 * the note under `limits.plainText`; and a one-row enquiry.
 */
function shop(): Doc {
  const manifest = shopManifest({
    orders: { columns: [{ ref: 'buyer_name', type: 'text', maxLength: 80, nullable: true }] },
    entries: (entries) => [
      ...entries.map((entry) => {
        if (entry['table'] === 'orders' && entry['identity'] !== undefined) {
          const children = entry['children'] as { order_items: Doc };
          return {
            ...entry,
            writable: [...(entry['writable'] as string[]), 'buyer_name'],
            // As a box office fills the buyer's name from the account.
            identity: { ...(entry['identity'] as Doc), fill: { name: 'buyer_name' } },
            anonymous: { perValue: { columns: ['email'], n: 20 }, plainText: ['name', 'buyer_name'] },
            children: { order_items: { ...children.order_items, plainText: ['dish'] } },
          };
        }
        // The account's own details: its name, and a phone no create is filled from.
        if (entry['table'] === 'customers' && entry['claim'] !== undefined) return { ...entry, writable: ['name', 'phone'] };
        if (entry['table'] === 'orders' && entry['key'] === 'link') return { ...entry, writable: ['note', 'buyer_name'], limits: { plainText: ['note'] } };
        if (entry['table'] === 'orders' && entry['claimedBy'] !== undefined && (entry['methods'] as string[]).includes('GET')) {
          return { ...entry, methods: ['GET', 'PATCH'], writable: ['buyer_name'] };
        }
        return entry;
      }),
      {
        table: 'enquiries',
        methods: ['POST'],
        select: ['id'],
        writable: ['name', 'body'],
        level: 'verified',
        claimedBy: { table: 'customers', column: 'customer_id', optional: true },
        anonymous: { perKeyHour: 1000, plainText: ['name'] },
      },
    ],
  });
  (manifest['requiredSchema'] as { tables: Doc[] }).tables.push({
    ref: 'enquiries',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
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
    expect((res.json() as { error: unknown }).error).toEqual({ code: 'PUBLIC_WRITE_REFUSED', params, message: PLAIN_TEXT_REFUSED });
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

  it.skipIf(!available)("a line's note is judged by the same rule, named at the line", async () => {
    for (const dish of ['refund-desk.com', 'a@b.co', 'refund-desk.co\u034Fm', 'refund-desk.cafe']) {
      const res = await place(order('Lea', dish));
      expect(res.statusCode, `${dish}: ${res.body}`).toBe(400);
      expect((res.json() as { error: unknown }).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { child: 'order_items', index: 0, path: ['order_items', 0], column: 'dish' } });
    }
    for (const dish of NAMES) expect((await place(order('Lea', dish))).statusCode, dish).toBe(201);
  });

  it.skipIf(!available)('a single create with no lines: the same rule, the same refusal', async () => {
    const before = await count('enquiries');
    for (const name of LINKS) refusedFor(await g.request('POST', `/records/${h.real('enquiries')}_verified`, { payload: { values: { name, body: 'Hello' } } }), { column: 'name' });
    expect(await count('enquiries')).toBe(before);
    for (const name of NAMES) {
      const res = await g.request('POST', `/records/${h.real('enquiries')}_verified`, { payload: { values: { name, body: 'Hello' } } });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(201);
    }
  });

  const ownLink = async (made: { json: () => unknown }) => {
    const { data, link: own_ } = made.json() as { data: { id: number }; link: { token: string } };
    const opened = await own.request('POST', '/claim/token', { payload: { token: own_.token } });
    expect(opened.statusCode, opened.body).toBe(200);
    return { id: data.id, session: (opened.json() as { data: { session: string } }).data.session };
  };

  it.skipIf(!available)("a change through the row's own link: its limits, and the buyer's name its create holds to plain text", async () => {
    const made = await place(order('Mia'));
    expect(made.statusCode, made.body).toBe(201);
    const { id, session } = await ownLink(made);
    const change = (values: Doc, dry = false) => own.request('PATCH', `/records/${h.real('orders')}_claimed/${String(id)}${dry ? '/dry-run' : ''}`, { session, payload: { values } });
    for (const text of LINKS) {
      refusedFor(await change({ note: text }), { column: 'note' });
      refusedFor(await change({ buyer_name: text }), { column: 'buyer_name' });
    }
    const stored = async () => (await h.rows(`select buyer_name, note from ${h.real('orders')} where id = ${String(id)}`))[0]!;
    expect(await stored()).toMatchObject({ buyer_name: null, note: null });
    for (const text of NAMES) {
      expect((await change({ note: text })).statusCode, text).toBe(200);
      expect((await change({ buyer_name: text })).statusCode, text).toBe(200);
    }
    expect(await stored()).toMatchObject({ buyer_name: NAMES.at(-1), note: NAMES.at(-1) });
  });

  it.skipIf(!available)("a signed-in buyer: the create, a name the account fills in, the account's own name, and a change of their own order, all judged", async () => {
    const email = `signed${String(dialect)}@fieldmail.io`;
    const first = await place({ values: { email, name: 'Clean Name' }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } });
    expect(first.statusCode, first.body).toBe(201);
    const session = await g.signIn(email);
    const signed = (values: Doc) => g.request('POST', `/records/${h.real('orders')}_verified_2`, { session, proof: 'write', payload: { values: { email, ...values }, children: { order_items: [{ values: { dish: 'Soup', qty: 1 } }] } } });
    const [orders, messages] = [await count('orders'), await count('messages')];
    for (const name of LINKS) {
      refusedFor(await signed({ name }), { column: 'name' });
      refusedFor(await signed({ name: 'Mia', buyer_name: name }), { column: 'buyer_name' });
    }
    expect([await count('orders'), await count('messages')]).toEqual([orders, messages]);
    const mine = await signed({ name: 'Mia', buyer_name: 'K.Y.Ng' });
    expect(mine.statusCode, mine.body).toBe(201);
    // An account's name, printed on the order where the buyer left it empty, is judged as a typed one.
    await h.rows(`update ${h.real('customers')} set name = 'refund-desk.com Smith' where email = '${email}'`);
    refusedFor(await signed({ name: 'Mia', buyer_name: '' }), { column: 'buyer_name' });
    expect((await signed({ name: 'Mia', buyer_name: 'Mia' })).statusCode).toBe(201);
    // The account's own name, which the order's buyer's name is filled from, is judged where the person can fix it.
    const me = Number((await h.rows(`select id from ${h.real('customers')} where email = '${email}'`))[0]!['id']);
    const account = (values: Doc) => g.request('PATCH', `/records/${h.real('customers')}_claimed/${String(me)}`, { session, payload: { values } });
    for (const name of [...LINKS, 'Wong.Ng']) refusedFor(await account({ name }), { column: 'name' });
    for (const name of ['Ana López', ...NAMES]) expect((await account({ name })).statusCode, name).toBe(200);
    // A column no create is filled from is not held to plain text.
    expect((await account({ phone: '+44 7700 900123' })).statusCode).toBe(200);
    expect((await h.rows(`select name, phone from ${h.real('customers')} where id = ${String(me)}`))[0]).toMatchObject({ name: NAMES.at(-1), phone: '+44 7700 900123' });
    expect((await signed({ name: 'Mia', buyer_name: '' })).statusCode).toBe(201);
    // A single create, signed in: the same rule.
    const ask = (name: string) => g.request('POST', `/records/${h.real('enquiries')}_verified`, { session, payload: { values: { name, body: 'Hello' } } });
    for (const name of LINKS) refusedFor(await ask(name), { column: 'name' });
    expect((await ask('K.Y.Ng')).statusCode).toBe(201);
    // Their own order, changed through their account.
    const id = (mine.json() as { data: { id: number } }).data.id;
    const change = (buyer_name: string) => g.request('PATCH', `/records/${h.real('orders')}_verified/${String(id)}`, { session, payload: { values: { buyer_name } } });
    for (const name of LINKS) refusedFor(await change(name), { column: 'buyer_name' });
    for (const name of NAMES) expect((await change(name)).statusCode, name).toBe(200);
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

/** A hand-made endpoint anyone may write, its `body` held to plain text; a key with POST, PATCH and BATCH. */
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
        methods: ['POST', 'PATCH', 'BATCH'],
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
    payload: { name: 'Site', connectionId: s.connectionId, access: [{ ref: 'notes', methods: ['POST', 'PATCH', 'BATCH'] }] },
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
      // A change of a row, one at a time or in a batch, is judged the same way.
      const first = Number((await s.query('SELECT id FROM notes ORDER BY id'))[0]!['id']);
      for (const body of LINKS) {
        const res = await s.app.inject({ method: 'PATCH', url: `/api/v1/public/records/notes/${String(first)}`, headers, payload: { values: { body } } });
        expect(res.statusCode, `${body}: ${res.body}`).toBe(400);
        expect((res.json() as { error: unknown }).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'body' } });
        const rows = await batch([{ id: first, body }]);
        expect(rows.statusCode, `${body}: ${rows.body}`).toBe(400);
        expect((rows.json() as { error: unknown }).error).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { index: 0, column: 'body' } });
      }
      expect((await s.query(`SELECT body FROM notes WHERE id = ${String(first)}`))[0]!['body']).toBe(NAMES[0]);
      expect((await batch([{ id: first, body: 'Mary.Ann' }])).statusCode).toBe(200);
    }, 120_000);
  });
}
