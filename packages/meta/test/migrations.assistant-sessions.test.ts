// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0036 (the page assistant): `adminium_assistant_sessions` and
 * `adminium_assistant_turns` land on every dialect, and the repo over them
 * keeps what the runner and the retention sweep rely on — turns are ordered
 * and unique per session, a session's tokens accumulate, json comes back as
 * values rather than text, and deleting a session takes its turns.
 *
 * Every dialect, because this is where portable-DDL mistakes show: MySQL
 * cannot `CREATE INDEX IF NOT EXISTS`, its `json` column is not text, and its
 * `varchar(n)` refuses a string one character too long — which SQLite, where
 * every `str(n)` is `text`, would never notice. The width cases below write
 * each string column at exactly its declared length for that reason.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, assistantSessionsRepo, newId, usersRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0036 = ALL_MIGRATIONS.filter((m) => m.name < '0036_assistant_sessions');

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0036_assistant_sessions [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upgrades a released install rather than needing a fresh one', async () => {
      await t.destroy();
      t = await dialect.make();
      // Ends exactly where 0036 begins — not "0036 is last", which every later
      // wave would invalidate.
      expect(PRE_0036.at(-1)?.name).toBe('0035_option_lists');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0036 });
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });

      const repo = assistantSessionsRepo(t.meta);
      const session = await repo.create({ context: 'email', host: { connectionIds: [] } }, T0);
      expect(session.id.startsWith('ast_')).toBe(true);
    });

    it('round-trips a session with its host, draft and totals', async () => {
      const repo = assistantSessionsRepo(t.meta);
      const created = await repo.create(
        {
          context: 'invoice-template',
          host: { documentId: 'inv_01', tab: 'templates', connectionIds: ['conn_01', 'conn_02'] },
          draft: { name: 'On screen', blocks: [{ block: 'header' }] },
          provider: 'openai-compatible',
          model: 'some-model',
          createdBy: null,
        },
        T0,
      );
      expect(created.id.startsWith('ast_')).toBe(true);
      expect(created.status).toBe('open');
      expect(created.tokensIn).toBe(0);

      // `jsonb` on postgres, `json` on MySQL, `text` on SQLite — two of the
      // three decode for us and one does not, and the repo answers the same
      // shape on all of them.
      const read = await repo.findSession(created.id);
      expect(read?.host).toEqual({ documentId: 'inv_01', tab: 'templates', connectionIds: ['conn_01', 'conn_02'] });
      expect(read?.draft).toEqual({ name: 'On screen', blocks: [{ block: 'header' }] });
      expect(read?.context).toBe('invoice-template');
      expect(await repo.findSession('ast_missing')).toBeNull();
    });

    it('adds usage to the session rather than overwriting it', async () => {
      const repo = assistantSessionsRepo(t.meta);
      const session = await repo.create({ context: 'report', host: { connectionIds: [] } }, T0);
      await repo.addUsage(session.id, { tokensIn: 1200, tokensOut: 300 }, T0 + 1);
      await repo.addUsage(session.id, { tokensIn: 800, tokensOut: 90 }, T0 + 2);
      const read = await repo.findSession(session.id);
      expect(read?.tokensIn).toBe(2000);
      expect(read?.tokensOut).toBe(390);
      expect(read?.updatedAt).toBe(T0 + 2);
    });

    it('numbers turns in order and refuses two turns in the same position', async () => {
      const repo = assistantSessionsRepo(t.meta);
      const session = await repo.create({ context: 'email', host: { connectionIds: [] } }, T0);
      const first = await repo.createTurn({ sessionId: session.id, askText: 'A welcome email' }, T0);
      const second = await repo.createTurn({ sessionId: session.id, askText: 'Shorter, please' }, T0 + 1);
      expect([first.seq, second.seq]).toEqual([1, 2]);
      expect(first.id.startsWith('atn_')).toBe(true);
      expect(first.status).toBe('queued');

      // The unique index is the guarantee, not the count that reads it: a
      // racing insert has to fail here rather than produce a second turn 2.
      await expect(
        t.meta.db
          .insertInto('adminium_assistant_turns')
          .values({
            id: newId('atn'),
            sessionId: session.id,
            seq: 2,
            askText: null,
            picks: null,
            status: 'queued',
            jobId: null,
            transcript: '[]',
            steps: '[]',
            say: null,
            ask: null,
            result: null,
            error: null,
            tokensIn: null,
            tokensOut: null,
            durationMs: null,
            createdAt: T0 + 2,
            finishedAt: null,
          })
          .execute(),
      ).rejects.toThrow();
    });

    it('claims a queued turn once, and reports the second claim as a miss', async () => {
      const repo = assistantSessionsRepo(t.meta);
      const session = await repo.create({ context: 'email', host: { connectionIds: [] } }, T0);
      const turn = await repo.createTurn({ sessionId: session.id, askText: 'Draft it' }, T0);

      expect(await repo.setTurnStatus(turn.id, 'running', { expected: 'queued', jobId: 'job_01' })).toBe(true);
      expect(await repo.setTurnStatus(turn.id, 'running', { expected: 'queued' })).toBe(false);
      expect((await repo.findTurn(turn.id))?.jobId).toBe('job_01');
      expect(await repo.hasLiveTurn(session.id)).toBe(true);

      // Steps are published while the turn is still running, so a reload
      // mid-flight shows the card that is already on other screens.
      const running = [
        { id: 'c1', state: 'started', icon: 'file-search', label: 'Read the page', detail: '', tables: [] },
      ];
      expect(await repo.recordSteps(turn.id, running)).toBe(true);
      expect((await repo.findTurn(turn.id))?.steps).toEqual(running);
      expect(await repo.recordSteps('atn_missing', running)).toBe(false);
    });

    it('stores what a turn ended with, and reads the json back as values', async () => {
      const repo = assistantSessionsRepo(t.meta);
      const session = await repo.create({ context: 'report', host: { connectionIds: ['conn_01'] } }, T0);
      const turn = await repo.createTurn(
        { sessionId: session.id, askText: 'Quarterly summary', transcript: [{ role: 'user', content: 'Quarterly summary' }] },
        T0,
      );

      const steps = [
        { id: 'c1', state: 'done', icon: 'database', label: 'Read the tables', detail: '', tables: ['conn_01.orders'] },
      ];
      expect(
        await repo.finishTurn(turn.id, {
          status: 'done',
          transcript: [
            { role: 'user', content: 'Quarterly summary' },
            { role: 'assistant', content: '{"schema_version":"adminium.assistant/v1"}' },
          ],
          steps,
          say: 'Here is a draft.',
          result: { title: 'Quarterly summary', artefact: { name: 'Q3', body: { blocks: [] } } },
          tokensIn: 900,
          tokensOut: 210,
          durationMs: 4200,
          finishedAt: T0 + 4200,
        }),
      ).toBe(true);

      const read = await repo.findTurn(turn.id);
      expect(read?.status).toBe('done');
      expect(read?.steps).toEqual(steps);
      expect(read?.transcript).toHaveLength(2);
      // Compared as VALUES: postgres jsonb and MySQL json both reorder object
      // keys, so a byte comparison would pass on SQLite alone.
      expect(read?.result).toEqual({ title: 'Quarterly summary', artefact: { name: 'Q3', body: { blocks: [] } } });
      expect(read?.error).toBeNull();
      expect(read?.finishedAt).toBe(T0 + 4200);
    });

    it('keeps a failed turn`s error whatever shape it has', async () => {
      const repo = assistantSessionsRepo(t.meta);
      const session = await repo.create({ context: 'email', host: { connectionIds: [] } }, T0);
      const turn = await repo.createTurn({ sessionId: session.id, askText: 'Draft it' }, T0);
      await repo.finishTurn(turn.id, {
        status: 'failed',
        error: { kind: 'validation', errors: [{ code: 'LLM_SCHEMA_INVALID', path: 'result.title' }] },
        finishedAt: T0 + 100,
      });
      const read = await repo.findTurn(turn.id);
      expect(read?.status).toBe('failed');
      expect(read?.error).toEqual({
        kind: 'validation',
        errors: [{ code: 'LLM_SCHEMA_INVALID', path: 'result.title' }],
      });
      expect(await repo.hasLiveTurn(session.id)).toBe(false);
    });

    it('parks a turn on a question and carries the answer into the next one', async () => {
      // `awaiting_picks` is terminal for the JOB and not for the exchange: the
      // answer arrives as the NEXT turn, which is why the picks live there.
      const repo = assistantSessionsRepo(t.meta);
      const session = await repo.create({ context: 'invoices', host: { connectionIds: ['conn_01'] } }, T0);
      const asked = await repo.createTurn({ sessionId: session.id, askText: 'Bill last month' }, T0);
      await repo.finishTurn(asked.id, {
        status: 'awaiting_picks',
        say: 'Which template should I use?',
        ask: { groups: [{ key: 'tpl', title: 'Template', options: [{ key: 't1' }, { key: 't2' }] }] },
        finishedAt: T0 + 900,
      });
      const parked = await repo.findTurn(asked.id);
      expect(parked?.status).toBe('awaiting_picks');
      expect(parked?.ask).toEqual({
        groups: [{ key: 'tpl', title: 'Template', options: [{ key: 't1' }, { key: 't2' }] }],
      });
      expect(await repo.hasLiveTurn(session.id)).toBe(false);

      const answered = await repo.createTurn(
        { sessionId: session.id, picks: { tpl: 't2' }, jobId: 'job_02' },
        T0 + 1000,
      );
      expect(answered.seq).toBe(2);
      expect(answered.askText).toBeNull();
      expect((await repo.findTurn(answered.id))?.picks).toEqual({ tpl: 't2' });
      expect((await repo.findTurn(answered.id))?.jobId).toBe('job_02');

      // A turn that is superseded clears what it was holding.
      await repo.finishTurn(asked.id, { status: 'done', ask: null, result: null, error: null });
      expect((await repo.findTurn(asked.id))?.ask).toBeNull();
    });

    it('counts one-sided usage and answers nothing for a turn that is not there', async () => {
      const repo = assistantSessionsRepo(t.meta);
      const session = await repo.create({ context: 'email', host: { connectionIds: [] } }, T0);
      await repo.addUsage(session.id, { tokensIn: 40 }, T0 + 1);
      await repo.addUsage(session.id, { tokensOut: 7 }, T0 + 2);
      const read = await repo.findSession(session.id);
      expect([read?.tokensIn, read?.tokensOut]).toEqual([40, 7]);
      expect(await repo.addUsage('ast_missing', { tokensIn: 1 })).toBe(false);
      expect(await repo.findTurn('atn_missing')).toBeNull();
      expect(await repo.finishTurn('atn_missing', { status: 'done' })).toBe(false);
    });

    it('refuses a payload it could not read back', async () => {
      // A json column is validated on the way IN, so nothing unreadable is
      // ever stored — the alternative is a row that only fails when the modal
      // tries to render it.
      const repo = assistantSessionsRepo(t.meta);
      const session = await repo.create({ context: 'email', host: { connectionIds: [] } }, T0);
      const turn = await repo.createTurn({ sessionId: session.id }, T0);
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        repo.recordSteps(turn.id, [{ id: 'c1', label: 'No state' } as any]),
      ).rejects.toThrow(/invalid assistant steps/);
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        repo.create({ context: 'email', host: { connectionIds: 'conn_01' as any } }),
      ).rejects.toThrow(/invalid assistant host/);
    });

    it('refuses a status and a context outside the closed sets', async () => {
      const repo = assistantSessionsRepo(t.meta);
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        repo.create({ context: 'dashboard' as any, host: { connectionIds: [] } }),
      ).rejects.toThrow(/invalid assistant context/);
      const session = await repo.create({ context: 'email', host: { connectionIds: [] } }, T0);
      const turn = await repo.createTurn({ sessionId: session.id }, T0);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(repo.setTurnStatus(turn.id, 'finished' as any)).rejects.toThrow(/invalid assistant turn status/);
    });

    it('closes a session once, and sweeps closed sessions with their turns', async () => {
      const repo = assistantSessionsRepo(t.meta);
      const old = await repo.create({ context: 'email', host: { connectionIds: [] } }, T0);
      await repo.createTurn({ sessionId: old.id, askText: 'old' }, T0);
      const recent = await repo.create({ context: 'email', host: { connectionIds: [] } }, T0);
      await repo.createTurn({ sessionId: recent.id, askText: 'recent' }, T0);

      expect(await repo.close(old.id, T0 + 1000)).toBe(true);
      expect(await repo.close(old.id, T0 + 2000)).toBe(false); // already closed
      expect(await repo.close(recent.id, T0 + 5000)).toBe(true);

      const purged = await repo.purgeClosedBefore(T0 + 3000);
      expect(purged).toEqual({ sessions: 1, turns: 1 });
      expect(await repo.findSession(old.id)).toBeNull();
      expect(await repo.listTurns(old.id)).toEqual([]);
      expect(await repo.findSession(recent.id)).not.toBeNull();
      expect(await repo.listTurns(recent.id)).toHaveLength(1);
      // Nothing to sweep is not an error.
      expect(await repo.purgeClosedBefore(T0)).toEqual({ sessions: 0, turns: 0 });
    });

    it('finds the sessions a browser left open', async () => {
      const repo = assistantSessionsRepo(t.meta);
      const abandoned = await repo.create({ context: 'email', host: { connectionIds: [] } }, T0);
      const live = await repo.create({ context: 'email', host: { connectionIds: [] } }, T0);
      await repo.addUsage(live.id, { tokensIn: 10 }, T0 + 90_000_000);

      const stale = await repo.listStaleOpen(T0 + 86_400_000);
      expect(stale.map((s) => s.id)).toEqual([abandoned.id]);
    });

    it('lists a person`s sessions newest first', async () => {
      const repo = assistantSessionsRepo(t.meta);
      const user = await usersRepo(t.meta).create(
        { email: 'drafter@example.test', name: 'Drafter', passwordHash: 'h', status: 'active' },
        T0,
      );
      const userId = user.id;
      const first = await repo.create({ context: 'email', host: { connectionIds: [] }, createdBy: userId }, T0);
      const second = await repo.create(
        { context: 'report', host: { connectionIds: [] }, createdBy: userId },
        T0 + 1000,
      );
      await repo.create({ context: 'email', host: { connectionIds: [] } }, T0 + 2000);

      const mine = await repo.listForUser(userId);
      expect(mine.map((s) => s.id)).toEqual([second.id, first.id]);

      // The FK is SET NULL: a deleted person must not take the record of what
      // was drafted in their name with them.
      await t.meta.db.deleteFrom('adminium_users').where('id', '=', userId).execute();
      expect((await repo.findSession(first.id))?.createdBy).toBeNull();
    });

    it('accepts every string column at exactly its declared width', async () => {
      // SQLite ignores widths entirely, so this case only ever fails on
      // postgres or MySQL — which is the reason it exists.
      const sessionId = newId('ast');
      await t.meta.db
        .insertInto('adminium_assistant_sessions')
        .values({
          id: sessionId,
          context: 'c'.repeat(24),
          host: '{"connectionIds":[]}',
          draft: null,
          provider: 'p'.repeat(32),
          model: 'm'.repeat(120),
          tokensIn: 0,
          tokensOut: 0,
          status: 's'.repeat(10),
          createdBy: null,
          createdAt: T0,
          updatedAt: T0,
          closedAt: null,
        })
        .execute();
      await t.meta.db
        .insertInto('adminium_assistant_turns')
        .values({
          id: newId('atn'),
          sessionId,
          seq: 1,
          askText: 'x'.repeat(4000),
          picks: null,
          status: 'q'.repeat(16),
          jobId: newId('job'),
          transcript: '[]',
          steps: '[]',
          say: 'y'.repeat(4000),
          ask: null,
          result: null,
          error: null,
          tokensIn: null,
          tokensOut: null,
          durationMs: null,
          createdAt: T0,
          finishedAt: null,
        })
        .execute();

      const row = await t.meta.db
        .selectFrom('adminium_assistant_sessions')
        .selectAll()
        .where('id', '=', sessionId)
        .executeTakeFirst();
      expect(row?.model).toHaveLength(120);
      expect(row?.provider).toHaveLength(32);
      expect(row?.context).toHaveLength(24);
    });

    it('refuses a turn whose session does not exist', async () => {
      // The FK is the reason retention can delete a session in one statement
      // and the reason an orphan turn cannot be written in the first place.
      await expect(
        t.meta.db
          .insertInto('adminium_assistant_turns')
          .values({
            id: newId('atn'),
            sessionId: newId('ast'),
            seq: 1,
            askText: null,
            picks: null,
            status: 'queued',
            jobId: null,
            transcript: '[]',
            steps: '[]',
            say: null,
            ask: null,
            result: null,
            error: null,
            tokensIn: null,
            tokensOut: null,
            durationMs: null,
            createdAt: T0,
            finishedAt: null,
          })
          .execute(),
      ).rejects.toThrow();
    });
  });
}
