// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Files strangers uploaded (wave 0074), on every available dialect: attach is
 * all or nothing (another form, another address, a file that expired or was
 * taken already, one that is not there: none is attached); a file let go is
 * unattached again; the sweep's empty rows still count for the address's day;
 * the bytes kept are summed; every bounded column takes its full width; and a
 * row lets go of its file when the file row goes.
 */
import { describe, expect, it } from 'vitest';

import { SETTINGS_REGISTRY, filesRepo, publicUploadsRepo, type PublicUploadBinding } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const FORM_A: PublicUploadBinding = { kind: 'form', key: 'forms/frm_a', addressKey: 'a'.repeat(64) };
const FORM_B: PublicUploadBinding = { kind: 'form', key: 'forms/frm_b', addressKey: 'a'.repeat(64) };
const OTHER_ADDRESS: PublicUploadBinding = { ...FORM_A, addressKey: 'b'.repeat(64) };
const OWNER = { connectionId: 'conn_1', table: 'forms_answers', key: 'ans_1' };

const uid = (n: number) => `up${String(n).padStart(30, '0')}`;

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`files strangers uploaded [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    async function fileRow(name = 'plan.pdf'): Promise<string> {
      return (await filesRepo(meta()).create({ filename: name, mime: 'application/pdf', sizeBytes: 10, sha256: 'f'.repeat(64), kind: 'stranger', uploadedBy: null })).id;
    }

    async function upload(n: number, binding: PublicUploadBinding, at = 1_000, size = 10): Promise<string> {
      await publicUploadsRepo(meta()).create({ id: uid(n), binding, name: `file-${String(n)}.pdf`, size, kind: 'pdf', fileId: await fileRow(), expiresAt: at + 7_200_000 }, at);
      return uid(n);
    }

    it('attaches every file named or none: another form, another address, expired, taken or missing refuses the whole write', async () => {
      const repo = publicUploadsRepo(meta());
      const one = await upload(1, FORM_A);
      const two = await upload(2, FORM_A);
      const forB = await upload(3, FORM_B);
      const elsewhere = await upload(4, OTHER_ADDRESS);

      expect(await repo.attach([one, forB], FORM_A, OWNER, 2_000)).toBe(false);
      expect(await repo.attach([one, elsewhere], FORM_A, OWNER, 2_000)).toBe(false);
      expect(await repo.attach([one, uid(99)], FORM_A, OWNER, 2_000)).toBe(false);
      expect(await repo.attach([one, one], FORM_A, OWNER, 2_000)).toBe(false);
      // Past its time: refused, even for its own form and address.
      expect(await repo.attach([one], FORM_A, OWNER, 1_000 + 7_200_000)).toBe(false);
      // Nothing moved by any of those.
      for (const id of [one, two, forB, elsewhere]) expect((await repo.findById(id))?.attachedAt).toBeNull();

      expect(await repo.attach([one, two], FORM_A, OWNER, 2_000)).toBe(true);
      expect(await repo.findById(one)).toMatchObject({ attachedAt: 2_000, expiresAt: null, owner: OWNER });
      // Taken already: another answer cannot take it again.
      expect(await repo.attach([one], FORM_A, { ...OWNER, key: 'ans_2' }, 2_500)).toBe(false);
      expect(await repo.attach([], FORM_A, OWNER, 2_500)).toBe(true);

      expect((await repo.ownedBy('conn_1', 'forms_answers', ['ans_1'])).map((u) => u.id)).toEqual([one, two]);
      expect(await repo.ownedBy('conn_1', 'forms_answers', [])).toEqual([]);

      // Let go (the answer's write did not stand): unattached again, with a time of its own.
      expect(await repo.detach([one, two], OWNER, 9_000)).toBe(2);
      expect(await repo.findById(one)).toMatchObject({ attachedAt: null, expiresAt: 9_000, owner: null });
    });

    it('sweeps: an expired unattached file is listed, emptied once, still counted for its address’s day, then dropped', async () => {
      const repo = publicUploadsRepo(meta());
      const late = await upload(1, FORM_A, 1_000, 40);
      const kept = await upload(2, FORM_A, 5_000, 2);
      await upload(3, OTHER_ADDRESS, 1_000, 100);
      expect(await repo.attach([kept], FORM_A, OWNER, 5_500)).toBe(true);

      expect((await repo.expiredBefore(1_000 + 7_200_000)).map((u) => u.id)).toEqual([late, uid(3)]);
      expect(await repo.expiredBefore(1_000)).toEqual([]);
      expect(await repo.keptBytes()).toBe(142);

      expect(await repo.markRemoved(late, 8_000_000)).toBe(true);
      expect(await repo.markRemoved(late, 8_000_001)).toBe(false);
      // An attached file is never emptied by the sweep.
      expect(await repo.markRemoved(kept, 8_000_000)).toBe(false);
      expect(await repo.findById(late)).toMatchObject({ name: null, fileId: null, removedAt: 8_000_000 });
      expect(await repo.keptBytes()).toBe(102);
      expect(await repo.countFrom(FORM_A.addressKey, 0)).toBe(2);
      expect(await repo.countFrom(FORM_A.addressKey, 1_000)).toBe(2);
      expect(await repo.countFrom(FORM_A.addressKey, 2_000)).toBe(1);
      expect((await repo.boundTo('form', 'forms/frm_a')).map((u) => u.id)).toEqual([kept, uid(3)]);

      expect(await repo.dropRemovedBefore(1_000)).toBe(0);
      expect(await repo.dropRemovedBefore(1_001)).toBe(1);
      expect(await repo.findById(late)).toBeNull();
      expect(await repo.delete([kept, uid(3)])).toBe(2);
      expect(await repo.keptBytes()).toBe(0);
    });

    it('takes every bounded column at its full width, and lets go of its file when the file row goes', async () => {
      const repo = publicUploadsRepo(meta());
      const wide: PublicUploadBinding = { kind: 'k'.repeat(20), key: 'b'.repeat(200), addressKey: 'c'.repeat(64) };
      const owner = { connectionId: 'conn_' + 'x'.repeat(31), table: 't'.repeat(200), key: 'r'.repeat(200) };
      const fileId = await fileRow();
      const id = 'Z'.repeat(32);
      await repo.create({ id, binding: wide, name: 'n'.repeat(255), size: 3_000_000_000, kind: 'x'.repeat(20), fileId, expiresAt: 9_999_999_999_999 }, 1);
      expect(await repo.attach([id], wide, owner, 2)).toBe(true);
      expect(await repo.findById(id)).toMatchObject({ id, binding: wide, name: 'n'.repeat(255), size: 3_000_000_000, kind: 'x'.repeat(20), owner });
      expect(await repo.keptBytes()).toBe(3_000_000_000);

      await filesRepo(meta()).purge(fileId);
      expect((await repo.findById(id))?.fileId).toBeNull();
    });

    it('defaults the quota to 2 GB and the daily cap to 30 files', () => {
      expect(SETTINGS_REGISTRY['publicUploads.quotaBytes'].default).toBe(2_147_483_648);
      expect(SETTINGS_REGISTRY['publicUploads.perAddressDaily'].default).toBe(30);
    });
  });
}
