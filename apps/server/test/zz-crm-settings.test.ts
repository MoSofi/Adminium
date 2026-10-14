// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan 67, F18 and F20 (their stage-1 part): SETTINGS, PLACES AND THE ROWS A
 * BUSINESS SETS UP FIRST, against the whole server on SQLite, Postgres and
 * MySQL, with the app's own manifest, each try made signed in as the person it
 * is about.
 *
 * Settings: one row. The sales manager writes eight of its columns (how the
 * team sells) and is refused every other one by the server; the CRM admin
 * writes all of them; everybody else reads and writes none. Each number is
 * held between its bounds. The working days and hours start as Monday to
 * Friday, 08:30 to 17:30. The depot's address is kept in parts and its place
 * as a place: a town's middle, or an exact point.
 *
 * A column no two share: `companies.customer_no` and `contacts.reference`,
 * kept as a code (upper case, spaces and dashes left out), empty for as many
 * rows as like. A pasted list matches on it.
 *
 * A rep's own row (`reps`): the admin makes and removes it, one a person;
 * whoever it names changes it, and nobody else's. (Who writes the price list
 * is in `crm-roles`, tries 20a and 20c: it needs the quotes part, which this
 * file's install leaves out with its add-on.)
 *
 * To run: `npm run proofs -- settings` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;

/** The eight columns that say how the team sells: the sales manager's. */
const MANAGERS = ['approval_threshold_pct', 'quote_valid_days', 'quote_warn_days', 'sitting_warm_days', 'sitting_stale_days', 'nudge_quiet_days', 'nudge_stuck_days', 'nudge_soon_days'];
/** A value each setting takes, other than the one it starts with. */
const LEGAL: Record<string, unknown> = {
  visit_emails: false, approval_threshold_pct: 7.5, quote_valid_days: 45, quote_warn_days: 5, sitting_warm_days: 10, sitting_stale_days: 40, nudge_quiet_days: 9, nudge_stuck_days: 25, nudge_soon_days: 10,
  working_day_hours: 7.5, week_starts: 'sun', work_mon: false, work_tue: false, work_wed: false, work_thu: false, work_fri: false, work_sat: true, work_sun: true, work_from: '09:00', work_to: '18:00',
  depot_name: 'North depot', depot_address: 'Unit 9\nCanal Road', depot_town: 'Bradford', depot_region: 'West Yorkshire', depot_postal_code: 'BD1 4SJ', depot_country: 'GB', depot_lat: 53.79, depot_lng: -1.75,
  depot_place: { lat: 53.79, lng: -1.75 }, distance_unit: 'miles', loan_days: 10, aftercare_days: 21, complaint_answer_days: 2, snag_days: 4, lead_cold_days: 10, certificate_warn_days: 30,
  display_tired_months: 8, claim_red_days: 14, inspection_warn_days: 21,
};
/** Outside each number's bounds, below and above. */
const OUT: Record<string, [unknown, unknown]> = {
  approval_threshold_pct: [-1, 51], quote_valid_days: [0, 366], quote_warn_days: [-1, 31], sitting_warm_days: [0, 365], sitting_stale_days: [1, 366], nudge_quiet_days: [2, 22], nudge_stuck_days: [6, 46],
  nudge_soon_days: [2, 31], working_day_hours: [3.5, 12.5], lead_cold_days: [0, 366],
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's settings, places and first rows, on ${dialect}`, () => {
    let s: WholeServer;
    let settings = 0;
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(201);
      return Number((res.json() as { data: { id: number } }).data.id);
    };
    const row = async (who: string, ref: string, id: number): Promise<Record<string, unknown> | null> => {
      const res = await s.get(who, url(ref, `/${String(id)}`));
      return res.statusCode === 200 ? (res.json() as { data: Record<string, unknown> }).data : null;
    };
    const list = async (who: string, ref: string): Promise<Record<string, unknown>[]> => {
      const res = await s.get(who, url(ref, '?limit=200'));
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: Record<string, unknown>[] }).data;
    };
    const remove = (who: string, ref: string, id: number): Promise<Reply> => s.send(who, 'DELETE', url(ref, `/${String(id)}?confirm=true`));
    /** A json value as an object on every engine. */
    const json = (value: unknown): Record<string, unknown> | null => (value === null || value === undefined ? null : ((typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown>));
    const yes = (value: unknown): boolean => value === true || value === 1 || value === '1';
    const columns = (): string[] =>
      (manifest()['requiredSchema'] as { tables: { ref: string; columns: { ref: string }[] }[] }).tables
        .find((table) => table.ref === 'settings')!
        .columns.map((column) => column.ref)
        .filter((ref) => ref !== 'id');

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: { dana: ['rep'], sam: ['rep'], ivy: ['sales-manager'], tessa: ['admin'], grace: ['read-only'], hugo: ['account-manager'], lena: ['marketer'], corin: ['front-desk'], ada: ['ops-manager'] },
      });
      settings = Number((await list('tessa', 'settings'))[0]!['id']);
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('starts with a working week of Monday to Friday, 08:30 to 17:30', async () => {
      const first = (await row('tessa', 'settings', settings))!;
      expect(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => yes(first[`work_${day}`]))).toEqual([true, true, true, true, true, false, false]);
      expect([first['work_from'], first['work_to'], first['week_starts']]).toEqual(['08:30', '17:30', 'mon']);
      // Every role of the app reads the row: a screen needs the days and the unit of distance.
      for (const who of ['dana', 'ivy', 'grace', 'hugo', 'lena', 'corin']) expect(Number((await row(who, 'settings', settings))?.['id']), who).toBe(settings);
      // The operations manager's parts (Jobs on site, Supply, Vehicles and crew) are all off in this install, so her role grants nothing yet: she reads no row, this one included.
      expect(await row('ada', 'settings', settings)).toBeNull();
    });

    it('lets the sales manager write her eight settings and refuses her every other one', async () => {
      // The list this test walks is the manifest's own: a column added tomorrow is tried too.
      const every = columns();
      expect(every.filter((ref) => !(ref in LEGAL) && ref !== 'aftercare_owner_id')).toEqual([]);
      for (const ref of every) {
        const value = ref === 'aftercare_owner_id' ? s.ids['hugo'] : LEGAL[ref];
        const before = (await row('tessa', 'settings', settings))![ref];
        const tried = await s.change('ivy', 'settings', settings, { [ref]: value });
        if (MANAGERS.includes(ref)) {
          expect(said(tried), ref).toBe('ok');
        } else {
          expect(tried.statusCode, `${ref}: ${tried.body}`).toBe(403);
          expect((await row('tessa', 'settings', settings))![ref], ref).toEqual(before);
        }
      }
      // One of hers sent beside one that is not: the whole write is refused, and hers is not kept.
      const mixed = await s.change('ivy', 'settings', settings, { quote_valid_days: 60, week_starts: 'sat' });
      expect(mixed.statusCode, mixed.body).toBe(403);
      expect(Number((await row('ivy', 'settings', settings))!['quote_valid_days'])).toBe(45);
    });

    it('lets the CRM admin write every setting, and nobody else any', async () => {
      for (const ref of columns()) {
        const value = ref === 'aftercare_owner_id' ? s.ids['hugo'] : LEGAL[ref];
        expect(said(await s.change('tessa', 'settings', settings, { [ref]: value })), ref).toBe('ok');
      }
      const kept = (await row('grace', 'settings', settings))!;
      // Read-only reads every part of the depot's address in clear: it is the business's own address, not a person's (the manifest says so; by its name alone Adminium would mask it).
      expect([kept['week_starts'], kept['work_from'], kept['work_to'], kept['depot_address'], kept['depot_town'], kept['depot_region'], kept['depot_postal_code'], kept['depot_country'], kept['distance_unit']]).toEqual(['sun', '09:00', '18:00', 'Unit 9\nCanal Road', 'Bradford', 'West Yorkshire', 'BD1 4SJ', 'GB', 'miles']);
      expect(kept['_masked'] ?? []).toEqual([]);
      expect(['mon', 'sat', 'sun'].map((day) => yes(kept[`work_${day}`]))).toEqual([false, true, true]);
      for (const who of ['dana', 'grace', 'hugo', 'lena', 'corin', 'ada']) {
        expect((await s.change(who, 'settings', settings, { quote_valid_days: 31 })).statusCode, who).toBe(403);
        expect((await s.change(who, 'settings', settings, { work_sat: false })).statusCode, who).toBe(403);
      }
      // Nobody makes a second row of settings or removes the one there is, the admin included.
      expect((await s.make('tessa', 'settings', { quote_valid_days: 20 })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await remove('tessa', 'settings', settings)).statusCode).toBeGreaterThanOrEqual(400);
      expect(await list('tessa', 'settings')).toHaveLength(1);
    });

    it('holds each number between its bounds, whoever writes', async () => {
      for (const [ref, [low, high]] of Object.entries(OUT)) {
        const who = MANAGERS.includes(ref) ? 'ivy' : 'tessa';
        const before = (await row('tessa', 'settings', settings))![ref];
        for (const value of [low, high]) {
          const tried = await s.change(who, 'settings', settings, { [ref]: value });
          expect(tried.statusCode, `${ref}=${String(value)}: ${tried.body}`).toBe(422);
        }
        // The admin is held as the manager is.
        expect((await s.change('tessa', 'settings', settings, { [ref]: high })).statusCode, ref).toBe(422);
        expect((await row('tessa', 'settings', settings))![ref], ref).toEqual(before);
      }
      // A time of day is five characters; a country is two letters.
      for (const values of [{ work_from: '8:30' }, { work_to: '17:30:00' }, { depot_country: 'G' }, { depot_country: 'GBR' }, { week_starts: 'tue' }, { distance_unit: 'yards' }]) {
        const tried = await s.change('tessa', 'settings', settings, values);
        expect(tried.statusCode, `${JSON.stringify(values)}: ${tried.body}`).toBeGreaterThanOrEqual(400);
        expect(tried.statusCode).toBeLessThan(500);
      }
    });

    it('keeps the depot as a place: a town’s middle, or an exact point', async () => {
      // By town: a town of Adminium's own list, and Adminium fills the position in itself.
      expect(said(await s.change('tessa', 'settings', settings, { depot_place: { placeId: 2644688 } }))).toBe('ok');
      const town = json((await row('tessa', 'settings', settings))!['depot_place'])!;
      expect([town['by'], town['placeId'], town['country']]).toEqual(['town', 2644688, 'GB']);
      expect(Number(town['lat'])).toBeCloseTo(53.79648, 4);
      expect(Number(town['lng'])).toBeCloseTo(-1.54785, 4);
      // A pin dragged to the street.
      expect(said(await s.change('tessa', 'settings', settings, { depot_place: { lat: 53.7912, lng: -1.5503 } }))).toBe('ok');
      const exact = json((await row('dana', 'settings', settings))!['depot_place'])!;
      expect([exact['by'], Number(exact['lat']), Number(exact['lng'])]).toEqual(['exact', 53.7912, -1.5503]);
      // What is not a position is refused by the column, and the place stays.
      for (const bad of [{ lat: 'north', lng: 1 }, { lat: 95, lng: 0 }, 'Leeds', { placeId: 1 }]) {
        const tried = await s.change('tessa', 'settings', settings, { depot_place: bad });
        expect(tried.statusCode, `${JSON.stringify(bad)}: ${tried.body}`).toBeGreaterThanOrEqual(400);
        expect(tried.statusCode).toBeLessThan(500);
      }
      expect(json((await row('tessa', 'settings', settings))!['depot_place'])!['by']).toBe('exact');
      // Emptied again.
      expect(said(await s.change('tessa', 'settings', settings, { depot_place: null }))).toBe('ok');
      expect(json((await row('tessa', 'settings', settings))!['depot_place'])).toBeNull();
    });

    /*
     * KNOWN TO FAIL ON POSTGRES AND MYSQL until Adminium is fixed (found by this proof, 2026-10-14):
     * `sameValue` in `apps/server/src/rbac/update-limits.ts` compares what is sent with what is stored as text, and
     * two objects both read "[object Object]". A json column that already holds a value therefore counts as "sent
     * unchanged" on the engines that answer json as an object, and a role's `writable` list is not asked about it.
     * SQLite answers json as text, so there the write is refused as it should be.
     */
    it('does not let the sales manager move a depot that already has a place', async () => {
      expect(said(await s.change('tessa', 'settings', settings, { depot_place: { lat: 53.7912, lng: -1.5503 } }))).toBe('ok');
      const tried = await s.change('ivy', 'settings', settings, { depot_place: { placeId: 2644688 } });
      const after = json((await row('tessa', 'settings', settings))!['depot_place']);
      console.info(`[crm-settings ${dialect}] the manager's write of a depot place that is already set: ${String(tried.statusCode)}, and the place is now by ${String(after?.['by'])}`);
      expect(said(await s.change('tessa', 'settings', settings, { depot_place: null }))).toBe('ok');
      expect([tried.statusCode, after?.['by']]).toEqual([403, 'exact']);
    });

    it('keeps a customer number no two companies share, and a reference no two contacts share', async () => {
      const first = made(await s.make('dana', 'companies', { name: 'Harbour Print', customer_no: 'c-1001' }));
      // Kept as a code: upper case, spaces and dashes left out.
      expect((await row('dana', 'companies', first))!['customer_no']).toBe('C1001');
      // The same number, however it is spelled, by anybody: refused, and no second company is made.
      for (const [who, spelled] of [['dana', 'C1001'], ['ivy', 'c 1001'], ['tessa', 'C-10 01']] as const) {
        const again = await s.make(who, 'companies', { name: 'Harbour Print Ltd', customer_no: spelled });
        expect(again.statusCode, `${who} ${spelled}: ${again.body}`).toBeGreaterThanOrEqual(400);
        expect(again.statusCode).toBeLessThan(500);
      }
      // Two companies may share a NAME (they do in life), and any number of them may have no number.
      const twin = made(await s.make('dana', 'companies', { name: 'Harbour Print' }));
      const third = made(await s.make('dana', 'companies', { name: 'Orchard Dental' }));
      expect([(await row('dana', 'companies', twin))!['customer_no'], (await row('dana', 'companies', third))!['customer_no']]).toEqual([null, null]);
      // A rep gives a new company its number and does not change it after (decision 123): the manager does.
      expect((await s.change('dana', 'companies', third, { customer_no: 'c-1002' })).statusCode).toBe(403);
      // A change to a number that is taken is refused; to a free one it is kept.
      const taken = await s.change('ivy', 'companies', third, { customer_no: 'C 1001' });
      expect(taken.statusCode, taken.body).toBeGreaterThanOrEqual(400);
      expect(taken.statusCode).toBeLessThan(500);
      expect(said(await s.change('ivy', 'companies', third, { customer_no: 'c-1002' }))).toBe('ok');
      expect((await list('tessa', 'companies')).map((one) => one['customer_no']).sort()).toEqual(['C1001', 'C1002', null].sort());
      // Read-only and the marketer read the number and write none.
      expect((await row('grace', 'companies', first))!['customer_no']).toBe('C1001');
      expect((await s.change('grace', 'companies', first, { customer_no: 'X1' })).statusCode).toBe(403);
      expect((await s.change('lena', 'companies', first, { customer_no: 'X1' })).statusCode).toBe(403);

      // Contacts: the same, and a rep writes it though her role's columns are listed.
      const petra = made(await s.make('dana', 'contacts', { company_id: first, name: 'Petra Lindqvist', email: 'office@harbour.test', reference: 'k-77', may_email: true }));
      expect((await row('dana', 'contacts', petra))!['reference']).toBe('K77');
      const second = await s.make('dana', 'contacts', { company_id: third, name: 'Petra L.', reference: 'K 77', may_email: false });
      expect(second.statusCode, second.body).toBeGreaterThanOrEqual(400);
      expect(second.statusCode).toBeLessThan(500);
      // Two contacts may share an address (one mailbox for the office): the address is not the column no two share.
      const jon = made(await s.make('dana', 'contacts', { company_id: first, name: 'Jon Avery', email: 'office@harbour.test', may_email: true }));
      expect(said(await s.change('dana', 'contacts', jon, { reference: 'k-78' }))).toBe('ok');
      expect((await s.change('hugo', 'contacts', jon, { reference: 'K77' })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await s.change('grace', 'contacts', jon, { reference: 'K79' })).statusCode).toBe(403);
      expect((await list('tessa', 'contacts')).map((one) => one['reference']).sort()).toEqual(['K77', 'K78']);
    });

    it('matches a pasted list on the customer number: what is here is left or updated, never made twice', async () => {
      const upload = (who: string, text: string) => s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=pasted.csv', headers: { cookie: s.cookie[who]!, 'content-type': 'text/csv' }, payload: text });
      const bring = async (who: string, text: string, mode: 'skip' | 'upsert', table = 'companies', mapping = [{ from: 'Number', to: 'customer_no' }, { from: 'Name', to: 'name' }, { from: 'Town', to: 'town' }], match = 'customer_no'): Promise<{ id: string | null; made: Reply }> => {
        const up = await upload(who, text);
        expect(up.statusCode, up.body).toBe(201);
        const import_ = await s.send(who, 'POST', '/api/v1/imports', { fileId: (up.json() as { data: { fileId: string } }).data.fileId, connectionId: s.connectionId, table: s.t(table), mapping: { columns: mapping }, options: { mode, matchColumn: match } });
        return { id: import_.statusCode === 201 ? (import_.json() as { data: { import: { id: string } } }).data.import.id : null, made: import_ };
      };
      const preview = async (who: string, id: string): Promise<{ counts: Record<string, number>; lines: { row: number; status: string }[] }> => {
        const res = await s.get(who, `/api/v1/imports/${id}/preview`);
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { data: { counts: Record<string, number>; lines: { row: number; status: string }[] } }).data;
      };
      const run = async (who: string, id: string): Promise<{ status: string; stats: Record<string, number> }> => {
        expect((await s.send(who, 'POST', `/api/v1/imports/${id}/run`)).statusCode).toBe(202);
        await s.jobs();
        return ((await s.get(who, `/api/v1/imports/${id}`)).json() as { data: { status: string; stats: Record<string, number> } }).data;
      };
      const companies = async (): Promise<string[]> => (await list('tessa', 'companies')).map((one) => `${String(one['customer_no'])} ${String(one['name'])} ${String(one['town'])}`).sort();
      const before = await companies();
      expect(before).toEqual(['C1001 Harbour Print null', 'C1002 Orchard Dental null', 'null Harbour Print null']);

      // A rep pastes three lines: one number is here, under a name spelled another way; two are new.
      const paste = 'Number\tName\tTown\nC1001\tHARBOUR PRINT LIMITED\tYork\nC1003\tQuayside Print\tHull\nC1004\tHarbour Print\tLeeds\n';
      const first = await bring('dana', paste, 'skip');
      expect(first.made.statusCode, first.made.body).toBe(201);
      const told = await preview('dana', first.id!);
      expect(told.counts).toEqual({ new: 2, here: 1, refused: 0 });
      expect(told.lines).toMatchObject([{ row: 1, status: 'here' }, { row: 2, status: 'new' }, { row: 3, status: 'new' }]);
      expect(await companies()).toEqual(before);
      expect((await run('dana', first.id!)).stats).toMatchObject({ total: 3, inserted: 2, updated: 0, skipped: 1 });
      const after = await companies();
      expect(after).toEqual(['C1001 Harbour Print null', 'C1002 Orchard Dental null', 'C1003 Quayside Print Hull', 'C1004 Harbour Print Leeds', 'null Harbour Print null'].sort());

      // The same list again adds nothing.
      const second = await bring('dana', paste, 'skip');
      expect((await preview('dana', second.id!)).counts).toEqual({ new: 0, here: 3, refused: 0 });
      expect((await run('dana', second.id!)).stats).toMatchObject({ inserted: 0, updated: 0, skipped: 3 });
      expect(await companies()).toEqual(after);

      // The CRM admin brings it in to update: the three rows take the list's names and towns, and no row is made.
      const third = await bring('tessa', paste, 'upsert');
      expect((await run('tessa', third.id!)).stats).toMatchObject({ total: 3, inserted: 0 });
      expect(await companies()).toEqual(['C1001 HARBOUR PRINT LIMITED York', 'C1002 Orchard Dental null', 'C1003 Quayside Print Hull', 'C1004 Harbour Print Leeds', 'null Harbour Print null'].sort());

      // A number spelled another way in the list (lower case, a dash): whatever the preview says of it, no second company with that number is ever made.
      const loose = await bring('dana', 'Number\tName\tTown\nc-1003\tQuayside Print Again\tHull\n', 'skip');
      expect(loose.made.statusCode, loose.made.body).toBe(201);
      const looseTold = await preview('dana', loose.id!);
      const looseRan = await run('dana', loose.id!);
      console.info(`[crm-settings ${dialect}] a number spelled "c-1003" against the kept "C1003": preview ${JSON.stringify(looseTold.counts)}, run ${JSON.stringify(looseRan)}`);
      expect((await companies()).filter((one) => one.startsWith('C1003 '))).toEqual(['C1003 Quayside Print Hull']);
      expect((await companies()).some((one) => one.includes('Quayside Print Again'))).toBe(false);

      // Contacts match on their reference the same way, as a rep.
      const people = await bring('dana', 'Ref\tName\nK77\tPetra Lindqvist-Berg\nK90\tMira Castell\n', 'skip', 'contacts', [{ from: 'Ref', to: 'reference' }, { from: 'Name', to: 'name' }], 'reference');
      // A contact needs its company, which a pasted line does not carry here: the new line is refused, the one that is here is seen as here.
      if (people.id !== null) {
        const said = await preview('dana', people.id);
        expect(said.lines[0]).toMatchObject({ row: 1, status: 'here' });
      } else {
        expect(people.made.statusCode, people.made.body).toBeLessThan(500);
      }
      // Who brings no list in: Read-only, the marketer, the account manager.
      for (const who of ['grace', 'lena', 'hugo']) expect((await bring(who, paste, 'skip')).made.statusCode, who).toBe(403);
    });

    it('lets the admin make a rep’s row, one a person, and whoever it names change it', async () => {
      // Nobody but the CRM admin makes one: not the rep for herself, not her manager.
      for (const who of ['dana', 'ivy', 'grace', 'hugo']) expect((await s.make(who, 'reps', { user_id: s.ids['dana'] })).statusCode, who).toBe(403);
      const danas = made(await s.make('tessa', 'reps', { user_id: s.ids['dana'], tint: 'indigo' }));
      const sams = made(await s.make('tessa', 'reps', { user_id: s.ids['sam'] }));
      // One a person.
      const twice = await s.make('tessa', 'reps', { user_id: s.ids['dana'] });
      expect(twice.statusCode, twice.body).toBeGreaterThanOrEqual(400);
      expect(twice.statusCode).toBeLessThan(500);
      // Whoever reads deals reads who the reps are.
      for (const who of ['dana', 'sam', 'ivy', 'hugo', 'grace']) expect((await list(who, 'reps')).map((one) => Number(one['id'])).sort(), who).toEqual([danas, sams].sort());
      for (const who of ['lena', 'corin', 'ada']) expect((await s.get(who, url('reps', '?limit=5'))).statusCode, who).toBe(403);
      // Her own hours: hers to set.
      expect(said(await s.change('dana', 'reps', danas, { hours_from: '08:00', hours_to: '16:00' }))).toBe('ok');
      expect([(await row('sam', 'reps', danas))!['hours_from'], (await row('sam', 'reps', danas))!['hours_to']]).toEqual(['08:00', '16:00']);
      // A colleague's, her manager's reach, Read-only: refused, and the row is as it was.
      for (const who of ['sam', 'ivy', 'hugo', 'grace']) {
        const tried = await s.change(who, 'reps', danas, { hours_from: '11:00' });
        expect([403, 404], `${who}: ${tried.body}`).toContain(tried.statusCode);
      }
      expect((await row('dana', 'reps', danas))!['hours_from']).toBe('08:00');
      // She does not give her row to a colleague or take another's.
      const given = await s.change('dana', 'reps', danas, { user_id: s.ids['ivy'] });
      expect(given.statusCode, given.body).toBeGreaterThanOrEqual(400);
      expect(given.statusCode).toBeLessThan(500);
      expect((await row('tessa', 'reps', danas))!['user_id']).toBe(s.ids['dana']);
      // The admin changes anybody's and removes one; a rep removes none, her own included.
      expect(said(await s.change('tessa', 'reps', sams, { tint: 'teal' }))).toBe('ok');
      expect((await remove('dana', 'reps', danas)).statusCode).toBe(403);
      expect((await remove('ivy', 'reps', sams)).statusCode).toBe(403);
      expect(said(await remove('tessa', 'reps', sams))).toBe('ok');
      expect((await list('dana', 'reps')).map((one) => Number(one['id']))).toEqual([danas]);
    });
  });
}
