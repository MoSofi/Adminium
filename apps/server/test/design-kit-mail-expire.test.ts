// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A MAIL ABOUT A DESIGN NEVER KEEPS THE DESIGN.
 *
 * The design kit mails a saved design's private link to the address saved
 * with it, one row a message in its own log (`mails`, linking the design).
 * A design never ordered goes 90 days after its last change, mailed or not:
 * as it goes, the message already sent stays in the log as it was sent (its
 * kind, its address, when it went) and names no design any more, and one not
 * sent yet is skipped, never sent about a design that is gone. A message
 * about a design that is not yet due keeps its link. On every engine this run
 * can reach, through the real installer; and the server's own daily run does
 * the same.
 */
import { documentSequencesRepo, filesRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADD_ON_EXPIRE_SWEEP_NAME, sweepExpiredRows } from '../src/add-ons/expire.js';
import { createWriteService } from '../src/crud/write-service.js';
import { createOutboxProducers } from '../src/outbox/producers.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { DESIGN_KIT, DESIGN_LINK_KIND, DESIGN_MAILS, designKitManifest, designShopManifest } from './fixtures/design-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

const DAY = 86_400_000;
/** The test's own today. */
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
/** A moment as Adminium stores one on each engine: ISO on SQLite and Postgres, a UTC datetime on MySQL. */
const stored = (dialect: string, at: number) => (dialect === 'mysql' ? new Date(at).toISOString().replace('T', ' ').replace('Z', '') : new Date(at).toISOString());

describe.each(LEGS)('a mail about a design never keeps the design — %s', (dialect, available) => {
  let h: Harness;
  let releasing: ReturnType<typeof createOutboxProducers>['releasing'];
  const daysAgo = (days: number) => stored(dialect, NOW - days * DAY);
  const designs = async () => (await h.rows('SELECT id FROM design_kit_designs ORDER BY id')).map((row) => Number(row['id']));
  const mails = async () =>
    (await h.rows(`SELECT id, kind, status, to_address, sent_at, error, design_id FROM ${DESIGN_MAILS} ORDER BY id`)).map((row) => ({
      id: Number(row['id']),
      kind: row['kind'],
      status: row['status'],
      to: row['to_address'],
      sent: row['sent_at'] === null ? null : 'at',
      error: row['error'],
      design: row['design_id'] === null ? null : Number(row['design_id']),
    }));
  const design = (id: number, at: string) => `(${String(id)}, 'CODE${String(id).padStart(12, '0')}', 'TOKEN${String(id).padStart(11, '0')}', 'printing', 'draft', 'Words ${String(id)}', 'd${String(id)}@shop.dev', '${at}')`;
  const insertDesigns = (rows: string[]) => h.rows(`INSERT INTO design_kit_designs (id, code, link_token, app, state, name_text, email, updated_at) VALUES ${rows.join(', ')}`);
  const mail = (id: number, status: string, designId: number, sent: boolean) =>
    `(${String(id)}, '${DESIGN_LINK_KIND}', '${status}', 'd${String(designId)}@shop.dev', ${sent ? `'${daysAgo(100)}'` : 'NULL'}, ${String(designId)})`;
  const insertMails = (rows: string[]) => h.rows(`INSERT INTO ${DESIGN_MAILS} (id, kind, status, to_address, sent_at, design_id) VALUES ${rows.join(', ')}`);

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(designKitManifest({}, { link: true, mail: true, remove: true }));
    await h.stageApp(designShopManifest('printing'));
    const installed = await h.install('printing', '1.0.0', { addOns: [{ key: DESIGN_KIT, version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    const views = createPublicViews(h.meta);
    const producers = createOutboxProducers({ meta: h.meta, manager: h.manager, viewFor: views.viewFor, writes: createWriteService({ sequences: documentSequencesRepo(h.meta) }) });
    releasing = producers.releasing;
    // Design 1, mailed and sent; 2, its mail still waiting; 3, a mail that failed; 4, mailed and within its time.
    await insertDesigns([design(1, daysAgo(100)), design(2, daysAgo(95)), design(3, daysAgo(120)), design(4, daysAgo(10))]);
    await insertMails([mail(1, 'sent', 1, true), mail(2, 'queued', 2, false), mail(3, 'failed', 3, false), mail(4, 'sent', 4, true)]);
  }, 240_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('a mailed draft goes on its day: the sent mail stays as it was sent, the waiting one is skipped', async () => {
    const swept = await sweepExpiredRows({ meta: h.meta, manager: h.manager, now: () => NOW, releases: releasing });
    expect(swept).toEqual({ 'design-kit:designs': 3 });
    expect(await designs()).toEqual([4]);
    expect(await mails()).toEqual([
      // Sent: kept as sent, to whom and when, naming no design any more.
      { id: 1, kind: DESIGN_LINK_KIND, status: 'sent', to: 'd1@shop.dev', sent: 'at', error: null, design: null },
      // Still waiting: never sent about a design that is gone.
      { id: 2, kind: DESIGN_LINK_KIND, status: 'skipped', to: 'd2@shop.dev', sent: null, error: expect.any(String), design: null },
      // Failed already: kept as it was.
      { id: 3, kind: DESIGN_LINK_KIND, status: 'failed', to: 'd3@shop.dev', sent: null, error: null, design: null },
      // A design within its time keeps its mail's link.
      { id: 4, kind: DESIGN_LINK_KIND, status: 'sent', to: 'd4@shop.dev', sent: 'at', error: null, design: 4 },
    ]);
  });

  it.skipIf(!available)('without letting go, the database keeps a mailed design: the sweep is what frees it', async () => {
    await insertDesigns([design(5, daysAgo(100))]);
    await insertMails([mail(5, 'sent', 5, true)]);
    // A sweep that is told no links let go is refused by the mail's key, and leaves the design and its mail as they were.
    expect(await sweepExpiredRows({ meta: h.meta, manager: h.manager, now: () => NOW })).toEqual({});
    expect(await designs()).toContain(5);
    expect((await mails()).find((row) => row.id === 5)).toMatchObject({ status: 'sent', design: 5 });
    expect(await sweepExpiredRows({ meta: h.meta, manager: h.manager, now: () => NOW, releases: releasing })).toEqual({ 'design-kit:designs': 1 });
    expect((await mails()).find((row) => row.id === 5)).toMatchObject({ status: 'sent', design: null });
  });

  it.skipIf(!available)('the server\'s own daily run lets a mailed design go too, its photo to the bin; the sent mail stays readable to staff', async () => {
    const stale = stored(dialect, Date.now() - 1000 * DAY);
    await insertDesigns([design(8, stale)]);
    await insertMails([mail(8, 'queued', 8, false)]);
    // Its photo, in the kit's own file column: the page blocks never list it, the column's rule does.
    const file = await filesRepo(h.meta).create({ filename: 'photo.png', mime: 'image/png', sizeBytes: 10, sha256: 'x', kind: 'upload' });
    await h.rows(`UPDATE design_kit_designs SET photo = '${file.id}' WHERE id = 8`);
    const served = await servePublic(h as never, null, { ADMINIUM_DATA_DIR: h.dataDir });
    try {
      await served.composed.jobs.scheduler.trigger(ADD_ON_EXPIRE_SWEEP_NAME);
      for (let round = 0; round < 5; round += 1) {
        await h.meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('status', '=', 'pending' as never).execute();
        if ((await served.composed.jobs.worker.runOnce()) === 0) break;
      }
      expect(await designs()).not.toContain(8);
      expect((await mails()).find((row) => row.id === 8)).toMatchObject({ status: 'skipped', design: null });
      expect((await filesRepo(h.meta).findById(file.id))?.deletedAt ?? null).not.toBeNull();
      // The mail sent about a design long gone is still read by staff, on the log's own page, as it was sent.
      const officer = await usersRepo(h.meta).create({ email: 'pia@shop.dev', name: 'Pia', passwordHash: await adminPasswordHash() });
      await rolesRepo(h.meta).assignToUser(officer.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
      const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.8.0.2', payload: { email: 'pia@shop.dev', password: ADMIN_PASSWORD } });
      const table = (await createPublicViews(h.meta).viewFor(h.connectionId))!.table(DESIGN_MAILS).id;
      const read = await served.composed.app.inject({ method: 'GET', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(table)}/1`, headers: { cookie: sessionCookie(login.headers['set-cookie']) } });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.body).toContain('d1@shop.dev');
      expect(read.body).toContain('sent');
    } finally {
      await served.close();
    }
  });
});
