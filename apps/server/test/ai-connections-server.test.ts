// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A model the environment names, as a whole server sees it.
 *
 * The resolver is only worth having if the real callers go through it: the
 * session's bootstrap (is there an assistant at all?), the assistant's own
 * availability, and the model routes. Each is asked here over HTTP on a
 * composed server, with nothing saved in Settings → AI.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

let composed: ComposedServer | undefined;
let root: string | undefined;
afterEach(async () => {
  await composed?.app.close();
  composed = undefined;
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
}

/** A whole server with an owner signed in; `get` asks as that owner. */
async function server(env: Record<string, string>, project?: string): Promise<{ get: (url: string) => Promise<{ status: number; body: Record<string, unknown> }> }> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const runService = createRunService({ meta });
  composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ...env }),
    metaStore: memoryStore(meta),
    manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: { templates: [], widgets: [], widgetContracts: {} },
    logger: false,
    telemetry: false,
    onMetaRelocated: () => undefined,
    ...(project === undefined ? {} : { project: { root: project, mode: 'server' as const, log: () => undefined, warn: () => undefined } }),
  });
  const { app } = composed;
  await app.ready();
  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/setup/super-admin',
    payload: { email: 'owner@example.test', password: 'a-long-enough-test-password-1!', name: 'Owner' },
  });
  expect(setup.statusCode, setup.body).toBe(201);
  const cookie = String(setup.headers['set-cookie']).split(';')[0] ?? '';
  return {
    get: async (url) => {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      return { status: res.statusCode, body: res.json() as Record<string, unknown> };
    },
  };
}

describe('a model named by the server’s environment', () => {
  it('gives the instance an assistant with nothing saved in Settings', async () => {
    const { get } = await server({ ADMINIUM_AI_OLLAMA_BASE_URL: 'http://localhost:11434', ADMINIUM_AI_MODEL: 'ollama/qwen3' });
    const bootstrap = await get('/api/v1/bootstrap');
    expect(bootstrap.status, JSON.stringify(bootstrap.body)).toBe(200);
    expect((bootstrap.body['data'] as { llm: unknown }).llm).toEqual({ enabled: true });

    const availability = await get('/api/v1/assistant/availability');
    expect(availability.body).toMatchObject({ enabled: true, reason: null, provider: 'ollama', model: 'qwen3' });

    const connections = await get('/api/v1/llm/connections');
    expect(connections.body).toMatchObject({ selected: 'ollama/qwen3', connections: [{ id: 'env:ollama', source: 'environment' }] });
  });

  it('has no assistant when nothing names a model anywhere', async () => {
    const { get } = await server({});
    expect(((await get('/api/v1/bootstrap')).body['data'] as { llm: unknown }).llm).toEqual({ enabled: false });
    expect((await get('/api/v1/assistant/availability')).body).toMatchObject({ enabled: false, reason: 'no-provider' });
  });

  it('says a cloud model cannot be used while network features are off', async () => {
    const { get } = await server({ ADMINIUM_AI_ANTHROPIC_API_KEY: 'sk-ant-env', ADMINIUM_AI_MODEL: 'anthropic/claude-x', ADMINIUM_NETWORK_FEATURES: 'off' });
    expect((await get('/api/v1/assistant/availability')).body).toMatchObject({ enabled: false, reason: 'network-disabled', provider: 'anthropic' });
  });

  it('reads a project’s .env for its model, and leaves the key out of the process environment', async () => {
    root = mkdtempSync(join(tmpdir(), 'adminium-ai-project-'));
    writeFileSync(join(root, '.env'), 'ADMINIUM_AI_ANTHROPIC_API_KEY=sk-ant-in-the-file\nADMINIUM_AI_MODEL=anthropic/claude-file\n');
    const { get } = await server({}, root);
    expect((await get('/api/v1/assistant/availability')).body).toMatchObject({ enabled: true, provider: 'anthropic', model: 'claude-file' });
    const connections = await get('/api/v1/llm/connections');
    expect(connections.body['connections']).toEqual([{ id: 'env:anthropic', provider: 'anthropic', source: 'environment', baseUrl: null, hasKey: true, model: 'claude-file' }]);
    expect(JSON.stringify(connections.body)).not.toContain('in-the-file');
    expect(Object.values(process.env)).not.toContain('sk-ant-in-the-file');
    expect(process.env['ADMINIUM_AI_ANTHROPIC_API_KEY']).toBeUndefined();
  });
});
