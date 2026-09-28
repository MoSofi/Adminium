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
 */
import type { AddOnManifest } from '@adminium/manifest';
import { manifestsRepo, type MetaDb } from '@adminium/meta';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { upgradeRangeRefusal } from '../src/add-ons/install.js';
import { appNeedRows } from '../src/add-ons/needs.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

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
      let pad = 350_000;
      if (meta.dialect === 'mysql') {
        const buffer = await sql<{ size: number | string }>`select @@sort_buffer_size as size`.execute(meta.db);
        pad = Math.max(pad, Number(buffer.rows[0]?.size ?? 0) + 100_000);
      }
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
