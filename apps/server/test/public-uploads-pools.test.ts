// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE STRANGERS' UPLOAD STORE'S TWO POOLS AND ITS DAILY BYTES, on every meta
 * engine, over the engine's real file store on disk.
 *
 * - A full forms pool does not stop a guest's file for an app's column, nor
 *   a full columns pool a form's; each refuses in its own pool and the
 *   owner's notice names which.
 * - Only files waiting to be attached count: one a form's answer took, or a
 *   column's write adopted, frees its room.
 * - One address at its day's bytes is refused `cap` (another address is not),
 *   checked again with the file read, and the owner is told.
 * - A column's file waits a day, a form's two hours.
 * - The install's own `files.maxBytes` holds every upload, below the caller's cap.
 * - TIFF is taken, by its bytes, in either byte order.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { notificationsRepo, publicUploadsRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';

import { FILE_UPLOAD_KINDS } from '@adminium/manifest';

import type { FileStore } from '../src/files/store.js';
import { tellUploadsRefused, type UploadTrip, type UploadTripValues } from '../src/public-uploads/notices.js';
import { COLUMN_UPLOAD_KIND, COLUMN_UPLOAD_TTL_MS, createPublicUploads, PUBLIC_UPLOAD_KINDS, UPLOAD_TTL_MS, type PublicUploads, type TakeInput } from '../src/public-uploads/store.js';
import { createTestFileStore } from './helpers/file-store.js';
import { TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const KB = 1024;
const MB = 1024 * KB;
const pdf = (size: number) => Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(Math.max(0, size - 9), 0x20)]);
const TIFF_LE = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(60, 1)]);
const TIFF_BE = Buffer.concat([Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), Buffer.alloc(60, 1)]);
const FORM = { kind: 'form', key: 'forms/frm_a' };
const LOGO = { kind: COLUMN_UPLOAD_KIND, key: 'conn_1/public.shop_orders/logo' };

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the upload store's pools and daily bytes — ${engine.name}`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let dataDir: string;
    let storage: FileStore;
    let uploads: PublicUploads;
    let clock: number;
    let told: { trip: UploadTrip; values: UploadTripValues }[];

    const take = (bytes: Buffer, over: Partial<TakeInput> = {}) =>
      uploads.take({ source: Readable.from([bytes]), name: 'artwork.pdf', binding: LOGO, ip: '203.0.113.7', kinds: ['pdf', 'tiff'], maxBytes: 10 * MB, ...over });

    beforeEach(async () => {
      handle = await engine.make();
      meta = handle.meta;
      dataDir = await mkdtemp(join(tmpdir(), 'upload-pools-'));
      storage = createTestFileStore({ dataDir, meta });
      clock = Date.UTC(2026, 10, 3, 9, 0, 0);
      told = [];
      uploads = createPublicUploads({ meta, storage, secret: TEST_SECRET, now: () => clock, tell: async (trip, values) => void told.push({ trip, values }) });
    });

    afterEach(async () => {
      await handle.destroy();
      await rm(dataDir, { recursive: true, force: true });
    });

    it('keeps a full forms pool from stopping a column upload, and a full columns pool from stopping a form', async () => {
      const settings = settingsRepo(meta);
      // 4 MB in all: 2 MB to app columns, 2 MB to forms.
      await settings.set('publicUploads.quotaBytes', 4 * MB, { updatedBy: null });
      expect((await take(pdf(1_900 * KB), { binding: FORM, ip: '192.0.2.1' })).ok).toBe(true);
      expect(await take(pdf(200 * KB), { binding: FORM, ip: '192.0.2.2' })).toEqual({ ok: false, code: 'quota' });
      // The forms pool is full; the columns pool is not.
      expect((await take(pdf(1_900 * KB), { ip: '192.0.2.3' })).ok).toBe(true);
      expect(await take(pdf(200 * KB), { ip: '192.0.2.4' })).toEqual({ ok: false, code: 'quota' });
      // Each said with its pool and its share, in tenths of a GB (2 MB is none).
      expect(told.map((one) => `${one.trip}:${one.values.pool ?? ''}:${one.values.gb ?? ''}`)).toEqual(['quota:forms:0', 'quota:columns:0']);
      // A share set apart: three quarters to columns.
      await settings.set('publicUploads.columnsShare', 75, { updatedBy: null });
      expect((await take(pdf(900 * KB), { ip: '192.0.2.5' })).ok).toBe(true);
      expect(await take(pdf(100 * KB), { binding: FORM, ip: '192.0.2.6' })).toEqual({ ok: false, code: 'quota' });
    });

    it('counts only files waiting to be attached: one a write took frees its room', async () => {
      await settingsRepo(meta).set('publicUploads.quotaBytes', 2 * MB, { updatedBy: null });
      const first = await take(pdf(900 * KB), { ip: '192.0.2.1' });
      if (!first.ok) throw new Error(first.code);
      expect(await take(pdf(200 * KB), { ip: '192.0.2.2' })).toEqual({ ok: false, code: 'quota' });
      // Held by a write: no longer waiting.
      expect(await publicUploadsRepo(meta).hold([first.upload.id], LOGO, { connectionId: 'conn_1', table: 'public.shop_orders', key: '' }, clock)).toBe(true);
      expect((await take(pdf(200 * KB), { ip: '192.0.2.2' })).ok).toBe(true);
    });

    it('refuses an address at its day of bytes, before and after reading, and tells the owner', async () => {
      await settingsRepo(meta).set('publicUploads.perAddressDailyBytes', 1 * MB, { updatedBy: null });
      expect((await take(pdf(600 * KB))).ok).toBe(true);
      // This one would pass the day's bytes: read, refused, nothing of it kept.
      expect(await take(pdf(600 * KB))).toEqual({ ok: false, code: 'cap' });
      expect((await take(pdf(300 * KB))).ok).toBe(true);
      // To the byte of the cap: taken. Then at the cap: refused before a byte is read.
      expect((await take(pdf(124 * KB))).ok).toBe(true);
      let pulled = false;
      const source = Readable.from(
        (function* () {
          pulled = true;
          yield pdf(10);
        })(),
      );
      expect(await take(Buffer.alloc(0), { source })).toEqual({ ok: false, code: 'cap' });
      expect(pulled).toBe(false);
      // Another address may.
      expect((await take(pdf(600 * KB), { ip: '198.51.100.9' })).ok).toBe(true);
      expect(told.map((one) => one.trip)).toContain('bytes');
      expect(told.find((one) => one.trip === 'bytes')?.values.mb).toBe('1');
      // A day on, the address may again.
      clock += 24 * 3_600_000 + 1;
      expect((await take(pdf(600 * KB))).ok).toBe(true);
    });

    it("keeps a column's file a day and a form's two hours", async () => {
      const column = await take(pdf(10));
      const form = await take(pdf(10), { binding: FORM });
      if (!column.ok || !form.ok) throw new Error('not taken');
      const repo = publicUploadsRepo(meta);
      expect((await repo.findById(column.upload.id))?.expiresAt).toBe(clock + COLUMN_UPLOAD_TTL_MS);
      expect((await repo.findById(form.upload.id))?.expiresAt).toBe(clock + UPLOAD_TTL_MS);
      expect(COLUMN_UPLOAD_TTL_MS).toBe(24 * 3_600_000);
    });

    it("holds every upload to the install's own ceiling, below the caller's", async () => {
      await settingsRepo(meta).set('files.maxBytes', 64 * KB, { updatedBy: null });
      expect(await take(pdf(100 * KB))).toEqual({ ok: false, code: 'too-big' });
      expect((await take(pdf(60 * KB))).ok).toBe(true);
    });

    it('takes TIFF by its bytes, in either byte order, and nothing else under its name', async () => {
      expect(await take(TIFF_LE, { name: 'scan.tif' })).toMatchObject({ ok: true, upload: { kind: 'tiff' } });
      expect(await take(TIFF_BE, { name: 'scan.tiff' })).toMatchObject({ ok: true, upload: { kind: 'tiff' } });
      expect(await take(Buffer.from('#!/bin/sh\necho hi\n'), { name: 'scan.tif' })).toEqual({ ok: false, code: 'kind' });
      expect(await take(TIFF_LE, { kinds: ['pdf'] })).toEqual({ ok: false, code: 'kind' });
      const mimes = await meta.db.selectFrom('adminium_files').select('mime').where('kind', '=', 'stranger').execute();
      expect(mimes.map((row) => row.mime)).toEqual(['image/tiff', 'image/tiff']);
      // The manifest says the same list of kinds to an app.
      expect(Object.fromEntries(Object.entries(PUBLIC_UPLOAD_KINDS))).toEqual(FILE_UPLOAD_KINDS);
    });

    it("names the full pool in the owner's notice, and tells each pool apart in the hour", async () => {
      const owner = await usersRepo(meta).create({ email: 'owner@marlow.example', name: 'Owner' });
      await rolesRepo(meta).assignToUser(owner.id, (await rolesRepo(meta).findBySlug('super-admin'))!.id);
      const at = clock;
      expect(await tellUploadsRefused({ meta }, 'quota', { gb: '1', pool: 'columns' }, at)).toBe(1);
      expect(await tellUploadsRefused({ meta }, 'quota', { gb: '1', pool: 'columns' }, at + 1_000)).toBe(0);
      expect(await tellUploadsRefused({ meta }, 'quota', { gb: '1', pool: 'forms' }, at + 1_000)).toBe(1);
      expect(await tellUploadsRefused({ meta }, 'bytes', { mb: '500' }, at + 1_000)).toBe(1);
      const notices = await notificationsRepo(meta).listForUser(owner.id);
      expect(notices.map((n) => n.title).sort()).toEqual(["Customers' files are being refused", 'Files from your forms are being refused', 'One visitor sent too much']);
      expect(notices.find((n) => n.title === 'One visitor sent too much')?.body).toContain('500 MB');
      expect(notices.find((n) => n.title === "Customers' files are being refused")?.body).toContain('(1 GB)');
    });
  });
}
