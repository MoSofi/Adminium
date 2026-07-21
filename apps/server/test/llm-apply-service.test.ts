/**
 * LLM apply EXECUTOR (06-llm-assist.md §8.3, T10b) — integration against a
 * seeded in-memory SQLite meta store (no live source DB, no provider network).
 *
 * Covers the acceptance criteria this track owns:
 *  - #3  applying the valid-demo accepted set writes the exact §8.3 row set —
 *        localized label/key/enum/relation/PII/micro-copy overrides + nav groups,
 *        template pages and a bound dashboard page;
 *  - #11 a `source: 'user'` override survives applying a new run (provenance),
 *        and re-executing the same plan is idempotent (no duplicate rows/pages);
 *  - partial acceptance lands `partially_applied` with the right review lists;
 *  - undo reverts exactly the apply (overrides + page nav state restored).
 */

import { readFileSync } from 'node:fs';

import BetterSqlite3 from 'better-sqlite3';
import { classifyModel, parseDatabaseModel } from '@adminium/engine';
import {
  diffEnrichment,
  LlmResponseV1,
  normalizeHeuristicBaseline,
  normalizeLlmResponse,
  tableLabelId,
  type ApplyPlan,
  type OverrideWrite,
  type SuggestionDiff,
  type TemplatePageWrite,
} from '@adminium/llm';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  llmOverridesRepo,
  llmRunsRepo,
  overridesRepo,
  pagesRepo,
  snapshotsRepo,
  usersRepo,
  type DsnCrypto,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApplyService, RunNotApplicableError, type ApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

function fixture(relative: string): string {
  return readFileSync(new URL(`./fixtures/llm/${relative}`, import.meta.url), 'utf8');
}

const demoSchemaIr = JSON.parse(fixture('demo-schema.json'));
const model = parseDatabaseModel(demoSchemaIr);
const classified = classifyModel(model);
const validDemo = LlmResponseV1.parse(JSON.parse(fixture('responses/valid-demo.json')));

/** The full diff the review UI would compute for the valid-demo run (no user locks). */
function demoDiff(): SuggestionDiff[] {
  const llm = normalizeLlmResponse(validDemo);
  const heuristic = normalizeHeuristicBaseline(model, classified);
  return diffEnrichment(llm, heuristic);
}

const DIFF = demoDiff();
const ALL_IDS = DIFF.map((d) => d.id);

describe('createApplyService', () => {
  let meta: MetaDb;
  let service: ApplyService;
  let connectionId: string;
  let snapshotId: string;
  let userId: string;

  /** Seed a `validated` BYO run carrying the parsed valid-demo response. */
  async function seedValidatedRun(): Promise<string> {
    const run = await llmRunsRepo(meta).create({
      connectionId,
      snapshotId,
      mode: 'byo',
      promptVersion: 'adminium.prompt/v1',
      promptHash: 'a'.repeat(64),
      locales: ['en_US', 'de_DE'],
      status: 'draft',
    });
    await llmRunsRepo(meta).recordResponse(run.id, {
      status: 'validated',
      validationStatus: 'valid',
      responseJson: validDemo,
      chunksReceived: 1,
    });
    return run.id;
  }

  /** Seed the three generated CRUD pages the nav-group re-placement lands on. */
  async function seedGeneratedPages(): Promise<void> {
    for (const table of ['public.customers', 'public.products', 'public.orders']) {
      await pagesRepo(meta).create({
        connectionId,
        slug: table.slice(table.indexOf('.') + 1),
        type: 'page-crud',
        title: table,
        origin: 'generated',
        config: { source: { connectionId, table } },
      });
    }
  }

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const connection = await connectionsRepo(meta, testCrypto).create({
      name: 'shop',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@localhost/shop',
    });
    connectionId = connection.id;
    const snap = await snapshotsRepo(meta).create({
      connectionId,
      source: 'introspection',
      schema: demoSchemaIr,
      checksum: 'sha-shop-1',
    });
    snapshotId = snap.snapshot.id;
    userId = (await usersRepo(meta).create({ email: 'ava@adminium.test', name: 'Ava' })).id;
    service = createApplyService({ meta, runService: createRunService({ meta }) });
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  it('writes the exact §8.3 override + page set for the valid-demo accepted set (#3)', async () => {
    await seedGeneratedPages();
    const runId = await seedValidatedRun();

    const result = await service.applyRun(runId, ALL_IDS, { appliedBy: userId });

    // Run lands `applied` (everything accepted → nothing rejected).
    expect(result.run.status).toBe('applied');
    expect(result.partial).toBe(false);
    expect(result.review.rejected).toEqual([]);
    expect(result.plan.excludedUserLocked).toEqual([]);

    // 27 §8.3 overrides, all origin:'llm' with the run's provenance.
    const overrides = await llmOverridesRepo(meta).listForConnection(connectionId);
    expect(overrides).toHaveLength(27);
    for (const o of overrides) {
      expect(o.llmRunId).toBe(runId);
      expect(o.confidence).toBeGreaterThanOrEqual(0);
      expect(o.confidence).toBeLessThanOrEqual(1);
    }
    // The enum-semantics suggestion carries its exact model confidence (§6.3).
    expect(overrides.find((o) => o.field === 'enum_semantics')?.confidence).toBe(0.97);

    const byField = (field: string) => overrides.filter((o) => o.field === field);
    expect(byField('label')).toHaveLength(17); // 3 tables + 14 columns
    expect(byField('key')).toHaveLength(3);
    expect(byField('enum_semantics')).toHaveLength(1);
    expect(byField('virtual_relation')).toHaveLength(1);
    expect(byField('pii')).toHaveLength(2);
    expect(byField('copy')).toHaveLength(3);

    // Localized table-label bundle carries label + description + folded icon.
    const ordersLabel = overrides.find((o) => o.field === 'label' && o.tableName === 'public.orders' && o.columnName === null);
    expect(ordersLabel?.value).toEqual({
      label: { en_US: 'Orders', de_DE: 'Bestellungen' },
      description: {
        en_US: "A customer's purchase of a product, tracked from placement to fulfilment.",
        de_DE: 'Der Kauf eines Produkts durch einen Kunden, von der Bestellung bis zur Lieferung.',
      },
      icon: 'shopping-cart',
    });

    // The virtual relation the engine will treat as a real FK.
    const relation = byField('virtual_relation')[0];
    expect(relation?.tableName).toBe('public.orders');
    expect(relation?.value).toEqual({
      fromColumns: ['product_id'],
      toTable: 'public.products',
      toColumns: ['id'],
      kind: 'many-to-one',
    });

    // A PII masking override on a heuristically-flagged column.
    const email = overrides.find((o) => o.field === 'pii' && o.columnName === 'email');
    expect((email?.value as { masking: string }).masking).toBe('mask-email');

    // Pages: 3 template + 1 dashboard, all origin:'llm'; the 3 seeded CRUD pages stay generated.
    const pages = await pagesRepo(meta).listForConnection(connectionId);
    const llmPages = pages.filter((p) => p.origin === 'llm');
    expect(llmPages.filter((p) => p.type !== 'page-dashboard').map((p) => p.type).sort()).toEqual([
      'page-board',
      'page-directory',
      'page-queue-inbox',
    ]);

    const dashboard = llmPages.find((p) => p.type === 'page-dashboard');
    expect((dashboard?.config as { layout: { items: unknown[] } }).layout.items).toHaveLength(5);

    // Nav groups stamped onto every page of each member table (§8.3 `group`).
    const ordersCrud = pages.find((p) => p.origin === 'generated' && p.slug === 'orders');
    const productsCrud = pages.find((p) => p.origin === 'generated' && p.slug === 'products');
    expect(ordersCrud?.navGroup).toBe('sales');
    expect(ordersCrud?.navOrder).toBe(0);
    expect(productsCrud?.navGroup).toBe('catalog');
    // The orders template pages inherit the orders nav group too.
    for (const t of llmPages.filter((p) => p.type === 'page-board' || p.type === 'page-queue-inbox')) {
      expect(t.navGroup).toBe('sales');
    }
    expect(result.counts).toEqual({ overrides: 27, pages: 4, navGroupUpdates: 6 });
  });

  it('a source:user override survives applying a new run (provenance, #11)', async () => {
    // A human already labelled customers → locked; the LLM must not overwrite it.
    const userRow = await overridesRepo(meta).create({
      connectionId,
      op: 'table.label',
      tableName: 'public.customers',
      value: { label: 'VIP customers' },
      origin: 'user',
      createdBy: userId,
    });
    const runId = await seedValidatedRun();

    const result = await service.applyRun(runId, ALL_IDS, { appliedBy: userId });

    // The locked table label was excluded from the plan.
    expect(result.plan.excludedUserLocked).toContain(tableLabelId('public.customers'));

    // The user row is byte-for-byte intact (never touched).
    const stillThere = await overridesRepo(meta).findById(userRow.id);
    expect(stillThere?.origin).toBe('user');
    expect(stillThere?.value).toEqual({ label: 'VIP customers' });

    // No competing llm.label override was written for the customers TABLE label.
    const llmOverrides = await llmOverridesRepo(meta).listForConnection(connectionId);
    const clash = llmOverrides.find(
      (o) => o.field === 'label' && o.tableName === 'public.customers' && o.columnName === null,
    );
    expect(clash).toBeUndefined();
    // Column labels for customers are NOT locked and still apply.
    expect(
      llmOverrides.some((o) => o.field === 'label' && o.tableName === 'public.customers' && o.columnName === 'email'),
    ).toBe(true);
  });

  it('re-executing the same plan is idempotent — no duplicate overrides or pages (#11)', async () => {
    await seedGeneratedPages();
    const runId = await seedValidatedRun();
    const run = await llmRunsRepo(meta).findById(runId);
    const { plan } = await service.buildPlanForRun(run!, ALL_IDS);

    await service.executeApplyPlan(plan, { createdBy: userId });
    const afterFirst = {
      overrides: (await llmOverridesRepo(meta).listForConnection(connectionId)).length,
      llmPages: (await pagesRepo(meta).listForConnection(connectionId)).filter((p) => p.origin === 'llm').length,
    };

    await service.executeApplyPlan(plan, { createdBy: userId });
    const afterSecond = {
      overrides: (await llmOverridesRepo(meta).listForConnection(connectionId)).length,
      llmPages: (await pagesRepo(meta).listForConnection(connectionId)).filter((p) => p.origin === 'llm').length,
    };

    expect(afterFirst).toEqual({ overrides: 27, llmPages: 4 });
    expect(afterSecond).toEqual(afterFirst);
  });

  it('re-applying a NEWER run supersedes the llm_run_id in place (§8.3)', async () => {
    await seedGeneratedPages();
    const runA = await seedValidatedRun();
    await service.applyRun(runA, ALL_IDS, { appliedBy: userId });

    const runB = await seedValidatedRun();
    await service.applyRun(runB, ALL_IDS, { appliedBy: userId });

    const overrides = await llmOverridesRepo(meta).listForConnection(connectionId);
    expect(overrides).toHaveLength(27); // no duplicates
    for (const o of overrides) expect(o.llmRunId).toBe(runB); // superseded to the newer run
    // Pages did not duplicate across the two applies.
    expect((await pagesRepo(meta).listForConnection(connectionId)).filter((p) => p.origin === 'llm')).toHaveLength(4);
  });

  it('two connections applying the same response get distinct page rows (no id collision)', async () => {
    // Suggestion-ids are pure coordinate functions (template:public.orders:…),
    // identical across connections — the page id must be connection-scoped or
    // the second apply would rewrite the first connection's rows in place.
    const runA = await seedValidatedRun();
    await service.applyRun(runA, ALL_IDS, { appliedBy: userId });

    const other = await connectionsRepo(meta, testCrypto).create({
      name: 'shop-two',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@localhost/shop2',
    });
    const otherSnap = await snapshotsRepo(meta).create({
      connectionId: other.id,
      source: 'introspection',
      schema: demoSchemaIr,
      checksum: 'sha-shop-2',
    });
    const runB = await llmRunsRepo(meta).create({
      connectionId: other.id,
      snapshotId: otherSnap.snapshot.id,
      mode: 'byo',
      promptVersion: 'adminium.prompt/v1',
      promptHash: 'a'.repeat(64),
      locales: ['en_US', 'de_DE'],
      status: 'draft',
    });
    await llmRunsRepo(meta).recordResponse(runB.id, {
      status: 'validated',
      validationStatus: 'valid',
      responseJson: validDemo,
      chunksReceived: 1,
    });
    await service.applyRun(runB.id, ALL_IDS, { appliedBy: userId });

    const pagesA = (await pagesRepo(meta).listForConnection(connectionId)).filter((p) => p.origin === 'llm');
    const pagesB = (await pagesRepo(meta).listForConnection(other.id)).filter((p) => p.origin === 'llm');
    expect(pagesA).toHaveLength(4);
    expect(pagesB).toHaveLength(4);
    const idsA = new Set(pagesA.map((p) => p.id));
    for (const page of pagesB) expect(idsA.has(page.id)).toBe(false);
    // The first connection's seed rows still carry THEIR run's provenance —
    // the second apply never rewrote them.
    for (const page of pagesA) {
      expect((page.config as { llmRunId: string }).llmRunId).toBe(runA);
    }
  });

  it('partial acceptance lands partially_applied with the correct review lists', async () => {
    await seedGeneratedPages();
    const runId = await seedValidatedRun();

    // Drop one actionable label suggestion from the accepted set.
    const dropped = tableLabelId('public.products');
    const accepted = ALL_IDS.filter((id) => id !== dropped);

    const result = await service.applyRun(runId, accepted, { appliedBy: userId });

    expect(result.partial).toBe(true);
    expect(result.run.status).toBe('partially_applied');
    expect(result.review.rejected).toEqual([dropped]);
    expect(result.review.accepted).not.toContain(dropped);

    // The rejected products table label was not written.
    const overrides = await llmOverridesRepo(meta).listForConnection(connectionId);
    expect(
      overrides.some((o) => o.field === 'label' && o.tableName === 'public.products' && o.columnName === null),
    ).toBe(false);

    // The persisted review survives on the run for re-opening.
    const persisted = await llmRunsRepo(meta).findById(runId);
    expect(persisted?.review?.rejected).toEqual([dropped]);
  });

  it('undo reverts exactly the apply — overrides removed, page nav restored', async () => {
    await seedGeneratedPages();
    const runId = await seedValidatedRun();

    const result = await service.applyRun(runId, ALL_IDS, { appliedBy: userId });
    // Sanity: the apply happened.
    expect((await llmOverridesRepo(meta).listForConnection(connectionId)).length).toBe(27);

    await service.undoApply(result.undo);

    // All llm overrides + llm pages are gone.
    expect(await llmOverridesRepo(meta).listForConnection(connectionId)).toEqual([]);
    const pages = await pagesRepo(meta).listForConnection(connectionId);
    expect(pages.filter((p) => p.origin === 'llm')).toEqual([]);
    // The seeded generated pages are back to their pre-apply nav state (unset).
    for (const p of pages.filter((p) => p.origin === 'generated')) {
      expect(p.navGroup).toBeNull();
    }
  });

  it('persists every relation on one fromTable — no override-key collision (junction table)', async () => {
    // A junction table with two undeclared FKs yields two accepted `relation`
    // suggestions sharing field=virtual_relation, table, and previously column=null;
    // the upsert key must discriminate them or the second silently overwrites the first.
    const relOverride = (fromColumn: string, toTable: string): OverrideWrite => ({
      target: 'override',
      suggestionId: `relation:public.order_items.${fromColumn}->${toTable}.id`,
      field: 'virtual_relation',
      table: 'public.order_items',
      column: `${fromColumn}->${toTable}.id`,
      value: { fromColumns: [fromColumn], toTable, toColumns: ['id'], kind: 'many-to-one' },
      source: 'llm',
      confidence: 0.8,
    });
    const plan: ApplyPlan = {
      connectionId,
      writes: [relOverride('order_id', 'public.orders'), relOverride('product_id', 'public.products')],
      excludedUserLocked: [],
    };

    await service.executeApplyPlan(plan, { createdBy: userId });

    const rels = (await llmOverridesRepo(meta).listForConnection(connectionId)).filter(
      (o) => o.field === 'virtual_relation',
    );
    expect(rels).toHaveLength(2);
    expect(
      rels.map((o) => (o.value as { toTable: string }).toTable).sort(),
    ).toEqual(['public.orders', 'public.products']);

    // Re-applying the same plan stays idempotent (no third row).
    await service.executeApplyPlan(plan, { createdBy: userId });
    expect(
      (await llmOverridesRepo(meta).listForConnection(connectionId)).filter((o) => o.field === 'virtual_relation'),
    ).toHaveLength(2);
  });

  it('applies template pages for same-named tables in different schemas (no slug collision)', async () => {
    // public.orders + archive.orders both accept a page-template suggestion in one
    // run; their slugs must be schema-qualified or the second INSERT violates
    // UNIQUE(connection_id, slug) and aborts the whole apply transaction.
    const templatePage = (table: string): TemplatePageWrite => ({
      target: 'page',
      kind: 'template-page',
      suggestionId: `template:${table}:page-queue-inbox`,
      template: 'page-queue-inbox',
      table,
      rank: 1,
      config: { source: { connectionId, table } },
      source: 'llm',
      confidence: 0.8,
    });
    const plan: ApplyPlan = {
      connectionId,
      writes: [templatePage('public.orders'), templatePage('archive.orders')],
      excludedUserLocked: [],
    };

    await expect(service.executeApplyPlan(plan, { createdBy: userId })).resolves.toBeDefined();

    const llmPages = (await pagesRepo(meta).listForConnection(connectionId)).filter((p) => p.origin === 'llm');
    expect(llmPages).toHaveLength(2);
    expect(new Set(llmPages.map((p) => p.slug)).size).toBe(2);
  });

  it('rejects applying a run that is not validated', async () => {
    const run = await llmRunsRepo(meta).create({
      connectionId,
      snapshotId,
      mode: 'byo',
      promptVersion: 'adminium.prompt/v1',
      promptHash: 'b'.repeat(64),
      status: 'draft',
    });
    await expect(service.applyRun(run.id, [])).rejects.toBeInstanceOf(RunNotApplicableError);
  });

  it('fires the regeneration hook after a durable apply (§8.3 step 3)', async () => {
    await seedGeneratedPages();
    const runId = await seedValidatedRun();
    const calls: { connectionId: string; snapshotId: string; runId: string }[] = [];
    const hooked = createApplyService({
      meta,
      runService: createRunService({ meta }),
      regenerate: (ctx) => {
        calls.push({ connectionId: ctx.connectionId, snapshotId: ctx.snapshotId, runId: ctx.runId });
      },
    });

    await hooked.applyRun(runId, ALL_IDS, { appliedBy: userId });
    expect(calls).toEqual([{ connectionId, snapshotId, runId }]);
  });
});
