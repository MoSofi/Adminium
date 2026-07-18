/**
 * BYO telemetry-free guarantee (06-llm-assist.md §9 / §9.1, acceptance #9 + #1).
 *
 * Drives the WHOLE BYO round-trip over the real `/api/v1/llm/*` routes on an
 * in-memory SQLite meta store — `POST /runs` (build the prompt) → `POST
 * /runs/:id/response` (paste + validate) → `POST /runs/:id/apply` (transactional
 * executor) — with ALL outbound network disabled and asserts that NO interception
 * ever occurs (§9.1). The doc names an `undici` MockAgent with `net.connect` off;
 * `undici` is not a dependency of this repo, so we install the same guarantee
 * directly: `globalThis.fetch`, `net.connect`/`createConnection`,
 * `Socket.prototype.connect` and `http(s).request` are all replaced with
 * recording throwers for the duration of the flow. Because the BYO path performs
 * zero network I/O the flow completes and every recorder stays at zero; a single
 * stray call would both throw (failing the round-trip) and be recorded.
 *
 * Also asserts, for the same BYO run:
 *  - `adminium_llm_runs.provider` / `.model` stay NULL (§9, never recorded — the
 *    metering-free signal: no AI-credit/metering code runs on the BYO path);
 *  - the prompt served by `POST /runs` is byte-identical to what the DIRECT path
 *    would send (acceptance #1): the direct runner reconstructs its per-message
 *    `system`/`user` from the very same stored `prompt_text` via
 *    `parsePromptChunks`, and re-flattening those equals the served BYO document.
 *
 * No live source database and no provider network anywhere: the meta store is
 * `better-sqlite3` (a native file/`:memory:` handle — no sockets) and the app is
 * driven with `app.inject` (in-memory, no listening socket), so disabling the
 * network cannot disturb the harness itself.
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

import BetterSqlite3 from 'better-sqlite3';
import { llmKeyCryptoFromSecret } from '@adminium/llm';
import {
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  llmOverridesRepo,
  llmRunsRepo,
  pagesRepo,
  rolesRepo,
  snapshotsRepo,
  usersRepo,
  type DsnCrypto,
  type MetaDb,
  type Role,
  type User,
} from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { decryptSecret, deriveKey, encryptSecret } from '../src/config/secrets.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { parsePromptChunks } from '../src/jobs/llm-run.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { llmRoutes } from '../src/routes/llm/index.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

// ─── Fixtures (the Wave-1 demo golden — same corpus the apply executor test uses) ──

function fixture(relative: string): string {
  return readFileSync(new URL(`./fixtures/llm/${relative}`, import.meta.url), 'utf8');
}
const demoSchemaIr = JSON.parse(fixture('demo-schema.json'));
/** A clean, referentially-valid 2-locale response for the demo shop schema. */
const VALID_DEMO_TEXT = fixture('responses/valid-demo.json');

/** The demo golden requests both locales; the run MUST request the same set. */
const RUN_LOCALES = ['en_US', 'de_DE'] as const;

const testDsnCrypto: DsnCrypto = {
  encrypt: (plaintext) => `enc:test:${Buffer.from(plaintext, 'utf8').toString('base64')}`,
  decrypt: (token) => Buffer.from(token.slice('enc:test:'.length), 'base64').toString('utf8'),
};

/** The allow-lists the demo golden binds to (mirrors llm-routes.test.ts). */
const ALLOWED = {
  templates: ['page-crud', 'page-dashboard', 'page-queue-inbox', 'page-board', 'page-directory'],
  widgets: ['kpi-stat-card', 'chart-line-area', 'chart-donut', 'top-movers-list'],
};

// ─── Network kill-switch (§9.1: "net.connect disabled … assert no interception") ──

interface NetGuard {
  /** Every outbound attempt seen while disabled — must stay empty on the BYO path. */
  attempts: string[];
  restore: () => void;
}

function describeTarget(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof URL) return arg.href;
  if (arg !== null && typeof arg === 'object') {
    const req = arg as { url?: unknown; host?: unknown; hostname?: unknown; port?: unknown };
    if (typeof req.url === 'string') return req.url;
    const host = req.hostname ?? req.host;
    if (typeof host === 'string') return `${host}${req.port === undefined ? '' : `:${String(req.port)}`}`;
  }
  return '<unknown>';
}

/**
 * Disable every outbound-network entry point (fetch + node net/http/https),
 * recording any attempt. Returns a guard whose `attempts` MUST be empty after
 * a BYO flow and whose `restore()` the caller runs in a `finally`.
 */
function disableNetwork(): NetGuard {
  const attempts: string[] = [];
  const thrower =
    (label: string) =>
    (...args: unknown[]): never => {
      const target = describeTarget(args[0]);
      attempts.push(`${label} → ${target}`);
      throw new Error(`network disabled (BYO §9): blocked ${label} to ${target}`);
    };

  const g = globalThis as { fetch: typeof globalThis.fetch };
  const originalFetch = g.fetch;
  const netMod = net as unknown as Record<string, unknown>;
  const httpMod = http as unknown as Record<string, unknown>;
  const httpsMod = https as unknown as Record<string, unknown>;
  const originals = {
    connect: netMod.connect,
    createConnection: netMod.createConnection,
    socketConnect: net.Socket.prototype.connect,
    httpRequest: httpMod.request,
    httpsRequest: httpsMod.request,
  };

  g.fetch = thrower('fetch') as unknown as typeof globalThis.fetch;
  netMod.connect = thrower('net.connect');
  netMod.createConnection = thrower('net.createConnection');
  (net.Socket.prototype as unknown as { connect: unknown }).connect = thrower('socket.connect');
  httpMod.request = thrower('http.request');
  httpsMod.request = thrower('https.request');

  return {
    attempts,
    restore: () => {
      g.fetch = originalFetch;
      netMod.connect = originals.connect;
      netMod.createConnection = originals.createConnection;
      (net.Socket.prototype as unknown as { connect: unknown }).connect = originals.socketConnect;
      httpMod.request = originals.httpRequest;
      httpsMod.request = originals.httpsRequest;
    },
  };
}

// ─── Harness ────────────────────────────────────────────────────────────────────

interface Harness {
  app: AdminiumServer;
  meta: MetaDb;
  admin: User;
  connectionId: string;
  /**
   * Recording stand-in for the PRODUCTION stats collector wired in compose
   * (llm/stats-collector.ts — it opens the SOURCE database). Prompt build
   * (§4.2) legitimately calls it ONCE per POST /runs; `armed` makes any later
   * call throw, so a paste/diff/apply that re-acquires the source DB both
   * fails its request and shows up in `calls`.
   */
  statsRecorder: { calls: number; armed: boolean };
}

function asUser(user: User): Record<string, string> {
  return { 'x-test-user-id': user.id };
}

async function buildHarness(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const roles = rolesRepo(meta);
  const users = usersRepo(meta);
  const adminRole: Role | null = await roles.findBySlug('admin');
  if (adminRole === null) throw new Error('missing built-in role admin');
  const admin = await users.create({
    email: 'noah@adminium.test',
    name: 'Noah',
    passwordHash: 'test-hash',
    status: 'active',
  });
  await roles.assignToUser(admin.id, adminRole.id);

  const connection = await connectionsRepo(meta, testDsnCrypto).create({
    name: 'shop',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@localhost/shop',
  });
  await snapshotsRepo(meta).create({
    connectionId: connection.id,
    source: 'introspection',
    schema: demoSchemaIr,
    checksum: 'sha-shop-1',
  });
  // The generated CRUD pages the nav-group re-placement lands on (§8.3).
  for (const table of ['public.customers', 'public.products', 'public.orders']) {
    await pagesRepo(meta).create({
      connectionId: connection.id,
      slug: table.slice(table.indexOf('.') + 1),
      type: 'page-crud',
      title: table,
      origin: 'generated',
      config: { source: { connectionId: connection.id, table } },
    });
  }

  const keyCrypto = llmKeyCryptoFromSecret(TEST_SECRET, { deriveKey, encryptSecret, decryptSecret });
  const runService = createRunService({ meta });
  const applyService = createApplyService({ meta, runService });

  const app = await buildServer({ env: makeEnv(), logger: false });
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-test-user-id'];
    if (typeof id === 'string') {
      const user = await users.findById(id);
      if (user !== null) {
        (request as unknown as { user: { id: string; name: string; email: string } }).user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };
      }
    }
  });
  await app.register(rbacPlugin, { meta });
  const statsRecorder = { calls: 0, armed: false };
  const recordingCollector = async (): Promise<never[]> => {
    statsRecorder.calls += 1;
    if (statsRecorder.armed) {
      throw new Error('collectStats invoked after prompt build — §9 BYO isolation violated');
    }
    return [];
  };
  await app.register(
    async (api) => {
      // No `createClient`, no provider resolver, no jobs runtime are wired: the
      // BYO path must reach `applied` without ever needing any of them. The
      // recording collector occupies the SAME injection point compose wires the
      // real source-DB collector into, pinning §9 against route re-wiring.
      await api.register(
        llmRoutes({
          meta,
          runService,
          applyService,
          keyCrypto,
          allowed: ALLOWED,
          collectStats: recordingCollector,
        }),
      );
    },
    { prefix: '/api/v1' },
  );
  await app.ready();

  return { app, meta, admin, connectionId: connection.id, statsRecorder };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BYO round-trip — telemetry-free guarantee (§9, acceptance #9)', () => {
  let t: Harness;
  beforeEach(async () => {
    t = await buildHarness();
  });
  afterEach(async () => {
    await t.app.close();
    await t.meta.db.destroy();
  });

  it('createRun → receiveResponse → apply completes with ALL outbound network disabled, no interception', async () => {
    const guard = disableNetwork();
    let runId: string;
    try {
      // 1) Build the prompt (BYO). Immediately awaits a pasted response.
      const created = await t.app.inject({
        method: 'POST',
        url: '/api/v1/llm/runs',
        headers: asUser(t.admin),
        payload: { connectionId: t.connectionId, path: 'byo', locales: RUN_LOCALES },
      });
      expect(created.statusCode, created.body).toBe(201);
      const createdBody = created.json() as { run: { id: string; mode: string } };
      runId = createdBody.run.id;
      expect(createdBody.run.mode).toBe('byo');

      // Prompt build calls the stats collector exactly once (§4.2 enrichment);
      // from here on ANY invocation is a §9 violation — arm it to throw.
      expect(t.statsRecorder.calls).toBe(1);
      t.statsRecorder.armed = true;

      // 2) Paste the golden response → validate in-process.
      const pasted = await t.app.inject({
        method: 'POST',
        url: `/api/v1/llm/runs/${runId}/response`,
        headers: asUser(t.admin),
        payload: { text: VALID_DEMO_TEXT },
      });
      expect(pasted.statusCode, pasted.body).toBe(200);
      const pastedBody = pasted.json() as { validation: { ok: boolean; errors: unknown[] } };
      expect(pastedBody.validation.ok).toBe(true);
      expect(pastedBody.validation.errors).toEqual([]);

      // 3) Apply the whole accepted set through the transactional executor.
      const diffRes = await t.app.inject({
        method: 'GET',
        url: `/api/v1/llm/runs/${runId}/diff`,
        headers: asUser(t.admin),
      });
      expect(diffRes.statusCode, diffRes.body).toBe(200);
      const accepted = (diffRes.json() as { diff: { id: string }[] }).diff.map((d) => d.id);

      const applied = await t.app.inject({
        method: 'POST',
        url: `/api/v1/llm/runs/${runId}/apply`,
        headers: asUser(t.admin),
        payload: { accepted },
      });
      expect(applied.statusCode, applied.body).toBe(200);
      const appliedBody = applied.json() as {
        run: { status: string };
        counts: { overrides: number; pages: number };
      };
      expect(appliedBody.run.status).toBe('applied');
      expect(appliedBody.counts.overrides).toBeGreaterThan(0);
      expect(appliedBody.counts.pages).toBeGreaterThan(0);
    } finally {
      guard.restore();
    }

    // The whole round-trip made ZERO outbound network attempts (§9.1: no interception).
    expect(guard.attempts).toEqual([]);

    // And the source-DB stats collector was never re-acquired after prompt
    // build: paste → diff → apply are fully in-process against the snapshot.
    expect(t.statsRecorder.calls).toBe(1);

    // The writes really landed — the executor ran with the network off.
    const overrides = await llmOverridesRepo(t.meta).listForConnection(t.connectionId);
    expect(overrides.length).toBeGreaterThan(0);
    const pages = await pagesRepo(t.meta).listForConnection(t.connectionId);
    expect(pages.some((p) => p.origin === 'llm' && p.type === 'page-dashboard')).toBe(true);
  });

  it('the BYO run records NO provider/model and no metering signal (§9)', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/v1/llm/runs',
      headers: asUser(t.admin),
      payload: { connectionId: t.connectionId, path: 'byo', locales: RUN_LOCALES },
    });
    expect(created.statusCode, created.body).toBe(201);
    const runId = (created.json() as { run: { id: string } }).run.id;

    // Over the API: the summary DTO carries provider/model NULL for BYO.
    const detail = await t.app.inject({
      method: 'GET',
      url: `/api/v1/llm/runs/${runId}`,
      headers: asUser(t.admin),
    });
    expect(detail.statusCode).toBe(200);
    const dto = detail.json() as { mode: string; provider: string | null; model: string | null };
    expect(dto.mode).toBe('byo');
    expect(dto.provider).toBeNull();
    expect(dto.model).toBeNull();

    // At rest: the persisted row is the metering-free signal — no provider/model,
    // and no per-run cost/credit accounting columns exist to have been written.
    const row = await llmRunsRepo(t.meta).findById(runId);
    expect(row?.provider ?? null).toBeNull();
    expect(row?.model ?? null).toBeNull();
    expect(row).not.toHaveProperty('creditsCharged');
    expect(row).not.toHaveProperty('cost');
  });

  it('the prompt served by POST /runs is byte-identical to what the DIRECT path sends (acceptance #1)', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/v1/llm/runs',
      headers: asUser(t.admin),
      payload: { connectionId: t.connectionId, path: 'byo', locales: RUN_LOCALES },
    });
    expect(created.statusCode, created.body).toBe(201);
    const body = created.json() as {
      run: { id: string };
      prompt: { chunks: { index: number; total: number; byo: string }[] };
    };
    const served = body.prompt.chunks;
    expect(served.length).toBeGreaterThan(0);

    // The persisted prompt_text is exactly the served BYO documents, joined by the
    // chunk separator — the single source both paths read from (§1 invariant 1).
    const row = await llmRunsRepo(t.meta).findById(body.run.id);
    const CHUNK_SEPARATOR = '\n\n=== NEXT PROMPT ===\n\n';
    expect(row?.promptText).toBe(served.map((c) => c.byo).join(CHUNK_SEPARATOR));

    // The DIRECT path reconstructs its per-message system/user from THAT stored
    // text via `parsePromptChunks`; re-flattening those messages must reproduce
    // the served BYO document byte-for-byte (identical prompt, both paths).
    const directChunks = parsePromptChunks(row?.promptText ?? '');
    expect(directChunks).toHaveLength(served.length);
    directChunks.forEach((chunk, i) => {
      const flattened = `=== SYSTEM ===\n${chunk.system}\n\n=== USER ===\n${chunk.user}`;
      expect(flattened).toBe(served[i]?.byo);
    });
  });
});
