// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A POSTING DID, TOLD ONCE THE SAVE HAS COMMITTED.
 *
 * The row that was saved is announced by its own door, as ever. This tells
 * the rest: one audit row for each call (posted, or given back — however
 * many rows of the ledger it wrote); the ledger's own rows to the screens
 * that show them, and to rules and emails only when something listens to
 * that table; and the rows whose announced figures the posting moved (an
 * item that turned low) as a change of that row nobody made by hand — an
 * event with `cause: 'settled'`, and no audit row of its own.
 *
 * ONE SAVE, ONE CHANGE A ROW. Two calls of one save may write or move the
 * same row (two takes from one account: the first turns it low, the second
 * empty). That row is told once — as it was before the save's first call,
 * and as the save left it — so a rule on its change runs once. A row both
 * written and moved is told as written; a row whose moves cancel out (low,
 * then not low) moved no announced figure, and is not told as moved.
 *
 * Never throws for what comes after the commit: the save stands.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { auditRepo, type AutomationOrigin, type MetaDb } from '@adminium/meta';

import { rehashSampleRow } from '../apps/sample-data.js';
import type { ConnectionManager } from '../connections/manager.js';
import { emitRecordEvent, invalidateWidgetData, publishChildWrite } from '../crud/after-record-write.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { PostedOutcome } from '../crud/ledger-write.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk, pkLabel } from '../crud/records.js';

export interface PostingsAnnouncement {
  connectionId: string;
  view: SnapshotView;
  postings: readonly PostedOutcome[] | undefined;
  origin: AutomationOrigin;
  request?: FastifyRequest | null | undefined;
  actor?: { id: string | null; label: string; kind?: 'user' | 'api-key' | 'system' | 'automation' | undefined } | undefined;
  hops?: number | undefined;
  ruleId?: string | null | undefined;
  /** Whether anything listens to a table's changes (an outbox, a rule): only then is a ledger row's write an event. */
  watches: (connectionId: string, tableId: string) => Promise<boolean>;
  manager: ConnectionManager;
  meta: MetaDb;
}

export async function announcePostings(app: FastifyInstance, input: PostingsAnnouncement): Promise<void> {
  const { connectionId } = input;
  const told = (input.postings ?? []).filter((call) => call.quote === undefined);
  if (told.length === 0) return;
  const safely = async (what: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      app.log.warn({ err: error, connectionId }, `a posting was saved, and ${what} failed`);
    }
  };
  const listening = new Map<string, boolean>();
  const heard = async (tableId: string): Promise<boolean> => {
    if (!listening.has(tableId)) listening.set(tableId, await input.watches(connectionId, tableId).catch(() => false));
    return listening.get(tableId)!;
  };
  const event = { connectionId, origin: input.origin, ...(input.hops === undefined ? {} : { hops: input.hops }), ...(input.ruleId === undefined ? {} : { ruleId: input.ruleId }) };
  const handle = async () => {
    const { db, dialect } = await input.manager.data(connectionId);
    return { connectionId, db, dialect };
  };

  // One audit row a call, about the row that posted.
  for (const call of told) {
    await safely('its audit row', async () => {
      const entry = {
        category: 'data' as const,
        action: call.phase === 'reverse' ? 'ledger.reversed' : 'ledger.posted',
        connectionId,
        ...(call.record === undefined ? {} : { entity: { connectionId, table: call.record.table.id, pk: call.record.pk, label: pkLabel(call.record.table, call.record.pk) } }),
        changes: { after: { addOn: call.addOn, ledger: call.ledger, action: call.action, posting: call.posting, phase: call.phase, round: call.round, rows: call.rows, version: call.version, ...(call.state === 'unplanned' ? { state: 'unplanned' } : {}) } },
      };
      if (input.request) await app.rbac.audit(input.request, entry);
      else await auditRepo(input.meta).append({ ...entry, actorKind: input.actor?.kind ?? 'automation', actorId: input.actor?.id ?? null, actorLabel: input.actor?.label ?? 'Automation' });
    });
  }

  // Every row the save's calls wrote or moved, once, in the order first met.
  for (const row of rowsOf(told)) {
    if (row.written) {
      // The ledger's own rows: to the screens always, to rules and emails when something listens.
      await safely('telling its rows', async () => {
        const after = row.moved === null ? row.after! : ((await fetchByPk((await handle()).db, row.table, row.pk)) ?? row.after!);
        const action = row.before === null ? 'create' : 'update';
        if (row.moved !== null) invalidateWidgetData(app, connectionId, row.table.id);
        publishChildWrite(app, { connectionId, table: row.table, action, pk: row.pk, row: after, ...(row.before === null ? {} : { before: row.before }) });
        if (row.moved !== null || (await heard(row.table.id))) {
          await emitRecordEvent(app, { ...event, table: row.table, action, entity: { connectionId, table: row.table.id, pk: row.pk, label: pkLabel(row.table, row.pk) }, before: row.before, after });
        }
        // A sample row a posting changed stays the sample's own to take away.
        if (row.before !== null) await rehashSampleRow(input.meta, { ...(await handle()), table: row.table }, row.pk);
      });
      continue;
    }
    // The rows whose announced figures moved: a change of the row, said to be nobody's.
    await safely('telling a figure it moved', async () => {
      const at = await handle();
      const after = (await fetchByPk(at.db, row.table, row.pk)) ?? null;
      if (after === null) return;
      const was = row.moved!;
      // Moved, and moved back within the save: no announced figure moved.
      if (Object.keys(was).every((column) => sameFigure(was[column], after[column]))) return;
      invalidateWidgetData(app, connectionId, row.table.id);
      publishChildWrite(app, { connectionId, table: row.table, action: 'update', pk: row.pk, row: after });
      await emitRecordEvent(app, { ...event, table: row.table, action: 'update', entity: { connectionId, table: row.table.id, pk: row.pk, label: pkLabel(row.table, row.pk) }, before: { ...after, ...was }, after, cause: 'settled' });
      await rehashSampleRow(input.meta, { ...at, table: row.table }, row.pk);
    });
  }
}

/** One row a save's calls wrote or moved, merged across the calls. */
interface ToldRow {
  table: ResolvedTable;
  pk: Row;
  /** Written by a call: the row before the first call wrote it (null: the save made it), and as the last call wrote it. */
  written: boolean;
  before: Row | null;
  after: Row | null;
  /** Its announced figures as they stood before the first call moved them; null when no call moved one. */
  moved: Row | null;
}

/** The key a row is merged by: its table and its key, however a value is spelled. */
const rowKey = (table: ResolvedTable, pk: Row): string => JSON.stringify([table.id, ...table.primaryKey.map((column) => String(pk[column]))]);

/** Whether a figure stands where it stood: a number is the same number however the engine spells it. */
function sameFigure(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : String(a) === String(b);
}

/**
 * The rows a save's calls wrote or moved, each once: `before` from the first
 * call that touched it, the figures as they stood before the first call that
 * moved one, `after` from the last call that wrote it.
 */
function rowsOf(calls: readonly PostedOutcome[]): ToldRow[] {
  const rows = new Map<string, ToldRow>();
  for (const call of calls) {
    for (const written of call.written) {
      const pk = Object.fromEntries(written.table.primaryKey.map((column) => [column, written.row[column]]));
      const key = rowKey(written.table, pk);
      const seen = rows.get(key);
      if (seen === undefined) rows.set(key, { table: written.table, pk, written: true, before: written.before, after: written.row, moved: null });
      else if (!seen.written) {
        // Moved by an earlier call, written by this one: as it stood before that move, with its figures as they were.
        rows.set(key, { ...seen, written: true, before: written.before === null ? null : { ...written.before, ...seen.moved }, after: written.row });
      } else seen.after = written.row;
    }
    for (const moved of call.announced ?? []) {
      const key = rowKey(moved.table, moved.pk);
      const seen = rows.get(key);
      if (seen === undefined) rows.set(key, { table: moved.table, pk: moved.pk, written: false, before: null, after: null, moved: { ...moved.was } });
      // The figures as the first move found them win: a later move found them already moved.
      else seen.moved = { ...moved.was, ...(seen.moved ?? {}) };
    }
  }
  return [...rows.values()];
}

/** What a door hands over: the rest is the server's own (who listens, where the rows are). */
export type PostingsTold = Omit<PostingsAnnouncement, 'watches' | 'manager' | 'meta'>;

declare module 'fastify' {
  interface FastifyInstance {
    /** Tells what a save's postings did, once it has committed. Absent on a server composed without add-ons. */
    ledgerPostings: (input: PostingsTold) => Promise<void>;
  }
}

/** Tells what a save's postings did — from any door, beside the announcement of the row itself. Nothing to tell, nothing done. */
export async function tellPostings(app: FastifyInstance, input: PostingsTold): Promise<void> {
  if ((input.postings ?? []).length === 0 || !app.hasDecorator('ledgerPostings')) return;
  await app.ledgerPostings(input);
}
