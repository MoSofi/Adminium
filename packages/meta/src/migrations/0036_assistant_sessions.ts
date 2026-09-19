// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0036 — the page assistant's sessions and turns.
 *
 * ─── What a row is ─────────────────────────────────────────────────────────
 *
 * A SESSION is one open modal: the page it was opened from, the document it
 * was opened over, and the running token total. A TURN is one exchange inside
 * it — what the operator asked, every provider round-trip it took, the steps
 * it ran, and whatever it ended with (an answer, a question back, or a drafted
 * document).
 *
 * ─── Why they are rows at all ──────────────────────────────────────────────
 *
 * A turn runs as a JOB, so it outlives the request that started it and needs
 * somewhere to land. The next turn replays this turn's provider messages as
 * history. An audit row written when the operator saves a draft points at the
 * turn that proposed it, and a pointer to nothing is a weaker record. And
 * something that persists is something retention can prune, which is the last
 * of the four reasons: closed sessions older than the configured window go
 * with their turns.
 *
 * There is no history surface. Nothing lists old sessions, and nothing is
 * meant to: the modal's state is per open.
 *
 * ─── The columns that carry JSON, and why they are not tables ──────────────
 *
 * `transcript`, `steps`, `ask`, `result` and `error` are documents, not
 * relations. Nothing queries inside them: a turn is always read whole, by id,
 * to be replayed or rendered. A `turn_steps` child table would buy an ordering
 * column and a join on every read, and would still be decoded whole.
 *
 * `transcript` and `steps` are NOT NULL with no DEFAULT — MySQL refuses a
 * DEFAULT on json/text columns, and every row is written whole by the repo.
 * The four nullable ones are absent until the turn produces them.
 *
 * ─── Why the two foreign keys differ ───────────────────────────────────────
 *
 * A turn belongs to its session and means nothing without it, so the FK
 * CASCADEs and retention deletes a session in one statement. `created_by` SET
 * NULLs instead (0026/0027/0030's spelling): a deleted user must not take the
 * record of what was drafted in their name with them.
 *
 * The draft column holds the UNSAVED document an editor page had on screen
 * when the modal opened. It is the operator's own work in progress, sent so
 * the assistant can talk about what they are looking at; it is never written
 * back anywhere by anything in this store.
 */

import type { Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const sessions = metaTable('assistant_sessions');
  const turns = metaTable('assistant_turns');
  const users = metaTable('users');

  await db.schema
    .createTable(sessions)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    /** Which page opened it: `email` | `invoice-template` | `invoices` | `report`. */
    .addColumn('context', c.str(24), (col) => col.notNull())
    /** `{ documentId?, tab?, connectionIds[] }` — what the page was showing. */
    .addColumn('host', c.json, (col) => col.notNull())
    /** The editor page's on-screen, unsaved document; NULL from a manager. */
    .addColumn('draft', c.json)
    /** Recorded per session so a later provider change cannot rewrite history. */
    .addColumn('provider', c.str(32))
    .addColumn('model', c.str(120))
    .addColumn('tokens_in', c.int, (col) => col.notNull().defaultTo(0))
    .addColumn('tokens_out', c.int, (col) => col.notNull().defaultTo(0))
    /** `open` | `closed`. A session left open is closed by the sweep. */
    .addColumn('status', c.str(10), (col) => col.notNull().defaultTo('open'))
    .addColumn('created_by', c.id)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('updated_at', c.ts, (col) => col.notNull())
    .addColumn('closed_at', c.ts)
    .addForeignKeyConstraint(
      'fk_adminium_assistant_sessions_created_by',
      ['created_by'],
      users,
      ['id'],
      (cb) => cb.onDelete('set null'),
    )
    .execute();

  // "This person's sessions, newest first" — the only question asked of the
  // collection, by the sweep and by support reading a trail.
  await db.schema
    .createIndex('ix_adminium_assistant_sessions_created_by_created_at')
    .on(sessions)
    .columns(['created_by', 'created_at'])
    .execute();

  await db.schema
    .createTable(turns)
    .ifNotExists()
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('session_id', c.id, (col) => col.notNull())
    /** 1-based position in the session; the transcript replays in this order. */
    .addColumn('seq', c.int, (col) => col.notNull())
    /** What the operator typed. NULL when the turn carries only picks. */
    .addColumn('ask_text', c.text)
    /** The answers to the previous turn's question: `{ groupKey: optionKey }`. */
    .addColumn('picks', c.json)
    /** queued | running | awaiting_picks | done | failed | cancelled. */
    .addColumn('status', c.str(16), (col) => col.notNull().defaultTo('queued'))
    .addColumn('job_id', c.id)
    /** The provider messages of this turn — what the NEXT turn replays. */
    .addColumn('transcript', c.json, (col) => col.notNull())
    /** The step rows the modal drew, in the order they ran. */
    .addColumn('steps', c.json, (col) => col.notNull())
    .addColumn('say', c.text)
    /** The question back: pick groups awaiting an answer. */
    .addColumn('ask', c.json)
    /** The drafted document and everything the result card shows. */
    .addColumn('result', c.json)
    /** More than one shape lands here — a validation list, a provider failure. */
    .addColumn('error', c.json)
    .addColumn('tokens_in', c.int)
    .addColumn('tokens_out', c.int)
    .addColumn('duration_ms', c.int)
    .addColumn('created_at', c.ts, (col) => col.notNull())
    .addColumn('finished_at', c.ts)
    .addForeignKeyConstraint(
      'fk_adminium_assistant_turns_session_id',
      ['session_id'],
      sessions,
      ['id'],
      (cb) => cb.onDelete('cascade'),
    )
    .execute();

  // The session's transcript, in order — and the guarantee that two turns can
  // never claim the same position, which a replay would render twice.
  await db.schema
    .createIndex('ux_adminium_assistant_turns_session_seq')
    .on(turns)
    .columns(['session_id', 'seq'])
    .unique()
    .execute();
}
