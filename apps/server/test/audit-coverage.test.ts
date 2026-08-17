// SPDX-License-Identifier: AGPL-3.0-only
/**
 * §7-item-9 audit coverage: every state-changing route either writes an audit
 * row or says, in the source, why it does not.
 *
 * The ledger itself is a claim, so this suite does three separate things:
 *
 *  1. drives the REAL composition root and asserts no state-changing route is
 *     unmarked. That is the ratchet: a new POST/PUT/PATCH/DELETE fails here
 *     until somebody decides, in writing, whether it audits;
 *  2. pins the KNOWN GAPS to a hard-coded list — now EMPTY. `auditGap` exists
 *     so a route that should audit and does not is visibly different from one
 *     that is exempt — and pinning the list here means a gap can be removed
 *     without touching this file, but never added without editing it;
 *  3. asserts the two routes an earlier wave FIXED actually write rows, against
 *     the audit table rather than against the marker. A marker that lies is
 *     worse than no marker, so the two most privileged writes in the product
 *     are verified end to end.
 *
 * The five gaps the last wave closed are verified the same way, each next to
 * the route it belongs to rather than here: `jobs-routes.test.ts` (job.enqueue,
 * job.cancel), `bridge-routes.test.ts` (bridge_handoff*), `llm-routes.test.ts`
 * (llm.run.create, llm.run.response). Each pairs a row-lands case with a
 * refused-request case, because a marker cannot tell the two apart.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import {
  auditRepo,
  createFirstSuperAdmin,
  createSqliteMetaDb,
  firstRun,
  initMetaDb,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../src/app.js';
import {
  assertAuditCoverage,
  audited,
  auditExempt,
  auditGap,
  createAuditCoverageRegistry,
} from '../src/audit/coverage.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

/**
 * The routes that SHOULD write an audit row and do not, as of this wave.
 *
 * EMPTY, as of the wave that closed the last five (jobs enqueue/cancel, the
 * bridge hand-off, and the two LLM run routes — each with its own row-lands
 * assertion further down this file). It stays here rather than being deleted
 * because the mechanism is the point: hard-coded rather than derived from
 * `AUDIT_COVERAGE`, which would make the assertion tautological, so a new
 * `auditGap` can only ever be added by editing this file.
 */
const KNOWN_GAPS: string[] = [];

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
}

/**
 * The WIDEST topology: desktop runtime, a bridge origin, a relocation host and
 * an LLM vocabulary, so every conditionally-registered resource is present.
 * A narrower compose would let a route slip past the ratchet by simply not
 * being registered in the suite.
 */
async function composeEverything(meta: MetaDb): Promise<ComposedServer> {
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({
      ADMINIUM_RUNTIME: 'desktop',
      ADMINIUM_BOOT_TOKEN: 'a'.repeat(64),
      ADMINIUM_BRIDGE_ORIGINS: 'https://adminium.dev',
    }),
    metaStore: memoryStore(meta),
    manager: new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
    }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetDataContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => {
      /* the coverage sweep never relocates */
    },
  });
  await composed.app.ready();
  return composed;
}

let open: { close: () => Promise<void> } | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

describe('audit coverage — the ledger covers the whole route tree', () => {
  it('no state-changing /api route is unmarked', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const composed = await composeEverything(meta);
    open = {
      close: async () => {
        await composed.app.close();
        await meta.db.destroy();
      },
    };

    // `assertAuditCoverage` renders the offending routes in its message, so a
    // failure here names them rather than reporting a count.
    expect(() => {
      assertAuditCoverage(composed.app.auditCoverage);
    }).not.toThrow();

    // Sanity: the sweep really did see the whole tree. A registry that silently
    // collected nothing would also "pass" the assertion above.
    expect(composed.app.auditCoverage.rows().length).toBeGreaterThan(90);
  });

  it('the known gaps are exactly the ones on record', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const composed = await composeEverything(meta);
    open = {
      close: async () => {
        await composed.app.close();
        await meta.db.destroy();
      },
    };

    expect([...composed.app.auditCoverage.knownGaps()].sort()).toEqual([...KNOWN_GAPS].sort());
  });
});

describe('audit coverage — the registry itself', () => {
  const route = (method: string, url: string, config?: Record<string, unknown>) =>
    ({ method, url, ...(config === undefined ? {} : { config }) }) as never;

  it('a marker on the route beats the table', () => {
    const registry = createAuditCoverageRegistry({
      'POST /api/v1/thing': auditExempt('the table says this one is exempt'),
    });
    registry.record(route('POST', '/api/v1/thing', { audit: audited('rbac') }));
    expect(registry.rows()[0]).toMatchObject({ source: 'route', mark: { kind: 'audited' } });
  });

  it('an unmarked non-GET route is a failure; the same route as GET is not', () => {
    const registry = createAuditCoverageRegistry({});
    registry.record(route('POST', '/api/v1/thing'));
    registry.record(route('GET', '/api/v1/thing'));
    expect(registry.unmarked().map((row) => `${row.method} ${row.url}`)).toEqual([
      'POST /api/v1/thing',
    ]);
  });

  it('multi-method registrations are marked per method', () => {
    const registry = createAuditCoverageRegistry({
      'DELETE /api/v1/thing': audited('rbac'),
    });
    registry.record(route(['GET', 'DELETE', 'PUT'] as unknown as string, '/api/v1/thing'));
    expect(registry.unmarked().map((row) => row.method)).toEqual(['PUT']);
  });

  it('routes outside /api are not part of the contract', () => {
    const registry = createAuditCoverageRegistry({});
    registry.record(route('POST', '/internal/thing'));
    expect(registry.rows()).toHaveLength(0);
  });

  it('a malformed marker fails loudly rather than reading as covered', () => {
    const registry = createAuditCoverageRegistry({});
    expect(() => {
      registry.record(route('POST', '/api/v1/thing', { audit: { kind: 'audited', via: 'magic' } }));
    }).toThrow(/unknown write path/);
    expect(() => {
      registry.record(route('POST', '/api/v1/thing', { audit: auditExempt('nope') }));
    }).toThrow(/without a usable reason/);
    expect(() => {
      registry.record(route('POST', '/api/v1/thing', { audit: auditGap('') }));
    }).toThrow(/without a usable reason/);
  });
});

// ── The two routes this wave fixed ───────────────────────────────────────────

describe('POST /setup/super-admin writes an audit row (it used to write none)', () => {
  it('audits the creation, and audits the refusal on an already-set-up instance', async () => {
    // No `createFirstSuperAdmin` here: the point is the FIRST one, through the
    // route, on a store where setup is still open.
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await firstRun(meta);
    const app = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
    open = {
      close: async () => {
        await app.close();
        await meta.db.destroy();
      },
    };

    const payload = {
      email: 'ada@adminium.test',
      password: 'correct-horse-battery-staple',
      name: 'Ada',
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/super-admin',
      payload,
    });
    expect(created.statusCode).toBe(201);

    const afterCreate = await auditRepo(meta).list({ category: 'auth' });
    const creation = afterCreate.find((e) => e.action === 'setup_super_admin_created');
    expect(creation, 'the most privileged act in the product must leave a row').toBeDefined();
    expect(creation?.requestId).toMatch(/^req_[0-9a-f]{8}$/);
    // The row names the account it created, and never the password.
    expect(JSON.stringify(creation?.changes)).toContain('ada@adminium.test');
    expect(JSON.stringify(creation)).not.toContain(payload.password);

    // A probe against a set-up instance gets the invariant 409 — and is logged.
    const refused = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/super-admin',
      payload: { ...payload, email: 'mallory@adminium.test' },
    });
    expect(refused.statusCode).toBe(409);

    const afterRefusal = await auditRepo(meta).list({ category: 'auth' });
    const denial = afterRefusal.find((e) => e.action === 'setup_super_admin_denied');
    expect(denial, 'a probe at the super-admin factory is worth a row').toBeDefined();
    expect(denial?.actorLabel).toBe('mallory@adminium.test');
    // The client learns nothing from the 409 either way.
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('CONFLICT');
  });
});

describe('POST /meta/relocate writes an audit row (it used to write none)', () => {
  it('the row is written BEFORE the copy, so a failed move still records who tried', async () => {
    // Relocating to the store we are already on is refused by
    // `relocateMetaStore` — which makes it the cheapest way to prove the
    // ordering the route's header argues for: the row exists even though the
    // relocation never happened.
    const dir = await mkdtemp(join(tmpdir(), 'adminium-relocate-audit-'));
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await firstRun(meta);
    const runService = createRunService({ meta });
    const composed = await composeServer({
      env: makeEnv({ ADMINIUM_DATA_DIR: dir }),
      metaStore: memoryStore(meta),
      manager: new ConnectionManager({
        meta,
        crypto: dsnCryptoFromSecret(TEST_SECRET),
        metaDsn: null,
      }),
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: null,
      logger: false,
      telemetry: false,
      onMetaRelocated: () => {
        throw new Error('the relocation must not have reached the host');
      },
    });
    await composed.app.ready();
    open = {
      close: async () => {
        await composed.app.close();
        await meta.db.destroy();
        await rm(dir, { recursive: true, force: true });
      },
    };

    await createFirstSuperAdmin(meta, {
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      passwordHash: await adminPasswordHash(),
    });
    const { cookie } = await login(composed.app, ADMIN_EMAIL, ADMIN_PASSWORD);

    const res = await composed.app.inject({
      method: 'POST',
      url: '/api/v1/meta/relocate',
      headers: { cookie: cookie ?? '' },
      payload: { dsn: 'sqlite::memory:' },
    });
    expect(res.statusCode).toBe(409);

    const rows = await auditRepo(meta).list({ category: 'system' });
    const entry = rows.find((e) => e.action === 'meta.relocate');
    expect(entry, 'moving the meta store must leave a row even when it is refused').toBeDefined();
    expect(entry?.actorLabel).toBe(ADMIN_NAME);
    // A meta DSN is a credential; `adminium_audit_log` is readable by anyone
    // with system:audit:read, so the target must never appear in it.
    expect(JSON.stringify(entry)).not.toContain('sqlite::memory:');
  });
});

// ── The generated OpenAPI document ───────────────────────────────────────────

describe('OpenAPI collection', () => {
  it('is off by default and produces a document when asked for', async () => {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await initMetaDb(meta);
    await firstRun(meta);

    const plain = await buildServer({ env: makeEnv(), logger: false, metaDb: meta });
    await plain.ready();
    expect('swagger' in plain, 'no spec collection unless asked').toBe(false);
    await plain.close();

    const documented = await buildServer({
      env: makeEnv(),
      logger: false,
      metaDb: meta,
      openapi: true,
    });
    await documented.ready();
    open = {
      close: async () => {
        await documented.close();
        await meta.db.destroy();
      },
    };

    const spec = documented.swagger() as {
      openapi: string;
      paths: Record<string, Record<string, { requestBody?: unknown }>>;
    };
    expect(spec.openapi).toBe('3.1.0');
    // The zod transform ran: a body-carrying route documents its body, rather
    // than serializing as an untyped operation.
    expect(spec.paths['/api/v1/auth/login']?.post?.requestBody).toBeDefined();
  });
});
