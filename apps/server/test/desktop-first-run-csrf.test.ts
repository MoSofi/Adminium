// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desktop first-run wizard's REQUEST SEQUENCE, against the composed server
 * in the desktop topology (11-electron.md §6; 08-server-api.md §7 item 4).
 *
 * ─── THE REGRESSION THIS EXISTS TO CATCH ─────────────────────────────────────
 *
 * §7 item 4's active CSRF check demands a session-bound token from any mutation
 * that carries a session AND browser provenance. `GET /bootstrap` issued the
 * token, and every authed surface in the SPA reaches `/bootstrap` first — so
 * that was, briefly, believed to be enough.
 *
 * The desktop wizard is the counterexample, and it is not an edge case: it is
 * the ONLY way a fresh install becomes usable. `/desktop/setup` hangs off the
 * router ROOT precisely because it cannot bootstrap (there is no account to
 * bootstrap as when it loads). Step 3 creates the super admin — which mints a
 * session — and then steps 4 stays on the same screen and creates a database,
 * introspects it, and generates pages. Every one of those calls was a
 * session-authenticated, browser-provenanced, TOKENLESS mutation: 403
 * `CSRF_FAILED`, on the first call after the account.
 *
 * The symptom was three desktop E2E specs timing out at 180 s waiting for a
 * "Generate dashboard" button that could never appear, with no CSRF, 403 or
 * rate-limit string anywhere in the CI log — the desktop harness runs the
 * server with its logger off, so the one place the reason is written
 * (`plugins/core.ts` logs the failing leg and never returns it) was silent.
 *
 * ─── WHY IT IS SHAPED LIKE THIS ──────────────────────────────────────────────
 *
 * The fixture is a CLIENT, not a set of assertions about routes. It may use
 * only what the wizard itself would have: the cookies the server set and the
 * body it returned. It is specifically forbidden to call `/bootstrap` — doing
 * so is what would make this file pass while the product was broken, since the
 * server's check has never had a bug; the token simply never reached the
 * caller. Every request carries the headers a real Chromium renderer attaches
 * on a same-origin `fetch`, because dropping `Origin` would take the request
 * out of the check's scope entirely (the no-provenance carve-out) and prove
 * nothing.
 */

import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { CSRF_HEADER } from '../src/security/csrf.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

/**
 * The REAL seed script the shell ships, resolved the way `demoSeedScriptPath`
 * resolves it. Without it `composeServer` does not register the demo route at
 * all (it is gated on the script existing) and the sequence below would 404
 * rather than exercise the check — the same reason `desktop-demo.test.ts`
 * points at this path instead of a copy.
 */
const SEED_SCRIPT = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
  '..',
  'desktop',
  'resources',
  'demo',
  'demo-seed.mjs',
);

/** The loopback origin `main/index.ts`'s `appUrl()` navigates the window to. */
const HOST = '127.0.0.1:51234';
const ORIGIN = `http://${HOST}`;

/** The demo persona the E2E walk uses (`apps/e2e/tests-desktop/helpers/flow.ts`). */
const ADMIN = { name: 'Ava Reyes', email: 'ava@adminium.io', password: 'desktop-e2e-password' };

/**
 * What Chromium attaches to a same-origin `fetch` from the wizard page. All
 * four matter: `origin`/`referer`/`sec-fetch-*` are the provenance that puts
 * the request INSIDE the token leg's scope, and `host` is what the expected
 * origin is derived from (`security/csrf.ts`).
 */
const RENDERER_HEADERS: Record<string, string> = {
  host: HOST,
  origin: ORIGIN,
  referer: `${ORIGIN}/desktop/setup`,
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'user-agent': 'Mozilla/5.0 Electron/43.0.0 Chrome/140.0.0.0',
};

interface Harness {
  app: Awaited<ReturnType<typeof composeServer>>['app'];
  meta: MetaDb;
  dataDir: string;
}

let t: Harness | null = null;

afterEach(async () => {
  if (t === null) return;
  await t.app.close();
  await t.meta.db.destroy();
  rmSync(t.dataDir, { recursive: true, force: true });
  t = null;
});

function storeHandle(meta: MetaDb): MetaStoreHandle {
  return {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
}

/**
 * A composed server in the DESKTOP topology on a never-bootstrapped meta store
 * — the state a fresh install boots into. `composeServer`, not a hand-rolled
 * route set: which routes exist in this topology, and which hooks wrap them, is
 * exactly the claim under test.
 */
async function harness(): Promise<Harness> {
  await registerAdapters();
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const dataDir = mkdtempSync(join(tmpdir(), 'adminium-first-run-'));
  const env = makeEnv({
    ADMINIUM_RUNTIME: 'desktop',
    ADMINIUM_BOOT_TOKEN: 'a'.repeat(64),
    ADMINIUM_DESKTOP_SINGLE_USER: 'on',
    ADMINIUM_DATA_DIR: dataDir,
    ADMINIUM_DEMO_SEED_SCRIPT: SEED_SCRIPT,
  });
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    metaDsn: null,
  });
  const runService = createRunService({ meta });
  const { app } = await composeServer({
    env,
    metaStore: storeHandle(meta),
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    // The scheduler would otherwise hold the process open past the test.
    telemetry: false,
  });
  await app.ready();
  t = { app, meta, dataDir };
  return t;
}

/**
 * The wizard's browser, in as much as it matters here: a cookie jar and a CSRF
 * token holder, both written ONLY from what the server sends back. This mirrors
 * `apps/dashboard/src/app/api.ts` — one module-level token, attached to every
 * mutating request and to nothing else.
 */
class WizardClient {
  private cookie = '';
  private token: string | null = null;

  constructor(private readonly app: Harness['app']) {}

  /** True once the server has handed this client a token. */
  get hasToken(): boolean {
    return this.token !== null;
  }

  /** The dashboard's `setCsrfToken` — the only way the holder is ever written. */
  private remember(body: unknown): void {
    const token = (body as { data?: { csrfToken?: unknown } } | null)?.data?.csrfToken;
    if (typeof token === 'string' && token.length > 0) this.token = token;
  }

  private absorbCookies(setCookie: string | string[] | undefined): void {
    const all = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
    for (const entry of all) {
      const pair = entry.split(';')[0];
      if (pair !== undefined && pair.length > 0) this.cookie = pair;
    }
  }

  async get(url: string) {
    return this.app.inject({
      method: 'GET',
      url,
      headers: { ...RENDERER_HEADERS, ...(this.cookie === '' ? {} : { cookie: this.cookie }) },
    });
  }

  async post(url: string, payload?: unknown) {
    const response = await this.app.inject({
      method: 'POST',
      url,
      headers: {
        ...RENDERER_HEADERS,
        ...(this.cookie === '' ? {} : { cookie: this.cookie }),
        // GET/HEAD never carry it, mutations always do — `isMutating` in api.ts.
        ...(this.token === null ? {} : { [CSRF_HEADER]: this.token }),
      },
      ...(payload === undefined ? {} : { payload }),
    });
    this.absorbCookies(response.headers['set-cookie']);
    try {
      this.remember(response.json());
    } catch {
      // Not JSON (or empty) — nothing to learn from it.
    }
    return response;
  }
}

/** Reads the `code` out of the §1.4 error envelope. */
function errorCode(res: { json: () => unknown }): string | undefined {
  return (res.json() as { error?: { code?: string } }).error?.code;
}

describe('desktop first-run wizard — the whole sequence, as the renderer makes it', () => {
  it('walks step 3 → step 4 without a single CSRF refusal', async () => {
    const h = await harness();
    const client = new WizardClient(h.app);

    // Step 1–2 are local choices; the first server call is the policy probe the
    // account step mirrors.
    const state = await client.get('/api/v1/setup/state');
    expect(state.statusCode).toBe(200);

    // ── Step 3: create the super admin. THIS MINTS THE SESSION, and from here
    // on every mutation is inside §7 item 4's scope.
    const created = await client.post('/api/v1/setup/super-admin', {
      name: ADMIN.name,
      email: ADMIN.email,
      password: ADMIN.password,
      consent: { telemetry: false, updateCheck: false },
    });
    expect(created.statusCode).toBe(201);

    // The reply is the ONLY place this client can learn the token — it will not
    // call `/bootstrap`, because the wizard does not. Asserted separately from
    // the calls below so a regression names itself instead of surfacing as a
    // 403 four lines later.
    expect(
      client.hasToken,
      'POST /setup/super-admin must return the CSRF token for the session it just minted — ' +
        'the wizard has nowhere else to get one before step 4 mutates',
    ).toBe(true);

    // ── Step 4, call 1: the demo card. The first mutation after the session.
    const demo = await client.post('/api/v1/desktop/demo-database', {});
    expect(errorCode(demo)).not.toBe('CSRF_FAILED');
    expect(demo.statusCode).toBe(201);
    const { connectionId } = (demo.json() as { data: { connectionId: string } }).data;

    // ── Step 4, call 2: introspect. 202 — it runs as a job.
    const introspect = await client.post(
      `/api/v1/connections/${encodeURIComponent(connectionId)}/introspect`,
    );
    expect(errorCode(introspect)).not.toBe('CSRF_FAILED');
    expect(introspect.statusCode).toBe(202);

    // ── Step 4, call 3: "Generate dashboard" — the button the E2E specs waited
    // 180 s for. Only its CSRF verdict is asserted: whether generation produces
    // the kanban/calendar/gantt pages is `desktop-demo.test.ts`'s subject, and
    // duplicating it here would make this file fail for reasons it is not about.
    const generate = await client.post(
      `/api/v1/connections/${encodeURIComponent(connectionId)}/generate`,
      { intent: 'full-admin' },
    );
    expect(errorCode(generate)).not.toBe('CSRF_FAILED');
    expect(generate.statusCode).not.toBe(403);
  }, 60_000);

  it('a wizard that ignores the token it was given is still refused', async () => {
    // The mirror image, so the test above cannot pass by the check being off:
    // same sequence, same provenance, token dropped. This is precisely the
    // request the shipped wizard was making.
    const h = await harness();

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/setup/super-admin',
      headers: RENDERER_HEADERS,
      payload: {
        name: ADMIN.name,
        email: ADMIN.email,
        password: ADMIN.password,
        consent: { telemetry: false, updateCheck: false },
      },
    });
    expect(created.statusCode).toBe(201);
    const setCookie = created.headers['set-cookie'];
    const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] ?? '';

    const demo = await h.app.inject({
      method: 'POST',
      url: '/api/v1/desktop/demo-database',
      headers: { ...RENDERER_HEADERS, cookie },
      payload: {},
    });

    expect(demo.statusCode).toBe(403);
    expect(errorCode(demo)).toBe('CSRF_FAILED');
  }, 60_000);
});
