/**
 * Regression suite for the M10 self-host defects (v0.5 gate).
 *
 * Every test here corresponds to a bug that shipped past the existing suites,
 * and each one is written against THE THING THE SUITE MISSED — usually because
 * the old test did, in its harness, something no production caller does. So
 * these deliberately drive the real composition root and the real seams rather
 * than pre-arranging the state the bug was about.
 */

import BetterSqlite3 from 'better-sqlite3';
import {
  applyMigrations,
  createSqliteMetaDb,
  isBootstrapRequired,
  rolesRepo,
  usersRepo,
  type MetaDb,
} from '@adminium/meta';
import { describe, expect, it, vi } from 'vitest';

import { hashPassword } from '../src/auth/passwords.js';
import { composeServer, TELEMETRY_SCHEDULE_NAME } from '../src/compose.js';
import { ADAPTER_PACKAGES } from '../src/connections/register-adapters.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { createSetupService } from '../src/setup/service.js';
import { COMMANDS, findCommand, wantsHelp } from '../src/cli/run.js';
import { allowlistCandidates, BUNDLED_VOCABULARY_FILE } from '../src/cli/allowlist.js';
import { startCommand } from '../src/cli/commands/start.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { fakeDeps, fakeIo, fakeRuntime } from './cli-helpers.js';
import { makeEnv } from './helpers.js';

function memoryMeta(): MetaDb {
  return createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
}

function storeHandle(meta: MetaDb): MetaStoreHandle {
  return {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
}

// ─── F1: every boot path must seed the built-in roles ─────────────────────────

describe('bootstrap: the built-in roles exist on a real boot', () => {
  it('`adminium start` bootstraps with firstRun, not a bare applyMigrations', async () => {
    // The bug: start.ts ran `applyMigrations` alone. No migration seeds
    // `adminium_roles`, so `super-admin` never existed and the first-run wizard's
    // POST /setup/super-admin 500'd — permanently, because the failure rolled the
    // claim back too, so every retry re-failed and the instance could never have
    // an account. Asserting on the ROLE ROW rather than on which function was
    // called: what matters is the state a boot leaves behind.
    const meta = memoryMeta();
    const runtime = fakeRuntime({ metaStore: storeHandle(meta) });
    const deps = fakeDeps({ runtime });
    const io = fakeIo();

    await startCommand.run({ io, deps, argv: [] });

    expect(await rolesRepo(meta).findBySlug('super-admin')).not.toBeNull();
    // Same root cause, second victim: seedSystemSettings never ran, so the
    // instance had no `system.instanceId` and telemetry could never report.
    const instanceId = await meta.db
      .selectFrom('adminium_settings')
      .select('key')
      .where('key', '=', 'system.instanceId')
      .executeTakeFirst();
    expect(instanceId).toBeDefined();
    await meta.db.destroy();
  });

  it('the setup service seeds the roles itself, so no front door can 500', async () => {
    // Defense in depth for the state above: a store that has ONLY been migrated
    // (`start --skip-migrate` after `adminium migrate`, an embedder calling
    // buildServer directly) must still be able to create the first super admin.
    const meta = memoryMeta();
    await applyMigrations(meta.db, { dialect: meta.dialect });
    expect(await rolesRepo(meta).findBySlug('super-admin')).toBeNull();

    const service = createSetupService({ meta, hashPassword });
    const user = await service.createSuperAdmin({
      email: 'ada@adminium.test',
      password: 'correct-horse-battery',
    });

    expect(user.email).toBe('ada@adminium.test');
    expect(await usersRepo(meta).count()).toBe(1);
    await meta.db.destroy();
  });
});

// ─── F5 + F2: the composition root serves the whole API ───────────────────────

describe('composition root (compose.ts)', () => {
  async function compose(meta: MetaDb, envOverrides: Record<string, string> = {}) {
    const manager = new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret('a-sufficiently-long-test-secret'),
      metaDsn: null,
    });
    const runService = createRunService({ meta });
    return composeServer({
      env: makeEnv(envOverrides),
      metaStore: storeHandle(meta),
      manager,
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: { templates: ['page-crud'], widgets: ['kpi-stat-card'] },
      logger: false,
      // The scheduler would otherwise hold the process open past the test.
      telemetry: false,
    });
  }

  it('serves every /api/v1 namespace the dashboard calls — not just the skeleton', async () => {
    // The bug: `startServer` used `buildServer` alone, which registers
    // system/auth/me/bootstrap/setup/about — 6 of the 17 namespaces the
    // dashboard calls. Everything else was wired ONLY in scripts/demo-v01.mjs,
    // so `adminium start` and `docker run` served an API whose connect wizard
    // 404'd. 401 is the PASS here: it means the route exists and the auth guard
    // ran. 404 is the failure this pins.
    const meta = memoryMeta();
    const { app } = await compose(meta);
    await app.ready();

    const routes = [
      ['GET', '/api/v1/connections'],
      ['GET', '/api/v1/pages/p_missing'],
      ['GET', '/api/v1/settings/defaults'],
      ['GET', '/api/v1/roles'],
      ['GET', '/api/v1/api-keys'],
      ['GET', '/api/v1/audit'],
      ['GET', '/api/v1/jobs'],
      ['GET', '/api/v1/onboarding'],
      ['GET', '/api/v1/llm/runs'],
    ] as const;
    for (const [method, url] of routes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode, `${method} ${url} must be registered`).not.toBe(404);
    }

    await app.close();
    await meta.db.destroy();
  });

  /**
   * The M11 repeat of the bug this whole describe block exists for.
   *
   * `desktopRoutes` (§9's backup) was written, exported from `src/index.ts`,
   * and covered by a suite that registered the plugin ITSELF — so every gate
   * stayed green while `compose.ts` registered it nowhere and the File menu's
   * "Back up now…" would have 404'd on a shipped build. An injected-dependency
   * test structurally cannot catch that: it injects its own deps and never
   * exercises the production wiring. Hence this pair, driving the real
   * `composeServer` with only an env difference between them.
   */
  it('registers every §6/§8/§9 desktop route under the desktop runtime', async () => {
    const meta = memoryMeta();
    const { app, ...flags } = await compose(meta, {
      ADMINIUM_RUNTIME: 'desktop',
      ADMINIUM_BOOT_TOKEN: 'b'.repeat(64),
      ADMINIUM_DEMO_SEED_SCRIPT: '/nonexistent/demo-seed.mjs',
    });
    await app.ready();

    // 401/403/422 all PASS: the route exists and a gate ran. 404 is the failure
    // this pins — the seed script above is deliberately absent to prove the
    // route's EXISTENCE does not depend on the work it would do succeeding.
    const routes = [
      ['POST', '/api/v1/desktop/backup'],
      ['POST', '/api/v1/desktop/demo-database'],
      ['POST', '/api/v1/desktop/local-database'],
      ['GET', '/api/v1/desktop/lan-share'],
      ['POST', '/api/v1/auth/desktop-session'],
    ] as const;
    for (const [method, url] of routes) {
      const res = await app.inject({ method, url, payload: {} });
      expect(res.statusCode, `${method} ${url} must be registered on desktop`).not.toBe(404);
    }

    // The reported flags must agree with the routes that actually exist —
    // a caller reads these rather than re-deriving them from env.
    expect(flags.desktopBackupEnabled).toBe(true);
    expect(flags.desktopSessionEnabled).toBe(true);
    expect(flags.desktopLanEnabled).toBe(true);
    expect(flags.desktopLocalDbEnabled).toBe(true);
    expect(flags.desktopDemoEnabled).toBe(true);

    await app.close();
    await meta.db.destroy();
  });

  it('registers NO desktop route on self-host — an absent route cannot be bypassed', async () => {
    // The other half, and the security-relevant one. Gate 1 of each desktop
    // route is compose refusing to register it off-desktop; §5's boot-token
    // door mints a super-admin session without a password, and §9's backup is
    // every row in every database in one request. On Docker/npx they must not
    // exist at all — a stronger guarantee than any in-handler runtime check.
    const meta = memoryMeta();
    const { app, ...flags } = await compose(meta);
    await app.ready();

    const routes = [
      ['POST', '/api/v1/desktop/backup'],
      ['POST', '/api/v1/desktop/demo-database'],
      ['POST', '/api/v1/desktop/local-database'],
      ['GET', '/api/v1/desktop/lan-share'],
      ['POST', '/api/v1/auth/desktop-session'],
    ] as const;
    for (const [method, url] of routes) {
      const res = await app.inject({ method, url, payload: {} });
      expect(res.statusCode, `${method} ${url} must NOT exist off-desktop`).toBe(404);
    }

    expect(flags.desktopBackupEnabled).toBe(false);
    expect(flags.desktopSessionEnabled).toBe(false);
    expect(flags.desktopLanEnabled).toBe(false);
    expect(flags.desktopLocalDbEnabled).toBe(false);
    expect(flags.desktopDemoEnabled).toBe(false);

    // …while the ordinary API is unaffected: this is a targeted absence, not a
    // server that failed to compose.
    const alive = await app.inject({ method: 'GET', url: '/api/v1/connections' });
    expect(alive.statusCode).toBe(401);

    await app.close();
    await meta.db.destroy();
  });

  it('registers the telemetry report on the scheduler (the consent toggle now does something)', async () => {
    // The bug: `createTelemetryService` was constructed nowhere but tests, so
    // the first-run consent screen wrote `telemetry.enabled` and nothing ever
    // read it to report. Failed safe, but promised a behavior the build did not
    // implement.
    const meta = memoryMeta();
    const manager = new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret('a-sufficiently-long-test-secret'),
      metaDsn: null,
    });
    const runService = createRunService({ meta });
    const { app, jobs } = await composeServer({
      env: makeEnv(),
      metaStore: storeHandle(meta),
      manager,
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: null,
      logger: false,
    });
    await app.ready();

    expect(jobs.scheduler.names()).toContain(TELEMETRY_SCHEDULE_NAME);
    // And it is a REAL schedule with a next tick, not a registered no-op.
    expect(jobs.scheduler.nextRun(TELEMETRY_SCHEDULE_NAME)).toBeInstanceOf(Date);

    await app.close();
    await meta.db.destroy();
  });

  it('boots without the widget vocabulary — CRUD must not depend on AI assist', async () => {
    const meta = memoryMeta();
    const manager = new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret('a-sufficiently-long-test-secret'),
      metaDsn: null,
    });
    const runService = createRunService({ meta });
    const { app, llmEnabled } = await composeServer({
      env: makeEnv(),
      metaStore: storeHandle(meta),
      manager,
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: null,
      logger: false,
      telemetry: false,
    });
    await app.ready();

    expect(llmEnabled).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/v1/connections' })).statusCode).not.toBe(
      404,
    );

    await app.close();
    await meta.db.destroy();
  });
});

// ─── F15: /readyz is a real dependency check ──────────────────────────────────

describe('probes', () => {
  it('/readyz reports the meta store, unlike the liveness /healthz', async () => {
    const meta = memoryMeta();
    const manager = new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret('a-sufficiently-long-test-secret'),
      metaDsn: null,
    });
    const runService = createRunService({ meta });
    const { app } = await composeServer({
      env: makeEnv(),
      metaStore: storeHandle(meta),
      manager,
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: null,
      logger: false,
      telemetry: false,
    });
    await app.ready();

    const ready = await app.inject({ method: 'GET', url: '/api/v1/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json<{ checks: { meta: string } }>().checks.meta).toBe('ok');

    // Kill the store. THE POINT: /healthz cannot tell, /readyz must.
    await meta.db.destroy();

    const live = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(live.statusCode).toBe(200);
    expect(live.json<{ ok: boolean }>().ok).toBe(true);

    const dead = await app.inject({ method: 'GET', url: '/api/v1/readyz' });
    expect(dead.statusCode).toBe(503);
    expect(dead.json<{ checks: { meta: string } }>().checks.meta).toBe('unreachable');

    await app.close();
  });
});

// ─── F8: all three engines are composed in ────────────────────────────────────

describe('adapter registration', () => {
  it('registers all three v1 engines, not postgres alone', () => {
    // The bug: only adapter-postgres was listed, while `adminium init` offers
    // MySQL and SQLite — so those wizard paths died at `manager.testDsn` on the
    // registry's bare UNSUPPORTED error, after every question had been answered.
    expect([...ADAPTER_PACKAGES].sort()).toEqual([
      '@adminium/adapter-mysql',
      '@adminium/adapter-postgres',
      '@adminium/adapter-sqlite',
    ]);
  });
});

// ─── F7: the vocabulary resolves inside a deployed artifact ───────────────────

describe('LLM allow-list resolution', () => {
  it('probes the package-local snapshot FIRST', () => {
    // The bug: the only candidates were a node_modules path and a monorepo
    // `packages/` path. `@adminium/widgets` is `private: true` and not a server
    // dependency, so NEITHER exists in the Docker image or an npm tarball —
    // both LLM subcommands were dead in every deployed artifact, hinting at a
    // `pnpm --filter` command a container user cannot run. The build now emits a
    // JSON snapshot into the package (scripts/bundle-allowlists.mjs).
    const candidates = allowlistCandidates();
    expect(candidates[0]?.endsWith(BUNDLED_VOCABULARY_FILE)).toBe(true);
    expect(candidates.length).toBeGreaterThan(1); // dev-checkout fallbacks remain
  });
});

// ─── F10: help matching only in flag position ─────────────────────────────────

describe('CLI help detection', () => {
  it('does not treat a flag VALUE of "help" as a help request', () => {
    // The bug: a blind `argv.some(a => HELP_FLAGS.has(a))` matched values too, so
    // `adminium init --name help` (a connection named "help") and
    // `adminium import-zip --in help` (a bundle file named `help`) printed help
    // and returned EXIT_OK — a silent no-op a calling script reads as success.
    const init = findCommand('init');
    const importZip = findCommand('import-zip');
    expect(init).toBeDefined();
    expect(importZip).toBeDefined();

    expect(wantsHelp(['--name', 'help'], init!)).toBe(false);
    expect(wantsHelp(['--in', 'help'], importZip!)).toBe(false);
    expect(wantsHelp(['-i', 'help'], importZip!)).toBe(false);

    // Real requests still work, in every documented shape.
    expect(wantsHelp(['--help'], init!)).toBe(true);
    expect(wantsHelp(['-h'], init!)).toBe(true);
    expect(wantsHelp(['help'], init!)).toBe(true);
    expect(wantsHelp(['--in', 'bundle.zip', '--help'], importZip!)).toBe(true);
    // `--in=help` carries its own value and consumes nothing after it.
    expect(wantsHelp(['--in=help'], importZip!)).toBe(false);
  });

  it('every command is reachable and self-documenting', () => {
    for (const command of COMMANDS) {
      expect(wantsHelp(['--help'], command)).toBe(true);
    }
  });
});

// ─── F11: the meta drivers ship with the server ───────────────────────────────

describe('packaging', () => {
  it('declares the meta-store drivers on the SERVER package', async () => {
    // The bug: `src/meta/store.ts` resolves `pg` / `mysql2` with a BARE import,
    // which resolves against the importing package's node_modules. They belonged
    // to the adapter packages, and the Dockerfile's isolated `pnpm deploy` tree
    // put them under .pnpm where /app/dist cannot reach them — so the published
    // image could open no meta store but embedded SQLite, while
    // docker-compose.yml documents a postgres one. Crash-loop, with `npm install
    // pg` as the printed remedy inside a non-root image.
    const pkg = (await import('../package.json', { with: { type: 'json' } })).default as {
      optionalDependencies?: Record<string, string>;
      dependencies: Record<string, string>;
    };
    const declared = { ...pkg.dependencies, ...pkg.optionalDependencies };
    expect(declared).toHaveProperty('pg');
    expect(declared).toHaveProperty('mysql2');
    // The adapters must resolve from the server too — the wizard offers all 3.
    expect(pkg.dependencies).toHaveProperty('@adminium/adapter-mysql');
    expect(pkg.dependencies).toHaveProperty('@adminium/adapter-sqlite');
  });

  it('ships the vocabulary snapshot in the published tarball', async () => {
    const pkg = (await import('../package.json', { with: { type: 'json' } })).default as {
      files: string[];
      scripts: Record<string, string>;
    };
    expect(pkg.files).toContain('vocabulary');
    // prepack must EMIT it, or `files` ships an empty promise.
    expect(pkg.scripts.prepack).toContain('bundle-allowlists.mjs');
  });
});

// ─── F3: the bootstrap claim never leaves the instance ────────────────────────

describe('export redaction: instance identity', () => {
  it('never exports a non-portable settings key', async () => {
    const { INSTANCE_IDENTITY_SETTINGS, redactSettings } = await import('../src/export/redaction.js');

    // The bug: INSTANCE_IDENTITY_SETTINGS was a hand-written deny-list of two,
    // and `system.superAdminCreatedAt` — added in the same wave — was not on it.
    // A full-instance bundle carried the once-only claim, and importing it into
    // a fresh install left ZERO users with /setup/* closed forever: an instance
    // nobody can ever log into. The list is derived from the registry now.
    expect(INSTANCE_IDENTITY_SETTINGS).toContain('system.superAdminCreatedAt');
    expect(INSTANCE_IDENTITY_SETTINGS).toContain('system.instanceId');
    expect(INSTANCE_IDENTITY_SETTINGS).toContain('system.bootstrappedAt');

    const { rows } = redactSettings(
      [
        { key: 'system.superAdminCreatedAt', value: 1 },
        { key: 'system.instanceId', value: 'inst_source' },
        { key: 'system.bootstrappedAt', value: 1 },
        { key: 'branding.appName', value: 'Ava Ops' },
      ],
      false,
    );
    expect(rows.map((row) => row.key)).toEqual(['branding.appName']);
  });

  it('leaves an imported-into instance still able to create its super admin', async () => {
    // The end-to-end consequence, asserted where the user feels it.
    const { redactSettings } = await import('../src/export/redaction.js');
    const target = memoryMeta();
    const { settingsRepo } = await import('@adminium/meta');
    const { firstRun } = await import('@adminium/meta');
    await firstRun(target);

    // Replay what an import would write, through the same redaction the export
    // applies — the claim must simply not be in it.
    const exported = redactSettings(
      [
        { key: 'system.superAdminCreatedAt', value: 1_700_000_000_000 },
        { key: 'branding.appName', value: 'Ava Ops' },
      ],
      false,
    );
    for (const row of exported.rows) {
      await settingsRepo(target).set(row.key as never, row.value as never);
    }

    expect(await usersRepo(target).count()).toBe(0);
    expect(await isBootstrapRequired(target)).toBe(true);
    await target.db.destroy();
  });
});

// ─── F6: --dry-run writes nothing ─────────────────────────────────────────────

describe('apply-llm-response --dry-run', () => {
  it('does not persist the response or advance the run', async () => {
    // The bug: `receiveResponse` was called BEFORE the `if (dryRun)` guard, so
    // the flag whose help says "write nothing" committed the response and
    // flipped the run to `validated` — after which no different response could
    // ever be pasted. The old test mocked receiveResponse and only checked that
    // applyRun was not called, so it could not see this.
    const { applyLlmResponseCommand } = await import('../src/cli/commands/apply-llm-response.js');
    const runtime = fakeRuntime();
    const receive = vi.fn(async () => ({
      run: { id: 'r1', status: 'validated', chunksReceived: 1, chunksTotal: 1 },
      validation: { response: {}, errors: [], warnings: [] },
    }));
    (runtime.runService as unknown as Record<string, unknown>).getRun = vi.fn(async () => ({
      id: 'r1',
      status: 'awaiting_response',
      connectionId: 'c1',
      chunksReceived: 0,
      chunksTotal: 1,
    }));
    (runtime.runService as unknown as Record<string, unknown>).receiveResponse = receive;
    (runtime.promptService as unknown as Record<string, unknown>).loadLatestModel = vi.fn(
      async () => ({ snapshotId: 's1', model: {} }),
    );
    (runtime.applyService as unknown as Record<string, unknown>).buildPlanForRun = vi.fn(
      async () => ({ diff: [] }),
    );

    const deps = fakeDeps({ runtime });
    const io = fakeIo();
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'adminium-dryrun-'));
    const file = join(dir, 'resp.json');
    await writeFile(file, '{}', 'utf8');

    await applyLlmResponseCommand.run({
      io,
      deps,
      argv: ['--run', 'r1', '--file', file, '--dry-run'],
    });

    // The CLI must ask the SERVICE not to write, not decide afterwards.
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive.mock.calls[0]?.[1]).toMatchObject({ dryRun: true });
  });
});
