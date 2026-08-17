// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One page per (table, template), one nav group per table — the §8.3 apply and
 * the heuristic generator meeting on the same coordinate (06-llm-assist.md §8.3).
 *
 * Regression. The two producers keyed their pages on different schemes — the
 * generator on `page_<scope>_<table-slug>-<suffix>` (`orders-board`), the apply
 * executor on a `page_<sha30>` of the suggestion id with a
 * `<schema>-<table>-<template>` slug (`public-orders-page-board`) — so an LLM
 * recommending a template the generator already emits produced BOTH pages (25
 * pages where ~21 were expected).
 *
 * The last test covers the OTHER half of that report — the accepted domain
 * groups reverting to the heuristic ones on every generated page. That is not
 * fixable by making the placement durable; see the test for why.
 *
 * Both orders are pinned, because the two producers can run either way round:
 * generate-then-apply (the normal path) and apply-then-generate (an apply on a
 * connection that has never generated, or a schema change that only now makes a
 * table earn the archetype the LLM asked for).
 *
 * Offline: sqlite meta, a pre-seeded snapshot (no introspection), a manager
 * that only ever resolves the connection row, no provider network.
 */

import { readFileSync } from 'node:fs';

import BetterSqlite3 from 'better-sqlite3';
import { classifyModel, parseDatabaseModel } from '@adminium/engine';
import {
  diffEnrichment,
  LlmResponseV1,
  normalizeHeuristicBaseline,
  normalizeLlmResponse,
} from '@adminium/llm';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  llmRunsRepo,
  pagesRepo,
  snapshotsRepo,
  usersRepo,
  type MetaDb,
  type Page,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { runGeneration } from '../src/generate/run.js';
import { createApplyService, type ApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { NAV_GROUP_KEYS } from '../src/routes/bootstrap/schema.js';
import { TEST_SECRET } from './helpers.js';

function fixture(relative: string): string {
  return readFileSync(new URL(`./fixtures/llm/${relative}`, import.meta.url), 'utf8');
}

const demoSchemaIr = JSON.parse(fixture('demo-schema.json'));
const demoModel = parseDatabaseModel(demoSchemaIr);
const validDemo = LlmResponseV1.parse(JSON.parse(fixture('responses/valid-demo.json')));

/** Every suggestion id of the valid-demo run — the "accept all" review. */
const ALL_IDS = diffEnrichment(
  normalizeLlmResponse(validDemo),
  normalizeHeuristicBaseline(demoModel, classifyModel(demoModel)),
).map((d) => d.id);

/**
 * The overlap this test turns on: the generator's §14 archetype pass gives
 * `public.orders` a `page-board`, and the valid-demo response recommends
 * `page-board` for `public.orders` too (its other two — a queue for orders, a
 * directory for customers — are LLM-only, so the run still adds pages).
 */
const OVERLAP = { table: 'public.orders', template: 'page-board' };

/** `<bound table> <template>` for every table-bound page, duplicates included. */
function coordinates(pages: readonly Page[]): string[] {
  return pages
    .map((page) => {
      const source = (page.config as { source?: { table?: unknown } } | null)?.source;
      return typeof source?.table === 'string' ? `${source.table} ${page.type}` : null;
    })
    .filter((key): key is string => key !== null);
}

function duplicates(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  return [...dupes].sort();
}

/** The only groups `buildNavTree` renders — any other value hides the page. */
const RENDERABLE_NAV_GROUPS: readonly string[] = NAV_GROUP_KEYS;

describe('llm apply × generation — one page per (table, template)', () => {
  let meta: MetaDb;
  let manager: ConnectionManager;
  let service: ApplyService;
  let connectionId: string;
  let snapshotId: string;
  let userId: string;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const crypto = dsnCryptoFromSecret(TEST_SECRET);
    const connection = await connectionsRepo(meta, crypto).create({
      name: 'shop',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@localhost/shop',
    });
    connectionId = connection.id;
    snapshotId = (
      await snapshotsRepo(meta).create({
        connectionId,
        source: 'introspection',
        schema: demoSchemaIr,
        checksum: 'sha-shop-1',
      })
    ).snapshot.id;
    userId = (await usersRepo(meta).create({ email: 'ava@adminium.test', name: 'Ava' })).id;
    manager = new ConnectionManager({ meta, crypto, metaDsn: null, blockLoopback: false });
    // The production wiring (cli/runtime.ts): the apply hook reruns generation.
    service = createApplyService({
      meta,
      runService: createRunService({ meta }),
      regenerate: async (ctx) => {
        await runGeneration({ manager, meta, connectionId: ctx.connectionId });
      },
    });
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  /** Apply the whole valid-demo run (regeneration hook included). */
  async function applyDemoRun(): Promise<void> {
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
    await service.applyRun(run.id, ALL_IDS, { appliedBy: userId });
  }

  it('the generator emits the archetype this response recommends (fixture guard)', async () => {
    // If this ever stops holding, every test below still passes but stops
    // testing anything — the overlap is the whole point.
    const { pages } = await runGeneration({ manager, meta, connectionId });
    expect(
      pages.some((p) => p.source.table === OVERLAP.table && p.template === OVERLAP.template),
    ).toBe(true);
    expect(
      validDemo.tables
        .find((t) => t.table === OVERLAP.table)
        ?.pageTemplates.some((t) => t.template === OVERLAP.template),
    ).toBe(true);
  });

  it('generate → apply: the recommended template reuses the generated page', async () => {
    await runGeneration({ manager, meta, connectionId });
    const generatedBoard = (await pagesRepo(meta).listForConnection(connectionId)).find(
      (p) => p.type === OVERLAP.template,
    );

    await applyDemoRun();

    const pages = await pagesRepo(meta).listForConnection(connectionId);
    expect(duplicates(coordinates(pages))).toEqual([]);

    // The existing page won: same row, same readable slug — not a second board
    // under `public-orders-page-board`.
    const boards = pages.filter((p) => p.type === OVERLAP.template);
    expect(boards).toHaveLength(1);
    expect(boards[0]?.id).toBe(generatedBoard?.id);
    expect(boards[0]?.slug).toBe('orders-board');
    expect(boards[0]?.origin).toBe('generated');

    // The LLM's non-overlapping recommendations still land.
    expect(pages.filter((p) => p.origin === 'llm' && p.type === 'page-queue-inbox')).toHaveLength(1);
  });

  it('reuses a HAND-EDITED generated page instead of duplicating it', async () => {
    // The sharp edge of "the existing page wins": a human laid this board out,
    // so the regeneration guard keeps the row whatever the new set says (user
    // delta wins, 04 §6.3). Dropping it from the generated set alone would then
    // leave BOTH pages standing — only declining to insert the llm twin in the
    // first place keeps it at one, with the edit intact.
    await runGeneration({ manager, meta, connectionId });
    const board = (await pagesRepo(meta).listForConnection(connectionId)).find(
      (p) => p.type === OVERLAP.template,
    );
    const edited = { version: 1, items: [] };
    await pagesRepo(meta).setLayout(board!.id, edited);

    await applyDemoRun();

    const pages = await pagesRepo(meta).listForConnection(connectionId);
    expect(duplicates(coordinates(pages))).toEqual([]);
    const boards = pages.filter((p) => p.type === OVERLAP.template);
    expect(boards).toHaveLength(1);
    expect(boards[0]?.id).toBe(board?.id);
    expect((boards[0]?.config as { config: { layout: unknown } }).config.layout).toEqual(edited);
  });

  it('apply → generate: the generated twin is not re-created beside the llm page', async () => {
    // No generation has ever run for this connection, so the apply inserts its
    // own board page — and the regeneration that follows must not add the
    // generator's `orders-board` next to it.
    await applyDemoRun();

    const pages = await pagesRepo(meta).listForConnection(connectionId);
    expect(duplicates(coordinates(pages))).toEqual([]);

    const boards = pages.filter((p) => p.type === OVERLAP.template);
    expect(boards).toHaveLength(1);
    expect(boards[0]?.origin).toBe('llm');

    // A second regeneration is stable — it neither re-adds the twin nor
    // re-places the pages.
    const before = pages.map((p) => `${p.id} ${p.navGroup}`).sort();
    await runGeneration({ manager, meta, connectionId });
    const after = (await pagesRepo(meta).listForConnection(connectionId))
      .map((p) => `${p.id} ${p.navGroup}`)
      .sort();
    expect(after).toEqual(before);
  });

  it('leaves every generated page in a group the nav rail can render', async () => {
    // The §8.3 `group` write stamps the LLM's domain slugs (`sales`,
    // `catalog`) onto every page of a member table, and the regeneration that
    // follows rewrites the GENERATED rows back to their heuristic 09 §2.2
    // group. That reversion is load-bearing, not a bug to fix in isolation:
    // `buildNavTree` (routes/bootstrap) drops any row whose group is not one
    // of NAV_GROUP_KEYS, so a generated page that kept `sales` would vanish
    // from the sidebar — which is exactly what broke the llm-enrichment e2e
    // when the placement was made durable. Making it stick therefore belongs
    // with teaching the rail to render domain groups, in one change.
    await runGeneration({ manager, meta, connectionId });
    await applyDemoRun();

    const generated = (await pagesRepo(meta).listForConnection(connectionId)).filter(
      (p) => p.origin === 'generated',
    );
    expect(generated.length).toBeGreaterThan(0);
    for (const page of generated) {
      expect(RENDERABLE_NAV_GROUPS, `${page.slug} is unreachable in the nav rail`).toContain(
        page.navGroup,
      );
    }
  });
});
