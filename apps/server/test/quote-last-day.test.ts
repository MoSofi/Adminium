// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A QUOTE'S LAST DAY, AND WHO DECIDED IT — on a table built on an add-on's
 * shape, for every writer, on SQLite, Postgres and MySQL.
 *
 * The app holds the shape's moves sent → accepted and sent → declined to the
 * quote's `valid_until` (`requires.notPast`). The day is the BUSINESS's: the
 * zone the install runs in, not UTC and not the caller's.
 *
 *  - a staff member's own late "accepted" is refused (`STATE_DATE_PASSED`),
 *    whichever door it comes by: the dashboard, a bulk edit, an import of a
 *    row already there, a rule, a record's action, another row's effect;
 *  - a date sent with the move does not open it again; a quote with no date
 *    is held to none; the last day itself is still in time;
 *  - the customer's link still opens the quote after the day, and its Accept
 *    and Decline are refused: by the entry's own `from-today` on one key, by
 *    the move's last day on a key that declares no date at all;
 *  - who decided is stamped by Adminium in a column nobody writes: the staff
 *    member's id, or `link` for the customer;
 *  - the name typed with an Accept is asked for then and only then
 *    (`requiresWhen`), held to a name's plain text and its length;
 *  - a second Accept, and an Accept after a Decline, are judged on the stored
 *    state and refused.
 */
import { readFileSync } from 'node:fs';

import { manifestsRepo, publicEndpointsRepo, publicKeysRepo, type MetaDb } from '@adminium/meta';
import { shapeConformanceIssues, shapeKey, validateManifest, type ShapeDefinitionView } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mapTableRefs } from '../src/apps/real-refs.js';
import type { WriteContext } from '../src/crud/write-service.js';
import { venueClock } from '../src/crud/venue-time.js';
import { appManifest } from './app-add-ons.helpers.js';
import { LEGS, installInvoicing, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';

type Doc = Record<string, unknown>;
const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };
const invoicesAddOn = (): Doc => ({ ...(JSON.parse(readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8')) as Doc), version: '1.1.0' });

/** Two zones a day apart at every instant: the calendar of one is always behind the other's. */
const BEHIND = 'Etc/GMT+12';
const AHEAD = 'Pacific/Kiritimati';
/**
 * The zone the install is in for the customer's writes: whichever of the two is on another day than UTC right now (one
 * of them always is). A quote good until the earlier of the two days is then late where the business is and in time by
 * UTC, or the other way round — so a judge that read UTC's day would answer the opposite.
 */
const HERE = venueClock(new Date(), AHEAD).day !== venueClock(new Date(), 'UTC').day ? AHEAD : BEHIND;
const dayIn = (zone: string) => venueClock(new Date(), zone).day;
const plusDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A part of the quote shape, spelled out as the app's own table, with what the app adds to its columns and its states. */
function tableOnPart(part: string, ref: string, extra: Doc[] = [], states: (shape: Doc) => Doc = (shape) => shape): Doc {
  const names: Record<string, string> = { document: 'quotes', lines: 'quote_lines' };
  const shape = (invoicesAddOn()['addOn'] as { shapes: Doc[] }).shapes.find((one) => one['name'] === 'quote')!;
  const def = (shape['parts'] as Record<string, { columns: Doc[]; states?: Doc }>)[part]!;
  const map = (short: string) => names[short] ?? short;
  const columns = def.columns.map((column) => {
    const rules = column['rules'] as Doc | undefined;
    return {
      ...column,
      ...(typeof column['references'] === 'string' ? { references: map(column['references']) } : {}),
      ...(rules === undefined ? {} : { rules: Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, name === 'rollup' ? mapTableRefs(rule, map, { refKeys: ['from'] }).value : mapTableRefs(rule, map).value])) }),
    };
  });
  return { ref, module: 'selling', builtOn: 'invoices/quote@1', part, columns: [...columns, ...extra], ...(def.states === undefined ? {} : { states: states(mapTableRefs(def.states, map).value as Doc) }) };
}

/** The shape's states with the app's last day on Accept and Decline, and its own columns left open to the lock. */
const withLastDay = (shape: Doc): Doc => {
  const moves = shape['moves'] as Record<string, unknown[]>;
  const lock = shape['lock'] as { when: string[]; except: string[] };
  return {
    ...shape,
    moves: { ...moves, sent: [{ to: 'accepted', requires: { notPast: 'valid_until' } }, { to: 'declined', requires: { notPast: 'valid_until' } }, 'withdrawn'] },
    lock: { ...lock, except: [...lock.except, 'accepted_name'] },
  };
};

const quoteEntry = (key: string, column: string, more: Doc = {}): Doc => ({
  table: 'quotes',
  key,
  methods: ['GET', 'PATCH'],
  claim: { by: 'token', column, own: true, address: 'sent_to_email' },
  select: ['id', 'status', 'valid_until', 'accepted_name', 'decided_by'],
  writable: ['status', 'accepted_name'],
  writableValues: { status: ['accepted', 'declined'] },
  writableWhen: { status: ['sent'] },
  requiresWhen: { accepted_name: { status: ['accepted'] } },
  ...more,
});

function crm(): Doc {
  return appManifest('crm', {
    version: '0.2.0',
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    addOns: { requires: [{ key: 'invoices', range: '>=1.1.0', reason: en('Quotes are made by this add-on.') }] },
    modules: [{ id: 'selling', label: en('Selling'), default: 'always' }],
    requiredSchema: {
      prefixed: true,
      tables: [
        tableOnPart(
          'document',
          'quotes',
          [
            { ref: 'sent_to_email', type: 'text', maxLength: 254, nullable: true },
            { ref: 'share_code', type: 'text', maxLength: 16, nullable: true, unique: true, rules: { code: { length: 16 } } },
            // A second link of the row, on a key that declares no date: only the move's own last day stands there.
            { ref: 'bare_code', type: 'text', maxLength: 16, nullable: true, unique: true, rules: { code: { length: 16 } } },
            { ref: 'accepted_name', type: 'text', maxLength: 120, nullable: true, rules: { plainText: { max: 60 } } },
            // Who decided: the staff member, or the customer's link. Nobody writes it.
            { ref: 'decided_by', type: 'text', maxLength: 36, nullable: true, rules: { stamp: { set: { byOrigin: { public: 'link', staff: 'user-id' } }, on: { column: 'status', values: ['accepted', 'declined'] } } } },
          ],
          withLastDay,
        ),
        tableOnPart('lines', 'quote_lines'),
        // An order placed moves its quote to accepted: another row's effect is a writer too.
        {
          ref: 'orders',
          module: 'selling',
          columns: [id, { ref: 'quote_id', type: 'fk', references: 'quotes' }, { ref: 'status', type: 'enum', enum: ['new', 'placed'], default: 'new' }],
          states: { column: 'status', initial: 'new', moves: { new: ['placed'] }, effects: [{ on: { to: 'placed' }, via: 'quote_id', set: { status: 'accepted' } }] },
        },
      ],
    },
    publicKeys: { quote: {}, bare: {} },
    publicAccess: [quoteEntry('quote', 'share_code', { writableWhen: { status: ['sent'], valid_until: 'from-today' } }), quoteEntry('bare', 'bare_code')],
    roles: [{ key: 'rep', name: 'Sales rep', modules: ['selling'], permissions: ['table:@quotes:read', 'page:@crm-quotes:view'] }],
    pages: [{ ref: 'crm-quotes', template: 'page-crud', title: { key: 't.crm-quotes', fallback: 'Quotes' }, nav: { group: 'manifest:sample', icon: 'list', order: 1 }, bindings: { rows: 'quotes' }, module: 'selling' }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  });
}

async function invoices(meta: MetaDb): Promise<void> {
  const document = invoicesAddOn();
  const addOn = document['addOn'] as { attaches?: { app: string }[] };
  addOn.attaches = [...(addOn.attaches ?? []).filter((one) => one.app !== 'crm'), { app: 'crm' }];
  await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({ manifestKey: 'invoices', version: '1.1.0', kind: 'add-on', source: 'file', document: document as never });
}

describe('the words, as the validator reads them', () => {
  const issuesOf = (manifest: Doc) => {
    const result = validateManifest(manifest);
    return result.ok ? [] : result.issues.map((issue) => issue.message);
  };
  const quotes = (manifest: Doc) => (manifest['requiredSchema'] as { tables: Doc[] }).tables[0]!;

  it('the fixture is a valid app', () => {
    expect(issuesOf(crm())).toEqual([]);
  });

  it('an app may give a shape\'s move a last day, on a date column only, and nothing else of the move', () => {
    const notADate = crm();
    ((quotes(notADate)['states'] as { moves: Record<string, unknown[]> }).moves['sent']![0] as Doc)['requires'] = { notPast: 'withdraw_reason' };
    expect(issuesOf(notADate).join('\n')).toContain('"quotes.withdraw_reason" is not a date');
    const unknown = crm();
    ((quotes(unknown)['states'] as { moves: Record<string, unknown[]> }).moves['sent']![0] as Doc)['requires'] = { notPast: 'nope' };
    expect(issuesOf(unknown).join('\n')).toContain('"quotes" has no column "nope"');
    // Against the shape itself: the last day is the app's to add, a condition on the shape's own column is not.
    const shapes = new Map(((invoicesAddOn()['addOn'] as { shapes: ShapeDefinitionView[] }).shapes ?? []).map((shape) => [shapeKey('invoices', shape), shape]));
    expect(shapeConformanceIssues(crm() as never, shapes)).toEqual([]);
    const reads = crm();
    ((quotes(reads)['states'] as { moves: Record<string, unknown[]> }).moves['sent']![0] as Doc)['requires'] = { notPast: 'valid_until', where: [{ column: 'total', gt: 5 }] };
    expect(shapeConformanceIssues(reads as never, shapes).map((issue) => issue.message).join('\n')).toContain('reads a column the app added, never total');
    // A move the shape does not have is not made by giving it a last day.
    const more = crm();
    (quotes(more)['states'] as { moves: Record<string, unknown[]> }).moves['accepted'] = [{ to: 'sent', requires: { notPast: 'valid_until' } }];
    expect(shapeConformanceIssues(more as never, shapes).map((issue) => issue.message).join('\n')).toContain('the moves between states are the shape\'s');
  });

  it('a column asked for with some values is written here, with values the other column may take', () => {
    const entry = (manifest: Doc) => (manifest['publicAccess'] as Doc[])[1]!;
    const loose = crm();
    delete entry(loose)['writableValues'];
    expect(issuesOf(loose).join('\n')).toContain('list the values it may take (writableValues)');
    const other = crm();
    entry(other)['requiresWhen'] = { accepted_name: { status: ['withdrawn'] } };
    expect(issuesOf(other).join('\n')).toContain('"withdrawn" is not a value a write here may give "status"');
    const both = crm();
    entry(both)['requires'] = ['accepted_name'];
    expect(issuesOf(both).join('\n')).toContain('required by every write already');
    // The date a move is held to is not a guest's to write.
    const dated = crm();
    entry(dated)['writable'] = ['status', 'accepted_name', 'valid_until'];
    expect(issuesOf(dated).join('\n')).toContain('"valid_until" is the last day of a move of "quotes", so a write through this entry may not set it');
    const floor = crm();
    (floor['compatibility'] as Doc)['minAdminiumVersion'] = '0.3.27';
    expect(issuesOf(floor).join('\n')).toMatch(/0\.3\.28/);
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a quote's last day and who decided it, on ${dialect}`, () => {
    let h: InvoicingHarness;
    let byQuote: Served;
    let byBare: Served;
    let refs: { quote: string; bare: string };
    let n = 0;
    beforeAll(async () => {
      h = await installInvoicing(dialect, crm(), invoices, {}, { install: { addOns: [{ key: 'invoices', version: '1.1.0' }] } });
      // Where the business is, for the customer's writes: the install's own zone, set before its keys are first read.
      await h.meta.db.updateTable('adminium_connections').set({ timezone: HERE }).where('id', '=', h.connectionId).execute();
      const keys = await publicKeysRepo(h.meta).listManagedBy('crm');
      byQuote = await servePublic(h, keys.find((key) => key.purpose === 'quote')!.id);
      byBare = await servePublic(h, keys.find((key) => key.purpose === 'bare')!.id);
      const endpoints = await publicEndpointsRepo(h.meta).listByConnection(h.connectionId);
      const refOf = (column: string) => endpoints.find((row) => row.definition.includes(column))!.ref;
      refs = { quote: refOf('share_code'), bare: refOf('bare_code') };
    }, 240_000);
    afterAll(async () => {
      await byQuote?.close();
      await byBare?.close();
      await h?.close();
    });

    const rowOf = async (key: unknown) => (await h.rows(`SELECT status, accepted_name, decided_by FROM ${h.real('quotes')} WHERE id = ${String(key)}`))[0]!;
    const statusOf = async (key: unknown) => String((await rowOf(key))['status']);
    const codeOf = async (attempt: Promise<unknown>) =>
      attempt.then(
        () => 'written',
        (error: { code?: string }) => error.code ?? String(error),
      );

    /** A sent quote good until `until` (null: no date), with both of its links' codes. */
    async function sentQuote(until: string | null): Promise<{ id: unknown; share: string; bare: string }> {
      const w = await writerFor(h, BEHIND);
      const made = await w.create('quotes', { ...(until === null ? {} : { valid_until: until }), sent_to_email: 'buyer@example.com' });
      await w.create('quote_lines', { document_id: made['id'], qty: 2, rate: 100 });
      await w.update('quotes', made['id'], { status: 'sent' });
      n += 1;
      const tail = String(n).padStart(4, '0').replace(/0/g, 'Z').replace(/1/g, 'Y');
      const [share, bare] = [`SHAREQTESHAR${tail}`, `BAREQTEBAREQ${tail}`];
      await h.rows(`UPDATE ${h.real('quotes')} SET share_code = '${share}', bare_code = '${bare}' WHERE id = ${String(made['id'])}`);
      return { id: made['id'], share, bare };
    }
    let ip = 0;
    const from = () => `10.9.${String((ip >> 8) & 255)}.${String((ip += 1) & 255)}`;
    const open = async (served: Served, token: string) => {
      const res = await served.composed.app.inject({ method: 'POST', url: '/api/v1/public/claim/token', remoteAddress: from(), headers: served.headers(), payload: { token } });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: { session: string } }).data.session;
    };
    const patch = (served: Served, ref: string, key: unknown, session: string, values: Doc) =>
      served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/${ref}/${String(key)}`, remoteAddress: from(), headers: served.headers(session), payload: { values } });
    const read = (served: Served, ref: string, session: string) => served.composed.app.inject({ method: 'GET', url: `/api/v1/public/records/${ref}`, remoteAddress: from(), headers: served.headers(session) });

    it('a staff member\'s late accept is refused by the business\'s day, not UTC\'s', async () => {
      // Good until today where the calendar is BEHIND: there it is the last day; where it is AHEAD the day has passed.
      const until = dayIn(BEHIND);
      const late = await sentQuote(until);
      const ahead = await writerFor(h, AHEAD);
      const refusal = await ahead.update('quotes', late.id, { status: 'accepted' }).then(
        () => null,
        (error: { code: string; statusCode: number; message: string; details: Doc }) => error,
      );
      expect(refusal).toMatchObject({ code: 'STATE_DATE_PASSED', statusCode: 409, details: { column: 'status', from: 'sent', to: 'accepted', date: 'valid_until', until } });
      expect(refusal!.message).toContain(until);
      expect(await statusOf(late.id)).toBe('sent');
      // The same quote, the same instant, where the day has not ended: accepted, and stamped with who did it.
      const behind = await writerFor(h, BEHIND);
      await behind.update('quotes', late.id, { status: 'accepted' });
      expect(await rowOf(late.id)).toMatchObject({ status: 'accepted', decided_by: 'usr_ivy' });
    });

    it('holds every staff door: a bulk edit, an import, a rule, a record\'s action, a decline', async () => {
      const w = await writerFor(h, AHEAD);
      const yesterday = plusDays(dayIn(AHEAD), -1);
      for (const origin of ['dashboard', 'bulk', 'import', 'automation', 'action', 'hook'] as const) {
        const late = await sentQuote(yesterday);
        const context: WriteContext = { ...w.desk, origin };
        expect([origin, await codeOf(w.update('quotes', late.id, { status: 'accepted' }, context))]).toEqual([origin, 'STATE_DATE_PASSED']);
        expect([origin, await codeOf(w.update('quotes', late.id, { status: 'declined' }, context))]).toEqual([origin, 'STATE_DATE_PASSED']);
        expect(await statusOf(late.id)).toBe('sent');
      }
      // A move the app gave no last day is made as before: a late quote is still withdrawn.
      const late = await sentQuote(yesterday);
      await w.update('quotes', late.id, { status: 'withdrawn' });
      expect(await statusOf(late.id)).toBe('withdrawn');
    });

    it('a date sent with the move does not open it; moved first, it does; no date holds to none', async () => {
      const w = await writerFor(h, AHEAD);
      const today = dayIn(AHEAD);
      const late = await sentQuote(plusDays(today, -1));
      expect(await codeOf(w.update('quotes', late.id, { status: 'accepted', valid_until: plusDays(today, 30) }))).toBe('STATE_DATE_PASSED');
      expect(await statusOf(late.id)).toBe('sent');
      // The rep extends the quote, which is hers to do (the shape leaves the date open, and later only): then it is in time.
      await w.update('quotes', late.id, { valid_until: plusDays(today, 30) });
      await w.update('quotes', late.id, { status: 'accepted' });
      expect(await statusOf(late.id)).toBe('accepted');
      // The last day itself is in time.
      const lastDay = await sentQuote(today);
      await w.update('quotes', lastDay.id, { status: 'accepted' });
      expect(await statusOf(lastDay.id)).toBe('accepted');
      // A quote with no date at all is held to none.
      const open = await sentQuote(null);
      await w.update('quotes', open.id, { status: 'declined' });
      expect(await statusOf(open.id)).toBe('declined');
    });

    it('another row\'s effect cannot make the late accept either, and writes nothing', async () => {
      const w = await writerFor(h, AHEAD);
      const late = await sentQuote(plusDays(dayIn(AHEAD), -1));
      const order = await w.create('orders', { quote_id: late.id });
      expect(await codeOf(w.update('orders', order['id'], { status: 'placed' }))).toBe('STATE_DATE_PASSED');
      expect(await statusOf(late.id)).toBe('sent');
      expect(String((await h.rows(`SELECT status FROM ${h.real('orders')} WHERE id = ${String(order['id'])}`))[0]!['status'])).toBe('new');
      // In time, the same effect accepts the quote.
      const fine = await sentQuote(plusDays(dayIn(AHEAD), 3));
      const next = await w.create('orders', { quote_id: fine.id });
      await w.update('orders', next['id'], { status: 'placed' });
      expect(await statusOf(fine.id)).toBe('accepted');
    });

    it('nobody writes who decided: a value sent is dropped, and the stamp says who it was', async () => {
      const w = await writerFor(h, AHEAD);
      const fine = await sentQuote(plusDays(dayIn(AHEAD), 3));
      // Before the move: a staff write of the column alone changes nothing.
      await w.update('quotes', fine.id, { decided_by: 'usr_mallory' }).catch(() => undefined);
      expect((await rowOf(fine.id))['decided_by']).toBeNull();
      // With the move: the stamp wins.
      await w.update('quotes', fine.id, { status: 'accepted', decided_by: 'usr_mallory' });
      expect(await rowOf(fine.id)).toMatchObject({ status: 'accepted', decided_by: 'usr_ivy' });
      // After it: still nobody's to write.
      await w.update('quotes', fine.id, { decided_by: 'link' }).catch(() => undefined);
      expect((await rowOf(fine.id))['decided_by']).toBe('usr_ivy');
      /*
       * AN IMPORT IS THE ONE WRITER THAT SAYS WHO DECIDED. It brings history — what happened elsewhere, by whom — so a
       * stamp is not written over what it brings (`decide.ts`), on a row it moves as much as on one it adds. Not into a
       * quote already sent and left where it is: the lock holds the column. Whoever may import into the table may
       * therefore say who decided a quote the import itself moves; the last day still holds that move.
       */
      const imported = await sentQuote(plusDays(dayIn(AHEAD), 3));
      const asImport: WriteContext = { ...w.desk, origin: 'import' };
      expect(await codeOf(w.update('quotes', imported.id, { decided_by: 'usr_mallory' }, asImport))).toBe('RECORD_LOCKED');
      expect(await codeOf(w.update('quotes', imported.id, { status: 'accepted', decided_by: 'usr_mallory' }, asImport))).toBe('written');
      expect((await rowOf(imported.id))['decided_by']).toBe('usr_mallory');
      // A rule's write is no person: it stamps no staff id it does not have.
      const byRule = await sentQuote(plusDays(dayIn(AHEAD), 3));
      await w.update('quotes', byRule.id, { status: 'declined', decided_by: 'usr_mallory' }, { origin: 'automation', hops: 1, actor: { kind: 'automation', id: 'rule_1', label: 'Tidy up' }, request: null });
      expect((await rowOf(byRule.id))['decided_by']).not.toBe('usr_mallory');
    });

    /** The earlier of today here and today in UTC: the day on which the two calendars disagree about a quote. */
    const edge = () => [dayIn(HERE), dayIn('UTC')].sort()[0]!;
    const lateAtEdge = HERE === AHEAD;
    const accept = { status: 'accepted', accepted_name: 'Ana Buyer' };

    it('the customer\'s link still opens a quote past its day, and refuses Accept and Decline: the entry\'s own from-today, on the business\'s day', async () => {
      const late = await sentQuote(plusDays(dayIn(HERE), -1));
      const session = await open(byQuote, late.share);
      const shown = await read(byQuote, refs.quote, session);
      expect(shown.statusCode, shown.body).toBe(200);
      expect((shown.json() as { data: Doc[] }).data[0]).toMatchObject({ status: 'sent' });
      for (const values of [accept, { status: 'declined' }]) {
        const res = await patch(byQuote, refs.quote, late.id, session, values);
        expect(res.statusCode, res.body).toBeGreaterThanOrEqual(400);
        expect(await statusOf(late.id)).toBe('sent');
      }
      // Still read after the refusals: the link is kept.
      expect((await read(byQuote, refs.quote, session)).statusCode).toBe(200);
      // The last day itself, here, is in time.
      const lastDay = await sentQuote(dayIn(HERE));
      const ok = await patch(byQuote, refs.quote, lastDay.id, await open(byQuote, lastDay.share), accept);
      expect(ok.statusCode, ok.body).toBe(200);
      expect(await rowOf(lastDay.id)).toMatchObject({ status: 'accepted', accepted_name: 'Ana Buyer', decided_by: 'link' });
      // Where this zone's day and UTC's differ, the zone's is the one read.
      const onEdge = await sentQuote(edge());
      const res = await patch(byQuote, refs.quote, onEdge.id, await open(byQuote, onEdge.share), accept);
      expect([HERE, res.statusCode === 200 ? 'accepted' : 'refused'], res.body).toEqual([HERE, lateAtEdge ? 'refused' : 'accepted']);
      expect(await statusOf(onEdge.id)).toBe(lateAtEdge ? 'sent' : 'accepted');
    });

    it('on a key that declares no date, the move\'s own last day refuses the customer: told as too late, and the link stays open', async () => {
      const late = await sentQuote(plusDays(dayIn(HERE), -1));
      const session = await open(byBare, late.bare);
      for (const values of [accept, { status: 'declined' }]) {
        const res = await patch(byBare, refs.bare, late.id, session, values);
        expect([res.statusCode, byBare.codeOf(res)], res.body).toEqual([409, 'PUBLIC_TOO_LATE']);
      }
      expect(await rowOf(late.id)).toMatchObject({ status: 'sent', accepted_name: null, decided_by: null });
      expect((await read(byBare, refs.bare, session)).statusCode).toBe(200);
      // The business's day, not UTC's.
      const onEdge = await sentQuote(edge());
      const res = await patch(byBare, refs.bare, onEdge.id, await open(byBare, onEdge.bare), accept);
      expect([HERE, res.statusCode, byBare.codeOf(res) ?? null], res.body).toEqual(lateAtEdge ? [HERE, 409, 'PUBLIC_TOO_LATE'] : [HERE, 200, null]);
      // A quote with no date is the customer's to decide whenever.
      const undated = await sentQuote(null);
      const ok = await patch(byBare, refs.bare, undated.id, await open(byBare, undated.bare), { status: 'declined' });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(await rowOf(undated.id)).toMatchObject({ status: 'declined', accepted_name: null, decided_by: 'link' });
      // The entry that says from-today is stricter there: with no date, nothing is "today or later".
      const strict = await sentQuote(null);
      expect((await patch(byQuote, refs.quote, strict.id, await open(byQuote, strict.share), { status: 'declined' })).statusCode).toBeGreaterThanOrEqual(400);
      expect(await statusOf(strict.id)).toBe('sent');
    });

    it('an Accept carries a name, a Decline carries none, and a name comes with nothing else', async () => {
      const quote = await sentQuote(plusDays(dayIn(AHEAD), 5));
      const session = await open(byBare, quote.bare);
      // Accept with no name, or an empty one.
      for (const values of [{ status: 'accepted' }, { status: 'accepted', accepted_name: '   ' }]) {
        const res = await patch(byBare, refs.bare, quote.id, session, values);
        expect([res.statusCode, byBare.codeOf(res), (res.json() as { error: { params?: Doc } }).error.params], res.body).toEqual([400, 'PUBLIC_WRITE_REFUSED', { column: 'accepted_name' }]);
      }
      // A name with a decline, or on its own: refused whole.
      for (const values of [{ status: 'declined', accepted_name: 'Mallory' }, { accepted_name: 'Mallory' }]) {
        const res = await patch(byBare, refs.bare, quote.id, session, values);
        expect([res.statusCode, byBare.codeOf(res)], res.body).toEqual([400, 'PUBLIC_WRITE_REFUSED']);
      }
      expect(await rowOf(quote.id)).toMatchObject({ status: 'sent', accepted_name: null });
      // Who decided is not the customer's to say, and neither is the date.
      for (const values of [{ status: 'accepted', accepted_name: 'Ana', decided_by: 'usr_ivy' }, { status: 'accepted', accepted_name: 'Ana', valid_until: '2099-01-01' }, { status: 'withdrawn' }, { status: 'draft' }]) {
        const res = await patch(byBare, refs.bare, quote.id, session, values);
        expect(res.statusCode, res.body).toBe(400);
      }
      // A name is a name: no link, no markup, no digits, and no longer than the column's rule says.
      for (const name of ['see https://evil.example', '<b>Ana</b>', 'Ana 0123456789', 'A'.repeat(61)]) {
        const res = await patch(byBare, refs.bare, quote.id, session, { status: 'accepted', accepted_name: name });
        expect([name, res.statusCode], res.body).toEqual([name, 400]);
      }
      expect(await rowOf(quote.id)).toMatchObject({ status: 'sent', accepted_name: null });
      // A decline with an empty name sent along is a decline, and writes no name.
      const declined = await patch(byBare, refs.bare, quote.id, session, { status: 'declined', accepted_name: '' });
      expect(declined.statusCode, declined.body).toBe(200);
      expect(await rowOf(quote.id)).toMatchObject({ status: 'declined', accepted_name: null, decided_by: 'link' });
    });

    it('a second Accept, and an Accept after a Decline, are judged on the stored state', async () => {
      const until = plusDays(dayIn(AHEAD), 5);
      for (const [served, ref, code] of [[byQuote, 'quote', 'share'], [byBare, 'bare', 'bare']] as const) {
        const twice = await sentQuote(until);
        const session = await open(served, twice[code]);
        expect((await patch(served, refs[ref], twice.id, session, accept)).statusCode).toBe(200);
        const second = await patch(served, refs[ref], twice.id, session, { status: 'accepted', accepted_name: 'Somebody Else' });
        expect(second.statusCode, second.body).toBeGreaterThanOrEqual(400);
        expect((await patch(served, refs[ref], twice.id, session, { status: 'declined' })).statusCode).toBeGreaterThanOrEqual(400);
        expect(await rowOf(twice.id)).toMatchObject({ status: 'accepted', accepted_name: 'Ana Buyer', decided_by: 'link' });

        const declined = await sentQuote(until);
        const s2 = await open(served, declined[code]);
        expect((await patch(served, refs[ref], declined.id, s2, { status: 'declined' })).statusCode).toBe(200);
        expect((await patch(served, refs[ref], declined.id, s2, accept)).statusCode).toBeGreaterThanOrEqual(400);
        expect(await rowOf(declined.id)).toMatchObject({ status: 'declined', accepted_name: null });

        // Two Accepts at once: one is written, the other refused.
        const race = await sentQuote(until);
        const s3 = await open(served, race[code]);
        const both = await Promise.all([patch(served, refs[ref], race.id, s3, accept), patch(served, refs[ref], race.id, s3, { status: 'declined' })]);
        expect(both.filter((res) => res.statusCode === 200)).toHaveLength(1);
      }
      // Staff accepted it meanwhile: the customer's Accept is refused, and the stamp stays the staff member's.
      const w = await writerFor(h, BEHIND);
      const taken = await sentQuote(until);
      const session = await open(byBare, taken.bare);
      await w.update('quotes', taken.id, { status: 'accepted' });
      expect((await patch(byBare, refs.bare, taken.id, session, accept)).statusCode).toBeGreaterThanOrEqual(400);
      expect(await rowOf(taken.id)).toMatchObject({ status: 'accepted', accepted_name: null, decided_by: 'usr_ivy' });
      // And a staff member's second move of a decided quote is the wrong starting state, told apart from the day.
      expect(await codeOf(w.update('quotes', taken.id, { status: 'declined' }))).toBe('STATE_MOVE_REFUSED');
    });
  });
}
