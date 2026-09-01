// SPDX-License-Identifier: AGPL-3.0-only
/**
 * 29-T02/T03 — the `self` sentinel and same-origin access to the public API
 * (29-app-surfaces.md D2, acceptance criteria 2 and 3).
 *
 * ── THE DEFECT THIS FIXES ──────────────────────────────────────────────────
 * 28 shipped four build modes, one of which — `hosted-customer` — is a bundle
 * Adminium serves at its OWN origin that reads `/api/v1/public/*`. It never
 * worked, and could not: the gate required an allow-listed `Origin` header, and
 * a same-origin `GET` sends no `Origin` header at all. The Fetch spec appends
 * one only for non-GET/HEAD methods and for cross-origin CORS requests, and a
 * page cannot add its own — `Origin` is a forbidden header name. So no value an
 * operator could put in `ADMINIUM_PUBLIC_API_ORIGINS` would ever have matched.
 *
 * The gate had to learn what same-origin looks like. `self` is how an operator
 * says "and the surfaces I host myself".
 *
 * ── THE REFUSAL MATRIX IS THE POINT ────────────────────────────────────────
 * Criterion 3 requires that WITHOUT the sentinel nothing changes, so the matrix
 * below is driven twice over the same cases — once with `self` in the list and
 * once without — and the sentinel-absent column is asserted to be exactly the
 * pre-wave behaviour: `Origin` allow-list or refusal, nothing else.
 *
 * ── WHAT PASSING THE ORIGIN GATE LOOKS LIKE HERE ───────────────────────────
 * Every request below carries a syntactically valid key that resolves to
 * nothing, so "the origin gate let this through" reads as `401
 * PUBLIC_KEY_INVALID` and "the origin gate refused" reads as `403
 * PUBLIC_ORIGIN_REFUSED`. Asserting the CODE rather than merely "not 403" is
 * deliberate: a 401 for the wrong reason would otherwise look like a pass.
 */

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

/** Syntactically valid, resolves to nothing — see the header. */
const KEY = `adm_pub_${'a'.repeat(32)}`;
/** The host every request below is addressed to. */
const HOST = 'admin.myshop.test';
const FOREIGN = 'https://evil.example.com';
const ALLOWED = 'https://shop.example.com';

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
}

let open: { close: () => Promise<void> } | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

/**
 * A serving instance with the given origin list.
 *
 * Loopback bind so the public namespace registers without
 * `ADMINIUM_TRUST_PROXY` (28 D21), and `publicApi.enabled` set because the two
 * switches are independent and the row defaults false — without it every route
 * 503s and the origin gate is never reached.
 */
async function serving(origins: string): Promise<ComposedServer['app']> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await settingsRepo(meta).set('publicApi.enabled', true);
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ ADMINIUM_PUBLIC_API_ORIGINS: origins, HOST: '127.0.0.1' }),
    metaStore: memoryStore(meta),
    manager: new ConnectionManager({
      meta,
      crypto: dsnCryptoFromSecret(TEST_SECRET),
      metaDsn: null,
    }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => {
      /* never relocates */
    },
  });
  await composed.app.ready();
  open = {
    close: async () => {
      await composed.app.close();
      await meta.db.destroy();
    },
  };
  return composed.app;
}

type Case = {
  name: string;
  headers: Record<string, string>;
  /** Expected error code WITH `self` in the list, and WITHOUT it. */
  withSelf: 'PUBLIC_KEY_INVALID' | 'PUBLIC_ORIGIN_REFUSED';
  without: 'PUBLIC_KEY_INVALID' | 'PUBLIC_ORIGIN_REFUSED';
};

/**
 * Every provenance shape that reaches this gate in practice, plus the forgeries
 * worth stating out loud.
 */
const CASES: readonly Case[] = [
  {
    // The case the whole sentinel exists for: a hosted customer surface's
    // first read. No `Origin`, because the browser does not send one.
    name: 'same-origin GET: no Origin, Sec-Fetch-Site: same-origin',
    headers: { 'sec-fetch-site': 'same-origin' },
    withSelf: 'PUBLIC_KEY_INVALID',
    without: 'PUBLIC_ORIGIN_REFUSED',
  },
  {
    // A same-origin POST/PATCH. The browser DOES send `Origin` here, and it
    // equals the host, which no allow-list entry has to name.
    name: 'same-origin write: Origin equals Host',
    headers: { origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin' },
    withSelf: 'PUBLIC_KEY_INVALID',
    without: 'PUBLIC_ORIGIN_REFUSED',
  },
  {
    // The fetch-metadata veto: `Origin` matches the host string, but the
    // browser says the request crossed a site boundary to get here. That is
    // `http://host` posing as `https://host`, and it is refused.
    name: 'Origin equals Host but Sec-Fetch-Site says cross-site',
    headers: { origin: `https://${HOST}`, 'sec-fetch-site': 'cross-site' },
    withSelf: 'PUBLIC_ORIGIN_REFUSED',
    without: 'PUBLIC_ORIGIN_REFUSED',
  },
  {
    name: 'a foreign origin is refused, sentinel or not',
    headers: { origin: FOREIGN, 'sec-fetch-site': 'cross-site' },
    withSelf: 'PUBLIC_ORIGIN_REFUSED',
    without: 'PUBLIC_ORIGIN_REFUSED',
  },
  {
    // No provenance at all — a bare curl. Refused in BOTH columns: the
    // sentinel widens same-origin, not "anything without a header".
    name: 'no Origin and no Sec-Fetch-Site is refused',
    headers: {},
    withSelf: 'PUBLIC_ORIGIN_REFUSED',
    without: 'PUBLIC_ORIGIN_REFUSED',
  },
  {
    name: 'an allow-listed cross-origin caller still passes',
    headers: { origin: ALLOWED, 'sec-fetch-site': 'cross-site' },
    withSelf: 'PUBLIC_KEY_INVALID',
    without: 'PUBLIC_KEY_INVALID',
  },
  {
    // `Origin: null` — a sandboxed iframe or a `data:` document. Opaque, so
    // foreign, and it must not be read as "absent, therefore check metadata".
    name: 'Origin: null is foreign even with same-origin fetch metadata',
    headers: { origin: 'null', 'sec-fetch-site': 'same-origin' },
    withSelf: 'PUBLIC_ORIGIN_REFUSED',
    without: 'PUBLIC_ORIGIN_REFUSED',
  },
  {
    // `classifyOrigin` honours `Referer` when nothing better exists, because a
    // session cookie is already riding along. This gate does not: there is no
    // cookie to protect and no reason to widen onto a header servers have sent
    // wrong for twenty years.
    name: 'Referer alone does not buy same-origin',
    headers: { referer: `https://${HOST}/apps/clients/customer/` },
    withSelf: 'PUBLIC_ORIGIN_REFUSED',
    without: 'PUBLIC_ORIGIN_REFUSED',
  },
];

async function probe(
  app: ComposedServer['app'],
  headers: Record<string, string>,
): Promise<{ code: string | undefined; acao: string | undefined; status: number }> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/public/config',
    headers: { host: HOST, authorization: `Bearer ${KEY}`, ...headers },
  });
  const body = res.json() as { error?: { code?: string } };
  return {
    code: body.error?.code,
    acao: res.headers['access-control-allow-origin'] as string | undefined,
    status: res.statusCode,
  };
}

describe('29 D2 — the public gate\'s refusal matrix, with and without `self`', () => {
  it('accepts same-origin callers only when the sentinel is set', async () => {
    const app = await serving(`self,${ALLOWED}`);
    const actual: Record<string, string | undefined> = {};
    for (const c of CASES) actual[c.name] = (await probe(app, c.headers)).code;
    expect(actual).toEqual(Object.fromEntries(CASES.map((c) => [c.name, c.withSelf])));
  }, 60_000);

  it('is byte-identical to the pre-wave gate when the sentinel is absent', async () => {
    // Criterion 3. The same eight cases, the same assertions, one env value
    // different — which is the only honest way to state "nothing changed for
    // instances that did not opt in".
    const app = await serving(ALLOWED);
    const actual: Record<string, string | undefined> = {};
    for (const c of CASES) actual[c.name] = (await probe(app, c.headers)).code;
    expect(actual).toEqual(Object.fromEntries(CASES.map((c) => [c.name, c.without])));
  }, 60_000);
});

describe('29 D2 — what the same-origin path does NOT do', () => {
  it('emits no Access-Control-Allow-Origin for a same-origin caller', async () => {
    // A same-origin response needs no CORS header, and emitting one would mean
    // echoing an origin the request never sent. `Vary: Origin` still goes out —
    // the response genuinely does depend on the header's presence.
    const app = await serving('self');
    const res = await probe(app, { 'sec-fetch-site': 'same-origin' });
    expect(res.code).toBe('PUBLIC_KEY_INVALID');
    expect(res.acao).toBeUndefined();
  }, 60_000);

  it('never treats the literal header `Origin: self` as a match', async () => {
    // The sentinel is not in the allow-list Set. If it were, this would pass.
    const app = await serving('self');
    expect((await probe(app, { origin: 'self' })).code).toBe('PUBLIC_ORIGIN_REFUSED');
  }, 60_000);

  it('still requires a valid key when the fetch metadata is FORGED', async () => {
    /*
     * 28 §3.6, restated where someone will read it: `Sec-Fetch-Site` is
     * trivially forged by a non-browser, and this is POLICY, not a boundary. It
     * keeps other people's PAGES out; the publishable KEY is the credential.
     *
     * The assertion is that the forgery gets you to the KEY CHECK and no
     * further. Nobody should later "fix" this into a boundary it cannot be.
     */
    const app = await serving('self');
    const res = await probe(app, { 'sec-fetch-site': 'same-origin' });
    expect(res.status).toBe(401);
    expect(res.code).toBe('PUBLIC_KEY_INVALID');
  }, 60_000);

  it('registers the namespace when `self` is the ONLY value', async () => {
    // Level 1 registration semantics (D2): `self` alone is a real opt-in, not
    // an empty list. A hosted-only instance sets exactly this.
    const app = await serving('self');
    const tree = app.printRoutes({ commonPrefix: false });
    expect(tree).toContain('/api/v1/public/config');
  }, 60_000);
});
