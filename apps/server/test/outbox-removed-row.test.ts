// SPDX-License-Identifier: AGPL-3.0-only
/**
 * MAIL ABOUT A ROW THAT IS REMOVED, AND ABOUT ONE THAT MOVED, against the
 * whole server on SQLite, Postgres and MySQL, through an app installed by the
 * real installer (a visit with a contact and a deal, as a sales app books one):
 *
 *  - MOVED: one message, with the old time (`{{was.starts_at}}`) and the new;
 *  - REMOVED (`onDelete`): the row is gone AND one message is written, with
 *    the row's values as they were, to the contact it named; its link to the
 *    row is empty;
 *  - a row with earlier messages (sent, and still waiting) can be removed:
 *    each lets go of it, and the waiting ones are skipped as no longer needed;
 *  - a removal that is refused changes nothing of its messages;
 *  - a bulk removal writes one message a row; a sample row, a row its `where`
 *    leaves out and a row taken back by an undo of its creation write none;
 *  - an address the removed row itself held is written to, from the copy
 *    read as it went;
 *  - a table with no `onDelete` producer is held by its messages as before;
 *  - who reads what is kept: the outbox's own readers, and nobody else.
 */
import { appTablesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { deleteRows } from '../src/crud/write-service.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { LEGS, said, wholeServer, type QueuedEmail, type WholeServer } from './whole-server.helpers.js';

// The server says the version it was built at; the words tried here are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const link = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });
const template = (key: string, subject: string, body: string) => ({ key, name: key, locales: { 'en-US': { subject, blocks: [{ block: 'email.text', data: { text: body } }] } } });
const page = (ref: string, table: string, order: number) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'sales', icon: 'list', order }, bindings: { rows: table } });

const KINDS = ['visit-booked', 'visit-moved', 'visit-follow-up', 'visit-cancelled', 'booking-cancelled', 'deal-opened'];

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.crm.desc', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, text('name', 80)] },
        { ref: 'contacts', columns: [id, text('email', 254), text('name', 80)] },
        { ref: 'deals', columns: [id, text('name', 80)] },
        {
          ref: 'visits',
          belongs: [{ column: 'rep_id', set: 'team' }],
          states: { column: 'state', initial: 'booked', moves: { booked: ['done'] }, noDelete: { when: ['done'] } },
          columns: [
            id,
            link('contact_id', 'contacts'),
            link('deal_id', 'deals'),
            text('rep_id', 36, { rules: { staff: true } }),
            { ref: 'starts_at', type: 'timestamptz', nullable: true },
            text('place', 120),
            { ref: 'state', type: 'enum', enum: ['booked', 'done'], default: 'booked' },
            { ref: 'kind', type: 'enum', enum: ['site', 'call'], default: 'site' },
          ],
        },
        // A row that hangs off a visit, and holds it as the database does.
        { ref: 'notes', columns: [id, link('visit_id', 'visits'), text('said', 200)] },
        // A booking somebody not on file made: the address is on the row itself.
        { ref: 'bookings', columns: [id, text('email', 254), text('name', 80), { ref: 'starts_at', type: 'timestamptz', nullable: true }] },
        {
          ref: 'messages',
          // A log read in part: a message is its rep's, and the outbox itself names none.
          belongs: [{ column: 'rep_id', set: 'team' }],
          columns: [
            id,
            text('rep_id', 36, { rules: { staff: true } }),
            { ref: 'kind', type: 'enum', enum: KINDS },
            { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            link('contact_id', 'contacts'),
            link('visit_id', 'visits'),
            link('deal_id', 'deals'),
            link('booking_id', 'bookings'),
            text('error', 200),
            text('skip_reason', 40),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
            { ref: 'due_at', type: 'timestamptz', nullable: true },
            text('was', 1000),
          ],
        },
      ],
    },
    roles: [
      {
        key: 'rep',
        name: 'Rep',
        permissions: ['app:@:staff', 'table:@visits:read', 'table:@visits:create', 'table:@visits:update', 'table:@visits:delete', 'table:@contacts:read', 'table:@deals:read', 'page:@crm-visits:view'],
        limits: { visits: { rows: { read: { reach: 'own' }, update: { reach: 'own' }, delete: { reach: 'own' } } } },
      },
      { key: 'manager', name: 'Sales manager', permissions: ['app:@:staff', 'table:@visits:read', 'table:@visits:create', 'table:@visits:update', 'table:@visits:delete', 'table:@deals:read', 'table:@deals:delete', 'table:@bookings:read', 'table:@bookings:delete', 'table:@notes:read', 'page:@crm-visits:view'] },
      // A rep who also reads the log, held to the messages that are hers: the outbox names nobody, so she reaches none.
      {
        key: 'rep-log',
        name: 'Rep with the log',
        permissions: ['app:@:staff', 'table:@visits:read', 'table:@visits:create', 'table:@visits:update', 'table:@visits:delete', 'table:@contacts:read', 'table:@deals:read', 'table:@messages:read'],
        limits: { visits: { rows: { read: { reach: 'own' }, update: { reach: 'own' }, delete: { reach: 'own' } } }, messages: { rows: { read: { reach: 'own' } } } },
      },
      // Reads the log of what was sent, and no visit.
      { key: 'desk', name: 'Front desk', permissions: ['app:@:staff', 'table:@messages:read', 'page:@crm-messages:view'] },
      // Reads the contacts, and neither the visits nor the log.
      { key: 'marketer', name: 'Marketer', permissions: ['app:@:staff', 'table:@contacts:read'] },
    ],
    pages: [page('crm-visits', 'visits', 1), page('crm-messages', 'messages', 2)],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', skipReason: 'skip_reason', sentAt: 'sent_at', due: 'due_at', was: 'was' },
      links: { visit: 'visit_id', deal: 'deal_id', contact: 'contact_id', booking: 'booking_id' },
      recipient: { via: 'contact_id', table: 'contacts', email: 'email', name: 'name' },
      settings: { table: 'settings', name: 'name' },
      kinds: Object.fromEntries(KINDS.map((kind) => [kind, `crm-${kind}`])),
      producers: [
        { kind: 'visit-booked', link: 'visit_id', onCreate: { table: 'visits' } },
        // A reminder that waits an hour: still waiting when its visit is called off.
        { kind: 'visit-follow-up', link: 'visit_id', holdSeconds: 3600, onCreate: { table: 'visits' } },
        { kind: 'visit-moved', link: 'visit_id', repeat: true, was: ['starts_at'], onChange: { table: 'visits', columns: ['starts_at'], changed: true } },
        { kind: 'visit-cancelled', link: 'visit_id', was: ['starts_at', 'place'], onDelete: { table: 'visits', where: { column: 'kind', eq: 'site' } } },
        { kind: 'booking-cancelled', link: 'booking_id', recipient: { column: 'email', name: 'name' }, was: ['starts_at'], onDelete: { table: 'bookings' } },
        // A table nobody is written to about the removal of: its messages hold its rows, as they always did.
        { kind: 'deal-opened', link: 'deal_id', recipient: { setting: { table: 'settings', column: 'name' } }, onCreate: { table: 'deals' } },
      ],
    },
    emailTemplates: [
      template('crm-visit-booked', 'Your visit is booked', 'We will see you at {{visit.place}}.'),
      template('crm-visit-follow-up', 'About your visit', 'How was the visit at {{visit.place}}?'),
      template('crm-visit-moved', 'Your visit has moved', 'It was on {{was.starts_at.date}} at {{was.starts_at.time}}. It is now on {{visit.starts_at.date}} at {{visit.starts_at.time}}, at {{visit.place}}.'),
      template('crm-visit-cancelled', 'Your visit is cancelled', 'Hello {{recipient.first_name}}, the visit on {{was.starts_at.date}} at {{was.starts_at.time}} at {{was.place}} about {{deal.name}} is cancelled.'),
      template('crm-booking-cancelled', 'Your booking is cancelled', 'Hello{{recipient.first_name}}, the booking on {{was.starts_at.date}} is cancelled.'),
      template('crm-deal-opened', 'A deal', 'A deal was opened: {{deal.name}}.'),
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

type Message = { id: number; kind: string; status: string; to_address: string | null; contact_id: number | null; visit_id: number | null; deal_id: number | null; booking_id: number | null; error: string | null; skip_reason: string | null; was: string | null };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`mail about a row that is removed, on ${dialect}`, () => {
    let s: WholeServer;
    const data = (ref: string, rest = '') => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    /** Every message of the log, oldest first, with numbers as numbers on every engine. */
    const messages = async (where = '1 = 1'): Promise<Message[]> =>
      (await s.rows(`SELECT id, kind, status, to_address, contact_id, visit_id, deal_id, booking_id, error, skip_reason, was FROM crm_messages WHERE ${where} ORDER BY id`)).map((row) => ({
        ...(row as unknown as Message),
        id: Number(row['id']),
        ...Object.fromEntries(['contact_id', 'visit_id', 'deal_id', 'booking_id'].map((column) => [column, row[column] === null ? null : Number(row[column])])),
      }));
    const made = async (who: string, values: Record<string, unknown>, ref = 'visits'): Promise<{ id: number; undoToken: string | null }> => {
      const res = await s.make(who, ref, values);
      expect(res.statusCode, res.body).toBeLessThan(300);
      const body = res.json() as { data: { id: number }; undoToken?: string | null };
      return { id: Number(body.data.id), undoToken: body.undoToken ?? null };
    };
    const visit = async (who: string, more: Record<string, unknown> = {}): Promise<number> =>
      (await made(who, { contact_id: 1, deal_id: 1, rep_id: s.ids[who === 'owner' || who === 'ivy' ? 'dana' : who]!, starts_at: '2030-03-04T10:00:00.000Z', place: 'Harbour Road 12', ...more })).id;
    const remove = (who: string, ref: string, key: number) => s.send(who, 'DELETE', data(ref, `/${String(key)}?confirm=true`));
    const there = async (ref: string, key: number): Promise<boolean> => (await s.rows(`SELECT id FROM crm_${ref} WHERE id = ${String(key)}`)).length === 1;
    /** Send what the outbox holds that is due, and hand back the mail it made. */
    const sent = async (): Promise<QueuedEmail[]> => {
      await s.app.outboxSender.sendApp('crm', Date.now());
      return s.emails();
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { dana: ['rep'], omar: ['rep'], rae: ['rep-log'], ivy: ['manager'], dee: ['desk'], mia: ['marketer'] }, smtp: true });
      await s.rows(`INSERT INTO crm_settings (id, name) VALUES (1, 'Harbour Sales')`);
      await s.rows(`INSERT INTO crm_contacts (id, email, name) VALUES (1, 'bo@buyer.dev', 'Bo Buyer'), (2, NULL, 'No Address')`);
      await s.rows(`INSERT INTO crm_deals (id, name) VALUES (1, 'Atrium fit-out'), (2, 'Quay office')`);
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('a visit moved: one message, with the old time and the new', async () => {
      const key = await visit('dana');
      await sent();
      expect(said(await s.change('dana', 'visits', key, { starts_at: '2030-03-11T14:30:00.000Z' }))).toBe('ok');
      const moved = await messages(`visit_id = ${String(key)} AND kind = 'visit-moved'`);
      expect(moved).toHaveLength(1);
      expect(JSON.parse(moved[0]!.was!)).toEqual({ starts_at: '2030-03-04T10:00:00.000Z' });
      const mail = (await sent()).filter((one) => one.templateKey === 'crm-visit-moved');
      expect(mail).toHaveLength(1);
      expect(mail[0]!.to).toBe('bo@buyer.dev');
      // The old day and hour, then the new: both in the one mail.
      expect(mail[0]!.text).toMatch(/It was on Monday, March 4, 2030 at \d{1,2}:00.*\. It is now on Monday, March 11, 2030 at \d{1,2}:30.*, at Harbour Road 12\./s);
      // A change that moves no time writes nothing more.
      expect(said(await s.change('dana', 'visits', key, { place: 'Harbour Road 14' }))).toBe('ok');
      expect(await messages(`visit_id = ${String(key)} AND kind = 'visit-moved'`)).toHaveLength(1);
    });

    it('a visit removed: the row is gone, and one message says so with its values as they were', async () => {
      const key = await visit('dana', { starts_at: '2030-05-06T09:15:00.000Z', place: 'Mill Lane 3' });
      await sent();
      const before = (await messages()).length;
      expect(said(await remove('dana', 'visits', key))).toBe('ok');
      expect(await there('visits', key)).toBe(false);
      const after = await messages();
      const written = after.filter((one) => one.kind === 'visit-cancelled' && one.id > 0).slice(-1);
      expect(after.length).toBe(before + 1);
      // It names no row (there is none), and still the contact and the deal the row named.
      expect(written[0]).toMatchObject({ kind: 'visit-cancelled', status: 'queued', to_address: 'bo@buyer.dev', visit_id: null, contact_id: 1, deal_id: 1 });
      // Only the columns the producer lists are kept.
      expect(JSON.parse(written[0]!.was!)).toEqual({ starts_at: '2030-05-06T09:15:00.000Z', place: 'Mill Lane 3' });
      const mail = (await sent()).filter((one) => one.templateKey === 'crm-visit-cancelled');
      expect(mail).toHaveLength(1);
      expect(mail[0]!.to).toBe('bo@buyer.dev');
      expect(mail[0]!.text).toMatch(/Hello Bo, the visit on Monday, May 6, 2030 at \d{1,2}:15.* at Mill Lane 3 about Atrium fit-out is cancelled\./s);
      expect((await messages(`id = ${String(written[0]!.id)}`))[0]).toMatchObject({ status: 'sent', visit_id: null });
    });

    it('a visit with earlier messages can be removed: each lets go of it, and one still waiting is skipped as no longer needed', async () => {
      const key = await visit('dana');
      await sent();
      expect(said(await s.change('dana', 'visits', key, { starts_at: '2030-03-12T08:00:00.000Z' }))).toBe('ok');
      await sent();
      const earlier = await messages(`visit_id = ${String(key)}`);
      expect(earlier.map((one) => [one.kind, one.status])).toEqual([['visit-booked', 'sent'], ['visit-follow-up', 'queued'], ['visit-moved', 'sent']]);
      expect(said(await remove('dana', 'visits', key))).toBe('ok');
      expect(await there('visits', key)).toBe(false);
      const ids = earlier.map((one) => String(one.id)).join(', ');
      expect((await messages(`id IN (${ids})`)).map((one) => [one.kind, one.status, one.visit_id, one.skip_reason])).toEqual([
        ['visit-booked', 'sent', null, null],
        ['visit-follow-up', 'skipped', null, 'no-longer-needed'],
        ['visit-moved', 'sent', null, null],
      ]);
      // What a sent message kept of the row stays with it.
      expect(JSON.parse((await messages(`id = ${String(earlier[2]!.id)}`))[0]!.was!)).toEqual({ starts_at: '2030-03-04T10:00:00.000Z' });
      // The skipped reminder is never sent; the cancellation is, once.
      const mail = await sent();
      expect(mail.map((one) => one.templateKey)).toEqual(['crm-visit-cancelled']);
    });

    it('a removal that is refused leaves the row and every message about it as they were', async () => {
      // Done: the table's own states refuse it, for the admin too.
      const done = await visit('dana');
      expect(said(await s.change('dana', 'visits', done, { state: 'done' }))).toBe('ok');
      // Held by a note: the database refuses it.
      const noted = await visit('dana');
      await s.rows(`INSERT INTO crm_notes (id, visit_id, said) VALUES (${String(noted)}, ${String(noted)}, 'Measured the hall')`);
      await sent();
      for (const key of [done, noted]) {
        const before = await messages(`visit_id = ${String(key)}`);
        expect(before.length).toBeGreaterThanOrEqual(2);
        const count = (await messages()).length;
        for (const who of ['dana', 'owner']) expect((await remove(who, 'visits', key)).statusCode, `${who} ${String(key)}`).toBeGreaterThanOrEqual(400);
        // Somebody else's visit: out of a rep's reach, and answered as a row that is not there.
        expect((await remove('omar', 'visits', key)).statusCode).toBe(404);
        expect((await remove('mia', 'visits', key)).statusCode).toBe(403);
        expect(await there('visits', key)).toBe(true);
        expect(await messages(`visit_id = ${String(key)}`)).toEqual(before);
        expect((await messages()).length).toBe(count);
      }
    });

    it('puts a message’s link and status back when the statement removes no row', async () => {
      const key = await visit('dana');
      const before = await messages(`visit_id = ${String(key)}`);
      expect(before.map((one) => one.status)).toEqual(['queued', 'queued']);
      const view = (await loadSnapshotView(s.meta, s.connectionId))!;
      const handle = await s.manager.data(s.connectionId);
      const links = await s.app.outbox.releasing!(s.connectionId, s.t('visits'));
      expect(links.map((one) => one.link)).toEqual(['visit_id']);
      // A scope the row is outside of: nothing is removed, and nothing of its messages is changed.
      const removed = await deleteRows(handle.db as never, view.table(s.t('visits')), { id: key }, (query) => query.where('place' as never, '=', 'Nowhere' as never) as never, undefined, links);
      expect(removed).toBe(0);
      expect(await messages(`visit_id = ${String(key)}`)).toEqual(before);
      // Without the scope it goes, and they let go.
      expect(await deleteRows(handle.db as never, view.table(s.t('visits')), { id: key }, undefined, undefined, links)).toBe(1);
      expect((await messages(`id IN (${before.map((one) => String(one.id)).join(', ')})`)).map((one) => [one.status, one.visit_id])).toEqual([['skipped', null], ['skipped', null]]);
    });

    it('a bulk removal writes one message a row', async () => {
      const keys = [await visit('dana'), await visit('dana'), await visit('dana')];
      await sent();
      const before = (await messages(`kind = 'visit-cancelled'`)).length;
      const res = await s.send('ivy', 'POST', data('visits', '/bulk'), { action: 'delete', ids: keys });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { results: { ok: boolean }[] }).results.map((one) => one.ok)).toEqual([true, true, true]);
      for (const key of keys) expect(await there('visits', key)).toBe(false);
      const written = (await messages(`kind = 'visit-cancelled'`)).slice(before);
      expect(written.map((one) => [one.status, one.visit_id, one.contact_id])).toEqual([['queued', null, 1], ['queued', null, 1], ['queued', null, 1]]);
      expect((await sent()).filter((one) => one.templateKey === 'crm-visit-cancelled')).toHaveLength(3);
    });

    it('writes no message for a sample row, nor for a row its condition leaves out, and lets both go', async () => {
      const call = await visit('dana', { kind: 'call' });
      const sample = await visit('dana');
      // The app's sample ledger lists the second.
      await s.rows(`CREATE TABLE crm_sample_rows (seq INTEGER PRIMARY KEY, table_ref VARCHAR(64) NOT NULL, pk VARCHAR(200) NOT NULL)`);
      await s.rows(`INSERT INTO crm_sample_rows (seq, table_ref, pk) VALUES (1, 'visits', '{"id":${String(sample)}}')`);
      await appTablesRepo(s.meta).record({ appKey: 'crm', manifestId: null, connectionId: s.connectionId, ref: 'sample_data', tableName: 'crm_sample_rows', owned: true, state: 'created', role: 'sample-ledger' });
      try {
        await sent();
        const before = (await messages(`kind = 'visit-cancelled'`)).length;
        expect(said(await remove('dana', 'visits', call))).toBe('ok');
        expect(said(await remove('dana', 'visits', sample))).toBe('ok');
        expect(await there('visits', call)).toBe(false);
        expect(await there('visits', sample)).toBe(false);
        expect((await messages(`kind = 'visit-cancelled'`)).length).toBe(before);
        expect((await sent()).filter((one) => one.templateKey === 'crm-visit-cancelled')).toEqual([]);
      } finally {
        await s.rows(`DELETE FROM crm_sample_rows`);
      }
    });

    it('a visit with nobody to write to is removed, and the log says why nothing went', async () => {
      const key = await visit('dana', { contact_id: 2 });
      expect(said(await remove('dana', 'visits', key))).toBe('ok');
      const [written] = (await messages(`kind = 'visit-cancelled'`)).slice(-1);
      expect(written).toMatchObject({ status: 'skipped', error: 'No email on file', visit_id: null, contact_id: 2 });
    });

    // A table that keeps states offers no Undo, so these two are tried on the bookings, which keep none.
    it('a row made by mistake and taken back writes no cancellation, and a message about it lets go of it', async () => {
      const { id: key, undoToken } = await made('owner', { email: 'slip@visitor.dev', name: 'Sam Slip', starts_at: '2030-07-08T12:00:00.000Z' }, 'bookings');
      expect(undoToken).not.toBeNull();
      await s.rows(`INSERT INTO crm_messages (kind, status, to_address, booking_id) VALUES ('booking-cancelled', 'queued', 'slip@visitor.dev', ${String(key)})`);
      const before = (await messages(`kind = 'booking-cancelled'`)).length;
      expect(said(await s.send('owner', 'POST', `/api/v1/data/undo/${undoToken!}`))).toBe('ok');
      expect(await there('bookings', key)).toBe(false);
      const after = await messages(`kind = 'booking-cancelled'`);
      expect(after.length).toBe(before);
      expect(after.slice(-1)[0]).toMatchObject({ status: 'skipped', booking_id: null, skip_reason: 'no-longer-needed' });
      expect((await sent()).filter((one) => one.templateKey === 'crm-booking-cancelled')).toEqual([]);
    });

    it('a removal undone puts the row back; the message already written about it stands (said, not taken back)', async () => {
      const { id: key } = await made('owner', { email: 'back@visitor.dev', name: 'Bea Back', starts_at: '2030-07-08T12:00:00.000Z' }, 'bookings');
      const res = await remove('owner', 'bookings', key);
      expect(said(res)).toBe('ok');
      const token = (res.json() as { undoToken: string | null }).undoToken;
      expect(token).not.toBeNull();
      expect(said(await s.send('owner', 'POST', `/api/v1/data/undo/${token!}`))).toBe('ok');
      expect(await there('bookings', key)).toBe(true);
      const [written] = (await messages(`kind = 'booking-cancelled'`)).slice(-1);
      expect(written).toMatchObject({ status: 'queued', booking_id: null, to_address: 'back@visitor.dev' });
      // The row is back under its key, and no message names it again.
      expect(await messages(`booking_id = ${String(key)}`)).toEqual([]);
      await sent();
      await s.rows(`DELETE FROM crm_bookings WHERE id = ${String(key)}`);
    });

    it('writes to the address the removed row itself held, read as it went, and greets nobody by a name it did not keep', async () => {
      const { id: walkIn } = await made('owner', { email: 'walk.in@visitor.dev', name: 'Wim Walker', starts_at: '2030-07-08T12:00:00.000Z' }, 'bookings');
      expect(said(await remove('ivy', 'bookings', walkIn))).toBe('ok');
      expect(await there('bookings', walkIn)).toBe(false);
      const [written] = (await messages(`kind = 'booking-cancelled'`)).slice(-1);
      expect(written).toMatchObject({ status: 'queued', to_address: 'walk.in@visitor.dev', booking_id: null, contact_id: null });
      // The time is kept; the address is the message's own; the name is kept nowhere.
      expect(Object.keys(JSON.parse(written!.was!))).toEqual(['starts_at']);
      expect(JSON.stringify(written)).not.toContain('Wim');
      const mail = (await sent()).filter((one) => one.templateKey === 'crm-booking-cancelled');
      expect(mail).toHaveLength(1);
      expect(mail[0]!.to).toBe('walk.in@visitor.dev');
      expect(mail[0]!.text).toMatch(/^Hello, the booking on .*\b8\b.*2030.* is cancelled\./s);
      expect(mail[0]!.text).not.toContain('Wim');
    });

    it('a table nobody is written to about the removal of is still held by its messages', async () => {
      const key = 50;
      await s.rows(`INSERT INTO crm_deals (id, name) VALUES (50, 'Pier works')`);
      await s.rows(`INSERT INTO crm_messages (kind, status, to_address, deal_id) VALUES ('deal-opened', 'sent', 'sales@harbour.dev', 50)`);
      expect((await remove('ivy', 'deals', key)).statusCode).toBe(409);
      expect(await there('deals', key)).toBe(true);
      expect((await messages(`deal_id = ${String(key)}`)).map((one) => one.kind)).toEqual(['deal-opened']);
      expect(await s.app.outbox.releasing!(s.connectionId, s.t('deals'))).toEqual([]);
    });

    it('what is kept of a removed row is read by the outbox’s own readers, and by nobody else', async () => {
      const key = await visit('dana', { place: 'Granary Wharf 9' });
      expect(said(await remove('dana', 'visits', key))).toBe('ok');
      // The front desk reads the log: the message, with what it kept.
      const desk = await s.get('dee', data('messages', '?limit=200'));
      expect(desk.statusCode, desk.body).toBe(200);
      expect(desk.body).toContain('Granary Wharf 9');
      // The front desk reads no visit, removed or not.
      expect((await s.get('dee', data('visits'))).statusCode).toBe(403);
      // The rep who removed it, another rep and the marketer read no log: nothing of the removed row comes back to them through it.
      for (const who of ['dana', 'omar', 'mia']) {
        const res = await s.get(who, data('messages', '?limit=200'));
        expect(res.statusCode, who).toBe(403);
        expect(res.body, who).not.toContain('Granary');
        expect((await s.get(who, data('messages', `/${String((await messages(`kind = 'visit-cancelled'`)).slice(-1)[0]!.id)}`))).statusCode, who).toBe(403);
      }
      // …nor through the visits, where another rep never read it and it is gone for all.
      for (const who of ['dana', 'omar']) expect((await s.get(who, data('visits', `/${String(key)}`))).statusCode, who).toBe(404);
      await sent();
    });

    it('somebody who reads the log only in part removes her own visit like anyone, and is told nothing of the messages she does not reach', async () => {
      const key = await visit('rae', { place: 'Tannery Yard 2' });
      await sent();
      // Two messages name her visit, and she reaches neither.
      expect((await messages(`visit_id = ${String(key)}`)).length).toBe(2);
      const listed = async (): Promise<unknown[]> => {
        const res = await s.get('rae', data('messages', '?limit=200'));
        expect(res.statusCode, res.body).toBe(200);
        expect(res.body).not.toContain('Tannery');
        return (res.json() as { data: unknown[] }).data;
      };
      expect(await listed()).toEqual([]);
      // The same answer as for a visit no message names: nothing says whether any is there.
      const bare = await visit('rae');
      await s.rows(`DELETE FROM crm_messages WHERE visit_id = ${String(bare)}`);
      expect(said(await remove('rae', 'visits', bare))).toBe('ok');
      expect(said(await remove('rae', 'visits', key))).toBe('ok');
      expect(await there('visits', key)).toBe(false);
      // What the cancellation kept is in the log, and still out of her reach.
      expect((await messages(`kind = 'visit-cancelled'`)).slice(-1)[0]!.was).toContain('Tannery Yard 2');
      expect(await listed()).toEqual([]);
      await sent();
    });
  });
}
