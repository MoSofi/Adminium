// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A BOOKING AS A CALENDAR ENTRY, on SQLite, Postgres and MySQL: the revision
 * Adminium keeps, the invitation and its cancellation on the mail, what they
 * may never carry, the stop link of a mail sent for a purpose, and a person's
 * private feed with who may see and renew its link.
 *
 * How Gmail, Outlook and Apple Mail show the invitation is not proved here.
 */
import { calendarFeedsRepo, documentSequencesRepo, rolesRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import type { RecordWriteEvent } from '../src/crud/after-record-write.js';
import type { ResolvedTable, SnapshotView } from '../src/crud/identifiers.js';
import type { Row } from '../src/crud/mask.js';
import { createWriteService, type WriteContext } from '../src/crud/write-service.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey, EMAIL_SEND_JOB_KIND } from '../src/email/send.js';
import type { EmailTransport, OutboundEmail } from '../src/email/types.js';
import { registerEmailSendHandler } from '../src/jobs/email-send.js';
import { createJobRegistry } from '../src/jobs/registry.js';
import { createOutboxProducers, type OutboxProducers } from '../src/outbox/producers.js';
import { createOutboxSender, type OutboxSender } from '../src/outbox/sender.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from './auth-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.71' }));

const ZONE = 'America/Los_Angeles';
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120) => ({ ref, type: 'text', maxLength, nullable: true });
const fk = (ref: string, references: string, nullable = true) => ({ ref, type: 'fk', references, nullable });
const instant = (ref: string) => ({ ref, type: 'timestamptz', nullable: true });
const KINDS = ['visit-booked', 'visit-cancelled', 'review-ask'];
const STATES = ['booked', 'arrived', 'done', 'cancelled'];
const NOTICE = { 'en-US': 'Declining in your calendar does not cancel.', 'de-DE': 'Eine Absage im Kalender storniert nicht.' };

function manifest(): Record<string, unknown> {
  const hours = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const tables = [
    { ref: 'settings', columns: [id, text('name'), text('address'), text('website'), text('calendar_detail', 16), text('reply_to', 254), { ref: 'grid', type: 'int', default: 15 }] },
    { ref: 'team', columns: [id, text('first_name'), { ref: 'email', type: 'text', maxLength: 254, nullable: true }, { ref: 'active', type: 'bool', default: true }, { ref: 'position', type: 'int', default: 1 }] },
    { ref: 'services', columns: [id, text('name'), { ref: 'minutes', type: 'int', default: 60 }] },
    { ref: 'team_services', columns: [id, fk('team_id', 'team', false), fk('service_id', 'services', false)] },
    { ref: 'hours', columns: [id, { ref: 'weekday', type: 'enum', enum: hours }, text('opens', 5), text('closes', 5)] },
    { ref: 'customers', columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, text('name')] },
    {
      ref: 'visits',
      columns: [
        id,
        fk('customer_id', 'customers', false),
        fk('team_id', 'team'),
        fk('service_id', 'services', false),
        { ref: 'starts_at', type: 'timestamptz' },
        { ref: 'minutes', type: 'int', default: 60, rules: { copy: { via: 'service_id', from: 'minutes', mode: 'always', follow: true } } },
        { ref: 'rep_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
        { ref: 'state', type: 'enum', enum: STATES, default: 'booked' },
        text('code', 20),
        text('note', 200),
        text('phone', 20),
        { ref: 'revision', type: 'int', default: 0 },
      ],
      booking: {
        start: 'starts_at',
        minutes: 'minutes',
        resource: 'team_id',
        kind: 'service_id',
        countWhere: { column: 'state', values: ['booked', 'arrived', 'done'] },
        eligible: { table: 'team_services', resource: 'team_id', kind: 'service_id', order: { table: 'team', column: 'position', active: 'active' } },
        hours: { practice: { table: 'hours', weekday: 'weekday', opens: 'opens', closes: 'closes' } },
        grid: { table: 'settings', column: 'grid' },
        calendar: {
          revision: 'revision',
          title: ['service_id', 'name'],
          code: 'code',
          person: ['team_id', 'first_name'],
          studio: { name: { table: 'settings', column: 'name' }, address: { table: 'settings', column: 'address' }, website: { table: 'settings', column: 'website' } },
          notice: NOTICE,
          feed: { own: 'email', active: 'active', detail: { table: 'settings', column: 'calendar_detail' }, customer: ['customer_id', 'name'] },
        },
      },
    },
    {
      ref: 'messages',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: KINDS },
        { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
        text('to_address', 254),
        fk('customer_id', 'customers'),
        fk('visit_id', 'visits'),
        text('skip_reason', 24),
        instant('due'),
        instant('sent_at'),
        text('error', 200),
      ],
    },
  ];
  const template = (kind: string, words: string, calendar: boolean) => ({
    key: `studio-${kind}`,
    name: kind,
    ...(calendar ? { calendar: { link: 'visit' } } : {}),
    locales: { 'en-US': { subject: kind, blocks: [{ block: 'email.text', data: { text: words } }] } },
  });
  return {
    ...invoicingManifest(tables),
    compatibility: { minAdminiumVersion: '0.3.71' },
    pages: [{ ref: 'studio-visits', template: 'page-crud', title: { key: 't', fallback: 'Visits' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'visits' } }],
    roles: [{ key: 'desk', name: 'Desk', permissions: ['app:@:staff', 'table:@team:read', 'table:@visits:read'] }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', due: 'due', sentAt: 'sent_at', error: 'error', skipReason: 'skip_reason' },
      links: { customer: 'customer_id', visit: 'visit_id' },
      recipient: { via: 'customer_id', table: 'customers', email: 'email', name: 'name' },
      settings: { table: 'settings', name: 'name', replyTo: 'reply_to' },
      kinds: Object.fromEntries(KINDS.map((kind) => [kind, `studio-${kind}`])),
      classes: { 'visit-booked': 'service', 'visit-cancelled': 'service', 'review-ask': 'service' },
      purposes: { 'review-ask': 'surveys' },
      producers: [
        { kind: 'visit-booked', link: 'visit_id', onCreate: { table: 'visits' }, replyTo: { staff: 'rep_id' } },
        { kind: 'visit-cancelled', link: 'visit_id', onChange: { table: 'visits', column: 'state', to: ['cancelled'] } },
        { kind: 'review-ask', link: 'visit_id', onChange: { table: 'visits', column: 'state', to: ['done'] } },
      ],
    },
    emailTemplates: [
      template('visit-booked', 'See you {{calendarGoogle}} {{calendarOutlook}}', true),
      template('visit-cancelled', 'Cancelled.', true),
      template('review-ask', 'How was it? Stop asking: {{stopLink}}', false),
    ],
  };
}

interface Sent {
  to: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  calendar?: { method: string; content: string };
}

const unfolded = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');

describe.each(LEGS)('a booking as a calendar entry — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let meta: MetaDb;
  let view: SnapshotView;
  let producers: OutboxProducers;
  let sender: OutboxSender;
  let writes: ReturnType<typeof createWriteService>;
  let served: Served;
  let customer: Row;
  let ip = 0;
  const desk: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_desk', label: 'The desk' }, request: null };
  const yes = dialect === 'postgres' ? 'true' : '1';
  const no = dialect === 'postgres' ? 'false' : '0';
  const fresh = () => {
    ip += 1;
    return `10.8.${String((ip >> 8) & 255)}.${String(ip & 255)}`;
  };

  const table = (ref: string): ResolvedTable => view.table(view.model.tables.find((t) => t.name === h.real(ref))!.id);
  const target = async (ref: string) => {
    const { db, dialect: d } = await h.manager.data(h.connectionId);
    return { connectionId: h.connectionId, view, table: table(ref), db, dialect: d, timezone: ZONE };
  };
  const event = (ref: string, action: 'create' | 'update', before: Row | null, after: Row): RecordWriteEvent => ({
    connectionId: h.connectionId,
    table: table(ref),
    action,
    entity: { connectionId: h.connectionId, table: table(ref).id, pk: { id: after['id'] }, label: String(after['id']) },
    before,
    after,
    origin: 'dashboard',
    hops: 0,
  });
  const create = async (ref: string, values: Row): Promise<Row> => {
    const row = await writes.create({ target: await target(ref), values, context: desk, announce: async () => {} });
    await producers.onRecordEvent(event(ref, 'create', null, row));
    return row;
  };
  const update = async (ref: string, rowId: unknown, values: Row): Promise<Row> => {
    const outcome = await writes.update({ target: await target(ref), pk: { id: rowId }, values, context: desk, announce: async () => {} });
    await producers.onRecordEvent(event(ref, 'update', outcome.before, outcome.after!));
    return outcome.after!;
  };
  const revision = async (visit: Row) => Number((await h.rows(`SELECT revision FROM ${h.real('visits')} WHERE id = ${String(visit['id'])}`))[0]!['revision']);

  /** The mails queued since the last look, opened as delivery would open them. */
  const drain = async (): Promise<Sent[]> => {
    const jobs = await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', EMAIL_SEND_JOB_KIND).orderBy('createdAt').execute();
    const out = jobs.map((job) => {
      const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
      return JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as Sent;
    });
    await meta.db.deleteFrom('adminium_jobs').where('kind', '=', EMAIL_SEND_JOB_KIND).execute();
    return out;
  };
  const send = async () => {
    await sender.sendApp('studio', Date.now());
    return drain();
  };
  let slot = 0;
  /** A free hour, each visit its own, weeks from now. */
  const nextSlot = () => {
    slot += 1;
    return new Date(Date.UTC(2031, 2, 3 + Math.floor(slot / 6), 17 + (slot % 6), 0, 0)).toISOString();
  };
  const book = (extra: Row = {}) => create('visits', { customer_id: customer['id'], team_id: 1, service_id: 1, minutes: 60, starts_at: nextSlot(), code: `LMN-${String(1000 + slot)}`, note: 'SECRET-NOTE', phone: '555-0100', ...extra });

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    meta = h.meta;
    await meta.db.updateTable('adminium_connections').set({ timezone: ZONE }).where('id', '=', h.connectionId).execute();
    await settingsRepo(meta).set('email.smtp', { host: 'localhost', port: 587, user: 'postmaster', passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)), from: 'Lumen <no-reply@lumen.example>', secure: false } as never);
    await settingsRepo(meta).set('system.publicOrigin', 'https://admin.lumen.example' as never);
    await settingsRepo(meta).set('system.instanceId', 'install-test' as never);
    const views = createPublicViews(meta);
    view = (await views.viewFor(h.connectionId))!;
    writes = createWriteService({ sequences: documentSequencesRepo(meta), watched: (connectionId, tableId) => producers.watches(connectionId, tableId) });
    producers = createOutboxProducers({ meta, manager: h.manager, viewFor: views.viewFor, writes });
    sender = createOutboxSender({
      meta,
      manager: h.manager,
      viewFor: views.viewFor,
      writes,
      live: () => producers.live(),
      secret: TEST_SECRET,
      hostFor: async () => 'book.lumen.example',
      emit: async (e) => {
        await producers.onRecordEvent(e);
      },
    });
    await h.rows(`INSERT INTO ${h.real('settings')} (name, address, website, calendar_detail, reply_to) VALUES ('Lumen Studio', '12 Valencia St', 'https://lumen.example', 'service', 'hello@lumen.example')`);
    await h.rows(`INSERT INTO ${h.real('team')} (id, first_name, email, active, position) VALUES (1, 'Ivy Chen', 'ivy@lumen.example', ${yes}, 1), (2, 'Marco Ruiz', 'marco@lumen.example', ${yes}, 2)`);
    await h.rows(`INSERT INTO ${h.real('services')} (id, name, minutes) VALUES (1, 'Reformer Pilates', 60)`);
    await h.rows(`INSERT INTO ${h.real('team_services')} (team_id, service_id) VALUES (1, 1), (2, 1)`);
    for (const weekday of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) await h.rows(`INSERT INTO ${h.real('hours')} (weekday, opens, closes) VALUES ('${weekday}', '00:00', '23:45')`);
    customer = await create('customers', { email: 'ava@lumen-guests.dev', name: 'Ava Stone' });
    served = await servePublic(h, null);
  }, 240_000);
  afterAll(async () => {
    if (!available) return;
    await served?.close();
    await h?.close();
  });

  describe('the revision', () => {
    it.skipIf(!available)('starts at 0, and whatever a writer sends for it is not theirs to say', async () => {
      const visit = await book({ revision: 41 });
      expect(await revision(visit)).toBe(0);
      await update('visits', visit['id'], { revision: 99 });
      expect(await revision(visit)).toBe(0);
    });

    it.skipIf(!available)('rises on a new time, length, person and cancel; not on an edit a calendar need not hear of', async () => {
      const visit = await book();
      await update('visits', visit['id'], { note: 'changed' });
      expect(await revision(visit)).toBe(0);
      await update('visits', visit['id'], { starts_at: nextSlot() });
      expect(await revision(visit)).toBe(1);
      // The length follows the service, through a statement of its own.
      await update('services', 1, { minutes: 45 });
      expect(await revision(visit)).toBe(2);
      await update('services', 1, { minutes: 60 });
      expect(await revision(visit)).toBe(3);
      await update('visits', visit['id'], { team_id: 2 });
      expect(await revision(visit)).toBe(4);
      // Marked arrived: it still takes its time.
      await update('visits', visit['id'], { state: 'arrived' });
      expect(await revision(visit)).toBe(4);
      await update('visits', visit['id'], { state: 'cancelled' });
      expect(await revision(visit)).toBe(5);
      await drain();
    });

    it.skipIf(!available)('a file brought in can neither set it nor lower it', async () => {
      const imported: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_desk', label: 'The desk' }, request: null };
      const visit = await book();
      await update('visits', visit['id'], { starts_at: nextSlot() });
      await update('visits', visit['id'], { starts_at: nextSlot() });
      expect(await revision(visit)).toBe(2);
      await writes.update({ target: await target('visits'), pk: { id: visit['id'] }, values: { revision: 0, note: 'from a file' }, context: imported, announce: async () => {} });
      expect(await revision(visit)).toBe(2);
      const made = await writes.create({ target: await target('visits'), values: { customer_id: customer['id'], team_id: 1, service_id: 1, minutes: 60, starts_at: nextSlot(), revision: 77 }, context: imported, announce: async () => {} });
      expect(await revision(made)).toBe(0);
      await drain();
    });

    it.skipIf(!available)('does not rise for a time sent again unchanged', async () => {
      const at = nextSlot();
      const visit = await book({ starts_at: at });
      await update('visits', visit['id'], { starts_at: at, minutes: 60, team_id: 1 });
      expect(await revision(visit)).toBe(0);
    });
  });

  describe('the invitation on the mail', () => {
    it.skipIf(!available)('is a REQUEST, then a CANCEL with the same UID and a higher sequence', async () => {
      await send();
      const visit = await book();
      const [booked] = await send();
      expect(booked!.calendar?.method).toBe('REQUEST');
      const first = unfolded(booked!.calendar!.content);
      const uid = first.find((line) => line.startsWith('UID:'))!;
      expect(uid).toBe(`UID:studio.${h.connectionId}.${String(visit['id'])}@install-test`);
      expect(first).toContain('SEQUENCE:0');
      expect(first.some((line) => line.startsWith('ATTENDEE') && line.endsWith('RSVP=FALSE:mailto:ava@lumen-guests.dev'))).toBe(true);
      expect(first.some((line) => line.startsWith('ORGANIZER;CN="Lumen Studio":mailto:hello@lumen.example'))).toBe(true);
      expect(first.some((line) => /^DTSTART:\d{8}T\d{6}Z$/.test(line))).toBe(true);

      await update('visits', visit['id'], { state: 'cancelled' });
      const [cancelled] = await send();
      expect(cancelled!.calendar?.method).toBe('CANCEL');
      const second = unfolded(cancelled!.calendar!.content);
      expect(second).toContain(uid);
      expect(second).toContain('SEQUENCE:1');
      expect(second).toContain('STATUS:CANCELLED');
    });

    it.skipIf(!available)('holds the facts and the studio\'s words, and nothing a guest typed', async () => {
      await send();
      await book({ note: 'SECRET-NOTE call me', phone: '555-0199' });
      const [mail] = await send();
      const content = mail!.calendar!.content.replace(/\r\n /g, '');
      expect(content).toContain('Reformer Pilates');
      expect(content).toContain('Ivy');
      expect(content).not.toContain('Chen');
      expect(content).toContain('LMN-');
      expect(content).toContain('12 Valencia St');
      expect(content).toContain('Declining in your calendar does not cancel.');
      for (const never of ['SECRET-NOTE', '555-0199', 'Ava', 'Stone']) expect(content).not.toContain(never);
    });

    it.skipIf(!available)('names the studio as organiser even when a reply goes to a staff member', async () => {
      await send();
      const rep = await usersRepo(meta).create({ email: 'rep@lumen.example', name: 'Rep', passwordHash: await adminPasswordHash() });
      await book({ rep_id: rep.id });
      const [mail] = await send() as (Sent & { replyTo?: string })[];
      expect(mail!.replyTo).toBe('rep@lumen.example');
      const lines = unfolded(mail!.calendar!.content);
      expect(lines.some((line) => line.startsWith('ORGANIZER;CN="Lumen Studio":mailto:hello@lumen.example'))).toBe(true);
      expect(mail!.calendar!.content).not.toContain('rep@lumen.example');
    });

    it.skipIf(!available)('prints the two links with the same fields, and none for a cancelled visit', async () => {
      await send();
      const visit = await book({ note: 'SECRET-NOTE' });
      const [mail] = await send();
      expect(mail!.text).toContain('https://calendar.google.com/calendar/render');
      expect(mail!.text).toContain('https://outlook.live.com/calendar');
      expect(mail!.text).not.toContain('SECRET-NOTE');
      await update('visits', visit['id'], { state: 'cancelled' });
      const [gone] = await send();
      expect(gone!.text).not.toContain('calendar.google.com');
    });
  });

  describe('at delivery', () => {
    it.skipIf(!available)('hands the transport the calendar entry, and a purpose mail its list headers', async () => {
      await send();
      const sent: OutboundEmail[] = [];
      const registry = createJobRegistry();
      registerEmailSendHandler(registry, { meta, secret: TEST_SECRET, createTransport: () => ({ send: async (msg: OutboundEmail) => void sent.push(msg) }) as EmailTransport });
      const entry = registry.get(EMAIL_SEND_JOB_KIND)!;
      const deliver = async () => {
        await sender.sendApp('studio', Date.now());
        const jobs = await meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', EMAIL_SEND_JOB_KIND).orderBy('createdAt').execute();
        for (const job of jobs) await entry.run(entry.schema.parse(typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload), { progress: () => undefined, attempt: 1, maxAttempts: 5, jobId: job.id } as never);
        await meta.db.deleteFrom('adminium_jobs').where('kind', '=', EMAIL_SEND_JOB_KIND).execute();
      };
      const visit = await book();
      await deliver();
      expect(sent.at(-1)!.calendar?.method).toBe('REQUEST');
      expect(sent.at(-1)!.calendar?.content).toContain('BEGIN:VCALENDAR');
      await update('visits', visit['id'], { state: 'done' });
      await deliver();
      expect(sent.at(-1)!.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(sent.at(-1)!.calendar).toBeUndefined();
    });
  });

  describe('the stop link of a mail sent for a purpose', () => {
    it.skipIf(!available)('is printed, and the mail carries the two list headers', async () => {
      await send();
      const visit = await book();
      await send();
      await update('visits', visit['id'], { state: 'done' });
      const [mail] = await send();
      expect(mail!.text).toMatch(/https:\/\/admin\.lumen\.example\/m\/u\/\S+/);
      const url = /https:\/\/admin\.lumen\.example\/m\/u\/\S+/.exec(mail!.text)![0];
      expect(mail!.headers?.['List-Unsubscribe']).toBe(`<${url}>`);
      expect(mail!.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(mail!.calendar).toBeUndefined();
    });

    it.skipIf(!available)('a mail with no purpose has neither', async () => {
      await send();
      await book();
      const [mail] = await send();
      expect(mail!.headers).toBeUndefined();
    });
  });

  describe('the private feed', () => {
    const logins: Record<string, string> = {};
    const login = async (email: string, role: string) => {
      if (logins[email] !== undefined) return logins[email]!;
      const user = await usersRepo(meta).create({ email, name: email, passwordHash: await adminPasswordHash() });
      await rolesRepo(meta).assignToUser(user.id, (await rolesRepo(meta).findBySlug(role))!.id);
      const res = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: fresh(), payload: { email, password: ADMIN_PASSWORD } });
      logins[email] = sessionCookie(res.headers['set-cookie']);
      return logins[email]!;
    };
    const query = (row: number) => `connection=${h.connectionId}&table=${encodeURIComponent(table('visits').id)}&row=${String(row)}`;
    const look = (cookie: string, row: number) => served.composed.app.inject({ method: 'GET', url: `/api/v1/calendar-feed?${query(row)}`, remoteAddress: fresh(), headers: { cookie } });
    const renew = (cookie: string, row: number) =>
      served.composed.app.inject({ method: 'POST', url: '/api/v1/calendar-feed/renew', remoteAddress: fresh(), headers: { cookie }, payload: { connection: h.connectionId, table: table('visits').id, row: String(row) } });
    const fetchFeed = (path: string, headers: Record<string, string> = {}, method: 'GET' | 'HEAD' = 'GET') => served.composed.app.inject({ method, url: path, remoteAddress: fresh(), headers });
    const pathOf = (link: string) => new URL(link).pathname;

    it.skipIf(!available)('shows a person their own link, tells an owner only that they may renew it, and refuses the desk', async () => {
      const ivy = await login('ivy@lumen.example', 'super-admin');
      const mine = await look(ivy, 1);
      expect(mine.statusCode, mine.body).toBe(200);
      expect((mine.json() as { data: { link: string; own: boolean } }).data.own).toBe(true);
      expect((mine.json() as { data: { link: string } }).data.link).toMatch(/^https:\/\/admin\.lumen\.example\/x\/cal\/[A-Za-z0-9_-]+\.ics$/);
      const theirs = await look(ivy, 2);
      expect(theirs.json()).toEqual({ data: { link: null, own: false } });
      const deskCookie = await login('jun@lumen.example', 'studio-desk');
      expect((await look(deskCookie, 1)).statusCode).toBe(403);
      expect((await renew(deskCookie, 1)).statusCode).toBe(403);
    });

    it.skipIf(!available)('holds the person\'s counted visits in UTC, and leaves out a cancelled one and another person\'s', async () => {
      await drain();
      const near = new Date(Date.now() + 5 * 86_400_000);
      near.setUTCHours(18, 0, 0, 0);
      const kept = await create('visits', { customer_id: customer['id'], team_id: 1, service_id: 1, minutes: 60, starts_at: near.toISOString(), code: 'LMN-KEPT', note: 'SECRET-NOTE' });
      const off = await create('visits', { customer_id: customer['id'], team_id: 1, service_id: 1, minutes: 60, starts_at: new Date(near.getTime() + 2 * 3_600_000).toISOString(), code: 'LMN-GONE' });
      await update('visits', off['id'], { state: 'cancelled' });
      await create('visits', { customer_id: customer['id'], team_id: 2, service_id: 1, minutes: 60, starts_at: near.toISOString(), code: 'LMN-MARCO' });
      await drain();
      const ivy = await login('ivy@lumen.example', 'super-admin');
      const link = (await look(ivy, 1)).json() as { data: { link: string } };
      const res = await fetchFeed(pathOf(link.data.link));
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-robots-tag']).toBe('noindex');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      const body = res.body.replace(/\r\n /g, '');
      expect(body).toContain(`UID:studio.${h.connectionId}.${String(kept['id'])}@install-test`);
      expect(body).toContain('LMN-KEPT');
      expect(body).not.toContain('LMN-GONE');
      expect(body).not.toContain('LMN-MARCO');
      for (const never of ['SECRET-NOTE', 'ava@lumen-guests.dev', 'Ava', '555-']) expect(body).not.toContain(never);
      expect(body).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    });

    it.skipIf(!available)('shows a customer\'s first name and initial only while the studio\'s setting says so', async () => {
      const ivy = await login('ivy@lumen.example', 'super-admin');
      const link = (await look(ivy, 1)).json() as { data: { link: string } };
      await h.rows(`UPDATE ${h.real('settings')} SET calendar_detail = 'name'`);
      const named = (await fetchFeed(pathOf(link.data.link))).body.replace(/\r\n /g, '');
      expect(named).toContain('Ava S.');
      expect(named).not.toContain('Stone');
      await h.rows(`UPDATE ${h.real('settings')} SET calendar_detail = 'service'`);
      expect((await fetchFeed(pathOf(link.data.link))).body).not.toContain('Ava');
    });

    it.skipIf(!available)('answers 304 to a calendar that holds this version, though the moment it was made has moved', async () => {
      const ivy = await login('ivy@lumen.example', 'super-admin');
      const path = pathOf(((await look(ivy, 1)).json() as { data: { link: string } }).data.link);
      const first = await fetchFeed(path);
      const again = await fetchFeed(path, { 'if-none-match': String(first.headers['etag']) });
      expect(again.statusCode).toBe(304);
      expect(again.body).toBe('');
      const head = await fetchFeed(path, {}, 'HEAD');
      expect(head.statusCode).toBe(200);
      expect(head.body).toBe('');
    });

    it.skipIf(!available)('stops at once when renewed, by the person or by an owner, and an owner is not handed the new link', async () => {
      const ivy = await login('ivy@lumen.example', 'super-admin');
      const old = pathOf(((await look(ivy, 1)).json() as { data: { link: string } }).data.link);
      expect((await fetchFeed(old)).statusCode).toBe(200);
      const renewed = await renew(ivy, 1);
      expect(renewed.statusCode, renewed.body).toBe(200);
      const next = pathOf((renewed.json() as { data: { link: string } }).data.link);
      expect(next).not.toBe(old);
      expect((await fetchFeed(old)).statusCode).toBe(404);
      expect((await fetchFeed(next)).statusCode).toBe(200);
      // An owner ends it without being given it.
      const owner = await login('selma@lumen.example', 'super-admin');
      const byOwner = await renew(owner, 1);
      expect(byOwner.json()).toEqual({ data: { link: null, own: false } });
      expect((await fetchFeed(next)).statusCode).toBe(404);
      const audit = await meta.db.selectFrom('adminium_audit_log').select('action').where('action', '=', 'calendar-feed.renew').execute();
      expect(audit.length).toBeGreaterThanOrEqual(2);
    });

    it.skipIf(!available)('stops while the person who took it is suspended, and for good once they are deleted', async () => {
      await h.rows(`INSERT INTO ${h.real('team')} (id, first_name, email, active, position) VALUES (9, 'Sam Vale', 'sam@lumen.example', ${yes}, 9)`);
      const sam = await login('sam@lumen.example', 'super-admin');
      const path = pathOf(((await look(sam, 9)).json() as { data: { link: string } }).data.link);
      expect((await fetchFeed(path)).statusCode).toBe(200);
      const user = (await usersRepo(meta).findByEmail('sam@lumen.example'))!;
      await usersRepo(meta).updateStatus(user.id, 'suspended');
      expect((await fetchFeed(path)).statusCode).toBe(404);
      await usersRepo(meta).updateStatus(user.id, 'active');
      expect((await fetchFeed(path)).statusCode).toBe(200);
      await meta.db.deleteFrom('adminium_user_roles').where('userId', '=', user.id).execute();
      await meta.db.deleteFrom('adminium_sessions').where('userId', '=', user.id).execute();
      await meta.db.deleteFrom('adminium_users').where('id', '=', user.id).execute();
      expect((await fetchFeed(path)).statusCode).toBe(404);
    });

    it.skipIf(!available)('counts one person\'s links together, however many of them were asked for', async () => {
      await h.rows(`INSERT INTO ${h.real('team')} (id, first_name, email, active, position) VALUES (8, 'Noa Hale', 'noa@lumen.example', ${yes}, 8)`);
      const noa = await login('noa@lumen.example', 'super-admin');
      const links = await Promise.all(Array.from({ length: 6 }, async () => pathOf(((await look(noa, 8)).json() as { data: { link: string } }).data.link)));
      expect(new Set(links).size).toBe(6);
      const codes: number[] = [];
      for (let i = 0; i < 61; i += 1) codes.push((await fetchFeed(links[i % links.length]!)).statusCode);
      expect(codes.slice(0, 60).every((code) => code === 200)).toBe(true);
      expect(codes[60]).toBe(429);
    });

    it.skipIf(!available)('is bound to the person: a row that comes to hold someone else opens nothing', async () => {
      await h.rows(`INSERT INTO ${h.real('team')} (id, first_name, email, active, position) VALUES (3, 'Lee Park', 'lee@lumen.example', ${yes}, 3)`);
      const lee = await login('lee@lumen.example', 'super-admin');
      const path = pathOf(((await look(lee, 3)).json() as { data: { link: string } }).data.link);
      // A person with no visits still gets a valid calendar.
      const empty = await fetchFeed(path);
      expect(empty.statusCode).toBe(200);
      expect(empty.body).toContain('BEGIN:VFREEBUSY');
      // The row is handed to a new hire.
      await h.rows(`UPDATE ${h.real('team')} SET email = 'new-hire@lumen.example' WHERE id = 3`);
      expect((await fetchFeed(path)).statusCode).toBe(404);
      await h.rows(`UPDATE ${h.real('team')} SET email = 'lee@lumen.example' WHERE id = 3`);
      expect((await fetchFeed(path)).statusCode).toBe(200);
      // Lee leaves, and the next hire is given the same id.
      await h.rows(`DELETE FROM ${h.real('team')} WHERE id = 3`);
      expect((await fetchFeed(path)).statusCode).toBe(404);
      await h.rows(`INSERT INTO ${h.real('team')} (id, first_name, email, active, position) VALUES (3, 'Noa Levy', 'noa@lumen.example', ${yes}, 3)`);
      expect((await fetchFeed(path)).statusCode).toBe(404);
      await h.rows(`DELETE FROM ${h.real('team')} WHERE id = 3`);
    });

    it.skipIf(!available)('answers one 404 for a made-up link, a changed byte, an inactive person and a deleted row', async () => {
      const ivy = await login('ivy@lumen.example', 'super-admin');
      const path = pathOf(((await look(ivy, 1)).json() as { data: { link: string } }).data.link);
      const dead = await fetchFeed(`/x/cal/${'A'.repeat(80)}.ics`);
      expect(dead.statusCode).toBe(404);
      const changed = path.replace(/.\.ics$/, (tail) => `${tail[0] === 'A' ? 'B' : 'A'}.ics`);
      expect((await fetchFeed(changed)).body).toBe(dead.body);
      expect((await fetchFeed(path.slice(0, -4))).statusCode).toBe(404);
      await h.rows(`UPDATE ${h.real('team')} SET active = ${no} WHERE id = 1`);
      const inactive = await fetchFeed(path);
      expect([inactive.statusCode, inactive.body]).toEqual([404, dead.body]);
      await h.rows(`UPDATE ${h.real('team')} SET active = ${yes} WHERE id = 1`);
      expect((await fetchFeed(path)).statusCode).toBe(200);
      const feeds = calendarFeedsRepo(meta);
      const key = { connectionId: h.connectionId, appKey: 'studio', tableName: table('visits').id, rowKey: '1' };
      expect(await feeds.nonceOf(key)).toEqual(expect.any(String));
    });
  });
});
