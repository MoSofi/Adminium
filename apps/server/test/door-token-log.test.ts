// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A token in a door's path is a credential, so the request log must not keep
 * it. For the "other" mail service with no password, the notice address's
 * token is the only proof a call is genuine; an object link erases a person; a
 * pay link opens a payment. These tests read what the real server writes to its
 * log, on the success path, on each refusal and on an error, and for every
 * spelling of an address the router still accepts.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSqliteMetaDb, firstRun, settingsRepo, type MetaDb } from '@adminium/meta';

import { buildLogger } from '../src/app.js';
import type { ComposedServer } from '../src/compose.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { createNoticeEndpoints } from '../src/email/notices/endpoints.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { buildOperatorEndpoint, type OperatorEndpointDeps } from '../src/operator/endpoint.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { fixtureText } from './relay-notice-helpers.js';

const SCRUBBED = '/api/v1/email/notices/other/[REDACTED]';
const JSON_HEADERS = { 'content-type': 'application/json' };

let root: string;
let meta: MetaDb;
let composed: ComposedServer;
let token: string;
const lines: string[] = [];
const logged = (): string => lines.join('\n');

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mail-notice-log-'));
  const dist = join(root, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<!doctype html><html><body></body></html>');
  const noBundle = join(root, 'no-bundle');
  await mkdir(noBundle);

  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await settingsRepo(meta).set('system.publicOrigin', 'https://news.meridian.example', { updatedBy: null });
  await settingsRepo(meta).set('system.instanceId', 'install-1', { updatedBy: null });
  token = (await createNoticeEndpoints({ meta, secret: TEST_SECRET }).open('other'))!.token;

  process.env['ADMINIUM_BUNDLED_ADD_ONS'] = noBundle;
  process.env['ADMINIUM_BUNDLED_APPS'] = noBundle;
  const { composeServer } = await import('../src/compose.js');
  const runService = createRunService({ meta });
  const metaStore: MetaStoreHandle = { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
  const env = makeEnv({ ADMINIUM_DATA_DIR: join(root, 'data'), HOST: '127.0.0.1', ADMINIUM_LOG_LEVEL: 'trace' });
  composed = await composeServer({
    env,
    metaStore,
    manager: new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), metaDsn: null }),
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    staticRoot: dist,
    logger: buildLogger(env, { pretty: false, stream: { write: (line: string) => void lines.push(line) } }),
    telemetry: false,
  });
  await composed.app.ready();
});

afterAll(async () => {
  delete process.env['ADMINIUM_BUNDLED_ADD_ONS'];
  delete process.env['ADMINIUM_BUNDLED_APPS'];
  await composed?.app.close();
  await meta?.db.destroy();
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  lines.length = 0;
});

const post = (url: string, payload = fixtureText('other-events.json')) =>
  composed.app.inject({ method: 'POST', url, headers: JSON_HEADERS, payload });

describe('the mail notice token in the request log', () => {
  it('a genuine call is logged with its service and without its token', async () => {
    const res = await post(`/api/v1/email/notices/other/${token}`);
    expect(res.statusCode).toBe(200);
    expect(logged()).not.toContain(token);
    expect(logged()).toContain(`"url":"${SCRUBBED}"`);
  });

  it('keeps a query string readable beside the scrubbed token', async () => {
    const res = await post(`/api/v1/email/notices/other/${token}?attempt=2`);
    expect(res.statusCode).toBe(200);
    expect(logged()).not.toContain(token);
    expect(logged()).toContain(`"url":"${SCRUBBED}?attempt=2"`);
  });

  it('a refused call leaks neither a right token nor a wrong one', async () => {
    const wrong = 'w'.repeat(43);
    expect((await post(`/api/v1/email/notices/other/${wrong}`)).statusCode).toBe(401);
    expect((await post(`/api/v1/email/notices/postmark/${token}`)).statusCode).toBe(401);
    expect((await post(`/api/v1/email/notices/other/${token}`, '{"events":"nope"}')).statusCode).toBeGreaterThanOrEqual(400);
    expect(logged()).not.toContain(wrong);
    expect(logged()).not.toContain(token);
    expect(logged()).toContain('/api/v1/email/notices/postmark/[REDACTED]');
  });

  it.each([
    ['an encoded letter in the fixed path', (t: string) => `/api/v1/email/n%6Ftices/other/${t}`],
    ['an encoded letter in the service', (t: string) => `/api/v1/email/notices/oth%65r/${t}`],
    ['an encoded letter in the prefix', (t: string) => `/%61pi/v1/email/notices/other/${t}`],
  ])('scrubs a spelling the router still accepts: %s', async (_name, spell) => {
    const res = await post(spell(token));
    expect(res.statusCode).toBe(200);
    expect(logged()).not.toContain(token);
  });

  it.each([
    ['a trailing segment', (t: string) => `/api/v1/email/notices/other/${t}/extra`],
    ['an empty segment before it', (t: string) => `/api/v1/email/notices/other//${t}`],
    ['no service', (t: string) => `/api/v1/email/notices/${t}`],
    ['a broken escape after it', (t: string) => `/api/v1/email/notices/other/${t}%zz`],
  ])('scrubs an address no route answers: %s', async (_name, spell) => {
    await post(spell(token));
    expect(logged()).not.toContain(token);
  });

  it('scrubs an absolute-form request line, which reaches the log as sent', async () => {
    await composed.app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = composed.app.server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(`POST http://news.meridian.example/api/v1/email/notices/other/${token} HTTP/1.1\r\nHost: news.meridian.example\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
      });
      socket.on('data', () => undefined);
      socket.on('end', () => resolve());
      socket.on('error', reject);
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(logged()).not.toContain(token);
  });

  it('an error while writing the events logs the service and not the token', async () => {
    await sql`ALTER TABLE adminium_stop_list RENAME TO adminium_stop_list_held`.execute(meta.db);
    try {
      const res = await post(`/api/v1/email/notices/other/${token}`, JSON.stringify({ events: [{ address: 'late@cobaltlegal.example', kind: 'bounce', id: 'log-test-error' }] }));
      expect(res.statusCode).toBe(503);
    } finally {
      await sql`ALTER TABLE adminium_stop_list_held RENAME TO adminium_stop_list`.execute(meta.db);
    }
    expect(logged()).toContain('mail notice: the events could not be written');
    expect(logged()).not.toContain(token);
  });

  it('the operator listener scrubs the address when it logs a wrong token', async () => {
    const env = makeEnv({ ADMINIUM_LOG_LEVEL: 'trace' });
    const seen: string[] = [];
    const endpoint = await buildOperatorEndpoint({
      meta,
      token: 'a1'.repeat(32),
      // A call without the operator's token is refused before any of these is read.
      holds: {} as OperatorEndpointDeps['holds'],
      status: () => Promise.reject(new Error('not reached')),
      publicContent: () => Promise.reject(new Error('not reached')),
      reinstall: () => Promise.reject(new Error('not reached')),
      logger: buildLogger(env, { pretty: false, stream: { write: (line: string) => void seen.push(line) } }),
    });
    try {
      const res = await endpoint.inject({ method: 'POST', url: `/api/v1/email/notices/other/${token}` });
      expect(res.statusCode).toBe(401);
    } finally {
      await endpoint.close();
    }
    expect(seen.join('\n')).toContain('operator endpoint: wrong or missing token');
    expect(seen.join('\n')).toContain(SCRUBBED);
    expect(seen.join('\n')).not.toContain(token);
  });
});

describe('the tokens of the other doors in the request log', () => {
  const secret = 'S3cr3tDoorT0ken-abc_DEF123';

  it.each([
    ['an object link', 'GET', `/m/o/${secret}`, '/m/o/[REDACTED]'],
    ['an object link, pressed', 'POST', `/m/o/${secret}`, '/m/o/[REDACTED]'],
    ['an object link, its letter encoded', 'GET', `/m/%6F/${secret}`, '/m/%6F/[REDACTED]'],
    ['an unsubscribe link, its letter encoded', 'GET', `/m/%75/${secret}`, '/m/%75/[REDACTED]'],
    ['a click link, its letter encoded', 'GET', `/m/%6C/${secret}`, '/m/%6C/[REDACTED]'],
    ['a confirm link, its letter encoded', 'GET', `/m/%63/${secret}`, '/m/%63/[REDACTED]'],
    ['a mail link, its door encoded', 'GET', `/%6D/u/${secret}`, '/%6D/u/[REDACTED]'],
    ['a pay link, its door encoded', 'GET', `/p%61y/${secret}`, '/p%61y/[REDACTED]'],
    ['a pay call, its api encoded', 'GET', `/pay/%61pi/${secret}`, '/pay/%61pi/[REDACTED]'],
    ['a way back, encoded', 'GET', `/pay/b%61ck/${secret}`, '/pay/b%61ck/[REDACTED]'],
    ['a database hand-off', 'GET', `/api/v1/bridge/seed/${secret}`, '/api/v1/bridge/seed/[REDACTED]'],
    ['a one-time print', 'GET', `/api/v1/documents/print-once/${secret}`, '/api/v1/documents/print-once/[REDACTED]'],
    ['a row change undone', 'POST', `/api/v1/data/undo/${secret}`, '/api/v1/data/undo/[REDACTED]'],
    ['an AI change undone', 'POST', `/api/v1/llm/runs/run_1/undo/${secret}`, '/api/v1/llm/runs/run_1/undo/[REDACTED]'],
  ] as const)('scrubs %s', async (_name, method, url, scrubbed) => {
    await composed.app.inject({ method, url, ...(method === 'POST' ? { headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'act=nothing' } : {}) });
    expect(logged()).not.toContain(secret);
    expect(logged()).toContain(`"url":"${scrubbed}"`);
  });
});

describe('the inbound door in the request log', () => {
  const secret = 'S3cr3tInb0undT0ken-abc_DEF123';

  it.each([
    ['a Twilio call', `/api/v1/inbound/sms/twilio/${secret}`, '/api/v1/inbound/sms/twilio/[REDACTED]'],
    ['a Telnyx call', `/api/v1/inbound/sms/telnyx/${secret}`, '/api/v1/inbound/sms/telnyx/[REDACTED]'],
    ['its door encoded', `/api/v1/%69nbound/sms/twilio/${secret}`, '/api/v1/%69nbound/sms/twilio/[REDACTED]'],
    ['its source encoded', `/api/v1/inbound/sms/twil%69o/${secret}`, '/api/v1/inbound/sms/twil%69o/[REDACTED]'],
    ['a token pasted a segment early', `/api/v1/inbound/sms/${secret}`, '/api/v1/inbound/sms/[REDACTED]'],
    ['a channel it does not know', `/api/v1/inbound/${secret}/twilio/more`, '/api/v1/inbound/[REDACTED]'],
  ] as const)('scrubs %s', async (_name, url, scrubbed) => {
    await composed.app.inject({ method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'From=%2B14155552671&Body=STOP' });
    expect(logged()).not.toContain(secret);
    expect(logged()).not.toContain('14155552671');
    expect(logged()).toContain(`"url":"${scrubbed}"`);
  });

  it('is registered, and with no provider connected answers 503 so the provider keeps the event', async () => {
    const res = await composed.app.inject({ method: 'POST', url: `/api/v1/inbound/sms/twilio/${secret}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'Body=STOP' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ received: false });
  });

  it('keeps the sweep on the schedule', () => {
    expect(composed.jobs.scheduler.names()).toContain('inbound-sweep');
  });
});
