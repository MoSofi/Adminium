// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `manifestsRepo` — the writer `adminium_manifests` never had (26 §4).
 *
 * The lifecycle these assert is the one 24 D16 / 26 D5 turn on, so it is worth
 * stating plainly: install writes a manifest and its attachments, connect
 * writes a credential, DISCONNECT deletes only the credential, and uninstall
 * deletes the manifest and lets the FKs take the rest. Every step of that is
 * checked here by observing the other tables, not by trusting the method name.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyMigrations, manifestsRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

/** Repos never see key material — a reversible marker is all these need. */
const crypto = {
  encrypt: (v: string) => `enc:${Buffer.from(v, 'utf8').toString('base64')}`,
  decrypt: (v: string) => Buffer.from(v.slice(4), 'base64').toString('utf8'),
};

const DHL = {
  manifestKey: 'shipping-dhl',
  version: '1.0.0',
  kind: 'add-on' as const,
  source: 'marketplace',
  document: { kind: 'add-on', key: 'shipping-dhl', version: '1.0.0' },
};

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`manifestsRepo [${dialect.name}]`, () => {
    let t: TestDb;
    let repo: ReturnType<typeof manifestsRepo>;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      repo = manifestsRepo(t.meta, crypto);
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('installs a manifest with its attachments and reads the document back', async () => {
      const installed = await repo.install({ ...DHL, attachTo: ['printing', 'maker'] }, T0);
      expect(installed.attachments.map((a) => a.attachedTo)).toEqual(['printing', 'maker']);

      const found = await repo.findByKey('shipping-dhl');
      expect(found?.document).toEqual(DHL.document);
      expect(found?.row.kind).toBe('add-on');
      expect(found?.attachments).toHaveLength(2);
      // 17 defers licences by name; nothing here writes that column.
      expect(found?.row.licenseKeyEncrypted).toBeNull();
    });

    it('lists add-ons apart from apps', async () => {
      await repo.install(DHL, T0);
      await repo.install(
        { manifestKey: 'northline', version: '2.0.0', kind: 'app', source: 'file', document: {} },
        T0,
      );
      expect((await repo.list('add-on')).map((m) => m.row.manifestKey)).toEqual(['shipping-dhl']);
      expect((await repo.list('app')).map((m) => m.row.manifestKey)).toEqual(['northline']);
      expect(await repo.list()).toHaveLength(2);
    });

    it('attaching twice is idempotent rather than a second row', async () => {
      const installed = await repo.install(DHL, T0);
      const first = await repo.attach(installed.row.id, 'printing', T0);
      const again = await repo.attach(installed.row.id, 'printing', T0 + 5);
      expect(again.id).toBe(first.id);
      expect((await repo.findByKey('shipping-dhl'))?.attachments).toHaveLength(1);
    });

    it('enables and disables per host, not per add-on', async () => {
      // The property the join table exists for: live on one host, off on
      // another, which a single flag on the manifest could not represent.
      const installed = await repo.install({ ...DHL, attachTo: ['printing', 'maker'] }, T0);
      expect(await repo.setAttachmentEnabled(installed.row.id, 'maker', false, T0 + 1)).toBe(true);

      expect((await repo.enabledForHost('printing')).map((m) => m.row.manifestKey)).toEqual([
        'shipping-dhl',
      ]);
      expect(await repo.enabledForHost('maker')).toEqual([]);

      await repo.setAttachmentEnabled(installed.row.id, 'maker', true, T0 + 2);
      expect(await repo.enabledForHost('maker')).toHaveLength(1);
    });

    it('never offers an app through the host read', async () => {
      const app = await repo.install(
        { manifestKey: 'northline', version: '1.0.0', kind: 'app', source: 'file', document: {} },
        T0,
      );
      await repo.attach(app.row.id, 'printing', T0);
      expect(await repo.enabledForHost('printing')).toEqual([]);
    });

    it('stores a credential encrypted and reads the envelope back', async () => {
      const installed = await repo.install(DHL, T0);
      await repo.setCredential(
        installed.row.id,
        { kind: 'api-key', secret: { apiKey: 'hunter2', account: '4711' } },
        T0,
      );

      const envelope = await repo.getCredential(installed.row.id);
      expect(envelope?.secret).toEqual({ apiKey: 'hunter2', account: '4711' });

      // The stored bytes are ciphertext, and the plaintext appears nowhere in
      // the row — the assertion that matters for a secret at rest.
      const raw = await t.meta.db
        .selectFrom('adminium_add_on_credentials')
        .selectAll()
        .executeTakeFirstOrThrow();
      expect(raw.payload).not.toContain('hunter2');
      expect(JSON.stringify(raw)).not.toContain('hunter2');
    });

    it('reports connect status WITHOUT decrypting anything', async () => {
      // What the Studio list reads. A page that shows "connected" must not need
      // key material to do it.
      const installed = await repo.install(DHL, T0);
      await repo.setCredential(
        installed.row.id,
        { kind: 'oauth2', secret: { access: 'a', refresh: 'r' }, expiresAt: T0 + 3600, scopes: ['x'] },
        T0,
      );
      expect(await repo.credentialStatus(installed.row.id)).toEqual({
        kind: 'oauth2',
        expiresAt: T0 + 3600,
        scopes: ['x'],
      });
      expect(await repo.credentialStatus('mft_absent')).toBeNull();
    });

    it('re-connecting replaces the credential rather than duplicating it', async () => {
      const installed = await repo.install(DHL, T0);
      await repo.setCredential(installed.row.id, { kind: 'api-key', secret: { apiKey: 'old' } }, T0);
      await repo.setCredential(
        installed.row.id,
        { kind: 'api-key', secret: { apiKey: 'rotated' } },
        T0 + 10,
      );
      expect((await repo.getCredential(installed.row.id))?.secret).toEqual({ apiKey: 'rotated' });
      expect(await t.meta.db.selectFrom('adminium_add_on_credentials').selectAll().execute()).toHaveLength(1);
    });

    it('D5: disconnect deletes the keys and keeps everything else', async () => {
      const installed = await repo.install({ ...DHL, attachTo: ['printing'] }, T0);
      await repo.setCredential(installed.row.id, { kind: 'api-key', secret: { apiKey: 'k' } }, T0);

      expect(await repo.deleteCredential(installed.row.id)).toBe(true);

      expect(await repo.getCredential(installed.row.id)).toBeNull();
      const still = await repo.findByKey('shipping-dhl');
      expect(still?.attachments).toHaveLength(1);
      expect(still?.row.status).toBe('installed');
    });

    it('uninstall removes the manifest and cascades the rest', async () => {
      const installed = await repo.install({ ...DHL, attachTo: ['printing', 'maker'] }, T0);
      await repo.setCredential(installed.row.id, { kind: 'api-key', secret: { apiKey: 'k' } }, T0);

      expect(await repo.uninstall(installed.row.id)).toBe(true);

      expect(await repo.findByKey('shipping-dhl')).toBeNull();
      expect(await t.meta.db.selectFrom('adminium_manifest_attachments').selectAll().execute()).toEqual([]);
      expect(await t.meta.db.selectFrom('adminium_add_on_credentials').selectAll().execute()).toEqual([]);
    });

    it('upgrades version and document in place, keeping attachments and keys', async () => {
      // 26-T17: an upgrade is not a reinstall — the hosts it is mounted on and
      // the credential it was given both survive it.
      const installed = await repo.install({ ...DHL, attachTo: ['printing'] }, T0);
      await repo.setCredential(installed.row.id, { kind: 'api-key', secret: { apiKey: 'k' } }, T0);

      await repo.setVersion(
        installed.row.id,
        { version: '1.1.0', document: { ...DHL.document, version: '1.1.0' } },
        T0 + 100,
      );

      const after = await repo.findByKey('shipping-dhl');
      expect(after?.row.version).toBe('1.1.0');
      expect(after?.document).toMatchObject({ version: '1.1.0' });
      expect(after?.attachments).toHaveLength(1);
      expect(await repo.getCredential(installed.row.id)).not.toBeNull();
    });

    it('reports a missing manifest as null rather than throwing', async () => {
      expect(await repo.findByKey('never-installed')).toBeNull();
      expect(await repo.findById('mft_absent')).toBeNull();
      expect(await repo.uninstall('mft_absent')).toBe(false);
      expect(await repo.deleteCredential('mft_absent')).toBe(false);
    });
  });
}
