// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A person's data downloaded (wave 0070) and the privacy settings, on every
 * available dialect: a download keeps its person as a keyed hash, moves from
 * processing to ready or failed once, is found by any of its person's hashes,
 * goes with the person who asked for it, and every bounded column takes its
 * full width. The privacy notice's address is https only.
 */
import { describe, expect, it } from 'vitest';

import { SETTINGS_REGISTRY, filesRepo, privacyExportsRepo, settingsRepo, usersRepo } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const h = (hash: string, version = 1) => ({ hash: hash.padEnd(64, '0'), version });

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`a person's data downloaded [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    it('moves from processing to ready once, keeps its counts, and is found by its person under any version', async () => {
      const ava = (await usersRepo(meta()).create({ email: 'ava@example.com', name: 'Ava' })).id;
      const repo = privacyExportsRepo(meta());
      const made = await repo.create({ requestedBy: ava, address: h('a1') }, 1_000);
      expect(made).toMatchObject({ requestedBy: ava, address: h('a1'), status: 'processing', fileId: null, counts: null, expiresAt: null });
      expect(made.id.startsWith('pex_')).toBe(true);
      const file = await filesRepo(meta()).create({ filename: 'person.zip', mime: 'application/zip', sizeBytes: 10, sha256: 'x'.repeat(64), kind: 'export', uploadedBy: ava }, 1_500);
      expect(await repo.markReady(made.id, { fileId: file.id, counts: { 'people-crm-contacts': 1, consent: 3 }, expiresAt: 9_000 }, 2_000)).toBe(true);
      // Once only: a second run of the job, or a late failure, moves nothing.
      expect(await repo.markReady(made.id, { fileId: file.id, counts: {}, expiresAt: 1 }, 2_500)).toBe(false);
      expect(await repo.markFailed(made.id, 'late', 2_600)).toBe(false);
      expect(await repo.findById(made.id)).toMatchObject({ status: 'ready', fileId: file.id, counts: { 'people-crm-contacts': 1, consent: 3 }, completedAt: 2_000, expiresAt: 9_000 });

      const other = await repo.create({ requestedBy: ava, address: h('b2', 2) }, 3_000);
      expect((await repo.aboutPerson([h('a1', 2), h('a1')])).map((one) => one.id)).toEqual([made.id]);
      expect((await repo.aboutPerson([h('b2', 2)])).map((one) => one.id)).toEqual([other.id]);
      expect(await repo.aboutPerson([])).toEqual([]);
      expect((await repo.listFor(ava)).map((one) => one.id)).toEqual([other.id, made.id]);

      // Time is up: the sweep finds it; once expired its file is no longer named.
      expect((await repo.expiredBefore(10_000)).map((one) => one.id)).toEqual([made.id]);
      expect(await repo.expiredBefore(8_000)).toEqual([]);
      await repo.markExpired(made.id);
      expect(await repo.findById(made.id)).toMatchObject({ status: 'expired', fileId: null });

      // The erasure takes a person's downloads away, and says which files they held.
      await repo.markReady(other.id, { fileId: file.id, counts: {}, expiresAt: 20_000 }, 3_500);
      expect(await repo.deleteAboutPerson([h('b2', 2)])).toEqual({ deleted: 1, fileIds: [file.id] });
      expect(await repo.findById(other.id)).toBeNull();
    });

    it('goes with the person who asked, and lets its file go first', async () => {
      const ava = (await usersRepo(meta()).create({ email: 'ava@example.com', name: 'Ava' })).id;
      const repo = privacyExportsRepo(meta());
      const made = await repo.create({ requestedBy: ava, address: h('c3') });
      const file = await filesRepo(meta()).create({ filename: 'person.zip', mime: 'application/zip', sizeBytes: 10, sha256: 'y'.repeat(64), kind: 'export', uploadedBy: null });
      await repo.markReady(made.id, { fileId: file.id, counts: {}, expiresAt: 5 });
      await filesRepo(meta()).purge(file.id);
      expect((await repo.findById(made.id))?.fileId).toBeNull();
      await meta().db.deleteFrom('adminium_users').where('id', '=', ava).execute();
      expect(await repo.findById(made.id)).toBeNull();
    });

    it('writes every bounded column at its full width, and cuts a long failure', async () => {
      const ava = (await usersRepo(meta()).create({ email: 'ava@example.com', name: 'Ava' })).id;
      const repo = privacyExportsRepo(meta());
      const made = await repo.create({ requestedBy: ava, address: { hash: 'f'.repeat(64), version: 2_147_483_647 } });
      expect(await repo.markFailed(made.id, 'e'.repeat(900), 1_790_000_000_000)).toBe(true);
      const back = await repo.findById(made.id);
      expect(back).toMatchObject({ address: { hash: 'f'.repeat(64), version: 2_147_483_647 }, status: 'failed', completedAt: 1_790_000_000_000 });
      expect(back!.error).toBe('e'.repeat(500));
      // `status` is 16 wide: the longest value written is `processing`.
      await meta().db.updateTable('adminium_privacy_exports').set({ status: 's'.repeat(16) }).where('id', '=', made.id).execute();
      expect((await meta().db.selectFrom('adminium_privacy_exports').select('status').where('id', '=', made.id).executeTakeFirst())?.status).toBe('s'.repeat(16));
    });

    it('keeps the privacy settings: a business name, an https notice address, a postal address', async () => {
      const settings = settingsRepo(meta());
      expect(await settings.get('privacy.businessName')).toBeNull();
      expect(await settings.get('privacy.noticeUrl')).toBeNull();
      expect(await settings.get('email.postalAddress')).toBeNull();
      await settings.set('privacy.businessName', 'M'.repeat(120));
      await settings.set('privacy.noticeUrl', `https://www.meridian.example/${'p'.repeat(460)}`);
      await settings.set('email.postalAddress', 'A'.repeat(300));
      expect(await settings.get('privacy.businessName')).toBe('M'.repeat(120));
      expect(await settings.get('email.postalAddress')).toBe('A'.repeat(300));
      await expect(settings.set('privacy.noticeUrl', 'http://www.meridian.example/privacy')).rejects.toThrow(/privacy.noticeUrl/);
      await expect(settings.set('privacy.noticeUrl', 'https://user:pass@www.meridian.example/privacy')).rejects.toThrow(/privacy.noticeUrl/);
      await expect(settings.set('privacy.noticeUrl', 'not an address')).rejects.toThrow(/privacy.noticeUrl/);
      await expect(settings.set('privacy.businessName', 'M'.repeat(121))).rejects.toThrow(/privacy.businessName/);
      await expect(settings.set('email.postalAddress', 'A'.repeat(301))).rejects.toThrow(/email.postalAddress/);
      // Configuration the owner wrote: it travels in a config bundle.
      expect([SETTINGS_REGISTRY['privacy.businessName'].portable, SETTINGS_REGISTRY['privacy.noticeUrl'].portable, SETTINGS_REGISTRY['email.postalAddress'].portable]).toEqual([true, true, true]);
    });
  });
}
