// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0052: a turn remembers the page it was asked on, on every available dialect.
 *
 * - A store upgraded from before keeps every session and turn it had; a turn
 *   from before names no page (the reader falls back to the session's) and a
 *   session from before is one window's.
 * - A turn carries its own page, what that page showed, the editor's unsaved
 *   document and what it ended with, and reads them back as it wrote them —
 *   as objects, whatever the engine hands a JSON column back as.
 * - A page this build does not know reads as "the session's", never as a throw.
 */
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, assistantSessionsRepo, usersRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const WAVE = '0052_assistant_turn_page';
const BEFORE = ALL_MIGRATIONS.filter((m) => m.name < WAVE);
const UP_TO = ALL_MIGRATIONS.filter((m) => m.name <= WAVE);

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`${WAVE} [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('keeps what a store from before it held: a turn that names no page, a session that is one window', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: BEFORE });
      const now = Date.now();
      await sql`INSERT INTO adminium_assistant_sessions (id, context, host, draft, provider, model, tokens_in, tokens_out, status, created_by, created_at, updated_at, closed_at) VALUES (${'ast_old'}, ${'email'}, ${JSON.stringify({ connectionIds: [] })}, ${null}, ${'anthropic'}, ${'m'}, ${0}, ${0}, ${'open'}, ${null}, ${now}, ${now}, ${null})`.execute(t.meta.db);
      await sql`INSERT INTO adminium_assistant_turns (id, session_id, seq, ask_text, status, transcript, steps, created_at) VALUES (${'atn_old'}, ${'ast_old'}, ${1}, ${'Draft it'}, ${'done'}, ${JSON.stringify([{ role: 'user', content: 'Draft it' }])}, ${'[]'}, ${now})`.execute(t.meta.db);

      const applied = await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: UP_TO });
      expect(applied.applied).toEqual([WAVE]);

      const repo = assistantSessionsRepo(t.meta);
      expect(await repo.findSession('ast_old')).toMatchObject({ context: 'email', kind: 'modal', status: 'open' });
      expect(await repo.findTurn('atn_old')).toMatchObject({ askText: 'Draft it', context: null, host: null, draft: null, answer: null });
      expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: UP_TO })).applied).toEqual([]);
    });

    it('a turn carries its own page, its draft and what it ended with, and reads them back as it wrote them', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = assistantSessionsRepo(t.meta);
      const session = await repo.create({ context: 'email', host: { connectionIds: [] }, kind: 'panel' });
      expect(session.kind).toBe('panel');
      expect((await repo.findSession(session.id))?.kind).toBe('panel');

      const host = { documentId: 'rep_1', connectionIds: ['cnx_1'] };
      const draft = { name: 'Monthly', body: { blocks: [{ id: 'b1' }] } };
      const turn = await repo.createTurn({ sessionId: session.id, askText: 'Shorter', context: 'report', host, draft });
      expect(turn).toMatchObject({ context: 'report', host, draft, answer: null });

      const answer = { reads: [{ table: 'shop.orders', tool: 'read_rows', total: 830, returned: 50 }], truncated: true };
      await repo.finishTurn(turn.id, { status: 'done', say: 'Done.', answer, finishedAt: Date.now() });
      const stored = (await repo.findTurn(turn.id))!;
      expect(stored).toMatchObject({ status: 'done', context: 'report', host, draft, answer });
      // An object on every engine: jsonb and MySQL json hand back a parsed value, SQLite the text.
      expect(typeof stored.answer).toBe('object');
      expect(typeof stored.host).toBe('object');
      expect(typeof stored.draft).toBe('object');

      // A turn that names no page: the reader's fallback is the session's.
      const plain = await repo.createTurn({ sessionId: session.id, askText: 'And again' });
      expect(plain).toMatchObject({ context: null, host: null, draft: null });
    });

    it('a person has one panel conversation: the oldest open one is found, the others closed, an old one listed by its age', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = assistantSessionsRepo(t.meta);
      const at = 1_800_000_000_000;
      const person = async (email: string) => (await usersRepo(t.meta).create({ email, name: email, passwordHash: 'x' })).id;
      const a = await person('a@example.test');
      const b = await person('b@example.test');
      const first = await repo.create({ context: 'email', host: { connectionIds: [] }, kind: 'panel', createdBy: a }, at);
      const second = await repo.create({ context: 'email', host: { connectionIds: [] }, kind: 'panel', createdBy: a }, at + 5);
      const modal = await repo.create({ context: 'email', host: { connectionIds: [] }, createdBy: a }, at + 6);
      const other = await repo.create({ context: 'email', host: { connectionIds: [] }, kind: 'panel', createdBy: b }, at + 7);

      expect((await repo.openPanelOf(a))?.id).toBe(first.id);
      expect(await repo.closeOtherPanels(a, first.id, at + 10)).toBe(1);
      expect((await repo.findSession(second.id))?.status).toBe('closed');
      // Not a panel, and not this person's: both untouched.
      expect((await repo.findSession(modal.id))?.status).toBe('open');
      expect((await repo.findSession(other.id))?.status).toBe('open');

      expect((await repo.listOldPanels(at + 6)).map((row) => row.id)).toEqual([first.id]);
      // The day's pass for a window left open lists the modal and no panel.
      expect((await repo.listStaleOpen(at + 1_000)).map((row) => row.id)).toEqual([modal.id]);

      expect(await repo.hasLiveTurn(first.id)).toBe(false);
      await repo.createTurn({ sessionId: first.id, askText: 'still going' }, at + 20);
      expect(await repo.hasLiveTurn(first.id)).toBe(true);
    });

    it('reads a page this build does not know as the session`s, and refuses to write one', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = assistantSessionsRepo(t.meta);
      const session = await repo.create({ context: 'email', host: { connectionIds: [] } });
      const turn = await repo.createTurn({ sessionId: session.id, askText: 'Hello', context: 'report', host: { connectionIds: [] } });
      // As a newer server would have left it.
      await sql`UPDATE adminium_assistant_turns SET context = ${'a-page-from-the-future'} WHERE id = ${turn.id}`.execute(t.meta.db);
      expect((await repo.findTurn(turn.id))?.context).toBeNull();
      await expect(repo.createTurn({ sessionId: session.id, askText: 'x', context: 'nonsense' as never })).rejects.toThrow(/invalid assistant context/);
    });
  });
}
