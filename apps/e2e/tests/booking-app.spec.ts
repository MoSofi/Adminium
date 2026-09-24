// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A booking app, installed and used over the wire on the built server — the
 * release check for what a clinic-shaped app asks of the engine: a booking
 * rule, stamps, a capped balance, a person's own rows behind a found session
 * and an emailed code, a proof of work before every claim, the app's own
 * emails, and a kiosk key that opens nothing alone.
 *
 * ── WHY OVER THE WIRE ──────────────────────────────────────────────────────
 * Every piece has its own three-engine suite in `apps/server/test`. What only
 * this proves is that they hold together through the built server: the
 * install's check, the public gate in front of them, the job worker that
 * sends the mail, and the SMTP sink that receives it. The desk's screens are
 * the app's own and live with the app.
 *
 * ── ITS OWN TABLES ─────────────────────────────────────────────────────────
 * The app creates `e2e_clinic_*` tables on the seeded connection and the last
 * step uninstalls it with its tables, so the dataset every other spec shares
 * is left as it was — `afterAll` does the same after a failure.
 */
import { createHash } from 'node:crypto';

import { expect, test, type APIRequestContext, type APIResponse, type PlaywrightWorkerArgs } from '@playwright/test';

import { bundleOf } from './appBundle.js';
import { BASE_URL, SINK_URL, type SinkMessage } from './constants.js';
import { seededConnectionId, useOwnPrincipal } from './helpers.js';

test.describe.configure({ mode: 'serial' });
useOwnPrincipal('booking');

const KEY = 'e2e-clinic';
const VERSION = '1.0.0';
const ZONE = 'Europe/London';
const ADA = { mobile: '07700900101', born_on: '1980-01-01', email: 'ada@hill.dev' };
const BEN = { mobile: '07700900102', born_on: '1981-02-02', email: 'ben@hill.dev' };

type Playwright = PlaywrightWorkerArgs['playwright'];
type Row = Record<string, unknown>;

// ── the app ───────────────────────────────────────────────────────────────

const id = { ref: 'id', type: 'int', role: 'pk' };
const hhmm = (ref: string, nullable = false) => ({ ref, type: 'text', maxLength: 5, ...(nullable ? { nullable: true } : {}) });
const weekday = { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] };
const setting = (column: string) => ({ table: 'settings', column });
const template = (key: string, subject: string) => ({
  key,
  name: subject,
  locales: {
    'en-US': {
      subject,
      blocks: [{ block: 'email.text', data: { text: 'Hi {{recipient.first_name}}: {{visit.starts_at.relative_day}} at {{visit.starts_at.time}} with {{clinician.name}}.' } }],
    },
  },
});

const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: KEY,
  name: 'E2E Clinic',
  version: VERSION,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A booking app.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  pages: [
    {
      ref: 'e2e-clinic-visits',
      template: 'page-crud',
      title: { key: 't', fallback: 'Visits' },
      nav: { group: 'library', icon: 'list', order: 1 },
      bindings: { rows: 'visits' },
    },
  ],
  frontends: [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ],
  roles: [{ key: 'kiosk', name: 'Kiosk', screensOnly: true, permissions: ['app:@:staff'] }],
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'settings',
        columns: [
          id,
          { ref: 'practice_name', type: 'text', maxLength: 80, nullable: true },
          { ref: 'slot_minutes', type: 'int', default: 15 },
          { ref: 'booking_days', type: 'int', default: 14 },
          { ref: 'notice_minutes', type: 'int', default: 0 },
          { ref: 'cancel_hours', type: 'int', default: 48 },
          { ref: 'lead_default', type: 'int', default: 24 },
          { ref: 'emails_on', type: 'bool', default: true },
          { ref: 'kiosk_on', type: 'bool', default: true },
        ],
      },
      { ref: 'opening_hours', columns: [id, weekday, { ref: 'open', type: 'bool', default: true }, hhmm('opens'), hhmm('closes'), hhmm('break_start', true), hhmm('break_end', true)] },
      { ref: 'clinicians', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'position', type: 'int', default: 0 }, { ref: 'active', type: 'bool', default: true }, { ref: 'bookable_online', type: 'bool', default: true }] },
      { ref: 'visit_types', columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'minutes', type: 'int', default: 15 }, { ref: 'fee', type: 'money', default: 0 }] },
      { ref: 'clinician_visit_types', columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians' }, { ref: 'visit_type_id', type: 'fk', references: 'visit_types' }] },
      { ref: 'clinician_hours', columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians' }, weekday, hhmm('opens'), hhmm('closes')] },
      {
        ref: 'closures',
        columns: [id, { ref: 'clinician_id', type: 'fk', references: 'clinicians', nullable: true }, { ref: 'from_date', type: 'date' }, { ref: 'to_date', type: 'date' }, { ref: 'active', type: 'bool', default: true }],
      },
      {
        ref: 'patients',
        columns: [
          id,
          { ref: 'name', type: 'text', maxLength: 40 },
          { ref: 'mobile', type: 'text', maxLength: 20 },
          { ref: 'born_on', type: 'date' },
          { ref: 'email', type: 'text', maxLength: 80, nullable: true },
          { ref: 'remind', type: 'bool', default: true },
          { ref: 'lead_hours', type: 'int', nullable: true },
        ],
      },
      {
        ref: 'visits',
        booking: {
          start: 'starts_at',
          minutes: 'minutes',
          resource: 'clinician_id',
          kind: 'visit_type_id',
          countWhere: { column: 'status', values: ['booked', 'checked_in', 'seen'] },
          eligible: {
            table: 'clinician_visit_types',
            resource: 'clinician_id',
            kind: 'visit_type_id',
            order: { table: 'clinicians', column: 'position', active: 'active', public: 'bookable_online' },
          },
          hours: {
            practice: { table: 'opening_hours', weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes', breakStart: 'break_start', breakEnd: 'break_end' },
            own: { table: 'clinician_hours', resource: 'clinician_id', weekday: 'weekday', opens: 'opens', closes: 'closes' },
          },
          closures: { table: 'closures', from: 'from_date', to: 'to_date', resource: 'clinician_id', active: 'active' },
          grid: setting('slot_minutes'),
          windowDays: setting('booking_days'),
          noticeMinutes: setting('notice_minutes'),
          cancel: { hours: setting('cancel_hours'), mode: 'flag', flag: 'late_cancel', when: { column: 'status', to: 'cancelled' } },
        },
        columns: [
          id,
          { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true },
          { ref: 'clinician_id', type: 'fk', references: 'clinicians', nullable: true },
          { ref: 'visit_type_id', type: 'fk', references: 'visit_types' },
          { ref: 'starts_at', type: 'timestamptz', rules: { venueLocal: true } },
          { ref: 'minutes', type: 'int', default: 15, rules: { copy: { via: 'visit_type_id', from: 'minutes', mode: 'always' } } },
          { ref: 'status', type: 'enum', enum: ['booked', 'checked_in', 'seen', 'no_show', 'cancelled'], default: 'booked' },
          { ref: 'late_cancel', type: 'bool', default: false },
          { ref: 'checked_in_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'status', values: ['checked_in'] } } } },
          { ref: 'fee', type: 'money', nullable: true, rules: { copy: { via: 'visit_type_id', from: 'fee' } } },
          {
            ref: 'paid',
            type: 'money',
            nullable: true,
            rules: { rollup: { from: 'payments', via: 'visit_id', sum: 'amount', where: { column: 'voided', eq: false }, balance: { column: 'balance', of: 'fee' }, cap: true } },
          },
          { ref: 'balance', type: 'money', nullable: true },
        ],
      },
      { ref: 'payments', columns: [id, { ref: 'visit_id', type: 'fk', references: 'visits' }, { ref: 'amount', type: 'money' }, { ref: 'voided', type: 'bool', default: false }] },
      {
        ref: 'messages',
        columns: [
          id,
          { ref: 'kind', type: 'enum', enum: ['confirmation', 'reminder'] },
          { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
          { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
          { ref: 'patient_id', type: 'fk', references: 'patients', nullable: true },
          { ref: 'visit_id', type: 'fk', references: 'visits', nullable: true },
          { ref: 'due_at', type: 'timestamptz', nullable: true },
          { ref: 'sent_at', type: 'timestamptz', nullable: true },
          { ref: 'error', type: 'text', maxLength: 200, nullable: true },
        ],
      },
    ],
  },
  outbox: {
    table: 'messages',
    columns: { kind: 'kind', status: 'status', to: 'to_address', due: 'due_at', sentAt: 'sent_at', error: 'error' },
    links: { patient: 'patient_id', visit: 'visit_id' },
    recipient: { via: 'patient_id', table: 'patients', email: 'email', name: 'name', optIn: 'remind' },
    settings: { table: 'settings', enabled: 'emails_on', name: 'practice_name' },
    kinds: { confirmation: 'e2e-clinic-confirmation', reminder: 'e2e-clinic-reminder' },
    producers: [
      { kind: 'confirmation', link: 'visit_id', onCreate: { table: 'visits' } },
      {
        kind: 'reminder',
        link: 'visit_id',
        optIn: true,
        before: {
          table: 'visits',
          at: 'starts_at',
          lead: { via: 'patient_id', table: 'patients', column: 'lead_hours', fallback: setting('lead_default'), max: 48 },
          where: { column: 'status', eq: 'booked' },
        },
      },
    ],
  },
  emailTemplates: [template('e2e-clinic-confirmation', 'Booked at {{appName}}'), template('e2e-clinic-reminder', 'See you soon at {{appName}}')],
  publicKeys: { kiosk: { requiresStaff: { role: 'kiosk' }, enabledBy: setting('kiosk_on') } },
  publicAccess: [
    { table: 'visits', kind: 'availability', methods: ['GET'] },
    // Found by mobile and date of birth, proved by a code; a proof of work before every claim.
    {
      table: 'patients',
      methods: ['GET'],
      select: ['name'],
      sensitive: true,
      claim: { match: ['mobile', 'born_on'], verify: 'email-code', email: 'email' },
      humanCheck: true,
    },
    {
      table: 'visits',
      methods: ['POST'],
      select: ['id', 'starts_at', 'status'],
      writable: ['starts_at', 'visit_type_id', 'clinician_id'],
      defaults: { status: 'booked' },
      claimedBy: { table: 'patients', column: 'patient_id' },
      sensitive: false,
      reason: 'the reply names the booking just made and nothing else',
    },
    {
      table: 'visits',
      methods: ['GET', 'PATCH'],
      select: ['id', 'starts_at', 'status'],
      writable: ['status'],
      writableValues: { status: ['cancelled'] },
      writableWhen: { status: ['booked'] },
      claimedBy: { table: 'patients', column: 'patient_id' },
      level: 'verified',
      sensitive: true,
    },
    // The kiosk's: found at the tablet, today's visit only.
    { table: 'patients', key: 'kiosk', methods: ['GET'], select: ['name'], claim: { match: ['mobile', 'born_on'] }, sensitive: false, reason: 'the screen greets the person at it' },
    {
      table: 'visits',
      key: 'kiosk',
      methods: ['GET'],
      select: ['id', 'status'],
      claimedBy: { table: 'patients', column: 'patient_id' },
      sensitive: false,
      reason: 'the screen shows only whether a visit is booked',
    },
  ],
};

// ── helpers ───────────────────────────────────────────────────────────────

async function ok<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

async function codeOf(response: APIResponse): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string }; code?: string };
  return body.error?.code ?? body.code;
}

/** The nonce a proof asks for: sha256(salt + nonce) starting with that many zero bits. */
function solve(salt: string, difficulty: number): string {
  for (let n = 0; ; n += 1) {
    const nonce = n.toString(36);
    const digest = createHash('sha256').update(`${salt}${nonce}`).digest();
    let bits = 0;
    for (const byte of digest) {
      if (byte === 0) {
        bits += 8;
        continue;
      }
      bits += Math.clz32(byte) - 24;
      break;
    }
    if (bits >= difficulty) return nonce;
  }
}

/** `YYYY-MM-DD` some days from today, on the venue's calendar. */
function venueDay(offset: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86_400_000));
}

async function sink(request: APIRequestContext): Promise<SinkMessage[]> {
  return (await (await request.get(`${SINK_URL}/messages`)).json()) as SinkMessage[];
}

/** The worker sends on its own clock: wait for the message `pick` finds. */
async function mailTo(request: APIRequestContext, pick: (message: SinkMessage) => boolean, label: string): Promise<SinkMessage> {
  for (let i = 0; i < 60; i += 1) {
    const found = (await sink(request)).find(pick);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the sink never received ${label}`);
}

let connectionId = '';
let priorZone: string | null = null;
const tables: Record<string, string> = {};

// ── the check ─────────────────────────────────────────────────────────────

test.describe('a booking app, end to end', () => {
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const request = context.request;
    // Leave the shared instance as the other specs expect it: the app and its tables gone, the switches back.
    await request.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);
    await request.put('/api/v1/public-api', { data: { enabled: false } }).catch(() => undefined);
    if (connectionId !== '') await request.patch(`/api/v1/connections/${connectionId}`, { data: { timezone: priorZone } }).catch(() => undefined);
    await context.close();
  });

  test('installs, books, proves, sends and uninstalls', async ({ page, playwright }) => {
    test.setTimeout(240_000);
    await page.goto('/');
    connectionId = await seededConnectionId(page);
    const staff = page.request;

    // The venue's clock, and the public API on.
    priorZone = ((await ok<{ timezone: string | null }>(await staff.get(`/api/v1/connections/${connectionId}`))).timezone ?? null);
    await ok(await staff.patch(`/api/v1/connections/${connectionId}`, { data: { timezone: ZONE } }));
    await ok(await staff.put('/api/v1/public-api', { data: { enabled: true } }));

    // ── install: every rule the app asks for is kept ─────────────────────
    const bundle = bundleOf({
      'package.json': JSON.stringify({ name: `@adminium-apps/${KEY}`, version: VERSION }),
      'manifest.json': JSON.stringify(MANIFEST),
      'staff/index.html': '<!doctype html><html><body data-app="e2e-clinic-staff"></body></html>',
      'customer/index.html': '<!doctype html><html><body data-app="e2e-clinic-customer"></body></html>',
    });
    await ok(
      await staff.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(bundle.integrity)}`, {
        headers: { 'content-type': 'application/octet-stream' },
        data: bundle.buffer,
      }),
    );
    const installed = await ok<{ rules: { skipped: unknown[] }; publicAccess: { endpoints: string[]; keys: Record<string, string> } }>(
      await staff.post('/api/v1/apps/install', { data: { key: KEY, version: VERSION, connectionId } }),
    );
    expect(installed.rules.skipped).toEqual([]);
    expect(Object.keys(installed.publicAccess.keys).sort()).toEqual(['customer', 'kiosk']);
    const refs = installed.publicAccess.endpoints;
    const refFor = (prefix: string) => refs.find((ref) => ref.startsWith(prefix))!;

    const schema = await ok<{ model: { tables: { id: string; name: string }[] } }>(await staff.get(`/api/v1/connections/${connectionId}/schema`));
    for (const table of schema.model.tables) {
      if (table.name.startsWith('e2e_clinic_')) tables[table.name.slice('e2e_clinic_'.length)] = table.id;
    }
    expect(Object.keys(tables)).toContain('visits');
    const data = (table: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tables[table]!)}`;
    const add = async (table: string, values: Row) => (await ok<{ data: Row }>(await staff.post(data(table), { data: { values } }), 201)).data;
    const rows = async (table: string) => (await ok<{ data: Row[] }>(await staff.get(`${data(table)}?limit=200`))).data;

    // The practice: open every day, one clinician, one kind of visit.
    await add('settings', { practice_name: 'Hill Clinic' });
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) await add('opening_hours', { weekday: day, open: true, opens: '08:00', closes: '18:00' });
    const rao = await add('clinicians', { name: 'Dr Rao', position: 1 });
    const checkup = await add('visit_types', { name: 'Check-up', minutes: 30, fee: 40 });
    await add('clinician_visit_types', { clinician_id: rao['id'], visit_type_id: checkup['id'] });
    await add('patients', { name: 'Ada Lovelace', ...ADA });
    await add('patients', { name: 'Ben Okri', ...BEN });

    // ── the public side, with the app's own key and no cookie ────────────
    const anonymous = await playwright.request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const config = await ok<{ publishableKey: string }>(await anonymous.get(`/apps/${KEY}/customer/surface-config.json`));
    const publicContext = async (pw: Playwright, token: string) =>
      pw.request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { authorization: `Bearer ${token}`, origin: BASE_URL } });
    const guest = await publicContext(playwright, config.publishableKey);

    // A claim with no proof is refused; with one, found.
    const refused = await guest.post('/api/v1/public/claim', { data: { match: { mobile: ADA.mobile, born_on: ADA.born_on } } });
    expect(refused.status()).toBe(403);
    expect(await codeOf(refused)).toBe('PUBLIC_PROOF_REQUIRED');
    const claim = async (person: typeof ADA) => {
      const challenge = (await ok<{ data: { id: string; salt: string; difficulty: number } }>(await guest.get('/api/v1/public/challenge?purpose=claim'))).data;
      const found = await ok<{ data: { session: string } }>(
        await guest.post('/api/v1/public/claim', {
          headers: { 'x-adminium-proof': `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}` },
          data: { match: { mobile: person.mobile, born_on: person.born_on } },
        }),
      );
      return found.data.session;
    };
    const ada = await claim(ADA);
    const ben = await claim(BEN);

    // Free or full on the venue's calendar, tomorrow.
    const tomorrow = venueDay(1);
    const times = (
      await ok<{ data: { time: string; state: string }[] }>(
        await guest.get(`/api/v1/public/availability/${refFor('e2e_clinic_visits_availability')}?kind=${String(checkup['id'])}&date=${tomorrow}`),
      )
    ).data;
    const free = times.filter((slot) => slot.state === 'free');
    expect(free.length).toBeGreaterThan(2);
    const wall = (time: string) => `${tomorrow}T${time.length > 5 ? new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(time)) : time}:00`;
    const book = (session: string, time: string) =>
      guest.post(`/api/v1/public/records/${refFor('e2e_clinic_visits_claimed')}`, {
        headers: { 'x-adminium-public-session': session },
        data: { values: { starts_at: wall(time), visit_type_id: checkup['id'], clinician_id: rao['id'] } },
      });
    // Ada's visit; then Ada and Ben at once for the next time — one of them gets it.
    const adaVisit = (await ok<{ data: Row }>(await book(ada, free[0]!.time), 201)).data;
    const race = await Promise.all([book(ada, free[2]!.time), book(ben, free[2]!.time)]);
    expect(race.map((res) => res.status()).sort()).toEqual([201, 409]);

    // ── the app's emails: queued by the booking, sent by the worker ──────
    const confirmation = await mailTo(anonymous, (m) => m.to.includes(ADA.email) && m.subject === 'Booked at Hill Clinic', 'Ada’s confirmation');
    expect(confirmation.text).toContain('with Dr Rao');
    await expect
      .poll(async () => (await rows('messages')).filter((m) => m['kind'] === 'confirmation').map((m) => m['status']).sort(), { timeout: 30_000 })
      .toEqual(['sent', 'sent']);

    // ── the emailed code raises Ada's session; then she cancels late ─────
    const cancelRef = refFor('e2e_clinic_visits_verified');
    const early = await guest.patch(`/api/v1/public/records/${cancelRef}/${String(adaVisit['id'])}`, {
      headers: { 'x-adminium-public-session': ada },
      data: { values: { status: 'cancelled' } },
    });
    expect(early.status()).toBe(403);
    expect(await codeOf(early)).toBe('PUBLIC_CLAIM_LEVEL');
    await ok(await guest.post('/api/v1/public/claim/code', { headers: { 'x-adminium-public-session': ada }, data: { purpose: 'verify' } }));
    const codeMail = await mailTo(anonymous, (m) => m.to.includes(ADA.email) && /\d{6}/.test(m.subject), 'Ada’s code');
    // Through the app's own key, the code is signed with the practice's name.
    expect(codeMail.subject).toContain('Hill Clinic');
    const code = /(\d{6})/.exec(codeMail.subject)![1]!;
    const raised = await ok<{ data: { level: string } }>(
      await guest.post('/api/v1/public/claim/verify', { headers: { 'x-adminium-public-session': ada }, data: { purpose: 'verify', code } }),
    );
    expect(raised.data.level).toBe('verified');
    await ok(
      await guest.patch(`/api/v1/public/records/${cancelRef}/${String(adaVisit['id'])}`, {
        headers: { 'x-adminium-public-session': ada },
        data: { values: { status: 'cancelled' } },
      }),
    );
    const cancelled = (await rows('visits')).find((visit) => visit['id'] === adaVisit['id'])!;
    expect(cancelled['status']).toBe('cancelled');
    // Inside the window: flagged late, by the server, whatever the page sent.
    expect([true, 1, '1', 't']).toContain(cancelled['late_cancel']);

    // ── the desk: a stamp on check-in, and money that never goes below zero ─
    const booked = (await rows('visits')).find((visit) => visit['status'] === 'booked')!;
    const checkedIn = (await ok<{ data: Row }>(await staff.patch(`${data('visits')}/${String(booked['id'])}`, { data: { values: { status: 'checked_in' } } }))).data;
    expect(checkedIn['checked_in_at']).not.toBeNull();
    const over = await staff.post(data('payments'), { data: { values: { visit_id: booked['id'], amount: 50 } } });
    expect(over.status()).toBe(409);
    expect(await codeOf(over)).toBe('BALANCE_EXCEEDED');
    await add('payments', { visit_id: booked['id'], amount: 40 });
    const settled = (await rows('visits')).find((visit) => visit['id'] === booked['id'])!;
    expect(Number(settled['paid'])).toBe(40);
    expect(Number(settled['balance'])).toBe(0);

    // ── the kiosk's key opens nothing alone ─────────────────────────────
    const keys = await ok<{ keys: { id: string; purpose?: string; revokedAt: number | null; requiresStaff?: unknown }[] }>(await staff.get('/api/v1/public-keys'));
    const kioskKey = keys.keys.find((key) => key.id === installed.publicAccess.keys['kiosk'])!;
    expect(kioskKey).toMatchObject({ purpose: 'kiosk', requiresStaff: { appKey: KEY, roleSlug: `${KEY}-kiosk` } });
    const token = (await ok<{ token: string }>(await staff.get(`/api/v1/public-keys/${kioskKey.id}/reveal`))).token;
    const tablet = await publicContext(playwright, token);
    const alone = await tablet.get('/api/v1/public/config');
    expect(alone.status()).toBe(403);
    expect(await codeOf(alone)).toBe('PUBLIC_STAFF_REQUIRED');
    // Nor is it handed to a staff member who does not hold the kiosk role.
    const staffConfig = await ok<{ publicKeys?: unknown }>(await staff.get(`/apps/${KEY}/staff/surface-config.json`));
    expect(staffConfig.publicKeys).toBeUndefined();

    await anonymous.dispose();
    await guest.dispose();
    await tablet.dispose();

    // ── uninstall, with its tables ──────────────────────────────────────
    await ok(await staff.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }));
    const after = await ok<{ model: { tables: { name: string }[] } }>(await staff.get(`/api/v1/connections/${connectionId}/schema`));
    expect(after.model.tables.filter((table) => table.name.startsWith('e2e_clinic_'))).toEqual([]);
  });
});
