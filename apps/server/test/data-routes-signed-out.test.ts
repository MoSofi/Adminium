// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The data routes answer a signed-out caller 401 before they look anything up.
 *
 * They resolve the connection, its snapshot and the table before checking the
 * table grant, because the grant names the RESOLVED table. With no principal
 * at all that order was a probe: an unknown connection answered 404, one never
 * introspected a different 404, an unknown table 422, and a real one 403
 * naming `table:<conn>:public.customers:read`. So anyone holding a connection
 * id could list its tables without signing in, and every 403 wrote a
 * `permission.denied` audit row with no actor. A dashboard whose session had
 * lapsed was told it had no access to the table, not that it was signed out.
 *
 * Driven through `composeServer`, so the auth and rbac hooks are the ones
 * production runs.
 */

import BetterSqlite3 from 'better-sqlite3';
import { parseDatabaseModel } from '@adminium/engine';
import {
  apiKeysRepo,
  connectionsRepo,
  createSqliteMetaDb,
  firstRun,
  rolesRepo,
  snapshotsRepo,
  type MetaDb,
} from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { withoutDefaultDataGrants } from './builtin-grants.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const SHOP = parseDatabaseModel({
  irVersion: 1,
  dialect: 'postgres',
  name: 'shop',
  defaultSchema: 'public',
  tables: [
    {
      schema: 'public',
      name: 'customers',
      columns: [
        { name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false },
        { name: 'email', logicalType: 'text', nullable: false },
      ],
      primaryKey: ['id'],
    },
  ],
});

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return {
    meta,
    url: 'sqlite::memory:',
    engine: 'sqlite',
    source: 'embedded',
    close: async () => Promise.resolve(),
  };
}

interface Harness {
  app: ComposedServer['app'];
  meta: MetaDb;
  /** Introspected: its snapshot holds `public.customers`. */
  shop: string;
  /** Never introspected. */
  bare: string;
}

let open: { close: () => Promise<void> } | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

/** Nothing here reaches a source database: every answer comes before one. */
async function serving(): Promise<Harness> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const crypto = dsnCryptoFromSecret(TEST_SECRET);
  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv(),
    metaStore: memoryStore(meta),
    manager: new ConnectionManager({ meta, crypto, metaDsn: null }),
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

  const connections = connectionsRepo(meta, crypto);
  const shop = await connections.create({
    name: 'Shop',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@db.internal:5432/shop',
  });
  const bare = await connections.create({
    name: 'Bare',
    engine: 'postgres',
    introspectDsn: 'postgres://ro@db.internal:5432/bare',
  });
  await snapshotsRepo(meta).create({
    connectionId: shop.id,
    source: 'introspection',
    schema: SHOP,
    checksum: 'sha-shop-1',
  });
  return { app: composed.app, meta, shop: shop.id, bare: bare.id };
}

async function auditCount(meta: MetaDb): Promise<number> {
  return (await meta.db.selectFrom('adminium_audit_log').select('id').execute()).length;
}

/** The body with its request id dropped, so two refusals can be compared. */
function withoutRequestId(body: string): string {
  const parsed = JSON.parse(body) as { error?: { requestId?: string } };
  delete parsed.error?.requestId;
  return JSON.stringify(parsed);
}

describe('the data routes, signed out', () => {
  it('answer 401 on every table route, whatever does or does not exist', async () => {
    const { app, meta, shop, bare } = await serving();
    const table = `/api/v1/data/${shop}/customers`;

    // Every table route, with inputs that pass validation so the answer is
    // the handler's and not a 422 from the schema.
    const probes: { label: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: object }[] = [
      { label: 'an unknown connection', method: 'GET', url: '/api/v1/data/conn_01JZZZZZZZZZZZZZZZZZZZZZZZ/customers' },
      { label: 'a connection never introspected', method: 'GET', url: `/api/v1/data/${bare}/customers` },
      { label: 'an unknown table', method: 'GET', url: `/api/v1/data/${shop}/payroll` },
      { label: 'list', method: 'GET', url: table },
      { label: 'read', method: 'GET', url: `${table}/1` },
      { label: 'references', method: 'GET', url: `${table}/1/references` },
      { label: 'links', method: 'GET', url: `${table}/1/links/orders` },
      { label: 'availability', method: 'GET', url: `${table}/availability?column=email&from=2026-01-01&to=2026-02-01` },
      { label: 'create', method: 'POST', url: table, payload: { values: { email: 'a@shop.test' } } },
      { label: 'update', method: 'PATCH', url: `${table}/1`, payload: { values: { email: 'a@shop.test' } } },
      { label: 'delete', method: 'DELETE', url: `${table}/1` },
      { label: 'bulk', method: 'POST', url: `${table}/bulk`, payload: { action: 'delete', ids: [1] } },
    ];

    const answers = new Map<string, string>();
    const wrong: string[] = [];
    for (const probe of probes) {
      const res = await app.inject({
        method: probe.method,
        url: probe.url,
        ...(probe.payload === undefined ? {} : { payload: probe.payload }),
      });
      if (res.statusCode !== 401) wrong.push(`${probe.label}: ${String(res.statusCode)} ${res.body}`);
      answers.set(probe.label, withoutRequestId(res.body));
    }

    expect(wrong, `answered before asking who is calling:\n${wrong.join('\n')}`).toEqual([]);
    // One answer for all of them: nothing about the connection or the table
    // may show through.
    expect(new Set(answers.values()).size).toBe(1);
    expect(JSON.parse([...answers.values()][0] ?? '{}')).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    });
    // No `permission.denied` rows attributed to nobody.
    expect(await auditCount(meta)).toBe(0);
  });

  it('still resolve the table for a caller who is signed in', async () => {
    // The control: the guard stops the caller with NO principal and nobody
    // else. A key whose role holds no table grant gets past it and is
    // refused on the resolved table, as before.
    const { app, meta, shop } = await serving();
    await withoutDefaultDataGrants(meta);
    const viewer = await rolesRepo(meta).findBySlug('viewer');
    if (viewer === null) throw new Error('missing built-in role viewer');
    const generated = generateApiKey();
    const key = await apiKeysRepo(meta).create({
      name: 'reporting script',
      prefix: generated.prefix,
      tokenHash: generated.tokenHash,
      roleId: viewer.id,
    });
    const headers = { authorization: `Bearer ${generated.key}` };

    const real = await app.inject({ method: 'GET', url: `/api/v1/data/${shop}/customers`, headers });
    expect(real.statusCode).toBe(403);
    expect(real.json<{ error: { code: string } }>().error.code).toBe('TABLE_FORBIDDEN');

    const unknown = await app.inject({ method: 'GET', url: `/api/v1/data/${shop}/payroll`, headers });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json<{ error: { code: string } }>().error.code).toBe('UNKNOWN_IDENTIFIER');

    // And the denial names who was refused.
    const denials = await meta.db
      .selectFrom('adminium_audit_log')
      .select(['actorKind', 'actorId'])
      .where('action', '=', 'permission.denied')
      .execute();
    expect(denials).toEqual([{ actorKind: 'api-key', actorId: key.id }]);
  });
});
