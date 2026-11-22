// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE REVIEW LINK ONLY A REVIEW MAIL CARRIES (cQ23's re-ruling), on SQLite,
 * Postgres and MySQL.
 *
 * A guest's own booking link cannot review a row whose word names `proved`.
 * The mail's link can, because only the mailbox on the person's row received
 * it. It reviews that one row, once, opens no session, and dies with the
 * address it was sent to.
 */
import { publicKeysRepo, settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { mailLinkKeys } from '../src/email/link-keys.js';
import { reviewLinkFor, REVIEW_LINK_SKIPS } from '../src/outbox/review-link.js';
import { addressDigest, makeReviewToken, readReviewToken, REVIEW_LINK_TTL_MS } from '../src/reviews/link.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import { TEST_SECRET } from './helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { REVIEWS_KIT, REVIEWS_TABLE, reviewedShopManifest, reviewsKitManifest } from './fixtures/reviews-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.71' }));
void keepAddOnInstalls;

const INSTALL = 'install-reviews';

describe('a review link\'s token', () => {
  const claim = { install: INSTALL, app: 'shop', connection: 'c1', table: 't', row: '5', column: 'email', address: addressDigest(' Priya@Example.com '), expires: 2_000 };
  it('reads back on its install until it runs out, and says nothing in clear', () => {
    const token = makeReviewToken('key-one', claim);
    expect(readReviewToken(['key-one'], INSTALL, token, 1_999)).toEqual(claim);
    expect(readReviewToken(['key-one'], INSTALL, token, 2_000)).toBeNull();
    expect(readReviewToken(['key-one'], 'another-install', token, 1_000)).toBeNull();
    expect(readReviewToken(['key-two'], INSTALL, token, 1_000)).toBeNull();
    expect(Buffer.from(token, 'base64url').toString('latin1')).not.toContain('shop');
  });
  it('cannot be changed by a byte', () => {
    const token = makeReviewToken('key-one', claim);
    const flipped = `${token.slice(0, 20)}${token[20] === 'A' ? 'B' : 'A'}${token.slice(21)}`;
    expect(readReviewToken(['key-one'], INSTALL, flipped, 1_000)).toBeNull();
  });
  it('compares addresses as sign-in does', () => {
    expect(addressDigest(' Priya@Example.com ')).toBe(addressDigest('priya@example.com'));
    expect(addressDigest('priya@example.com')).not.toBe(addressDigest('priya2@example.com'));
  });
});

describe.each(LEGS)('a review through a mail\'s link — %s', (dialect, available) => {
  let h: Harness;
  let link: Served;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.7.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const yes = dialect === 'postgres' ? 'true' : '1';
  const no = dialect === 'postgres' ? 'false' : '0';
  const LINES = 'shop_order_lines_verified_2';
  const GUEST_TOKEN = 'PPPPQQQQRRRRSSSS';
  let guestSession = '';
  let linesId = '';

  const read = (token: string) => link.composed.app.inject({ method: 'POST', url: '/api/v1/public/review-link', remoteAddress: fresh(), headers: link.headers(), payload: { token } });
  const take = (token: string, payload: Record<string, unknown> = { stars: 5, title: 'Lovely', body: 'Really good.' }) =>
    link.composed.app.inject({ method: 'POST', url: '/api/v1/public/review-link/take', remoteAddress: fresh(), headers: link.headers(), payload: { token, ...payload } });
  const codeOf = (res: { json: () => unknown }) => (res.json() as { error?: { code: string } }).error?.code;
  const tokenFor = async (row: number, address: string, over: Partial<Parameters<typeof makeReviewToken>[1]> = {}) =>
    makeReviewToken(await mailLinkKeys(h.meta, TEST_SECRET).review(), { install: INSTALL, app: 'shop', connection: h.connectionId, table: linesId, row: String(row), column: 'email', address: addressDigest(address), expires: Date.now() + REVIEW_LINK_TTL_MS, ...over });

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await settingsRepo(h.meta).set('system.instanceId', INSTALL as never);
    await h.stageAddOn(reviewsKitManifest());
    const manifest = reviewedShopManifest('shop');
    // A table that names the reviewed line, as an outbox's message does.
    (manifest['requiredSchema'] as { tables: Record<string, unknown>[] }).tables.push({ ref: 'notes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'line_id', type: 'fk', references: 'order_lines', nullable: true }] });
    await h.stageApp(manifest);
    const installed = await h.install('shop', '1.0.0', { addOns: [{ key: REVIEWS_KIT, version: '1.0.0' }], publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    await h.rows(`INSERT INTO shop_customers (id, first_name, last_name, email) VALUES (1, 'Priya', 'Rao', 'priya@example.com'), (2, 'Ben', 'Cole', 'ben@example.com')`);
    await h.rows(`INSERT INTO shop_products (id, name) VALUES (1, 'Ridge Shell')`);
    // A guest's orders in Priya's address: never signed in, so not proved.
    await h.rows(`INSERT INTO shop_orders (id, customer_id, status, link_token, customer_proved) VALUES (1, 1, 'shipped', '${GUEST_TOKEN}', ${no}), (2, 2, 'shipped', NULL, ${yes}), (3, 1, 'new', NULL, ${no})`);
    await h.rows(`INSERT INTO shop_order_lines (id, order_id, product_id, product_name) VALUES (1, 1, 1, 'Ridge Shell'), (2, 2, 1, 'Ridge Shell'), (3, 3, 1, 'Ridge Shell'), (4, 1, 1, 'Ridge Shell'), (5, 1, 1, 'Ridge Shell'), (6, 1, 1, 'Ridge Shell')`);
    const linkKey = (await publicKeysRepo(h.meta).listManagedBy('shop')).find((key) => key.purpose === 'link' && key.revokedAt === null)!;
    link = await servePublic(h as never, linkKey.id);
    const claimed = await link.post('/claim/token', { token: GUEST_TOKEN });
    expect(claimed.statusCode, claimed.body).toBe(200);
    guestSession = (claimed.json() as { data: { session: string } }).data.session;
    const view = await loadSnapshotView(h.meta, h.connectionId);
    linesId = view.model.tables.find((table) => table.name === 'shop_order_lines')!.id;
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await link?.close();
    await h?.close();
  });

  it.skipIf(!available)('a guest\'s own booking link still cannot review, while the mail\'s link can', async () => {
    const own = await link.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${LINES}/1/review`, remoteAddress: fresh(), headers: link.headers(guestSession), payload: { stars: 1 } });
    expect(own.statusCode).toBe(409);
    expect(codeOf(own)).toBe('PUBLIC_REVIEW_NOT_YET');

    const token = await tokenFor(1, 'priya@example.com');
    const state = await read(token);
    expect(state.statusCode, state.body).toBe(200);
    expect(state.json()).toEqual({ data: { open: true, reviewedAt: null, shownName: 'Priya R.', about: 'Ridge Shell', detail: null } });
    const taken = await take(token);
    expect(taken.statusCode, taken.body).toBe(201);
    const row = (await h.rows(`SELECT stars, state, shown_name, person_key, subject_key FROM ${REVIEWS_TABLE} WHERE subject_key = '1'`))[0]!;
    expect([Number(row['stars']), row['state'], row['shown_name'], String(row['person_key'])]).toEqual([5, 'waiting', 'Priya R.', '1']);
    expect((await h.rows(`SELECT reviewed_at FROM shop_order_lines WHERE id = 1`))[0]!['reviewed_at']).not.toBeNull();
  });

  it.skipIf(!available)('reviews once: the link then says it was done, and takes no second', async () => {
    const token = await tokenFor(1, 'priya@example.com');
    const state = (await read(token)).json() as { data: { open: boolean; reviewedAt: string | null } };
    expect(state.data.open).toBe(false);
    expect(state.data.reviewedAt).toEqual(expect.any(String));
    const again = await take(token);
    expect(again.statusCode).toBe(409);
    expect(codeOf(again)).toBe('PUBLIC_REVIEW_DONE');
  });

  it.skipIf(!available)('a visit not yet reviewable is told so; the words are still held to the plain-text rule', async () => {
    const token = await tokenFor(3, 'priya@example.com');
    expect(((await read(token)).json() as { data: { open: boolean } }).data.open).toBe(false);
    const early = await take(token);
    expect(early.statusCode).toBe(409);
    expect(codeOf(early)).toBe('PUBLIC_REVIEW_NOT_YET');
    const linked = await take(await tokenFor(4, 'priya@example.com'), { stars: 4, body: 'see evil.com' });
    expect(linked.statusCode).toBe(400);
  });

  it.skipIf(!available)('one 404 for a made-up link, another app\'s, one out of time, and one for an address that is no longer theirs', async () => {
    for (const token of [
      'A'.repeat(120),
      await tokenFor(5, 'priya@example.com', { app: 'studio' }),
      await tokenFor(5, 'priya@example.com', { connection: 'conn_other' }),
      await tokenFor(5, 'priya@example.com', { expires: Date.now() - 1 }),
      await tokenFor(5, 'someone-else@example.com'),
      await tokenFor(999, 'priya@example.com'),
    ]) {
      const res = await read(token);
      expect(res.statusCode).toBe(404);
      expect(codeOf(res)).toBe('PUBLIC_REF_NOT_FOUND');
      expect((await take(token)).statusCode).toBe(404);
    }
    expect((await h.rows(`SELECT id FROM ${REVIEWS_TABLE} WHERE subject_key = '5'`)).length).toBe(0);
  });

  it.skipIf(!available)('dies when the person\'s address changes, and when they asked to be forgotten', async () => {
    const token = await tokenFor(5, 'ben@example.com', { row: '2' });
    expect((await read(token)).statusCode).toBe(200);
    await h.rows(`UPDATE shop_customers SET email = 'ben.new@example.com' WHERE id = 2`);
    expect((await read(token)).statusCode).toBe(404);
    await h.rows(`UPDATE shop_customers SET email = 'ben@example.com', forgotten_at = '2026-01-01 00:00:00' WHERE id = 2`);
    expect((await read(token)).statusCode).toBe(404);
    expect((await take(token)).statusCode).toBe(404);
    await h.rows(`UPDATE shop_customers SET forgotten_at = NULL WHERE id = 2`);
  });

  it.skipIf(!available)('opens no session and is no sign-in', async () => {
    const token = await tokenFor(6, 'priya@example.com');
    const asSession = await link.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${LINES}/6`, remoteAddress: fresh(), headers: link.headers(token) });
    expect(asSession.statusCode).toBeGreaterThanOrEqual(400);
    const verify = await link.post('/claim/link/verify', { token });
    expect(verify.statusCode).toBeGreaterThanOrEqual(400);
  });

  describe('as the sender makes it', () => {
    const made = async (to: string, line: unknown, stamped = false) => {
      const view = await loadSnapshotView(h.meta, h.connectionId);
      const notes = view.model.tables.find((table) => table.name === 'shop_notes')!.id;
      const customers = view.model.tables.find((table) => table.name === 'shop_customers')!.id;
      const { db } = await h.manager.data(h.connectionId);
      if (stamped) await h.rows(`UPDATE shop_order_lines SET reviewed_at = '2026-01-01 00:00:00' WHERE id = ${String(line)}`);
      return reviewLinkFor(
        { meta: h.meta, secret: TEST_SECRET, db, view, now: Date.now(), base: 'https://book.shop.example/' },
        { appKey: 'shop', connectionId: h.connectionId, block: { kinds: ['ask'], link: 'line', page: '/review' }, definition: { table: notes, links: { line: 'line_id' }, recipient: { via: 'customer_id', table: customers, email: 'email' } } as never, message: { line_id: line }, to },
      );
    };

    it.skipIf(!available)('goes in the fragment, for the address on the person\'s own row', async () => {
      const got = await made('Priya@Example.com', 6);
      if (!('link' in got)) throw new Error(got.skip);
      expect(got.link).toMatch(/^https:\/\/book\.shop\.example\/review#[A-Za-z0-9_-]+$/);
      const res = await read(got.link.split('#')[1]!);
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { data: { open: boolean } }).data.open).toBe(true);
    });

    it.skipIf(!available)('is not made for any other address, for no row, or for a row reviewed already', async () => {
      expect(await made('stranger@example.com', 6)).toEqual({ skip: REVIEW_LINK_SKIPS.otherAddress });
      expect(await made('priya@example.com', null)).toEqual({ skip: REVIEW_LINK_SKIPS.noRow });
      expect(await made('priya@example.com', 12345)).toEqual({ skip: REVIEW_LINK_SKIPS.noRow });
      expect(await made('priya@example.com', 5, true)).toEqual({ skip: REVIEW_LINK_SKIPS.reviewed });
    });
  });
});
