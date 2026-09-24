// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PRODUCERS — what queues an app's emails, as its manifest declares.
 *
 * An app's outbox table is the log a person reads; every email is a row in
 * it. The producers put rows there by themselves:
 *
 *  - `onCreate`: a row made in a table (a visit booked, by anyone);
 *  - `onChange`: a column changed to one of some values (a visit marked no-show);
 *  - `before`: a lead time before a timestamp — a reminder at the hour each
 *    person chose — found by a scan once a minute, not by a write.
 *
 * Each queued row carries the address and language as they are at that
 * moment, and the links the template reads through (the visit, the person).
 * A row with no address is logged `skipped`, not dropped: the desk sees why.
 *
 * ── WHAT NEVER PRODUCES ────────────────────────────────────────────────────
 * History: an import, sample data and an undo announce no record event, so
 * they never reach a producer. A row the app's sample ledger
 * lists (a sample visit a person marked no-show, a near-future sample visit
 * the reminder scan finds); an app that is switched off; a producer gated by
 * a settings switch that is off; a recipient who opted out of reminders.
 *
 * ── ONCE ───────────────────────────────────────────────────────────────────
 * The log is the dedupe: a producer adds nothing when a row of that kind is
 * already there for that source (and, for a reminder, for that moment — a
 * moved visit gets a fresh one). The check and the insert run under one lock
 * per app, so two instances cannot both add the row.
 */
import type { Outbox, OutboxProducer } from '@adminium/manifest';
import { appOutboxesRepo, appTablesRepo, type AppOutboxRow, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { canonicalJson } from '../apps/sample-data.js';
import type { RecordWriteEvent } from '../crud/after-record-write.js';
import { withNamedLock } from '../crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { RecordWriteService, WriteContext } from '../crud/write-service.js';
import { normalizeWriteValue, sameValue } from '../crud/write-values.js';
import { asInstant } from '../automations/conditions.js';

export interface OutboxLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface OutboxDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  writes: RecordWriteService;
  logger?: OutboxLogger | undefined;
  /** A row was queued: the sender should look. */
  onQueued?: ((appKey: string) => void) | undefined;
  /** Tell the screens watching the log that a row was added — no audit, no rule run. */
  announce?: ((connectionId: string, table: ResolvedTable, row: Row) => void) | undefined;
}

/** An installed app's outbox, as stored — its tables already real. */
export interface LiveOutbox {
  appKey: string;
  connectionId: string;
  definition: Outbox;
  row: AppOutboxRow;
}

/** How long the list of live outboxes is trusted: an install shows up within it. */
const LIST_TTL_MS = 5_000;

const HOUR = 3_600_000;

/** The once-a-minute pass that queues the reminders now due. */
export const OUTBOX_SCAN_SCHEDULE_NAME = 'app-outbox-reminders';

/** The outbox a row is queued by, as the write path sees the writer. */
function outboxContext(appKey: string): WriteContext {
  return { origin: 'automation', hops: 1, actor: { kind: 'system', id: null, label: `${appKey} outbox` }, request: null };
}

type Condition = { column: string; eq?: unknown; in?: unknown[] | undefined; isNull?: boolean | undefined };

function holds(condition: Condition | undefined, row: Row): boolean {
  if (condition === undefined) return true;
  const value = row[condition.column];
  if (condition.isNull !== undefined) return (value === null || value === undefined) === condition.isNull;
  if (condition.in !== undefined) return condition.in.some((candidate) => sameValue(candidate, value));
  return sameValue(condition.eq, value);
}

const plausible = (value: unknown): value is string => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export interface OutboxProducers {
  /** A row was written: queue what its producers ask for. Never throws. */
  onRecordEvent(event: RecordWriteEvent): Promise<void>;
  /** The reminder scan: queue every `before` email now due. Returns how many were queued. */
  scan(now?: number): Promise<number>;
  /** The live outboxes, for the sender. */
  live(): Promise<LiveOutbox[]>;
  /** Whether an `onChange` producer compares this table's rows before and after. */
  watches(connectionId: string, tableId: string): Promise<boolean>;
  /** Forget the cached list: an app was installed, updated or removed. */
  reset(): void;
}

export function createOutboxProducers(deps: OutboxDeps): OutboxProducers {
  let cached: { at: number; list: LiveOutbox[] } | null = null;

  /** Every outbox of an app that is installed and switched on. */
  async function live(): Promise<LiveOutbox[]> {
    const now = Date.now();
    if (cached !== null && now - cached.at < LIST_TTL_MS) return cached.list;
    const rows = await appOutboxesRepo(deps.meta).list();
    const statuses = new Map(
      (await deps.meta.db.selectFrom('adminium_manifests').select(['id', 'status']).execute()).map((m) => [m.id, m.status] as const),
    );
    const list = rows
      .filter((row) => statuses.get(row.manifestId) === 'installed')
      .flatMap((row) => {
        try {
          return [{ appKey: row.appKey, connectionId: row.connectionId, definition: JSON.parse(row.definition) as Outbox, row }];
        } catch {
          deps.logger?.warn({ appKey: row.appKey }, 'app outbox definition does not parse — nothing is produced for it');
          return [];
        }
      });
    cached = { at: now, list };
    return list;
  }

  /** Whether a row is one the app added as sample data. */
  async function isSample(db: Kysely<SourceDatabase>, box: LiveOutbox, table: ResolvedTable, key: Row): Promise<boolean> {
    const records = await appTablesRepo(deps.meta).forInstall(box.connectionId, box.appKey);
    const ledger = records.find((record) => record.role === 'sample-ledger' && record.state === 'created');
    const ref = records.find((record) => record.tableName === table.name)?.ref;
    if (ledger === undefined || ref === undefined) return false;
    const found = await db
      .selectFrom(ledger.tableName as never)
      .select(sql`1`.as('one'))
      .where('table_ref' as never, '=', ref as never)
      .where('pk' as never, '=', canonicalJson(key) as never)
      .executeTakeFirst()
      .catch(() => undefined);
    return found !== undefined;
  }

  /**
   * The settings row's switch, as the public switches read theirs: on only
   * when there is a row and none is off — a practice with no settings row
   * sends nothing it did not mean to.
   */
  async function switchedOn(db: Kysely<SourceDatabase>, box: LiveOutbox): Promise<boolean> {
    const settings = box.definition.settings;
    if (settings?.enabled === undefined) return true;
    const rows = (await db.selectFrom(settings.table as never).select(settings.enabled as never).limit(50).execute()) as Row[];
    return rows.length > 0 && rows.every((row) => sameValue(true, row[settings.enabled!]));
  }

  /** The table a column's foreign key points at. */
  function referenced(view: SnapshotView, tableId: string, column: string): string | undefined {
    return view.model.relations.find((relation) => relation.from.tableId === tableId && relation.from.columns.length === 1 && relation.from.columns[0] === column)?.to.tableId;
  }

  async function firstRow(db: Kysely<SourceDatabase>, view: SnapshotView, tableId: string, id: unknown): Promise<Row | null> {
    if (id === null || id === undefined) return null;
    const table = view.table(tableId);
    const key = table.primaryKey[0];
    if (key === undefined) return null;
    return ((await db.selectFrom(tableId as never).selectAll().where(key as never, '=', id as never).executeTakeFirst()) as Row | undefined) ?? null;
  }

  /**
   * Queue one email for one producing row, once. `at` is a reminder's moment
   * (kept in the due column, so a moved visit is a new reminder).
   */
  async function queue(box: LiveOutbox, producer: OutboxProducer, source: ResolvedTable, row: Row, at: number | undefined): Promise<boolean> {
    const view = await deps.viewFor(box.connectionId);
    if (view === null) return false;
    const handle = await deps.manager.data(box.connectionId);
    const outbox = view.table(box.definition.table);
    const key = source.primaryKey[0];
    if (key === undefined) return false;
    const sourceKey = Object.fromEntries(source.primaryKey.map((column) => [column, row[column]]));
    const cols = box.definition.columns;
    const written = await withNamedLock({ db: handle.db, dialect: handle.dialect }, `outbox|${box.connectionId}|${box.appKey}`, 'CAPACITY_BUSY', async (db): Promise<Row | null> => {
      if (await isSample(db, box, source, sourceKey)) return null;
      if (producer.gate === 'enabled' && !(await switchedOn(db, box))) return null;
      // The log is the dedupe.
      let seen = db
        .selectFrom(outbox.id as never)
        .select(sql`1`.as('one'))
        .where(cols.kind as never, '=', producer.kind as never)
        .where(producer.link as never, '=', row[key] as never);
      // A reminder is the same one within a second of the same moment: a stored
      // instant may carry microseconds a JavaScript date cannot.
      if (at !== undefined && cols.due !== undefined) {
        const due = outbox.columns.get(cols.due);
        const spelled = (ms: number) => (due === undefined ? new Date(ms).toISOString() : normalizeWriteValue(due, new Date(ms).toISOString()));
        seen = seen.where(cols.due as never, '>', spelled(at - 1_000) as never).where(cols.due as never, '<', spelled(at + 1_000) as never);
      }
      if ((await seen.executeTakeFirst()) !== undefined) return null;

      // The links the template reads through: the producing row itself, and
      // whatever it points at under the same column name (a visit's person).
      const recipient = box.definition.recipient;
      const values: Row = { [cols.kind]: producer.kind, [producer.link]: row[key] };
      const linked = new Set([...Object.values(box.definition.links ?? {}), recipient.via, ...(recipient.fallback === undefined ? [] : [recipient.fallback.via])]);
      for (const column of linked) {
        if (column !== producer.link && outbox.columns.has(column) && row[column] !== undefined && row[column] !== null) values[column] = row[column];
      }
      if (at !== undefined && cols.due !== undefined) values[cols.due] = new Date(at).toISOString();

      // Who it goes to, as they are now: the person, else what a first visit carries.
      const person = await firstRow(db, view, recipient.table, values[recipient.via]);
      if (person !== null && producer.optIn === true && recipient.optIn !== undefined && !sameValue(true, person[recipient.optIn])) return null;
      let address: unknown = person?.[recipient.email];
      let language: unknown = recipient.language === undefined ? undefined : person?.[recipient.language];
      if (person === null && recipient.fallback !== undefined) {
        const holderTable = referenced(view, outbox.id, recipient.fallback.via);
        const holder = holderTable === undefined ? null : holderTable === source.id && values[recipient.fallback.via] === row[key] ? row : await firstRow(db, view, holderTable, values[recipient.fallback.via]);
        address = holder?.[recipient.fallback.email];
        if (recipient.fallback.language !== undefined) language = holder?.[recipient.fallback.language];
      }
      const deliverable = plausible(address);
      values[cols.to] = plausible(address) ? address.trim() : null;
      if (cols.language !== undefined && typeof language === 'string' && language !== '') values[cols.language] = language;
      values[cols.status] = deliverable ? 'queued' : 'skipped';
      if (!deliverable && cols.error !== undefined) values[cols.error] = 'No email on file';

      return await deps.writes.create({
        target: { connectionId: box.connectionId, view, table: outbox, db, dialect: handle.dialect },
        values,
        context: outboxContext(box.appKey),
        announce: async () => {},
      });
    });
    if (written === null) return false;
    deps.announce?.(box.connectionId, outbox, written);
    return written[cols.status] === 'queued';
  }

  async function onRecordEvent(event: RecordWriteEvent): Promise<void> {
    if (event.after === null || event.action === 'delete') return;
    try {
      for (const box of await live()) {
        if (box.connectionId !== event.connectionId || box.definition.table === event.table.id) continue;
        let queued = false;
        for (const producer of box.definition.producers ?? []) {
          if ('onCreate' in producer) {
            if (event.action !== 'create' || producer.onCreate.table !== event.table.id || !holds(producer.onCreate.where, event.after)) continue;
          } else if ('onChange' in producer) {
            const change = producer.onChange;
            if (event.action !== 'update' || change.table !== event.table.id || !holds(change.where, event.after)) continue;
            // "Changed to": with no stored row to compare, nothing is assumed to have changed.
            if (event.before === null) continue;
            const to = Array.isArray(change.to) ? change.to : [change.to];
            const now = event.after[change.column];
            if (!to.some((value) => sameValue(value, now)) || sameValue(event.before[change.column], now)) continue;
          } else continue;
          queued = (await queue(box, producer, event.table, event.after, undefined)) || queued;
        }
        if (queued) deps.onQueued?.(box.appKey);
      }
    } catch (error) {
      // The write happened; an email it should have queued is logged, never the write's failure.
      deps.logger?.warn({ err: error, table: event.table.id }, 'app outbox producer failed');
    }
  }

  async function scan(now: number = Date.now()): Promise<number> {
    let total = 0;
    for (const box of await live()) {
      const reminders = (box.definition.producers ?? []).filter((producer): producer is Extract<OutboxProducer, { before: unknown }> => 'before' in producer);
      if (reminders.length === 0) continue;
      try {
        const view = await deps.viewFor(box.connectionId);
        if (view === null) continue;
        const { db } = await deps.manager.data(box.connectionId);
        let queued = 0;
        for (const producer of reminders) {
          const before = producer.before;
          const source = view.table(before.table);
          const atColumn = source.columns.get(before.at);
          if (atColumn === undefined) continue;
          // Everything that could be due within the largest lead anyone may
          // choose, bounded in the spelling the engine keeps the column in.
          const spelled = (ms: number) => normalizeWriteValue(atColumn, new Date(ms).toISOString());
          const rows = (await db
            .selectFrom(source.id as never)
            .selectAll()
            .where(before.at as never, '>', spelled(now) as never)
            .where(before.at as never, '<=', spelled(now + before.lead.max * HOUR) as never)
            .execute()) as Row[];
          const fallback =
            before.lead.fallback === undefined
              ? null
              : (((await db.selectFrom(before.lead.fallback.table as never).select(before.lead.fallback.column as never).limit(1).executeTakeFirst()) as Row | undefined)?.[
                  before.lead.fallback.column
                ] ?? null);
          for (const row of rows) {
            if (!holds(before.where, row)) continue;
            const person = await firstRow(db, view, before.lead.table, row[before.lead.via]);
            const chosen = person?.[before.lead.column];
            const hours = Number(chosen === null || chosen === undefined ? fallback : chosen);
            if (!Number.isFinite(hours) || hours <= 0) continue;
            const instant = asInstant(row[before.at]);
            if (instant === null || instant - Math.min(hours, before.lead.max) * HOUR > now) continue;
            if (await queue(box, producer, source, row, instant)) queued += 1;
          }
        }
        await appOutboxesRepo(deps.meta).markScanned(box.appKey, now);
        if (queued > 0) deps.onQueued?.(box.appKey);
        total += queued;
      } catch (error) {
        deps.logger?.warn({ err: error, appKey: box.appKey }, 'app outbox reminder scan failed');
      }
    }
    return total;
  }

  async function watches(connectionId: string, tableId: string): Promise<boolean> {
    return (await live()).some(
      (box) => box.connectionId === connectionId && (box.definition.producers ?? []).some((producer) => 'onChange' in producer && producer.onChange.table === tableId),
    );
  }

  return {
    onRecordEvent,
    scan,
    live,
    watches,
    reset: () => {
      cached = null;
    },
  };
}
