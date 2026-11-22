// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every write to a source database goes through `crud/write-service.ts`, so
 * that project hooks run for all of them. This test fails when a new direct
 * write appears anywhere else in the server.
 *
 * It reads the source, not the running server: a write path nobody tests is
 * exactly the one that would slip past a behavioural check. Adminium's own
 * `adminium_*` tables are not source tables and are ignored.
 *
 * A file on the list below writes rows for a reason that has nothing to do
 * with a user's record. Adding to the list needs that reason.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

const ALLOWED: Record<string, string> = {
  'crud/write-service.ts': 'the write service itself',
  'reviews/take.ts':
    "a customer's review, written by Adminium into the add-on's own reviews table with the row's stamp, in one transaction under the row's lock: every column the server's own, the add-on's table one no person, hook or rule writes, and the stamp the reviewed row's only change, told to the rules as a change of that row after it commits",
  'reviews/tables.ts':
    "a reviews add-on's totals, kept by Adminium alone inside the write of the review whose state moved (or worked out again from the published reviews): a table no person, hook or rule writes",
  'reviews/erase.ts':
    "a forgotten person's reviews losing their name and whose they are, inside the forgetting or the erasure: Adminium's own columns of the add-on's table, as an erasure empties a person's other rows",
  'crud/band.ts':
    "a total's band picked again inside the write service's own settle (`settleParent`): the link and what is copied through it, Adminium's own columns of the parent row it already holds, written as the settle writes its totals and formulas — no rule of the table decides them and no hook or live frame is owed for a value nobody typed",
  'schema-ddl/sqlite-rebuild.ts': 'a schema change: rows are copied into the rebuilt table unchanged',
  'schema-ddl/compile.ts': 'a schema change: a required MySQL time added to a table gives the rows already there the current time',
  'routes/desktop-local-db/handlers.ts': "the desktop app's placeholder rows in a database it has just created",
  'public-api/hold-replace.ts':
    "a buyer's replaced hold: its end brought forward inside the new hold's own write, so it stops counting as a lapsed hold does; the move a lapse makes follows as an ordinary write",
  'crud/capacity/judge.ts':
    "a waitlist claim's release (`reserved.releaseTo`): the kept places it took move to their released state inside the claim's own write, under the pool's lock the judge holds — their state column only, with no audit row or live frame of their own",
  'schema-ddl/rename-repair.ts':
    "a renamed table's stored name, rewritten in the columns that keep one (a receipt's source and line): Adminium's own mend of its own text, on rows no rule of the table may refuse or decide",
  'crud/booking-busy.ts':
    "a connected calendar's busy times, swapped per account and window in one transaction under the booking guard's venue-day locks: a private table only Adminium writes, whose rows no person can write or read, so no rule, hook or live frame is owed for them",
  'crud/rows-naming.ts':
    "a leaver's rows handed to somebody else, as the person is suspended or removed: only the columns that decide whose a row is, a database's rows in one transaction, with one audit entry a table and the count (`rbac/hand-over.ts`) — no hook, rule or live frame a row, for a person who is no longer here",
  'outbox/release.ts':
    "a removed row's mail (`outbox.onDelete: release`): inside the delete's own write, the outbox rows that link to it lose the link, as a foreign key's ON DELETE SET NULL would, and its messages that had not gone are skipped as removed — put back as they were when the delete removes nothing; the delete's audit and live frame carry it",
  'apps/derived-fill.ts':
    "an app update's fill of the derived columns it adds or changes (copies, formulas, rollups, balances) on the rows already there: Adminium's own columns, by key, in one transaction with the write path's own pieces, as a settle writes them — no rule of the table decides them and no hook or live frame is owed for a value nobody typed",
  'apps/people-carry.ts':
    "an app update's one-time carry of each person's newest old answer into their declared consent column, as a yes (or no) with no record: by key, in one transaction, never through a save, which would stamp the update's runner as the one who ticked it and tell the consent log a change nobody made",
  'apps/manifest-seeds.ts':
    "a starting row's link to a later starting row, filled once both are in: the rows themselves were written through the write service inside the same transaction, and the link is the value the file names, not anything a person typed",
  'apps/sample-data.ts':
    "an app's sample-data ledger: Adminium's own list of the rows it added; the sample rows themselves go through the write service (and what a sample fills in a row already there, `@fillEmpty`, is written and emptied again as that list says)",
  'consent/apply-column.ts':
    "a consent-log event mirrored into the declared yes/no column and its strict stamps, as the system: a save would drop the stamps it is given and keep naming whoever ticked the box last, so the door writes the column, its who (the event's staff member, or nobody) and its when (the event's time) in one statement and audits it itself",
  'forms/answers.ts':
    "a stranger's form answers deleted by the engine (a person's erasure, the keeping sweep) through the one function every engine deletion of answers goes through, as the system: answers are Adminium's own record, written by Adminium alone, and no role, rule or hook of the add-on has a say in their removal",
  'forms/answer.ts':
    "a stranger's own answer, which Adminium alone writes, turned from `none` to `pending` in one guarded statement just after it is kept, when its unconfirmed yes would replace an earlier no: the answer then waits for its confirmation link as one with confirmation asked does; no rule or hook watches a table nobody else writes",
  'forms/confirm.ts':
    "a forms add-on's answer row, which Adminium alone writes (no role, grant or step of the add-on does): a sign-up confirmed by its mail's link turns `confirmed` only from `pending`, in one guarded statement so two presses confirm once, and the sweep lets a sign-up still waiting after its link's days go (`expired`); no rule or hook watches a table nobody else writes, and the consent log is the record",
  'outbox/survey-link.ts':
    "a named survey's invitation keeps the hash of the token its mail carries and when it stops, written as the system once the message is claimed and only while the invitation is unanswered: Adminium's own record of a link it made, never a person's save",
  'privacy/form-answers.ts':
    "the survey invitations sent to an erased person lose the address and the name, by key, as the system, under the privacy action, for the reasons the erasure of their own rows gives (privacy/erase-rows.ts)",
  'privacy/forget-copies.ts':
    "a person's own delete empties the declared copies on the rows linked to their key, inside the transaction that empties their own row, as the system: a save would judge the booking again, move or lock on a state, stamp, mail and fire the app's rules",
  'privacy/erase-rows.ts':
    "a person erased in place under the privacy action: their own fields, their declared copies and their outbox mail emptied by key, one transaction a database, as the system — a save would run under a role's reach and stop half-way, drop the strict stamps it empties, fire the rules (which would mail and copy the name back into history), follow copies into sent and locked rows, and log the name in its before-image; the erasure audits itself with counts and a keyed hash",
  'forms/invitation.ts':
    "a named survey's invitation marked answered by the answer sent with its token, in that answer's own transaction and only while still unanswered, so two sends with one token spend it once: Adminium's own record of a link it made, never a person's save",
  'chat/store.ts':
    "a live chat's conversation moved with its messages (its last message, its automatic count, its state, the visitor's heartbeat, the details they typed, the row it became), in a chat add-on's own conversations table, which Adminium alone writes (the manifest refuses any role, grant, step or public entry that would): the inserts go through the write service's check, and each change publishes the table's live frame itself",
  'leads/found-store.ts':
    "a found person's row, which only Adminium writes: marked told or not when their tell mail goes or fails, and given its outbox row — a row no person writes, so no rule, hook or live frame is owed for it (`compose.ts` refuses a person's own write)",
  'privacy/found-people.ts':
    "a found person's rows, tell mails and fields' sources deleted by key, as the system, by a person's erasure under the privacy action and the keeping sweep, as a chat's conversations are (chat/transcripts.ts)",
  'routes/mail-door/object.ts':
    "a found person's own people row deleted once they objected and were erased in place, and only when no other row links to it: the person asked for it, through their mail's signed link, with nothing of theirs left in it to tell a rule or a screen",
  'chat/transcripts.ts':
    "a chat add-on's conversations removed with their messages and the answerer's choices, by key, as the system: by a person's erasure under the privacy action, and by the daily keeping sweep the add-on's own setting asks for, as form answers are (forms/answers.ts) — rows no person writes, so no rule, hook or live frame is owed for them",
  'leads/write.ts':
    "a field's source noted in a lead source add-on's fields' sources table, which Adminium alone writes (`compose.ts` refuses a person's own write): the one before it replaced and the new one checked by the write service, beside the fill or add the person made through the data routes — a row no person writes, so no rule, hook or live frame is owed for it",
  'leads/sole-trader.ts':
    "a sole trader's mark in a lead source add-on's fields' sources table, which Adminium alone writes (`compose.ts` refuses a person's own write): the one before it replaced and the new one checked by the write service, taken away again when the person is not kept — a row no person writes, so no rule, hook or live frame is owed for it",
  'leads/people.ts':
    "what keeping a found person half-wrote, taken away again as the engine when the rest could not be written (their tell mail, their found person's row, the contact the staff member's save had just made): the person was never kept, so no rule, screen or live frame is owed a removal of what nobody was told was there",
  'routes/leads/index.ts':
    "the company row the lead door had just added for a sole trader, removed as the engine when the person it is could not be kept, whoever asked: a person's details may not stay with nobody told, and a rep's missing delete grant must not keep them",
  'forms/files.ts':
    "a form answer's files in the forms add-on's own files table, which Adminium alone writes (the manifest refuses any role, grant, step or public entry that would): written with the answer they belong to and removed with it, as a ledger's receipts are — no rule, hook or live frame is owed for rows no person writes",
};

/** Kysely's write builders, unless their table is one of Adminium's own. */
const BUILDER_WRITE = /\.(insertInto|updateTable|deleteFrom|replaceInto|mergeInto)\(\s*(?!['"`]adminium_)/g;

/** Hand-written SQL that changes rows. */
const RAW_WRITE = /\b(insert\s+(?:or\s+\w+\s+)?into|delete\s+from|replace\s+into|merge\s+into|truncate\s+table|update\s+[`"\w.${}()]+\s+set)\b/gi;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** The code without its comments, keeping line numbers. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (_line, before: string) => before);
}

function writesIn(file: string): string[] {
  const code = stripComments(readFileSync(file, 'utf8'));
  const found: string[] = [];
  for (const pattern of [BUILDER_WRITE, RAW_WRITE]) {
    for (const match of code.matchAll(pattern)) {
      const line = code.slice(0, match.index).split('\n').length;
      found.push(`${String(line)}: ${match[0].trim()}`);
    }
  }
  return found;
}

describe('source database writes', () => {
  const files = sourceFiles(SRC);
  const byFile = new Map(files.map((file) => [relative(SRC, file).split('\\').join('/'), writesIn(file)]));

  it('happen only in the write service and the files listed with a reason', () => {
    const outside = [...byFile]
      .filter(([path, writes]) => writes.length > 0 && !(path in ALLOWED))
      .map(([path, writes]) => `${path}\n  ${writes.join('\n  ')}`);
    expect(
      outside,
      'Write through crud/write-service.ts so project hooks run, or add the file to ALLOWED with the reason.',
    ).toEqual([]);
  });

  it('lists no file that has stopped writing', () => {
    const stale = Object.keys(ALLOWED).filter((path) => (byFile.get(path) ?? []).length === 0);
    expect(stale).toEqual([]);
  });

  it('sees the writes it is looking for', () => {
    const sample = [
      "await trx.insertInto(table.id).values(row).execute();",
      "db\n  .updateTable(\n    table.id)",
      'db.prepare(`DELETE FROM ${q(name)}`)',
      "sql`update ${sql.table(name)} set x = 1`",
    ].join('\n');
    const found = [BUILDER_WRITE, RAW_WRITE].flatMap((pattern) => [...sample.matchAll(pattern)]);
    expect(found).toHaveLength(4);
    expect([..."meta.db.insertInto('adminium_users')".matchAll(BUILDER_WRITE)]).toHaveLength(0);
    expect(stripComments('// db.deleteFrom(table.id)\nconst url = "http://x";')).not.toContain('deleteFrom');
  });
});
