// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ERASING A PERSON KNOWN ONLY BY PHONE, against the whole server on SQLite,
 * Postgres and MySQL, through an app installed by the real installer.
 *
 *  - Only under the privacy action, by a signed-in person: a rep is refused.
 *  - Their row is one holding the exact number and no address. A row that names
 *    an address may be someone else's on a shared line: it loses the number and
 *    nothing else. A near number is not theirs.
 *  - Their stop entry stays as a hash, and their consent log, inbound events,
 *    delivery records and any job error quoting the number are gone.
 *  - No reply, log or audit row holds the number.
 *  - An erasure by address takes the text records of the number on their row.
 */
import { Writable } from 'node:stream';

import { apiKeysRepo, auditRepo, jobsRepo, permissionsRepo, rolesRepo, settingsRepo } from '@adminium/meta';
import { strFromU8, unzipSync } from 'fflate';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { addressKeyRing } from '../src/consent/keys.js';
import { createInboundEventStore } from '../src/inbound/index.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { createTextConsentService, textSubject } from '../src/sms/consent/index.js';
import { createTextSendStore } from '../src/sms/send/index.js';
import { createTextThreads } from '../src/sms/threads/index.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.38' }));

const SAM = '+4915123456789';
const SAM_TYPED = '0151 23456789';
const NEAR = '+4915123456780';
const KIM = '+4917612345678';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 80, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });

function shop(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.shop.desc', fallback: 'A shop.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.38', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: { 'en-US': 'Sales' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'members',
          keyField: 'name',
          columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, text('email', 254, { rules: { personal: true } }), text('phone', 40, { rules: { personal: true } }), text('notes', 200, { rules: { personal: true } }), text('reference', 20, { rules: { personal: false } })],
        },
        { ref: 'bookings', columns: [id, { ref: 'member_id', type: 'fk', references: 'members', nullable: true }, text('guest_email', 254), text('guest_phone', 40), text('notes', 200, { rules: { personal: true } })] },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['note'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            { ref: 'member_id', type: 'fk', references: 'members', nullable: true },
            text('error', 200),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
        { ref: 'receipts', keyField: 'number', keep: { law: 'tax' }, columns: [id, text('number', 20), text('email', 254), text('phone', 40)] },
      ],
    },
    people: [
      {
        table: 'members',
        kind: 'people',
        email: 'email',
        name: 'name',
        copies: [
          { table: 'bookings', column: 'guest_email', holds: 'email', via: 'member_id' },
          { table: 'bookings', column: 'guest_phone', holds: 'phone', via: 'member_id' },
        ],
      },
      { table: 'receipts', kind: 'people', email: 'email' },
    ],
    roles: [{ key: 'rep', name: 'Rep', permissions: ['table:@members:read', 'page:@shop-members:view'] }],
    pages: [{ ref: 'shop-members', template: 'page-crud', title: { key: 't.members', fallback: 'Members' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'members' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { member: 'member_id' },
      recipient: { via: 'member_id', table: 'members', email: 'email', name: 'name' },
      kinds: { note: 'shop-note' },
      classes: { note: 'service' },
      producers: [{ kind: 'note', link: 'member_id', onCreate: { table: 'members' } }],
    },
    emailTemplates: [{ key: 'shop-note', name: 'Note', locales: { 'en-US': { subject: 'A note', blocks: [{ block: 'email.text', data: { text: 'Hello {{recipient.name}}.' } }] } } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`erasing a person by phone, on ${dialect}`, () => {
    let s: WholeServer;
    const lines: string[] = [];
    let bearer: Record<string, string> = {};
    let eventId = '';
    let otherEventId = '';
    let quotedJob = '';
    let otherJob = '';
    const replies: string[] = [];

    const member = async (key: number) => (await s.rows(`SELECT * FROM shop_members WHERE id = ${String(key)}`))[0]!;
    const preview = async (who: string, phone: string) => {
      const res = await s.send(who, 'POST', '/api/v1/privacy/phone/erase/preview', { phone });
      replies.push(res.body);
      return res;
    };
    const erase = async (who: string, phone: string, confirm = phone) => {
      const res = await s.send(who, 'POST', '/api/v1/privacy/phone/erase', { phone, confirm });
      replies.push(res.body);
      return res;
    };
    const hashesOf = async (e164: string) => addressKeyRing(s.meta, TEST_SECRET).hashesOf(textSubject(e164));

    async function seedNumber(e164: string, key: string) {
      const consent = createTextConsentService({ meta: s.meta, secret: TEST_SECRET });
      await consent.record({ phone: e164, purpose: 'text-service', state: 'yes', source: 'form', detail: 'Till', wording: { text: 'Text me about my order', version: 'v1' } });
      const ring = addressKeyRing(s.meta, TEST_SECRET);
      const hash = await ring.hashForWrite(textSubject(e164));
      const { event } = await createInboundEventStore(s.meta).put({ channel: 'sms', account: 'acct', providerId: key.padEnd(64, '0'), source: 'twilio', kind: 'reply', subject: hash, sealedBody: 'enc:v1:sealed', occurredAt: 1, receivedAt: 1 });
      await createTextSendStore(s.meta).create({ claimHash: `claim-${key}`.padEnd(64, '0'), messageHash: `message-${key}`.padEnd(64, '0'), phone: hash, phoneMasked: '+49 ••• 789', textClass: 'service', estimatedSegments: 1, encoding: 'gsm-7', createdAt: 1, reportTarget: null });
      return event.id;
    }

    beforeAll(async () => {
      const logger = pino({ level: 'trace' }, new Writable({ write: (chunk, _encoding, done) => void (lines.push(String(chunk)), done()) }));
      s = await wholeServer(dialect, shop(), { people: { rita: ['rep'], pia: [] }, compose: { logger } });
      const roles = rolesRepo(s.meta);
      const officer = await roles.create({ slug: 'privacy-officer', name: 'Privacy officer' });
      await permissionsRepo(s.meta).grant(officer.id, 'system', 'privacy.manage', { allowed: true });
      await roles.assignToUser(s.ids['pia']!, officer.id);
      const generated = generateApiKey();
      await apiKeysRepo(s.meta).create({ name: 'script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: officer.id });
      bearer = { authorization: `Bearer ${generated.key}` };
      await settingsRepo(s.meta).set('phone.defaultCountry', 'DE', { updatedBy: null });

      await s.rows(
        `INSERT INTO shop_members (id, name, email, phone, notes, reference) VALUES ` +
          `(1, 'Sam Walkin', NULL, '${SAM}', 'Likes oat milk', 'M-1'), ` +
          // The same person's number, written the local way, again with no address.
          `(2, 'S. Walkin', '', '${SAM_TYPED}', 'Second card', 'M-2'), ` +
          // A household's shared line: this row names somebody by address.
          `(3, 'Ben Shared', 'ben@household.example', '${SAM}', 'Keep me', 'M-3'), ` +
          `(4, 'Nora Near', NULL, '${NEAR}', 'A near number', 'M-4'), ` +
          `(5, 'Kim Mail', 'kim@shop.example', '${KIM}', 'Known by address', 'M-5')`,
      );
      await s.rows(`INSERT INTO shop_receipts (id, number, email, phone) VALUES (1, 'R-1', NULL, '${SAM}')`);
      await s.rows(
        `INSERT INTO shop_bookings (id, member_id, guest_email, guest_phone, notes) VALUES ` +
          // An empty address is nobody's: an erasure with no address must not read it as a match.
          `(1, NULL, '', '+4917699999999', 'Another guest'), ` +
          // Taken by phone, no link: the number goes and nothing else.
          `(2, NULL, '', '${SAM_TYPED}', 'Table for two'), ` +
          // Linked to their own row: it is theirs.
          `(3, 1, NULL, '${SAM}', 'Birthday')`,
      );
      await s.rows(
        `INSERT INTO shop_messages (id, kind, status, to_address, member_id) VALUES ` +
          // Waiting, with no recipient yet: an empty \`to\` is nobody's.
          `(1, 'note', 'queued', '', NULL), ` +
          // A text's row, which holds the number in \`to\`.
          `(2, 'note', 'queued', '${SAM}', NULL)`,
      );
      await auditRepo(s.meta).append({ actorKind: 'user', actorId: s.ids['owner']!, actorLabel: 'Owner', category: 'settings', action: 'note.add', changes: { after: { note: 'Unrelated words stay' } } });

      eventId = await seedNumber(SAM, 'sam');
      otherEventId = await seedNumber(NEAR, 'near');
      await seedNumber(KIM, 'kim');
      const jobs = jobsRepo(s.meta);
      quotedJob = (await jobs.enqueue({ kind: 'email.send', payload: {}, runAt: Number.MAX_SAFE_INTEGER })).id;
      otherJob = (await jobs.enqueue({ kind: 'email.send', payload: {}, runAt: Number.MAX_SAFE_INTEGER })).id;
      await s.meta.db.updateTable('adminium_jobs').set({ lastError: `Provider refused 49 151 2345 6789 today` }).where('id', '=', quotedJob).execute();
      await s.meta.db.updateTable('adminium_jobs').set({ lastError: 'Provider refused the request' }).where('id', '=', otherJob).execute();
    }, 180_000);

    afterAll(async () => {
      await s?.close();
    });

    it('is refused to a role without the privacy action, and to an API key', async () => {
      expect(said(await preview('rita', SAM))).toBe('403 FORBIDDEN');
      expect(said(await erase('rita', SAM))).toBe('403 FORBIDDEN');
      const res = await s.app.inject({ method: 'POST', url: '/api/v1/privacy/phone/erase', headers: bearer, payload: { phone: SAM, confirm: SAM } });
      expect(res.statusCode).toBe(403);
      expect((await member(1))['name']).toBe('Sam Walkin');
    });

    it('refuses what is not a number, and a confirmation of another number', async () => {
      expect((await preview('pia', 'not a number')).statusCode).toBe(422);
      expect((await erase('pia', SAM, NEAR)).statusCode).toBe(409);
      expect((await member(1))['name']).toBe('Sam Walkin');
    });

    it('previews what goes and what stays, with the number masked', async () => {
      const res = await preview('pia', SAM_TYPED);
      expect(res.statusCode).toBe(200);
      const data = (res.json() as { data: { address: string; found: boolean; goes: { kind: string; count: number }[]; stays: { kind: string; reason: string; count: number | null }[] } }).data;
      expect(data.address).toBe('+49 ••• 789');
      expect(data.found).toBe(true);
      expect(data.goes.find((item) => item.kind === 'people')?.count).toBe(2);
      expect(data.goes.filter((item) => item.kind === 'copy').reduce((sum, item) => sum + item.count, 0)).toBe(3);
      expect(data.goes.find((item) => item.kind === 'consent')?.count).toBe(1);
      expect(data.goes.find((item) => item.kind === 'text-records')?.count).toBe(2);
      expect(data.stays).toEqual([expect.objectContaining({ kind: 'app-rows', reason: 'tax', count: 1 })]);
      expect((await member(1))['name']).toBe('Sam Walkin');
    });

    it('downloads everything by phone and by address, with the text records of every number on their rows', async () => {
      // A reply kept in a conversation, as the inbound channel hands it over.
      const consent = createTextConsentService({ meta: s.meta, secret: TEST_SECRET });
      const threads = createTextThreads({ meta: s.meta, secret: TEST_SECRET, consent, sms: { view: async () => null }, texts: () => null, business: async () => ({ name: 'Shop' }), zone: async () => null, locale: async () => null, apps: async () => [{ key: 'shop', name: 'Shop', replies: 'on' }] });
      expect(await threads.received({ eventId: 'ibe_sam_reply_1', from: SAM, to: '+14155550100', text: 'Is my order ready?', kind: 'message', at: Date.now(), answered: false })).toBe('kept');
      await consent.stop.add({ phone: SAM, reason: 'staff', origin: 'phone', staff: { id: s.ids['pia']!, label: 'Pia' } });

      const download = async (url: string, body: object): Promise<Record<string, string>> => {
        const asked = await s.send('pia', 'POST', url, body);
        expect(asked.statusCode, asked.body).toBe(202);
        replies.push(asked.body);
        const exportId = (asked.json() as { data: { id: string } }).data.id;
        await s.jobs();
        const file = await s.get('pia', `/api/v1/privacy/exports/${exportId}/download`);
        expect(file.statusCode, file.body).toBe(200);
        return Object.fromEntries(Object.entries(unzipSync(new Uint8Array(file.rawPayload))).map(([name, bytes]) => [name, strFromU8(bytes)]));
      };

      const byPhone = await download('/api/v1/privacy/phone/exports', { phone: SAM_TYPED });
      expect(Object.keys(byPhone).filter((name) => name.endsWith('.json')).sort()).toEqual(expect.arrayContaining(['texts-consent.json', 'texts-deliveries.json', 'texts-messages.json', 'texts-stop-list.json']));
      expect(byPhone['texts-consent.json']).toContain('Text me about my order');
      expect(byPhone['texts-messages.json']).toContain('Is my order ready?');
      expect(byPhone['texts-stop-list.json']).toContain('"reason": "staff"');
      // The rows that hold the number are theirs to see too; a near number is not.
      expect(Object.values(byPhone).join('\n')).toContain('Likes oat milk');
      expect(Object.values(byPhone).join('\n')).not.toContain('A near number');

      const byAddress = await download('/api/v1/privacy/exports', { address: 'kim@shop.example' });
      expect(byAddress['texts-consent.json']).toContain(KIM);
      expect(byAddress['texts-deliveries.json']).toContain(KIM);
      expect(Object.values(byAddress).join('\n')).not.toContain(SAM);

      // A request by phone is refused to a role without the privacy action, and keeps no number in its audit row.
      expect(said(await s.send('rita', 'POST', '/api/v1/privacy/phone/exports', { phone: SAM }))).toBe('403 FORBIDDEN');
      expect(JSON.stringify(await auditRepo(s.meta).list({ limit: 50 }))).not.toContain('15123456789');
    });

    it('erases them, and takes their text records', async () => {
      const res = await erase('pia', SAM_TYPED, SAM);
      expect(res.statusCode, res.body).toBe(200);
      const counts = (res.json() as { data: { counts: Record<string, number> } }).data.counts;
      // The consent rows: the form's yes, and the two noes the stop request the download test recorded wrote.
      expect(counts).toMatchObject({ 'text-stop-list': 1, 'text-consent': 3, 'text-conversations': 2, 'inbound-events': 1, 'text-deliveries': 1, 'text-errors': 1 });

      // Their own rows are emptied and kept.
      for (const key of [1, 2]) {
        const row = await member(key);
        expect(row['name']).not.toMatch(/Walkin/);
        expect(row['phone']).toBeNull();
        expect(row['notes']).toBeNull();
        expect(row['reference']).toBe(`M-${String(key)}`);
      }
      // A shared line: the number goes and nothing else.
      expect(await member(3)).toMatchObject({ name: 'Ben Shared', email: 'ben@household.example', phone: null, notes: 'Keep me' });
      // A near number is somebody else's.
      expect(await member(4)).toMatchObject({ name: 'Nora Near', phone: NEAR, notes: 'A near number' });
      // Their copies: an empty address matches nobody, a number alone takes only the number, a link takes the row's words.
      const bookings = await s.rows(`SELECT id, guest_phone, notes FROM shop_bookings ORDER BY id`);
      expect(bookings.map((row) => [Number(row['id']), row['guest_phone'], row['notes']])).toEqual([
        [1, '+4917699999999', 'Another guest'],
        [2, null, 'Table for two'],
        [3, null, null],
      ]);
      // The outbox: an empty address waits on, and the row holding the number loses it and is skipped.
      const messages = await s.rows(`SELECT id, status, to_address FROM shop_messages ORDER BY id`);
      expect(messages[0]).toMatchObject({ status: 'queued', to_address: '' });
      expect(messages[1]!['status']).toBe('skipped');
      expect(String(messages[1]!['to_address'] ?? '')).not.toContain('15123456789');
      // An entry about something else keeps its words: an erasure with no address sweeps no text.
      const notes = await s.meta.db.selectFrom('adminium_audit_log').select('changes').where('action', '=', 'note.add').execute();
      expect(JSON.stringify(notes)).toContain('Unrelated words stay');
      // The law keeps the receipt whole.
      expect((await s.rows(`SELECT phone FROM shop_receipts WHERE id = 1`))[0]!['phone']).toBe(SAM);

      const { db } = s.meta;
      const hashes = (await hashesOf(SAM)).map((one) => one.hash);
      const stop = await db.selectFrom('adminium_text_stop_list').selectAll().where('phoneHash', 'in', hashes).execute();
      expect(stop).toHaveLength(1);
      // The stop request recorded before keeps its reason, and loses its number.
      expect(stop[0]).toMatchObject({ phoneEncrypted: null, reason: 'staff' });
      expect(await db.selectFrom('adminium_text_consent_log').select('id').where('phoneHash', 'in', hashes).execute()).toEqual([]);
      expect(await db.selectFrom('adminium_text_deliveries').select('id').where('phoneHash', 'in', hashes).execute()).toEqual([]);
      expect(await db.selectFrom('adminium_inbound_events').selectAll().where('id', '=', eventId).executeTakeFirstOrThrow()).toMatchObject({ state: 'erased', sealedBody: null, subjectHash: null });
      expect((await db.selectFrom('adminium_jobs').select('lastError').where('id', '=', quotedJob).executeTakeFirstOrThrow()).lastError).toBeNull();

      // Somebody else's records stay.
      expect((await db.selectFrom('adminium_jobs').select('lastError').where('id', '=', otherJob).executeTakeFirstOrThrow()).lastError).toBe('Provider refused the request');
      expect((await db.selectFrom('adminium_inbound_events').select('state').where('id', '=', otherEventId).executeTakeFirstOrThrow()).state).toBe('pending');
      const near = (await hashesOf(NEAR)).map((one) => one.hash);
      expect(await db.selectFrom('adminium_text_deliveries').select('id').where('phoneHash', 'in', near).execute()).toHaveLength(1);
    });

    it('keeps them stopped: nothing takes an erased number off the list', async () => {
      const consent = createTextConsentService({ meta: s.meta, secret: TEST_SECRET });
      expect(await consent.stop.has(SAM, null)).toBe(true);
      expect(await consent.stop.start({ phone: SAM })).toBe('kept');
    });

    it('can run again and changes nothing', async () => {
      const res = await erase('pia', SAM);
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: { counts: Record<string, number> } }).data.counts['text-consent']).toBeUndefined();
      expect((await s.meta.db.selectFrom('adminium_text_stop_list').select('id').where('phoneHash', 'in', (await hashesOf(SAM)).map((one) => one.hash)).execute())).toHaveLength(1);
    });

    it('an erasure by address takes the text records of the number on their row', async () => {
      const res = await s.send('pia', 'POST', '/api/v1/privacy/erase', { address: 'kim@shop.example', confirm: 'kim@shop.example' });
      expect(res.statusCode, res.body).toBe(200);
      replies.push(res.body);
      expect((res.json() as { data: { counts: Record<string, number> } }).data.counts).toMatchObject({ 'text-stop-list': 1, 'text-consent': 1, 'inbound-events': 1, 'text-deliveries': 1 });
      const hashes = (await hashesOf(KIM)).map((one) => one.hash);
      expect(await s.meta.db.selectFrom('adminium_text_deliveries').select('id').where('phoneHash', 'in', hashes).execute()).toEqual([]);
      expect((await member(5))['phone']).toBeNull();
    });

    it('leaves the number in no reply, log line or audit row', async () => {
      const audit = JSON.stringify(await s.meta.db.selectFrom('adminium_audit_log').selectAll().where('action', 'like', 'privacy.%').execute());
      const haystack = [...replies, ...lines, audit].join('\n');
      for (const digits of [SAM.slice(1), '151 23456789', '15123456789', KIM.slice(1)]) expect(haystack).not.toContain(digits);
    });
  });
}
