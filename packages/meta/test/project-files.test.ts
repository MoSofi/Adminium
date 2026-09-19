// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0034 — `adminium_project_files`, one row per project file with the
 * hash this instance last applied and whether its own copy moved since.
 *
 * Runs on every available engine: `str(n)` is only a real width on
 * PostgreSQL and MySQL, so a full-width path and hash are written there too.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  connectionsRepo,
  MetaValidationError,
  overridesRepo,
  pagesRepo,
  PROJECT_FILE_DELETED,
  projectFilesRepo,
  type DsnCrypto,
} from '../src/index.js';
import { TEST_DIALECTS, migrateOnly, useMetaDb } from './helpers/db.js';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`project files [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);

    const repo = () => projectFilesRepo(meta());

    it('records a version, then replaces it and clears the flags', async () => {
      await repo().record('pages/customers.json', HASH, 1000);
      expect(await repo().find('pages/customers.json')).toEqual({
        path: 'pages/customers.json',
        hash: HASH,
        appliedAt: 1000,
        serverEditedAt: null,
        serverHash: null,
      });

      await repo().flagServerEdit('pages/customers.json', OTHER, 2000);
      await repo().record('pages/customers.json', OTHER, 3000);
      expect(await repo().find('pages/customers.json')).toMatchObject({
        hash: OTHER,
        appliedAt: 3000,
        serverEditedAt: null,
        serverHash: null,
      });
    });

    it('keeps the first time a server edit was noticed, and the latest copy', async () => {
      await repo().record('schema/main.json', HASH, 1000);
      await repo().flagServerEdit('schema/main.json', OTHER, 2000);
      await repo().flagServerEdit('schema/main.json', PROJECT_FILE_DELETED, 5000);
      expect(await repo().find('schema/main.json')).toMatchObject({
        hash: HASH,
        serverEditedAt: 2000,
        serverHash: PROJECT_FILE_DELETED,
      });

      await repo().clearServerEdit('schema/main.json');
      expect(await repo().find('schema/main.json')).toMatchObject({ serverEditedAt: null, serverHash: null });
    });

    it('flags a path it has never recorded with an empty version', async () => {
      await repo().flagServerEdit('pages/orders.json', OTHER, 4000);
      expect(await repo().find('pages/orders.json')).toEqual({
        path: 'pages/orders.json',
        hash: '',
        appliedAt: 4000,
        serverEditedAt: 4000,
        serverHash: OTHER,
      });
    });

    it('lists rows by path and removes one', async () => {
      await repo().record('schema/main.json', HASH);
      await repo().record('pages/b.json', HASH);
      await repo().record('pages/a.json', HASH);
      expect((await repo().list()).map((row) => row.path)).toEqual([
        'pages/a.json',
        'pages/b.json',
        'schema/main.json',
      ]);
      expect(await repo().remove('pages/b.json')).toBe(true);
      expect(await repo().remove('pages/b.json')).toBe(false);
      expect(await repo().find('pages/b.json')).toBeNull();
    });

    it('stores a path and hashes of the full column width', async () => {
      const path = `schema/${'k'.repeat(188)}.json`;
      expect(path).toHaveLength(200);
      await repo().record(path, 'h'.repeat(80), 1);
      await repo().flagServerEdit(path, 's'.repeat(80), 2);
      expect(await repo().find(path)).toMatchObject({ hash: 'h'.repeat(80), serverHash: 's'.repeat(80) });
    });

    it('refuses a path that could leave the project, or is too long', async () => {
      for (const path of ['', '../secrets.json', 'pages/../x.json', '/abs.json', 'pages\\a.json', `p/${'x'.repeat(199)}`]) {
        await expect(repo().record(path, HASH)).rejects.toBeInstanceOf(MetaValidationError);
      }
      await expect(repo().record('pages/a.json', 'x'.repeat(81))).rejects.toBeInstanceOf(MetaValidationError);
    });
  });
}

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`writing what project files describe [${dialect.name}]`, () => {
    const meta = useMetaDb(dialect, migrateOnly);
    let connectionId: string;

    beforeEach(async () => {
      const connection = await connectionsRepo(meta(), testCrypto).create({
        name: 'main',
        engine: 'sqlite',
        introspectDsn: 'sqlite:./shop.db',
        projectKey: 'main',
      });
      connectionId = connection.id;
    });

    const page = (overrides: Record<string, unknown> = {}) => ({
      id: 'page_0123abcd_customers',
      connectionId,
      slug: 'customers',
      type: 'page-crud',
      title: 'Customers',
      icon: 'users',
      navGroup: 'library',
      navOrder: 20,
      config: { v: 1, title: { fallback: 'Customers' } },
      origin: 'generated' as const,
      isEnabled: true,
      ...overrides,
    });

    it('inserts a page, then replaces every column the file decides', async () => {
      const created = await pagesRepo(meta()).putFromProject(page(), 1000);
      expect(created).toMatchObject({ id: 'page_0123abcd_customers', revision: 1, createdAt: 1000, isEnabled: true });

      const updated = await pagesRepo(meta()).putFromProject(
        page({ title: 'Clients', navGroup: null, navOrder: 3, isEnabled: false, origin: 'user', config: { v: 1, x: [1] } }),
        2000,
      );
      expect(updated).toMatchObject({
        title: 'Clients',
        navGroup: null,
        navOrder: 3,
        isEnabled: false,
        origin: 'user',
        config: { v: 1, x: [1] },
        revision: 2,
        createdAt: 1000,
        updatedAt: 2000,
      });
    });

    it('refuses an origin a file cannot have, and an id that does not fit', async () => {
      await expect(pagesRepo(meta()).putFromProject(page({ origin: 'imported' }))).rejects.toBeInstanceOf(MetaValidationError);
      await expect(pagesRepo(meta()).putFromProject(page({ id: 'p'.repeat(37) }))).rejects.toBeInstanceOf(MetaValidationError);
    });

    it('keeps a page of code with an id of the full 36 characters, and lists every document by slug', async () => {
      // A page of code is `page_proj_` and at most 26 characters of its address.
      const codeId = `page_proj_${'a'.repeat(26)}`;
      expect(codeId).toHaveLength(36);
      const pages = pagesRepo(meta());
      await pages.putFromProject(page({ id: codeId, slug: 'a'.repeat(26), type: 'project-page', origin: 'project' }), 1000);
      await pages.putFromProject(page({ id: 'page_0123abcd_orders', slug: 'orders' }), 1000);
      await pages.putFromProject(page(), 1000);

      const documents = await pages.listDocuments();
      expect(documents.map((row) => [row.slug, row.id, row.origin])).toEqual([
        ['a'.repeat(26), codeId, 'project'],
        ['customers', 'page_0123abcd_customers', 'generated'],
        ['orders', 'page_0123abcd_orders', 'generated'],
      ]);
      expect(documents[1]?.config).toEqual({ v: 1, title: { fallback: 'Customers' } });
    });

    it('replaces the user and llm rows, and keeps the auto rows', async () => {
      const overrides = overridesRepo(meta());
      await overrides.create({ connectionId, op: 'column.pii', origin: 'auto', tableName: 'main.customers', columnName: 'email', value: { masked: true } }, 10);
      await overrides.create({ connectionId, op: 'table.label', tableName: 'main.customers', value: { label: 'Old' } }, 20);

      await overrides.replaceProjectRows(
        connectionId,
        [
          { op: 'table.label', tableName: 'main.customers', value: { label: 'Clients' }, origin: 'user', status: 'active' },
          { op: 'llm.label', tableName: 'main.orders', value: { en_US: 'Sales' }, origin: 'llm', status: 'disabled', confidence: 0.75 },
          { op: 'llm.pii', tableName: 'main.orders', columnName: 'note', value: null, origin: 'llm', status: 'active' },
        ],
        30,
      );

      const rows = await overrides.listForConnection(connectionId);
      expect(rows.map((row) => [row.op, row.origin, row.status, row.value, row.confidence, row.llmRunId])).toEqual([
        ['column.pii', 'auto', 'active', { masked: true }, null, null],
        ['table.label', 'user', 'active', { label: 'Clients' }, null, null],
        ['llm.label', 'llm', 'disabled', { en_US: 'Sales' }, 0.75, null],
        ['llm.pii', 'llm', 'active', null, null, null],
      ]);
    });

    it('checks every row before writing any', async () => {
      const overrides = overridesRepo(meta());
      await overrides.create({ connectionId, op: 'table.label', tableName: 'main.customers', value: { label: 'Kept' } });
      const bad = [
        [{ op: 'table.label', tableName: 'main.customers', value: { label: '' }, origin: 'user', status: 'active' }],
        [{ op: 'column.hidden', tableName: 'main.customers', value: { hidden: true }, origin: 'user', status: 'active' }],
        [{ op: 'llm.label', tableName: 'main.customers', value: { en_US: 'x' }, origin: 'user', status: 'active' }],
        [{ op: 'llm.pii', tableName: 'main.customers', value: { masked: true }, origin: 'llm', status: 'active' }],
        [{ op: 'llm.nope', tableName: 'main.customers', value: {}, origin: 'llm', status: 'active' }],
        [{ op: 'table.label', tableName: 'main.customers', value: { label: 'X' }, origin: 'user', status: 'paused' }],
      ] as const;
      for (const rows of bad) {
        await expect(overrides.replaceProjectRows(connectionId, rows as never)).rejects.toBeInstanceOf(MetaValidationError);
      }
      expect((await overrides.listForConnection(connectionId)).map((row) => row.value)).toEqual([{ label: 'Kept' }]);
    });
  });
}
