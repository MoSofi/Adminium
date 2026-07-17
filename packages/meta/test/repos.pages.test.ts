import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MetaValidationError,
  connectionsRepo,
  firstRun,
  pagesRepo,
  type DsnCrypto,
  type GeneratedPageInput,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

function crudPage(slug: string, overrides: Partial<GeneratedPageInput> = {}): GeneratedPageInput {
  return {
    id: `page_${slug}`,
    slug,
    type: 'page-crud',
    title: slug.charAt(0).toUpperCase() + slug.slice(1),
    icon: 'table',
    navGroup: 'library',
    navOrder: 20,
    config: { v: 1, kind: 'page', id: `page_${slug}`, config: { generatedHash: 'h1' } },
    ...overrides,
  };
}

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`pagesRepo [${dialect.name}]`, () => {
    let t: TestDb;
    let connectionId: string;

    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
      const connection = await connectionsRepo(t.meta, testCrypto).create({
        name: 'northwind',
        engine: 'postgres',
        introspectDsn: 'postgres://ro@localhost/northwind',
      });
      connectionId = connection.id;
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upsertGenerated inserts, is idempotent, and bumps revision on change', async () => {
      const repo = pagesRepo(t.meta);
      const first = await repo.upsertGenerated(connectionId, [crudPage('customers'), crudPage('orders')], {
        at: 1_000,
      });
      expect(first).toMatchObject({ created: 2, updated: 0, unchanged: 0, pruned: 0 });

      // Same set again → pure no-op, timestamps untouched.
      const again = await repo.upsertGenerated(connectionId, [crudPage('customers'), crudPage('orders')], {
        at: 2_000,
      });
      expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2, pruned: 0 });
      const customers = await repo.findBySlug(connectionId, 'customers');
      expect(customers?.revision).toBe(1);
      expect(customers?.updatedAt).toBe(1_000);
      expect(customers?.origin).toBe('generated');

      // Changed config → revision bump + new updatedAt.
      const changed = crudPage('customers', {
        config: { v: 1, kind: 'page', id: 'page_customers', config: { generatedHash: 'h2' } },
      });
      const third = await repo.upsertGenerated(connectionId, [changed, crudPage('orders')], { at: 3_000 });
      expect(third).toMatchObject({ created: 0, updated: 1, unchanged: 1, pruned: 0 });
      const bumped = await repo.findBySlug(connectionId, 'customers');
      expect(bumped?.revision).toBe(2);
      expect(bumped?.updatedAt).toBe(3_000);
    });

    it('prunes generated rows missing from the new set, never user pages', async () => {
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(connectionId, [crudPage('customers'), crudPage('legacy')], { at: 1_000 });
      await repo.create({
        connectionId,
        slug: 'my-view',
        type: 'page-crud',
        title: 'My View',
        config: { v: 1 },
        origin: 'user',
      });

      const result = await repo.upsertGenerated(connectionId, [crudPage('customers')], { at: 2_000 });
      expect(result.pruned).toBe(1);
      expect(await repo.findBySlug(connectionId, 'legacy')).toBeNull();
      expect(await repo.findBySlug(connectionId, 'my-view')).not.toBeNull();
    });

    it('never overwrites a non-generated page that claimed the same id', async () => {
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(connectionId, [crudPage('customers')], { at: 1_000 });
      // Simulate the user taking ownership of the page (M5 flow).
      await t.meta.db
        .updateTable('adminium_pages')
        .set({ origin: 'user', title: 'Curated Customers' })
        .where('id', '=', 'page_customers')
        .execute();

      const result = await repo.upsertGenerated(connectionId, [crudPage('customers')], { at: 2_000 });
      expect(result.preserved).toEqual(['page_customers']);
      expect(result.pruned).toBe(0);
      const row = await repo.findById('page_customers');
      expect(row?.title).toBe('Curated Customers');
      expect(row?.origin).toBe('user');
    });

    // Stand-in for the engine's hashEnvelope: same contract (canonical value,
    // embedded config.generatedHash excluded), no crypto — the guard only ever
    // compares this function's own outputs.
    const testHash = (envelope: Record<string, unknown>): string => {
      const clone = JSON.parse(JSON.stringify(envelope)) as { config?: Record<string, unknown> };
      if (clone.config !== undefined) delete clone.config['generatedHash'];
      return `th:${JSON.stringify(clone)}`;
    };
    const stamped = (slug: string, marker: string): GeneratedPageInput => {
      const envelope: Record<string, unknown> = {
        v: 1,
        kind: 'page',
        id: `page_${slug}`,
        config: { marker },
      };
      (envelope['config'] as Record<string, unknown>)['generatedHash'] = testHash(envelope);
      return crudPage(slug, { config: envelope });
    };

    it('upsertGenerated armed with hashEnvelope skips human-edited rows (user delta wins)', async () => {
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(
        connectionId,
        [stamped('customers', 'v1'), stamped('orders', 'v1')],
        { at: 1_000, hashEnvelope: testHash },
      );

      // A human edit through the production path: setLayout changes the stored
      // document but deliberately leaves the embedded hash stale.
      await repo.setLayout('page_customers', { version: 1, items: [] }, 2_000);

      const result = await repo.upsertGenerated(
        connectionId,
        [stamped('customers', 'v2'), stamped('orders', 'v2')],
        { at: 3_000, hashEnvelope: testHash },
      );
      expect(result).toMatchObject({ updated: 1, skippedEdited: ['page_customers'], pruned: 0 });

      // The edited document survived byte-for-byte; the untouched sibling moved.
      const kept = await repo.findById('page_customers');
      const keptConfig = (kept?.config as { config: Record<string, unknown> }).config;
      expect(keptConfig['marker']).toBe('v1');
      expect(keptConfig['layout']).toEqual({ version: 1, items: [] });
      const moved = await repo.findById('page_orders');
      expect((moved?.config as { config: Record<string, unknown> }).config['marker']).toBe('v2');

      // Unarmed (no hashEnvelope) keeps the pre-M5 overwrite semantics.
      const unarmed = await repo.upsertGenerated(
        connectionId,
        [stamped('customers', 'v3'), stamped('orders', 'v2')],
        { at: 4_000 },
      );
      expect(unarmed).toMatchObject({ updated: 1, unchanged: 1, skippedEdited: [] });
    });

    it('setLayout bumps revision — a human edit is a tracked change', async () => {
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(connectionId, [crudPage('customers')], { at: 1_000 });
      const updated = await repo.setLayout('page_customers', { version: 1, items: [] }, 2_000);
      expect(updated?.revision).toBe(2);
      expect(updated?.updatedAt).toBe(2_000);
    });

    it('replaceConfig swaps the document, bumps revision, back-fills only a missing icon', async () => {
      const repo = pagesRepo(t.meta);
      const seeded = await repo.create({
        connectionId,
        slug: 'orders-queue',
        type: 'page-queue-inbox',
        title: 'Orders Queue',
        config: { source: { connectionId, table: 'public.orders' }, llmRunId: 'run_1' },
        origin: 'llm',
      });

      const envelope = { v: 1, kind: 'page', id: seeded.id, config: { generatedHash: 'g' } };
      const materialized = await repo.replaceConfig(seeded.id, envelope, { icon: 'inbox', at: 9_000 });
      expect(materialized).toMatchObject({ config: envelope, revision: 2, icon: 'inbox', updatedAt: 9_000 });

      // An icon the row already has is never clobbered.
      const again = await repo.replaceConfig(seeded.id, envelope, { icon: 'table', at: 9_500 });
      expect(again?.icon).toBe('inbox');
      expect(again?.revision).toBe(3);
    });

    it('rejects duplicate ids and ids over char(36)', async () => {
      const repo = pagesRepo(t.meta);
      await expect(
        repo.upsertGenerated(connectionId, [crudPage('a'), crudPage('a')]),
      ).rejects.toBeInstanceOf(MetaValidationError);
      await expect(
        repo.upsertGenerated(connectionId, [
          crudPage('a-very-long-slug-that-goes-past-the-limit', {
            id: 'page_a-very-long-slug-that-goes-past-the-limit',
          }),
        ]),
      ).rejects.toBeInstanceOf(MetaValidationError);
    });

    it('navRows + configVersion feed the bootstrap projection', async () => {
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(
        connectionId,
        [
          crudPage('customers', { navOrder: 30 }),
          crudPage('dashboard', { type: 'page-dashboard', navGroup: 'workspace', navOrder: 10 }),
        ],
        { at: 5_000 },
      );
      const rows = await repo.navRows();
      expect(rows).toHaveLength(2);
      const dashboard = rows.find((r) => r.slug === 'dashboard');
      expect(dashboard?.navGroup).toBe('workspace');
      expect(dashboard?.navOrder).toBe(10);
      // Owning connection rides along (multi-connection nav labels, M5-T05).
      expect(dashboard?.connectionId).toBe(connectionId);
      expect(await repo.configVersion()).toBe(5_000);
    });

    it('countGeneratedByConnection groups generated rows, skipping user pages', async () => {
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(connectionId, [crudPage('customers'), crudPage('orders')]);
      // Non-generated origin on the same connection must not count.
      await repo.create({
        connectionId,
        slug: 'hand-made',
        type: 'page-crud',
        title: 'Hand made',
        config: { v: 1 },
        origin: 'user',
      });
      // Connection-less page (utility/system) never counts either.
      await repo.create({ slug: 'about', type: 'page-crud', title: 'About', config: { v: 1 } });

      expect(await repo.countGeneratedByConnection()).toEqual({ [connectionId]: 2 });
    });

    it('round-trips config JSON and lists pages in nav order', async () => {
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(connectionId, [
        crudPage('zeta', { navOrder: 40 }),
        crudPage('alpha', { navOrder: 20 }),
      ]);
      const pages = await repo.listForConnection(connectionId);
      expect(pages.map((p) => p.slug)).toEqual(['alpha', 'zeta']);
      expect((pages[0]?.config as { config: { generatedHash: string } }).config.generatedHash).toBe('h1');
    });
  });
}
