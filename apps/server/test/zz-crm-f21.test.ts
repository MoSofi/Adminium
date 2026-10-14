// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SALES CRM'S RULES AND E-MAILS OF STAGE 1 (F21), against the whole
 * server on SQLite, Postgres and MySQL, with the app's own manifest and
 * signed in as the people they are about:
 *
 *  - a deal's stage history names, line by line, the stage it left, the stage
 *    it reached and who moved it, also when it moved twice within the minute
 *    the rules wait;
 *  - a notice about a deal opens the app's own screen for somebody who may
 *    open the staff side, and the console's page for somebody who may not;
 *  - a site visit booked, moved and cancelled writes its e-mail to the
 *    visit's contact (the outbox row and the queued mail, never a sent one),
 *    and a visit with earlier messages can still be removed;
 *  - "Say thank you" on a referral writes its e-mail, once;
 *  - a rep's week holds her own sums and her cover of her target; a manager's
 *    the sums of the people she leads and none of another team's;
 *  - however many times a deal moves before the rules run, every move is in
 *    its history (decision 131, by the deal as it was: `{{was.*}}`);
 *  - a site visit's mails go on all three engines (the Postgres fault of a
 *    staff column read as a link is gone);
 *  - a mention names the deal only to somebody who can open it. (Who is told
 *    of an approval asked is in `crm-roles`, which has quotes: it needs the
 *    Invoices & Receipts add-on this file does not load.)
 *
 * To run: copy into `~/Work/lanes/p67/apps/server/test/` as `zz-crm-f21.test.ts`, run, remove.
 */
import { readFileSync } from 'node:fs';

import { automationsRepo, jobsRepo, rolesRepo, teamsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const APP = process.env.CRM_APP ?? `${process.env.HOME}/Work/lanes/p67-app`;
const manifest = () => JSON.parse(readFileSync(`${APP}/whole/manifest.json`, 'utf8')) as Record<string, unknown>;
const DAY = 86_400_000;

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the CRM's rules and e-mails of stage 1, on ${dialect}`, () => {
    let s: WholeServer;
    const stage: Record<string, number> = {};
    let company = 0;
    let contact = 0;
    type Notice = { title: string; body: string | null; actionUrl: string | null; opens?: { appKey: string; path: string }; entity: unknown; kind: string };
    const noticesOf = async (who: string): Promise<Notice[]> => ((await s.get(who, '/api/v1/me/notifications?limit=100')).json() as { data: { items: Notice[] } }).data.items;
    const made = (res: Reply): number => {
      expect(res.statusCode, res.body).toBe(201);
      return Number((res.json() as { data: { id: number } }).data.id);
    };
    const url = (ref: string, rest = ''): string => `/api/v1/data/${s.connectionId}/${s.t(ref)}${rest}`;
    const remove = (who: string, ref: string, id: number): Promise<Reply> => s.send(who, 'DELETE', url(ref, `/${String(id)}?confirm=true`));
    const at = (days: number): string => new Date(Math.floor((Date.now() + days * DAY) / 60_000) * 60_000).toISOString();
    const makeDeal = async (who: string, name: string, owner: string, extra: Record<string, unknown> = {}): Promise<number> =>
      made(await s.make(who, 'deals', { name, company_id: company, contact_id: contact, owner_id: s.ids[owner], stage_id: stage['a'], ...extra }));
    const jobs = (): Promise<void> => s.jobs({ except: ['digest.send'] });
    const switchOn = async (keys: readonly string[]): Promise<void> => {
      const shipped = await automationsRepo(s.meta).listManagedBy('crm', s.connectionId);
      for (const rule of shipped.filter((one) => keys.includes(one.templateKey ?? ''))) expect(said(await s.send('owner', 'PATCH', `/api/v1/automations/${rule.id}`, { enabled: true }))).toBe('ok');
    };
    /** A moment as this engine hands it back, in milliseconds. */
    const when = (value: unknown): number => new Date(dialect === 'mysql' && typeof value === 'string' ? `${value.replace(' ', 'T')}Z` : (value as string | Date)).getTime();
    /** A deal's history as the screens read it: oldest first. */
    const history = async (deal: number): Promise<[number | null, number, string | null][]> => {
      const lines = await s.rows(`select id, from_stage_id, to_stage_id, by_id, at from crm_deal_stage_changes where deal_id = ${String(deal)}`);
      // By its moment; two lines of the same moment (an engine that keeps whole seconds) by the chain they make.
      const sorted = [...lines].sort((one, two) => when(one['at']) - when(two['at']) || (Number(one['to_stage_id']) === Number(two['from_stage_id']) ? -1 : Number(two['to_stage_id']) === Number(one['from_stage_id']) ? 1 : Number(one['id']) - Number(two['id'])));
      return sorted.map((line) => [line['from_stage_id'] === null ? null : Number(line['from_stage_id']), Number(line['to_stage_id']), line['by_id'] as string | null]);
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, manifest(), {
        people: { dana: ['rep'], priya: ['rep'], noor: ['rep'], zed: ['rep'], ivy: ['sales-manager'], omar: ['sales-manager'], tessa: ['admin'], ada: ['ops-manager'], hugo: ['account-manager'] },
        smtp: true,
      });
      // Ivy leads North (Dana, Priya); Omar leads South (Noor). Tessa, the CRM admin, leads the team Ivy is in.
      const teams = teamsRepo(s.meta);
      for (const [name, lead, members] of [['North', 'ivy', ['dana', 'priya']], ['South', 'omar', ['noor']], ['Leads', 'tessa', ['ivy', 'omar']]] as const) {
        const team = await teams.create(name);
        await teams.setMember(team.id, s.ids[lead]!, true);
        for (const member of members) await teams.setMember(team.id, s.ids[member]!, false);
      }
      for (const [key, label, odds, position] of [['a', 'Qualified', 0.25, 2], ['b', 'Proposal', 0.5, 3], ['c', 'Negotiation', 0.75, 4]] as const) stage[key] = made(await s.make('owner', 'stages', { label, odds, position }));
      company = made(await s.make('owner', 'companies', { name: 'Fernway Clinics' }));
      contact = made(await s.make('owner', 'contacts', { company_id: company, name: 'Ana Belova', email: 'ana.belova@fernway-clinics.com', may_email: true }));
      await jobs();
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('a deal\'s history names the stage it left, the stage it reached and who moved it, also when it moves twice before the rules run', async () => {
      const deal = await makeDeal('dana', 'Ward chairs', 'dana');
      await jobs();
      // The line of its making: from no stage, by who made it.
      expect(await history(deal)).toEqual([[null, stage['a'], s.ids['dana']]]);
      // Dana moves it on, and within the minute her manager moves it again. Nothing has run in between.
      expect(said(await s.change('dana', 'deals', deal, { stage_id: stage['b'] }))).toBe('ok');
      expect(said(await s.change('ivy', 'deals', deal, { stage_id: stage['c'] }))).toBe('ok');
      expect(await history(deal)).toHaveLength(1);
      await jobs();
      expect(await history(deal)).toEqual([
        [null, stage['a'], s.ids['dana']],
        [stage['a'], stage['b'], s.ids['dana']],
        [stage['b'], stage['c'], s.ids['ivy']],
      ]);
      // Each line's moment is the move's own, not the minute the rule ran: the last is when the deal entered its stage.
      const entered = when((await s.rows(`select entered_stage_at from crm_deals where id = ${String(deal)}`))[0]!['entered_stage_at']);
      const moments = (await s.rows(`select at from crm_deal_stage_changes where deal_id = ${String(deal)}`)).map((line) => when(line['at']));
      expect(Math.max(...moments)).toBe(entered);
      expect(Date.now() - Math.min(...moments)).toBeLessThan(120_000);
      // The rules running again write nothing twice.
      await jobs();
      expect(await history(deal)).toHaveLength(3);
      // One move, the usual case: one line.
      expect(said(await s.change('dana', 'deals', deal, { stage_id: stage['a'] }))).toBe('ok');
      await jobs();
      // (MySQL keeps whole seconds: lines of one second are not told apart by their moment, so this asks for the line, not its place.)
      expect(await history(deal)).toContainEqual([stage['c'], stage['a'], s.ids['dana']]);
      expect(await history(deal)).toHaveLength(4);
    });

    it('a deal made and moved twice within the same minute still opens where it opened, by who made it', async () => {
      const deal = await makeDeal('dana', 'Reception desk', 'dana');
      expect(said(await s.change('dana', 'deals', deal, { stage_id: stage['b'] }))).toBe('ok');
      expect(said(await s.change('ivy', 'deals', deal, { stage_id: stage['c'] }))).toBe('ok');
      await jobs();
      expect(await history(deal)).toEqual([
        [null, stage['a'], s.ids['dana']],
        [stage['a'], stage['b'], s.ids['dana']],
        [stage['b'], stage['c'], s.ids['ivy']],
      ]);
      await jobs();
      expect(await history(deal)).toHaveLength(3);
    });

    it('of three moves before the rules run, all three are written, each true: the oldest is no longer lost (decision 131)', async () => {
      /*
       * MySQL keeps a moment to the whole second, and Adminium takes two changes of a row that carry the same moment of
       * change as ONE occurrence of a rule (the run for the later change is not queued). Two moves within one second are
       * still both written (the first run reads the deal's last move and the one before it); of three within one second,
       * the oldest is lost, as no run is left whose "before" holds it. Not the app's to change; said in the report. So on
       * MySQL the moves here are a second apart (still all before the rules run); on SQLite and Postgres they follow at once.
       */
      const apart = async (): Promise<void> => {
        if (dialect === 'mysql') await new Promise((done) => setTimeout(done, 1100));
      };
      const deal = await makeDeal('dana', 'Lockers', 'dana');
      await jobs();
      expect(said(await s.change('dana', 'deals', deal, { stage_id: stage['b'] }))).toBe('ok');
      await apart();
      expect(said(await s.change('ivy', 'deals', deal, { stage_id: stage['c'] }))).toBe('ok');
      await apart();
      expect(said(await s.change('dana', 'deals', deal, { stage_id: stage['a'] }))).toBe('ok');
      await jobs();
      // Each move's run reads the deal as it was before that move: the run of the second move writes the first.
      // (MySQL keeps whole seconds and the moves make a ring, so the lines are compared as a set, not in order.)
      const sorted = (lines: (number | string | null | undefined)[][]) => lines.map((line) => JSON.stringify(line)).sort();
      expect(sorted(await history(deal))).toEqual(sorted([
        [null, stage['a'], s.ids['dana']],
        [stage['a'], stage['b'], s.ids['dana']],
        [stage['b'], stage['c'], s.ids['ivy']],
        [stage['c'], stage['a'], s.ids['dana']],
      ]));
      // Each move's moment is its own: four lines, four moments no later than the last move, none written twice.
      const lines = await s.rows(`select at, move_key from crm_deal_stage_changes where deal_id = ${String(deal)}`);
      const entered = when((await s.rows(`select entered_stage_at from crm_deals where id = ${String(deal)}`))[0]!['entered_stage_at']);
      expect(Math.max(...lines.map((line) => when(line['at'])))).toBe(entered);
      expect(new Set(lines.filter((line) => line['move_key'] !== null).map((line) => line['move_key'])).size).toBe(3);
      await jobs();
      expect(await history(deal)).toHaveLength(4);
      // Five moves at once, the rules run once: five lines and the opening one.
      const many = await makeDeal('dana', 'Coat hooks', 'dana');
      await jobs();
      for (const [who, to] of [['dana', 'b'], ['ivy', 'c'], ['dana', 'a'], ['ivy', 'b'], ['dana', 'c']] as const) {
        expect(said(await s.change(who, 'deals', many, { stage_id: stage[to] }))).toBe('ok');
        await apart();
      }
      await jobs();
      expect(sorted(await history(many))).toEqual(sorted([
        [null, stage['a'], s.ids['dana']],
        [stage['a'], stage['b'], s.ids['dana']],
        [stage['b'], stage['c'], s.ids['ivy']],
        [stage['c'], stage['a'], s.ids['dana']],
        [stage['a'], stage['b'], s.ids['ivy']],
        [stage['b'], stage['c'], s.ids['dana']],
      ]));
    });

    it('nobody who moves a deal writes where it came from or who moved it', async () => {
      const deal = await makeDeal('dana', 'Booths', 'dana');
      await jobs();
      for (const forged of [{ stage_kept_id: stage['c'] }, { stage_from_id: stage['c'] }, { stage_by_id: s.ids['ivy'] }, { prev_by_id: s.ids['ivy'] }, { move_key: 'made-up' }, { was_move_key: 'made-up' }, { was_from_stage: String(stage['c']) }]) {
        const res = await s.change('dana', 'deals', deal, { stage_id: stage['b'], ...forged });
        // Refused, or taken with the forged value dropped: either way the deal says what happened.
        if (res.statusCode === 200) expect(said(await s.change('dana', 'deals', deal, { stage_id: stage['a'] }))).toBe('ok');
      }
      await jobs();
      for (const [from, , by] of (await history(deal)).slice(1)) {
        expect([stage['a'], stage['b']]).toContain(from);
        expect(by).toBe(s.ids['dana']);
      }
      const row = (await s.rows(`select move_key from crm_deals where id = ${String(deal)}`))[0]!;
      expect(String(row['move_key'])).toMatch(/^[0-9a-f]{64}$/);
    });

    it('a notice about a deal opens the app\'s own screen for somebody who opens the staff side, and the console\'s for somebody who does not', async () => {
      await switchOn(['deal-handed-over']);
      const deal = await makeDeal('owner', 'Fourth-floor desk rows', 'noor');
      await jobs();
      expect(said(await s.change('owner', 'deals', deal, { owner_id: s.ids['zed'] }))).toBe('ok');
      await jobs();
      const told = (await noticesOf('zed')).filter((notice) => notice.title === 'Handed to you: Fourth-floor desk rows');
      expect(told).toHaveLength(1);
      // A rep: led to the deal's room in the app, by a direct call as him.
      expect(told[0]).toMatchObject({ actionUrl: `/apps/crm/staff/deals/${String(deal)}`, opens: { appKey: 'crm', path: `/deals/${String(deal)}` } });
      // The same notice once he holds no role of the app: no screen of the app is his to open.
      const roles = rolesRepo(s.meta);
      const rep = (await roles.findBySlug('crm-rep'))!;
      await roles.removeFromUser(s.ids['zed']!, rep.id);
      const after = (await noticesOf('zed')).find((notice) => notice.title === 'Handed to you: Fourth-floor desk rows')!;
      console.log(`[f21 ${dialect}] a notice's address for somebody with no role of the app: ${String(after.actionUrl)}`);
      expect(after.actionUrl === null || !after.actionUrl.startsWith('/apps/crm/'), String(after.actionUrl)).toBe(true);
      expect(after).not.toHaveProperty('opens');
      await roles.assignToUser(s.ids['zed']!, rep.id);
    });

    it('a site visit booked, moved and cancelled writes the customer its e-mail each time, and a visit with messages can be removed', async () => {
      await s.emails();
      const deal = await makeDeal('dana', 'Sample chairs', 'dana');
      const first = at(3);
      const visit = made(await s.make('dana', 'site_visits', { deal_id: deal, contact_id: contact, rep_id: s.ids['dana'], starts_at: first, minutes: 45, purpose: 'Leave two sample chairs with the ward team' }));
      await jobs();
      const rows = async (): Promise<Record<string, unknown>[]> => s.rows(`select * from crm_outbox where deal_id = ${String(deal)} order by id`);
      expect((await rows()).map((row) => [row['kind'], row['to'], Number(row['visit_id']), Number(row['contact_id'])])).toEqual([['visit-confirmed', 'ana.belova@fernway-clinics.com', visit, contact]]);
      // Moved: one more, keeping the time it had. It waits a quarter of an hour, taking in every move meanwhile, so moving a
      // visit again and again mails the customer once a window, not once a move (the attacker's review).
      expect(said(await s.change('dana', 'site_visits', visit, { starts_at: at(5) }))).toBe('ok');
      // A save that moves nothing writes nothing.
      expect(said(await s.change('dana', 'site_visits', visit, { note: 'Ring the bell at the side door' }))).toBe('ok');
      await jobs();
      expect((await rows()).map((row) => row['kind'])).toEqual(['visit-confirmed', 'visit-moved']);
      expect(String((await rows())[1]!['was'])).toContain('starts_at');
      expect([(await rows())[1]!['status'], (await rows())[1]!['due_at'] === null]).toEqual(['queued', false]);
      for (const hour of [6, 7, 8]) expect(said(await s.change('dana', 'site_visits', visit, { starts_at: at(hour) }))).toBe('ok');
      await jobs();
      expect((await rows()).map((row) => row['kind'])).toEqual(['visit-confirmed', 'visit-moved']);
      // The window ends (the test is the clock): the next sweep sends the one message.
      await s.rows(`update crm_outbox set due_at = '${dialect === 'mysql' ? '2000-01-01 00:00:00' : '2000-01-01T00:00:00.000Z'}' where kind = 'visit-moved' and deal_id = ${String(deal)}`);
      await jobsRepo(s.meta).enqueue({ kind: 'app-outbox-send', payload: { app: 'crm' }, dedupeKey: `app-outbox-send:crm:f21-window-${dialect}` });
      await jobs();
      expect((await rows()).find((row) => row['kind'] === 'visit-moved')!['status']).not.toBe('queued');
      // Cancelled, which removes it: the visit has two messages, and goes all the same.
      expect(said(await remove('dana', 'site_visits', visit))).toBe('ok');
      expect(await s.rows(`select id from crm_site_visits where id = ${String(visit)}`)).toEqual([]);
      await jobs();
      const all = await rows();
      expect(all.map((row) => row['kind'])).toEqual(['visit-confirmed', 'visit-moved', 'visit-cancelled']);
      // The log keeps its lines, each without the visit that is gone; the cancellation knows who to tell and what it was.
      for (const row of all) expect(row['visit_id']).toBeNull();
      expect([all[2]!['to'], Number(all[2]!['contact_id'])]).toEqual(['ana.belova@fernway-clinics.com', contact]);
      expect(String(all[2]!['was'])).toContain('Leave two sample chairs');
      // Every message goes, on all three engines. (On Postgres "booked" and "moved" used to fail: the sender read the visit's
      // `rep_id`, a staff column, as a link to the rep profiles and compared a person's id with a whole number. Fixed in
      // Adminium: a staff column is never a guessed link.)
      for (const row of all) expect(['sent', 'queued'], `${String(row['kind'])}: ${String(row['error'])}`).toContain(row['status']);

      // The mails as they were queued (nothing is sent: nothing listens).
      const queued = (await s.emails()).filter((mail) => mail.to === 'ana.belova@fernway-clinics.com');
      const mails = queued;
      expect(mails.map((mail) => mail.templateKey)).toEqual(['crm-visit-confirmed', 'crm-visit-moved', 'crm-visit-cancelled']);
      const [confirmed, moved, cancelled] = mails;
      expect(confirmed!.subject).toMatch(/^Your visit on .+ is confirmed$/);
      expect(confirmed!.text).toContain('Hello Ana, we will visit you on');
      expect(confirmed!.text).toContain('Fernway Clinics');
      expect(confirmed!.text).toContain('Leave two sample chairs with the ward team');
      expect(moved!.text).toContain('Hello Ana, the visit that was on');
      expect(moved!.text).toContain('It was');
      expect(cancelled!.subject).toMatch(/^Your visit on .+ is cancelled$/);
      expect(cancelled!.text).toContain('will not take place');
      expect(cancelled!.text).toContain('Leave two sample chairs with the ward team');
      // No mail carries a number of ours, a stage or the placeholder it was written with.
      for (const mail of mails) expect(`${mail.subject} ${mail.text}`).not.toMatch(/\{\{|Qualified|Proposal|Negotiation/);
    });

    it('a visit moved and then cancelled within the quarter-hour tells the customer it is cancelled, not that it moved', async () => {
      await s.emails();
      const deal = await makeDeal('dana', 'Waiting room sofas', 'dana');
      const visit = made(await s.make('dana', 'site_visits', { deal_id: deal, contact_id: contact, rep_id: s.ids['dana'], starts_at: at(3), minutes: 30, purpose: 'Measure the waiting room' }));
      await jobs();
      expect(said(await s.change('dana', 'site_visits', visit, { starts_at: at(4) }))).toBe('ok');
      expect(said(await remove('dana', 'site_visits', visit))).toBe('ok');
      await jobs();
      const all = await s.rows(`select kind, status from crm_outbox where deal_id = ${String(deal)} order by id`);
      expect(all.map((row) => [row['kind'], row['status'] === 'skipped'])).toEqual([['visit-confirmed', false], ['visit-moved', true], ['visit-cancelled', false]]);
    });

    it('takes no web address, e-mail address or handle in what a customer e-mail repeats: a visit\'s purpose, a referral\'s code', async () => {
      const deal = await makeDeal('dana', 'Reception desk', 'dana');
      for (const purpose of ['See https://evil.example now', 'Write to pay@evil.example', 'Ask @evil on the day']) {
        const res = await s.make('dana', 'site_visits', { deal_id: deal, contact_id: contact, rep_id: s.ids['dana'], starts_at: at(3), minutes: 30, purpose });
        expect(res.statusCode, purpose).toBe(422);
        expect(res.body, purpose).toContain('plain-text');
      }
      // A rep writes no referral at all (no screen of hers does; the account manager thanks).
      expect((await s.make('dana', 'referrals', { from_contact_id: contact, referred_name: 'Somebody', introduced_on: '2026-01-05' })).statusCode).toBe(403);
      const ref = made(await s.make('hugo', 'referrals', { from_contact_id: contact, referred_name: 'Somebody', introduced_on: '2026-01-05' }));
      expect((await s.change('dana', 'referrals', ref, { reward: 'THANKS' })).statusCode).toBe(403);
      expect((await s.change('hugo', 'referrals', ref, { reward: 'Call 0800 123 456 789 for your code' })).statusCode).toBe(422);
      expect((await s.change('hugo', 'referrals', ref, { reward: 'see evil.example/code' })).statusCode).toBe(422);
      await s.rows(`delete from crm_referrals where id = ${String(ref)}`);
    });

    it('a visit that names no contact tells the deal\'s contact', async () => {
      await s.emails();
      const deal = await makeDeal('dana', 'Canteen benches', 'dana');
      const visit = made(await s.make('dana', 'site_visits', { deal_id: deal, rep_id: s.ids['dana'], starts_at: at(2), minutes: 30, purpose: 'Measure the canteen' }));
      await jobs();
      const rows = await s.rows(`select kind, ${dialect === 'mysql' ? '`to`' : '"to"'} as addr from crm_outbox where deal_id = ${String(deal)} order by id`);
      expect(rows.map((row) => [row['kind'], row['addr']])).toEqual([['visit-confirmed', 'ana.belova@fernway-clinics.com']]);
      expect(visit).toBeGreaterThan(0);
    });

    it('"Say thank you" on a referral writes its e-mail to who made the introduction, once, with the code when there is one', async () => {
      await s.emails();
      const plain = made(await s.make('hugo', 'referrals', { from_contact_id: contact, referred_name: 'Somebody at Cobalt Legal', introduced_on: '2025-12-09' }));
      const coded = made(await s.make('hugo', 'referrals', { from_contact_id: contact, referred_name: 'Somebody at Low Orbit', introduced_on: '2026-02-03' }));
      await jobs();
      expect(await s.rows('select id from crm_outbox where referral_id is not null')).toEqual([]);
      // What the Referrals screen's button writes: the moment, and with it a code if there is one.
      expect(said(await s.change('hugo', 'referrals', plain, { thanked_at: new Date().toISOString() }))).toBe('ok');
      expect(said(await s.change('hugo', 'referrals', coded, { thanked_at: new Date().toISOString(), reward: 'THANKYOU-ANA' }))).toBe('ok');
      await jobs();
      // Pressing again, or changing the note later, writes nothing more.
      expect(said(await s.change('hugo', 'referrals', plain, { thanked_at: new Date(Date.now() + 60_000).toISOString() }))).toBe('ok');
      await jobs();
      const rows = await s.rows('select kind, referral_id, contact_id from crm_outbox where referral_id is not null order by id');
      expect(rows.map((row) => [row['kind'], Number(row['referral_id']), Number(row['contact_id'])])).toEqual([['referral-thanks', plain, contact], ['referral-thanks', coded, contact]]);
      // Who thanked is the server's to say.
      expect((await s.rows(`select thanked_by_id from crm_referrals where id = ${String(plain)}`))[0]!['thanked_by_id']).toBe(s.ids['hugo']);
      const mails = (await s.emails()).filter((mail) => mail.templateKey === 'crm-referral-thanks');
      expect(mails.map((mail) => [mail.to, mail.subject])).toEqual([['ana.belova@fernway-clinics.com', 'Thank you for the introduction'], ['ana.belova@fernway-clinics.com', 'Thank you for the introduction']]);
      expect(mails[0]!.text).toContain('Hello Ana, thank you for the introduction you made on');
      expect(mails[0]!.text).not.toContain('code');
      expect(mails[1]!.text).toContain('THANKYOU-ANA');
      // The customer rule: never the name of whoever was introduced.
      for (const mail of mails) expect(mail.text).not.toMatch(/Cobalt|Low Orbit|\{\{/);
    });

    it('a rep\'s week holds her own sums and her cover of her target; a manager\'s the sums of the people she leads, and none of another team\'s', async () => {
      await switchOn(['week-rep', 'week-manager']);
      await s.emails();
      await s.meta.db.deleteFrom('adminium_jobs').where('kind', '=', 'digest.send').execute();
      // A clean slate of deals, so every figure below is one this test wrote.
      await s.rows('delete from crm_outbox');
      for (const table of ['crm_site_visits', 'crm_deal_stage_changes', 'crm_deal_marks', 'crm_follow_ups', 'crm_referrals', 'crm_deals']) await s.rows(`delete from ${table}`);
      const year = new Date().getUTCFullYear();
      // Dana: 40,000 at 50 % and 10,000 at 25 %, and 8,000 won. Priya: 20,000 at 50 %. Noor, of the other team: 90,000 at 50 %.
      const danaBig = await makeDeal('owner', 'Atrium', 'dana', { stage_id: stage['b'], typed_amount: 40000 });
      await makeDeal('owner', 'Loft', 'dana', { stage_id: stage['a'], typed_amount: 10000 });
      const won = await makeDeal('owner', 'Yard', 'dana', { stage_id: stage['c'], typed_amount: 8000 });
      expect(said(await s.change('owner', 'deals', won, { state: 'won' }))).toBe('ok');
      await makeDeal('owner', 'Harbour', 'priya', { stage_id: stage['b'], typed_amount: 20000 });
      await makeDeal('owner', 'Depot', 'noor', { stage_id: stage['b'], typed_amount: 90000 });
      for (const [rep, amount] of [['dana', 50000], ['priya', 40000], ['noor', 100000]] as const) made(await s.make('owner', 'targets', { rep_id: s.ids[rep], year, amount }));
      made(await s.make('owner', 'follow_ups', { deal_id: danaBig, owner_id: s.ids['dana'], due_at: at(-2), text: 'Send the revised layout', kind: 'step' }));
      await jobs();
      await s.tick();
      await s.jobs({ all: true });
      const mails = await s.emails();
      const to = (who: string) => mails.filter((mail) => mail.to === `${who}@crm.test` && mail.templateKey.startsWith('crm-week-'));
      const figure = (text: string): string => text.replace(/[^0-9A-Za-z%.,]+/g, ' ');

      // Dana: 2 open deals, 22,500 weighted (20,000 + 2,500), 50,000 at full value; toward her target 30,500 of 50,000, 61 %.
      expect(to('dana')).toHaveLength(1);
      const danas = figure(to('dana')[0]!.text);
      expect(to('dana')[0]!.templateKey).toBe('crm-week-rep');
      expect(to('dana')[0]!.subject).toBe('Your week, Dana');
      expect(danas).toContain('Your open deals 2');
      expect(danas).toMatch(/22,500(\.00)? weighted and .{0,4}50,000(\.00)? at full value/);
      expect(danas).toMatch(/30,500/);
      expect(danas).toMatch(/61 ?%/);
      expect(danas).toContain('Send the revised layout');
      for (const other of ['Harbour', 'Depot', '90,000', '45,000']) expect(danas, other).not.toContain(other);

      // Priya: her one deal, 10,000 weighted of a 40,000 target, 25 %.
      const priyas = figure(to('priya')[0]!.text);
      expect(priyas).toMatch(/10,000(\.00)? weighted and .{0,4}20,000(\.00)? at full value/);
      expect(priyas).toMatch(/25 ?%/);
      for (const other of ['Atrium', 'Depot', 'Loft']) expect(priyas, other).not.toContain(other);

      // Ivy leads Dana and Priya: 3 open deals, 32,500 weighted, 70,000 at full value; 40,500 toward 90,000, 45 %.
      expect(to('ivy')).toHaveLength(1);
      const ivys = figure(to('ivy')[0]!.text);
      expect(to('ivy')[0]!.templateKey).toBe('crm-week-manager');
      expect(ivys).toMatch(/32,500(\.00)? weighted and .{0,4}70,000(\.00)? at full value/);
      expect(ivys).toContain('Dana');
      expect(ivys).toContain('Priya');
      expect(ivys).toMatch(/40,500/);
      expect(ivys).toMatch(/90,000/);
      expect(ivys).toMatch(/45 ?%/);
      expect(ivys).toContain('Send the revised layout');
      // …and nothing of the other team: not the rep, not the deal, not a sum that holds it.
      for (const other of ['Noor', 'Depot', '45,000', '77,500', '160,000', '100,000']) expect(ivys, other).not.toContain(other);

      // Omar leads Noor: her 45,000 weighted of 100,000, 45 %, and none of Ivy's team.
      const omars = figure(to('omar')[0]!.text);
      expect(omars).toMatch(/45,000(\.00)? weighted and .{0,4}90,000(\.00)? at full value/);
      expect(omars).toContain('Noor');
      for (const other of ['Dana', 'Priya', 'Atrium', 'Harbour', '32,500']) expect(omars, other).not.toContain(other);
      for (const who of ['dana', 'ivy']) expect(to(who)[0]!.text, who).not.toContain('{{');
    });

    it('a mention names the deal only to somebody who can open it: the table alone to anybody else', async () => {
      const deal = await makeDeal('dana', 'Quiet-room pods', 'dana');
      expect((await s.make('dana', 'comments', { deal_id: deal, text: `@[Ada](${s.ids['ada']!}) @[Ivy](${s.ids['ivy']!}) can the crew fit this in August?` })).statusCode).toBe(201);
      const [adas] = (await noticesOf('ada')).filter((one) => one.kind === 'mention');
      // Ada, the operations manager, reads no deal: no way in, and no name of the deal; only what kind of record it is.
      expect(adas).toMatchObject({ title: 'Dana mentioned you', actionUrl: null, entity: null });
      expect(adas!.body ?? '').not.toContain('Quiet-room pods');
      expect(adas!.body ?? '').not.toContain(String(deal));
      expect((adas!.body ?? '').trim()).not.toBe('');
      // Ivy leads Dana and opens the deal: she is told its name and led to its room in the app.
      const [ivys] = (await noticesOf('ivy')).filter((one) => one.kind === 'mention' && (one.body ?? '').includes('Quiet-room pods'));
      expect(ivys).toMatchObject({ title: 'Dana mentioned you', actionUrl: `/apps/crm/staff/deals/${String(deal)}` });
      // Neither is told what was written.
      for (const notice of [adas, ivys]) expect(JSON.stringify(notice)).not.toContain('August');
    });
  });
}
