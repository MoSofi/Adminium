// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The lifted prompt service (M10-T01, 06 §10.4 + §10.5).
 *
 * This orchestration was inline in `POST /api/v1/llm/runs` until the CLI needed
 * it too. The M10 risk register names the failure mode it now prevents —
 * "CLI/Docker parity with Studio wizard drifts" — so what matters here is that
 * `createRunForConnection` owns the whole sequence and both front doors get the
 * identical run.
 *
 * `@adminium/meta`'s two repos are mocked at module scope (hoisted, mutable
 * state) rather than per-test with `resetModules`: a reset would hand each test
 * a fresh copy of this module, and the error classes it exports would stop being
 * `instanceof`-comparable with the ones imported here.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ALLOWED, ordersSchema } from './llm-fixtures.js';

/** Mutable backing state for the mocked repos — each test sets what it needs. */
const state = vi.hoisted(() => ({
  snapshot: null as unknown,
  settings: {} as Record<string, unknown>,
}));

vi.mock('@adminium/meta', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@adminium/meta')),
  snapshotsRepo: () => ({ latest: async () => Promise.resolve(state.snapshot) }),
  settingsRepo: () => ({ get: async (key: string) => Promise.resolve(state.settings[key] ?? null) }),
}));

const {
  createPromptService,
  NO_STATS,
  ProviderNotSelectedError,
  SnapshotRequiredError,
} = await import('../src/llm/prompt-service.js');

const snapshot = { id: 'snap_1', schema: ordersSchema };

/** `createRunService` stand-in — the status machine has its own suite. */
function fakeRunService() {
  return {
    createRun: vi.fn(async (input: unknown) =>
      Promise.resolve({
        run: { id: 'run_1', promptVersion: 'PROMPT_V1', ...(input as object) },
        artifact: { tokenEstimate: 100, sections: [], chunks: [{ index: 1, total: 1, byo: 'PROMPT' }] },
      }),
    ),
    markAwaitingResponse: vi.fn(async (id: string) =>
      Promise.resolve({ id, status: 'awaiting_response', promptVersion: 'PROMPT_V1' }),
    ),
  } as unknown as Parameters<typeof createPromptService>[0]['runService'] & {
    createRun: ReturnType<typeof vi.fn>;
    markAwaitingResponse: ReturnType<typeof vi.fn>;
  };
}

const service = (runService = fakeRunService(), collectStats?: never) =>
  createPromptService({
    meta: {} as never,
    runService,
    allowed: ALLOWED,
    ...(collectStats === undefined ? {} : { collectStats }),
  });

beforeEach(() => {
  state.snapshot = snapshot;
  state.settings = {};
});

describe('createRunForConnection', () => {
  it('refuses when the connection has never been introspected', async () => {
    state.snapshot = null;
    await expect(
      service().createRunForConnection({ connectionId: 'conn_1', path: 'byo' }),
    ).rejects.toThrow(SnapshotRequiredError);
  });

  it('builds a BYO run against the latest snapshot and parks it awaiting a response', async () => {
    const runService = fakeRunService();
    const result = await service(runService).createRunForConnection({
      connectionId: 'conn_1',
      path: 'byo',
    });

    expect(runService.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn_1', snapshotId: 'snap_1', mode: 'byo' }),
    );
    expect(runService.markAwaitingResponse).toHaveBeenCalledWith('run_1');
    expect(result.run.status).toBe('awaiting_response');
    expect(result.snapshotId).toBe('snap_1');
  });

  it('records neither provider nor model on a BYO run (§9 telemetry-free)', async () => {
    const runService = fakeRunService();
    state.settings = { 'llm.provider': 'anthropic', 'llm.model': 'claude-sonnet-4' };
    await service(runService).createRunForConnection({ connectionId: 'conn_1', path: 'byo' });
    // Even with a provider configured, a BYO run must not record it.
    expect(runService.createRun.mock.calls[0]?.[0]).toMatchObject({ provider: null, model: null });
  });

  it('leaves a direct (provider) run in draft for the caller to execute', async () => {
    const runService = fakeRunService();
    state.settings = { 'llm.provider': 'anthropic', 'llm.model': 'claude-sonnet-4' };
    await service(runService).createRunForConnection({ connectionId: 'conn_1', path: 'provider' });

    expect(runService.createRun.mock.calls[0]?.[0]).toMatchObject({
      mode: 'provider',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
    });
    expect(runService.markAwaitingResponse).not.toHaveBeenCalled();
  });

  it('refuses a direct run when no provider is configured', async () => {
    await expect(
      service().createRunForConnection({ connectionId: 'conn_1', path: 'provider' }),
    ).rejects.toThrow(ProviderNotSelectedError);
  });

  it('defaults locales to en_US and sections to "all", sample-free', async () => {
    const runService = fakeRunService();
    await service(runService).createRunForConnection({ connectionId: 'conn_1', path: 'byo' });
    expect(runService.createRun.mock.calls[0]?.[0]).toMatchObject({
      locales: ['en_US'],
      sections: [],
      sampling: null,
    });
  });

  it('forwards explicit locales, sections, and sampling', async () => {
    const runService = fakeRunService();
    await service(runService).createRunForConnection({
      connectionId: 'conn_1',
      path: 'byo',
      locales: ['en_US', 'de_DE'],
      sections: ['labels'],
      sampling: { maxValuesPerColumn: 20 },
    });
    expect(runService.createRun.mock.calls[0]?.[0]).toMatchObject({
      locales: ['en_US', 'de_DE'],
      sections: ['labels'],
      sampling: { maxValuesPerColumn: 20 },
    });
  });

  it('passes the injected stats collector its §4.2 inputs', async () => {
    const collectStats = vi.fn(async () => Promise.resolve([]));
    const promptService = createPromptService({
      meta: {} as never,
      runService: fakeRunService(),
      allowed: ALLOWED,
      collectStats,
    });

    await promptService.createRunForConnection({
      connectionId: 'conn_1',
      path: 'byo',
      sampling: { maxValuesPerColumn: 20 },
    });

    expect(collectStats).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn_1',
        snapshotId: 'snap_1',
        sampling: { maxValuesPerColumn: 20 },
      }),
    );
  });
});

describe('loadLatestModel', () => {
  it('parses the stored snapshot into an IR', async () => {
    const result = await service().loadLatestModel('conn_1');
    expect(result.snapshotId).toBe('snap_1');
    expect(result.model.tables.map((table) => table.id)).toContain('public.orders');
  });

  it('throws SnapshotRequiredError naming the connection when there is none', async () => {
    state.snapshot = null;
    await expect(service().loadLatestModel('conn_9')).rejects.toMatchObject({
      name: 'SnapshotRequiredError',
      connectionId: 'conn_9',
    });
  });
});

describe('NO_STATS', () => {
  it('is the sample-free default — no aggregates reach the prompt', async () => {
    await expect(
      NO_STATS({
        connectionId: 'c',
        snapshotId: 's',
        model: parseDatabaseModel(ordersSchema),
        sampling: null,
      }),
    ).resolves.toEqual([]);
  });
});
