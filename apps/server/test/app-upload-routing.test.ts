// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE AN UPLOADED FILE GOES, on every engine this run can reach.
 *
 * An app is installed once per database and runs one version per server.
 * The upload says where the file goes: `install` for a key installed
 * nowhere, `update` for a newer version than the copies run, and
 * `install-another` for the same version, with how many databases have no
 * copy yet. An older version is refused at the upload, saying which database
 * has which version, and so is an install of one over a newer copy. A
 * self-made app from another dashboard under the same key (another lineage)
 * is refused across the server, whichever database it is meant for.
 */
import { manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { sha512Integrity } from '../src/add-ons/store.js';
import { packageTarball } from './app-bundle-helpers.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

type Doc = Record<string, unknown>;

const LINEAGE = 'kiln-street-01';

function pottery(version: string, lineage: string | null = LINEAGE): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'pottery',
    name: 'Pottery',
    version,
    publisher: { id: 'local', name: 'Made here' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A pottery.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: { tables: [{ ref: 'classes', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'title', type: 'text', maxLength: 80 }] }] },
    pages: [{ ref: 'classes', template: 'page-crud', title: { key: 't', fallback: 'Classes' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'classes' } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
    ...(lineage === null ? {} : { provenance: { lineage, savedAt: '2026-11-05T09:00:00Z', adminiumVersion: '0.3.49', label: 'Kiln Street' } }),
  };
}

interface Upload {
  statusCode: number;
  body: string;
  json: () => { route?: string; installs?: { connectionName: string; version: string; slug: string }[]; databasesFree?: number; error?: { code: string; message: string; details?: { reason?: string } } };
}

async function upload(h: Harness, manifest: Doc): Promise<Upload> {
  const tarball = packageTarball({ 'manifest.json': JSON.stringify(manifest), 'staff/index.html': '<!doctype html><html><body></body></html>' });
  const send = h.inject as unknown as (request: Doc) => Promise<{ statusCode: number; body: string }>;
  const reply = await send({
    method: 'POST',
    url: `/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  return { ...reply, json: () => JSON.parse(reply.body) as ReturnType<Upload['json']> };
}

let open: Harness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`where an uploaded file goes — ${dialect}`, () => {
    it('says install, then install-another, then update; and refuses an older version, saying where the newer one is', async () => {
      const h = (open = await installHarness(dialect));
      const first = await upload(h, pottery('1.0.0'));
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({ route: 'install', installs: [], databasesFree: 1 });
      const installed = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'pottery', version: '1.0.0', connectionId: h.connectionId } });
      expect(installed.statusCode, installed.body).toBe(200);

      // The same file again: a copy for another database, when there is one.
      const again = await upload(h, pottery('1.0.0'));
      expect(again.json()).toMatchObject({ route: 'install-another', databasesFree: 0, installs: [{ version: '1.0.0', slug: '' }] });
      await h.otherConnection('Archive');
      expect((await upload(h, pottery('1.0.0'))).json()).toMatchObject({ route: 'install-another', databasesFree: 1 });

      // A newer one updates the copies.
      expect((await upload(h, pottery('1.1.0'))).json()).toMatchObject({ route: 'update', installs: [{ version: '1.0.0' }] });
      const updated = await h.inject({ method: 'POST', url: '/apps/pottery/update', payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);

      // An older one is refused at the upload, with the database that has the newer.
      const older = await upload(h, pottery('1.0.5'));
      expect(older.statusCode, older.body).toBe(422);
      expect(older.json().error?.details?.reason).toBe('VERSION_OLDER');
      expect(older.json().error?.message).toMatch(/is older than what is installed: .+ already has 1\.1\.0\./);
    });

    it('refuses an older version installed over a newer copy, though its package is on the server', async () => {
      const h = (open = await installHarness(dialect));
      // Both on the server before anything is installed: nothing refuses the older one yet.
      expect((await upload(h, pottery('1.0.0'))).statusCode).toBe(200);
      expect((await upload(h, pottery('1.1.0'))).statusCode).toBe(200);
      const newer = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'pottery', version: '1.1.0', connectionId: h.connectionId } });
      expect(newer.statusCode, newer.body).toBe(200);
      const older = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'pottery', version: '1.0.0', connectionId: h.connectionId } });
      expect(older.statusCode, older.body).toBe(422);
      expect(older.body).toContain('VERSION_OLDER');
    });

    it('keeps a freed plain address free until an install asks for it', async () => {
      const h = (open = await installHarness(dialect));
      expect((await h.install(pottery('1.0.0'))).statusCode).toBe(200);
      const archive = await h.otherConnection('Archive');
      const third = await h.otherConnection('Third');
      const on = (connectionId: string, extra: Doc = {}) => h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'pottery', version: '1.0.0', connectionId, ...extra } });
      expect((await on(archive.id)).statusCode).toBe(200);
      const slugs = async () => (await manifestsRepo(h.meta, { encrypt: (v) => v, decrypt: (v) => v }).listByKey('pottery')).map((one) => [one.row.scopeKey, one.row.instanceSlug]).sort();

      // The first copy goes: its plain addresses go with it, to nobody.
      const gone = await h.inject({ method: 'DELETE', url: `/apps/pottery?connectionId=${h.connectionId}`, payload: { dropTables: false } });
      expect(gone.statusCode, gone.body).toBe(200);
      expect(await slugs()).toEqual([[archive.id, 'archive']]);
      // Asked for, they are this copy's; asked for again, they are taken.
      const taking = await on(third.id, { bareAddress: true });
      expect(taking.statusCode, taking.body).toBe(200);
      expect(await slugs()).toEqual([[archive.id, 'archive'], [third.id, '']].sort());
      const again = await on(h.connectionId, { bareAddress: true });
      expect(again.statusCode, again.body).toBe(409);
      expect(again.body).toContain('BARE_ADDRESS_TAKEN');
      // Not asked for, an install on a database takes its own.
      expect((await on(h.connectionId)).statusCode).toBe(200);
      expect((await slugs()).find(([scope]) => scope === h.connectionId)?.[1]).not.toBe('');
    });

    it('refuses another dashboard’s app under the same key, on any database, at the upload and at the update', async () => {
      const h = (open = await installHarness(dialect));
      expect((await h.install(pottery('1.0.0'))).statusCode).toBe(200);
      await h.otherConnection('Archive');

      for (const lineage of ['another-dashboard-02', null]) {
        const other = await upload(h, pottery('1.2.0', lineage));
        expect(other.statusCode, other.body).toBe(422);
        expect(other.json().error?.details?.reason).toBe('LINEAGE_DIFFERS');
        expect(other.json().error?.message).toMatch(/^This server already has a different pottery, on .+\. Save this one with another key\.$/);
      }
      // The same dashboard's next version is an update.
      expect((await upload(h, pottery('1.2.0'))).json()).toMatchObject({ route: 'update' });
    });
  });
}
