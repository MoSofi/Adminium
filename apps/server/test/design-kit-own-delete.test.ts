// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHOPPER DELETES THEIR OWN DRAFT THROUGH ITS OWN LINK.
 *
 * The design kit's own link reads a saved design and changes it while it is a
 * draft; it also removes it on the same terms (`DELETE`), with no reason
 * asked: the design goes, its photo goes to the bin as a staff delete sends
 * it, and the mail that carried its link lets go of it (`outbox/release.ts`).
 * The link never removes an ordered design, never another shopper's, and
 * nothing at all without its session; a shop's own key removes no design.
 * On every engine this run can reach, through the whole server.
 */
import { filesRepo, publicKeysRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { solveProof } from '../src/public-api/proof.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { DESIGN_KIT, DESIGN_LINK_KEY, DESIGN_MAILS, DESIGN_OWN_REF, DESIGNS_REF, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

describe.each(LEGS)('a shopper deletes their own draft through its link — %s', (dialect, available) => {
  let h: Harness;
  let served: Served;
  let door: Served;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.7.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  /** A design saved through the print shop's key, behind the human check: its id and the session its own link opened. */
  const save = async (email = 'marta@example.com') => {
    const address = fresh();
    const challenge = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers: served.headers() });
    const c = (challenge.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    const headers = served.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
    const res = await served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${DESIGNS_REF}`, remoteAddress: address, headers, payload: { values: { base_id: 1, name_text: 'Draft', values: { line1: 'Mum & Dad 1985' }, email } } });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as { data: { id: unknown }; link?: { session?: string } };
    expect(body.link?.session).toEqual(expect.any(String));
    return { id: Number(body.data.id), session: body.link!.session! };
  };
  /** A removal through the kit's link key, with the session its link opened (or none). */
  const remove = (id: number, session?: string) =>
    door.composed.app.inject({ method: 'DELETE', url: `/api/v1/public/records/${DESIGN_OWN_REF}/${String(id)}`, remoteAddress: fresh(), headers: door.headers(session) });
  const exists = async (id: number) => (await h.rows(`SELECT id FROM design_kit_designs WHERE id = ${String(id)}`)).length === 1;
  /** A photo on the design: a file of the kit's own file column. */
  const photo = async (id: number) => {
    const file = await filesRepo(h.meta).create({ filename: 'photo.png', mime: 'image/png', sizeBytes: 10, sha256: 'x', kind: 'upload' });
    await h.rows(`UPDATE design_kit_designs SET photo = '${file.id}' WHERE id = ${String(id)}`);
    return file.id;
  };
  const binned = async (fileId: string) => (await filesRepo(h.meta).findById(fileId))?.deletedAt != null;

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(designKitManifest({}, { link: true, mail: true, remove: true }));
    await h.stageApp(designShopManifest('printing'));
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }], publicAccess: true });
    expect(installed.statusCode, installed.body).toBe(200);
    const key = (installed.json() as { publicAccess: { keyId: string } }).publicAccess.keyId;
    await h.rows(`INSERT INTO design_kit_bases (id, name, app) VALUES (1, 'Mug', 'printing')`);
    const link = (await publicKeysRepo(h.meta).listManagedBy(DESIGN_KIT)).find((one) => one.purpose === DESIGN_LINK_KEY && one.revokedAt === null);
    expect(link, 'the kit has a link key of its own').toBeDefined();
    served = await servePublic(h as never, key, { ADMINIUM_DATA_DIR: h.dataDir });
    door = await servePublic(h as never, link!.id);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await door?.close();
    await served?.close();
    await h?.close();
  });

  it.skipIf(!available)('deletes the draft through its link: the design goes, its photo to the bin, its mail lets go of it', async () => {
    const saved = await save();
    const file = await photo(saved.id);
    // The mail that carries the design's link, as the producer queued it, is on the log before the removal.
    const before = await h.rows(`SELECT id FROM ${DESIGN_MAILS} WHERE design_id = ${String(saved.id)}`);
    expect(before).toHaveLength(1);
    const res = await remove(saved.id, saved.session);
    expect(res.statusCode, res.body).toBe(200);
    expect(await exists(saved.id)).toBe(false);
    expect(await binned(file)).toBe(true);
    const [mail] = await h.rows(`SELECT design_id, status FROM ${DESIGN_MAILS} WHERE id = ${String(before[0]!['id'])}`);
    expect(mail!['design_id'] ?? null).toBeNull();
    expect(mail!['status']).not.toBe('queued');
  });

  it.skipIf(!available)('an ordered design is never removed by its shopper, nor its photo binned', async () => {
    const saved = await save();
    const file = await photo(saved.id);
    await h.rows(`UPDATE design_kit_designs SET state = 'ordered' WHERE id = ${String(saved.id)}`);
    expect((await remove(saved.id, saved.session)).statusCode).toBe(404);
    expect(await exists(saved.id)).toBe(true);
    expect(await binned(file)).toBe(false);
  });

  it.skipIf(!available)("another shopper's design is never removed through this link", async () => {
    const mine = await save();
    const theirs = await save('ben@example.com');
    expect((await remove(theirs.id, mine.session)).statusCode).toBe(404);
    expect(await exists(theirs.id)).toBe(true);
    // Without a session the link key removes nothing at all.
    expect((await remove(theirs.id)).statusCode).toBe(404);
    expect(await exists(theirs.id)).toBe(true);
  });

  it.skipIf(!available)("the shop's own key removes no design", async () => {
    const saved = await save();
    const res = await served.composed.app.inject({ method: 'DELETE', url: `/api/v1/public/records/${DESIGNS_REF}/${String(saved.id)}`, remoteAddress: fresh(), headers: served.headers() });
    expect(res.statusCode).toBe(404);
    expect(await exists(saved.id)).toBe(true);
  });
});
