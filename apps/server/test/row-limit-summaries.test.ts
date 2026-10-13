// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A summary is mail the system writes to a person: it may tell her no row,
 * no name, no count and no sum her own signed-in reads would not. Proved
 * here against the whole server on every engine, in the row-limit world.
 *
 * North is led by Mara, with Dana and Omar; South by Lena, with Sam (and
 * Mara, who sits there and leads nothing). The clock is the real one, so
 * Dana covers Lena and helps on Lena's deal 5: her READS reach deals 1, 2, 5
 * and 9, and her summary is still of 1 and 2.
 *
 *   all deals      Dana 42,000 (1, 2)   Omar 13,000 (3, 4)   North 55,000
 *                  Lena 60,000 (5, 9)   Sam  22,000 (6, 8)   South 82,000
 *   targets, now   Dana 84,000   Omar 52,000   Lena 100,000   Sam 44,000
 *   cover          Dana 50%   Omar 25%   North 40%   Lena 60%   Sam 50%   South 57%
 */
import { parseDatabaseModel } from '@adminium/engine';
import { emailTemplatesRepo, jobsRepo, notificationSchedulesRepo, overridesRepo, permissionsRepo, rolesRepo, settingsRepo, snapshotsRepo, teamsRepo, userPrefsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scanDueSchedules } from '../src/automations/schedule.js';
import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { TEST_SECRET } from './helpers.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
const TEAM = { reach: 'team' } as const;

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a summary holds its reader's own reach or nothing [${dialect}]`, () => {
    let w: World;
    let targets: string;
    /** The rule for reps, managers and readers; and one that writes to managers alone. */
    let rule: string;
    let managersOnly: string;
    const seen = new Set<string>();
    const year = new Date().getUTCFullYear();

    /** Every mail queued since the last look, taken off the worker's hands. */
    const mails = async (): Promise<Mail[]> => {
      const rows = await w.meta.db.selectFrom('adminium_jobs').select(['id', 'payload']).where('kind', '=', 'email.send').orderBy('createdAt', 'asc').execute();
      const out: Mail[] = [];
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        await w.meta.db.updateTable('adminium_jobs').set({ status: 'cancelled' } as never).where('id', '=', row.id).execute();
        const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { envelope: string };
        out.push(JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as Mail);
      }
      return out;
    };
    type Reply = { statusCode: number; body: string; headers: Record<string, unknown> };
    const cookieOf = async (who: PersonName | 'owner'): Promise<string> => (who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
    const call = async (who: PersonName | 'owner' | null, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>): Promise<Reply> =>
      w.app.inject({ method, url: `/api/v1/${url}`, headers: who === null ? {} : { cookie: await cookieOf(who) }, ...(payload === undefined ? {} : { payload }) }) as unknown as Reply;
    /** "Send me mine now", through its own door, and the one mail it made. Three an hour a person and rule: used sparingly. */
    const ask = async (who: PersonName, id: string = rule): Promise<Mail> => {
      await mails();
      const res = await call(who, 'POST', `me/summaries/${id}/send`);
      expect(res.statusCode, res.body).toBe(200);
      expect((JSON.parse(res.body) as { data: { sent: boolean } }).data.sent).toBe(true);
      const made = await mails();
      expect(made.map((mail) => mail.to)).toEqual([`${who}@firm.test`]);
      return made[0]!;
    };
    /** The clock reaches one rule: its run is worked, and with it every summary that is due at once. */
    const tick = async (id: string): Promise<void> => {
      await w.meta.db.updateTable('adminium_automations').set({ nextRunAt: null }).execute();
      await w.meta.db.updateTable('adminium_automations').set({ nextRunAt: 1 }).where('id', '=', id).execute();
      await scanDueSchedules({ meta: w.meta, manager: w.manager, enqueue: (input) => jobsRepo(w.meta).enqueue(input) });
      await w.jobs();
    };
    /** Work the summaries that wait for the hour their reader chose, as the worker would when it comes. */
    const sendQueued = async (): Promise<Mail[]> => {
      await w.meta.db.updateTable('adminium_jobs').set({ runAt: 0 } as never).where('kind', '=', 'digest.send').where('status', '=', 'pending' as never).execute();
      await w.jobs();
      return mails();
    };
    /** The rule runs by itself: one job a person, each run as the worker would. */
    const run = async (id: string = rule): Promise<Mail[]> => {
      await mails();
      await tick(id);
      return sendQueued();
    };
    /** One person's mail of a run of the rule; none when the rule had nothing to write them. */
    const sentTo = async (who: PersonName, id: string = rule): Promise<Mail | undefined> => (await run(id)).find((mail) => mail.to === `${who}@firm.test`);
    const mine = async (who: PersonName, id: string = rule): Promise<Mail> => {
      const mail = await sentTo(who, id);
      expect(mail, `a summary for ${who}`).toBeDefined();
      return mail!;
    };
    const SOUTH = ['Lena', 'Sam', 'Deal 5', 'Deal 6', 'Deal 8', 'Deal 9', 'Deal 7', '82,000.00', '60,000.00', '22,000.00', '20,000.00', '15,000.00', '7,000.00', '40,000.00', '100,000.00', '44,000.00', '144,000.00', '57%', '60%'];
    const NORTH = ['Dana', 'Omar', 'Deal 1', 'Deal 2', 'Deal 3', 'Deal 4', '55,000.00', '42,000.00', '13,000.00', '12,000.00', '30,000.00', '8,000.00', '5,000.00', '84,000.00', '52,000.00', '136,000.00', '25%', '40%'];
    /** Not a word of these, in the text or the page; a figure is looked for as a whole number, not inside another. */
    const holdsNone = (mail: Mail, words: readonly string[]): void => {
      for (const word of words) {
        const whole = /^\d[\d.,%]*$/.test(word) ? new RegExp(`(?<![\\d,.])${word.replace(/[.]/g, '\\.')}(?!\\d)`) : new RegExp(word);
        expect(mail.text, `${word} in the text`).not.toMatch(whole);
        // The page is full of "100%" of its own making: a share is looked for in the text alone.
        if (!word.includes('%')) expect(mail.html, `${word} in the page`).not.toMatch(whole);
      }
    };
    const section = (key: string, more: Record<string, unknown> = {}) => ({ key, table: w.id('deals'), owner: 'owner_id', where: [], orderBy: { column: 'id', dir: 'asc' }, limit: 50, ...more });
    const graph = (roles: string[], sections: Record<string, unknown>[], templateKey = 'firm-week') => ({
      version: 1,
      nodes: [
        { id: 't', kind: 'trigger', title: 'Each week' },
        { id: 'sum', kind: 'action', title: 'Write each person their week', action: { kind: 'digest', templateKey, to: { roles }, sections, sendEmpty: false } },
      ],
    });
    const trigger = () => ({ kind: 'schedule', connectionId: w.connectionId, schedule: { kind: 'weekly', time: '07:00', dayOfWeek: 1, timezone: 'UTC' } });
    const roleId = async (slug: string): Promise<string> => (await rolesRepo(w.meta).findBySlug(slug))!.id;

    beforeAll(async () => {
      w = await world(dialect);
      await settingsRepo(w.meta).set(
        'email.smtp',
        { host: '127.0.0.1', port: 9, user: 'postmaster', passEncrypted: encryptSecret('not-a-real-password', emailSecretKey(TEST_SECRET)), from: 'Firm <no-reply@firm.test>', secure: false },
        { updatedBy: null },
      );
      // What each rep is to book this year, and a row of last year's that must never be counted.
      await w.run(`CREATE TABLE targets (id INTEGER PRIMARY KEY, rep_id VARCHAR(36), year INTEGER NOT NULL, amount INTEGER NOT NULL, note VARCHAR(40))`);
      const goals: [number, PersonName, number, number][] = [
        [1, 'dana', year, 84000],
        [2, 'omar', year, 52000],
        [3, 'lena', year, 100000],
        [4, 'sam', year, 44000],
        [5, 'dana', year - 1, 999000],
      ];
      for (const [key, who, of, amount] of goals) await w.run(`INSERT INTO targets (id, rep_id, year, amount) VALUES (${String(key)}, '${w.people[who]}', ${String(of)}, ${String(amount)})`);
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      targets = parseDatabaseModel((await snapshotsRepo(w.meta).latest(w.connectionId))!.schema).tables.find((one) => one.name === 'targets')!.id;
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.staff', tableName: targets, columnName: 'rep_id', value: { staff: true }, origin: 'user' });
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'table.belongs', tableName: targets, value: { ways: [{ column: 'rep_id', set: 'team' }] }, origin: 'user' });

      await w.role('rep', { deals: { actions: ['read'], rows: { read: OWN } } });
      await w.role('manager', { deals: { actions: ['read'], rows: { read: TEAM } } });
      await w.role('reader', { deals: { actions: ['read'] } });
      const grant = async (slug: string, actions: Record<string, unknown>): Promise<void> => {
        await permissionsRepo(w.meta).grant(await roleId(slug), 'table', `${w.connectionId}/${targets}`, { read: true, create: false, update: false, delete: false, export: false, import: false, ...actions } as never);
      };
      await grant('rep', { rowLimit: { read: OWN } });
      await grant('manager', { rowLimit: { read: TEAM } });
      await grant('reader', {});
      for (const person of ['dana', 'omar', 'sam'] as const) await w.give(person, 'rep');
      for (const person of ['mara', 'lena'] as const) await w.give(person, 'manager');
      await w.give('kim', 'reader');

      const blocks = [
        { block: 'email.text', data: { text: 'Open of mine: {{count.mine}}, worth {{sum.mine.amount}}.' } },
        { block: 'email.rows', id: 'rows-mine', data: { section: 'mine', row: { title: '{{row.title}}', amount: '{{row.amount}}' }, empty: 'Nothing of mine is open.' } },
        { block: 'email.text', data: { text: 'The team: {{count.team}} deals, worth {{sum.team.amount}}.' } },
        { block: 'email.rows', id: 'rows-team', data: { section: 'team', row: { title: '{{row.title}}', amount: '{{row.amount}}' }, empty: 'No deal.' } },
        { block: 'email.text', data: { text: 'Target {{target.reps|none set}}, cover {{cover.reps|not worked out}}.' } },
        { block: 'email.rows', id: 'rows-reps', data: { section: 'reps', row: { title: '{{row.owner}}', meta: '{{row.count}} deals', amount: '{{row.sum.amount}}', note: 'of {{row.target|no target}}: {{row.cover|no cover}}' }, empty: 'Nobody.' } },
      ];
      const words = { 'en_US': 'Your week, {{name}}', 'de_DE': 'Ihre Woche, {{name}}' };
      for (const [locale, subject] of Object.entries(words)) await emailTemplatesRepo(w.meta).create({ kind: 'template', key: 'firm-week', locale, name: 'Week', subject, blocks, enabled: true });

      const sections = [
        section('mine', { where: [{ left: { field: 'state' }, op: 'is', right: 'open' }], limit: 1, sum: ['amount'] }),
        section('team', { reach: 'team', sum: ['amount'] }),
        section('reps', { reach: 'team', by: 'owner', orderBy: null, sum: ['amount'], target: { table: targets, owner: 'rep_id', column: 'amount', year: 'year', of: 'amount' } }),
      ];
      const roles = [await roleId('rep'), await roleId('manager'), await roleId('reader')];
      // Saved through the rules' own door, as an owner would: the save reads every word of it.
      const saved = await call('owner', 'POST', 'automations', { name: 'Each person their week', connectionId: w.connectionId, trigger: trigger(), graph: graph(roles, sections), enabled: true });
      expect(saved.statusCode, saved.body).toBe(201);
      rule = (JSON.parse(saved.body) as { id: string }).id;
      const other = await call('owner', 'POST', 'automations', { name: 'The managers alone', connectionId: w.connectionId, trigger: trigger(), graph: graph([await roleId('manager')], [section('team', { reach: 'team', sum: ['amount'] })]), enabled: true });
      expect(other.statusCode, other.body).toBe(201);
      managersOnly = (JSON.parse(other.body) as { id: string }).id;
    }, 180_000);
    afterAll(async () => {
      await w?.close();
    });

    describe('the leak matrix', () => {
      it('writes a manager her team’s rows, lines and sums, and nothing of the other team', async () => {
        const mail = await mine('mara');
        // Her own section: she owns no deal.
        expect(mail.text).toContain('Open of mine: 0, worth 0.00.');
        // Her team's: four deals, each listed, added up over all of them.
        expect(mail.text).toContain('The team: 4 deals, worth 55,000.00.');
        for (const title of ['Deal 1', 'Deal 2', 'Deal 3', 'Deal 4']) expect(mail.text).toContain(title);
        // A line a rep, each against their own target; and the team against both.
        expect(mail.text).toContain('Dana — 2 deals — 42,000.00');
        expect(mail.text).toContain('of 84,000.00: 50%');
        expect(mail.text).toContain('Omar — 2 deals — 13,000.00');
        expect(mail.text).toContain('of 52,000.00: 25%');
        expect(mail.text).toContain('Target 136,000.00, cover 40%.');
        // Last year's target is no part of this year's.
        expect(mail.text).not.toContain('999');
        // She SITS in South and leads nothing there: not a row, not a name, not a digit of its sums.
        holdsNone(mail, SOUTH);
      });

      it('writes the other manager her own team, and nothing of the first', async () => {
        const mail = await mine('lena');
        expect(mail.text).toContain('Open of mine: 1, worth 20,000.00.');
        expect(mail.text).toContain('The team: 4 deals, worth 82,000.00.');
        expect(mail.text).toContain('Lena — 2 deals — 60,000.00');
        expect(mail.text).toContain('of 100,000.00: 60%');
        expect(mail.text).toContain('Sam — 2 deals — 22,000.00');
        expect(mail.text).toContain('Target 144,000.00, cover 57%.');
        holdsNone(mail, NORTH);
        // Mara is a member of South with no deal and no target: no line, and no name.
        expect(mail.text).not.toContain('Mara');
      });

      it('writes a rep only her own, though her reads reach a colleague’s deals she covers and helps on', async () => {
        // What Dana READS: her two, and Lena's two.
        expect(await w.reached(await w.setOf('dana'), 'deals', 'read', new Date().toISOString().slice(0, 10))).toEqual([1, 2, 5, 9]);
        const mail = await mine('dana');
        // One open deal of hers; the section lists one row and counts and adds them all.
        expect(mail.text).toContain('Open of mine: 1, worth 12,000.00.');
        // "The team" of somebody who leads nobody is herself.
        expect(mail.text).toContain('The team: 2 deals, worth 42,000.00.');
        expect(mail.text).toContain('Dana — 2 deals — 42,000.00');
        expect(mail.text).toContain('Target 84,000.00, cover 50%.');
        holdsNone(mail, SOUTH);
        holdsNone(mail, ['Omar', 'Deal 3', 'Deal 4', '13,000.00', '55,000.00', '52,000.00', '136,000.00', '25%', '40%', '102,000.00']);
      });

      it('writes a rep of the other team only his own', async () => {
        const mail = await mine('sam');
        expect(mail.text).toContain('The team: 2 deals, worth 22,000.00.');
        expect(mail.text).toContain('Target 44,000.00, cover 50%.');
        holdsNone(mail, NORTH);
        holdsNone(mail, ['Lena', 'Deal 5', 'Deal 9', '60,000.00', '82,000.00', '100,000.00', '144,000.00']);
      });

      it('writes somebody no limit holds her own rows, never the table', async () => {
        // Kim reads every deal and every target, owns none and leads nobody.
        expect(await w.reached(await w.setOf('kim'), 'deals')).toBe('all');
        // The rule writes nobody a summary of nothing; asked for, hers says what there is: nothing.
        expect(await sentTo('kim')).toBeUndefined();
        const mail = await ask('kim');
        expect(mail.text).toContain('Open of mine: 0, worth 0.00.');
        expect(mail.text).toContain('The team: 0 deals, worth 0.00.');
        expect(mail.text).toContain('Target none set, cover not worked out.');
        expect(mail.text).toContain('Nobody.');
        holdsNone(mail, [...NORTH, ...SOUTH]);
      });

      it('holds a manager to her team when another role of hers reads every row', async () => {
        await w.give('mara', 'reader');
        try {
          expect(await w.reached(await w.setOf('mara'), 'deals')).toBe('all');
          const mail = await mine('mara');
          expect(mail.text).toContain('The team: 4 deals, worth 55,000.00.');
          expect(mail.text).toContain('Target 136,000.00, cover 40%.');
          holdsNone(mail, SOUTH);
        } finally {
          await w.take('mara', 'reader');
        }
      });

      it('gives a team lead whose own role reaches only her own rows nothing of the people she leads', async () => {
        // Mara leads North; as a rep, her reads reach her own deals alone. Leading a team widens no read.
        await w.take('mara', 'manager');
        await w.give('mara', 'rep');
        try {
          expect(await sentTo('mara')).toBeUndefined();
          const mail = await ask('mara', rule);
          expect(mail.text).toContain('The team: 0 deals, worth 0.00.');
          holdsNone(mail, [...NORTH, ...SOUTH]);
        } finally {
          await w.take('mara', 'rep');
          await w.give('mara', 'manager');
        }
      });

      it('sends by itself what it sends on request: one mail a person with rows, each their own', async () => {
        const made = await run();
        // Kim has nothing in any section, and the rule does not write to people with nothing.
        expect(made.map((mail) => mail.to).sort()).toEqual(['dana', 'lena', 'mara', 'omar', 'sam'].map((name) => `${name}@firm.test`));
        const of = (who: string): Mail => made.find((mail) => mail.to === `${who}@firm.test`)!;
        expect(of('mara').text).toContain('The team: 4 deals, worth 55,000.00.');
        holdsNone(of('mara'), SOUTH);
        expect(of('omar').text).toContain('The team: 2 deals, worth 13,000.00.');
        holdsNone(of('omar'), [...SOUTH, 'Dana', 'Deal 1', 'Deal 2', '42,000.00', '55,000.00']);
        holdsNone(of('lena'), NORTH);
        holdsNone(of('sam'), NORTH);
      });
    });

    describe('who she leads is read when it is sent', () => {
      it('leaves out somebody moved out of her team between two sends', async () => {
        const teams = teamsRepo(w.meta);
        const north = (await teams.findByName('North'))!;
        expect((await mine('mara')).text).toContain('Omar — 2 deals — 13,000.00');
        await teams.removeMember(north.id, w.people.omar);
        try {
          const mail = await mine('mara');
          expect(mail.text).toContain('The team: 2 deals, worth 42,000.00.');
          expect(mail.text).toContain('Target 84,000.00, cover 50%.');
          holdsNone(mail, ['Omar', 'Deal 3', 'Deal 4', '13,000.00', '55,000.00', '52,000.00', '136,000.00']);
        } finally {
          await teams.setMember(north.id, w.people.omar, false);
        }
      });

      it('leaves a manager who stopped leading with her own rows alone', async () => {
        const teams = teamsRepo(w.meta);
        const north = (await teams.findByName('North'))!;
        await teams.setMember(north.id, w.people.mara, false);
        try {
          const mail = await ask('mara');
          expect(mail.text).toContain('The team: 0 deals, worth 0.00.');
          holdsNone(mail, [...NORTH, ...SOUTH]);
        } finally {
          await teams.setMember(north.id, w.people.mara, true);
        }
      });

      it('reads a summary queued before she stopped leading as she is when it is sent', async () => {
        await mails();
        const teams = teamsRepo(w.meta);
        const north = (await teams.findByName('North'))!;
        // Mara reads her summaries on another day of the week: hers waits, the others' go at once.
        await notificationSchedulesRepo(w.meta).set(w.people.mara, { timezone: 'UTC', quiet: null, digestDay: (new Date().getUTCDay() + 3) % 7, digestTime: '08:00' });
        await tick(rule);
        const first = await mails();
        expect(first.find((mail) => mail.to === 'mara@firm.test')).toBeUndefined();
        expect(first.find((mail) => mail.to === 'dana@firm.test')).toBeDefined();
        await teams.setMember(north.id, w.people.mara, false);
        try {
          const made = await sendQueued();
          // Nothing of hers is left to write, so she is written nothing at all.
          expect(made.find((mail) => mail.to === 'mara@firm.test')).toBeUndefined();
          expect(made).toEqual([]);
        } finally {
          await notificationSchedulesRepo(w.meta).set(w.people.mara, { timezone: null, quiet: null, digestDay: null, digestTime: null });
          await teams.setMember(north.id, w.people.mara, true);
        }
      });
    });

    describe('a figure outside her reach is left out, never zero', () => {
      it('adds up no column her role does not show, and measures nothing by it', async () => {
        // A manager who reads deals without their amounts.
        const blind = { read: true, create: false, update: false, delete: false, export: false, import: false, rowLimit: { read: TEAM }, readLimit: { readable: ['id', 'title', 'owner_id', 'state'] } };
        await permissionsRepo(w.meta).grant(await roleId('manager'), 'table', `${w.connectionId}/${w.id('deals')}`, blind as never);
        try {
          const mail = await mine('mara');
          // The rows and how many are hers to read; what they are worth is not.
          expect(mail.text).toContain('The team: 4 deals, worth .');
          expect(mail.text).toContain('Dana — 2 deals');
          expect(mail.text).toContain('Target none set, cover not worked out.');
          holdsNone(mail, ['55,000.00', '42,000.00', '13,000.00', '12,000.00', '30,000.00', '8,000.00', '5,000.00', '84,000.00', '52,000.00', '136,000.00', '%']);
          holdsNone(mail, SOUTH);
        } finally {
          await w.role('manager', { deals: { actions: ['read'], rows: { read: TEAM } } });
        }
      });

      it('divides by no target she does not reach: a table her role does not read', async () => {
        const id = await roleId('manager');
        await permissionsRepo(w.meta).grant(id, 'table', `${w.connectionId}/${targets}`, { read: false, create: false, update: false, delete: false, export: false, import: false } as never);
        try {
          const mail = await mine('mara');
          expect(mail.text).toContain('The team: 4 deals, worth 55,000.00.');
          expect(mail.text).toContain('Target none set, cover not worked out.');
          expect(mail.text).toContain('of no target: no cover');
          holdsNone(mail, ['84,000.00', '52,000.00', '136,000.00', '%']);
        } finally {
          await permissionsRepo(w.meta).grant(id, 'table', `${w.connectionId}/${targets}`, { read: true, create: false, update: false, delete: false, export: false, import: false, rowLimit: { read: TEAM } } as never);
        }
      });

      it('gives the whole no cover when her reach of targets is narrower than her reach of deals', async () => {
        // She reads her team's deals and only her OWN target (she has none).
        const id = await roleId('manager');
        await permissionsRepo(w.meta).grant(id, 'table', `${w.connectionId}/${targets}`, { read: true, create: false, update: false, delete: false, export: false, import: false, rowLimit: { read: OWN } } as never);
        try {
          const mail = await mine('mara');
          expect(mail.text).toContain('Dana — 2 deals — 42,000.00');
          expect(mail.text).toContain('Target none set, cover not worked out.');
          holdsNone(mail, ['84,000.00', '52,000.00', '136,000.00', '%']);
        } finally {
          await permissionsRepo(w.meta).grant(id, 'table', `${w.connectionId}/${targets}`, { read: true, create: false, update: false, delete: false, export: false, import: false, rowLimit: { read: TEAM } } as never);
        }
      });

      it('leaves the team no cover while one of its people with deals has no target', async () => {
        await w.run(`DELETE FROM targets WHERE id = 2`);
        try {
          const mail = await mine('mara');
          expect(mail.text).toContain('of 84,000.00: 50%');
          expect(mail.text).toContain('Omar — 2 deals — 13,000.00');
          expect(mail.text).toContain('of no target: no cover');
          // Dana's target is there to read; 55,000 against it alone would read as 65 %.
          expect(mail.text).toContain('Target 84,000.00, cover not worked out.');
          expect(mail.text).not.toContain('65%');
        } finally {
          await w.run(`INSERT INTO targets (id, rep_id, year, amount) VALUES (2, '${w.people.omar}', ${String(year)}, 52000)`);
        }
      });

      it('lists nothing of a section that chooses rows by a column her role does not show', async () => {
        // "Big deals" is a count that would say how many there are: the column is not hers, so neither is the count.
        const big = await call('owner', 'POST', 'automations', {
          name: 'Big deals',
          connectionId: w.connectionId,
          trigger: trigger(),
          graph: graph([await roleId('manager')], [section('team', { reach: 'team', sum: ['amount'], where: [{ left: { field: 'big' }, op: 'is', right: 'true' }] })]),
          enabled: true,
        });
        expect(big.statusCode, big.body).toBe(201);
        const id = (JSON.parse(big.body) as { id: string }).id;
        expect((await mine('mara', id)).text).toContain('The team: 1 deals, worth 30,000.00.');
        const blind = { read: true, create: false, update: false, delete: false, export: false, import: false, rowLimit: { read: TEAM }, readLimit: { readable: ['id', 'title', 'owner_id', 'state', 'amount'] } };
        await permissionsRepo(w.meta).grant(await roleId('manager'), 'table', `${w.connectionId}/${w.id('deals')}`, blind as never);
        try {
          // Nothing to list, so the rule writes her nothing; asked for, hers says so.
          expect(await sentTo('mara', id)).toBeUndefined();
          const mail = await ask('mara', id);
          expect(mail.text).toContain('The team: 0 deals, worth .');
          holdsNone(mail, ['Deal 2', '30,000.00', '30000']);
        } finally {
          await w.role('manager', { deals: { actions: ['read'], rows: { read: TEAM } } });
        }
      });
    });

    describe('when its figures were read', () => {
      it('says the moment, in the reader’s language, as its last line', async () => {
        const english = await mine('dana');
        expect(english.text).toMatch(new RegExp(`Figures read on [A-Z][a-z]+day, [A-Z][a-z]+ \\d{1,2}, ${String(new Date().getUTCFullYear())} at \\d{1,2}:\\d{2}\\s?[AP]M\\.`));
        await userPrefsRepo(w.meta).set(w.people.dana, { locale: 'de_DE' } as never);
        try {
          const german = await mine('dana');
          expect(german.subject).toBe('Ihre Woche, Dana');
          expect(german.text).toMatch(/Stand der Zahlen: [A-Z][a-zä]+tag|Stand der Zahlen: Mittwoch/);
          expect(german.text).toMatch(/Stand der Zahlen: .* um \d{2}:\d{2}\./);
          // German digits, too: the sum is written as the reader's language writes one.
          expect(german.text).toContain('42.000,00');
        } finally {
          await userPrefsRepo(w.meta).set(w.people.dana, { locale: 'en_US' } as never);
        }
      });
    });

    describe('the doors', () => {
      it('refuses a summary job queued by hand, whoever asks', async () => {
        const payload = { ruleId: rule, ruleName: 'x', runId: 'by-hand', connectionId: w.connectionId, userId: w.people.lena, templateKey: 'firm-week', roles: [await roleId('manager')], sections: [section('team', { reach: 'team' })], sendEmpty: true, madeAt: Date.now() };
        const res = await call('owner', 'POST', 'jobs', { kind: 'digest.send', payload });
        expect(res.statusCode, res.body).toBe(403);
        expect(await w.meta.db.selectFrom('adminium_jobs').select('id').where('kind', '=', 'digest.send').where('status', '=', 'pending' as never).execute()).toEqual([]);
      });

      it('keeps nothing readable of a summary on its way: not in its job, its mail’s job or the audit log', async () => {
        await notificationSchedulesRepo(w.meta).set(w.people.mara, { timezone: 'UTC', quiet: null, digestDay: (new Date().getUTCDay() + 3) % 7, digestTime: '08:00' });
        await tick(rule);
        const kept = async (): Promise<string> => {
          const jobs = await w.meta.db.selectFrom('adminium_jobs').select(['payload', 'lastError']).where('kind', 'in', ['digest.send', 'email.send', 'automation.run']).execute();
          const audit = await w.meta.db.selectFrom('adminium_audit_log').selectAll().execute();
          return JSON.stringify([jobs, audit]);
        };
        const before = await kept();
        await sendQueued();
        await notificationSchedulesRepo(w.meta).set(w.people.mara, { timezone: null, quiet: null, digestDay: null, digestTime: null });
        for (const text of [before, await kept()]) {
          for (const word of ['Deal 1', 'Deal 5', '55,000.00', '82,000.00', '42,000.00', '136,000.00']) expect(text).not.toContain(word);
        }
      });

      it('lists a person the summaries that are theirs, and no other', async () => {
        const listed = (who: PersonName) => call(who, 'GET', 'me/summaries').then((res) => (JSON.parse(res.body) as { data: { id: string; name: string }[] }).data.map((one) => one.name).sort());
        expect(await listed('dana')).toEqual(['Each person their week']);
        expect(await listed('mara')).toEqual(expect.arrayContaining(['Each person their week', 'The managers alone']));
        expect((await call(null, 'GET', 'me/summaries')).statusCode).toBe(401);
        expect((await call(null, 'POST', `me/summaries/${rule}/send`)).statusCode).toBe(401);
      });

      it('answers a rule that is not hers exactly as one that is not there', async () => {
        await mails();
        const notHers = await call('dana', 'POST', `me/summaries/${managersOnly}/send`);
        const notThere = await call('dana', 'POST', 'me/summaries/auto_no_such_rule/send');
        expect(notHers.statusCode).toBe(404);
        expect(notThere.statusCode).toBe(404);
        const told = (res: Reply): unknown => {
          const { error } = JSON.parse(res.body) as { error: Record<string, unknown> };
          return { code: error['code'], message: error['message'], details: error['details'] };
        };
        expect(told(notHers)).toEqual(told(notThere));
        expect(await mails()).toEqual([]);
      });

      it('takes no person, role or section from the caller: only her own, to her own address', async () => {
        await mails();
        const res = await call('omar', 'POST', `me/summaries/${rule}/send`, { userId: w.people.lena, to: 'lena@firm.test', roles: [await roleId('manager')], sections: [section('all', { reach: 'all' })] });
        expect(res.statusCode, res.body).toBe(200);
        const made = await mails();
        expect(made.map((mail) => mail.to)).toEqual(['omar@firm.test']);
        expect(made[0]!.text).toContain('The team: 2 deals, worth 13,000.00.');
        holdsNone(made[0]!, SOUTH);
      });

      it('sends hers also while the rule is switched off, to her alone; and nobody’s once the rule is gone', async () => {
        const off = await call('owner', 'PATCH', `automations/${managersOnly}`, { enabled: false });
        expect(off.statusCode, off.body).toBe(200);
        const mail = await ask('lena', managersOnly);
        expect(mail.text).toContain('The team: 4 deals, worth 82,000.00.');
        // Switched off, it writes to nobody by itself: the clock passes it over.
        await tick(managersOnly);
        await sendQueued();
        expect(await mails()).toEqual([]);
      });

      it('stops at three an hour for a person and a rule, without holding anybody else back', async () => {
        const again = () => call('sam', 'POST', `me/summaries/${rule}/send`);
        const replies = [await again(), await again(), await again(), await again()];
        expect(replies.map((res) => res.statusCode)).toEqual([200, 200, 200, 429]);
        expect((JSON.parse(replies[2]!.body) as { data: { left: number } }).data.left).toBe(0);
        expect(Number(replies[3]!.headers['retry-after'])).toBeGreaterThan(0);
        await mails();
        expect((await again()).statusCode).toBe(429);
        expect(await mails()).toEqual([]);
        // Omar asks for the same rule and is answered.
        expect((await call('omar', 'POST', `me/summaries/${rule}/send`)).statusCode).toBe(200);
      });

      it('refuses, at the save, a section that asks for every row, a sum of a text, and a target that is nobody’s', async () => {
        const save = async (more: Record<string, unknown>) => call('owner', 'POST', 'automations', { name: 'Wrong', connectionId: w.connectionId, trigger: trigger(), graph: graph([await roleId('manager')], [section('team', more)]), enabled: false });
        expect((await save({ reach: 'all' })).statusCode).toBe(422);
        expect((await save({ sum: ['title'] })).statusCode).toBe(422);
        expect((await save({ sum: ['amount'], target: { table: targets, owner: 'note', column: 'amount', of: 'amount' } })).statusCode).toBe(422);
        expect((await save({ sum: ['amount'], target: { table: targets, owner: 'rep_id', column: 'amount', of: 'big' } })).statusCode).toBe(422);
      });

      it('reads no private table for a summary, though its reader is on the rows', async () => {
        // Mara is the manager on two one-to-ones, and her role reads the table.
        await w.role('manager', { one_to_ones: { actions: ['read'] } });
        await emailTemplatesRepo(w.meta).create({
          kind: 'template',
          key: 'firm-notes',
          locale: 'en_US',
          name: 'Notes',
          subject: 'Notes',
          blocks: [{ block: 'email.text', data: { text: 'Notes: {{count.team}}.' } }, { block: 'email.rows', id: 'rows-team', data: { section: 'team', row: { title: '{{row.note}}' }, empty: 'None.' } }],
          enabled: true,
        });
        const saved = await call('owner', 'POST', 'automations', { name: 'Notes', connectionId: w.connectionId, trigger: trigger(), graph: graph([await roleId('manager')], [{ key: 'team', table: w.id('one_to_ones'), owner: 'manager_id', where: [], orderBy: null, limit: 50, reach: 'team' }], 'firm-notes'), enabled: true });
        expect(saved.statusCode, saved.body).toBe(201);
        const mail = await ask('mara', (JSON.parse(saved.body) as { id: string }).id);
        expect(mail.text).toContain('Notes: 0.');
        holdsNone(mail, ['August']);
      });
    });
  });
}
