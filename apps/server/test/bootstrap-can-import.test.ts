// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `canImport` OF THE SESSION BOOTSTRAP, against the whole server on SQLite,
 * Postgres and MySQL, each asked as the person it is about: whether the menu
 * offers "Import data" to them.
 *
 * Beside each answer stands what `POST /imports` itself says to the same
 * person for the same table, with a file that does not exist: `404` is a
 * request that passed every gate before the file is looked for, a `403` is
 * one a gate refused. The hint may say yes where the route says no for the
 * table chosen; it must not say no where the route would say yes.
 */
import { ALL_TABLES_REF, permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

// The server says the version it was built at; the words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const named = [id, { ref: 'name', type: 'text', maxLength: 120 }];

function stock(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'stock',
    name: 'Stock',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.stock.desc', fallback: 'Stock.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    modules: [
      { id: 'shelf', label: en('Shelves'), default: 'always' },
      { id: 'yard', label: en('Yard'), default: 'off' },
    ],
    navGroups: [{ key: 'stock', label: en('Stock'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'items', module: 'shelf', columns: named },
        { ref: 'crates', module: 'yard', columns: named },
      ],
    },
    roles: [
      { key: 'importer', name: 'Importer', modules: ['shelf'], permissions: ['table:@items:read', 'table:@items:import'] },
      { key: 'clerk', name: 'Clerk', modules: ['shelf'], permissions: ['table:@items:read', 'table:@items:create', 'table:@items:update'] },
      // A role of the shelves whose only import is on a table of the yard, a part that starts off.
      { key: 'packer', name: 'Packer', modules: ['shelf'], permissions: ['table:@items:read', 'table:@crates:read', 'table:@crates:import'] },
    ],
    pages: [{ ref: 'stock-items', template: 'page-crud', title: { key: 't.stock-items', fallback: 'Items' }, nav: { group: 'stock', icon: 'list', order: 1 }, bindings: { rows: 'items' }, module: 'shelf' }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { stock: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`whether the menu offers "Import data", on ${dialect}`, () => {
    let s: WholeServer;
    const canImport = async (who: string): Promise<unknown> => {
      const res = await s.get(who, '/api/v1/bootstrap');
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { canImport?: unknown } }).data.canImport;
    };
    /** What the route says to an import of a file that is not there: `404 NOT_FOUND` once every gate before the file is passed. */
    const route = async (who: string, ref: string): Promise<string> =>
      said(await s.send(who, 'POST', '/api/v1/imports', { fileId: 'no-such-file', connectionId: s.connectionId, table: s.t(ref), mapping: { columns: [] } }));
    const hold = async (who: string, slug: string): Promise<void> => {
      await rolesRepo(s.meta).assignToUser(s.ids[who]!, (await rolesRepo(s.meta).findBySlug(slug))!.id);
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, stock(), {
        people: { importer: ['importer'], clerk: ['clerk'], packer: ['packer'], admin: [], editor: [], wide: [], nobody: [] },
      });
      // The built-in roles hold their tables by the every-table wildcard.
      await hold('admin', 'admin');
      await hold('editor', 'editor');
      // A role an owner made, with a wildcard over one connection's tables.
      const wide = await rolesRepo(s.meta).create({ slug: 'wide', name: 'Wide' });
      await permissionsRepo(s.meta).grant(wide.id, 'table', `${s.connectionId}/*`, { read: false, create: false, update: false, delete: false, export: false, import: true });
      await hold('wide', 'wide');
    }, 120_000);
    afterAll(async () => {
      await s?.close();
    });

    it('says yes to a Super Admin, and to a role that names the import on one table', async () => {
      expect(await canImport('owner')).toBe(true);
      expect(await route('owner', 'items')).toBe('404 NOT_FOUND');
      expect(await canImport('importer')).toBe(true);
      expect(await route('importer', 'items')).toBe('404 NOT_FOUND');
    });

    it('says yes to a wildcard that covers the import: every table, or every table of one connection', async () => {
      expect((await permissionsRepo(s.meta).listForRole((await rolesRepo(s.meta).findBySlug('admin'))!.id)).map((row) => row.resourceRef)).toContain(ALL_TABLES_REF);
      expect(await canImport('admin')).toBe(true);
      expect(await route('admin', 'items')).toBe('404 NOT_FOUND');
      expect(await canImport('wide')).toBe(true);
      expect(await route('wide', 'items')).toBe('404 NOT_FOUND');
    });

    it('says no to a role that reads, creates and updates and imports nothing, and to a person with no role', async () => {
      expect(await canImport('clerk')).toBe(false);
      expect(await route('clerk', 'items')).toBe('403 TABLE_FORBIDDEN');
      // The built-in Editor: every table, and no import.
      expect(await canImport('editor')).toBe(false);
      expect(await route('editor', 'items')).toBe('403 TABLE_FORBIDDEN');
      expect(await canImport('nobody')).toBe(false);
      expect(await route('nobody', 'items')).toBe('403 TABLE_FORBIDDEN');
    });

    it('says no while the only import held is on a table of a part that is off, and yes once the part is on', async () => {
      expect(await route('packer', 'crates')).toBe('403 TABLE_FORBIDDEN');
      expect(await canImport('packer')).toBe(false);
      const flip = (on: boolean) => s.send('owner', 'PUT', '/api/v1/apps/stock/parts/yard', { on });
      expect(said(await flip(true))).toBe('ok');
      expect(await route('packer', 'crates')).toBe('404 NOT_FOUND');
      expect(await canImport('packer')).toBe(true);
      expect(said(await flip(false))).toBe('ok');
      expect(await canImport('packer')).toBe(false);
    });

    it('says no to everybody while the only connection is read-only, as the route does', async () => {
      await s.manager.connections.update(s.connectionId, { readOnly: true });
      expect(await route('importer', 'items')).toBe('403 READ_ONLY_MODE');
      expect(await route('owner', 'items')).toBe('403 READ_ONLY_MODE');
      for (const who of ['owner', 'importer', 'admin', 'wide']) expect(await canImport(who), who).toBe(false);
      await s.manager.connections.update(s.connectionId, { readOnly: false });
      expect(await canImport('importer')).toBe(true);
    });

    it('says no to everybody while the only connection is paused', async () => {
      await s.manager.connections.setDisabled(s.connectionId, true);
      // The route still reads the file against the table: it is the run, which writes the rows, that a pause refuses. No file comes in, so the menu says no.
      expect(await route('importer', 'items')).toBe('404 NOT_FOUND');
      for (const who of ['owner', 'importer', 'admin', 'wide']) expect(await canImport(who), who).toBe(false);
      await s.manager.connections.setDisabled(s.connectionId, false);
      for (const who of ['owner', 'importer', 'admin', 'wide']) expect(await canImport(who), who).toBe(true);
    });
  });
}
