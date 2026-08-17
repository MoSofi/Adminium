// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LLM run-service lifecycle (06-llm-assist.md §7.4, §9).
 *
 * Runs entirely on an in-memory SQLite meta store — no live database, no
 * provider network (the run-service performs no network I/O; §9). Covers:
 *  - createRun persists a valid `draft` (BYO ⇒ provider/model NULL, §9);
 *  - the status machine's legal + illegal transitions and post-terminal
 *    immutability;
 *  - validate-on-receive advancing awaiting_response → validated.
 */

import BetterSqlite3 from 'better-sqlite3';
import { parseDatabaseModel, type DatabaseModel, type StatsResult } from '@adminium/engine';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  usersRepo,
  type DsnCrypto,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ByoTelemetryError,
  createRunService,
  InvalidRunTransitionError,
  RunImmutableError,
  type RunService,
} from '../src/llm/run-service.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

const ALLOWED = {
  templates: [
    'page-crud',
    'page-dashboard',
    'page-queue-inbox',
    'page-board',
    'page-directory',
  ] as const,
  widgets: ['kpi-stat-card', 'chart-line-area', 'chart-donut', 'top-movers-list'] as const,
};

const schemaIr: DatabaseModel = parseDatabaseModel({
  irVersion: 1,
  dialect: 'postgres',
  name: 'shop',
  defaultSchema: 'public',
  tables: [
    {
      schema: 'public',
      name: 'orders',
      columns: [
        { name: 'id', logicalType: 'uuid', isPrimaryKey: true, nullable: false },
        { name: 'order_number', logicalType: 'text', isUnique: true, nullable: false },
        { name: 'status', logicalType: 'text', nullable: false },
      ],
      primaryKey: ['id'],
    },
  ],
});

const stats: StatsResult[] = [
  {
    table: { schema: 'public', name: 'orders' },
    rowCountEstimate: 41207,
    rowCountExact: false,
    sampled: false,
    columns: [
      { column: 'order_number', nullFraction: 0, distinctCount: 41207 },
      { column: 'status', nullFraction: 0, distinctCount: 5 },
    ],
  },
];

/** A clean, referentially-valid single-locale response for `public.orders`. */
function validResponse(runId: string): string {
  return JSON.stringify({
    schema_version: 'adminium.llm/v1',
    run_id: runId,
    tables: [
      {
        table: 'public.orders',
        confidence: 0.9,
        label: { en_US: 'Orders' },
        description: { en_US: 'Customer orders.' },
        icon: 'shopping-cart',
        displayColumn: 'order_number',
        naturalKey: ['order_number'],
        columns: [
          { column: 'order_number', label: { en_US: 'Order number' } },
          { column: 'status', label: { en_US: 'Status' } },
        ],
      },
    ],
  });
}

async function baseCreateInput(connectionId: string, snapshotId: string) {
  return {
    connectionId,
    snapshotId,
    schemaIr,
    stats,
    locales: ['en_US'] as const,
    sections: [] as const, // empty ⇒ all sections
    sampling: null,
    allowed: ALLOWED,
  };
}

describe('createRunService', () => {
  let meta: MetaDb;
  let service: RunService;
  let connectionId: string;
  let snapshotId: string;
  let userId: string;
  const receiveCtx = {
    snapshot: schemaIr,
    allowedTemplates: ALLOWED.templates,
    allowedWidgets: ALLOWED.widgets,
    stats,
  };

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const connection = await connectionsRepo(meta, testCrypto).create({
      name: 'shop',
      engine: 'postgres',
      introspectDsn: 'postgres://ro@localhost/shop',
    });
    connectionId = connection.id;
    // snapshotsRepo is available, but the service only needs a snapshot id.
    const { snapshotsRepo } = await import('@adminium/meta');
    const snap = await snapshotsRepo(meta).create({
      connectionId,
      source: 'introspection',
      schema: schemaIr,
      checksum: 'sha-shop-1',
    });
    snapshotId = snap.snapshot.id;
    userId = (await usersRepo(meta).create({ email: 'ava@adminium.test', name: 'Ava' })).id;
    service = createRunService({ meta });
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  it('createRun persists a valid BYO draft with provider/model NULL (§9)', async () => {
    const { run, artifact } = await service.createRun({
      ...(await baseCreateInput(connectionId, snapshotId)),
      mode: 'byo',
      createdBy: userId,
    });

    expect(run.status).toBe('draft');
    expect(run.mode).toBe('byo');
    expect(run.provider).toBeNull();
    expect(run.model).toBeNull();
    expect(run.promptVersion).toBe('adminium.prompt/v1.2');
    expect(run.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.promptText).toContain('=== SYSTEM ===');
    expect(run.promptText).toContain('=== USER ===');
    // The run id is the runId embedded in the prompt (§7.4).
    expect(run.promptText).toContain(run.id);
    expect(run.chunksTotal).toBe(artifact.chunks.length);
    expect(run.locales).toEqual(['en_US']);
    // Empty sections normalized to all ten.
    expect(run.sections).toHaveLength(10);

    // The artifact is byte-identical between the BYO markers and system+user.
    expect(artifact.byo).toBe(`=== SYSTEM ===\n${artifact.system}\n\n=== USER ===\n${artifact.user}`);
  });

  it('createRun rejects a BYO run that carries a provider/model (§9)', async () => {
    await expect(
      service.createRun({
        ...(await baseCreateInput(connectionId, snapshotId)),
        mode: 'byo',
        provider: 'anthropic',
      }),
    ).rejects.toBeInstanceOf(ByoTelemetryError);
  });

  it('createRun records provider + model for the direct path', async () => {
    const { run } = await service.createRun({
      ...(await baseCreateInput(connectionId, snapshotId)),
      mode: 'provider',
      provider: 'anthropic',
      model: 'claude-x',
    });
    expect(run.mode).toBe('provider');
    expect(run.provider).toBe('anthropic');
    expect(run.model).toBe('claude-x');
    expect(run.status).toBe('draft');
  });

  it('validate-on-receive advances awaiting_response → validated', async () => {
    const { run } = await service.createRun({
      ...(await baseCreateInput(connectionId, snapshotId)),
      mode: 'byo',
    });
    const awaiting = await service.markAwaitingResponse(run.id);
    expect(awaiting.status).toBe('awaiting_response');

    const { run: validated, validation } = await service.receiveResponse(run.id, {
      ...receiveCtx,
      text: validResponse(run.id),
    });
    expect(validation.errors).toEqual([]);
    expect(validation.warnings).toEqual([]);
    expect(validation.response).toBeDefined();
    expect(validated.status).toBe('validated');
    expect(validated.validationStatus).toBe('valid');
    expect(validated.chunksReceived).toBe(1);
    expect((validated.responseJson as { tables: unknown[] }).tables).toHaveLength(1);
  });

  it('a fatal paste keeps the run in awaiting_response with errors preserved (§7.5)', async () => {
    const { run } = await service.createRun({
      ...(await baseCreateInput(connectionId, snapshotId)),
      mode: 'byo',
    });
    await service.markAwaitingResponse(run.id);

    const { run: stuck, validation } = await service.receiveResponse(run.id, {
      ...receiveCtx,
      text: 'this is not json {',
    });
    expect(validation.response).toBeUndefined();
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(stuck.status).toBe('awaiting_response');
    expect(stuck.validationStatus).toBe('invalid');
    expect(Array.isArray(stuck.validationErrors)).toBe(true);
  });

  it('rejects receiveResponse before the run is awaiting_response', async () => {
    const { run } = await service.createRun({
      ...(await baseCreateInput(connectionId, snapshotId)),
      mode: 'byo',
    });
    await expect(
      service.receiveResponse(run.id, { ...receiveCtx, text: validResponse(run.id) }),
    ).rejects.toBeInstanceOf(InvalidRunTransitionError);
  });

  it('walks the full BYO lifecycle to partially_applied and then is immutable', async () => {
    const { run } = await service.createRun({
      ...(await baseCreateInput(connectionId, snapshotId)),
      mode: 'byo',
    });
    await service.markAwaitingResponse(run.id);
    await service.receiveResponse(run.id, { ...receiveCtx, text: validResponse(run.id) });

    const reviewed = await service.recordReview(run.id, {
      accepted: ['label:public.orders'],
      rejected: ['key:public.orders'],
    });
    expect(reviewed.review).toEqual({
      accepted: ['label:public.orders'],
      rejected: ['key:public.orders'],
    });

    const applied = await service.markApplied(run.id, { appliedBy: userId, partial: true });
    expect(applied.status).toBe('partially_applied');
    expect(applied.appliedBy).toBe(userId);
    expect(applied.appliedAt).not.toBeNull();

    // Terminal → immutable (§7.4).
    await expect(service.markApplied(run.id, { appliedBy: userId })).rejects.toBeInstanceOf(
      RunImmutableError,
    );
    await expect(service.discard(run.id)).rejects.toBeInstanceOf(RunImmutableError);
  });

  it('rejects an illegal transition (draft → applied)', async () => {
    const { run } = await service.createRun({
      ...(await baseCreateInput(connectionId, snapshotId)),
      mode: 'byo',
    });
    await expect(service.markApplied(run.id)).rejects.toBeInstanceOf(InvalidRunTransitionError);
  });

  it('markRunning drives the direct path and blocks a second start', async () => {
    const { run } = await service.createRun({
      ...(await baseCreateInput(connectionId, snapshotId)),
      mode: 'provider',
      provider: 'anthropic',
      model: 'claude-x',
    });
    const running = await service.markRunning(run.id);
    expect(running.status).toBe('running');
    // running → running is not a legal edge.
    await expect(service.markRunning(run.id)).rejects.toBeInstanceOf(InvalidRunTransitionError);
  });

  it('discard abandons a non-terminal run', async () => {
    const { run } = await service.createRun({
      ...(await baseCreateInput(connectionId, snapshotId)),
      mode: 'byo',
    });
    const discarded = await service.discard(run.id);
    expect(discarded.status).toBe('discarded');
    await expect(service.markRunning(run.id)).rejects.toBeInstanceOf(RunImmutableError);
  });

  it('lists runs for a connection', async () => {
    await service.createRun({ ...(await baseCreateInput(connectionId, snapshotId)), mode: 'byo' });
    await service.createRun({ ...(await baseCreateInput(connectionId, snapshotId)), mode: 'byo' });
    const list = await service.listRuns(connectionId);
    expect(list).toHaveLength(2);
  });
});
