// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Signed instance events: what an awake instance tells its operator's control
 * service, at `ADMINIUM_OPERATOR_EVENTS_URL` and nowhere else.
 *
 * - every body is signed with the operator token (HMAC-SHA256 over the
 *   timestamp, a dot and the body); the receiver's check passes, and fails for
 *   a changed body, a changed timestamp or an old one;
 * - a refused send waits and is tried again, each wait longer than the last,
 *   then delivered with the same event id;
 * - nothing goes to another address: not to a redirect's, not ever;
 * - with the URL unset nothing is queued and nothing is sent;
 * - the storage event fires once per crossing of 80%, a restart included;
 * - a public page that changed is sent alone, a burst of changes as one event;
 * - each event comes from its real hook on a whole server, and no body carries
 *   anything but what its event says: no row, no name, no email.
 *
 * The queue is proved on every engine this run reaches.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, jobsRepo, rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sanitizeDump } from '../src/archive/policy.js';
import { discoverSurfaces, type HostedSurface } from '../src/cli/surfaces-root.js';
import { composeServer, type ComposedServer } from '../src/compose.js';
import { enforceProfile } from '../src/config/env.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { enqueueRenderedEmail } from '../src/email/send.js';
import { configureTrialMail } from '../src/email/trial-relay.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import {
  createOperatorEvents,
  OPERATOR_EVENT_JOB_KIND,
  registerOperatorEventsHandler,
  signOperatorEvent,
  verifyOperatorEvent,
  type OperatorEvents,
  type OperatorEventsOptions,
} from '../src/operator/events.js';
import { publicFilesMayHaveChanged } from '../src/operator/public-signal.js';
import { RealtimeHub } from '../src/realtime/hub.js';
import { trialPolicy } from '../src/trial/policy.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const TOKEN = 'c3'.repeat(32);
const MB = 1024 * 1024;

// --- a receiver on this machine ----------------------------------------------------

interface Heard {
  headers: IncomingHttpHeaders;
  body: string;
  path: string;
}

interface Receiver {
  url: string;
  heard: Heard[];
  /** What the next requests are answered with, in order; 200 once they run out. */
  answers: (number | { status: number; location: string })[];
  close: () => Promise<void>;
  /** Wait until `count` requests were heard (or fail after `ms`). */
  until: (count: number, ms?: number) => Promise<Heard[]>;
}

async function receiver(): Promise<Receiver> {
  const heard: Heard[] = [];
  const answers: Receiver['answers'] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      heard.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8'), path: req.url ?? '' });
      const answer = answers.shift() ?? 200;
      if (typeof answer === 'number') {
        res.writeHead(answer, { 'content-type': 'text/plain' }).end(answer >= 400 ? 'no' : 'ok');
      } else {
        res.writeHead(answer.status, { location: answer.location }).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}/hooks/instance`,
    heard,
    answers,
    close: async () => new Promise<void>((resolve) => server.close(() => resolve())),
    until: async (count, ms = 20_000) => {
      const deadline = Date.now() + ms;
      while (heard.length < count) {
        if (Date.now() > deadline) throw new Error(`heard ${String(heard.length)} of ${String(count)} events`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return heard;
    },
  };
}

const parsed = (heard: Heard): { v: number; id: string; type: string; at: number; data: Record<string, unknown> } => JSON.parse(heard.body) as never;

const verifies = (heard: Heard, now = Date.now()): boolean =>
  verifyOperatorEvent({
    token: TOKEN,
    body: heard.body,
    timestamp: String(heard.headers['x-adminium-timestamp']),
    signature: String(heard.headers['x-adminium-signature']),
    now,
  });

// --- the scheme, as a receiver checks it ------------------------------------------

describe('the signature', () => {
  it('is HMAC-SHA256 with the token over "<timestamp>.<body>", hex, with a version prefix', () => {
    const body = '{"v":1}';
    const signature = signOperatorEvent(TOKEN, 1_762_944_000, body);
    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifyOperatorEvent({ token: TOKEN, body, timestamp: '1762944000', signature, now: 1_762_944_000_000 })).toBe(true);
    // Any byte of the body, the timestamp or the token changed: refused.
    expect(verifyOperatorEvent({ token: TOKEN, body: '{"v":2}', timestamp: '1762944000', signature, now: 1_762_944_000_000 })).toBe(false);
    expect(verifyOperatorEvent({ token: TOKEN, body, timestamp: '1762944001', signature, now: 1_762_944_000_000 })).toBe(false);
    expect(verifyOperatorEvent({ token: 'd4'.repeat(32), body, timestamp: '1762944000', signature, now: 1_762_944_000_000 })).toBe(false);
    // A replay: the right signature, five minutes and a second late.
    expect(verifyOperatorEvent({ token: TOKEN, body, timestamp: '1762944000', signature, now: 1_762_944_301_000 })).toBe(false);
    expect(verifyOperatorEvent({ token: TOKEN, body, timestamp: 'soon', signature, now: 1_762_944_000_000 })).toBe(false);
  });
});

// --- the queue, on every engine ------------------------------------------------------

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the queue [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let recv: Receiver;
    let other: Receiver;
    let clock: number;
    let worker: JobWorker;
    let root: string;
    let surfaces: HostedSurface[];
    const T0 = Date.UTC(2026, 10, 12, 9, 0, 0);
    const now = () => clock;
    const live: OperatorEvents[] = [];

    /** The queue's sender alone, on `meta`, with `url` (the receiver's unless told otherwise). */
    function sender(over: Partial<OperatorEventsOptions> = {}): OperatorEventsOptions {
      const opts: OperatorEventsOptions = {
        meta,
        url: recv.url,
        token: TOKEN,
        surfaces: () => surfaces,
        forms: null,
        now,
        debounceMs: 20,
        log: { warn: (fields, message) => console.warn(message, fields) },
        ...over,
      };
      const registry = createJobRegistry();
      registerOperatorEventsHandler(registry, opts);
      worker = new JobWorker({ meta, registry, hub: new RealtimeHub(), workerId: 'operator-events', backoffBaseMs: 1_000, concurrency: 1, now });
      return opts;
    }
    /** The events and their sender. */
    function events(over: Partial<OperatorEventsOptions> = {}): OperatorEvents {
      const made = createOperatorEvents(sender(over));
      live.push(made);
      return made;
    }
    const drain = async () => {
      while ((await worker.runOnce()) > 0) {
        // until nothing is due
      }
    };
    const queued = async () => (await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', OPERATOR_EVENT_JOB_KIND).orderBy('createdAt').orderBy('id').execute());

    async function superAdmin(): Promise<string> {
      const user = await usersRepo(meta).create({ email: 'dana@hollisbakery.example', name: 'Dana Price', status: 'active' });
      const role = await rolesRepo(meta).findBySlug('super-admin');
      await rolesRepo(meta).assignToUser(user.id, role!.id);
      return user.id;
    }

    beforeEach(async () => {
      clock = T0;
      handle = await engine.make();
      meta = handle.meta;
      recv = await receiver();
      other = await receiver();
      root = await mkdtemp(join(tmpdir(), 'operator-events-'));
      await mkdir(join(root, 'shop', 'customer'), { recursive: true });
      await writeFile(join(root, 'shop', 'customer', 'index.html'), '<!doctype html><title>Hollis Bakery</title><p>Fresh bread every morning</p>');
      await mkdir(join(root, 'menu', 'customer'), { recursive: true });
      await writeFile(join(root, 'menu', 'customer', 'index.html'), '<!doctype html><title>Menu</title><p>Rye, spelt, sourdough</p>');
      surfaces = discoverSurfaces(root);
    }, 180_000);

    afterEach(async () => {
      while (live.length > 0) await live.pop()?.stop();
      await recv.close();
      await other.close();
      await handle.destroy();
      await rm(root, { recursive: true, force: true });
    });

    it('signs each event: the receiver’s check passes, and fails for a tampered body', async () => {
      const made = events();
      const userId = await superAdmin();
      made.signedIn({ actorId: userId, createdAt: T0 - 5_000, ip: '203.0.113.7' });
      await made.settled();
      await drain();
      expect(recv.heard).toHaveLength(1);
      const [heard] = recv.heard;
      expect(heard!.path).toBe('/hooks/instance');
      expect(heard!.headers['content-type']).toBe('application/json');
      expect(heard!.headers['x-adminium-event']).toBe('super-admin.signed-in');
      expect(heard!.headers['x-adminium-timestamp']).toBe(String(Math.floor(T0 / 1000)));
      expect(verifies(heard!, T0)).toBe(true);
      expect(parsed(heard!)).toEqual({ v: 1, id: heard!.headers['x-adminium-event-id'], type: 'super-admin.signed-in', at: T0 - 5_000, data: { ip: '203.0.113.7' } });
      expect(verifies({ ...heard!, body: heard!.body.replace('203.0.113.7', '203.0.113.8') }, T0)).toBe(false);
    });

    it('a sign-in of anybody but a Super Admin is no event', async () => {
      const made = events();
      const clerk = await usersRepo(meta).create({ email: 'sam@hollisbakery.example', name: 'Sam Lee', status: 'active' });
      made.signedIn({ actorId: clerk.id, createdAt: T0, ip: '203.0.113.9' });
      made.signedIn({ actorId: null, createdAt: T0, ip: '203.0.113.9' });
      await made.settled();
      expect(await queued()).toHaveLength(0);
    });

    it('a refused send waits, longer each time, then is delivered with the same id', async () => {
      const made = events();
      recv.answers.push(500, 503);
      made.emailCapReached({ cap: 'hour', at: T0, window: T0, waiting: 3 });
      await made.settled();
      await drain();
      expect(recv.heard).toHaveLength(1);
      const [first] = await queued();
      expect(first!.status).toBe('pending');
      expect(first!.lastError).toContain('500');
      const firstWait = Number(first!.runAt) - T0;
      expect(firstWait).toBeGreaterThan(0);
      // Not due yet: nothing is sent before the wait is over.
      clock = T0 + firstWait - 1;
      await drain();
      expect(recv.heard).toHaveLength(1);
      clock = T0 + firstWait;
      await drain();
      expect(recv.heard).toHaveLength(2);
      const [second] = await queued();
      const secondWait = Number(second!.runAt) - clock;
      expect(secondWait).toBeGreaterThan(firstWait);
      clock += secondWait;
      await drain();
      expect(recv.heard).toHaveLength(3);
      expect((await queued())[0]!.status).toBe('succeeded');
      const ids = recv.heard.map((heard) => parsed(heard).id);
      expect(new Set(ids).size).toBe(1);
      // Each attempt is signed afresh, with the time it was sent.
      const stamps = recv.heard.map((heard) => Number(heard.headers['x-adminium-timestamp']));
      expect(new Set(stamps).size).toBe(3);
      expect(recv.heard.every((heard, i) => verifies(heard, stamps[i]! * 1000))).toBe(true);
      expect(parsed(recv.heard[2]!)).toMatchObject({ type: 'email.cap-reached', at: T0, data: { cap: 'hour', window: T0, waiting: 3 } });
    });

    it('never follows a redirect: the other address hears nothing, and the event waits to be tried again', async () => {
      const made = events();
      recv.answers.push({ status: 302, location: other.url }, { status: 307, location: other.url });
      made.emailCapReached({ cap: 'day', at: T0, window: T0, waiting: 1 });
      await made.settled();
      await drain();
      expect(recv.heard).toHaveLength(1);
      expect(other.heard).toHaveLength(0);
      const [job] = await queued();
      expect(job!.status).toBe('pending');
      expect(job!.lastError).toMatch(/redirect/i);
      clock = Number(job!.runAt);
      await drain();
      clock = Number((await queued())[0]!.runAt);
      await drain();
      expect(other.heard).toHaveLength(0);
      expect(recv.heard).toHaveLength(3);
      expect((await queued())[0]!.status).toBe('succeeded');
    });

    it('with no URL nothing is sent: a queued event is let go unsent', async () => {
      const made = events();
      made.emailCapReached({ cap: 'day', at: T0, window: T0, waiting: 1 });
      await made.settled();
      // The same queue on a server whose operator took the URL away.
      sender({ url: null });
      await drain();
      expect(recv.heard).toHaveLength(0);
      expect(other.heard).toHaveLength(0);
      expect((await queued())[0]!.status).toBe('succeeded');
      expect(() => createOperatorEvents({ meta, url: null, token: TOKEN, surfaces: () => surfaces, forms: null })).toThrow();
    });

    it('storage over 80%: once per crossing, a restart included', async () => {
      const made = events();
      const reading = (share: number) => ({ kind: 'storage' as const, usedBytes: Math.round(share * 1000 * MB), limitBytes: 1000 * MB, measuredAt: new Date(clock).toISOString(), over: share > 1 });
      for (const share of [0.5, 0.79, 0.85, 0.9, 0.81, 0.85]) made.storageReading(reading(share));
      await made.settled();
      expect(await queued()).toHaveLength(1);
      // Under 75% and back over: a second crossing.
      made.storageReading(reading(0.7));
      made.storageReading(reading(0.86));
      // A database of its own crosses on its own.
      made.storageReading({ kind: 'data', connectionId: 'con_shop', usedBytes: 450 * MB, limitBytes: 500 * MB, measuredAt: new Date(clock).toISOString(), held: false });
      await made.settled();
      expect(await queued()).toHaveLength(3);
      await made.stop();

      // The server restarts, still over: the crossing was told already (read back from the queue).
      const again = events();
      again.storageReading(reading(0.9));
      again.storageReading({ kind: 'data', connectionId: 'con_shop', usedBytes: 460 * MB, limitBytes: 500 * MB, measuredAt: new Date(clock).toISOString(), held: false });
      await again.settled();
      expect(await queued()).toHaveLength(3);
      await drain();
      expect(recv.heard.map((heard) => parsed(heard).data)).toEqual([
        { target: 'files', usedBytes: 850 * MB, limitBytes: 1000 * MB },
        { target: 'files', usedBytes: 860 * MB, limitBytes: 1000 * MB },
        { target: 'database', connectionId: 'con_shop', usedBytes: 450 * MB, limitBytes: 500 * MB },
      ]);
      expect(recv.heard.every((heard) => verifies(heard, clock))).toBe(true);
    });

    it('a public page: each side sent at first, then only the one that changed, a burst as one event', async () => {
      const made = events();
      await made.start();
      await made.settled();
      await drain();
      expect(recv.heard.map((heard) => (parsed(heard).data as { side: { appKey: string } }).side.appKey).sort()).toEqual(['menu', 'shop']);
      const shop = recv.heard.map(parsed).find((event) => (event.data as { side: { appKey: string } }).side.appKey === 'shop')!;
      expect(shop.type).toBe('public-page.changed');
      expect(shop.data).toEqual({
        side: {
          appKey: 'shop',
          path: '/apps/shop/customer/',
          truncated: false,
          files: [{ path: 'index.html', bytes: expect.any(Number) as number, sha256: expect.any(String) as string, text: '<!doctype html><title>Hollis Bakery</title><p>Fresh bread every morning</p>' }],
        },
      });

      // Nothing changed: nothing sent.
      made.publicMayHaveChanged();
      await made.settled();
      await drain();
      expect(recv.heard).toHaveLength(2);

      // Three quick edits of one side: one event, with the last text.
      for (const words of ['Rye', 'Rye and spelt', 'Rye, spelt and seeded']) {
        await writeFile(join(root, 'shop', 'customer', 'index.html'), `<!doctype html><p>${words}</p>`);
        made.publicMayHaveChanged();
      }
      await made.settled();
      await drain();
      expect(recv.heard).toHaveLength(3);
      expect(parsed(recv.heard[2]!).data).toMatchObject({ side: { appKey: 'shop', files: [{ text: '<!doctype html><p>Rye, spelt and seeded</p>' }] } });

      // A side gone: said so, with nothing else.
      surfaces = surfaces.filter((surface) => surface.appKey !== 'menu');
      made.publicMayHaveChanged();
      await made.settled();
      await drain();
      expect(parsed(recv.heard[3]!).data).toEqual({ side: { appKey: 'menu', removed: true } });
      await made.stop();

      // A restart with nothing changed: nothing sent again.
      const again = events();
      await again.start();
      await again.settled();
      await drain();
      expect(recv.heard).toHaveLength(4);
      expect(recv.heard.every((heard) => verifies(heard, clock))).toBe(true);
    });

    it('a live form is sent with its fields; closed, it is said to be gone', async () => {
      let state: 'live' | 'closed' = 'live';
      const form = { title: 'Spring offer', fields: [{ key: 'email', label: 'Your email', type: 'email' }] };
      const made = events({
        surfaces: () => [],
        forms: {
          liveSlugs: async () => (state === 'live' ? [{ addOn: 'forms', slug: 'spring-offer' }] : []),
          find: async () => (state === 'live' ? { state: 'live', live: { addOn: 'forms', form } } : { state: 'closed' }),
        },
      });
      await made.start();
      await made.settled();
      await drain();
      expect(parsed(recv.heard[0]!).data).toEqual({ form: { slug: 'spring-offer', addOn: 'forms', form } });
      state = 'closed';
      made.publicMayHaveChanged();
      await made.settled();
      await drain();
      expect(parsed(recv.heard[1]!).data).toEqual({ form: { slug: 'spring-offer', removed: true } });
    });

    it('the queued events stay out of an archive and an export, and out of the jobs routes', async () => {
      const made = events();
      made.emailCapReached({ cap: 'day', at: T0, window: T0, waiting: 1 });
      await made.settled();
      await jobsRepo(meta).enqueue({ kind: 'noop-progress', payload: {} }, T0);
      for (const kind of ['full', 'export'] as const) {
        const rows = (await meta.db.selectFrom('adminium_jobs').select(['id', 'kind']).execute()).map((row) => [row.id, row.kind]);
        const dump = new Map([['adminium_jobs', { table: 'adminium_jobs', kinds: {}, columns: ['id', 'kind'], rows }]]);
        sanitizeDump(dump as never, { kind, dialect: engine.name as 'sqlite' });
        const kept = dump.get('adminium_jobs');
        const kinds = kept === undefined ? [] : kept.rows.map((row) => row[1]);
        expect(kinds, kind).not.toContain(OPERATOR_EVENT_JOB_KIND);
        if (kind === 'full') expect(kinds).toContain('noop-progress');
      }
    });
  });
}

// --- a whole server: each event from its real hook ---------------------------------

const ORIGIN = 'https://hollis.try.example.com';
const HOST = 'hollis.try.example.com';
const SETUP_TOKEN = 'a-long-enough-setup-token';
const OWNER = 'dana@hollisbakery.example';
const PASSWORD = 'a-long-enough-test-password-1!';
const USER_AGENT = 'Mozilla/5.0 (Marker-UA-4471)';
const ROW_MARKER = 'ROW-MARKER-9f3c';

describe('a whole server', () => {
  let dir: string;
  let dataDir: string;
  let surfacesDir: string;
  let recv: Receiver;
  let composed: ComposedServer | undefined;
  let meta: MetaDb | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'operator-events-server-'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><html><body></body></html>');
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    recv = await receiver();
    dataDir = await mkdtemp(join(tmpdir(), 'operator-events-data-'));
    surfacesDir = await mkdtemp(join(tmpdir(), 'operator-events-surfaces-'));
    await mkdir(join(surfacesDir, 'shop', 'customer'), { recursive: true });
    await writeFile(join(surfacesDir, 'shop', 'customer', 'index.html'), '<!doctype html><title>Hollis Bakery</title><p>Fresh bread every morning</p>');
    await mkdir(join(surfacesDir, 'shop', 'staff'), { recursive: true });
    await writeFile(join(surfacesDir, 'shop', 'staff', 'index.html'), `<!doctype html><title>Till</title><p>${ROW_MARKER}</p>`);
  });
  afterEach(async () => {
    await composed?.app.close();
    composed = undefined;
    await meta?.db.destroy();
    meta = undefined;
    configureTrialMail(null);
    await recv.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(surfacesDir, { recursive: true, force: true });
  });

  async function serve(env: Record<string, string>): Promise<ComposedServer> {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const parsedEnv = enforceProfile(makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir, ...env }));
    const runService = createRunService({ meta });
    composed = await composeServer({
      env: parsedEnv,
      metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
      manager: new ConnectionManager({
        meta,
        crypto: dsnCryptoFromSecret(TEST_SECRET),
        metaDsn: null,
        blockLoopback: true,
        databaseHosts: parsedEnv.ADMINIUM_DATABASE_HOSTS,
        networkPolicy: parsedEnv.ADMINIUM_NETWORK_POLICY,
        lookup: async () => Promise.reject(new Error('ENOTFOUND')),
        policy: trialPolicy(parsedEnv),
      }),
      runService,
      applyService: createApplyService({ meta, runService }),
      allowed: { templates: [], widgets: [], widgetContracts: {} },
      logger: false,
      telemetry: false,
      onMetaRelocated: () => undefined,
      staticRoot: dir,
      surfaces: discoverSurfaces(surfacesDir),
    });
    await composed.app.ready();
    return composed;
  }

  const trialEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
    ADMINIUM_TRIAL_MODE: 'on',
    ADMINIUM_TRIAL_ENDS_AT: '2099-12-01T00:00:00Z',
    ADMINIUM_PUBLIC_ORIGIN: ORIGIN,
    ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
    ADMINIUM_SETUP_TOKEN: SETUP_TOKEN,
    // A relay nobody listens on: mail is only queued here.
    ADMINIUM_TRIAL_SMTP_URL: 'smtp://127.0.0.1:9',
    ADMINIUM_TRIAL_MAIL_FROM: 'i-7f3a9c@relay.example.com',
    ADMINIUM_TRIAL_STORAGE_MAX_MB: '1',
    ADMINIUM_OPERATOR_TOKEN: TOKEN,
    ADMINIUM_OPERATOR_EVENTS_URL: recv.url,
    ...extra,
  });

  const byType = (type: string) => recv.heard.map(parsed).filter((event) => event.type === type);

  it('on a trial: the public page, the storage, the Super Admin’s sign-in and the mail cap, each from its own hook, signed, no row in any body', async () => {
    // 850 KB of the 1 MB the trial's files may take.
    await writeFile(join(dataDir, 'kept.bin'), Buffer.alloc(850 * 1024, 1));
    const server = await serve(trialEnv());
    const { app } = server;

    // At boot: the customer side never sent before, and the data folder over 80%.
    await recv.until(2);
    expect(byType('public-page.changed').map((event) => event.data)).toEqual([
      { side: { appKey: 'shop', path: '/apps/shop/customer/', truncated: false, files: [expect.objectContaining({ path: 'index.html', text: '<!doctype html><title>Hollis Bakery</title><p>Fresh bread every morning</p>' })] } },
    ]);
    expect(byType('storage.over-80').map((event) => event.data)).toEqual([{ target: 'files', usedBytes: expect.any(Number) as number, limitBytes: MB }]);

    // The owner sets up, then signs in again from their phone: the sign-in is an event, the setup's own landing is not one.
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/super-admin',
      headers: { host: HOST, origin: ORIGIN, 'user-agent': USER_AGENT },
      payload: { email: OWNER, password: PASSWORD, name: 'Dana Price', consent: { telemetry: false, updateCheck: false }, setupToken: SETUP_TOKEN },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { host: HOST, origin: ORIGIN, 'user-agent': USER_AGENT }, remoteAddress: '203.0.113.7', payload: { email: OWNER, password: PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    // A clerk's sign-in is nobody's business but the instance's.
    await usersRepo(meta!).create({ email: 'sam@hollisbakery.example', name: 'Sam Lee', status: 'active', passwordHash: await adminPasswordHash() });
    const clerk = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { host: HOST, origin: ORIGIN }, remoteAddress: '203.0.113.9', payload: { email: 'sam@hollisbakery.example', password: ADMIN_PASSWORD } });
    expect(clerk.statusCode, clerk.body).toBe(200);
    await recv.until(3);

    // Twenty-one emails to five people in one hour: the hour's cap holds the last one back.
    for (let i = 0; i < 21; i += 1) {
      await enqueueRenderedEmail(
        { meta: meta!, secret: TEST_SECRET },
        { to: `person${String(i % 5)}@customer.example`, templateKey: 'order-shipped', locale: 'en_US', rendered: { subject: `Order ${String(i)} ${ROW_MARKER}`, html: `<p>${ROW_MARKER}</p>`, text: ROW_MARKER, inline: [] } },
      );
    }
    await recv.until(4);

    // The side edited, and the build says so: only that side, with its new words.
    await writeFile(join(surfacesDir, 'shop', 'customer', 'index.html'), '<!doctype html><p>Now with seeded rye</p>');
    publicFilesMayHaveChanged();
    await recv.until(5);

    expect(byType('super-admin.signed-in').map((event) => event.data)).toEqual([{ ip: '203.0.113.7' }]);
    expect(byType('email.cap-reached').map((event) => event.data)).toEqual([{ cap: 'hour', window: expect.any(Number) as number, waiting: expect.any(Number) as number }]);
    expect(byType('public-page.changed').map((event) => event.data)).toEqual([
      expect.objectContaining({ side: expect.objectContaining({ appKey: 'shop' }) }),
      { side: { appKey: 'shop', path: '/apps/shop/customer/', truncated: false, files: [expect.objectContaining({ text: '<!doctype html><p>Now with seeded rye</p>' })] } },
    ]);

    for (const heard of recv.heard) {
      expect(verifies(heard), heard.body).toBe(true);
      // No row, no name, no email, no browser: an event says what it says and nothing else.
      for (const secret of [ROW_MARKER, OWNER, 'Dana Price', 'Sam Lee', 'sam@hollisbakery.example', 'person0@customer.example', USER_AGENT, PASSWORD, TOKEN]) {
        expect(heard.body, `${String(heard.headers['x-adminium-event'])} carries ${secret}`).not.toContain(secret);
      }
      expect(Object.keys(parsed(heard)).sort()).toEqual(['at', 'data', 'id', 'type', 'v']);
    }
    expect(recv.heard).toHaveLength(5);

    // The instance's own Super Admin never sees them in the jobs routes, nor cancels one.
    const cookie = sessionCookie(login.headers['set-cookie']);
    const asOwner = { host: HOST, origin: ORIGIN, cookie };
    const listed = await app.inject({ method: 'GET', url: '/api/v1/jobs?limit=100', headers: asOwner });
    expect(listed.statusCode, listed.body).toBe(200);
    expect((listed.json() as { data: { kind: string }[] }).data.map((job) => job.kind)).not.toContain(OPERATOR_EVENT_JOB_KIND);
    expect((listed.json() as { data: { kind: string }[] }).data.length).toBeGreaterThan(0);
    const csrf = ((await app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: asOwner })).json() as { data: { csrfToken: string } }).data.csrfToken;
    const shown = (listed.json() as { data: { id: string }[] }).data[0]!.id;
    expect((await app.inject({ method: 'GET', url: `/api/v1/jobs/${shown}`, headers: asOwner })).statusCode).toBe(200);
    const one = parsed(recv.heard[0]!).id;
    expect((await app.inject({ method: 'GET', url: `/api/v1/jobs/${one}`, headers: asOwner })).statusCode).toBe(404);
    const cancel = await app.inject({ method: 'POST', url: `/api/v1/jobs/${one}/cancel`, headers: { ...asOwner, 'x-adminium-csrf': csrf } });
    expect(cancel.statusCode, cancel.body).toBe(404);
  }, 60_000);

  it('with the URL unset: nothing queued, nothing sent', async () => {
    const { ADMINIUM_OPERATOR_EVENTS_URL: _url, ...env } = trialEnv();
    await writeFile(join(dataDir, 'kept.bin'), Buffer.alloc(900 * 1024, 1));
    const server = await serve({ ...env, ADMINIUM_OPERATOR_LISTEN: '127.0.0.1:4805' });
    expect(server.app.operatorEvents).toBeNull();
    await server.app.sizeCap?.measureStorage();
    const setup = await server.app.inject({
      method: 'POST',
      url: '/api/v1/setup/super-admin',
      headers: { host: HOST, origin: ORIGIN },
      payload: { email: OWNER, password: PASSWORD, name: 'Dana Price', consent: { telemetry: false, updateCheck: false }, setupToken: SETUP_TOKEN },
    });
    expect(setup.statusCode).toBe(201);
    expect((await server.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { host: HOST, origin: ORIGIN }, payload: { email: OWNER, password: PASSWORD } })).statusCode).toBe(200);
    publicFilesMayHaveChanged();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(recv.heard).toHaveLength(0);
    expect(await meta!.db.selectFrom('adminium_jobs').select('id').where('kind', '=', OPERATOR_EVENT_JOB_KIND).execute()).toHaveLength(0);
  }, 30_000);

  it('not only on a trial: any server with the URL and the token sends them, the token alone needs no listener', async () => {
    const server = await serve({ ADMINIUM_OPERATOR_TOKEN: TOKEN, ADMINIUM_OPERATOR_EVENTS_URL: recv.url });
    expect(server.app.operatorEvents).not.toBeNull();
    await recv.until(1);
    expect(byType('public-page.changed')).toHaveLength(1);
    expect(verifies(recv.heard[0]!)).toBe(true);
  }, 30_000);

  it('on a hosted installation: the public page and the Super Admin’s sign-in are sent, signed', async () => {
    const server = await serve({
      ADMINIUM_HOSTED_MODE: 'on',
      ADMINIUM_PUBLIC_ORIGIN: ORIGIN,
      ADMINIUM_DATABASE_HOSTS: 'pg-trials:5432',
      ADMINIUM_SETUP_TOKEN: SETUP_TOKEN,
      ADMINIUM_OPERATOR_TOKEN: TOKEN,
      ADMINIUM_OPERATOR_EVENTS_URL: recv.url,
    });
    expect(server.app.trialPolicy.profile).toBe('hosted');
    expect(server.app.operatorEvents).not.toBeNull();
    await recv.until(1);
    expect(byType('public-page.changed')).toHaveLength(1);
    const setup = await server.app.inject({
      method: 'POST',
      url: '/api/v1/setup/super-admin',
      headers: { host: HOST, origin: ORIGIN },
      payload: { email: OWNER, password: PASSWORD, name: 'Dana Price', consent: { telemetry: false, updateCheck: false }, setupToken: SETUP_TOKEN },
    });
    expect(setup.statusCode, setup.body).toBe(201);
    const login = await server.app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { host: HOST, origin: ORIGIN }, remoteAddress: '203.0.113.7', payload: { email: OWNER, password: PASSWORD } });
    expect(login.statusCode, login.body).toBe(200);
    await recv.until(2);
    expect(byType('super-admin.signed-in').map((event) => event.data)).toEqual([{ ip: '203.0.113.7' }]);
    for (const heard of recv.heard) expect(verifies(heard), heard.body).toBe(true);
  }, 30_000);

  it('the URL without the token stops the boot', () => {
    expect(() => makeEnv({ ADMINIUM_OPERATOR_EVENTS_URL: 'https://control.example.com/events' })).toThrow('ADMINIUM_OPERATOR_TOKEN');
    expect(() => makeEnv({ ADMINIUM_OPERATOR_EVENTS_URL: 'http://203.0.113.5/events', ADMINIUM_OPERATOR_TOKEN: TOKEN })).toThrow('ADMINIUM_OPERATOR_EVENTS_URL');
    // The token with neither the listener nor the URL is of no use: still refused.
    expect(() => makeEnv({ ADMINIUM_OPERATOR_TOKEN: TOKEN })).toThrow('ADMINIUM_OPERATOR_LISTEN');
  });
});
