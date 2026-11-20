// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CUSTOMER'S REVIEW OF A SHIPPED ORDER LINE, on SQLite, Postgres and MySQL.
 *
 * A shop's line may be reviewed once its order is shipped, by the customer
 * the order's own link (or their sign-in) reaches; the review is kept by an
 * add-on, written by Adminium with everything but the stars and the words
 * filled from the server, and moderated by the shop's own staff.
 *
 *  - another customer's line, a line not shipped, and a second review of one
 *    line are refused; the line is stamped; the name shown is the
 *    customer's own, cut to "Priya R.";
 *  - a waiting or hidden review is in no total and in no public read; a
 *    published one is, on the product's row and the app's;
 *  - staff — the Super Admin too — change a review's state, hide reason and
 *    reply only, one at a time, never create or delete one; a review is
 *    hidden only with a reason; a reply is stamped;
 *  - the shop's role reads and moderates the shop's reviews, never another
 *    app's;
 *  - a forgotten person's reviews keep their stars and words, and lose their
 *    name and whose they are.
 */
import { publicKeysRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { readLimitedFrames } from '../src/realtime/read-frames.js';
import { blankReviews, findPersonReviews, forgetReviews } from '../src/reviews/erase.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import { shownNameOf, shownNameOfFull } from '../src/reviews/tables.js';
import { reviewText } from '../src/public-api/plain-text.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { REVIEWS_KIT, REVIEWS_TABLE, reviewedShopManifest, reviewsKitManifest, TOTALS_TABLE } from './fixtures/reviews-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.67' }));

describe('the name a review shows, and the words it takes', () => {
  it('first name and the last name\'s initial; empty when there is none', () => {
    expect(shownNameOf('Priya', 'Rao')).toBe('Priya R.');
    expect(shownNameOf(' Priya ', '')).toBe('Priya');
    expect(shownNameOf('', 'Rao')).toBe('');
    expect(shownNameOf(null, null)).toBe('');
    expect(shownNameOf('Émile', 'Ödegaard')).toBe('Émile Ö.');
    expect(shownNameOfFull('Ava Maria Ruiz')).toBe('Ava R.');
  });
  it('plain words with digits, sizes and line breaks; never an address', () => {
    expect(reviewText('10/10. Size 9.5 fits, 50% lighter.\nWarm.It is great', 2000)).toBe('10/10. Size 9.5 fits, 50% lighter.\nWarm.It is great');
    for (const bad of ['see evil.com', 'www.x', 'mail me@example.com', 'https://a', 'x\u0007y', '@handle']) expect(reviewText(bad, 2000), bad).toBeNull();
    expect(reviewText('a'.repeat(81), 80)).toBeNull();
  });
});

describe.each(LEGS)("a customer's review of a shipped order line — %s", (dialect, available) => {
  let h: Harness;
  let link: Served;
  let staff: Served;
  let owner: string;
  let shopOwner: string;
  let reviewsTable: string;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.9.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const yes = dialect === 'postgres' ? 'true' : '1';
  void yes;
  /** The lines as the order's own link reads them: the second entry on the table, so its ref carries `_2`. */
  const LINES = 'shop_order_lines_verified_2';
  const tokens = { mine: 'AAAABBBBCCCCDDDD', theirs: 'EEEEFFFFGGGGHHHH', unshipped: 'JJJJKKKKMMMMNNNN' };
  const sessions: Record<keyof typeof tokens, string> = { mine: '', theirs: '', unshipped: '' };

  const review = (line: number, session: string, payload: Record<string, unknown> = { stars: 4, title: 'Warm', body: 'Kept me dry for 3 days.' }) =>
    link.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${LINES}/${String(line)}/review`, remoteAddress: fresh(), headers: link.headers(session), payload });
  const reviewState = (line: number, session: string) => link.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${LINES}/${String(line)}/review`, remoteAddress: fresh(), headers: link.headers(session) });
  const codeOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error?.code;
  const totals = async () => (await h.rows(`SELECT app, about_table, about_key, count, sum, c1, c2, c3, c4, c5 FROM ${TOTALS_TABLE} ORDER BY about_key`)).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) && k !== 'about_key' ? Number(v) : typeof v === 'bigint' ? Number(v) : v])));
  const reviewRow = async (line: number) => (await h.rows(`SELECT * FROM ${REVIEWS_TABLE} WHERE app = 'shop' AND subject_key = '${String(line)}'`))[0];
  const patch = (cookie: string, id: unknown, values: Record<string, unknown>) => staff.composed.app.inject({ method: 'PATCH', url: `/api/v1/data/${h.connectionId}/${reviewsTable}/${String(id)}`, remoteAddress: fresh(), headers: { cookie }, payload: { values } });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(reviewsKitManifest());
    await h.stageApp(reviewedShopManifest('shop'));
    const installed = await h.install('shop', '1.0.0', { addOns: [{ key: REVIEWS_KIT, version: '1.0.0' }], publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    const customerKey = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    await h.stageApp(reviewedShopManifest('studio'));
    const studio = await h.install('studio', '1.0.0', { addOns: [{ key: REVIEWS_KIT, version: '1.0.0' }], publicAccess: true });
    expect(studio.statusCode, studio.body).toBe(200);

    await h.rows(`INSERT INTO shop_customers (id, first_name, last_name, email) VALUES (1, 'Priya', 'Rao', 'priya@example.com'), (2, 'Ben', 'Cole', 'ben@example.com')`);
    await h.rows(`INSERT INTO shop_products (id, name) VALUES (1, 'Ridge Shell'), (2, 'Trail Fleece')`);
    await h.rows(`INSERT INTO shop_orders (id, customer_id, status, link_token) VALUES (1, 1, 'shipped', '${tokens.mine}'), (2, 2, 'shipped', '${tokens.theirs}'), (3, 1, 'new', '${tokens.unshipped}')`);
    await h.rows(`INSERT INTO shop_order_lines (id, order_id, product_id, product_name) VALUES (1, 1, 1, 'Ridge Shell'), (2, 2, 1, 'Ridge Shell'), (3, 3, 2, 'Trail Fleece'), (4, 1, 2, 'Trail Fleece')`);

    const linkKey = (await publicKeysRepo(h.meta).listManagedBy('shop')).find((key) => key.purpose === 'link' && key.revokedAt === null);
    expect(linkKey, "the shop's link key").toBeDefined();
    link = await servePublic(h as never, linkKey!.id);
    staff = await servePublic(h as never, customerKey, { ADMINIUM_DATA_DIR: h.dataDir });
    for (const name of Object.keys(tokens) as (keyof typeof tokens)[]) {
      const claimed = await link.post('/claim/token', { token: tokens[name] });
      expect(claimed.statusCode, claimed.body).toBe(200);
      sessions[name] = (claimed.json() as { data: { session: string } }).data.session;
    }
    // The Super Admin, and someone who holds the shop's own role only.
    const hash = await adminPasswordHash();
    const pia = await usersRepo(h.meta).create({ email: 'pia@shop.dev', name: 'Pia', passwordHash: hash });
    await rolesRepo(h.meta).assignToUser(pia.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    const sam = await usersRepo(h.meta).create({ email: 'sam@shop.dev', name: 'Sam', passwordHash: hash });
    await rolesRepo(h.meta).assignToUser(sam.id, (await rolesRepo(h.meta).findBySlug('shop-owner'))!.id);
    const login = async (email: string) => sessionCookie((await staff.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: fresh(), payload: { email, password: ADMIN_PASSWORD } })).headers['set-cookie']);
    owner = await login('pia@shop.dev');
    shopOwner = await login('sam@shop.dev');
    const view = await loadSnapshotView(h.meta, h.connectionId);
    reviewsTable = view.model.tables.find((table) => table.name === REVIEWS_TABLE)!.id;
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await link?.close();
    await staff?.close();
    await h?.close();
  });

  it.skipIf(!available)('says whether a line may be reviewed, and the name it will show', async () => {
    const state = await reviewState(1, sessions.mine);
    expect(state.statusCode, state.body).toBe(200);
    expect(state.json()).toEqual({ data: { open: true, reviewedAt: null, shownName: 'Priya R.' } });
    expect((await reviewState(3, sessions.unshipped)).json()).toMatchObject({ data: { open: false, reviewedAt: null } });
  });

  it.skipIf(!available)("refuses another customer's line, a line not shipped, and words with an address", async () => {
    // Line 2 is Ben's: not a row this session reads, the one 404.
    const theirs = await review(2, sessions.mine);
    expect(theirs.statusCode, theirs.body).toBe(404);
    expect(codeOf(theirs)).toBe('PUBLIC_REF_NOT_FOUND');
    // Line 3's order is not shipped.
    const early = await review(3, sessions.unshipped);
    expect(early.statusCode, early.body).toBe(409);
    expect(codeOf(early)).toBe('PUBLIC_REVIEW_NOT_YET');
    const linked = await review(4, sessions.mine, { stars: 5, body: 'Buy it at evil.com' });
    expect(linked.statusCode, linked.body).toBe(400);
    for (const stars of [0, 6, 4.5]) expect((await review(4, sessions.mine, { stars })).statusCode, String(stars)).toBe(400);
    // Nothing the browser names but the stars and the words.
    expect((await review(4, sessions.mine, { stars: 5, shown_name: 'Northline Support' })).statusCode).toBe(400);
    expect(await h.rows(`SELECT id FROM ${REVIEWS_TABLE}`)).toEqual([]);
  });

  it.skipIf(!available)('takes one review a line, filled by the server, and stamps the line', async () => {
    const taken = await review(1, sessions.mine);
    expect(taken.statusCode, taken.body).toBe(201);
    const row = (await reviewRow(1))!;
    expect(row).toMatchObject({ app: 'shop', subject_table: 'order_lines', subject_key: '1', about_table: 'products', about_key: '1', about_name: 'Ridge Shell', title: 'Warm', body: 'Kept me dry for 3 days.', shown_name: 'Priya R.', state: 'waiting', person_table: 'customers', person_key: '1' });
    expect(Number(row['stars'])).toBe(4);
    const stamped = await h.rows(`SELECT reviewed_at FROM shop_order_lines WHERE id = 1`);
    expect(stamped[0]!['reviewed_at']).not.toBeNull();
    // A second one for the line: done.
    const again = await review(1, sessions.mine, { stars: 1 });
    expect(again.statusCode, again.body).toBe(409);
    expect(codeOf(again)).toBe('PUBLIC_REVIEW_DONE');
    expect((await reviewState(1, sessions.mine)).json()).toMatchObject({ data: { open: false, reviewedAt: expect.any(String) } });
  });

  it.skipIf(!available)('two sends at once take one review', async () => {
    const [a, b] = await Promise.all([review(4, sessions.mine, { stars: 3 }), review(4, sessions.mine, { stars: 2 })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(await h.rows(`SELECT id FROM ${REVIEWS_TABLE} WHERE subject_key = '4'`)).toHaveLength(1);
  });

  it.skipIf(!available)('a waiting or hidden review is in no total and no public read; a published one is', async () => {
    expect(await totals()).toEqual([]);
    const reads = async () => (await staff.get(`/records/${REVIEWS_TABLE}`)).json() as { data: unknown[] };
    expect((await reads()).data).toEqual([]);
    const id = (await reviewRow(1))!['id'];
    expect((await patch(owner, id, { state: 'published' })).statusCode).toBe(200);
    expect(await totals()).toEqual([
      { app: 'shop', about_table: '', about_key: '', count: 1, sum: 4, c1: 0, c2: 0, c3: 0, c4: 1, c5: 0 },
      { app: 'shop', about_table: 'products', about_key: '1', count: 1, sum: 4, c1: 0, c2: 0, c3: 0, c4: 1, c5: 0 },
    ]);
    expect((await reads()).data).toHaveLength(1);
    // Hidden only with a reason, and then out of every total and read.
    const bare = await patch(owner, id, { state: 'hidden' });
    expect(bare.statusCode, bare.body).toBe(422);
    expect((await patch(owner, id, { state: 'hidden', hide_reason: 'abusive' })).statusCode).toBe(200);
    expect((await totals()).map((row) => row['count'])).toEqual([0, 0]);
    expect((await reads()).data).toEqual([]);
    // Back to published (hidden → published).
    expect((await patch(owner, id, { state: 'published' })).statusCode).toBe(200);
    expect((await totals()).map((row) => row['count'])).toEqual([1, 1]);
  });

  it.skipIf(!available)('staff, the Super Admin too, change only the state, the hide reason and the reply', async () => {
    const id = (await reviewRow(1))!['id'];
    for (const values of [{ stars: 5 }, { shown_name: 'Someone' }, { app: 'studio' }, { about_key: '2' }, { person_key: '2' }]) {
      const res = await patch(owner, id, values);
      expect(res.statusCode, `${JSON.stringify(values)}: ${res.body}`).toBe(403);
    }
    const replied = await patch(owner, id, { reply: 'Thank you, Priya.' });
    expect(replied.statusCode, replied.body).toBe(200);
    expect((await reviewRow(1))!['replied_at']).not.toBeNull();
    // Never made, never removed by a person.
    const made = await staff.composed.app.inject({ method: 'POST', url: `/api/v1/data/${h.connectionId}/${reviewsTable}`, remoteAddress: fresh(), headers: { cookie: owner }, payload: { values: { app: 'shop', stars: 5 } } });
    expect(made.statusCode, made.body).toBe(403);
    const gone = await staff.composed.app.inject({ method: 'DELETE', url: `/api/v1/data/${h.connectionId}/${reviewsTable}/${String(id)}`, remoteAddress: fresh(), headers: { cookie: owner } });
    expect(gone.statusCode, gone.body).toBe(403);
    expect(await reviewRow(1)).toBeDefined();
  });

  it.skipIf(!available)("the shop's role reads and moderates the shop's reviews, never another app's", async () => {
    await h.rows(`INSERT INTO ${REVIEWS_TABLE} (app, subject_table, subject_key, about_table, about_key, about_name, stars, shown_name, state, submitted_at) VALUES ('studio', 'order_lines', '1', 'products', '1', 'Clay', 2, 'Ava R.', 'waiting', ${dialect === 'mysql' ? "'2026-11-20 10:00:00'" : "'2026-11-20T10:00:00Z'"})`);
    const listed = await staff.composed.app.inject({ method: 'GET', url: `/api/v1/data/${h.connectionId}/${reviewsTable}`, remoteAddress: fresh(), headers: { cookie: shopOwner } });
    expect(listed.statusCode, listed.body).toBe(200);
    const apps = (listed.json() as { data: { app: string }[] }).data.map((row) => row.app);
    expect(apps.length).toBeGreaterThan(0);
    expect(new Set(apps)).toEqual(new Set(['shop']));
    const studioId = (await h.rows(`SELECT id FROM ${REVIEWS_TABLE} WHERE app = 'studio'`))[0]!['id'];
    const moved = await patch(shopOwner, studioId, { state: 'published' });
    expect([403, 404]).toContain(moved.statusCode);
    expect((await h.rows(`SELECT state FROM ${REVIEWS_TABLE} WHERE app = 'studio'`))[0]!['state']).toBe('waiting');
    // Its own: moved.
    const mine = (await reviewRow(4))!['id'];
    expect((await patch(shopOwner, mine, { state: 'published' })).statusCode).toBe(200);
    // Live updates: a change of another app's review tells the shop's role nothing; one of the shop's own does.
    const sam = (await usersRepo(h.meta).findByEmail('sam@shop.dev'))!;
    const channel = `widget-data:${h.connectionId}:${reviewsTable}`;
    const frame = (row: Record<string, unknown>) =>
      new RealtimeHub().publish(channel, 'record.update', { type: 'record.update', pk: { id: row['id'] }, row }, 0, { private: false, columns: [], before: null, after: row });
    const filter = await readLimitedFrames(h.meta)({ id: sam.id }, channel);
    expect(filter).not.toBeNull();
    expect(await filter!(frame({ id: studioId, app: 'studio', state: 'published' }))).toBeNull();
    expect(await filter!(frame({ id: mine, app: 'shop', state: 'published' }))).not.toBeNull();
  });

  it.skipIf(!available)("a forgotten person's reviews keep their stars and words, and lose their name", async () => {
    const view = await loadSnapshotView(h.meta, h.connectionId);
    const { db } = await h.manager.data(h.connectionId);
    const installs = await keepAddOnInstalls(h.meta, async () => view.model as never).fresh();
    const customers = view.table(view.model.tables.find((table) => table.name === 'shop_customers')!.id);
    const before = await totals();
    // "Delete my details" on the shop: the shop's reviews of Priya.
    expect(await forgetReviews({ meta: h.meta, installs, view, db: db as never }, { table: customers, key: '1', app: 'shop' })).toBe(2);
    const row = (await reviewRow(1))!;
    expect(row).toMatchObject({ shown_name: '', person_table: null, person_key: null, body: 'Kept me dry for 3 days.' });
    expect(Number(row['stars'])).toBe(4);
    expect(await totals()).toEqual(before);
    // Staff erasure finds a person's reviews by any name their table is known by, and blanks them.
    await h.rows(`UPDATE ${REVIEWS_TABLE} SET person_table = 'shop_customers', person_key = '2', shown_name = 'Ben C.' WHERE app = 'studio'`);
    const ben = await findPersonReviews({ meta: h.meta, installs, view, db: db as never }, [{ table: customers, key: '2' }], null);
    expect(ben.flatMap((one) => one.keys)).toHaveLength(1);
    for (const one of ben) await blankReviews(db as never, one);
    expect((await h.rows(`SELECT shown_name, person_key FROM ${REVIEWS_TABLE} WHERE app = 'studio'`))[0]).toEqual({ shown_name: '', person_key: null });
  });
});
