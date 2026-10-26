// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The campaign send ledger (wave 0067), on every available dialect: a run and
 * its log outlive the campaign, an upgraded store keeps its runs, every bounded
 * column holds its full width, a claim is a batch's own (a row taken back can
 * be changed by nobody holding the old token), the log's counts, filters,
 * search and pages, the frozen content reads back as it was written, and the
 * hourly count is shared.
 */
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALL_MIGRATIONS,
  applyMigrations,
  emailRunsRepo,
  emailSendCountersRepo,
  emailSendsRepo,
  emailTemplatesRepo,
  EMAIL_CAMPAIGN_COUNTER_BUCKET,
  EMAIL_SEND_CLICKS_MAX,
  type EmailSendInput,
  type MetaDb,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const PRE_0067 = ALL_MIGRATIONS.filter((m) => m.name < '0067_email_send_ledger');
const HOUR = 3_600_000;

async function campaign(meta: MetaDb, key = 'spring-news') {
  return await emailTemplatesRepo(meta).create({ kind: 'campaign', key, locale: 'en_US', name: 'Spring news', subject: 'Hello {{first_name}}', blocks: [{ id: 'b1', block: 'email.text', data: { paras: ['Hi'] } }] }, 1_000);
}

const person = (i: number, over: Partial<EmailSendInput> = {}): EmailSendInput => ({
  address: `p${String(i)}@shop.test`,
  name: `Person ${String(i)}`,
  language: 'en_US',
  personKey: `usr_${String(i)}`,
  ...over,
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`the send ledger [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('keeps a run, its content and its log when the campaign is deleted, and drops them with the run', async () => {
      const doc = await campaign(t.meta);
      const runs = emailRunsRepo(t.meta);
      const run = await runs.create({ templateId: doc.id, audience: { kind: 'users' }, scheduledAt: 2_000, ratePerHour: 100 }, 2_000);
      expect(run).toMatchObject({ templateId: doc.id, state: 'running', ratePerHour: 100, contentId: null, mailClass: null, basis: null });
      await runs.freeze(run.id, { name: doc.name, templateKey: doc.key, variants: [{ templateId: doc.id, locale: 'en_US', name: doc.name, subject: doc.subject, preheader: '', blocks: doc.blocks, footer: '', brand: null, attachments: [] }] }, 2_000);
      await emailSendsRepo(t.meta).write(run.id, [person(1), person(2)], 0, 2_000);

      expect(await emailTemplatesRepo(t.meta).removeById(doc.id)).toBe(true);
      expect(await runs.findById(run.id)).toMatchObject({ id: run.id, templateId: null });
      expect((await runs.content(run.id))?.name).toBe('Spring news');
      expect(await emailSendsRepo(t.meta).remaining(run.id)).toBe(2);

      // The run itself going takes its content and its rows with it.
      await t.meta.db.deleteFrom('adminium_email_runs').where('id', '=', run.id).execute();
      expect(await runs.content(run.id)).toBeNull();
      expect(await emailSendsRepo(t.meta).list(run.id, { limit: 10 })).toEqual([]);
    });

    it('holds the full width of every bounded column, and reads JSON back as it was written', async () => {
      const doc = await campaign(t.meta);
      const runs = emailRunsRepo(t.meta);
      const run = await runs.create({ templateId: doc.id, audience: { kind: 'users' }, scheduledAt: 1, ratePerHour: 100_000 }, 1);
      await t.meta.db
        .updateTable('adminium_email_runs')
        .set({ state: 'x'.repeat(12), mailClass: 'y'.repeat(12), basis: 'z'.repeat(24) })
        .where('id', '=', run.id)
        .execute();
      const widths = await t.meta.db.selectFrom('adminium_email_runs').select(['state', 'mailClass', 'basis', 'ratePerHour']).where('id', '=', run.id).executeTakeFirstOrThrow();
      expect(widths).toEqual({ state: 'x'.repeat(12), mailClass: 'y'.repeat(12), basis: 'z'.repeat(24), ratePerHour: 100_000 });
      await t.meta.db.updateTable('adminium_email_runs').set({ state: 'running', mailClass: 'marketing', basis: 'existing-customers' }).where('id', '=', run.id).execute();
      expect(await runs.findById(run.id)).toMatchObject({ state: 'running', mailClass: 'marketing', basis: 'existing-customers' });

      const blocks = [{ id: 'b1', block: 'email.text', data: { paras: ['Grüße, «Ünïcödé»', 'two'], nested: { deep: [1, true, null] } } }];
      const content = await runs.freeze(run.id, { name: 'n'.repeat(120), templateKey: 'k'.repeat(80), variants: [{ templateId: doc.id, locale: 'l'.repeat(35), name: 'v', subject: 's', preheader: 'p', blocks, footer: 'f', brand: null, attachments: [] }] }, 1);
      const read = await runs.content(run.id);
      expect(read).toEqual(content);
      expect(read?.variants[0]?.blocks).toEqual(blocks);

      const full = {
        address: `${'a'.repeat(310)}@shop.test`,
        name: 'é'.repeat(120),
        language: 'l'.repeat(35),
        connectionId: 'cnx_01J8ME7Q2RZX4V9T6W3YB0KD5N',
        personTable: 't'.repeat(200),
        personKey: 'k'.repeat(200),
        state: 'skipped-consent' as const,
        reason: 'r'.repeat(500),
      };
      expect(full.address).toHaveLength(320);
      const sends = emailSendsRepo(t.meta);
      await sends.write(run.id, [full], 0, 1);
      const [row] = await sends.list(run.id, { limit: 5 });
      expect(row).toMatchObject(full);
      // A value past the width is cut, never refused.
      await sends.write(run.id, [{ ...full, name: 'n'.repeat(130), reason: 'r'.repeat(600) }], 1, 1);
      const [, cut] = await sends.list(run.id, { limit: 5 });
      expect(cut?.name).toHaveLength(120);
      expect(cut?.reason).toHaveLength(500);
      // The widest state, the token and the counters' bucket.
      await t.meta.db.updateTable('adminium_email_sends').set({ state: 's'.repeat(16), claimToken: 'c'.repeat(64) }).where('id', '=', cut!.id).execute();
      expect(await t.meta.db.selectFrom('adminium_email_sends').select(['state', 'claimToken']).where('id', '=', cut!.id).executeTakeFirstOrThrow()).toEqual({ state: 's'.repeat(16), claimToken: 'c'.repeat(64) });
      expect(await emailSendCountersRepo(t.meta).hit('b'.repeat(200), 5 * HOUR)).toBe(1);
    });

    it('lets a claim change only its own rows, once', async () => {
      const doc = await campaign(t.meta);
      const run = await emailRunsRepo(t.meta).create({ templateId: doc.id, audience: { kind: 'users' }, scheduledAt: 1 }, 1);
      const sends = emailSendsRepo(t.meta);
      await sends.write(run.id, [1, 2, 3, 4, 5].map((i) => person(i)), 0, 1);

      const first = await sends.claim(run.id, 3, 'tok-a', 10);
      expect(first.map((row) => row.seq)).toEqual([0, 1, 2]);
      expect(first.every((row) => row.state === 'sending' && row.attempts === 1 && row.claimedAt === 10)).toBe(true);
      // A second claim gets what is left, never the same rows.
      expect((await sends.claim(run.id, 5, 'tok-b', 11)).map((row) => row.seq)).toEqual([3, 4]);
      expect(await sends.claim(run.id, 5, 'tok-c', 12)).toEqual([]);

      expect(await sends.markHanded(first[0]!.id, 'tok-a', 'job_1', 20)).toBe(true);
      expect(await sends.markHanded(first[0]!.id, 'tok-a', 'job_2', 21)).toBe(false);
      expect(await sends.markHanded(first[1]!.id, 'tok-b', 'job_3', 21)).toBe(false);
      expect(await sends.settle(first[1]!.id, 'tok-a', 'skipped-stop', 'on-the-list', 22)).toBe(true);

      // Taken back: the old token changes nothing, the next claim gets them, and counts a second attempt.
      expect(await sends.releaseClaims(run.id, 30)).toBe(3);
      expect(await sends.markHanded(first[2]!.id, 'tok-a', 'job_4', 31)).toBe(false);
      const again = await sends.claim(run.id, 10, 'tok-d', 32);
      expect(again.map((row) => [row.seq, row.attempts])).toEqual([[2, 2], [3, 2], [4, 2]]);
      expect(await sends.unclaimAll(run.id, 'tok-d', 33)).toBe(3);
      expect(await sends.remaining(run.id)).toBe(3);

      const handed = await sends.findById(first[0]!.id);
      expect(handed).toMatchObject({ state: 'sent', jobId: 'job_1', sentAt: 20, claimToken: null, reason: null });
      // The mail queue gave up on it: once.
      expect(await sends.markGivenUp(handed!.id, '550 mailbox unavailable', 40)).toMatchObject({ state: 'failed', reason: '550 mailbox unavailable' });
      expect(await sends.markGivenUp(handed!.id, 'again', 41)).toBeNull();
      expect(await sends.counts(run.id)).toEqual({ failed: 1, 'skipped-stop': 1, queued: 3 });
    });

    it('moves a run only from the states it is in, and counts a hand-over only for the head of a running run', async () => {
      const doc = await campaign(t.meta);
      const runs = emailRunsRepo(t.meta);
      const run = await runs.create({ templateId: doc.id, audience: { kind: 'users' }, scheduledAt: 1, jobId: 'job_a' }, 1);
      expect(await runs.start(run.id, { contentId: 'ercn_x', total: 3, skipped: 1, jobId: 'job_other' }, 2)).toBe(false);
      expect(await runs.start(run.id, { contentId: 'ercn_x', total: 3, skipped: 1, jobId: 'job_a' }, 2)).toBe(true);
      expect(await runs.start(run.id, { contentId: 'ercn_x', total: 3, skipped: 1, jobId: 'job_a' }, 2)).toBe(false);
      expect(await runs.countHanded(run.id, 'job_b')).toBe(false);
      expect(await runs.countHanded(run.id, 'job_a')).toBe(true);
      expect(await runs.advance(run.id, 'job_b', 'job_c')).toBe(false);
      expect(await runs.advance(run.id, 'job_a', 'job_b')).toBe(true);
      expect(await runs.countHanded(run.id, 'job_a')).toBe(false);
      expect(await runs.moveState(run.id, ['running'], 'paused', { statuses: ['running'] })).toBe(true);
      expect(await runs.countHanded(run.id, 'job_b')).toBe(false);
      expect(await runs.moveState(run.id, ['running'], 'paused')).toBe(false);
      expect(await runs.moveState(run.id, ['running', 'paused'], 'stopped', { status: 'cancelled', finishedAt: 9 })).toBe(true);
      await runs.countSettled(run.id, { skipped: 2, failed: 1 });
      await runs.countGivenUp(run.id);
      await runs.noteFailure(run.id, { to: 'p1@shop.test', error: 'x'.repeat(700) });
      expect(await runs.findById(run.id)).toMatchObject({ status: 'cancelled', state: 'stopped', finishedAt: 9, contentId: 'ercn_x', total: 3, sent: 0, skipped: 3, failed: 2, failures: [{ to: 'p1@shop.test', error: 'x'.repeat(500) }] });
    });

    it("lists a run's log by filter and search, in pages", async () => {
      const doc = await campaign(t.meta);
      const run = await emailRunsRepo(t.meta).create({ templateId: doc.id, audience: { kind: 'users' }, scheduledAt: 1 }, 1);
      const sends = emailSendsRepo(t.meta);
      await sends.write(
        run.id,
        [
          person(1, { name: 'Ruth Adeyemi', address: 'ruth@shop.test' }),
          person(2, { name: 'Callum Brookes', address: 'CALLUM@Shop.test' }),
          person(3, { name: 'Aisha Rahman', address: 'aisha@shop.test', state: 'skipped-consent', reason: 'campaign-mail-off' }),
          person(4, { name: '100%_sure', address: 'pct@shop.test' }),
          ...[5, 6, 7].map((i) => person(i)),
        ],
        0,
        1,
      );
      expect((await sends.list(run.id, { filter: 'skipped', limit: 10 })).map((row) => row.name)).toEqual(['Aisha Rahman']);
      expect((await sends.list(run.id, { filter: 'waiting', limit: 10 })).length).toBe(6);
      expect((await sends.list(run.id, { q: 'callum', limit: 10 })).map((row) => row.address)).toEqual(['CALLUM@Shop.test']);
      expect((await sends.list(run.id, { q: 'SHOP.TEST', filter: 'waiting', limit: 10 })).length).toBe(6);
      expect((await sends.list(run.id, { q: 'rahman', filter: 'sent', limit: 10 })).length).toBe(0);
      expect((await sends.list(run.id, { q: '100%', limit: 10 })).map((row) => row.address)).toEqual(['pct@shop.test']);
      const first = await sends.list(run.id, { limit: 4 });
      const second = await sends.list(run.id, { limit: 4, after: first.at(-1)!.seq });
      expect([...first, ...second].map((row) => row.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('counts every run in one hour, and starts again in the next', async () => {
      const counters = emailSendCountersRepo(t.meta);
      const at = 400 * HOUR + 5 * 60_000;
      expect(await counters.hit(EMAIL_CAMPAIGN_COUNTER_BUCKET, at)).toBe(1);
      expect(await counters.hit(EMAIL_CAMPAIGN_COUNTER_BUCKET, at + 60_000, 3)).toBe(4);
      expect(await counters.read(EMAIL_CAMPAIGN_COUNTER_BUCKET, at + 50 * 60_000)).toBe(4);
      expect(counters.nextWindow(at)).toBe(401 * HOUR);
      expect(await counters.read(EMAIL_CAMPAIGN_COUNTER_BUCKET, 401 * HOUR)).toBe(0);
      expect(await counters.hit(EMAIL_CAMPAIGN_COUNTER_BUCKET, 401 * HOUR)).toBe(1);
      expect(await counters.gc(401 * HOUR + 10)).toBe(1);
      expect(await counters.read(EMAIL_CAMPAIGN_COUNTER_BUCKET, at)).toBe(0);
    });

    it('marks only a sent row unsubscribed, and counts clicks up to the column’s top', async () => {
      const doc = await campaign(t.meta);
      const run = await emailRunsRepo(t.meta).create({ templateId: doc.id, audience: { kind: 'users' }, scheduledAt: 1 }, 1);
      const sends = emailSendsRepo(t.meta);
      await sends.write(run.id, [person(1), person(2)], 0, 1);
      const [sent, waiting] = await sends.claim(run.id, 2, 'tok-u', 2);
      expect(await sends.markHanded(sent!.id, 'tok-u', 'job_1', 3)).toBe(true);
      expect(await sends.unclaimAll(run.id, 'tok-u', 4)).toBe(1);

      expect(await sends.markUnsubscribed(waiting!.id, 5)).toBe(false);
      expect(await sends.markUnsubscribed(sent!.id, 5)).toBe(true);
      expect(await sends.findById(sent!.id)).toMatchObject({ state: 'unsubscribed', updatedAt: 5 });
      // Once said, it stays: a second press, or a bounce notice after it, does not move it.
      expect(await sends.markUnsubscribed(sent!.id, 6)).toBe(false);
      expect(await sends.markGivenUp(sent!.id, '550', 7, 'bounced')).toBeNull();
      expect(await sends.findById(waiting!.id)).toMatchObject({ state: 'queued' });

      expect(await sends.countClick(sent!.id, 8)).toBe(true);
      expect(await sends.countClick(sent!.id, 9)).toBe(true);
      expect((await sends.findById(sent!.id))?.clicks).toBe(2);
      expect(await sends.countClick('esnd_none', 9)).toBe(false);
      // The column is 32 bits on every engine: at its top the count stays.
      await t.meta.db.updateTable('adminium_email_sends').set({ clicks: EMAIL_SEND_CLICKS_MAX }).where('id', '=', sent!.id).execute();
      expect(await sends.countClick(sent!.id, 10)).toBe(false);
      expect((await sends.findById(sent!.id))?.clicks).toBe(EMAIL_SEND_CLICKS_MAX);
    });
  });

  describe.skipIf(!dialect.available)(`0067 on a store that has runs [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0067 });
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('keeps every run as it was, with no state, and lets the campaign go without them', async () => {
      const doc = await campaign(t.meta);
      const values = { id: 'erun_01J8ME7Q2RZX4V9T6W3YB0KD5N', status: 'sent', audience: JSON.stringify({ kind: 'users', roleIds: ['rol_1'] }), scheduledAt: 5, startedAt: 6, finishedAt: 7, total: 4, sent: 3, failed: 1, skipped: 0, failures: JSON.stringify([{ to: 'a@shop.test', error: '550' }]), jobId: 'job_01J8ME7Q2RZX4V9T6W3YB0KD5N', createdBy: null, createdAt: 5, updatedAt: 7 };
      await sql`INSERT INTO adminium_email_runs (id, template_id, status, audience, scheduled_at, started_at, finished_at, total, sent, failed, skipped, failures, job_id, created_by, created_at, updated_at) VALUES (${values.id}, ${doc.id}, ${values.status}, ${values.audience}, ${values.scheduledAt}, ${values.startedAt}, ${values.finishedAt}, ${values.total}, ${values.sent}, ${values.failed}, ${values.skipped}, ${values.failures}, ${values.jobId}, ${values.createdBy}, ${values.createdAt}, ${values.updatedAt})`.execute(t.meta.db);

      expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect })).applied).toContain('0067_email_send_ledger');

      const runs = emailRunsRepo(t.meta);
      expect(await runs.findById(values.id)).toEqual({
        id: values.id,
        templateId: doc.id,
        status: 'sent',
        audience: { kind: 'users', roleIds: ['rol_1'] },
        scheduledAt: 5,
        startedAt: 6,
        finishedAt: 7,
        total: 4,
        sent: 3,
        failed: 1,
        skipped: 0,
        failures: [{ to: 'a@shop.test', error: '550' }],
        jobId: values.jobId,
        createdBy: null,
        createdAt: 5,
        updatedAt: 7,
        ratePerHour: null,
        state: null,
        mailClass: null,
        basis: null,
        contentId: null,
      });
      expect((await runs.latestByTemplates([doc.id])).get(doc.id)?.id).toBe(values.id);
      await emailTemplatesRepo(t.meta).removeById(doc.id);
      expect((await runs.findById(values.id))?.templateId).toBeNull();
      // The template id still refuses a campaign that never existed.
      await expect(runs.create({ templateId: 'tpl_01J8ME7Q2RZX4V9T6W3YB0KD5N', audience: { kind: 'users' }, scheduledAt: 1 })).rejects.toThrow();
    });
  });
}
