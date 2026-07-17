/**
 * LLM page-row materialization (06-llm-assist.md §8.3 step 3 —
 * `generate/materialize-llm.ts`).
 *
 * The apply executor seeds `origin: 'llm'` page rows with minimal configs the
 * client cannot render (no envelope `v` → `parsePageDocument` throws). These
 * tests pin the repair: after an apply, the materialization pass every
 * `runGeneration` performs expands each seed into a validated §6.1 envelope,
 * idempotently, without ever touching a row that is already an envelope.
 */

import { readFileSync } from 'node:fs';

import BetterSqlite3 from 'better-sqlite3';
import { classifyModel, parseDatabaseModel } from '@adminium/engine';
import { pageEnvelopeSchema } from '@adminium/engine/config';
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
  type DsnCrypto,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { materializeLlmPages } from '../src/generate/materialize-llm.js';
import { createApplyService, type ApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

function fixture(relative: string): string {
  return readFileSync(new URL(`./fixtures/llm/${relative}`, import.meta.url), 'utf8');
}

const demoSchemaIr = JSON.parse(fixture('demo-schema.json'));
const validDemo = LlmResponseV1.parse(JSON.parse(fixture('responses/valid-demo.json')));
const demoModel = parseDatabaseModel(demoSchemaIr);

/** Every suggestion id of the valid-demo run (the llm-apply-service idiom). */
const ALL_IDS = diffEnrichment(
  normalizeLlmResponse(validDemo),
  normalizeHeuristicBaseline(demoModel, classifyModel(demoModel)),
).map((d) => d.id);

describe('materializeLlmPages', () => {
  let meta: MetaDb;
  let service: ApplyService;
  let connectionId: string;
  let snapshotId: string;
  let userId: string;

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

  /** Apply the whole valid-demo run → 3 template seeds + 1 dashboard seed. */
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

  it('expands llm seed rows into validated envelopes, parks the uncomposable, idempotently', async () => {
    await applyDemoRun();
    const model = demoModel;

    const before = (await pagesRepo(meta).listForConnection(connectionId)).filter(
      (p) => p.origin === 'llm',
    );
    expect(before).toHaveLength(4);
    for (const page of before) {
      expect(pageEnvelopeSchema.safeParse(page.config).success).toBe(false); // seeds
    }

    const result = await materializeLlmPages({ meta, model, connectionId });
    // The demo customers table has no hierarchy/avatar candidates, so the
    // suggested page-directory cannot fill its required slot — parked, the
    // other three (dashboard, board, queue) materialize.
    expect(result.materialized).toHaveLength(3);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/page-directory.*not materialized.*page disabled/);

    const after = (await pagesRepo(meta).listForConnection(connectionId)).filter(
      (p) => p.origin === 'llm',
    );
    const parked = after.find((p) => p.type === 'page-directory');
    expect(parked?.isEnabled).toBe(false); // no invalid-config card, just hidden
    expect(parked?.revision).toBe(1); // seed config untouched — retried next run

    for (const page of after.filter((p) => p.type !== 'page-directory')) {
      const parsed = pageEnvelopeSchema.safeParse(page.config);
      expect(parsed.success, `${page.slug}: ${JSON.stringify(parsed.error?.issues[0])}`).toBe(true);
      const envelope = page.config as { id: string; config: Record<string, unknown> };
      expect(envelope.id).toBe(page.id); // the client fetches by row id
      expect(typeof envelope.config['generatedHash']).toBe('string');
      expect(page.revision).toBe(2); // seed → materialized is a tracked change
      expect(page.icon).not.toBeNull(); // nav icon back-filled
      expect(page.isEnabled).toBe(true);
    }

    // The dashboard kept its bound §8.3 layout verbatim; the template pages
    // materialized as the REQUESTED templates.
    const dashboard = after.find((p) => p.type === 'page-dashboard');
    const layout = (dashboard?.config as { config: { layout: { items: unknown[] } } }).config.layout;
    expect(layout.items).toHaveLength(5);
    expect(after.filter((p) => p.type !== 'page-dashboard').map((p) => p.type).sort()).toEqual([
      'page-board',
      'page-directory',
      'page-queue-inbox',
    ]);

    // Second pass: materialized rows carry the envelope `v` — untouched; the
    // parked seed is retried (and re-warned), still without a config write.
    const again = await materializeLlmPages({ meta, model, connectionId });
    expect(again.materialized).toEqual([]);
    expect(again.warnings).toHaveLength(1);
    const untouched = (await pagesRepo(meta).listForConnection(connectionId)).filter(
      (p) => p.origin === 'llm' && p.type !== 'page-directory',
    );
    expect(untouched.map((p) => p.revision)).toEqual(untouched.map(() => 2));
  });

  it('parks seeds whose bound table is not part of the run, keeps the rest', async () => {
    await applyDemoRun();
    // A model filtered down to customers only — the orders seeds cannot bind.
    const filtered = parseDatabaseModel(
      JSON.stringify({
        ...demoSchemaIr,
        tables: (demoSchemaIr as { tables: { id: string }[] }).tables.filter(
          (t) => t.id === 'public.customers',
        ),
        relations: [],
      }),
    );

    const result = await materializeLlmPages({ meta, model: filtered, connectionId });
    // Only the dashboard (no table binding) lands: the two orders templates
    // lost their table, and the customers directory still cannot compose.
    expect(result.materialized).toHaveLength(1);
    expect(result.warnings).toHaveLength(3);
    for (const warning of result.warnings) {
      expect(warning).toMatch(/not materialized/);
    }
    const pages = await pagesRepo(meta).listForConnection(connectionId);
    expect(pages.filter((p) => p.origin === 'llm' && !p.isEnabled)).toHaveLength(3);
  });
});
