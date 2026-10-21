// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pay page's own routes: its HTML, its files and the demo's pretend page.
 * Pins the content policy every answer carries, the headers, the file route's
 * refusals, and the page that stands in when the pay bundle was never built.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDemoPaymentBackend } from '@adminium/add-on-contracts';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';

import { payContentPolicy, payPageRoutes } from '../src/routes/pay/page.js';

const HTML = '<!doctype html><html><head><title>Payment</title></head><body><div id="pay-root"></div></body></html>';

describe('the pay page routes', () => {
  let meta: MetaDb;
  let app: FastifyInstance;
  let spa: string;

  async function start(built: boolean): Promise<void> {
    if (built) {
      mkdirSync(join(spa, 'pay', 'assets'), { recursive: true });
      writeFileSync(join(spa, 'pay', 'index.html'), HTML);
      writeFileSync(join(spa, 'pay', 'assets', 'pay-abc123.js'), 'console.log(1);');
      writeFileSync(join(spa, 'index.html'), '<p>the dashboard</p>');
    }
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('spaRoot', spa);
    await app.register(
      payPageRoutes({
        meta,
        storage: { read: async () => Readable.from([]) },
        demo: createDemoPaymentBackend(),
        networkFeatures: true,
        desktop: false,
        trustProxy: false,
      }),
    );
    await app.ready();
  }

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    spa = mkdtempSync(join(tmpdir(), 'pay-page-'));
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
    rmSync(spa, { recursive: true, force: true });
  });

  it('answers every page with its own content policy, no cache and no referrer', async () => {
    await start(true);
    for (const url of ['/pay/AAAAAAAAAAAAAAAAAAAAAA', '/pay/back/abcdefghijklmnop', '/pay/demo/att_1']) {
      const answer = await app.inject({ method: 'GET', url, headers: { host: 'pay.crumbandco.test' } });
      expect(answer.statusCode, url).toBe(200);
      expect(answer.payload).toBe(HTML);
      expect(answer.headers['content-security-policy']).toBe(payContentPolicy('http://pay.crumbandco.test'));
      expect(answer.headers['cache-control']).toBe('no-store');
      expect(answer.headers['referrer-policy']).toBe('no-referrer');
      expect(answer.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('allows scripts, styles and fonts from the pay files only, and no form, frame or base', () => {
    expect(payContentPolicy('https://pay.crumbandco.test')).toBe(
      [
        "default-src 'none'",
        'script-src https://pay.crumbandco.test/pay/assets/',
        'style-src https://pay.crumbandco.test/pay/assets/',
        'font-src https://pay.crumbandco.test/pay/assets/',
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; '),
    );
  });

  it('serves its own hashed files for good, and nothing outside them', async () => {
    await start(true);
    const file = await app.inject({ method: 'GET', url: '/pay/assets/pay-abc123.js' });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(file.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(file.headers['content-security-policy']).toBeDefined();
    for (const url of ['/pay/assets/missing.js', '/pay/assets/..%2Findex.html', '/pay/assets/%2E%2E/%2E%2E/index.html', '/pay/assets/pay-abc123.html', '/pay/assets/a%00.js']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
  });

  it('says the page is not available, and never names the software, when the pay files were never built', async () => {
    await start(false);
    const answer = await app.inject({ method: 'GET', url: '/pay/AAAAAAAAAAAAAAAAAAAAAA' });
    expect(answer.statusCode).toBe(503);
    expect(answer.payload).toContain('Please contact the shop.');
    expect(answer.payload.toLowerCase()).not.toContain('adminium');
    expect(answer.headers['content-security-policy']).toBeDefined();
  });

  it('lets only the staff preview be framed, by this server itself', async () => {
    await start(true);
    const preview = await app.inject({ method: 'GET', url: '/pay/preview', headers: { host: 'pay.crumbandco.test' } });
    expect(preview.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    for (const url of ['/pay/AAAAAAAAAAAAAAAAAAAAAA', '/pay/preview/x', '/pay/previewx', '/pay/back/abcdefghijklmnop']) {
      const answer = await app.inject({ method: 'GET', url, headers: { host: 'pay.crumbandco.test' } });
      expect(String(answer.headers['content-security-policy']), url).not.toContain("frame-ancestors 'self'");
    }
  });

  it('shows the preview\'s logo to nobody without a payments right', async () => {
    await start(true);
    expect((await app.inject({ method: 'GET', url: '/pay/api/preview/logo' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/pay/api/preview/logo?file=fil_anything' })).statusCode).toBe(404);
  });

  it('drives the demo service for nobody without the right to manage payments', async () => {
    await start(true);
    expect((await app.inject({ method: 'GET', url: '/pay/api/demo/att_1' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/pay/api/demo/att_1', payload: { action: 'succeeds' } })).statusCode).toBe(404);
  });

  it('puts what a link offers with JavaScript off into the page, in place of the built sentence', async () => {
    mkdirSync(join(spa, 'pay', 'assets'), { recursive: true });
    writeFileSync(join(spa, 'pay', 'index.html'), '<!doctype html><html><body><noscript><p>Turn on JavaScript.</p></noscript><div id="pay-root"></div></body></html>');
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('spaRoot', spa);
    await app.register(
      payPageRoutes({
        meta,
        storage: { read: async () => Readable.from([]) },
        demo: null,
        noscript: async (_request, token) => `<p>bank details for ${token.length} $& $1</p>`,
        networkFeatures: true,
        desktop: false,
        trustProxy: false,
      }),
    );
    await app.ready();
    const answer = await app.inject({ method: 'GET', url: '/pay/AAAAAAAAAAAAAAAAAAAAAA' });
    expect(answer.payload).toContain('<noscript><p>bank details for 22 $& $1</p></noscript>');
    expect(answer.payload).not.toContain('Turn on JavaScript.');
  });
});
