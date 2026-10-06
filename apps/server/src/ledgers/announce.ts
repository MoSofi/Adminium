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
 * Never throws for what comes after the commit: the save stands.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { auditRepo, type AutomationOrigin, type MetaDb } from '@adminium/meta';

import { rehashSampleRow } from '../apps/sample-data.js';
import type { ConnectionManager } from '../connections/manager.js';
import { emitRecordEvent, invalidateWidgetData, publishChildWrite } from '../crud/after-record-write.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { PostedOutcome } from '../crud/ledger-write.js';
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

  for (const call of told) {
    // One row a call, about the row that posted.
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

    // The ledger's own rows: to the screens always, to rules and emails when something listens.
    for (const written of call.written) {
      await safely('telling its rows', async () => {
        const pk = Object.fromEntries(written.table.primaryKey.map((column) => [column, written.row[column]]));
        const action = written.before === null ? 'create' : 'update';
        publishChildWrite(app, { connectionId, table: written.table, action, pk, row: written.row });
        if (await heard(written.table.id)) {
          await emitRecordEvent(app, { ...event, table: written.table, action, entity: { connectionId, table: written.table.id, pk, label: pkLabel(written.table, pk) }, before: written.before, after: written.row });
        }
        // A sample row a posting changed stays the sample's own to take away.
        if (written.before !== null) await rehashSampleRow(input.meta, { ...(await handle()), table: written.table }, pk);
      });
    }

    // The rows whose announced figures moved: a change of the row, said to be nobody's.
    for (const moved of call.announced ?? []) {
      await safely('telling a figure it moved', async () => {
        const at = await handle();
        const after = (await fetchByPk(at.db, moved.table, moved.pk)) ?? null;
        if (after === null) return;
        invalidateWidgetData(app, connectionId, moved.table.id);
        publishChildWrite(app, { connectionId, table: moved.table, action: 'update', pk: moved.pk, row: after });
        await emitRecordEvent(app, { ...event, table: moved.table, action: 'update', entity: { connectionId, table: moved.table.id, pk: moved.pk, label: pkLabel(moved.table, moved.pk) }, before: { ...after, ...moved.was }, after, cause: 'settled' });
        await rehashSampleRow(input.meta, { ...at, table: moved.table }, moved.pk);
      });
    }
  }
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
