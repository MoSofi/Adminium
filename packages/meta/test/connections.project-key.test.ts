// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0033 — `adminium_connections.project_key`, the name a project's config
 * gives a database. One key names at most one connection; connections outside
 * a project carry none, and any number of them may.
 */

import { describe, expect, it } from 'vitest';

import { connectionsRepo, type DsnCrypto } from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`connection project key [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);


    const repo = () => connectionsRepo(meta(), testCrypto);
    const base = { name: 'src', engine: 'postgres' as const, introspectDsn: 'postgres://ro:s@db/prod' };

    it('stores the key given at create and finds the connection by it', async () => {
      const created = await repo().create({ ...base, projectKey: 'main' });
      expect(created.projectKey).toBe('main');
      expect((await repo().findByProjectKey('main'))?.id).toBe(created.id);
      expect(await repo().findByProjectKey('other')).toBeNull();
    });

    it('leaves a connection created without one outside every project', async () => {
      const created = await repo().create({ ...base });
      expect(created.projectKey).toBeNull();
      expect((await repo().list())[0]?.projectKey).toBeNull();
    });

    it('lets any number of connections have no key', async () => {
      await repo().create({ ...base });
      await repo().create({ ...base, name: 'second' });
      expect(await repo().list()).toHaveLength(2);
    });

    it('refuses a key another connection already holds', async () => {
      await repo().create({ ...base, projectKey: 'main' });
      await expect(repo().create({ ...base, name: 'twin', projectKey: 'main' })).rejects.toThrow();
      const other = await repo().create({ ...base, name: 'other' });
      await expect(repo().setProjectKey(other.id, 'main')).rejects.toThrow();
    });

    it('sets and clears a key on an existing connection', async () => {
      const created = await repo().create({ ...base });
      expect((await repo().setProjectKey(created.id, 'reports'))?.projectKey).toBe('reports');
      expect((await repo().findByProjectKey('reports'))?.id).toBe(created.id);
      expect((await repo().setProjectKey(created.id, null))?.projectKey).toBeNull();
      expect(await repo().findByProjectKey('reports')).toBeNull();
    });

    it('keeps a key of the full 48 characters intact', async () => {
      // SQLite ignores varchar widths, so this only bites on the other two.
      const longest = `k${'a'.repeat(47)}`;
      const created = await repo().create({ ...base, projectKey: longest });
      expect((await repo().findByProjectKey(longest))?.id).toBe(created.id);
    });
  });
}
