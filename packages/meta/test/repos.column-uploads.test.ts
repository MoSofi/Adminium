// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest's file for an app's column (binding kind `column`), on every
 * available dialect: a hold is all or nothing (another column, an expired or
 * taken file, one not there: none is held) and takes no address; a hold let
 * go waits again until the expiry it is given; an adopted file's row is
 * closed (no file, out of the pools, still counted for the address's day);
 * the stale holds are listed for the recovery pass; the pools count only
 * files still waiting; an address's bytes are summed over its day; and a
 * stranger's file becomes an ordinary upload once, only while it is one.
 */
import { describe, expect, it } from 'vitest';

import { SETTINGS_REGISTRY, filesRepo, publicUploadsRepo, type PublicUploadBinding } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const LOGO: PublicUploadBinding = { kind: 'column', key: 'conn_1/public.shop_orders/logo', addressKey: 'a'.repeat(64) };
const PHONE: PublicUploadBinding = { ...LOGO, addressKey: 'b'.repeat(64) };
const ART: PublicUploadBinding = { ...LOGO, key: 'conn_1/public.shop_order_lines/artwork' };
const FORM: PublicUploadBinding = { kind: 'form', key: 'forms/frm_a', addressKey: 'a'.repeat(64) };
const TARGET = { kind: 'column', key: LOGO.key };
const OWNER = { connectionId: 'conn_1', table: 'public.shop_orders', key: '' };
const DAY = 86_400_000;

const uid = (n: number) => `cu${String(n).padStart(30, '0')}`;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`guests' files for an app's columns [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    async function fileRow(): Promise<string> {
      return (await filesRepo(meta()).create({ filename: 'logo.png', mime: 'image/png', sizeBytes: 10, sha256: 'f'.repeat(64), kind: 'stranger', uploadedBy: null })).id;
    }

    async function upload(n: number, binding: PublicUploadBinding, at = 1_000, size = 10): Promise<string> {
      await publicUploadsRepo(meta()).create({ id: uid(n), binding, name: `file-${String(n)}.png`, size, kind: 'png', fileId: await fileRow(), expiresAt: at + DAY }, at);
      return uid(n);
    }

    it('holds every file named or none, from any address: another column, expired, taken or missing refuses all', async () => {
      const repo = publicUploadsRepo(meta());
      const one = await upload(1, LOGO);
      const fromPhone = await upload(2, PHONE);
      const art = await upload(3, ART);

      expect(await repo.hold([one, art], TARGET, OWNER, 2_000)).toBe(false);
      expect(await repo.hold([one, uid(99)], TARGET, OWNER, 2_000)).toBe(false);
      expect(await repo.hold([one, one], TARGET, OWNER, 2_000)).toBe(false);
      expect(await repo.hold([one], TARGET, OWNER, 1_000 + DAY)).toBe(false);
      for (const id of [one, fromPhone, art]) expect((await repo.findById(id))?.attachedAt).toBeNull();

      // Another address, the same column: held all the same (the address counts for the caps only).
      expect(await repo.hold([one, fromPhone], TARGET, OWNER, 2_000)).toBe(true);
      expect(await repo.findById(fromPhone)).toMatchObject({ attachedAt: 2_000, expiresAt: null, owner: OWNER });
      expect(await repo.hold([one], TARGET, { ...OWNER, key: '7' }, 2_500)).toBe(false);
      expect(await repo.hold([], TARGET, OWNER, 2_500)).toBe(true);

      // Let go: waiting again, until the expiry it is given; a form's attached file is no hold to let go.
      const form = await upload(4, FORM);
      expect(await repo.attach([form], FORM, { ...OWNER, table: 'answers', key: 'a1' }, 2_000)).toBe(true);
      expect(await repo.release([{ id: one, expiresAt: 1_000 + DAY }, { id: form, expiresAt: 9 }], 'column')).toBe(1);
      expect(await repo.findById(one)).toMatchObject({ attachedAt: null, expiresAt: 1_000 + DAY, owner: null });
      expect((await repo.findById(form))?.attachedAt).toBe(2_000);
    });

    it('closes an adopted file, lists stale holds, and counts only waiting files in each pool', async () => {
      const repo = publicUploadsRepo(meta());
      const waiting = await upload(1, LOGO, 1_000, 40);
      const held = await upload(2, LOGO, 1_000, 2_000);
      const adopted = await upload(3, LOGO, 1_000, 30_000);
      const form = await upload(4, FORM, 1_000, 7);
      const formTaken = await upload(5, FORM, 1_000, 500);
      expect(await repo.attach([formTaken], FORM, { connectionId: 'conn_1', table: 'answers', key: 'a1' }, 1_500)).toBe(true);
      expect(await repo.hold([held], TARGET, OWNER, 2_000)).toBe(true);
      expect(await repo.hold([adopted], TARGET, OWNER, 9_000)).toBe(true);

      // Stale: held before the moment asked, and not adopted.
      expect((await repo.heldBefore('column', 5_000)).map((u) => u.id)).toEqual([held]);
      expect((await repo.heldBefore('column', 10_000)).map((u) => u.id)).toEqual([held, adopted]);

      expect(await repo.adopt(adopted, 'column', { ...OWNER, key: '12' }, 9_500)).toBe(true);
      expect(await repo.adopt(adopted, 'column', { ...OWNER, key: '12' }, 9_600)).toBe(false);
      // Never a file merely waiting, nor a form's.
      expect(await repo.adopt(waiting, 'column', OWNER, 9_500)).toBe(false);
      expect(await repo.adopt(formTaken, 'column', OWNER, 9_500)).toBe(false);
      expect(await repo.findById(adopted)).toMatchObject({ fileId: null, removedAt: 9_500, owner: { ...OWNER, key: '12' } });
      expect((await repo.heldBefore('column', 10_000)).map((u) => u.id)).toEqual([held]);

      // Waiting only: not held, not adopted, not a form's attached file.
      expect(await repo.waitingBytes({ in: ['column'] })).toBe(40);
      expect(await repo.waitingBytes({ notIn: ['column'] })).toBe(7);
      void form;
      // An address's day: every file it sent, adopted ones too; another address apart.
      expect(await repo.bytesFrom('a'.repeat(64), 0)).toBe(40 + 2_000 + 30_000 + 7 + 500);
      expect(await repo.bytesFrom('a'.repeat(64), 1_001)).toBe(0);
      expect(await repo.bytesFrom('b'.repeat(64), 0)).toBe(0);
      // A closed row goes once its address's day is over, as a swept one does.
      expect(await repo.dropRemovedBefore(1_001)).toBe(1);
      expect(await repo.findById(adopted)).toBeNull();
    });

    it('makes a stranger file an ordinary upload once, only while it is one', async () => {
      const files = filesRepo(meta());
      const id = await fileRow();
      expect(await files.adoptStranger(id)).toBe(true);
      expect(await files.findById(id)).toMatchObject({ kind: 'upload', uploadedBy: null });
      expect(await files.adoptStranger(id)).toBe(false);
      const binned = await fileRow();
      await files.markDeleted(binned);
      expect(await files.adoptStranger(binned)).toBe(false);
      expect((await files.findById(binned))?.kind).toBe('stranger');
    });

    it('has the split and the daily bytes as settings, half each and 500 MB by default, and takes TIFF', () => {
      expect(SETTINGS_REGISTRY['publicUploads.columnsShare'].default).toBe(50);
      expect(SETTINGS_REGISTRY['publicUploads.perAddressDailyBytes'].default).toBe(524_288_000);
      expect(SETTINGS_REGISTRY['files.allowedTypes'].default).toContain('tiff');
    });
  });
}
