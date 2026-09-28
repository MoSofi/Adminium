// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The server's own sorted reads of installed apps, over manifests larger than
 * MySQL's sort buffer.
 *
 * Client Portal 0.2.1 stores about 350 KB of manifest, and MySQL's default
 * sort buffer is 256 KB. A read that sorted whole rows answered "Out of sort
 * memory" once such an app was installed beside another, which took down the
 * apps list, an add-on's update check and, after a restart, every app served.
 * The mysql leg is the one that proves it; the others hold the order.
 *
 * The second half boots the whole server over each meta store and signs in:
 * the dashboard's own load (`/bootstrap`), the apps list, the add-ons list
 * and the jobs list all answer with one large app, one large dashboard add-on
 * and one large queued job.
 */
import { readFileSync } from 'node:fs';

import type { AddOnManifest } from '@adminium/manifest';
import { createFirstSuperAdmin, jobsRepo, manifestsRepo, type MetaDb } from '@adminium/meta';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upgradeRangeRefusal } from '../src/add-ons/install.js';
import { appNeedRows } from '../src/add-ons/needs.js';
import type { AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { dashboardAddOnManifests, installedAppManifests } from '../src/routes/bootstrap/handlers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

/** A manifest this many bytes larger than the store's sort buffer (MySQL), or Client Portal's size. */
async function padFor(meta: MetaDb): Promise<number> {
  if (meta.dialect !== 'mysql') return 350_000;
  const buffer = await sql<{ size: number | string }>`select @@sort_buffer_size as size`.execute(meta.db);
  return Math.max(350_000, Number(buffer.rows[0]?.size ?? 0) + 100_000);
}

const crypto = {
  encrypt: (v: string) => `enc:${Buffer.from(v, 'utf8').toString('base64')}`,
  decrypt: (v: string) => Buffer.from(v.slice(4), 'base64').toString('utf8'),
};

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`installed apps with large manifests [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;

    beforeAll(async () => {
      handle = await engine.make();
      meta = handle.meta;
      const pad = await padFor(meta);
      const repo = manifestsRepo(meta, crypto);
      // Installed out of key order, so the key order has to come from the read.
      for (const [i, key] of ['pos', 'clients', 'clinic'].entries()) {
        await repo.install(
          {
            manifestKey: key,
            version: '1.0.0',
            kind: 'app',
            source: 'file',
            document: {
              key,
              name: `App ${key}`,
              version: '1.0.0',
              requiredSchema: { tables: [{ ref: `${key}_invoices`, builtOn: 'invoices/invoice@1' }] },
              pad: 'x'.repeat(pad),
            },
          },
          1_750_000_000_000 + i,
        );
      }
    }, 60_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    it('lists every app by key, names read from their manifests', async () => {
      const rows = await appNeedRows(meta);
      expect(rows.map((row) => [row.app, row.appName])).toEqual([
        ['clients', 'App clients'],
        ['clinic', 'App clinic'],
        ['pos', 'App pos'],
      ]);
    });

    it('names the first app by key that an add-on update would leave without its shape', async () => {
      const addOn = { key: 'invoices', name: 'Invoices', version: '2.0.0', addOn: { shapes: [] } } as unknown as AddOnManifest;
      const refusal = await upgradeRangeRefusal({ meta, credentialCrypto: crypto }, addOn, []);
      expect(refusal?.code).toBe('ADD_ON_SHAPE_IN_USE');
      expect(refusal?.details).toMatchObject({ app: 'clients', shape: 'invoices/invoice@1' });
    });
  });
}

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the dashboard over one large app and one large add-on [${engine.name}]`, () => {
    let handle: MetaHandle;
    let app: AdminiumServer;
    let cookie: string;

    beforeAll(async () => {
      handle = await engine.make();
      const meta = handle.meta;
      const pad = await padFor(meta);
      // ONE of each: MySQL filesorts even a single row once the kind and status filter has scanned.
      const repo = manifestsRepo(meta, crypto);
      await repo.install(
        {
          manifestKey: 'clients',
          version: '1.0.0',
          kind: 'app',
          source: 'file',
          document: { key: 'clients', name: 'Client Portal', version: '1.0.0', pad: 'x'.repeat(pad) },
        },
        1_750_000_000_000,
      );
      // The released Invoices add-on, its address lines' default grown past the buffer: a manifest the lists parse.
      const invoices = JSON.parse(readFileSync(new URL('../../../packages/manifest/test/fixtures/released/invoices-1.0.5.manifest.json', import.meta.url), 'utf8')) as {
        version: string;
        settings: { key: string; default?: unknown }[];
      };
      invoices.settings.find((setting) => setting.key === 'business_lines')!.default = ['x'.repeat(pad)];
      await repo.install(
        { manifestKey: 'invoices', version: invoices.version, kind: 'add-on', source: 'file', document: invoices, attachTo: ['dashboard'] },
        1_750_000_000_100,
      );
      await createFirstSuperAdmin(meta, { email: 'owner@example.com', name: 'Owner', passwordHash: await adminPasswordHash() });
      const store: MetaStoreHandle = { meta, url: `${engine.name}:test`, engine: engine.name, source: 'embedded', close: async () => Promise.resolve() };
      const runService = createRunService({ meta });
      const composed = await composeServer({
        env: makeEnv(),
        metaStore: store,
        manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
        runService,
        applyService: createApplyService({ meta, runService }),
        allowed: { templates: [], widgets: [], widgetContracts: {} },
        logger: false,
        telemetry: false,
        onMetaRelocated: () => undefined,
      });
      app = composed.app;
      await app.ready();
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'owner@example.com', password: ADMIN_PASSWORD },
      });
      expect(login.statusCode, login.body).toBe(200);
      cookie = sessionCookie(login.headers['set-cookie']);
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      await handle?.destroy();
    });

    it('reads the installed apps and the dashboard add-ons with their manifests', async () => {
      expect((await installedAppManifests(handle.meta)).map((row) => [row.manifestKey, row.version])).toEqual([['clients', '1.0.0']]);
      const addOns = await dashboardAddOnManifests(handle.meta);
      expect(addOns).toHaveLength(1);
    });

    it('loads the dashboard', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } });
      expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
      expect((res.json() as { data: { user: { email: string } } }).data.user.email).toBe('owner@example.com');
    });

    it('lists the jobs, one carrying a large payload', async () => {
      const job = await jobsRepo(handle.meta).enqueue({ kind: 'email-send', payload: { envelope: 'x'.repeat(await padFor(handle.meta)) }, runAt: 1_750_000_000_000 });
      const res = await app.inject({ method: 'GET', url: '/api/v1/jobs?limit=5', headers: { cookie } });
      expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
      expect((res.json() as { data: { id: string }[] }).data.map((row) => row.id)).toContain(job.id);
    });

    it('lists the apps and the add-ons', async () => {
      const apps = await app.inject({ method: 'GET', url: '/api/v1/apps', headers: { cookie } });
      expect(apps.statusCode, apps.body.slice(0, 500)).toBe(200);
      expect(apps.json().apps.map((row: { key: string }) => row.key)).toEqual(['clients']);
      const addOns = await app.inject({ method: 'GET', url: '/api/v1/add-ons', headers: { cookie } });
      expect(addOns.statusCode, addOns.body.slice(0, 500)).toBe(200);
      expect(addOns.json().addOns.map((row: { key: string }) => row.key)).toEqual(['invoices']);
    });
  });
}
