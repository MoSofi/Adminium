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
 * A source may be a CHILD table (`via`): a version posted to a deliverable
 * makes a message about the deliverable, linked to it, addressed through it.
 *
 * Each queued row carries the address and language as they are at that
 * moment, and the links the template reads through (the visit, the person).
 * A row with no address is logged `skipped`, not dropped: the desk sees why.
 *
 * ── HELD, DUE, BATCHED ──────────────────────────────────────────────────────
 * A producer that HOLDS writes its rows `held`: nothing is sent until a
 * person approves one. Each carries its own due moment (`timing.ts`) — an
 * invoice's three reminders are made when it is SENT, each due some days
 * after its due date at 09:00 on the venue's clock, and "ready" means held
 * and due. A held row is made even with no address on file: the address is
 * looked up again when it is approved and when it is sent.
 * A producer with `batchMinutes` sends one message per linked row per
 * window: the first event opens a row due at the window's end, and every
 * event while it still waits is taken in by it (five versions posted in ten
 * minutes make one "new work to review" email).
 * A producer with `recipient.setting` writes to the address a setting holds
 * (the studio's own), never to the person the row links.
 *
 * ── THE MINUTE SCAN ─────────────────────────────────────────────────────────
 * Besides the `before` reminders, once a minute the scan:
 *  - REPAIRS: producers run after a write, so a crash between the two leaves
 *    a sent invoice with no reminders; the scan makes a held producer's row
 *    for every watched row in the state that has none of that kind — an
 *    imported sent invoice too (an import announces nothing). Held only: a
 *    notice that sends by itself is never made late by a repair.
 *  - RE-DATES every message still waiting (held, or queued with its due still
 *    ahead) whose date inputs moved — by UPDATE, never a new row;
 *  - DROPS waiting messages no longer needed (`dropWhen`: the invoice paid,
 *    voided) — a balance moves in settle statements that announce nothing,
 *    so the scan reads the rows rather than waiting for an event;
 *  - SUPERSEDES: once a later message of a group has come due for a row, the
 *    earlier ones not yet sent are skipped as overtaken — so one invoice
 *    never has two reminders ready at once.
 * The sender judges all three again just before it sends. A batch still
 * waiting for its window to close is dropped and overtaken too, but never
 * re-dated: its window is its day.
 *
 * ── WHAT NEVER PRODUCES ────────────────────────────────────────────────────
 * History: an import, sample data and an undo announce no record event, so
 * they never reach a producer. A row the app's sample ledger
 * lists (a sample visit a person marked no-show, a near-future sample visit
 * the reminder scan finds, a sample invoice the repair finds); an app that is
 * switched off; a producer gated by a settings switch that is off; a
 * recipient who opted out of reminders.
 *
 * ── ONCE ───────────────────────────────────────────────────────────────────
 * The log is the dedupe: a producer adds nothing when a row of that kind is
 * already there for that source (for a reminder, for that moment — a moved
 * visit gets a fresh one; for a batch, one still waiting in its window). The
 * check and the insert run under one lock per app, so two instances — or a
 * producer and the repair — cannot both add the row.
 */
import type { Outbox, OutboxProducer, SettingSource } from '@adminium/manifest';
import { appOutboxesRepo, appTablesRepo, connectionTenantConfig, type AppOutboxRow, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import { canonicalJson } from '../apps/sample-data.js';
import type { RecordWriteEvent } from '../crud/after-record-write.js';
import { slotInstant, withNamedLock } from '../crud/capacity-guard.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { RecordWriteService } from '../crud/write-service.js';
import { normalizeWriteValue, sameValue } from '../crud/write-values.js';
import { asInstant } from '../automations/conditions.js';
import { outboxContext } from './context.js';
import { addressFor, referenced, rowOf } from './recipient.js';
import { cameDue, dropReason, dueFor, groupRanks, producerOf, settingReader, skipSentence, sourceOf, type SettingReader, type SkipReason } from './timing.js';

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
  /** Tell the screens watching the log that a row was added or changed — no audit, no rule run. */
  announce?: ((connectionId: string, table: ResolvedTable, row: Row, action?: 'create' | 'update') => void) | undefined;
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
const MINUTE = 60_000;

/** The most rows one scan repairs, or judges, per producer or outbox; the next minute takes the rest. */
const SCAN_BATCH = 200;

/** The once-a-minute pass that queues the reminders now due. */
export const OUTBOX_SCAN_SCHEDULE_NAME = 'app-outbox-reminders';

type Condition = { column: string; eq?: unknown; in?: unknown[] | undefined; isNull?: boolean | undefined };

function holds(condition: Condition | undefined, row: Row): boolean {
  if (condition === undefined) return true;
  const value = row[condition.column];
  if (condition.isNull !== undefined) return (value === null || value === undefined) === condition.isNull;
  if (condition.in !== undefined) return condition.in.some((candidate) => sameValue(candidate, value));
  return sameValue(condition.eq, value);
}

/**
 * Every table an outbox's newer fields name, as the real table. The install
 * stores the log's, the person's, the settings' and each producer's source
 * by their real names; a table an `onSent`, a setting recipient or a setting
 * of days names is mapped here too, so a short name never reaches a query.
 * A name that already is a table is kept.
 */
export function withRealTables(definition: Outbox, realId: (name: string) => string): Outbox {
  const setting = (source: SettingSource): SettingSource => ('table' in source ? { ...source, table: realId(source.table) } : source);
  if (definition.producers === undefined) return definition;
  return {
    ...definition,
    producers: definition.producers.map((producer) => {
      const days = producer.due?.days;
      return {
        ...producer,
        ...(typeof producer.gate === 'object' ? { gate: { setting: { ...producer.gate.setting, table: realId(producer.gate.setting.table) } } } : {}),
        ...(producer.onSent === undefined ? {} : { onSent: { ...producer.onSent, table: realId(producer.onSent.table) } }),
        ...(producer.recipient === undefined ? {} : { recipient: { setting: setting(producer.recipient.setting) } }),
        ...(producer.due !== undefined && typeof days === 'object' && 'setting' in days ? { due: { ...producer.due, days: { ...days, setting: setting(days.setting) } } } : {}),
      };
    }),
  };
}

/**
 * The links of a message about a row, filled from that row: a column of the
 * same name (a visit's `patient_id`), else — when the row names the link's
 * table through exactly ONE foreign key — that key (a payment's
 * `document_id` fills the message's `invoice_id`: a table built on an
 * add-on's shape names its keys the shape's way). A link still empty is then
 * looked for, the same two ways, on the rows the filled links name, one hop
 * (the invoice a payment belongs to names its client). Two keys to the same
 * table are a question this cannot answer: that link is left empty, on the
 * row and past it, rather than guessed.
 */
export async function fillLinks(
  db: Kysely<SourceDatabase>,
  view: SnapshotView,
  definition: Outbox,
  outbox: ResolvedTable,
  about: { table: ResolvedTable; row: Row },
  values: Row,
  own: string,
): Promise<void> {
  const recipient = definition.recipient;
  const columns = [...new Set([...Object.values(definition.links ?? {}), recipient.via, ...(recipient.fallback === undefined ? [] : [recipient.fallback.via])])].filter(
    (column) => column !== own && outbox.columns.has(column),
  );
  const present = (value: unknown) => value !== null && value !== undefined;
  /** The value a row gives a link, `undefined` for none, `null` when two keys make it a guess. */
  const from = (table: ResolvedTable, row: Row, column: string): unknown => {
    if (table.columns.has(column) && present(row[column])) return row[column];
    const target = referenced(view, outbox.id, column);
    if (target === undefined) return undefined;
    const keys = view.model.relations.filter((relation) => relation.from.tableId === table.id && relation.from.columns.length === 1 && relation.to.tableId === target);
    if (keys.length > 1) return null;
    const value = keys.length === 1 ? row[keys[0]!.from.columns[0]!] : undefined;
    return present(value) ? value : undefined;
  };
  const ambiguous = new Set<string>();
  for (const column of columns) {
    const value = from(about.table, about.row, column);
    if (value === null) ambiguous.add(column);
    else if (value !== undefined) values[column] = value;
  }
  for (const column of columns) {
    if (present(values[column]) || ambiguous.has(column)) continue;
    for (const link of [own, ...columns]) {
      if (link === column || !present(values[link])) continue;
      const tableId = referenced(view, outbox.id, link);
      const row = await rowOf(db, view, tableId, values[link]);
      if (tableId === undefined || row === null) continue;
      const value = from(view.table(tableId), row, column);
      if (value !== null && value !== undefined) {
        values[column] = value;
        break;
      }
    }
  }
}

export interface OutboxProducers {
  /** A row was written: queue what its producers ask for. Never throws. */
  onRecordEvent(event: RecordWriteEvent): Promise<void>;
  /** The minute scan: the reminders now due, the repairs, the re-dating, the drops and the overtaken. Returns how many rows were queued or made. */
  scan(now?: number): Promise<number>;
  /** The live outboxes, for the sender. */
  live(): Promise<LiveOutbox[]>;
  /** Every stored outbox, its app switched on or not — whose table's moves are guarded. */
  all(): Promise<LiveOutbox[]>;
  /** Whether an `onChange` producer compares this table's rows before and after. */
  watches(connectionId: string, tableId: string): Promise<boolean>;
  /** Forget the cached list: an app was installed, updated or removed. */
  reset(): void;
}

/** Whether a row is one the app added as sample data: its sample ledger lists it. */
export async function isSampleRow(meta: MetaDb, db: Kysely<SourceDatabase>, box: LiveOutbox, table: ResolvedTable, key: Row): Promise<boolean> {
  const records = await appTablesRepo(meta).forInstall(box.connectionId, box.appKey);
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

export function createOutboxProducers(deps: OutboxDeps): OutboxProducers {
  let cached: { at: number; list: (LiveOutbox & { installed: boolean })[] } | null = null;

  /** Every stored outbox that parses, its tables real, and whether its app is installed and on. */
  async function stored(): Promise<(LiveOutbox & { installed: boolean })[]> {
    const now = Date.now();
    if (cached !== null && now - cached.at < LIST_TTL_MS) return cached.list;
    const rows = await appOutboxesRepo(deps.meta).list();
    const statuses = new Map(
      (await deps.meta.db.selectFrom('adminium_manifests').select(['id', 'status']).execute()).map((m) => [m.id, m.status] as const),
    );
    const list: (LiveOutbox & { installed: boolean })[] = [];
    for (const row of rows) {
      let definition: Outbox;
      try {
        definition = JSON.parse(row.definition) as Outbox;
      } catch {
        deps.logger?.warn({ appKey: row.appKey }, 'app outbox definition does not parse — nothing is produced for it');
        continue;
      }
      try {
        const names = await appTablesRepo(deps.meta).realNames(row.connectionId, row.appKey);
        const view = await deps.viewFor(row.connectionId);
        const realId = (name: string): string => {
          if (view === null || view.model.tables.some((table) => table.id === name)) return name;
          const real = names[name];
          return real === undefined ? name : (view.model.tables.find((table) => table.name === real)?.id ?? real);
        };
        definition = withRealTables(definition, realId);
      } catch (error) {
        deps.logger?.warn({ err: error, appKey: row.appKey }, 'app outbox tables could not be matched to the database');
      }
      list.push({ appKey: row.appKey, connectionId: row.connectionId, definition, row, installed: statuses.get(row.manifestId) === 'installed' });
    }
    cached = { at: now, list };
    return list;
  }

  /** Every outbox of an app that is installed and switched on. */
  async function live(): Promise<LiveOutbox[]> {
    return (await stored()).filter((box) => box.installed);
  }

  const isSample = (db: Kysely<SourceDatabase>, box: LiveOutbox, table: ResolvedTable, key: Row) => isSampleRow(deps.meta, db, box, table, key);

  /**
   * The settings row's switch, as the public switches read theirs: on only
   * when there is a row and none is off — a practice with no settings row
   * sends nothing it did not mean to.
   */
  async function switchedOn(db: Kysely<SourceDatabase>, box: LiveOutbox, gate: OutboxProducer['gate']): Promise<boolean> {
    // The outbox's own switch, or the producer's (each studio notice has one).
    const at = typeof gate === 'object' ? gate.setting : box.definition.settings?.enabled === undefined ? undefined : { table: box.definition.settings.table, column: box.definition.settings.enabled };
    if (at === undefined) return true;
    const rows = (await db.selectFrom(at.table as never).select(at.column as never).limit(50).execute()) as Row[];
    return rows.length > 0 && rows.every((row) => sameValue(true, row[at.column]));
  }

  const zoneOf = async (connectionId: string): Promise<string> => (await connectionTenantConfig(deps.meta, connectionId))?.timezone ?? 'UTC';

  /** A moment as the outbox's due column keeps it. */
  const spell = (outbox: ResolvedTable, column: string, ms: number): unknown => {
    const due = outbox.columns.get(column);
    return due === undefined ? new Date(ms).toISOString() : normalizeWriteValue(due, new Date(ms).toISOString());
  };

  /**
   * Queue one email for one producing row, once. `at` is a reminder's moment
   * (kept in the due column, so a moved visit is a new reminder).
   */
  async function queue(
    box: LiveOutbox,
    producer: OutboxProducer,
    source: ResolvedTable,
    row: Row,
    opts: { at?: number | undefined; now: number },
  ): Promise<boolean> {
    const view = await deps.viewFor(box.connectionId);
    if (view === null) return false;
    const handle = await deps.manager.data(box.connectionId);
    const outbox = view.table(box.definition.table);
    const key = source.primaryKey[0];
    if (key === undefined) return false;
    const sourceKey = Object.fromEntries(source.primaryKey.map((column) => [column, row[column]]));
    const cols = box.definition.columns;
    // The row the message is about: the source row, or — a child source —
    // the row its foreign key names (the deliverable a version was posted to).
    const via = sourceOf(producer).via;
    let about: { table: ResolvedTable; row: Row } = { table: source, row };
    if (via !== undefined) {
      const parentId = referenced(view, source.id, via);
      const parent = await rowOf(handle.db, view, parentId, row[via]);
      if (parentId === undefined || parent === null) return false;
      about = { table: view.table(parentId), row: parent };
    }
    const aboutKey = about.table.primaryKey[0];
    if (aboutKey === undefined) return false;
    const zone = await zoneOf(box.connectionId);
    const { at, now } = opts;
    const written = await withNamedLock({ db: handle.db, dialect: handle.dialect }, `outbox|${box.connectionId}|${box.appKey}`, 'CAPACITY_BUSY', async (db): Promise<Row | null> => {
      if (await isSample(db, box, source, sourceKey)) return null;
      if (about.row !== row && (await isSample(db, box, about.table, Object.fromEntries(about.table.primaryKey.map((c) => [c, about.row[c]]))))) return null;
      if (producer.gate !== undefined && !(await switchedOn(db, box, producer.gate))) return null;
      const read = settingReader(deps.meta, db);
      // The log is the dedupe.
      let seen = db
        .selectFrom(outbox.id as never)
        .select(sql`1`.as('one'))
        .where(cols.kind as never, '=', producer.kind as never)
        .where(producer.link as never, '=', about.row[aboutKey] as never);
      if (at !== undefined && cols.due !== undefined) {
        // A reminder is the same one within a second of the same moment: a stored
        // instant may carry microseconds a JavaScript date cannot.
        seen = seen.where(cols.due as never, '>', spell(outbox, cols.due, at - 1_000) as never).where(cols.due as never, '<', spell(outbox, cols.due, at + 1_000) as never);
      } else if (producer.batchMinutes !== undefined && cols.due !== undefined) {
        // One per window: a message still waiting for its window to close takes this one in.
        seen = seen.where(cols.status as never, 'in', ['queued', 'held'] as never).where(cols.due as never, '>', spell(outbox, cols.due, now) as never);
      }
      if ((await seen.executeTakeFirst()) !== undefined) return null;

      // The links the template reads through, and the recipient's.
      const recipient = box.definition.recipient;
      const values: Row = { [cols.kind]: producer.kind, [producer.link]: about.row[aboutKey] };
      await fillLinks(db, view, box.definition, outbox, about, values, producer.link);
      if (cols.due !== undefined) {
        let due: number | null | undefined;
        if (at !== undefined) due = at;
        else if (producer.batchMinutes !== undefined) due = now + producer.batchMinutes * MINUTE;
        else if (producer.due !== undefined) {
          due = await dueFor(producer.due, about.row, about.table.columns.get(producer.due.date), zone, read);
        }
        if (due !== undefined && due !== null) values[cols.due] = spell(outbox, cols.due, due);
      }

      // Who it goes to, as they are now: a setting's address, the person, else what a first visit carries.
      const addressed = await addressFor(
        { db, view, outboxId: outbox.id, read },
        box.definition,
        producer,
        values,
        { tableId: about.table.id, row: about.row },
      );
      if (addressed.person !== null && producer.optIn === true && recipient.optIn !== undefined && !sameValue(true, addressed.person[recipient.optIn])) return null;
      values[cols.to] = addressed.address;
      if (cols.language !== undefined && addressed.language !== null) values[cols.language] = addressed.language;
      // A held message waits for a person whatever its address: it is looked up again when approved.
      values[cols.status] = producer.hold === true ? 'held' : addressed.address !== null ? 'queued' : 'skipped';
      if (values[cols.status] === 'skipped' && cols.error !== undefined) values[cols.error] = 'No email on file';

      return await deps.writes.create({
        target: { connectionId: box.connectionId, view, table: outbox, db, dialect: handle.dialect },
        values,
        context: outboxContext(box.appKey, outbox.id),
        announce: async () => {},
      });
    });
    if (written === null) return false;
    deps.announce?.(box.connectionId, outbox, written, 'create');
    return written[cols.status] === 'queued' || written[cols.status] === 'held';
  }

  async function onRecordEvent(event: RecordWriteEvent): Promise<void> {
    if (event.after === null || event.action === 'delete') return;
    try {
      for (const box of await live()) {
        if (box.connectionId !== event.connectionId) continue;
        if (box.definition.table === event.table.id) {
          // A person approved a message, or queued one again: send it now, not at the next sweep.
          const status = box.definition.columns.status;
          if (event.after[status] === 'queued' && event.before?.[status] !== 'queued') deps.onQueued?.(box.appKey);
          continue;
        }
        let queued = false;
        const now = Date.now();
        for (const producer of box.definition.producers ?? []) {
          if ('onCreate' in producer) {
            if (event.action !== 'create' || producer.onCreate.table !== event.table.id || !holds(producer.onCreate.where, event.after)) continue;
          } else if ('onChange' in producer) {
            const change = producer.onChange;
            if (event.action !== 'update' || change.table !== event.table.id || !holds(change.where, event.after)) continue;
            // "Changed to": with no stored row to compare, nothing is assumed to have changed.
            if (event.before === null) continue;
            const to = Array.isArray(change.to) ? change.to : [change.to];
            const value = event.after[change.column];
            if (!to.some((candidate) => sameValue(candidate, value)) || sameValue(event.before[change.column], value)) continue;
          } else continue;
          const made = await queue(box, producer, event.table, event.after, { now });
          queued = (made && producer.hold !== true) || queued;
        }
        if (queued) deps.onQueued?.(box.appKey);
      }
    } catch (error) {
      // The write happened; an email it should have queued is logged, never the write's failure.
      deps.logger?.warn({ err: error, table: event.table.id }, 'app outbox producer failed');
    }
  }

  /** The `before` reminders now due. */
  async function reminders(box: LiveOutbox, view: SnapshotView, db: Kysely<SourceDatabase>, now: number): Promise<number> {
    let queued = 0;
    for (const producer of box.definition.producers ?? []) {
      if (!('before' in producer)) continue;
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
        const person = await rowOf(db, view, before.lead.table, row[before.lead.via]);
        const chosen = person?.[before.lead.column];
        const hours = Number(chosen === null || chosen === undefined ? fallback : chosen);
        if (!Number.isFinite(hours) || hours <= 0) continue;
        const instant = asInstant(row[before.at]);
        if (instant === null || instant - Math.min(hours, before.lead.max) * HOUR > now) continue;
        if (await queue(box, producer, source, row, { at: instant, now })) queued += 1;
      }
    }
    return queued;
  }

  /**
   * A watched row that reached its state with no message of a held
   * producer's kind — a crash between the write and its producers, or an
   * invoice brought in by an import — gets it now, held. Only `onChange`
   * producers on the watched table itself: they say what "reached the state"
   * means. A row a `dropWhen` already covers needs none.
   */
  /** Where each held producer's repair stopped, so the next minute goes on from there. */
  const repairedUpTo = new Map<string, unknown>();
  async function repair(box: LiveOutbox, view: SnapshotView, db: Kysely<SourceDatabase>, now: number): Promise<number> {
    let made = 0;
    const outbox = view.table(box.definition.table);
    for (const producer of box.definition.producers ?? []) {
      if (producer.hold !== true || !('onChange' in producer) || producer.onChange.via !== undefined) continue;
      const change = producer.onChange;
      const source = view.table(change.table);
      const key = source.primaryKey[0];
      if (key === undefined) continue;
      const states = Array.isArray(change.to) ? change.to : [change.to];
      // A page a minute, taken up where the last one stopped: rows it passes
      // over for good (paid, sample) never starve the ones after them.
      const place = `${box.appKey}|${producer.kind}`;
      const after = repairedUpTo.get(place);
      let query = db
        .selectFrom(`${source.id} as src` as never)
        .selectAll('src' as never)
        .where(sql.ref(`src.${change.column}`), 'in', states as never);
      if (after !== undefined) query = query.where(sql.ref(`src.${key}`), '>', after as never);
      const candidates = (await query
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom(`${outbox.id} as ob` as never)
                .select(sql`1`.as('one'))
                .where(sql.ref(`ob.${box.definition.columns.kind}`), '=', producer.kind)
                .whereRef(sql.ref(`ob.${producer.link}`) as never, '=', sql.ref(`src.${key}`) as never),
            ),
          ),
        )
        .orderBy(sql.ref(`src.${key}`))
        .limit(SCAN_BATCH)
        .execute()) as Row[];
      if (candidates.length < SCAN_BATCH) repairedUpTo.delete(place);
      else repairedUpTo.set(place, candidates.at(-1)![key]);
      for (const row of candidates) {
        if (!holds(change.where, row) || dropReason(producer.dropWhen, row) !== null) continue;
        if (await queue(box, producer, source, row, { now })) made += 1;
      }
    }
    return made;
  }

  /**
   * The waiting messages judged again: re-dated when their inputs moved,
   * skipped when no longer needed, skipped when overtaken.
   */
  async function judge(box: LiveOutbox, view: SnapshotView, now: number): Promise<void> {
    const definition = box.definition;
    const cols = definition.columns;
    // A batch is dropped and overtaken like any message, but never re-dated: its window is its day.
    const judged = (definition.producers ?? []).filter(
      (producer) => (producer.batchMinutes === undefined && producer.due !== undefined) || producer.dropWhen !== undefined || producer.supersede !== undefined,
    );
    if (judged.length === 0) return;
    const handle = await deps.manager.data(box.connectionId);
    const outbox = view.table(definition.table);
    const key = outbox.primaryKey[0];
    if (key === undefined) return;
    const zone = await zoneOf(box.connectionId);
    const changed: Row[] = [];
    await withNamedLock({ db: handle.db, dialect: handle.dialect }, `outbox|${box.connectionId}|${box.appKey}`, 'CAPACITY_BUSY', async (db) => {
      const kinds = [...new Set(judged.map((producer) => producer.kind))];
      const read = settingReader(deps.meta, db);
      // Every waiting message, a page at a time.
      let last: unknown;
      for (;;) {
        let page = db
          .selectFrom(outbox.id as never)
          .selectAll()
          .where(cols.kind as never, 'in', kinds as never)
          .where(cols.status as never, 'in', ['held', 'queued'] as never);
        if (last !== undefined) page = page.where(key as never, '>', last as never);
        const rows = (await page.orderBy(key as never).limit(SCAN_BATCH).execute()) as Row[];
        if (rows.length === 0) break;
        last = rows.at(-1)![key];
        const verdicts = await verdictsFor({ db, view, outbox, definition, zone, read, now }, rows, 'scan');
        for (const row of rows) {
          const verdict = verdicts.get(row);
          if (verdict === undefined) continue;
          const values: Row = {};
          if (verdict.skip !== undefined) {
            values[cols.status] = 'skipped';
            if (cols.skipReason !== undefined) values[cols.skipReason] = verdict.skip;
            else if (cols.error !== undefined) values[cols.error] = skipSentence(verdict.skip);
          } else if (verdict.due !== undefined && cols.due !== undefined) {
            values[cols.due] = verdict.due === null ? null : spell(outbox, cols.due, verdict.due);
          } else continue;
          const result = await deps.writes.update({
            target: { connectionId: box.connectionId, view, table: outbox, db, dialect: handle.dialect },
            pk: { [key]: row[key] },
            values,
            context: outboxContext(box.appKey, outbox.id),
            // Only while it still is as it was read: a person approving it meanwhile wins.
            refine: (query) => query.where(sql.ref(cols.status), '=', row[cols.status] as string),
            skipIfNone: true,
            announce: async () => {},
          });
          if (result.count > 0 && result.after !== null) changed.push(result.after);
        }
        if (rows.length < SCAN_BATCH) break;
      }
    });
    for (const row of changed) deps.announce?.(box.connectionId, outbox, row, 'update');
  }

  async function scan(now: number = Date.now()): Promise<number> {
    let total = 0;
    for (const box of await live()) {
      try {
        const view = await deps.viewFor(box.connectionId);
        if (view === null) continue;
        const { db } = await deps.manager.data(box.connectionId);
        const queued = await reminders(box, view, db, now);
        const made = await repair(box, view, db, now);
        await judge(box, view, now);
        await appOutboxesRepo(deps.meta).markScanned(box.appKey, now);
        if (queued > 0) deps.onQueued?.(box.appKey);
        total += queued + made;
      } catch (error) {
        deps.logger?.warn({ err: error, appKey: box.appKey }, 'app outbox scan failed');
      }
    }
    return total;
  }

  async function watches(connectionId: string, tableId: string): Promise<boolean> {
    return (await live()).some(
      (box) =>
        box.connectionId === connectionId &&
        // A person approving a message is told apart from one re-sending it by the stored row.
        (box.definition.table === tableId || (box.definition.producers ?? []).some((producer) => 'onChange' in producer && producer.onChange.table === tableId)),
    );
  }

  return {
    onRecordEvent,
    scan,
    live,
    all: stored,
    watches,
    reset: () => {
      cached = null;
    },
  };
}

// --- judging a message before it goes -----------------------------------------

export interface Verdict {
  /** Skip it, and why. */
  skip?: SkipReason;
  /** Its due moment worked out again (null: it can no longer be worked out). */
  due?: number | null;
}

/**
 * What becomes of each row, judged together so a group's rows see each
 * other: skipped when the row it is about no longer needs it (`dropWhen`),
 * else overtaken when a later message of its group has come due, else
 * re-dated when its due moved by a second or more. A row absent from the map
 * stays as it is. The scan and the sender (just before it sends) share it.
 *
 * `scan` judges the rows still waiting: held, or queued with the due still
 * ahead, or queued by a person's approval. `send` judges rows about to go:
 * dropped and overtaken the same way, and a row whose due has moved ahead
 * is re-dated rather than sent. A queued row of a producer that holds was
 * approved by a person: it is dropped or overtaken, never re-dated. Nor is a
 * batch, whose due is the end of its window: it is dropped and overtaken
 * like any message, or the manifest's `dropWhen` and `supersede` on it would
 * say something that never happens.
 */
export async function verdictsFor(
  ctx: {
    db: Kysely<SourceDatabase>;
    view: SnapshotView;
    outbox: ResolvedTable;
    definition: Outbox;
    zone: string;
    read: SettingReader;
    now: number;
  },
  rows: readonly Row[],
  mode: 'scan' | 'send',
): Promise<Map<Row, Verdict>> {
  const { db, view, outbox, definition, now } = ctx;
  const cols = definition.columns;
  const key = outbox.primaryKey[0] ?? '';
  const out = new Map<Row, Verdict>();
  const about = new Map<string, Row | null>();
  const aboutRow = async (producer: OutboxProducer, row: Row): Promise<{ table: ResolvedTable; row: Row } | null> => {
    const tableId = referenced(view, outbox.id, producer.link);
    if (tableId === undefined) return null;
    const id = row[producer.link];
    const memo = `${tableId}|${String(id)}`;
    if (!about.has(memo)) about.set(memo, await rowOf(db, view, tableId, id));
    const found = about.get(memo) ?? null;
    return found === null ? null : { table: view.table(tableId), row: found };
  };

  const judged: Row[] = [];
  for (const row of rows) {
    const producer = producerOf(definition, row[cols.kind]);
    if (producer === undefined) continue;
    // A batch is due when its window closes, whatever its producer's `due` reads.
    const batched = producer.batchMinutes !== undefined;
    const status = row[cols.status];
    const due = slotInstant(cols.due === undefined ? null : row[cols.due])?.getTime() ?? null;
    const approved = status === 'queued' && producer.hold === true;
    // Waiting: held; approved; for later; or of a producer with a day not yet worked out.
    const judge =
      mode === 'send' ? status === 'queued' : status === 'held' || (status === 'queued' && (approved || (due !== null && due > now) || (due === null && producer.due !== undefined)));
    if (!judge) continue;
    judged.push(row);
    const linked = await aboutRow(producer, row);
    const reason = dropReason(producer.dropWhen, linked?.row ?? null);
    if (reason !== null) {
      out.set(row, { skip: reason });
      continue;
    }
    if (producer.due !== undefined && !approved && !batched && linked !== null && cols.due !== undefined) {
      const next = await dueFor(producer.due, linked.row, linked.table.columns.get(producer.due.date), ctx.zone, ctx.read);
      const moved = next === null ? due !== null : due === null || Math.abs(next - due) >= 1_000;
      // About to go: a due now AHEAD, or one that can no longer be worked out, holds it back.
      if (mode === 'send' ? moved && (next === null || next > now) : moved) out.set(row, { due: next });
    }
  }

  // Overtaken: per group and row it is about, the latest-ranked message that
  // has come due takes the place of every earlier one not yet sent.
  const judgedByKey = new Map(judged.map((row) => [String(row[key]), row] as const));
  const verdictOf = (candidate: Row): Verdict | undefined => {
    const own = judgedByKey.get(String(candidate[key]));
    return own === undefined ? undefined : out.get(own);
  };
  const dueOf = (candidate: Row): unknown => {
    const verdict = verdictOf(candidate);
    if (verdict?.due !== undefined) return verdict.due === null ? null : new Date(verdict.due);
    return cols.due === undefined ? null : candidate[cols.due];
  };
  const groups = new Set((definition.producers ?? []).flatMap((producer) => (producer.supersede === undefined ? [] : [producer.supersede])));
  for (const group of groups) {
    const ranks = groupRanks(definition, group);
    const members = judged.filter((row) => ranks.has(String(row[cols.kind])) && out.get(row)?.skip === undefined);
    if (members.length === 0) continue;
    // Every message of the group for these rows, the sent ones too.
    const links = [...new Set((definition.producers ?? []).filter((producer) => producer.supersede === group).map((producer) => producer.link))];
    const siblings: Row[] = [];
    for (const link of links) {
      const ids = [...new Set(members.map((row) => row[link]).filter((id) => id !== null && id !== undefined))];
      if (ids.length === 0) continue;
      siblings.push(
        ...((await db
          .selectFrom(outbox.id as never)
          .selectAll()
          .where(cols.kind as never, 'in', [...ranks.keys()] as never)
          .where(link as never, 'in', ids as never)
          .execute()) as Row[]),
      );
    }
    for (const row of members) {
      const producer = producerOf(definition, row[cols.kind]);
      if (producer === undefined) continue;
      const rank = ranks.get(String(row[cols.kind])) ?? 0;
      const overtaken = siblings.some(
        (sibling) =>
          !sameValue(sibling[key], row[key]) &&
          sameValue(sibling[producer.link], row[producer.link]) &&
          (ranks.get(String(sibling[cols.kind])) ?? -1) > rank &&
          verdictOf(sibling)?.skip === undefined &&
          cameDue(sibling[cols.status], dueOf(sibling), now),
      );
      if (overtaken) out.set(row, { skip: 'overtaken' });
    }
  }
  return out;
}
