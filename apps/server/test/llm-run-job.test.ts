/**
 * `llm-run` job handler end-to-end (06-llm-assist.md §7.5, §10.2, §9,
 * acceptance #6 + §10 "key never logged").
 *
 * Drives the real jobs worker over an in-memory SQLite meta store with a
 * SCRIPTED FAKE provider (injected via `createProviderResolver`'s `createClient`
 * seam — no network). Asserts: a clean reply validates; a malformed first reply
 * is repaired; a truncated reply escalates maxTokens before a repair; three
 * failures fail the run with errors preserved; a cancel discards the run;
 * temperature 0 is sent; the API key never appears in job logs or realtime
 * events; and a BYO run is rejected (direct-only, §9).
 */
import BetterSqlite3 from 'better-sqlite3';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  jobsRepo,
  settingsRepo,
  snapshotsRepo,
  usersRepo,
  type DsnCrypto,
  type LlmRun,
  type MetaDb,
} from '@adminium/meta';
import { type LlmKeyCrypto } from '@adminium/llm';
import { afterEach, describe, expect, it } from 'vitest';

import { LLM_RUN_KIND, registerLlmRunHandler } from '../src/jobs/llm-run.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker, jobChannel, type WorkerLogger } from '../src/jobs/worker.js';
import { createProviderResolver } from '../src/llm/provider-resolver.js';
import { createRunService, type RunService } from '../src/llm/run-service.js';
import { RealtimeHub, type RealtimeEvent } from '../src/realtime/hub.js';
import {
  ALLOWED,
  makeScriptedClient,
  MALFORMED_REPLY,
  ordersSchema,
  ordersStats,
  ProviderError,
  TRUNCATED_REPLY,
  validOrdersResponse,
  type ScriptedClient,
  type ScriptStep,
} from './llm-fixtures.js';
import { collectChannel, makeClock, until } from './jobs-helpers.js';

const testCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

/** The plaintext key that must NEVER surface in a log line or realtime event. */
const SECRET_KEY = 'sk-secret-DO-NOT-LOG';

const keyCrypto: LlmKeyCrypto = {
  encrypt: (plaintext) => `enc:${plaintext}`,
  decrypt: (token) => (token.startsWith('enc:') ? token.slice('enc:'.length) : token),
};

let openMeta: MetaDb | null = null;
afterEach(async () => {
  if (openMeta !== null) {
    await openMeta.db.destroy();
    openMeta = null;
  }
});

interface Fixture {
  meta: MetaDb;
  runService: RunService;
  run: LlmRun;
  userId: string;
}

async function createFixture(opts: { mode?: 'provider' | 'byo' } = {}): Promise<Fixture> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  openMeta = meta;
  await firstRun(meta);

  const connection = await connectionsRepo(meta, testCrypto).create({
    name: 'shop',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@localhost/shop',
  });
  const snap = await snapshotsRepo(meta).create({
    connectionId: connection.id,
    source: 'introspection',
    schema: ordersSchema,
    checksum: 'sha-shop-1',
  });
  const user = await usersRepo(meta).create({ email: 'ava@adminium.test', name: 'Ava' });

  const settings = settingsRepo(meta);
  await settings.set('llm.provider', 'anthropic');
  await settings.set('llm.apiKey', keyCrypto.encrypt(SECRET_KEY));
  await settings.set('llm.model', 'claude-x');
  await settings.set('llm.maxOutputTokens', 100);

  const mode = opts.mode ?? 'provider';
  const runService = createRunService({ meta });
  const { run } = await runService.createRun({
    connectionId: connection.id,
    snapshotId: snap.snapshot.id,
    schemaIr: ordersSchema,
    stats: ordersStats,
    locales: ['en_US'],
    sections: [],
    sampling: null,
    mode,
    ...(mode === 'provider' ? { provider: 'anthropic' as const, model: 'claude-x' } : {}),
    allowed: ALLOWED,
    createdBy: user.id,
  });

  return { meta, runService, run, userId: user.id };
}

interface DriveResult {
  run: LlmRun | null;
  job: { id: string };
  events: RealtimeEvent[];
  logs: string[];
  scripted: ScriptedClient;
  capturedKeys: (string | undefined)[];
}

async function driveJob(
  fixture: Fixture,
  script: readonly ScriptStep[],
  opts: { maxAttempts?: number; scriptedOptions?: Parameters<typeof makeScriptedClient>[1] } = {},
): Promise<DriveResult & { worker: JobWorker }> {
  const { meta, runService, run, userId } = fixture;
  const scripted = makeScriptedClient(script, opts.scriptedOptions);
  const capturedKeys: (string | undefined)[] = [];

  const resolve = createProviderResolver({
    meta,
    keyCrypto,
    allowedTemplates: ALLOWED.templates,
    allowedWidgets: ALLOWED.widgets,
    createClient: (config) => {
      capturedKeys.push(config.apiKey);
      return scripted.client;
    },
  });

  const registry = createJobRegistry();
  registerLlmRunHandler(registry, { meta, resolve, runService });

  const logs: string[] = [];
  const logger: WorkerLogger = {
    info: (obj, msg) => logs.push(JSON.stringify({ obj, msg })),
    warn: (obj, msg) => logs.push(JSON.stringify({ obj, msg })),
    error: (obj, msg) => logs.push(JSON.stringify({ obj, msg })),
  };

  const hub = new RealtimeHub();
  const clock = makeClock();
  const worker = new JobWorker({ meta, registry, hub, now: clock.now, workerId: 'test:1', logger });

  const job = await jobsRepo(meta).enqueue(
    { kind: LLM_RUN_KIND, payload: { runId: run.id, userId }, maxAttempts: opts.maxAttempts ?? 1 },
    clock.now(),
  );
  const { events } = collectChannel(hub, jobChannel(job.id));

  await worker.runOnce();

  return {
    run: await runService.getRun(run.id),
    job,
    events,
    logs,
    scripted,
    capturedKeys,
    worker,
  };
}

function progressSteps(events: readonly RealtimeEvent[]): string[] {
  return events
    .filter((event) => event.type === 'progress')
    .map((event) => (event.data as { step: string | null }).step ?? '');
}

describe('llm-run job — happy path', () => {
  it('validates a clean reply and records tokens + duration', async () => {
    const fixture = await createFixture();
    const { run, events, scripted } = await driveJob(fixture, [
      { text: validOrdersResponse(fixture.run.id), usage: { inputTokens: 1200, outputTokens: 340 } },
    ]);

    expect(run?.status).toBe('validated');
    expect(run?.validationStatus).toBe('valid');
    expect(run?.tokensIn).toBe(1200);
    expect(run?.tokensOut).toBe(340);
    expect(run?.durationMs).not.toBeNull();
    expect(run?.chunksReceived).toBe(1);
    expect((run?.responseJson as { tables: unknown[] }).tables).toHaveLength(1);

    expect(scripted.calls).toHaveLength(1);
    expect(scripted.calls[0]?.temperature).toBe(0);

    expect(progressSteps(events)).toEqual(['building', 'sending', 'validating', 'chunk-done', 'done']);
    const doneEvent = events.find(
      (event) => event.type === 'progress' && (event.data as { step: string }).step === 'done',
    );
    expect((doneEvent?.data as { message: string }).message).toMatch(/Done: \d+ suggestions/);
    expect(events.at(-1)?.type).toBe('completed');
  });
});

describe('llm-run job — repair loop (§7.5)', () => {
  it('repairs a malformed first reply and validates', async () => {
    const fixture = await createFixture();
    const { run, events, scripted } = await driveJob(fixture, [
      { text: MALFORMED_REPLY },
      { text: validOrdersResponse(fixture.run.id) },
    ]);

    expect(run?.status).toBe('validated');
    expect(scripted.calls).toHaveLength(2);
    // The repair turn re-sent the conversation with the model's bad output.
    expect(scripted.calls[1]?.messages).toHaveLength(3);
    expect(progressSteps(events)).toContain('repairing');
    const repairing = events.find(
      (event) => event.type === 'progress' && (event.data as { step: string }).step === 'repairing',
    );
    expect((repairing?.data as { message: string }).message).toBe('Repairing (1/2)');
  });

  it('fails the run after three consecutive failures with the errors preserved', async () => {
    const fixture = await createFixture();
    const { run, scripted } = await driveJob(fixture, [
      { text: MALFORMED_REPLY },
      { text: MALFORMED_REPLY },
      { text: MALFORMED_REPLY },
    ]);

    expect(run?.status).toBe('failed');
    expect(run?.validationStatus).toBe('invalid');
    expect(scripted.calls).toHaveLength(3);
    expect(Array.isArray(run?.validationErrors)).toBe(true);
    expect((run?.validationErrors as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('llm-run job — LLM_TRUNCATED escalation (§7.5)', () => {
  it('raises maxTokens to the ceiling before counting a repair', async () => {
    const fixture = await createFixture();
    const { run, events, scripted } = await driveJob(fixture, [
      { text: TRUNCATED_REPLY },
      { text: validOrdersResponse(fixture.run.id) },
    ]);

    expect(run?.status).toBe('validated');
    expect(scripted.calls).toHaveLength(2);
    // Initial budget from settings (100) → the anthropic ceiling (64000).
    expect(scripted.calls[0]?.maxTokens).toBe(100);
    expect(scripted.calls[1]?.maxTokens).toBe(64000);
    // No repair turn was sent — the retry re-uses the single user message.
    expect(scripted.calls[1]?.messages).toHaveLength(1);
    const steps = progressSteps(events);
    expect(steps).toContain('truncation-retry');
    expect(steps).not.toContain('repairing');
  });
});

describe('llm-run job — provider failure', () => {
  it('fails the run on a provider transport error', async () => {
    const fixture = await createFixture();
    const error = new ProviderError({ provider: 'anthropic', code: 'auth', message: 'invalid key' });
    const { run, scripted } = await driveJob(fixture, [{ throw: error }]);

    expect(run?.status).toBe('failed');
    expect(scripted.calls).toHaveLength(1);
    const errors = run?.validationErrors as { kind?: string; code?: string }[];
    expect(errors[0]).toMatchObject({ kind: 'provider', code: 'auth' });
  });
});

describe('llm-run job — cancellation (§10.2)', () => {
  it('discards the run and cancels the job when aborted mid-flight', async () => {
    const fixture = await createFixture();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { meta, runService, run, userId } = fixture;
    const scripted = makeScriptedClient([{ text: validOrdersResponse(run.id) }], {
      beforeReply: async () => {
        await gate;
      },
    });
    const resolve = createProviderResolver({
      meta,
      keyCrypto,
      allowedTemplates: ALLOWED.templates,
      allowedWidgets: ALLOWED.widgets,
      createClient: () => scripted.client,
    });
    const registry = createJobRegistry();
    registerLlmRunHandler(registry, { meta, resolve, runService });
    const hub = new RealtimeHub();
    const clock = makeClock();
    const worker = new JobWorker({ meta, registry, hub, now: clock.now, workerId: 'test:1' });
    const job = await jobsRepo(meta).enqueue(
      { kind: LLM_RUN_KIND, payload: { runId: run.id, userId } },
      clock.now(),
    );
    const { events } = collectChannel(hub, jobChannel(job.id));

    const pass = worker.runOnce();
    await until(() =>
      events.some(
        (event) => event.type === 'progress' && (event.data as { step: string }).step === 'sending',
      ),
    );
    expect(worker.requestCancel(job.id)).toBe(true);
    release();
    await pass;

    expect((await runService.getRun(run.id))?.status).toBe('discarded');
    expect((await jobsRepo(meta).findById(job.id))?.status).toBe('cancelled');
  });
});

describe('llm-run job — telemetry-free guarantees (§9, §10)', () => {
  it('sends temperature 0 and never leaks the API key to logs or events', async () => {
    const fixture = await createFixture();
    const { events, logs, scripted, capturedKeys } = await driveJob(fixture, [
      { text: validOrdersResponse(fixture.run.id) },
    ]);

    // The key WAS resolved + decrypted (proving the path ran)…
    expect(capturedKeys).toEqual([SECRET_KEY]);
    // …but every provider call pinned temperature 0…
    scripted.calls.forEach((call) => expect(call.temperature).toBe(0));
    // …and the secret appears in NO realtime event or log line.
    const haystack = [...events.map((event) => JSON.stringify(event)), ...logs].join('\n');
    expect(haystack).not.toContain(SECRET_KEY);
  });

  it('rejects a BYO run (direct-only) without touching it', async () => {
    const fixture = await createFixture({ mode: 'byo' });
    const { run, job, scripted } = await driveJob(fixture, [
      { text: validOrdersResponse(fixture.run.id) },
    ]);

    // No provider call, run untouched (still draft), job dead-lettered.
    expect(scripted.calls).toHaveLength(0);
    expect(run?.status).toBe('draft');
    const jobRow = await jobsRepo(fixture.meta).findById(job.id);
    expect(jobRow?.status).toBe('failed');
    expect(jobRow?.lastError).toContain('requires a provider run');
  });
});
