// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE CALENDAR SYNC, end to end on every engine: a real app installed through
 * the installer, its roles signed in as themselves, and the built-in demo
 * calendar on the other side.
 *
 * The cases are the critique's: a booking moved while its write is on the wire,
 * one handed to another person, `paying` on someone's phone, a read that fails
 * halfway, a busy time that lands after the booking, a replayed notice, a
 * calendar someone deleted, and a name that must leave a staff calendar.
 *
 * The clock is pinned to Tuesday 15 September 2026, 10:40 in Los Angeles.
 */
import { rolesRepo, settingsRepo, usersRepo, type ConnectedAccount, type User } from '@adminium/meta';
import { validateManifest, type Manifest } from '@adminium/manifest';
import type { DemoCalendarBackend } from '@adminium/add-on-contracts';
import { DEMO_CALENDAR_SECRET_HEADER } from '@adminium/add-on-contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import { bindLayout, pagePlanProblems } from '../src/apps/manifest-page-config.js';
import { FIRST_READ_MS, READ_FLOOR_MS, STALE_BUSY_MS, type CalendarSync } from '../src/calendar-sync/service.js';
import { wallTimeToInstant } from '../src/crud/venue-time.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic } from './public-lane.helpers.js';

vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: '0.4.0' }));

const ORIGIN = 'https://studio.example.com';
const ZONE = 'America/Los_Angeles';
const NOW = '2026-09-15 10:40';
const KEY = 'calendar-test';
const at = (day: string, hhmm: string) => wallTimeToInstant(`${day} ${hhmm}`, ZONE)!.getTime();
const iso = (day: string, hhmm: string) => new Date(at(day, hhmm)).toISOString();

const id = { ref: 'id', type: 'int', role: 'pk' };
const hhmm = (ref: string) => ({ ref, type: 'text', maxLength: 5 });
const weekday = { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] };
const stamp = (ref: string) => ({ ref, type: 'timestamptz' });
const fk = (ref: string, references: string, nullable = false) => ({ ref, type: 'fk', references, ...(nullable ? { nullable: true } : {}) });

function appManifest(): Record<string, unknown> {
  const tables = [
    { ref: 'opening_hours', columns: [id, weekday, hhmm('opens'), hhmm('closes')] },
    {
      ref: 'team',
      belongs: [{ column: 'user_id' }],
      indexes: [['user_id']],
      connectedAccounts: { from: [KEY], address: 'email', name: 'name', active: 'active' },
      columns: [
        id,
        { ref: 'name', type: 'text', maxLength: 40 },
        { ref: 'email', type: 'text', maxLength: 254, nullable: true },
        { ref: 'position', type: 'int', default: 1 },
        { ref: 'active', type: 'bool', default: true },
        { ref: 'user_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
      ],
    },
    { ref: 'services', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'minutes', type: 'int' }] },
    { ref: 'team_services', columns: [id, fk('team_id', 'team'), fk('service_id', 'services')] },
    { ref: 'customers', columns: [id, { ref: 'name', type: 'text', maxLength: 60, nullable: true }] },
    { ref: 'calendar_busy', private: true, columns: [id, fk('team_id', 'team'), stamp('starts_at'), stamp('ends_at'), { ref: 'account', type: 'text', maxLength: 40 }] },
    {
      ref: 'bookings',
      belongs: [{ column: 'owner_id' }],
      indexes: [['owner_id']],
      booking: {
        start: 'starts_at',
        minutes: 'minutes',
        resource: 'team_id',
        kind: 'service_id',
        countWhere: { column: 'state', values: ['paying', 'booked', 'arrived', 'done'] },
        eligible: { table: 'team_services', resource: 'team_id', kind: 'service_id', order: { table: 'team', column: 'position' } },
        hours: { practice: { table: 'opening_hours', weekday: 'weekday', opens: 'opens', closes: 'closes' } },
        busy: [{ table: 'calendar_busy', resource: 'team_id', start: 'starts_at', end: 'ends_at', engine: { account: 'account' } }],
        grid: 15,
        windowDays: 30,
        sync: {
          when: { column: 'state', values: ['booked', 'arrived', 'done'] },
          calendarName: 'Lumen Studio',
          title: { service: 'service_id.name', person: 'customer_id.name' },
        },
      },
      columns: [
        id,
        fk('team_id', 'team'),
        fk('service_id', 'services'),
        fk('customer_id', 'customers', true),
        stamp('starts_at'),
        { ref: 'minutes', type: 'int', rules: { copy: { via: 'service_id', from: 'minutes', mode: 'always' } } },
        { ref: 'state', type: 'enum', enum: ['paying', 'booked', 'arrived', 'done', 'cancelled'], default: 'booked' },
        { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
      ],
    },
  ];
  const tableGrants = (verbs: string[]) => ['team', 'bookings', 'services', 'customers'].flatMap((table) => verbs.map((verb) => `table:@${table}:${verb}`));
  return {
    ...invoicingManifest(tables),
    compatibility: { minAdminiumVersion: '0.3.71' },
    addOns: { suggests: [{ key: KEY, range: '>=1.0.0', reason: { 'en-US': 'Calendars.' } }] },
    pages: [{ ref: 'studio-bookings', template: 'page-crud', title: { key: 't', fallback: 'Bookings' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'bookings' } }],
    roles: [
      { key: 'owner', name: 'Owner', permissions: ['app:@:staff', ...tableGrants(['read', 'create', 'update']), 'accounts:@:connect', 'accounts:@:send-link', 'accounts:@:disconnect'] },
      {
        key: 'specialist',
        name: 'Specialist',
        permissions: ['app:@:staff', 'table:@team:read', 'table:@team:update', 'table:@bookings:read', 'table:@bookings:update', 'accounts:@:connect', 'accounts:@:disconnect'],
        limits: { team: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } }, bookings: { rows: { read: { reach: 'own' }, update: { reach: 'own' } } } },
      },
    ],
  };
}

describe('a layout that reads an add-on', () => {
  const page = (addOn: string) => ({
    ref: 'studio-overview',
    template: 'page-dashboard',
    title: { key: 'o', fallback: 'Overview' },
    nav: { group: 'library', icon: 'list', order: 2 },
    config: { layout: { version: 1, items: [{ i: 'a', widget: 'kpi', x: 0, y: 0, w: 3, h: 2, config: { query: { source: { addOn, name: 'reviews' }, shape: 'single-metric' } } }] } },
  });

  it('may name an add-on the app names, and no other', () => {
    const named = { ...appManifest(), pages: [page(KEY)] };
    const read = validateManifest(named) as { ok: boolean; manifest?: Manifest };
    expect(read.ok).toBe(true);
    expect(pagePlanProblems(read.manifest!)).toEqual([]);
    const other = validateManifest({ ...appManifest(), pages: [page('someone-else')] }) as { ok: boolean; manifest?: Manifest };
    expect(pagePlanProblems(other.manifest!).map((problem) => problem.message).join(' ')).toContain('neither requires nor suggests');
  });

  it('leaves the add-on\'s table to be made real when it is read', () => {
    const layout = page(KEY).config.layout;
    const bound = bindLayout(layout, 'con_1', { tables: [], defaultSchema: 'main', dialect: 'sqlite' } as never, {});
    expect('layout' in bound).toBe(true);
    const query = (bound as unknown as { layout: { items: { config: { query: Record<string, unknown> } }[] } }).layout.items[0]!.config.query;
    expect(query['connectionId']).toBe('con_1');
    expect(query['source']).toEqual({ addOn: KEY, name: 'reviews' });
  });
});

describe('the manifest word', () => {
  it('validates, and refuses what cannot work', () => {
    const issues = (doc: Record<string, unknown>) => {
      const read = validateManifest(doc) as { ok: boolean; errors?: { message: string }[]; issues?: { message: string }[] };
      return (read.errors ?? read.issues ?? []).map((issue) => issue.message).join(' | ');
    };
    expect(issues(appManifest())).toBe('');
    const change = (edit: (sync: Record<string, unknown>, booking: Record<string, unknown>, tables: Record<string, unknown>[]) => void) => {
      const doc = appManifest();
      const tables = (doc['requiredSchema'] as { tables: Record<string, unknown>[] }).tables;
      const booking = tables.find((table) => table['ref'] === 'bookings')!['booking'] as Record<string, unknown>;
      edit(booking['sync'] as Record<string, unknown>, booking, tables);
      return issues(doc);
    };
    expect(change((_s, booking) => { delete booking['busy']; })).toContain('a busy source Adminium keeps');
    expect(change((_s, _b, tables) => { delete tables.find((table) => table['ref'] === 'team')!['connectedAccounts']; })).toContain('who may connect');
    expect(change((sync) => { sync['when'] = { column: 'state', values: ['nope'] }; })).toContain('"nope"');
    expect(change((sync) => { sync['title'] = { service: 'service_id.missing' }; })).toContain('no column "missing"');
    expect(change((sync) => { sync['detail'] = { default: 'first-name+initial', max: 'none' }; })).toContain('more of a name');
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`calendar sync on ${dialect}`, () => {
    let h: InvoicingHarness;
    let composed: Awaited<ReturnType<typeof servePublic>>['composed'];
    let sync: CalendarSync;
    let demo: DemoCalendarBackend;
    let bookings: string;
    let team: string;
    const people: Record<string, User> = {};
    const cookies: Record<string, string> = {};
    const teamRow: Record<string, number> = {};
    const custRow: Record<string, number> = {};
    let facial = 0;

    const staff = (who: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
      composed.app.inject({ method, url: `/api/v1${url}`, headers: { cookie: cookies[who]! }, ...(payload === undefined ? {} : { payload }) });

    async function drain(): Promise<void> {
      for (let i = 0; i < 400; i += 1) if ((await composed.jobs.worker.runOnce()) === 0) return;
      throw new Error('The queue did not empty.');
    }

    /** Signs everyone in, for a test that moved the clock past their sessions. */
    let signIns = 0;
    async function signIn(): Promise<void> {
      for (const who of ['admin', 'owner', 'elin', 'rafa']) {
        signIns += 1;
        const login = await composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: people[who]!.email, password: ADMIN_PASSWORD }, remoteAddress: `10.9.${String(Math.floor(signIns / 250))}.${String((signIns % 250) + 1)}` });
        expect(login.statusCode, login.body).toBe(200);
        cookies[who] = sessionCookie(login.headers['set-cookie']);
      }
    }

    /** Runs the planner and the sweep, then every job they queued. */
    async function tick(): Promise<void> {
      await sync.plan();
      await sync.sweep();
      await drain();
    }

    const setClock = (ms: number) => vi.setSystemTime(new Date(ms));
    const advance = (ms: number) => setClock(Date.now() + ms);

    const target = (name: string) => ({ connectionId: h.connectionId, tableName: team, rowKey: String(teamRow[name]!) });
    const accountOf = async (name: string): Promise<ConnectedAccount> => (await accountsRepo().forTarget(target(name)))[0]!;
    const accountsRepo = () => connectedRepo;
    let connectedRepo: { forTarget: (t: ReturnType<typeof target>) => Promise<ConnectedAccount[]> };

    async function connect(name: string): Promise<ConnectedAccount> {
      const account = await sync.attachDemo(target(name));
      expect(account).not.toBeNull();
      return account!;
    }

    /** Connected, with the first read done. */
    async function connected(name: string): Promise<ConnectedAccount> {
      const account = await connect(name);
      await drain();
      return (await accountOf(name)) ?? account;
    }

    async function book(name: string, day: string, time: string, customer = 'ava', state?: string): Promise<number> {
      const reply = await staff('admin', 'POST', `/data/${h.connectionId}/${bookings}`, {
        values: { team_id: teamRow[name], service_id: facial, customer_id: custRow[customer] ?? null, starts_at: iso(day, time), ...(state === undefined ? {} : { state }) },
      });
      expect(reply.statusCode, reply.body).toBe(201);
      const body = reply.json() as { data?: { id: number }; id?: number };
      return Number(body.data?.id ?? body.id);
    }

    const change = async (row: number, values: Record<string, unknown>) => {
      const reply = await staff('admin', 'PATCH', `/data/${h.connectionId}/${bookings}/${String(row)}`, { values });
      expect(reply.statusCode, reply.body).toBe(200);
    };

    const busyRows = async (name: string) => {
      const rows = await h.rows(`SELECT * FROM ${h.real('calendar_busy')} WHERE team_id = ${String(teamRow[name])}`);
      return rows.length;
    };

    const eventsOf = async (name: string) => demo.events((await accountOf(name)).subject);
    const setBusy = async (name: string, spans: [string, string][]) =>
      demo.setBusy(
        (await accountOf(name)).subject,
        'primary',
        spans.map(([start, end]) => ({ allDay: false as const, start, end, kind: 'busy' as const })),
      );
    const freeAt = async (name: string, day: string) => {
      const reply = await staff('admin', 'GET', `/data/${h.connectionId}/${bookings}/booking-slots?kind=${String(facial)}&resource=${String(teamRow[name])}&date=${day}`);
      expect(reply.statusCode, reply.body).toBe(200);
      return (reply.json() as { data: { time: string; state: string }[] }).data.filter((slot) => slot.state === 'free').map((slot) => slot.time);
    };

    beforeAll(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      setClock(at(...(NOW.split(' ') as [string, string])));
      h = await installInvoicing(dialect, appManifest());
      await h.meta.db.updateTable('adminium_connections').set({ timezone: ZONE }).where('id', '=', h.connectionId).execute();
      await settingsRepo(h.meta).set('system.publicOrigin', ORIGIN);
      composed = (await servePublic(h, null, { ADMINIUM_NETWORK_FEATURES: 'true', ADMINIUM_PUBLIC_ORIGIN: '', ADMINIUM_TRUST_PROXY: 'true' })).composed;
      sync = composed.calendarSync;
      demo = sync.demo!;
      const { connectedAccountsRepo } = await import('@adminium/meta');
      connectedRepo = connectedAccountsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET));

      const users = usersRepo(h.meta);
      const roles = rolesRepo(h.meta);
      const hash = await adminPasswordHash();
      const make = async (name: string, role: string) => {
        const user = await users.create({ email: `${name}-${dialect}@studio.dev`, name, passwordHash: hash, status: 'active' });
        people[name] = user;
        await roles.assignToUser(user.id, (await roles.findBySlug(role))!.id);
      };
      await make('admin', 'super-admin');
      await make('owner', 'studio-owner');
      await make('elin', 'studio-specialist');
      await make('rafa', 'studio-specialist');
      await signIn();

      const view = await loadSnapshotView(h.meta, h.connectionId);
      const idOf = (ref: string) => view.model.tables.find((one) => one.name === h.real(ref))!.id;
      bookings = idOf('bookings');
      team = idOf('team');
      const yes = dialect === 'postgres' ? 'TRUE' : '1';
      for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) await h.rows(`INSERT INTO ${h.real('opening_hours')} (weekday, opens, closes) VALUES ('${day}', '08:00', '20:00')`);
      await h.rows(`INSERT INTO ${h.real('services')} (name, minutes) VALUES ('Facial', 60)`);
      facial = Number((await h.rows(`SELECT id FROM ${h.real('services')}`))[0]!['id']);
      for (const [i, name] of ['elin', 'rafa', 'noor', 'ivy', 'june', 'marco', 'tess', 'uma', 'vera', 'wes', 'yara', 'zed', 'kai', 'lena', 'mina', 'owen'].entries()) {
        const user = people[name]?.id;
        await h.rows(`INSERT INTO ${h.real('team')} (name, email, position, active, user_id) VALUES ('${name}', '${name}@studio.dev', ${String(i + 1)}, ${yes}, ${user === undefined ? 'NULL' : `'${user}'`})`);
        teamRow[name] = Number((await h.rows(`SELECT id FROM ${h.real('team')} WHERE name = '${name}'`))[0]!['id']);
        await h.rows(`INSERT INTO ${h.real('team_services')} (team_id, service_id) VALUES (${String(teamRow[name])}, ${String(facial)})`);
      }
      for (const [key, name] of [['ava', 'Ava Reyes'], ['bo', 'Bo Lind'], ['cher', 'Cher']] as const) {
        await h.rows(`INSERT INTO ${h.real('customers')} (name) VALUES ('${name}')`);
        custRow[key] = Number((await h.rows(`SELECT id FROM ${h.real('customers')} WHERE name = '${name}'`))[0]!['id']);
      }
    }, 240_000);

    afterAll(async () => {
      vi.useRealTimers();
      await composed?.app.close();
      await h?.close();
    });

    // ─── The first read ─────────────────────────────────────────────────────

    it('closes a new person\'s slots until the first read, then opens what is free', async () => {
      const account = await connect('uma');
      expect(account.state).toBe('connecting');
      expect(await busyRows('uma')).toBe(1);
      expect(await freeAt('uma', '2026-09-17')).toEqual([]);
      await setBusy('uma', [[iso('2026-09-17', '09:00'), iso('2026-09-17', '11:00')]]);
      await drain();
      expect((await accountOf('uma')).state).toBe('connected');
      expect(await busyRows('uma')).toBe(1);
      const free = await freeAt('uma', '2026-09-17');
      expect(free).toContain('11:00');
      expect(free).not.toContain('10:00');
    });

    it('opens the slots after two minutes if the first read cannot finish, and stays honest about it', async () => {
      const account = await connect('tess');
      demo.failNext(account.subject, 'readBusy', 'UNAVAILABLE');
      await drain();
      expect((await accountOf('tess')).state).toBe('connecting');
      expect(await busyRows('tess')).toBe(1);
      advance(FIRST_READ_MS + 1000);
      demo.failNext(account.subject, 'readBusy', 'UNAVAILABLE');
      await sync.readAccount(account.id);
      expect((await accountOf('tess')).state).toBe('connected');
      expect(await busyRows('tess')).toBe(0);
      expect((await sync.repo.state(account.id))!.lastSyncedAt).toBeNull();
    });

    // ─── Out ────────────────────────────────────────────────────────────────

    it('sends a booking out with a first name and an initial, and nothing else', async () => {
      await connected('elin');
      const row = await book('elin', '2026-09-21', '10:00');
      await drain();
      const events = await eventsOf('elin');
      const event = events.find((one) => one.start === iso('2026-09-21', '10:00'));
      expect(event).toMatchObject({ title: 'Facial — Ava R.', end: iso('2026-09-21', '11:00') });
      expect(demo.ownCalendar((await accountOf('elin')).subject)?.name).toBe('Lumen Studio');
      const mirror = await sync.repo.eventsOfRow({ connectionId: h.connectionId, tableName: bookings, rowKey: String(row) });
      expect(mirror).toHaveLength(1);
      expect(JSON.stringify(mirror)).not.toContain('Ava');
    });

    it('never puts a booking being paid for on someone\'s phone, until it is booked', async () => {
      const row = await book('elin', '2026-09-21', '12:00', 'bo', 'paying');
      await drain();
      expect((await eventsOf('elin')).some((one) => one.start === iso('2026-09-21', '12:00'))).toBe(false);
      await change(row, { state: 'booked' });
      await drain();
      expect((await eventsOf('elin')).find((one) => one.start === iso('2026-09-21', '12:00'))?.title).toBe('Facial — Bo L.');
    });

    it('follows a move, and makes no second event', async () => {
      const row = await book('elin', '2026-09-22', '10:00');
      await drain();
      const before = (await eventsOf('elin')).length;
      await change(row, { starts_at: iso('2026-09-22', '13:00') });
      await drain();
      const events = await eventsOf('elin');
      expect(events).toHaveLength(before);
      expect(events.some((one) => one.start === iso('2026-09-22', '13:00'))).toBe(true);
      expect(events.some((one) => one.start === iso('2026-09-22', '10:00'))).toBe(false);
    });

    it('takes the event out of one person\'s calendar when the booking moves to another', async () => {
      await connected('rafa');
      const row = await book('elin', '2026-09-23', '10:00');
      await drain();
      expect((await eventsOf('elin')).some((one) => one.start === iso('2026-09-23', '10:00'))).toBe(true);
      await change(row, { team_id: teamRow['rafa'] });
      await drain();
      expect((await eventsOf('elin')).some((one) => one.start === iso('2026-09-23', '10:00'))).toBe(false);
      expect((await eventsOf('rafa')).find((one) => one.start === iso('2026-09-23', '10:00'))?.title).toBe('Facial — Ava R.');
    });

    it('takes a cancelled booking out', async () => {
      const row = await book('elin', '2026-09-24', '10:00');
      await drain();
      await change(row, { state: 'cancelled' });
      await drain();
      expect((await eventsOf('elin')).some((one) => one.start === iso('2026-09-24', '10:00'))).toBe(false);
      expect(await sync.repo.eventsOfRow({ connectionId: h.connectionId, tableName: bookings, rowKey: String(row) })).toEqual([]);
    });

    it('a failed write stays marked, and the sweep finishes it', async () => {
      const subject = (await accountOf('elin')).subject;
      demo.failNext(subject, 'upsertEvent', 'UNAVAILABLE');
      const row = await book('elin', '2026-09-25', '10:00');
      await drain();
      expect((await eventsOf('elin')).some((one) => one.start === iso('2026-09-25', '10:00'))).toBe(false);
      const ref = { connectionId: h.connectionId, tableName: bookings, rowKey: String(row) };
      expect(await sync.repo.dirty(ref)).not.toBeNull();
      // The service is out: this account's other calls wait, so an outage cannot fill the queue.
      const calls = demo.callCount(subject, 'upsertEvent');
      expect((await sync.syncRow(ref)).state).toBe('left');
      expect(demo.callCount(subject, 'upsertEvent')).toBe(calls);
      advance(61_000);
      await tick();
      expect((await eventsOf('elin')).some((one) => one.start === iso('2026-09-25', '10:00'))).toBe(true);
      expect(await sync.repo.dirty(ref)).toBeNull();
    });

    it('a retry after a crash finds the event it made, by its key', async () => {
      const row = await book('elin', '2026-09-28', '10:00');
      await drain();
      const ref = { connectionId: h.connectionId, tableName: bookings, rowKey: String(row) };
      const [mirror] = await sync.repo.eventsOfRow(ref);
      const before = (await eventsOf('elin')).length;
      // The answer never reached the mirror.
      await sync.repo.patchEvent(mirror!.id, { remoteId: null, etag: null, appliedHash: null }, Date.now());
      await sync.repo.markDirty(ref, Date.now());
      await sync.syncRow(ref);
      expect((await eventsOf('elin')).length).toBe(before);
    });

    it('holds off for as long as a service asks', async () => {
      const account = await accountOf('elin');
      demo.failNext(account.subject, 'upsertEvent', 'RATE_LIMITED', 90_000);
      const row = await book('elin', '2026-09-29', '10:00');
      await drain();
      const ref = { connectionId: h.connectionId, tableName: bookings, rowKey: String(row) };
      const calls = demo.callCount(account.subject, 'upsertEvent');
      await sync.syncRow(ref);
      expect(demo.callCount(account.subject, 'upsertEvent')).toBe(calls);
      advance(91_000);
      await sync.syncRow(ref);
      expect((await eventsOf('elin')).some((one) => one.start === iso('2026-09-29', '10:00'))).toBe(true);
    });

    // ─── An edit made outside ───────────────────────────────────────────────

    it('puts back an event someone moved or deleted in their own calendar', async () => {
      await book('elin', '2026-09-30', '10:00');
      await drain();
      const account = await accountOf('elin');
      const moved = (await eventsOf('elin')).find((one) => one.start === iso('2026-09-30', '10:00'))!;
      demo.editEvent(account.subject, moved.remoteId, { start: iso('2026-09-30', '15:00'), end: iso('2026-09-30', '16:00') });
      await sync.readAccount(account.id);
      await drain();
      expect((await eventsOf('elin')).find((one) => one.remoteId === moved.remoteId)?.start).toBe(iso('2026-09-30', '10:00'));
      demo.deleteEvent(account.subject, moved.remoteId);
      await sync.readAccount(account.id);
      await drain();
      expect((await eventsOf('elin')).filter((one) => one.start === iso('2026-09-30', '10:00'))).toHaveLength(1);
    });

    it('makes a deleted calendar again once, and stops at the second time in a week', async () => {
      await connected('marco');
      await book('marco', '2026-10-01', '10:00');
      await drain();
      const account = await accountOf('marco');
      demo.deleteOwnCalendar(account.subject);
      await sync.readAccount(account.id);
      await drain();
      expect(await eventsOf('marco')).toHaveLength(1);
      expect((await sync.repo.state(account.id))!.paused).toBeNull();
      demo.deleteOwnCalendar(account.subject);
      await sync.readAccount(account.id);
      await drain();
      const state = (await sync.repo.state(account.id))!;
      expect(state.paused).toBe('calendar-removed');
      expect(await eventsOf('marco')).toHaveLength(0);
      const resumed = await staff('admin', 'POST', '/calendar-sync/row/choices', { connection: h.connectionId, table: team, row: String(teamRow['marco']), resume: true });
      expect(resumed.statusCode, resumed.body).toBe(200);
      await drain();
      expect((await sync.repo.state(account.id))!.paused).toBeNull();
      expect(await eventsOf('marco')).toHaveLength(1);
    });

    // ─── In ─────────────────────────────────────────────────────────────────

    it('a failed read keeps what it had and does not move "last synced"', async () => {
      const account = await accountOf('rafa');
      await setBusy('rafa', [[iso('2026-09-18', '09:00'), iso('2026-09-18', '10:00')]]);
      await sync.readAccount(account.id);
      const before = await busyRows('rafa');
      expect(before).toBe(1);
      const lastSynced = (await sync.repo.state(account.id))!.lastSyncedAt;
      advance(5_000);
      demo.failNext(account.subject, 'readBusy', 'UNAVAILABLE');
      await sync.readAccount(account.id);
      expect(await busyRows('rafa')).toBe(before);
      expect((await sync.repo.state(account.id))!.lastSyncedAt).toBe(lastSynced);
    });

    it('counts all-day times only when ticked, and busy but not tentative', async () => {
      const account = await accountOf('rafa');
      demo.setBusy(account.subject, 'primary', [
        { allDay: true, date: '2026-09-19', endDate: '2026-09-20', kind: 'busy' },
        { allDay: false, start: iso('2026-09-18', '09:00'), end: iso('2026-09-18', '10:00'), kind: 'tentative' },
      ]);
      await sync.readAccount(account.id);
      expect(await busyRows('rafa')).toBe(0);
      await sync.setChoices(account.id, { countAllDay: true });
      await drain();
      expect(await busyRows('rafa')).toBe(1);
      await sync.setChoices(account.id, { countAllDay: false });
      await drain();
      expect(await busyRows('rafa')).toBe(0);
    });

    it('an account whose provider cannot tell all-day counts what it was told, whatever the tick', async () => {
      const account = await accountOf('rafa');
      demo.setTraits(account.subject, { listsCalendars: false, allDayKnown: false, busyPush: false });
      demo.setBusy(account.subject, 'primary', [{ allDay: true, date: '2026-09-19', endDate: '2026-09-20', kind: 'busy' }]);
      await sync.readAccount(account.id);
      expect(await busyRows('rafa')).toBe(1);
      const state = await staff('rafa', 'GET', `/calendar-sync/row?connection=${h.connectionId}&table=${encodeURIComponent(team)}&row=${String(teamRow['rafa'])}`);
      expect(state.statusCode, state.body).toBe(200);
      expect(state.json()).toMatchObject({ calendar: { traits: { allDayKnown: false, listsCalendars: false, busyPush: false }, calendars: null } });
      demo.setTraits(account.subject, { listsCalendars: true, allDayKnown: true, busyPush: true });
      demo.setBusy(account.subject, 'primary', []);
      await sync.readAccount(account.id);
    });

    it('reads the calendars a person chose, and never holds what an event is called', async () => {
      const account = await accountOf('rafa');
      demo.addCalendar(account.subject, { id: 'work', name: 'Work', primary: false, writable: true });
      demo.setBusy(account.subject, 'work', [{ allDay: false, start: iso('2026-09-18', '14:00'), end: iso('2026-09-18', '15:00'), kind: 'busy' }]);
      await sync.readAccount(account.id);
      expect(await busyRows('rafa')).toBe(0);
      const set = await staff('rafa', 'POST', '/calendar-sync/row/choices', { connection: h.connectionId, table: team, row: String(teamRow['rafa']), readCalendars: ['primary', 'work'] });
      expect(set.statusCode, set.body).toBe(200);
      await drain();
      expect(await busyRows('rafa')).toBe(1);
      const blocks = await staff('rafa', 'GET', `/calendar-sync/busy?connection=${h.connectionId}&table=${encodeURIComponent(team)}&row=${String(teamRow['rafa'])}&from=2026-09-18&to=2026-09-19`);
      expect(blocks.statusCode, blocks.body).toBe(200);
      expect((blocks.json() as { busy: Record<string, unknown>[] }).busy).toEqual([{ start: at('2026-09-18', '14:00'), end: at('2026-09-18', '15:00') }]);
      await sync.setChoices(account.id, { readCalendars: null });
      await drain();
    });

    // ─── Clashes ────────────────────────────────────────────────────────────

    it('a busy time that lands on a booking is a clash, told once, and keeping it holds until the overlap changes', async () => {
      const row = await book('rafa', '2026-10-02', '10:00');
      await drain();
      await setBusy('rafa', [[iso('2026-10-02', '09:00'), iso('2026-10-02', '10:30')]]);
      const account = await accountOf('rafa');
      await sync.readAccount(account.id);
      await drain();
      const list = async (who = 'admin') => {
        const reply = await staff(who, 'GET', `/calendar-sync/clashes?connection=${h.connectionId}&table=${encodeURIComponent(bookings)}`);
        expect(reply.statusCode, reply.body).toBe(200);
        return (reply.json() as { clashes: { row: string; overlapStart: number; overlapEnd: number; kept: boolean }[] }).clashes.filter((clash) => clash.row === String(row));
      };
      const [clash] = await list();
      expect(clash).toMatchObject({ overlapStart: at('2026-10-02', '10:00'), overlapEnd: at('2026-10-02', '10:30'), kept: false });
      const told = () => h.meta.db.selectFrom('adminium_notifications').select('id').where('kind', '=', 'calendar.clash').execute();
      const first = (await told()).length;
      expect(first).toBeGreaterThan(0);
      await sync.readAccount(account.id);
      expect((await told()).length).toBe(first);

      // Someone with no reach of that booking cannot see it or keep it.
      expect(await list('elin')).toEqual([]);
      const refused = await staff('elin', 'POST', '/calendar-sync/clashes/keep', { connection: h.connectionId, table: bookings, row: String(row), overlapStart: clash!.overlapStart, overlapEnd: clash!.overlapEnd });
      expect(refused.statusCode).toBe(404);

      const kept = await staff('admin', 'POST', '/calendar-sync/clashes/keep', { connection: h.connectionId, table: bookings, row: String(row), overlapStart: clash!.overlapStart, overlapEnd: clash!.overlapEnd });
      expect(kept.statusCode, kept.body).toBe(200);
      expect((await list())[0]!.kept).toBe(true);

      // A busy time that grows before the booking leaves the overlap as it was.
      await setBusy('rafa', [[iso('2026-10-02', '08:00'), iso('2026-10-02', '10:30')]]);
      await sync.readAccount(account.id);
      expect((await list())[0]!.kept).toBe(true);

      // One that grows into the booking is a new clash, and is told.
      await setBusy('rafa', [[iso('2026-10-02', '08:00'), iso('2026-10-02', '10:45')]]);
      await sync.readAccount(account.id);
      await drain();
      const again = await list();
      expect(again).toHaveLength(1);
      expect(again[0]).toMatchObject({ overlapEnd: at('2026-10-02', '10:45'), kept: false });
      expect((await told()).length).toBeGreaterThan(first);

      // A key that no longer stands cannot be kept.
      const stale = await staff('admin', 'POST', '/calendar-sync/clashes/keep', { connection: h.connectionId, table: bookings, row: String(row), overlapStart: clash!.overlapStart, overlapEnd: clash!.overlapEnd });
      expect(stale.statusCode).toBe(404);
      await setBusy('rafa', []);
      await sync.readAccount(account.id);
      expect(await list()).toEqual([]);
    });

    it('a calendar that echoes a person\'s own bookings raises no clash', async () => {
      const row = await book('rafa', '2026-10-05', '10:00');
      await drain();
      await setBusy('rafa', [[iso('2026-10-05', '10:00'), iso('2026-10-05', '11:00')]]);
      const account = await accountOf('rafa');
      await sync.readAccount(account.id);
      const found = await sync.clashes(h.connectionId, bookings);
      expect(found!.filter((clash) => clash.rowKey === String(row))).toEqual([]);
      await setBusy('rafa', []);
      await sync.readAccount(account.id);
    });

    // ─── Push ───────────────────────────────────────────────────────────────

    const hook = (key: string, channel: string, headers: Record<string, string>, query = '') =>
      composed.app.inject({ method: 'POST', url: `/api/v1/calendars/hook/${key}/${channel}${query}`, headers: { 'content-type': 'application/json', ...headers }, payload: '{}', remoteAddress: '203.0.113.9' });

    it('opens channels at its public address, and answers only for what it knows', async () => {
      const account = await accountOf('elin');
      advance(READ_FLOOR_MS);
      await sync.readAccount(account.id);
      const channels = demo.channels(account.subject);
      expect(channels.map((one) => one.target).sort()).toEqual(['busy', 'own']);
      for (const channel of channels) expect(channel.address.startsWith(`${ORIGIN}/api/v1/calendars/hook/demo/`)).toBe(true);
      const channelId = channels[0]!.channelId;
      expect((await hook('demo', 'chn_unknown', { [DEMO_CALENDAR_SECRET_HEADER]: 'x' })).statusCode).toBe(404);
      expect((await hook('other', channelId, { [DEMO_CALENDAR_SECRET_HEADER]: 'x' })).statusCode).toBe(404);
      expect((await hook('demo', channelId, { [DEMO_CALENDAR_SECRET_HEADER]: 'wrong' })).statusCode).toBe(403);
      // A handshake is echoed only while a channel is being made.
      expect((await hook('demo', channelId, {}, '?validationToken=abc')).statusCode).toBe(404);
    });

    it('echoes a handshake as plain text while its channel is being made, and refuses markup', async () => {
      const account = await accountOf('elin');
      await sync.repo.putChannel({ id: 'chn_handshake', accountId: account.id, provider: 'demo', target: 'own', state: 'creating', secret: 's3cret-handshake', remoteChannelId: null, resourceId: null, address: `${ORIGIN}/x`, expiresAt: Date.now() + 60_000 }, Date.now());
      const reply = await hook('demo', 'chn_handshake', {}, '?validationToken=abc123');
      expect(reply.statusCode).toBe(200);
      expect(reply.body).toBe('abc123');
      expect(reply.headers['content-type']).toContain('text/plain');
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
      const script = await hook('demo', 'chn_handshake', {}, `?validationToken=${encodeURIComponent('<script>alert(1)</script> x')}`);
      expect(script.statusCode).toBe(400);
      await sync.repo.removeChannel('chn_handshake');
    });

    it('a replayed notice costs one read', async () => {
      const account = await accountOf('elin');
      const channel = demo.channels(account.subject)[0]!;
      const secret = demo.delivery(account.subject, channel.channelId).headers[DEMO_CALENDAR_SECRET_HEADER]!;
      await drain();
      advance(READ_FLOOR_MS + 1);
      const reads = demo.callCount(account.subject, 'readBusy');
      for (let i = 0; i < 25; i += 1) expect((await hook('demo', channel.channelId, { [DEMO_CALENDAR_SECRET_HEADER]: secret })).statusCode).toBe(202);
      await drain();
      expect(demo.callCount(account.subject, 'readBusy')).toBe(reads + 1);
    });

    it('a busy time pushed in blocks the slot at the next read', async () => {
      const account = await accountOf('elin');
      const channel = demo.channels(account.subject).find((one) => one.target === 'busy')!;
      const secret = demo.delivery(account.subject, channel.channelId).headers[DEMO_CALENDAR_SECRET_HEADER]!;
      await setBusy('elin', [[iso('2026-10-06', '09:00'), iso('2026-10-06', '12:00')]]);
      advance(READ_FLOOR_MS + 1);
      await hook('demo', channel.channelId, { [DEMO_CALENDAR_SECRET_HEADER]: secret });
      await drain();
      const free = await freeAt('elin', '2026-10-06');
      expect(free).toContain('12:00');
      expect(free).not.toContain('10:00');
      await setBusy('elin', []);
      await sync.readAccount(account.id);
    });

    it('never stores a channel secret in the clear', async () => {
      const rows = await h.meta.db.selectFrom('adminium_calendar_channels').select('secretSealed').execute();
      expect(rows.length).toBeGreaterThan(0);
      const account = await accountOf('elin');
      const channel = demo.channels(account.subject)[0]!;
      const secret = demo.delivery(account.subject, channel.channelId).headers[DEMO_CALENDAR_SECRET_HEADER]!;
      for (const row of rows) expect(row.secretSealed).not.toContain(secret);
    });

    it('renews a channel near its end', async () => {
      const account = await accountOf('elin');
      const before = demo.channels(account.subject)[0]!.expiresAt;
      advance(6 * 86_400_000);
      await sync.sweep();
      expect(demo.channels(account.subject)[0]!.expiresAt).toBeGreaterThan(before);
      await signIn();
    });

    it('where a service cannot renew in place, opens the new channel before it stops the old', async () => {
      const account = await accountOf('elin');
      const before = demo.channels(account.subject).map((one) => one.channelId).sort();
      for (const id of before) await sync.repo.patchChannel(id, { expiresAt: Date.now() + 1000 });
      for (let i = 0; i < before.length; i += 1) demo.failNext(account.subject, 'renew', 'INVALID_REQUEST');
      await sync.sweep();
      const after = demo.channels(account.subject).map((one) => one.channelId).sort();
      expect(after).toHaveLength(before.length);
      for (const id of before) expect(after).not.toContain(id);
    });

    it('a service saying a channel ended, or needs renewing, is taken at its word', async () => {
      const account = await accountOf('elin');
      const held = await sync.repo.channelsOf(account.id);
      const secret = held[0]!.secret;
      const notice = (kind: 'reauthorize' | 'removed') => sync.receiveHook({ provider: 'demo', channelId: held[0]!.id, delivery: { headers: { [DEMO_CALENDAR_SECRET_HEADER]: secret, 'x-demo-kind': kind }, query: {}, rawBody: '' } });
      expect((await notice('reauthorize')).status).toBe(202);
      expect((await sync.repo.channel(held[0]!.id))!.expiresAt).toBeLessThanOrEqual(Date.now());
      expect((await notice('removed')).status).toBe(202);
      expect(await sync.repo.channel(held[0]!.id)).toBeNull();
      advance(READ_FLOOR_MS + 1);
      await sync.readAccount(account.id);
      expect((await sync.repo.channelsOf(account.id)).map((one) => one.target).sort()).toEqual(['busy', 'own']);
    });

    // ─── Names ──────────────────────────────────────────────────────────────

    it('the morning after a visit, its title is the service alone', async () => {
      const row = await book('june', '2026-09-30', '10:00', 'cher');
      void row;
      await connected('june');
      await tick();
      expect((await eventsOf('june')).find((one) => one.start === iso('2026-09-30', '10:00'))?.title).toBe('Facial — Cher');
      setClock(at('2026-10-01', '05:00'));
      await signIn();
      await sync.daily();
      await drain();
      expect((await eventsOf('june')).find((one) => one.start === iso('2026-09-30', '10:00'))?.title).toBe('Facial');
    });

    it('a person who is forgotten leaves every staff calendar, past visits too', async () => {
      const row = await book('june', '2026-10-08', '10:00', 'bo');
      await drain();
      expect((await eventsOf('june')).find((one) => one.start === iso('2026-10-08', '10:00'))?.title).toBe('Facial — Bo L.');
      const customers = (await loadSnapshotView(h.meta, h.connectionId)).model.tables.find((one) => one.name === h.real('customers'))!.id;
      const forgot = await staff('admin', 'PATCH', `/data/${h.connectionId}/${customers}/${String(custRow['bo'])}`, { values: { name: null } });
      expect(forgot.statusCode, forgot.body).toBe(200);
      await drain();
      expect((await eventsOf('june')).find((one) => one.start === iso('2026-10-08', '10:00'))?.title).toBe('Facial');
      void row;
    });

    it('an erasure, which announces nothing, reaches the events too', async () => {
      await book('june', '2026-10-09', '10:00', 'ava');
      await drain();
      expect((await eventsOf('june')).find((one) => one.start === iso('2026-10-09', '10:00'))?.title).toBe('Facial — Ava R.');
      await h.rows(`UPDATE ${h.real('customers')} SET name = NULL WHERE id = ${String(custRow['ava'])}`);
      const customers = (await loadSnapshotView(h.meta, h.connectionId)).model.tables.find((one) => one.name === h.real('customers'))!.id;
      const told = await sync.onErased({ address: '', rows: [{ connectionId: h.connectionId, table: customers, key: String(custRow['ava']) }] });
      expect(told.events).toBeGreaterThan(0);
      await drain();
      expect((await eventsOf('june')).find((one) => one.start === iso('2026-10-09', '10:00'))?.title).toBe('Facial');
    });

    it('a rule\'s or person\'s "no names" is written to the events', async () => {
      const account = await accountOf('june');
      await h.rows(`UPDATE ${h.real('customers')} SET name = 'Cher' WHERE id = ${String(custRow['cher'])}`);
      await book('june', '2026-10-12', '10:00', 'cher');
      await drain();
      expect((await eventsOf('june')).find((one) => one.start === iso('2026-10-12', '10:00'))?.title).toBe('Facial — Cher');
      await sync.setChoices(account.id, { detail: 'none' });
      await drain();
      expect((await eventsOf('june')).find((one) => one.start === iso('2026-10-12', '10:00'))?.title).toBe('Facial');
      expect((await sync.repo.state(account.id))!.detail).toBe('none');
    });

    // ─── While someone must reconnect, and at the end ───────────────────────

    it('while someone must reconnect, their last busy times block for seven days, dated, then go', async () => {
      await connected('noor');
      await setBusy('noor', [[iso('2026-10-14', '09:00'), iso('2026-10-14', '12:00')]]);
      const account = await accountOf('noor');
      await sync.readAccount(account.id);
      const synced = (await sync.repo.state(account.id))!.lastSyncedAt!;
      await connectedRepoSetState(account.id, 'reconnect');
      await sync.readAccount(account.id);
      expect(await busyRows('noor')).toBe(1);
      const seen = await staff('admin', 'GET', `/calendar-sync/row?connection=${h.connectionId}&table=${encodeURIComponent(team)}&row=${String(teamRow['noor'])}`);
      expect(seen.json()).toMatchObject({ calendar: { state: 'reconnect', busyAsOf: synced, busyDropped: false } });
      setClock(synced + STALE_BUSY_MS - 1000);
      await sync.readAccount(account.id);
      expect(await busyRows('noor')).toBe(1);
      setClock(synced + STALE_BUSY_MS + 1000);
      await signIn();
      await sync.readAccount(account.id);
      expect(await busyRows('noor')).toBe(0);
      const told = await h.meta.db.selectFrom('adminium_notifications').select('id').where('kind', '=', 'calendar.stale-dropped').execute();
      expect(told.length).toBeGreaterThan(0);
      const after = await staff('admin', 'GET', `/calendar-sync/row?connection=${h.connectionId}&table=${encodeURIComponent(team)}&row=${String(teamRow['noor'])}`);
      expect(after.json()).toMatchObject({ calendar: { busyAsOf: null, busyDropped: true } });
    });

    const connectedRepoSetState = async (accountId: string, state: 'reconnect') => {
      const { connectedAccountsRepo } = await import('@adminium/meta');
      await connectedAccountsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET)).setState(accountId, state, Date.now());
    };

    it('a disconnect stops the channels, takes the coming events out, and drops the busy times', async () => {
      const account = await accountOf('rafa');
      await book('rafa', '2026-10-15', '13:00');
      await drain();
      await setBusy('rafa', [[iso('2026-10-15', '09:00'), iso('2026-10-15', '12:00')]]);
      advance(READ_FLOOR_MS + 1);
      await sync.readAccount(account.id);
      expect(demo.channels(account.subject).length).toBeGreaterThan(0);
      const coming = (await eventsOf('rafa')).filter((one) => Date.parse(one.end) >= Date.now());
      expect(coming.length).toBeGreaterThan(0);
      expect(await busyRows('rafa')).toBeGreaterThan(0);
      const ended = await composedEnd(account.id);
      expect(ended?.incomplete).toBe(false);
      expect(demo.channels(account.subject)).toEqual([]);
      expect((await demo.events(account.subject)).filter((one) => Date.parse(one.end) >= Date.now())).toEqual([]);
      expect(await busyRows('rafa')).toBe(0);
      expect(await sync.repo.state(account.id)).toBeNull();
      expect(await sync.repo.eventsOfAccount(account.id, null, 10)).toEqual([]);
    });

    const composedEnd = async (accountId: string) => {
      const found = await (await import('@adminium/meta')).connectedAccountsRepo(h.meta, addOnCredentialCryptoFromSecret(TEST_SECRET)).find(accountId);
      if (found === null) return { removed: 0, incomplete: false, revoked: null };
      return sync.accountsForTest.end(accountId);
    };

    it('says so when a calendar could not be reached at the end, and still lets go', async () => {
      const account = await connected('ivy');
      await book('ivy', '2026-10-16', '10:00');
      await drain();
      demo.failNext(account.subject, 'deleteEvent', 'UNAVAILABLE');
      const ended = await sync.accountsForTest.end(account.id);
      expect(ended?.incomplete).toBe(true);
      expect(await busyRows('ivy')).toBe(0);
      expect((await accountsRepo().forTarget(target('ivy')))).toEqual([]);
    });

    it('ends a connection at once when its person\'s row is switched off', async () => {
      const account = await connected('tess');
      const off = await staff('admin', 'PATCH', `/data/${h.connectionId}/${team}/${String(teamRow['tess'])}`, { values: { active: false } });
      expect(off.statusCode, off.body).toBe(200);
      await drain();
      expect((await accountsRepo().forTarget(target('tess')))).toEqual([]);
      expect(await busyRows('tess')).toBe(0);
      expect(account.id).toBeDefined();
    });

    // ─── What the review found ──────────────────────────────────────────────

    /** Runs `during` while this account's busy read is out. */
    async function whileReading(accountId: string, during: () => Promise<void>): Promise<void> {
      const real = demo.providerFor;
      demo.providerFor = (subject) => {
        const inner = real(subject);
        return {
          ...inner,
          traits: inner.traits,
          readBusy: async (input) => {
            const answer = await inner.readBusy(input);
            await during();
            return answer;
          },
        };
      };
      try {
        await sync.readAccount(accountId);
      } finally {
        demo.providerFor = real;
      }
    }

    it('a read that was out when the person disconnected leaves no busy time behind', async () => {
      const account = await connected('vera');
      await setBusy('vera', [[iso('2026-10-20', '09:00'), iso('2026-10-20', '10:00')]]);
      await whileReading(account.id, async () => {
        await sync.accountsForTest.end(account.id);
      });
      expect(await busyRows('vera')).toBe(0);
    });

    it('a first read refused for a day still opens the slots after two minutes', async () => {
      const account = await connect('wes');
      demo.failNext(account.subject, 'readBusy', 'RATE_LIMITED', 86_400_000);
      await drain();
      expect(await busyRows('wes')).toBe(1);
      advance(FIRST_READ_MS + 1000);
      await sync.plan();
      expect(await busyRows('wes')).toBe(0);
      expect((await accountOf('wes')).state).toBe('connected');
    });

    it('a grant lost during the first read neither keeps the slots closed nor counts as a clash', async () => {
      const account = await connect('yara');
      demo.failNext(account.subject, 'readBusy', 'UNAVAILABLE');
      await book('yara', '2026-10-21', '10:00').catch(() => 0);
      await drain();
      await connectedRepoSetState(account.id, 'reconnect');
      const during = await sync.clashes(h.connectionId, bookings);
      expect(during!.filter((clash) => clash.resource === String(teamRow['yara']))).toEqual([]);
      advance(FIRST_READ_MS + 1000);
      await sync.plan();
      expect(await busyRows('yara')).toBe(0);
      expect((await accountOf('yara')).state).toBe('reconnect');
      await sync.accountsForTest.end(account.id);
    });

    it('a disconnect takes a past event that still carries a name out of the calendar', async () => {
      const account = await connected('zed');
      await book('zed', '2026-10-21', '10:00', 'cher');
      await drain();
      expect((await demo.events(account.subject)).map((one) => one.title)).toEqual(['Facial — Cher']);
      const back = Date.now();
      setClock(at('2026-10-21', '20:00'));
      const ended = await sync.accountsForTest.end(account.id);
      setClock(back);
      expect(ended?.incomplete).toBe(false);
      expect(demo.events(account.subject)).toEqual([]);
    });

    it('a notice that lands during a read asks for another', async () => {
      const account = await accountOf('elin');
      const channel = (await sync.repo.channelsOf(account.id))[0]!;
      advance(READ_FLOOR_MS + 1);
      await whileReading(account.id, async () => {
        advance(1000);
        const told = await sync.receiveHook({ provider: 'demo', channelId: channel.id, delivery: { headers: { [DEMO_CALENDAR_SECRET_HEADER]: channel.secret }, query: {}, rawBody: '' } });
        expect(told.status).toBe(202);
      });
      expect((await sync.repo.state(account.id))!.nextPollAt).toBeLessThanOrEqual(Date.now() + READ_FLOOR_MS);
      advance(READ_FLOOR_MS + 1);
      await drain();
    });

    it('a meeting that covers a whole booking is a clash, and the person\'s own event coming back is not', async () => {
      const account = await connected('kai');
      const row = await book('kai', '2026-10-22', '10:00');
      await drain();
      await setBusy('kai', [[iso('2026-10-22', '10:00'), iso('2026-10-22', '11:00')]]);
      await sync.readAccount(account.id);
      expect((await sync.clashes(h.connectionId, bookings))!.filter((clash) => clash.rowKey === String(row))).toEqual([]);
      expect(await busyRows('kai')).toBe(0);
      await setBusy('kai', [[iso('2026-10-22', '09:00'), iso('2026-10-22', '12:00')]]);
      await sync.readAccount(account.id);
      expect((await sync.clashes(h.connectionId, bookings))!.filter((clash) => clash.rowKey === String(row))).toMatchObject([{ overlapStart: at('2026-10-22', '10:00'), overlapEnd: at('2026-10-22', '11:00') }]);
      await setBusy('kai', []);
      await sync.readAccount(account.id);
    });

    it('turning a deleted calendar back on writes its events again', async () => {
      const account = await connected('lena');
      await book('lena', '2026-10-23', '10:00');
      await drain();
      demo.deleteOwnCalendar(account.subject);
      await sync.readAccount(account.id);
      await drain();
      await sync.readAccount(account.id);
      expect(demo.events(account.subject)).toHaveLength(1);
      demo.deleteOwnCalendar(account.subject);
      await sync.readAccount(account.id);
      await drain();
      expect((await sync.repo.state(account.id))!.paused).toBe('calendar-removed');
      await sync.setChoices(account.id, { resume: true });
      await drain();
      expect(demo.events(account.subject)).toHaveLength(1);
    });

    it('two jobs that find the calendar gone remake it once, and leave one event each', async () => {
      const account = await connected('mina');
      const first = await book('mina', '2026-10-26', '10:00');
      const second = await book('mina', '2026-10-26', '13:00');
      await drain();
      demo.deleteOwnCalendar(account.subject);
      await change(first, { starts_at: iso('2026-10-27', '10:00') });
      await change(second, { starts_at: iso('2026-10-27', '13:00') });
      await Promise.all([first, second].map((row) => sync.syncRow({ connectionId: h.connectionId, tableName: bookings, rowKey: String(row) })));
      await tick();
      const starts = demo.events(account.subject).map((one) => one.start).sort();
      expect(starts).toEqual([iso('2026-10-27', '10:00'), iso('2026-10-27', '13:00')]);
      expect((await sync.repo.state(account.id))!.calendarLostCount).toBe(1);
    });

    it('a hold the service asked for during a read stands', async () => {
      const account = await accountOf('mina');
      demo.failNext(account.subject, 'listOwnEvents', 'RATE_LIMITED', 90_000);
      await sync.readAccount(account.id);
      expect((await sync.repo.state(account.id))!.holdUntil).toBeGreaterThan(Date.now());
      advance(91_000);
    });

    it('reads only a calendar this account lists', async () => {
      const refused = await staff('admin', 'POST', '/calendar-sync/row/choices', { connection: h.connectionId, table: team, row: String(teamRow['mina']), readCalendars: ['a-colleagues-calendar'] });
      expect(refused.statusCode).toBe(422);
      expect(refused.body).toContain('UNKNOWN_CALENDAR');
      expect((await sync.repo.state((await accountOf('mina')).id))!.readCalendars).toBeNull();
    });

    it('lets go of busy times that are over', async () => {
      const account = await connected('owen');
      await setBusy('owen', [[iso('2026-10-28', '09:00'), iso('2026-10-28', '10:00')]]);
      await sync.readAccount(account.id);
      expect(await busyRows('owen')).toBe(1);
      const back = Date.now();
      setClock(at('2026-10-30', '09:00'));
      await setBusy('owen', []);
      await sync.readAccount(account.id);
      setClock(back);
      expect(await busyRows('owen')).toBe(0);
    });

    it('drops the busy times of an account that no longer exists, and leaves a sample\'s alone', async () => {
      const busy = h.real('calendar_busy');
      for (const name of ['cac_00000000000000000000000000', 'sample-elin']) {
        await h.rows(`INSERT INTO ${busy} (team_id, starts_at, ends_at, account) VALUES (${String(teamRow['owen'])}, '2026-10-29 09:00:00', '2026-10-29 10:00:00', '${name}')`);
      }
      await sync.daily();
      const left = await h.rows(`SELECT account FROM ${busy} WHERE team_id = ${String(teamRow['owen'])}`);
      expect(left.map((row) => row['account'])).toEqual(['sample-elin']);
      await h.rows(`DELETE FROM ${busy} WHERE account = 'sample-elin'`);
    });

    // ─── The Overview ───────────────────────────────────────────────────────

    const card = (descriptor: Record<string, unknown>, who = 'admin') =>
      staff(who, 'POST', '/widget-data/query', { descriptor: { connectionId: h.connectionId, ...descriptor } });

    it('counts the connections for the Overview, whole or not at all', async () => {
      const name = h.real('team');
      const counts = await card({ kind: 'calendar-connections', source: { name }, shape: 'categorical' });
      expect(counts.statusCode, counts.body).toBe(200);
      const held = (counts.json() as { result: { items: { key: string; value: number }[]; total: number } }).result;
      const by = Object.fromEntries(held.items.map((item) => [item.key, item.value]));
      expect(by['reconnect']).toBe(1);
      expect(by['connected']).toBeGreaterThan(0);
      expect(held.total).toBe(15);
      const figure = await card({ kind: 'calendar-connections', source: { name }, shape: 'single-metric' });
      expect((figure.json() as { result: { value: number } }).result.value).toBe(by['connected']);
      // Held to their own row, a specialist is told no count of the people they happen to reach.
      const limited = await card({ kind: 'calendar-connections', source: { name }, shape: 'categorical' }, 'elin');
      expect(limited.statusCode).toBe(403);
      expect(limited.body).toContain('TEAM_FIGURE_WHOLE_ONLY');
    });

    it('a layout reads a table by the add-on that holds it, under the reader\'s grants', async () => {
      const held = await card({ source: { addOn: 'studio', name: 'services' }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'value' }] });
      expect(held.statusCode, held.body).toBe(200);
      const absent = await card({ source: { addOn: 'forms-surveys', name: 'reviews' }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'value' }] });
      expect(absent.statusCode).toBe(404);
      expect(absent.body).toContain('ADD_ON_NOT_HERE');
      const refused = await card({ source: { addOn: 'studio', name: 'services' }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'value' }] }, 'elin');
      expect(refused.statusCode).toBe(403);
    });

    // ─── Doors ──────────────────────────────────────────────────────────────

    it('a person reads and changes only their own calendar', async () => {
      const row = (name: string) => `connection=${h.connectionId}&table=${encodeURIComponent(team)}&row=${String(teamRow[name])}`;
      expect((await staff('elin', 'GET', `/calendar-sync/row?${row('elin')}`)).statusCode).toBe(200);
      expect((await staff('elin', 'GET', `/calendar-sync/row?${row('june')}`)).statusCode).toBe(404);
      expect((await staff('elin', 'GET', `/calendar-sync/busy?${row('june')}&from=2026-10-20&to=2026-10-21`)).statusCode).toBe(404);
      expect((await staff('elin', 'POST', '/calendar-sync/row/sync-now', { connection: h.connectionId, table: team, row: String(teamRow['june']) })).statusCode).toBe(404);
      expect((await staff('elin', 'POST', '/calendar-sync/row/sync-now', { connection: h.connectionId, table: team, row: String(teamRow['elin']) })).statusCode).toBe(200);
    });

    it('the busy table stays closed to every write and read but the sync\'s', async () => {
      const view = await loadSnapshotView(h.meta, h.connectionId);
      const busy = view.model.tables.find((one) => one.name === h.real('calendar_busy'))!.id;
      expect((await staff('owner', 'GET', `/data/${h.connectionId}/${busy}`)).statusCode).toBeGreaterThanOrEqual(403);
      const write = await staff('admin', 'POST', `/data/${h.connectionId}/${busy}`, { values: { team_id: teamRow['elin'], starts_at: iso('2026-10-20', '09:00'), ends_at: iso('2026-10-20', '10:00'), account: 'x' } });
      expect(write.statusCode).toBeGreaterThanOrEqual(400);
    });

  });
}
