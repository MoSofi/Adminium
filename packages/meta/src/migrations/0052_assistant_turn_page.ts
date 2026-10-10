// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0052 — a turn remembers the page it was asked on.
 *
 * ─── `adminium_assistant_turns.context`, `.host`, `.draft` ─────────────────
 * A conversation with the assistant was one open window on one page, so the
 * page lived on the session. A conversation that goes on while the person
 * walks from page to page is asked something on each of them: the prompt of a
 * turn, the tools it is offered and the page its draft belongs to are the
 * TURN's. All three are NULL on every turn written before this wave, and on
 * a turn from a client that names no page; the reader then falls back to the
 * session's, which is what such a turn was asked on.
 *
 * `draft` is the editor's on-screen, unsaved document at the moment of the
 * question. The session kept one, written when the window opened and never
 * again; an editor the person walks to later has its own.
 *
 * ─── `adminium_assistant_turns.answer` ─────────────────────────────────────
 * What a turn ended with besides its words and its draft: which tables its
 * tools really read, whether a read was cut short, what it suggested. Kept
 * apart from `result`, whose presence means "this turn made a draft" to
 * every reader there is.
 *
 * ─── `adminium_assistant_sessions.kind` ────────────────────────────────────
 * `modal` for every session so far (one window, closed with it); `panel` for
 * the conversation that stays open across pages, of which a person has one.
 *
 * One `alterTable` a column: MySQL takes several in one statement and SQLite
 * does not.
 */
import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  await db.schema.alterTable(metaTable('assistant_turns')).addColumn('context', c.str(24)).execute();
  await db.schema.alterTable(metaTable('assistant_turns')).addColumn('host', c.json).execute();
  await db.schema.alterTable(metaTable('assistant_turns')).addColumn('draft', c.json).execute();
  await db.schema.alterTable(metaTable('assistant_turns')).addColumn('answer', c.json).execute();
  await db.schema
    .alterTable(metaTable('assistant_sessions'))
    .addColumn('kind', c.str(10), (col) => col.notNull().defaultTo('modal'))
    .execute();
}
