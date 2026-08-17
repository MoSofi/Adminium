import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MetaValidationError,
  connectionsRepo,
  firstRun,
  pagesRepo,
  snapshotsRepo,
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

    // Stand-in for the engine's hashEnvelope: same contract (canonical
    // SORTED-KEYS value — engine util.ts sortKeysDeep — with the embedded
    // config.generatedHash excluded), no crypto — the guard only ever compares
    // this function's own outputs. The sorting is load-bearing: pg `jsonb` and
    // mysql `json` do not preserve object key order, so an insertion-order
    // stringify flags every stored row as "edited" on those dialects.
    const sortKeysDeep = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sortKeysDeep);
      if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return Object.fromEntries(
          Object.keys(record)
            .sort()
            .map((k) => [k, sortKeysDeep(record[k])]),
        );
      }
      return value;
    };
    const testHash = (envelope: Record<string, unknown>): string => {
      const clone = JSON.parse(JSON.stringify(envelope)) as { config?: Record<string, unknown> };
      if (clone.config !== undefined) delete clone.config['generatedHash'];
      return `th:${JSON.stringify(sortKeysDeep(clone))}`;
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

    it('prune keeps human-edited orphans (user delta wins extends to deletion)', async () => {
      const repo = pagesRepo(t.meta);
      // Real snapshot rows — generatedFromSnapshotId is FK-constrained.
      const snapshots = snapshotsRepo(t.meta);
      const snap1 = (
        await snapshots.create({ connectionId, source: 'introspection', schema: { v: 1 }, checksum: 'c1' })
      ).snapshot.id;
      const snap2 = (
        await snapshots.create({ connectionId, source: 'introspection', schema: { v: 2 }, checksum: 'c2' })
      ).snapshot.id;
      await repo.upsertGenerated(
        connectionId,
        [stamped('customers', 'v1'), stamped('legacy', 'v1'), stamped('stale', 'v1')],
        { at: 1_000, hashEnvelope: testHash, snapshotId: snap1 },
      );
      // A human customizes `legacy`; `stale` stays byte-identical to its run.
      await repo.setLayout('page_legacy', { version: 1, items: [] }, 2_000);

      // Next run: the generator dropped both orphans (tables removed/hidden).
      const result = await repo.upsertGenerated(connectionId, [stamped('customers', 'v1')], {
        at: 3_000,
        hashEnvelope: testHash,
        snapshotId: snap2,
      });
      expect(result).toMatchObject({
        unchanged: 1,
        pruned: 1,
        keptEdited: ['page_legacy'],
        skippedEdited: [],
      });

      // The unedited orphan is gone; the edited one survived untouched:
      // origin still 'generated', still enabled, lineage + document intact.
      expect(await repo.findBySlug(connectionId, 'stale')).toBeNull();
      const kept = await repo.findById('page_legacy');
      expect(kept?.origin).toBe('generated');
      expect(kept?.isEnabled).toBe(true);
      expect(kept?.generatedFromSnapshotId).toBe(snap1);
      expect(kept?.updatedAt).toBe(2_000);
      const keptConfig = (kept?.config as { config: Record<string, unknown> }).config;
      expect(keptConfig['marker']).toBe('v1');
      expect(keptConfig['layout']).toEqual({ version: 1, items: [] });
    });

    it('prune=false leaves every orphan alone and reports no keptEdited', async () => {
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(
        connectionId,
        [stamped('customers', 'v1'), stamped('legacy', 'v1')],
        { at: 1_000, hashEnvelope: testHash },
      );
      await repo.setLayout('page_legacy', { version: 1, items: [] }, 2_000);

      const result = await repo.upsertGenerated(connectionId, [stamped('customers', 'v1')], {
        at: 3_000,
        prune: false,
        hashEnvelope: testHash,
      });
      expect(result).toMatchObject({ unchanged: 1, pruned: 0, keptEdited: [] });
      expect(await repo.findBySlug(connectionId, 'legacy')).not.toBeNull();
    });

    it('unarmed prune (no hashEnvelope) keeps the legacy behavior: edited orphans delete too', async () => {
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(
        connectionId,
        [stamped('customers', 'v1'), stamped('legacy', 'v1')],
        { at: 1_000, hashEnvelope: testHash },
      );
      await repo.setLayout('page_legacy', { version: 1, items: [] }, 2_000);

      const result = await repo.upsertGenerated(connectionId, [stamped('customers', 'v1')], {
        at: 3_000,
      });
      expect(result).toMatchObject({ pruned: 1, keptEdited: [] });
      expect(await repo.findBySlug(connectionId, 'legacy')).toBeNull();
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

    // --- page lifecycle (Studio → Pages, 08 §2.6) ---------------------------

    it('a user page holding a generated slug is reported, not thrown', async () => {
      // The bug this pins: upsertGenerated keys on ID but the unique index is
      // on (connection_id, slug). A user page that claimed `orders` before the
      // generator emitted it used to raise a driver UNIQUE violation INSIDE
      // the run's transaction, rolling the whole generation back — a permanent
      // 500 on POST /connections/:id/generate with no delete route to recover.
      const repo = pagesRepo(t.meta);
      await repo.create({
        connectionId,
        slug: 'orders',
        type: 'page-dashboard',
        title: 'My Orders',
        config: { v: 1 },
        origin: 'user',
      });

      const result = await repo.upsertGenerated(
        connectionId,
        [crudPage('customers'), crudPage('orders')],
        { at: 2_000 },
      );

      expect(result.blockedSlugs).toEqual([{ id: 'page_orders', slug: 'orders' }]);
      // The rest of the run still landed — one bad slug must not cost the batch.
      expect(result.created).toBe(1);
      expect(await repo.findBySlug(connectionId, 'customers')).not.toBeNull();
      // The user's page is untouched.
      const kept = await repo.findBySlug(connectionId, 'orders');
      expect(kept?.title).toBe('My Orders');
      expect(kept?.origin).toBe('user');
    });

    it('a slug freed by the same run is not a collision', async () => {
      // `legacy` is pruned in this very run, so a page renaming INTO it is a
      // hand-off, not a clash. Naively indexing every existing row would have
      // blocked it.
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(connectionId, [crudPage('legacy')], { at: 1_000 });

      const result = await repo.upsertGenerated(
        connectionId,
        [crudPage('reports', { id: 'page_reports', slug: 'legacy' })],
        { at: 2_000 },
      );

      expect(result.blockedSlugs).toEqual([]);
      expect(result.created).toBe(1);
      expect(result.pruned).toBe(1);
    });

    it('updateMeta writes the row AND the envelope so regeneration cannot revert it', async () => {
      const repo = pagesRepo(t.meta);
      const envelope: Record<string, unknown> = {
        v: 1,
        kind: 'page',
        id: 'page_customers',
        title: { key: 'nav.customers', fallback: 'Customers' },
        nav: { group: 'library', icon: 'table', order: 20 },
        config: { marker: 'a' },
      };
      (envelope['config'] as Record<string, unknown>)['generatedHash'] = testHash(envelope);
      await repo.upsertGenerated(connectionId, [crudPage('customers', { config: envelope })], {
        at: 1_000,
        hashEnvelope: testHash,
      });

      const updated = await repo.updateMeta(
        'page_customers',
        { title: 'Accounts', navGroup: 'workspace', navOrder: 3 },
        { at: 2_000 },
      );
      expect(updated).not.toBe('not-found');
      expect(updated).not.toBe('conflict');

      // Row projection — what the sidebar reads.
      const row = await repo.findById('page_customers');
      expect(row?.title).toBe('Accounts');
      expect(row?.navGroup).toBe('workspace');
      // Envelope mirror — what makes it durable.
      const stored = row?.config as {
        title: { key: string; fallback: string };
        nav: { group: string; order: number; icon: string };
        config: { generatedHash: string };
      };
      expect(stored.title).toEqual({ key: 'nav.customers', fallback: 'Accounts' });
      expect(stored.nav).toMatchObject({ group: 'workspace', order: 3, icon: 'table' });
      // The hash is deliberately NOT re-stamped — that staleness is the signal.
      expect(stored.config.generatedHash).toBe((envelope['config'] as { generatedHash: string }).generatedHash);

      // Now regenerate: the original document comes back, and must be skipped.
      const result = await repo.upsertGenerated(
        connectionId,
        [crudPage('customers', { config: envelope })],
        { at: 3_000, hashEnvelope: testHash },
      );
      expect(result.skippedEdited).toEqual(['page_customers']);
      expect((await repo.findById('page_customers'))?.title).toBe('Accounts');
    });

    it('updateMeta honours If-Match and reports a stale revision as a conflict', async () => {
      const repo = pagesRepo(t.meta);
      const page = await repo.create({
        connectionId,
        slug: 'notes',
        type: 'page-crud',
        title: 'Notes',
        config: { v: 1, nav: { group: 'library', icon: 'file', order: 1 } },
      });
      expect(await repo.updateMeta(page.id, { title: 'A' }, { expectedRevision: 99 })).toBe('conflict');
      expect((await repo.findById(page.id))?.title).toBe('Notes');
      const ok = await repo.updateMeta(page.id, { title: 'A' }, { expectedRevision: page.revision });
      expect(ok).not.toBe('conflict');
      expect(await repo.updateMeta('page_nope', { title: 'A' })).toBe('not-found');
    });

    it('updateMeta leaves a document alone when it carries no title/nav blocks', async () => {
      // llm seed rows are `{source, llmRunId}`, not envelopes. Inventing a
      // partial `nav` block on one would fail pageEnvelopeSchema on next read.
      const repo = pagesRepo(t.meta);
      const page = await repo.create({
        connectionId,
        slug: 'seed',
        type: 'page-crud',
        title: 'Seed',
        config: { source: { table: 'public.x' }, llmRunId: 'run_1' },
        origin: 'llm',
      });
      await repo.updateMeta(page.id, { title: 'Renamed', navGroup: 'people' });
      const row = await repo.findById(page.id);
      expect(row?.title).toBe('Renamed');
      expect(row?.navGroup).toBe('people');
      expect(row?.config).toEqual({ source: { table: 'public.x' }, llmRunId: 'run_1' });
    });

    it('reorderNav renumbers each group densely from zero', async () => {
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(connectionId, [
        crudPage('a', { navOrder: 20 }),
        crudPage('b', { navOrder: 30 }),
        crudPage('c', { navOrder: 40 }),
      ]);

      const moved = await repo.reorderNav([
        { id: 'page_c', navGroup: 'library' },
        { id: 'page_a', navGroup: 'library' },
        { id: 'page_b', navGroup: 'workspace' },
        { id: 'page_missing', navGroup: 'workspace' },
      ]);
      expect(moved).toBe(3);

      const pages = await repo.listForConnection(connectionId);
      const byId = new Map(pages.map((p) => [p.id, p]));
      expect(byId.get('page_c')).toMatchObject({ navGroup: 'library', navOrder: 0 });
      expect(byId.get('page_a')).toMatchObject({ navGroup: 'library', navOrder: 1 });
      // A second group restarts at 0 rather than continuing the run.
      expect(byId.get('page_b')).toMatchObject({ navGroup: 'workspace', navOrder: 0 });
    });

    it('delete removes the row and listAll reports origin without the config blob', async () => {
      const repo = pagesRepo(t.meta);
      await repo.upsertGenerated(connectionId, [crudPage('customers')]);
      const mine = await repo.create({
        connectionId,
        slug: 'mine',
        type: 'page-dashboard',
        title: 'Mine',
        config: { v: 1 },
      });

      const all = await repo.listAll();
      expect(all.map((p) => p.slug).sort()).toEqual(['customers', 'mine']);
      expect(all.every((p) => !('config' in p))).toBe(true);
      expect(all.find((p) => p.slug === 'mine')?.origin).toBe('user');
      expect(all.find((p) => p.slug === 'mine')?.isEnabled).toBe(true);

      expect(await repo.delete(mine.id)).toBe(true);
      expect(await repo.delete(mine.id)).toBe(false);
      expect(await repo.findById(mine.id)).toBeNull();
    });

    it('setTemplateConfig replaces only the body, never the envelope frame', async () => {
      const repo = pagesRepo(t.meta);
      const page = await repo.create({
        connectionId,
        slug: 'grid',
        type: 'page-crud',
        title: 'Grid',
        config: {
          v: 1,
          kind: 'page',
          id: 'page_grid',
          template: 'page-crud',
          config: { columns: [{ name: 'id' }], generatedHash: 'h1' },
        },
      });
      const updated = await repo.setTemplateConfig(page.id, {
        columns: [{ name: 'id' }, { name: 'email' }],
        generatedHash: 'h1',
      });
      expect(updated).not.toBe('not-found');
      const stored = (await repo.findById(page.id))?.config as {
        template: string;
        config: { columns: { name: string }[] };
      };
      expect(stored.template).toBe('page-crud');
      expect(stored.config.columns).toHaveLength(2);
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
