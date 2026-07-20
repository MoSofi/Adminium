import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  connectionsRepo,
  firstRun,
  pagesRepo,
  usersRepo,
  viewsRepo,
  type DsnCrypto,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

const gridConfig = (search: string) => ({ v: 1 as const, search, sort: null, filters: [], pageSize: 50 });

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`viewsRepo [${dialect.name}]`, () => {
    let t: TestDb;
    let pageId: string;
    let ava: string;
    let noah: string;

    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
      const connection = await connectionsRepo(t.meta, testCrypto).create({
        name: 'northwind',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/northwind',
      });
      const page = await pagesRepo(t.meta).create({
        connectionId: connection.id,
        slug: 'customers',
        type: 'page-crud',
        title: 'Customers',
        config: { v: 1, kind: 'page', id: 'page_customers', config: {} },
      });
      pageId = page.id;
      ava = (await usersRepo(t.meta).create({ email: 'ava@adminium.test', name: 'Ava' })).id;
      noah = (await usersRepo(t.meta).create({ email: 'noah@adminium.test', name: 'Noah' })).id;
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('creates and round-trips a view config verbatim', async () => {
      const repo = viewsRepo(t.meta);
      const config = gridConfig('acme');
      const view = await repo.create({ pageId, userId: ava, name: 'Acme', config });
      const fetched = await repo.findById(view.id);
      expect(fetched?.config).toEqual(config);
      expect(fetched?.userId).toBe(ava);
      expect(fetched?.isDefault).toBe(false);
    });

    it('scopes listForPageUser to own + shared views', async () => {
      const repo = viewsRepo(t.meta);
      await repo.create({ pageId, userId: ava, name: 'Ava private', config: gridConfig('a') });
      await repo.create({ pageId, userId: noah, name: 'Noah private', config: gridConfig('n') });
      await repo.create({ pageId, userId: null, name: 'Shared', config: gridConfig('s') });

      const forAva = await repo.listForPageUser(pageId, ava);
      expect(forAva.map((v) => v.name).sort()).toEqual(['Ava private', 'Shared']);

      const forNoah = await repo.listForPageUser(pageId, noah);
      expect(forNoah.map((v) => v.name).sort()).toEqual(['Noah private', 'Shared']);
    });

    it('finds by name only within the (page, user) scope', async () => {
      const repo = viewsRepo(t.meta);
      await repo.create({ pageId, userId: ava, name: 'Recent', config: gridConfig('a') });
      expect(await repo.findByName(pageId, ava, 'Recent')).not.toBeNull();
      // Same name, different owner is not a clash.
      expect(await repo.findByName(pageId, noah, 'Recent')).toBeNull();
    });

    it('keeps at most one default per (page, user) scope', async () => {
      const repo = viewsRepo(t.meta);
      const first = await repo.create({ pageId, userId: ava, name: 'First', config: gridConfig('a'), isDefault: true });
      const second = await repo.create({ pageId, userId: ava, name: 'Second', config: gridConfig('b'), isDefault: true });

      const list = await repo.listForPageUser(pageId, ava);
      const defaults = list.filter((v) => v.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]?.id).toBe(second.id);
      expect((await repo.findById(first.id))?.isDefault).toBe(false);
    });

    it("promoting a view via update clears the previous default", async () => {
      const repo = viewsRepo(t.meta);
      const first = await repo.create({ pageId, userId: ava, name: 'First', config: gridConfig('a'), isDefault: true });
      const second = await repo.create({ pageId, userId: ava, name: 'Second', config: gridConfig('b') });

      await repo.update(second.id, { isDefault: true });
      expect((await repo.findById(first.id))?.isDefault).toBe(false);
      expect((await repo.findById(second.id))?.isDefault).toBe(true);
    });

    it('updates name + config and deletes', async () => {
      const repo = viewsRepo(t.meta);
      const view = await repo.create({ pageId, userId: ava, name: 'Old', config: gridConfig('a') });
      const updated = await repo.update(view.id, { name: 'New', config: gridConfig('z') });
      expect(updated?.name).toBe('New');
      expect(updated?.config).toEqual(gridConfig('z'));

      expect(await repo.delete(view.id)).toBe(true);
      expect(await repo.findById(view.id)).toBeNull();
    });

    it('cascades views when the owning user or parent page row is deleted (real meta-internal FK)', async () => {
      const repo = viewsRepo(t.meta);
      const mine = await repo.create({ pageId, userId: ava, name: 'Mine', config: gridConfig('m') });
      const shared = await repo.create({ pageId, userId: null, name: 'Shared', config: gridConfig('s') });

      // views.user_id FK: the owner's views go, shared (user_id NULL) views stay.
      await t.meta.db.deleteFrom('adminium_users').where('id', '=', ava).execute();
      expect(await repo.findById(mine.id)).toBeNull();
      expect(await repo.findById(shared.id)).not.toBeNull();

      // views.page_id FK: deleting the page takes the remaining views with it.
      await t.meta.db.deleteFrom('adminium_pages').where('id', '=', pageId).execute();
      expect(await repo.findById(shared.id)).toBeNull();
    });

    // --- dashboard layout overrides (kind: 'layout') ------------------------

    const layoutConfig = (id: string) => ({
      version: 1 as const,
      items: [{ i: id, widget: 'kpi-stat-card', x: 0, y: 0, w: 4, h: 3, config: {} }],
    });

    it('upserts, reads, and deletes a per-user layout override', async () => {
      const repo = viewsRepo(t.meta);
      expect(await repo.findLayoutOverride(pageId, ava)).toBeNull();

      const first = await repo.upsertLayoutOverride(pageId, ava, layoutConfig('a'));
      expect(first.kind).toBe('layout');
      expect((await repo.findLayoutOverride(pageId, ava))?.config).toEqual(layoutConfig('a'));

      // A second upsert replaces the single row rather than inserting another.
      const second = await repo.upsertLayoutOverride(pageId, ava, layoutConfig('b'));
      expect(second.id).toBe(first.id);
      expect((await repo.findLayoutOverride(pageId, ava))?.config).toEqual(layoutConfig('b'));

      expect(await repo.deleteLayoutOverride(pageId, ava)).toBe(true);
      expect(await repo.findLayoutOverride(pageId, ava)).toBeNull();
    });

    it('keeps layout overrides out of the saved-filter listing (kind-scoped)', async () => {
      const repo = viewsRepo(t.meta);
      await repo.create({ pageId, userId: ava, name: 'Filter', config: gridConfig('a') });
      await repo.upsertLayoutOverride(pageId, ava, layoutConfig('a'));

      const list = await repo.listForPageUser(pageId, ava);
      expect(list.map((v) => v.name)).toEqual(['Filter']);
      expect(list.every((v) => v.kind === 'filters')).toBe(true);
    });

    it('scopes layout overrides per user', async () => {
      const repo = viewsRepo(t.meta);
      await repo.upsertLayoutOverride(pageId, ava, layoutConfig('ava'));
      expect(await repo.findLayoutOverride(pageId, noah)).toBeNull();
      expect((await repo.findLayoutOverride(pageId, ava))?.config).toEqual(layoutConfig('ava'));
    });
  });
}
