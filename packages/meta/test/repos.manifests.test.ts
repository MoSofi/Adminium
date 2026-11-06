// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `manifestsRepo` — the writer `adminium_manifests` never had.
 *
 * The lifecycle these assert is the one turn on, so it is worth stating
 * plainly: install writes a manifest and its attachments, connect writes a
 * credential, DISCONNECT deletes only the credential, and uninstall deletes
 * the manifest and lets the FKs take the rest. Every step of that is checked
 * here by observing the other tables, not by trusting the method name.
 */
import { sql } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';

import { SERVER_SCOPE, connectionsRepo, manifestsRepo } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

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
  scopeKey: SERVER_SCOPE,
};

/** A host key not installed yet. */
const host = (key: string) => ({ key, hostInstall: '' });

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`manifestsRepo [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);
    let repo: ReturnType<typeof manifestsRepo>;

    beforeEach(async () => {
      repo = manifestsRepo(meta(), crypto);
    });

    it('installs a manifest with its attachments and reads the document back', async () => {
      const installed = await repo.install({ ...DHL, attachTo: [host('printing'), host('maker')] }, T0);
      expect(installed.attachments.map((a) => a.attachedTo)).toEqual(['printing', 'maker']);

      const found = await repo.findInScope('shipping-dhl', SERVER_SCOPE);
      expect(found?.document).toEqual(DHL.document);
      expect(found?.row.kind).toBe('add-on');
      expect(found?.attachments).toHaveLength(2);
      // 17 defers licences by name; nothing here writes that column.
      expect(found?.row.licenseKeyEncrypted).toBeNull();
    });

    it('lists add-ons apart from apps', async () => {
      await repo.install(DHL, T0);
      await repo.install(
        { manifestKey: 'northline', version: '2.0.0', kind: 'app', source: 'file', document: {}, scopeKey: 'conn_a' },
        T0,
      );
      expect((await repo.list('add-on')).map((m) => m.row.manifestKey)).toEqual(['shipping-dhl']);
      expect((await repo.list('app')).map((m) => m.row.manifestKey)).toEqual(['northline']);
      expect(await repo.list()).toHaveLength(2);
    });

    it('attaching twice is idempotent rather than a second row', async () => {
      const installed = await repo.install(DHL, T0);
      const first = await repo.attach(installed.row.id, host('printing'), T0);
      const again = await repo.attach(installed.row.id, host('printing'), T0 + 5);
      expect(again.id).toBe(first.id);
      expect((await repo.findInScope('shipping-dhl', SERVER_SCOPE))?.attachments).toHaveLength(1);
    });

    it('records which database the tables of a manifest are in, on a row that had none', async () => {
      const installed = await repo.install(DHL, T0);
      expect(installed.row.connectionId).toBeNull();
      const connection = await connectionsRepo(meta(), { encrypt: (v: string) => v, decrypt: (v: string) => v }).create({ name: 'Shop', engine: 'sqlite', introspectDsn: 'sqlite::memory:', dataDsn: 'sqlite::memory:' });
      await repo.setConnection(installed.row.id, connection.id, T0 + 3);
      const after = await repo.findInScope('shipping-dhl', SERVER_SCOPE);
      expect(after?.row.connectionId).toBe(connection.id);
      expect(after?.row.updatedAt).toBe(T0 + 3);
    });

    it('enables and disables per host, not per add-on', async () => {
      // The property the join table exists for: live on one host, off on
      // another, which a single flag on the manifest could not represent.
      const installed = await repo.install({ ...DHL, attachTo: [host('printing'), host('maker')] }, T0);
      expect(await repo.setAttachmentEnabled(installed.row.id, host('maker'), false, T0 + 1)).toBe(true);

      expect((await repo.enabledForHost('printing')).map((m) => m.row.manifestKey)).toEqual([
        'shipping-dhl',
      ]);
      expect(await repo.enabledForHost('maker')).toEqual([]);

      await repo.setAttachmentEnabled(installed.row.id, host('maker'), true, T0 + 2);
      expect(await repo.enabledForHost('maker')).toHaveLength(1);
    });

    it('never offers an app through the host read', async () => {
      const app = await repo.install(
        { manifestKey: 'northline', version: '1.0.0', kind: 'app', source: 'file', document: {}, scopeKey: 'conn_a' },
        T0,
      );
      await repo.attach(app.row.id, host('printing'), T0);
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
      const raw = await meta().db
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
      expect(await meta().db.selectFrom('adminium_add_on_credentials').selectAll().execute()).toHaveLength(1);
    });

    it('D5: disconnect deletes the keys and keeps everything else', async () => {
      const installed = await repo.install({ ...DHL, attachTo: [host('printing')] }, T0);
      await repo.setCredential(installed.row.id, { kind: 'api-key', secret: { apiKey: 'k' } }, T0);

      expect(await repo.deleteCredential(installed.row.id)).toBe(true);

      expect(await repo.getCredential(installed.row.id)).toBeNull();
      const still = await repo.findInScope('shipping-dhl', SERVER_SCOPE);
      expect(still?.attachments).toHaveLength(1);
      expect(still?.row.status).toBe('installed');
    });

    it('uninstall removes the manifest and cascades the rest', async () => {
      const installed = await repo.install({ ...DHL, attachTo: [host('printing'), host('maker')] }, T0);
      await repo.setCredential(installed.row.id, { kind: 'api-key', secret: { apiKey: 'k' } }, T0);

      expect(await repo.uninstall(installed.row.id)).toBe(true);

      expect(await repo.findInScope('shipping-dhl', SERVER_SCOPE)).toBeNull();
      expect(await meta().db.selectFrom('adminium_manifest_attachments').selectAll().execute()).toEqual([]);
      expect(await meta().db.selectFrom('adminium_add_on_credentials').selectAll().execute()).toEqual([]);
    });

    it('upgrades version and document in place, keeping attachments and keys', async () => {
      // An upgrade is not a reinstall — the hosts it is mounted on and the
      // credential it was given both survive it.
      const installed = await repo.install({ ...DHL, attachTo: [host('printing')] }, T0);
      await repo.setCredential(installed.row.id, { kind: 'api-key', secret: { apiKey: 'k' } }, T0);

      await repo.setVersion(
        installed.row.id,
        { version: '1.1.0', document: { ...DHL.document, version: '1.1.0' } },
        T0 + 100,
      );

      const after = await repo.findInScope('shipping-dhl', SERVER_SCOPE);
      expect(after?.row.version).toBe('1.1.0');
      expect(after?.document).toMatchObject({ version: '1.1.0' });
      expect(after?.attachments).toHaveLength(1);
      expect(await repo.getCredential(installed.row.id)).not.toBeNull();
    });

    it('lists manifests larger than a MySQL sort buffer, newest first and by key', async () => {
      // Client Portal 0.2.1 stores about 350 KB of manifest, and MySQL's
      // default sort buffer is 256 KB: a list that sorted whole rows failed
      // with "Out of sort memory" as soon as one such app was installed. Each
      // document here is bigger than the buffer the server actually has.
      let pad = 350_000;
      if (dialect.name === 'mysql') {
        const buffer = await sql<{ size: number | string }>`select @@sort_buffer_size as size`.execute(meta().db);
        pad = Math.max(pad, Number(buffer.rows[0]?.size ?? 0) + 100_000);
      }
      const big = (key: string) => ({ key, version: '1.0.0', pad: 'x'.repeat(pad) });

      for (const [i, key] of ['clients', 'pos', 'clinic'].entries()) {
        await repo.install({ manifestKey: key, version: '1.0.0', kind: 'app', source: 'file', document: big(key), scopeKey: 'conn_a' }, T0 + i);
      }
      for (const [i, key] of ['shipping-ups', 'barcode-labels', 'holiday-calendars'].entries()) {
        await repo.install(
          { manifestKey: key, version: '1.0.0', kind: 'add-on', source: 'file', document: big(key), attachTo: [host('pos')], scopeKey: SERVER_SCOPE },
          T0 + 10 + i,
        );
      }

      const apps = await repo.list('app');
      expect(apps.map((m) => m.row.manifestKey)).toEqual(['clinic', 'pos', 'clients']);
      expect(apps[2]?.document).toEqual(big('clients'));
      expect((await repo.list()).map((m) => m.row.manifestKey)).toEqual([
        'holiday-calendars',
        'barcode-labels',
        'shipping-ups',
        'clinic',
        'pos',
        'clients',
      ]);
      const byKey = ['barcode-labels', 'holiday-calendars', 'shipping-ups'];
      const enabled = await repo.enabledForHost('pos');
      expect(enabled.map((m) => m.row.manifestKey)).toEqual(byKey);
      expect(enabled[0]?.attachments.map((a) => a.attachedTo)).toEqual(['pos']);
      expect((await repo.attachedToHost('pos')).map((m) => m.row.manifestKey)).toEqual(byKey);
    });

    it('lists two installed in the same millisecond newest first, by id', async () => {
      const first = await repo.install({ ...DHL, manifestKey: 'aa-first' }, T0);
      const second = await repo.install({ ...DHL, manifestKey: 'zz-second' }, T0);
      const expected = [first.row.id, second.row.id].sort().reverse();
      expect((await repo.list('add-on')).map((m) => m.row.id)).toEqual(expected);
    });

    it('reports a missing manifest as null rather than throwing', async () => {
      expect(await repo.findInScope('never-installed', SERVER_SCOPE)).toBeNull();
      expect(await repo.findById('mft_absent')).toBeNull();
      expect(await repo.uninstall('mft_absent')).toBe(false);
      expect(await repo.deleteCredential('mft_absent')).toBe(false);
    });

    describe('one install per database (wave 0076)', () => {
      const POS = { manifestKey: 'pos', version: '1.0.0', kind: 'app' as const, source: 'file', document: { key: 'pos' } };

      it('installs the same key once per scope, and refuses a second install in one scope', async () => {
        const fernhill = await repo.install({ ...POS, scopeKey: 'conn_fernhill' }, T0);
        const kiln = await repo.install({ ...POS, scopeKey: 'conn_kiln', instanceSlug: 'kiln' }, T0 + 1);
        expect((await repo.listByKey('pos')).map((m) => m.row.id)).toEqual([fernhill.row.id, kiln.row.id]);
        expect((await repo.findInScope('pos', 'conn_kiln'))?.row.id).toBe(kiln.row.id);
        expect((await repo.findBySlug('pos', ''))?.row.id).toBe(fernhill.row.id);
        expect((await repo.findBySlug('pos', 'kiln'))?.row.id).toBe(kiln.row.id);
        await expect(repo.install({ ...POS, scopeKey: 'conn_kiln', instanceSlug: 'kiln-2' }, T0 + 2)).rejects.toThrow();
      });

      it('gives the bare addresses to exactly one install: a second bare slug is refused', async () => {
        await repo.install({ ...POS, scopeKey: 'conn_fernhill' }, T0);
        await expect(repo.install({ ...POS, scopeKey: 'conn_kiln' }, T0 + 1)).rejects.toThrow();
      });

      it('keeps a server-wide add-on once per server: a NULL connection cannot slip past the key', async () => {
        await repo.install({ ...DHL }, T0);
        await expect(repo.install({ ...DHL, instanceSlug: 'other' }, T0 + 1)).rejects.toThrow();
      });

      it('lists what is installed on one database', async () => {
        await repo.install({ ...POS, scopeKey: 'conn_fernhill' }, T0);
        await repo.install({ ...POS, manifestKey: 'clinic', scopeKey: 'conn_fernhill' }, T0);
        await repo.install({ ...POS, scopeKey: 'conn_kiln', instanceSlug: 'kiln' }, T0);
        expect((await repo.listInScope('conn_fernhill')).map((m) => m.row.manifestKey)).toEqual(['clinic', 'pos']);
        expect(await repo.listInScope('conn_fernhill', 'add-on')).toEqual([]);
      });

      it('attaches an add-on to one host install, and the host reads only its own', async () => {
        const fernhill = await repo.install({ ...POS, scopeKey: 'conn_fernhill' }, T0);
        const kiln = await repo.install({ ...POS, scopeKey: 'conn_kiln', instanceSlug: 'kiln' }, T0);
        const forFernhill = await repo.install({ ...DHL, scopeKey: 'conn_fernhill', attachTo: [{ key: 'pos', hostInstall: fernhill.row.id }] }, T0);
        const forKiln = await repo.install({ ...DHL, scopeKey: 'conn_kiln', instanceSlug: 'kiln', attachTo: [{ key: 'pos', hostInstall: kiln.row.id }] }, T0);
        expect((await repo.enabledForHost('pos', fernhill.row.id)).map((m) => m.row.id)).toEqual([forFernhill.row.id]);
        expect((await repo.enabledForHost('pos', kiln.row.id)).map((m) => m.row.id)).toEqual([forKiln.row.id]);
        expect(await repo.setAttachmentEnabled(forKiln.row.id, { key: 'pos', hostInstall: kiln.row.id }, false, T0 + 1)).toBe(true);
        expect(await repo.enabledForHost('pos', kiln.row.id)).toEqual([]);
        expect(await repo.enabledForHost('pos', fernhill.row.id)).toHaveLength(1);
        // Uninstalling Kiln's host takes Kiln's links only.
        expect(await repo.detachHost({ key: 'pos', hostInstall: kiln.row.id })).toBe(1);
        expect((await repo.attachedToHost('pos', fernhill.row.id)).map((m) => m.row.id)).toEqual([forFernhill.row.id]);
      });

      it('lets the first install of a host key claim the links made before it was installed', async () => {
        const addOn = await repo.install({ ...DHL, attachTo: [host('pos')] }, T0);
        const pos = await repo.install({ ...POS, scopeKey: 'conn_fernhill' }, T0 + 1);
        expect(await repo.claimAttachments('pos', pos.row.id)).toBe(1);
        expect((await repo.findById(addOn.row.id))?.attachments.map((a) => a.hostInstall)).toEqual([pos.row.id]);
        // Nothing is left for a later install to claim.
        expect(await repo.claimAttachments('pos', 'mft_later')).toBe(0);
      });
    });
  });
}
