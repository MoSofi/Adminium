// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/api/v1/public/documents*`.
 *
 * ─── THE GATE, ASKED OF THE RUNNING ROUTE ──────────────────────────────────
 *
 * The done-when asks for "a route-table assertion that EVERY
 * `/public/documents*` route names a gate". A public route's gate is not in its
 * options — it is the first line of the handler — so the route table cannot see
 * it. What CAN be seen is the consequence: a call with no publishable key must
 * be refused, on every one of the five. That is the same property, asked of the
 * thing that actually runs.
 *
 * ─── AND THE FLAG, WHICH IS A DOOR AND NOT A SETTING ───────────────────────
 *
 * `documents.create` is off by default and refuses with the SAME code an
 * unknown resource gets. Whether a deployment can draw documents at all is not
 * something a stranger holding a page-bundle key gets to enumerate.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { compileScope } from '../src/public-api/scope.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

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

async function serving(): Promise<ComposedServer['app']> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await settingsRepo(meta).set('publicApi.enabled', true);
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ ADMINIUM_PUBLIC_API_ORIGINS: 'self', HOST: '127.0.0.1' }),
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

/** Every `/public/documents*` route, with the verb that reaches it. */
const ROUTES: readonly { method: 'GET' | 'POST'; url: string; payload?: object | undefined }[] = [
  { method: 'POST', url: '/api/v1/public/documents/render', payload: { kind: 'invoice', fields: {}, collections: {} } },
  { method: 'GET', url: '/api/v1/public/documents' },
  { method: 'GET', url: '/api/v1/public/documents/doc_1' },
  { method: 'GET', url: '/api/v1/public/documents/doc_1/content' },
  { method: 'POST', url: '/api/v1/public/documents/doc_1/email', payload: {} },
];

describe('every /public/documents route is gated', () => {
  it('refuses all five without a publishable key', async () => {
    const app = await serving();
    for (const route of ROUTES) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        ...(route.payload === undefined ? {} : { payload: route.payload }),
      });
      /*
       * Refused BY THE GATE — never served, never a 500 from a handler that
       * ran on. Which of the gate's two refusals arrives depends on how the
       * request looks to the origin check, and both are the gate speaking.
       */
      expect(res.statusCode, `${route.method} ${route.url}`).toBeGreaterThanOrEqual(400);
      expect(
        ['PUBLIC_KEY_INVALID', 'PUBLIC_ORIGIN_REFUSED'],
        `${route.method} ${route.url}`,
      ).toContain((res.json() as { error: { code: string } }).error.code);
    }
  });

  it('registers all five, so the loop above is not passing on absent routes', async () => {
    // A 404 from an UNREGISTERED route also carries no key — which would make
    // every assertion above pass against a build with no document door at all.
    const app = await serving();
    for (const route of [
      { method: 'POST' as const, url: '/api/v1/public/documents/render' },
      { method: 'GET' as const, url: '/api/v1/public/documents' },
      { method: 'GET' as const, url: '/api/v1/public/documents/:id' },
      { method: 'GET' as const, url: '/api/v1/public/documents/:id/content' },
      { method: 'POST' as const, url: '/api/v1/public/documents/:id/email' },
    ]) {
      expect(app.hasRoute(route), `${route.method} ${route.url}`).toBe(true);
    }
  });
});

describe('the documents.create flag', () => {
  const BASE = {
    version: 1 as const,
    side: 'customer' as const,
    timezone: 'Europe/London',
    resources: [
      {
        ref: 'orders',
        table: 'public.orders',
        actions: ['read'],
        expose: ['id'],
      },
    ],
  };
  const columns = (): ReadonlySet<string> => new Set(['id']);

  it('defaults OFF — a scope that says nothing may not draw documents', () => {
    const compiled = compileScope(BASE, columns);
    expect(compiled.documents.create).toBe(false);
  });

  it('compiles on a customer side when asked for', () => {
    const compiled = compileScope({ ...BASE, documents: { create: true } }, columns);
    expect(compiled.documents.create).toBe(true);
  });

  it('REFUSES on a staff side, which already has the authenticated door', () => {
    /*
     * A staff key belongs to somebody Adminium can authenticate, and the staff
     * surfaces draw documents through `POST /api/v1/documents/render` behind a
     * real session and a real grant. The same thing through a publishable key
     * would be a second, weaker door whose only defence — a human settling what
     * comes out — is ceremony when the caller is already a known user.
     */
    let issues: { code: string }[] = [];
    try {
      compileScope({ ...BASE, side: 'staff', documents: { create: true } }, columns);
    } catch (error) {
      issues = (error as { issues: { code: string }[] }).issues;
    }
    expect(issues.map((issue) => issue.code)).toContain('SCOPE_DOCUMENTS_STAFF_SIDE');
  });

  it('says so in the browser-facing config, so a page need not discover it by refusal', () => {
    const compiled = compileScope({ ...BASE, documents: { create: true } }, columns);
    expect(compiled.documents).toEqual({ create: true });
  });
});
