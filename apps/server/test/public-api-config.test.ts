// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /public/config` over the wire, with a key that actually resolves.
 *
 * Every other suite stops at the gate — a syntactically valid token that
 * matches no row — so nothing ever read a 200 body from this route. That is
 * how `documents` went missing: `publicConfigOf` returned it, the reply schema
 * did not declare it, and the serializer parses through the schema, so a plain
 * `z.object` dropped the key silently. The client then saw every server as one
 * too old to draw documents.
 *
 * So the last assertion here compares the WHOLE body against `publicConfigOf`
 * rather than naming one field: the next capability added to the projection
 * and forgotten in the schema fails here instead of vanishing.
 */

import BetterSqlite3 from 'better-sqlite3';
import {
  createSqliteMetaDb,
  firstRun,
  publicKeysRepo,
  publicScopesRepo,
  settingsRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { generatePublishableKey, hashPublishableKey } from '../src/public-api/keys.js';
import { compileScope, publicConfigOf } from '../src/public-api/scope.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

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

function scopeDocument(documents?: { create: boolean }): Record<string, unknown> {
  return {
    version: 1,
    side: 'customer',
    timezone: 'Europe/London',
    currency: 'GBP',
    ...(documents === undefined ? {} : { documents }),
    resources: [
      { ref: 'menu', table: 'public.menu_items', actions: ['read'], expose: ['id', 'name'] },
    ],
  };
}

/** A serving instance plus a live key minted against `document`. */
async function servingWithKey(
  document: Record<string, unknown>,
): Promise<{ app: ComposedServer['app']; token: string }> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  // Two independent switches; without this row every route answers 503.
  await settingsRepo(meta).set('publicApi.enabled', true);
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(TEST_SECRET),
    metaDsn: null,
  });
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ ADMINIUM_PUBLIC_API_ORIGINS: ALLOWED, HOST: '127.0.0.1' }),
    metaStore: memoryStore(meta),
    manager,
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

  // No snapshot is stored for this connection, so the resolver compiles the
  // scope without a column lookup — the same path `compileScope` takes below.
  const connection = await manager.connections.create({
    name: 'Shop',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@db.internal:5432/shop',
  });
  const scope = await publicScopesRepo(meta).create({
    connectionId: connection.id,
    side: 'customer',
    name: 'storefront',
    timezone: 'Europe/London',
    document: JSON.stringify(document),
  });
  const { token } = generatePublishableKey();
  await publicKeysRepo(meta).create({
    name: 'web',
    prefix: token.slice(0, 16),
    tokenHash: hashPublishableKey(token),
    tokenEncrypted: 'sealed',
    scopeId: scope.id,
    side: 'customer',
  });
  return { app: composed.app, token };
}

async function readConfig(
  app: ComposedServer['app'],
  token: string,
): Promise<{ status: number; body: { data?: Record<string, unknown> } }> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/public/config',
    headers: { origin: ALLOWED, 'sec-fetch-site': 'cross-site', authorization: `Bearer ${token}` },
  });
  return { status: res.statusCode, body: res.json() as { data?: Record<string, unknown> } };
}

describe('GET /public/config reports the documents capability', () => {
  it('sends documents.create: true for a scope that sets it', async () => {
    const { app, token } = await servingWithKey(scopeDocument({ create: true }));
    const { status, body } = await readConfig(app, token);
    expect(status).toBe(200);
    expect(body.data?.documents).toEqual({ create: true });
  }, 60_000);

  it('sends documents.create: false, not an absent key, for a scope that says nothing', async () => {
    // Absent is what an OLD server looks like to the client, so a current one
    // must never be mistaken for it.
    const { app, token } = await servingWithKey(scopeDocument());
    const { status, body } = await readConfig(app, token);
    expect(status).toBe(200);
    expect(body.data?.documents).toEqual({ create: false });
  }, 60_000);

  it('puts everything `publicConfigOf` returns on the wire', async () => {
    const document = scopeDocument({ create: true });
    const { app, token } = await servingWithKey(document);
    const { status, body } = await readConfig(app, token);
    expect(status).toBe(200);
    expect(body.data).toEqual(publicConfigOf(compileScope(document)));
  }, 60_000);
});
