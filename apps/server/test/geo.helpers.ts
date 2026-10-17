// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The whole server over an empty store, with its owner signed in: enough for
 * the routes that read no table (`/geo/*`, `/settings/maps`).
 */
import BetterSqlite3 from 'better-sqlite3';
import { createFirstSuperAdmin, createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';
import { expect } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

export interface GeoServer {
  server: ComposedServer;
  meta: MetaDb;
  cookie: string;
  /** The headers a write needs: the cookie and its token. */
  write: Record<string, string>;
  close: () => Promise<void>;
}

export async function geoServer(env: Record<string, string> = {}): Promise<GeoServer> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await createFirstSuperAdmin(meta, { email: 'owner@geo.test', name: 'Owner', passwordHash: await adminPasswordHash() });
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null });
  const runService = createRunService({ meta });
  const server = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ...env }),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
  });
  await server.app.ready();
  await server.jobs.worker.stop();
  server.jobs.scheduler.stop();
  const login = await server.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@geo.test', password: ADMIN_PASSWORD } });
  expect(login.statusCode, login.body).toBe(200);
  const cookie = sessionCookie(login.headers['set-cookie']);
  const boot = await server.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie } });
  const csrf = (boot.json() as { data: { csrfToken: string } }).data.csrfToken;
  return {
    server,
    meta,
    cookie,
    write: { cookie, 'x-csrf-token': csrf },
    close: async () => {
      await server.app.close();
      await meta.db.destroy();
    },
  };
}
