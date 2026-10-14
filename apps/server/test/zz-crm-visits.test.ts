// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan 67, F17 (stage 1): SITE VISITS AND COVER, against the whole server on
 * SQLite, Postgres and MySQL, with the app's own manifest, each try made
 * signed in as the person it is about.
 *
 * Site visits: a rep books for herself only, and only on a deal she opens; a
 * manager books for the people she leads; a visit is moved and its old day,
 * who moved it and when are read from the record's history; a cancel REMOVES
 * the row, and the why is in the removal's own audit entry; a visit that was
 * made, or written up, is not removed; "written up" is the server's count.
 *
 * Cover: made by the sales manager for people she leads (both the person away
 * and whoever covers) or by the CRM admin; no two covers of one person
 * overlap; until further notice; "End today"; new dates; a cancel removes the
 * row and the lent deal is gone the same moment.
 *
 * To run: `npm run proofs -- visits` (copies itself into the engine lane's test folder, runs, removes itself).
 */
import { readFileSync } from 'node:fs';

import { teamsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const DAY = 86_400_000;

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's site visits and cover, on ${dialect}`, () => {
    let s: WholeServer;
    const deal: Record<string, number> = { nowhere: 999_999 };
    const contact: Record<string, number> = {};
    const day = (days: number): string => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
    const at = (days: number, time = '10:00'): string => `${day(days)}T${time}:00.000Z`;
    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(201);
      return Number((res.json() as { data: { id: number } }).data.id);
    };
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
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
    const book = (who: string, rep: string, on: string, extra: Record<string, unknown> = {}): Promise<Reply> =>
      s.make(who, 'site_visits', { deal_id: deal[on], contact_id: contact['petra'], rep_id: s.ids[rep], starts_at: at(3), minutes: 60, purpose: 'Walk the floor', ...extra });
    const details = (res: Reply): Record<string, unknown> => ((res.json() as { error?: { details?: Record<string, unknown> } }).error?.details ?? {}) as Record<string, unknown>;

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: { dana: ['rep'], sam: ['rep'], priya: ['rep'], noor: ['rep'], ivy: ['sales-manager'], tessa: ['admin'], grace: ['read-only'], corin: ['front-desk'], lena: ['marketer'] },
      });
      // Ivy leads the team Dana, Sam and Priya are in. Noor is a rep in no team of hers.
      const team = await teamsRepo(s.meta).create('Sales');
      await teamsRepo(s.meta).setMember(team.id, s.ids['ivy']!, true);
      for (const rep of ['dana', 'sam', 'priya']) await teamsRepo(s.meta).setMember(team.id, s.ids[rep]!, false);
      const stage = made(await s.make('owner', 'stages', { label: 'Proposal', odds: 0.5, position: 3 }));
      const company = made(await s.make('owner', 'companies', { name: 'Nordwind Logistics' }));
      contact['petra'] = made(await s.make('owner', 'contacts', { company_id: company, name: 'Petra Lindqvist', email: 'petra@nordwind.test', may_email: true }));
      for (const [name, owner] of [['danas', 'dana'], ['sams', 'sam'], ['noors', 'noor'], ['priyas', 'priya']] as const) {
        deal[name] = made(await s.make('owner', 'deals', { name: `${name} deal`, company_id: company, owner_id: s.ids[owner], stage_id: stage }));
      }
      await s.jobs();
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('lets a rep book for herself on a deal she opens, and nobody else or anywhere else', async () => {
      const own = await book('dana', 'dana', 'danas', { note: 'Lift booking runs out at noon.' });
      const id = made(own);
      expect((await row('dana', 'site_visits', id))?.['note']).toBe('Lift booking runs out at noon.');
      // For a colleague, on her own deal: refused, and nothing is written.
      const forSam = await book('dana', 'sam', 'danas');
      expect(forSam.statusCode, forSam.body).toBe(403);
      // On a colleague's deal, which she cannot open: refused in the words of "no such deal".
      const onSams = await book('dana', 'dana', 'sams');
      expect(onSams.statusCode, onSams.body).toBe(409);
      const missing = await s.make('dana', 'site_visits', { deal_id: 999_999, contact_id: contact['petra'], rep_id: s.ids['dana'], starts_at: at(3), minutes: 60, purpose: 'Nowhere' });
      expect(missing.statusCode).toBe(onSams.statusCode);
      expect(said(missing)).toBe(said(onSams));
      // With nobody named: the row would be nobody's.
      const nobody = await s.make('dana', 'site_visits', { deal_id: deal['danas'], starts_at: at(3), minutes: 60, purpose: 'Nobody' });
      expect(nobody.statusCode, nobody.body).toBeGreaterThanOrEqual(400);
      expect((await list('dana', 'site_visits')).map((one) => Number(one['id']))).toEqual([id]);
      // Somebody who holds no right on visits at all, and Read-only.
      expect((await book('corin', 'dana', 'danas')).statusCode).toBe(403);
      expect((await book('lena', 'dana', 'danas')).statusCode).toBe(403);
      expect((await book('grace', 'dana', 'danas')).statusCode).toBe(403);
      expect((await s.get('lena', url('site_visits', '?limit=5'))).statusCode).toBe(403);
      expect(said(await remove('dana', 'site_visits', id))).toBe('ok');
    });

    it('lets a manager book for the people she leads, and for nobody else', async () => {
      const forDana = made(await book('ivy', 'dana', 'danas'));
      const forSam = made(await book('ivy', 'sam', 'sams'));
      // Noor is in no team of hers: neither Noor's name nor Noor's deal.
      expect((await book('ivy', 'noor', 'danas')).statusCode).toBe(403);
      const onNoors = await book('ivy', 'dana', 'noors');
      expect(said(onNoors)).toBe(said(await book('ivy', 'dana', 'nowhere')));
      expect(onNoors.statusCode).toBe(409);
      // The CRM admin books for anybody.
      const forNoor = made(await book('tessa', 'noor', 'noors'));
      // Each rep reads her own; the manager her team's; Read-only all of them and changes none.
      expect((await list('dana', 'site_visits')).map((one) => Number(one['id']))).toEqual([forDana]);
      expect((await list('sam', 'site_visits')).map((one) => Number(one['id']))).toEqual([forSam]);
      expect((await list('ivy', 'site_visits')).map((one) => Number(one['id'])).sort()).toEqual([forDana, forSam].sort());
      expect(await list('grace', 'site_visits')).toHaveLength(3);
      expect((await s.change('grace', 'site_visits', forDana, { minutes: 30 })).statusCode).toBe(403);
      expect((await remove('grace', 'site_visits', forDana)).statusCode).toBe(403);
      // A rep does not give her visit to a colleague, nor take one.
      expect((await s.change('dana', 'site_visits', forDana, { rep_id: s.ids['sam'] })).statusCode).toBeGreaterThanOrEqual(400);
      expect(await row('sam', 'site_visits', forDana)).toBeNull();
      expect((await s.change('sam', 'site_visits', forDana, { minutes: 30 })).statusCode).toBe(404);
      expect((await remove('sam', 'site_visits', forDana)).statusCode).toBe(404);
      for (const id of [forDana, forSam]) expect(said(await remove('ivy', 'site_visits', id))).toBe('ok');
      expect(said(await remove('tessa', 'site_visits', forNoor))).toBe('ok');
    });

    it('keeps a visit on a shared deal its own rep\'s to move or cancel', async () => {
      // Dana adds Sam to her deal: he reads it, and the visits on it.
      made(await s.make('dana', 'deal_members', { deal_id: deal['danas'], user_id: s.ids['sam'] }));
      const danas = made(await book('dana', 'dana', 'danas'));
      expect(Number((await row('sam', 'site_visits', danas))?.['id'])).toBe(danas);
      // He does not move it, and does not cancel it.
      expect((await s.change('sam', 'site_visits', danas, { minutes: 30 })).statusCode).toBeGreaterThanOrEqual(403);
      expect((await remove('sam', 'site_visits', danas)).statusCode).toBeGreaterThanOrEqual(403);
      expect(Number((await row('dana', 'site_visits', danas))?.['minutes'])).toBe(60);
      // He books his own visit on it, and Dana reads that one and does not move it.
      const sams = made(await book('sam', 'sam', 'danas'));
      expect(Number((await row('dana', 'site_visits', sams))?.['id'])).toBe(sams);
      expect((await s.change('dana', 'site_visits', sams, { minutes: 30 })).statusCode).toBeGreaterThanOrEqual(403);
      expect(said(await remove('sam', 'site_visits', sams))).toBe('ok');
      expect(said(await remove('dana', 'site_visits', danas))).toBe('ok');
    });

    it('reads a move\'s old day, who moved it and when from the record\'s history', async () => {
      const id = made(await book('dana', 'dana', 'danas'));
      const before = String((await row('dana', 'site_visits', id))?.['starts_at']);
      // Her manager moves it two days on.
      expect(said(await s.change('ivy', 'site_visits', id, { starts_at: at(5, '14:30'), minutes: 90 }))).toBe('ok');
      const res = await s.get('dana', url('site_visits', `/${String(id)}/history?limit=20`));
      expect(res.statusCode, res.body).toBe(200);
      const entries = (res.json() as { entries: { createdAt: number; actorLabel: string | null; action: string; changes: { before?: Record<string, unknown>; after?: Record<string, unknown> } | null }[] }).entries;
      const move = entries.find((entry) => entry.changes?.before !== undefined && 'starts_at' in (entry.changes.before ?? {}));
      expect(move, JSON.stringify(entries)).toBeDefined();
      expect(new Date(String(move!.changes!.before!['starts_at'])).getTime()).toBe(new Date(before).getTime());
      expect(new Date(String(move!.changes!.after!['starts_at'])).getTime()).toBe(new Date(at(5, '14:30')).getTime());
      expect(Number(move!.changes!.before!['minutes'])).toBe(60);
      expect(move!.actorLabel).toMatch(/ivy/i);
      expect(Math.abs(Number(move!.createdAt) - Date.now())).toBeLessThan(120_000);
      // No column holds the old day.
      expect(Object.keys((await row('dana', 'site_visits', id)) ?? {}).filter((key) => /old|was|moved|previous/.test(key))).toEqual([]);
      expect(said(await remove('dana', 'site_visits', id))).toBe('ok');
    });

    it('removes a cancelled visit, with the why in the removal\'s audit entry, and has no cancelled state', async () => {
      const id = made(await book('dana', 'dana', 'danas'));
      // There is no cancelled mark to set, by the column or by a button.
      expect((await s.change('dana', 'site_visits', id, { state: 'cancelled', cancel_reason: 'x' })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await s.send('dana', 'POST', url('site_visits', `/${String(id)}/actions/cancel`), { from: 'booked', values: { cancel_reason: 'x' } })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await row('dana', 'site_visits', id))?.['state']).toBe('booked');
      // The why is written, then the row is removed.
      expect(said(await s.change('dana', 'site_visits', id, { cancel_reason: 'Petra is off sick' }))).toBe('ok');
      expect(said(await remove('dana', 'site_visits', id))).toBe('ok');
      expect(await row('dana', 'site_visits', id)).toBeNull();
      expect(await row('tessa', 'site_visits', id)).toBeNull();
      expect(await s.rows(`select id from crm_site_visits where id = ${String(id)}`)).toEqual([]);
      const logged = await s.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes', 'actorLabel']).where('entityId', '=', String(id)).where('action', 'like', '%delete%').execute();
      const mine = logged.filter((entry) => JSON.stringify(entry.changes).includes('Petra is off sick'));
      expect(mine, JSON.stringify(logged)).toHaveLength(1);
      expect(String(mine[0]!.actorLabel)).toMatch(/dana/i);
    });

    it('counts a write-up on the visit, and keeps a visit that was written up or made', async () => {
      const id = made(await book('dana', 'dana', 'danas', { starts_at: at(-2) }));
      expect(Number((await row('dana', 'site_visits', id))?.['written'])).toBe(0);
      const note = made(await s.make('dana', 'visit_notes', { visit_id: id, saw: 'Narrow door', said: 'Keep the keypads', next: 'Re-cut the run' }));
      const agreed = made(await s.make('dana', 'visit_agreed', { visit_note_id: note, text: 'Layout by Friday', position: 0 }));
      expect(Number((await row('dana', 'site_visits', id))?.['written'])).toBe(1);
      // Nobody types the count.
      await s.change('dana', 'site_visits', id, { written: 7 });
      expect(Number((await row('dana', 'site_visits', id))?.['written'])).toBe(1);
      // A second write-up of the same visit is refused.
      expect((await s.make('dana', 'visit_notes', { visit_id: id, saw: 'Again' })).statusCode).toBe(409);
      // A written-up visit is not removed.
      expect((await remove('dana', 'site_visits', id)).statusCode).toBe(409);
      // Marked done, it stays whatever is taken off it.
      const done = await s.send('dana', 'POST', url('site_visits', `/${String(id)}/actions/done`), { from: 'booked' });
      expect(done.statusCode, done.body).toBe(200);
      expect(said(await remove('dana', 'visit_agreed', agreed))).toBe('ok');
      // A write-up is not a rep's to remove, her own included (a helper on the deal could otherwise remove the owner's): the CRM admin takes it away.
      expect((await remove('dana', 'visit_notes', note)).statusCode).toBe(403);
      expect(said(await remove('tessa', 'visit_notes', note))).toBe('ok');
      expect(Number((await row('dana', 'site_visits', id))?.['written'])).toBe(0);
      const kept = await remove('dana', 'site_visits', id);
      expect(said(kept)).toBe('409 DELETE_REFUSED');
      expect(said(await remove('tessa', 'site_visits', id))).toBe('409 DELETE_REFUSED');
      // A rep who is not on the deal reads and writes none of its visits' notes (Sam is on this deal since Dana added him, and may).
      expect((await s.make('priya', 'visit_notes', { visit_id: id, saw: 'Not mine' })).statusCode).toBeGreaterThanOrEqual(400);
      expect(await list('priya', 'visit_notes')).toEqual([]);
      expect(await s.rows(`select id from crm_visit_notes where visit_id = ${String(id)}`)).toEqual([]);
    });

    it('lets the manager make cover for people she leads, the admin for anybody who reads deals, and nobody else', async () => {
      // Dana is away; Priya covers. Both are Ivy's.
      const cover = made(await s.make('ivy', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['priya'], starts_on: day(-1), ends_on: day(5), note: 'Dana is on leave' }));
      // Somebody she does not lead, on either side.
      expect((await s.make('ivy', 'covers', { owner_id: s.ids['noor'], cover_id: s.ids['sam'], starts_on: day(40), ends_on: day(44) })).statusCode).toBe(403);
      expect((await s.make('ivy', 'covers', { owner_id: s.ids['sam'], cover_id: s.ids['noor'], starts_on: day(40), ends_on: day(44) })).statusCode).toBe(403);
      // A rep makes none, for herself or anybody; nor does Read-only.
      expect((await s.make('dana', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['sam'], starts_on: day(40), ends_on: day(44) })).statusCode).toBe(403);
      expect((await s.make('grace', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['sam'], starts_on: day(40), ends_on: day(44) })).statusCode).toBe(403);
      // Whoever covers must read deals: the front desk does not, whoever writes.
      const desk = await s.make('tessa', 'covers', { owner_id: s.ids['sam'], cover_id: s.ids['corin'], starts_on: day(40), ends_on: day(44) });
      expect(desk.statusCode, desk.body).toBe(422);
      expect((details(desk)['fields'] as Record<string, { code?: string }>)['cover_id']?.code).toBe('cannot-open');
      // The CRM admin names anybody who does.
      const across = made(await s.make('tessa', 'covers', { owner_id: s.ids['noor'], cover_id: s.ids['sam'], starts_on: day(40), ends_on: day(44) }));
      // From the first day Priya reads Dana's deal as hers; Sam does not (he is on it only as a helper of the earlier test, so use Priya's view of a deal nobody added her to).
      expect(Number((await row('priya', 'deals', deal['danas']!))?.['id'])).toBe(deal['danas']);
      // A rep reads who covers whom and when, and not why.
      const seen = await row('dana', 'covers', cover);
      expect(seen?.['starts_on']).toBeDefined();
      expect(seen?.['note'] ?? null).toBeNull();
      // The covering rep ends nothing and re-dates nothing.
      expect((await s.change('priya', 'covers', cover, { ends_on: day(30) })).statusCode).toBe(403);
      expect((await remove('priya', 'covers', cover)).statusCode).toBe(403);
      // A manager who leads only whoever COVERS (Sam is hers, Noor is not) does not re-date, redirect or remove that cover:
      // each would lend her and her rep another team's book for as long as she liked (the review, 2026-10-14).
      for (const change of [{ starts_on: day(-1) }, { ends_on: null }, { ends_on: day(90) }, { cover_id: s.ids['priya'] }, { cover_id: s.ids['ivy'] }]) {
        expect((await s.change('ivy', 'covers', across, change)).statusCode, JSON.stringify(change)).toBeGreaterThanOrEqual(403);
      }
      expect((await remove('ivy', 'covers', across)).statusCode).toBeGreaterThanOrEqual(403);
      const kept = (await row('tessa', 'covers', across))!;
      expect([String(kept['cover_id']), String(kept['starts_on']).slice(0, 10), String(kept['ends_on']).slice(0, 10)]).toEqual([s.ids['sam'], day(40), day(44)]);
      expect(said(await remove('tessa', 'covers', across))).toBe('ok');
      expect(said(await remove('ivy', 'covers', cover))).toBe('ok');
      // Cancelled: the row is gone, and the lent deal with it, the same moment.
      expect(await row('priya', 'deals', deal['danas']!)).toBeNull();
    });

    it('the review\'s other findings: a write-up is not a rep\'s to remove, a comment stays on its deal, a closed deal takes nobody, two settings have bounds, and the marketer is not told whose a deal is', async () => {
      // A rep, the owner of the visit included, removes no write-up (a helper on the deal could remove the owner's).
      const note = Number((await s.rows('select id from crm_visit_notes order by id'))[0]?.['id']);
      if (Number.isFinite(note)) for (const person of ['dana', 'sam', 'priya']) expect((await remove(person, 'visit_notes', note)).statusCode, person).toBeGreaterThanOrEqual(403);
      // Her own comment stays on its deal and in its thread.
      const company = Number((await s.rows('select id from crm_companies order by id'))[0]!['id']);
      const stage = Number((await s.rows('select id from crm_stages order by position'))[0]!['id']);
      const second = made(await s.make('owner', 'deals', { name: 'second deal', company_id: company, owner_id: s.ids['dana'], stage_id: stage }));
      const comment = made(await s.make('dana', 'comments', { deal_id: deal['danas'], text: 'Where it belongs' }));
      expect((await s.change('dana', 'comments', comment, { deal_id: second })).statusCode).toBeGreaterThanOrEqual(400);
      expect(Number((await s.rows(`select deal_id from crm_comments where id = ${String(comment)}`))[0]!['deal_id'])).toBe(deal['danas']);
      // On a closed deal nobody is added: by its owner, her manager or the admin.
      const won = await s.send('dana', 'POST', url('deals', `/${String(second)}/actions/mark-won`), { from: 'open' });
      expect(won.statusCode, won.body).toBe(200);
      for (const person of ['dana', 'ivy', 'tessa']) {
        expect((await s.make(person, 'deal_members', { deal_id: second, user_id: s.ids['sam'] })).statusCode, `${person} adds`).toBeGreaterThanOrEqual(400);
      }
      expect(await s.rows(`select id from crm_deal_members where deal_id = ${String(second)}`)).toEqual([]);
      // A contact's address is where a quote and its customer's link are mailed: a rep does not change it (she could send a colleague's
      // quote to herself and accept it as the customer); the manager does.
      const petra = contact['petra']!;
      expect((await s.change('dana', 'contacts', petra, { email: 'dana@inbox.test' })).statusCode).toBe(403);
      expect(said(await s.change('dana', 'contacts', petra, { phone: '+44 20 7946 0000' }))).toBe('ok');
      expect(said(await s.change('ivy', 'contacts', petra, { email: 'petra@nordwind.test' }))).toBe('ok');
      // Whose a company is and its territory are not a rep's to change.
      expect((await s.change('dana', 'companies', company, { account_owner_id: s.ids['dana'] })).statusCode).toBe(403);
      // An enquiry goes only to somebody who can work it, by its button and by a plain change alike (Read-only reads enquiries and
      // changes none: given one, it would answer to nobody); the front desk claims none.
      const enquiry = made(await s.make('corin', 'enquiries', { company_name: 'Walk-in', person: 'Ana', source: 'phone' }));
      for (const person of ['corin', 'dana', 'ivy']) {
        const lost = await s.change(person, 'enquiries', enquiry, { passed_to_id: s.ids['grace'] });
        expect(lost.statusCode, `${person}: ${lost.body}`).toBe(422);
        expect(lost.body, person).toContain('cannot-open');
      }
      const toGrace = await s.send('corin', 'POST', url('enquiries', `/${String(enquiry)}/actions/pass`), { from: 'open', values: { passed_to_id: s.ids['grace'] } });
      expect(toGrace.statusCode, toGrace.body).toBeGreaterThanOrEqual(400);
      expect((await s.change('corin', 'enquiries', enquiry, { state: 'claimed' })).statusCode).toBeGreaterThanOrEqual(400);
      const toDana = await s.send('corin', 'POST', url('enquiries', `/${String(enquiry)}/actions/pass`), { from: 'open', values: { passed_to_id: s.ids['dana'] } });
      expect(toDana.statusCode, toDana.body).toBe(200);
      // What needs approval, and how long a quote holds, are the sales manager's to set within bounds.
      const settings = Number((await s.rows('select id from crm_settings'))[0]!['id']);
      for (const bad of [{ approval_threshold_pct: 100 }, { approval_threshold_pct: -1 }, { quote_valid_days: 0 }, { quote_valid_days: 5000 }]) {
        expect((await s.change('ivy', 'settings', settings, bad)).statusCode, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
      }
      expect(said(await s.change('ivy', 'settings', settings, { approval_threshold_pct: 7.5 }))).toBe('ok');
      expect(said(await s.change('ivy', 'settings', settings, { approval_threshold_pct: 5 }))).toBe('ok');
      // The marketer reads of a deal that a company has one and its state, never whose it is. (A rep and the account manager do
      // read whose: a company's profile tells them a colleague has an open deal there, as the plan asks.)
      await s.jobs();
      const marks = await s.rows(`select m.id from crm_deal_marks m join crm_deals d on d.id = m.deal_id where d.owner_id = '${s.ids['sam']!}' order by m.id`);
      expect(marks.length, 'a mark of a deal of Sam\'s').toBeGreaterThan(0);
      expect(Object.keys((await row('lena', 'deal_marks', Number(marks[0]!['id']))) ?? {})).not.toContain('owner_id');
      expect(String((await row('dana', 'deal_marks', Number(marks[0]!['id'])))?.['owner_id'])).toBe(s.ids['sam']);
    });

    it('holds one person\'s book to one cover at a time, open ends included', async () => {
      const first = made(await s.make('ivy', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['priya'], starts_on: day(10), ends_on: day(14) }));
      // The same days, the last day, a span around it: all overlap, whoever covers.
      for (const [from, to] of [[10, 14], [14, 20], [8, 10], [5, 30], [12, 12]] as const) {
        const again = await s.make('ivy', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['sam'], starts_on: day(from), ends_on: day(to) });
        expect(said(again), `${String(from)}–${String(to)}`).toBe('409 BOOKING_TAKEN');
        // The refusal names nothing of the cover in the way.
        expect(again.body).not.toContain(s.ids['priya']!);
      }
      expect(said(await s.make('tessa', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['sam'], starts_on: day(12) }))).toBe('409 BOOKING_TAKEN');
      // The day after is free, and so is another person's book over the same days: Priya may cover two colleagues at once.
      const next = made(await s.make('ivy', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['sam'], starts_on: day(15), ends_on: day(16) }));
      const other = made(await s.make('ivy', 'covers', { owner_id: s.ids['sam'], cover_id: s.ids['priya'], starts_on: day(10), ends_on: day(14) }));
      // Until further notice: it runs on, and nothing later fits beside it.
      const open = made(await s.make('ivy', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['priya'], starts_on: day(20) }));
      expect((await row('ivy', 'covers', open))?.['ends_on'] ?? null).toBeNull();
      expect(said(await s.make('ivy', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['sam'], starts_on: day(200), ends_on: day(201) }))).toBe('409 BOOKING_TAKEN');
      expect(said(await s.make('ivy', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['sam'], starts_on: day(300) }))).toBe('409 BOOKING_TAKEN');
      // New dates are judged the same way: onto the first cover, refused; clear of it, taken.
      expect(said(await s.change('ivy', 'covers', next, { starts_on: day(13), ends_on: day(16) }))).toBe('409 BOOKING_TAKEN');
      expect(said(await s.change('ivy', 'covers', next, { starts_on: day(17), ends_on: day(18) }))).toBe('ok');
      // "End today" on the open one: it ends, and a later cover fits again.
      expect(said(await s.change('ivy', 'covers', open, { ends_on: day(20) }))).toBe('ok');
      const later = made(await s.make('ivy', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['sam'], starts_on: day(200), ends_on: day(201) }));
      for (const id of [first, next, other, open, later]) expect(said(await remove('ivy', 'covers', id))).toBe('ok');
      expect(await list('ivy', 'covers')).toEqual([]);
    });

    it('ends a running cover today, and the lent deals leave the covering rep the day after', async () => {
      const cover = made(await s.make('ivy', 'covers', { owner_id: s.ids['dana'], cover_id: s.ids['priya'], starts_on: day(-3) }));
      expect(Number((await row('priya', 'deals', deal['danas']!))?.['id'])).toBe(deal['danas']);
      // While she covers she books her own visit on the lent deal, and does not move Dana's.
      const danas = made(await book('dana', 'dana', 'danas'));
      const hers = made(await book('priya', 'priya', 'danas'));
      expect((await s.change('priya', 'site_visits', danas, { minutes: 30 })).statusCode).toBeGreaterThanOrEqual(403);
      // A briefing note on the deal, by its owner; the cover is not removed while it holds one.
      const note = await s.make('dana', 'cover_notes', { cover_id: cover, deal_id: deal['danas'], text: 'Petra decides on the 14th.' });
      const noteId = made(note);
      expect((await remove('ivy', 'covers', cover)).statusCode).toBe(409);
      // Ended yesterday (a cover ends with its last day): the deal is no longer hers, by key or in a list.
      expect(said(await s.change('ivy', 'covers', cover, { ends_on: day(-1) }))).toBe('ok');
      expect(await row('priya', 'deals', deal['danas']!)).toBeNull();
      expect((await list('priya', 'deals')).map((one) => Number(one['id']))).toEqual([deal['priyas']]);
      // Its note goes first, then the row.
      expect(said(await remove('ivy', 'cover_notes', noteId))).toBe('ok');
      expect(said(await remove('ivy', 'covers', cover))).toBe('ok');
      expect(said(await remove('dana', 'site_visits', danas))).toBe('ok');
      // Her own visit on a deal she no longer opens is still hers to read and to cancel.
      expect(Number((await row('priya', 'site_visits', hers))?.['id'])).toBe(hers);
      expect(said(await remove('priya', 'site_visits', hers))).toBe('ok');
    });
  });
}
