// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { makeEnv } from './helpers.js';

const INDEX_HTML = '<!doctype html><html><head><title>Adminium</title></head><body></body></html>';

let dist: string;
let app: AdminiumServer | undefined;

beforeAll(async () => {
  dist = await mkdtemp(join(tmpdir(), 'adminium-static-'));
  await writeFile(join(dist, 'index.html'), INDEX_HTML, 'utf8');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'assets', 'app.css'), ':root{--x:1}', 'utf8');
});

afterAll(async () => {
  await rm(dist, { recursive: true, force: true });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('static plugin — dashboard build present', () => {
  async function build(): Promise<AdminiumServer> {
    app = await buildServer({ env: makeEnv(), logger: false, staticRoot: dist });
    return app;
  }

  it('serves index.html at /', async () => {
    const server = await build();
    expect(server.spaRoot).toBe(dist);
    const res = await server.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('Adminium');
  });

  it('serves real asset files', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/assets/app.css' });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('--x:1');
  });

  it('falls back to index.html for unknown non-API GET paths (SPA routing)', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/settings/profile' });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('Adminium');
  });

  it('never swallows /api/* — unknown API routes still get the 404 envelope', async () => {
    const server = await build();
    const res = await server.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('does not SPA-fallback non-GET requests', async () => {
    const server = await build();
    const res = await server.inject({ method: 'POST', url: '/settings/profile' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });
});

describe('static plugin — dashboard build absent (ships M4)', () => {
  it('cleanly no-ops when the directory does not exist', async () => {
    app = await buildServer({
      env: makeEnv(),
      logger: false,
      staticRoot: join(dist, 'definitely-missing'),
    });
    expect(app.spaRoot).toBeNull();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('cleanly no-ops when no staticRoot is configured at all', async () => {
    app = await buildServer({ env: makeEnv(), logger: false });
    expect(app.spaRoot).toBeNull();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
  });
});
