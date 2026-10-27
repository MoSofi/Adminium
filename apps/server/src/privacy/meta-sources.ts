// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE ADMINIUM ITSELF KEEPS A PERSON: the meta store's own copies, found by
 * the person's address and by the rows of theirs the app tables gave.
 *
 *   - campaign mail: the send ledger keeps a copy of the address and the name
 *     of every recipient of a campaign; a row of an app table is found by it
 *     too, whatever address it was sent to;
 *   - a campaign's failure list (`{to, error}`);
 *   - rendered documents (a quote, an invoice): of one of their rows, or with
 *     their address in what was rendered;
 *   - designer invoices whose body holds their address;
 *   - payments of one of their rows, or of one of their documents; and the
 *     payment services' own messages holding their address;
 *   - the rules' run history: a run started by one of their rows, or whose
 *     trigger holds their address;
 *   - notifications to staff about one of their rows, or naming their address;
 *   - files attached to one of their rows.
 *
 * Addresses are compared as `normaliseAddress` spells them (trimmed, lower
 * case), never as the stop list folds them (`+tag`, Gmail's dots): that
 * would hand one person's data to another. A JSON store is narrowed in SQL
 * by a plain text match and then checked string by string here
 * (`holdsAddress`), so `xmarta@…` never stands for `marta@…`.
 *
 * Every store is read a batch at a time, in id order.
 */
import { sql, type RawBuilder } from 'kysely';
import { readJson, type MetaDb } from '@adminium/meta';

import type { FoundSource } from './types.js';
import { holdsAddress, isAddress, jsonHoldsAddress, plainRow, plainValue } from './values.js';

/** A row of an app table found to be the person's (their row, a copy of them, their outbox mail). */
export interface FoundRow {
  connectionId: string;
  /** The table's snapshot id, and its bare name (stores keep either). */
  table: string;
  tableName: string;
  key: string;
}

/** How many rows of one store are read at a time. */
const BATCH = 500;
/** The most rows one source keeps for the download; the count goes on past it. */
export const ROWS_MAX = 2_000;

/** LIKE's wildcards escaped with `!`, named in the query's ESCAPE clause (the one spelling all three engines read alike). */
function likeOf(text: string): string {
  return `%${text.replace(/[!%_]/g, (ch) => `!${ch}`)}%`;
}

/** A JSON (or text) column as lower-case text, as each engine spells the cast. */
function lowerText(meta: MetaDb, column: string): RawBuilder<string> {
  const ref = sql.ref(column);
  if (meta.dialect === 'postgres') return sql<string>`lower(cast(${ref} as text))`;
  if (meta.dialect === 'mysql') return sql<string>`lower(cast(${ref} as char))`;
  return sql<string>`lower(${ref})`;
}

/** `column` holds any of `needles` as plain text. */
function holdsAny(meta: MetaDb, column: string, needles: readonly string[]): RawBuilder<boolean> {
  return sql<boolean>`(${sql.join(
    needles.map((needle) => sql`${lowerText(meta, column)} like ${likeOf(needle.toLowerCase())} escape '!'`),
    sql` or `,
  )})`;
}

/** The found rows as keys: `connection, table, row`, by the table's id and by its name. */
function rowIndex(rows: readonly FoundRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    out.add(`${row.connectionId}\u0000${row.table}\u0000${row.key}`);
    out.add(`${row.connectionId}\u0000${row.tableName}\u0000${row.key}`);
  }
  return out;
}

const isOneOf = (index: Set<string>, connectionId: unknown, table: unknown, key: unknown): boolean =>
  typeof connectionId === 'string' && typeof table === 'string' && key !== null && key !== undefined && index.has(`${connectionId}\u0000${table}\u0000${String(key)}`);

/** A record reference (`{connectionId, table, pk}`) as its row key: the value of a one-column key, else the JSON tuple. */
function refKey(pk: unknown): string | null {
  if (pk === null || typeof pk !== 'object') return null;
  const values = Object.values(pk as Record<string, unknown>);
  if (values.length === 0) return null;
  return values.length === 1 ? String(values[0]) : JSON.stringify(values);
}

function source(kind: FoundSource['kind'], group: FoundSource['group']): FoundSource {
  return { id: kind, kind, group, connectionId: null, table: null, app: null, ref: null, label: null, keptByLaw: null, count: 0, keys: [], rows: [] };
}

function add(found: FoundSource, key: string, row: Record<string, unknown>): void {
  found.count += 1;
  if (found.keys.length < ROWS_MAX) {
    found.keys.push(key);
    found.rows.push(row);
  }
}

/** Every row of `table` matching `where`, a batch at a time in id order. */
async function* batches<T extends { id: string }>(read: (after: string | null) => Promise<T[]>): AsyncGenerator<T[]> {
  let after: string | null = null;
  for (;;) {
    const rows = await read(after);
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < BATCH) return;
    after = rows.at(-1)!.id;
  }
}

/** The meta store's sources for one person (see the header). Only sources with something in them are answered. */
export async function findInMeta(meta: MetaDb, address: string, rows: readonly FoundRow[]): Promise<FoundSource[]> {
  const { db } = meta;
  const index = rowIndex(rows);
  const tables = [...new Set(rows.flatMap((row) => [row.table, row.tableName]))];
  const out: FoundSource[] = [];

  // ── campaign mail: the send ledger ────────────────────────────────────────
  const sends = source('campaign-mail', 'held');
  const people = rows;
  for await (const batch of batches((after) => {
    let query = db
      .selectFrom('adminium_email_sends')
      .select(['id', 'runId', 'address', 'name', 'language', 'connectionId', 'personTable', 'personKey', 'state', 'reason', 'sentAt', 'clicks', 'createdAt'])
      .where((eb) =>
        eb.or([
          eb(sql<string>`lower(trim(${sql.ref('address')}))`, '=', address),
          ...(people.length === 0
            ? []
            : [eb.and([eb('connectionId', 'in', [...new Set(people.map((row) => row.connectionId))]), eb('personTable', 'in', tables), eb('personKey', 'in', [...new Set(people.map((row) => row.key))])])]),
        ]),
      );
    if (after !== null) query = query.where('id', '>', after);
    return query.orderBy('id', 'asc').limit(BATCH).execute();
  })) {
    for (const row of batch) {
      if (!isAddress(row.address, address) && !isOneOf(index, row.connectionId, row.personTable, row.personKey)) continue;
      add(sends, row.id, plainRow({ ...row, connectionId: undefined, personTable: undefined, personKey: undefined }));
    }
  }
  out.push(sends);

  // ── a campaign's failure list ─────────────────────────────────────────────
  const failures = source('campaign-failures', 'held');
  for await (const batch of batches((after) => {
    let query = db.selectFrom('adminium_email_runs').select(['id', 'failures', 'startedAt']).where(holdsAny(meta, 'failures', [address]));
    if (after !== null) query = query.where('id', '>', after);
    return query.orderBy('id', 'asc').limit(BATCH).execute();
  })) {
    for (const run of batch) {
      const list = readJson<unknown>(run.failures);
      if (!Array.isArray(list)) continue;
      list.forEach((item, at) => {
        const to = (item as { to?: unknown } | null)?.to;
        if (isAddress(to, address)) add(failures, `${run.id}#${String(at)}`, { runId: run.id, startedAt: plainValue(run.startedAt), to, error: (item as { error?: unknown }).error ?? null });
      });
    }
  }
  out.push(failures);

  // ── rendered documents ────────────────────────────────────────────────────
  const documents = source('documents', 'held');
  const documentIds: string[] = [];
  for await (const batch of batches((after) => {
    let query = db
      .selectFrom('adminium_documents')
      .select(['id', 'addOnKey', 'kind', 'connectionId', 'entityTable', 'entityId', 'subject', 'number', 'status', 'delivery', 'locale', 'format', 'renderedAt', 'sentAt', 'voidedAt', 'createdAt'])
      .where((eb) => eb.or([holdsAny(meta, 'subject', [address]), ...(tables.length === 0 ? [] : [eb('entityTable', 'in', tables)])]));
    if (after !== null) query = query.where('id', '>', after);
    return query.orderBy('id', 'asc').limit(BATCH).execute();
  })) {
    for (const row of batch) {
      const subject = readJson<unknown>(row.subject);
      if (!isOneOf(index, row.connectionId, row.entityTable, row.entityId) && !jsonHoldsAddress(subject, address)) continue;
      documentIds.push(row.id);
      const { subject: _subject, ...kept } = row;
      add(documents, row.id, plainRow({ ...kept, fields: (subject as { fields?: unknown } | null)?.fields ?? null }));
    }
  }
  out.push(documents);

  // ── designer invoices ─────────────────────────────────────────────────────
  const invoices = source('invoices', 'held');
  for await (const batch of batches((after) => {
    let query = db.selectFrom('adminium_invoice_documents').select(['id', 'kind', 'name', 'number', 'status', 'body', 'createdAt', 'updatedAt']).where('kind', '=', 'invoice').where(holdsAny(meta, 'body', [address]));
    if (after !== null) query = query.where('id', '>', after);
    return query.orderBy('id', 'asc').limit(BATCH).execute();
  })) {
    for (const row of batch) {
      const body = readJson<unknown>(row.body);
      if (!jsonHoldsAddress(body, address)) continue;
      add(invoices, row.id, plainRow({ ...row, body }));
    }
  }
  out.push(invoices);

  // ── payments, and the payment services' own messages ──────────────────────
  const payments = source('payments', 'held');
  if (tables.length > 0 || documentIds.length > 0) {
    for await (const batch of batches((after) => {
      let query = db
        .selectFrom('adminium_payments')
        .select(['id', 'payableKind', 'connectionId', 'tableName', 'rowKey', 'number', 'amount', 'currency', 'refundedAmount', 'method', 'provider', 'mode', 'paidOn', 'voided', 'createdAt'])
        .where((eb) =>
          eb.or([
            ...(tables.length === 0 ? [] : [eb('tableName', 'in', tables)]),
            ...(documentIds.length === 0 ? [] : [eb.and([eb('payableKind', '=', 'document'), eb('rowKey', 'in', documentIds)])]),
          ]),
        );
      if (after !== null) query = query.where('id', '>', after);
      return query.orderBy('id', 'asc').limit(BATCH).execute();
    })) {
      for (const row of batch) {
        const ofDocument = row.payableKind === 'document' && documentIds.includes(row.rowKey);
        if (!ofDocument && !isOneOf(index, row.connectionId, row.tableName, row.rowKey)) continue;
        add(payments, row.id, plainRow({ ...row, voided: row.voided === true || row.voided === 1 }));
      }
    }
  }
  out.push(payments);

  const events = source('payment-events', 'held');
  for await (const batch of batches((after) => {
    let query = db.selectFrom('adminium_payment_events').select(['id', 'provider', 'mode', 'type', 'kind', 'body', 'receivedAt']).where(holdsAny(meta, 'body', [address]));
    if (after !== null) query = query.where('id', '>', after);
    return query.orderBy('id', 'asc').limit(BATCH).execute();
  })) {
    for (const row of batch) {
      const body = readJson<unknown>(row.body);
      if (!jsonHoldsAddress(body, address)) continue;
      add(events, row.id, plainRow({ ...row, body }));
    }
  }
  out.push(events);

  // ── the rules' run history ────────────────────────────────────────────────
  const runs = source('automation-runs', 'held');
  const tableNeedles = tables.map((table) => `"${table}"`);
  for await (const batch of batches((after) => {
    let query = db.selectFrom('adminium_automation_runs').select(['id', 'automationId', 'status', 'triggerEvent', 'startedAt', 'finishedAt']).where(holdsAny(meta, 'triggerEvent', [address, ...tableNeedles]));
    if (after !== null) query = query.where('id', '>', after);
    return query.orderBy('id', 'asc').limit(BATCH).execute();
  })) {
    for (const row of batch) {
      const event = readJson<{ record?: { connectionId?: unknown; table?: unknown; pk?: unknown } | null; snapshot?: unknown; event?: unknown; occurredAt?: unknown } | null>(row.triggerEvent);
      const record = event?.record ?? null;
      const theirs = record !== null && isOneOf(index, record.connectionId, record.table, refKey(record.pk));
      if (!theirs && !jsonHoldsAddress(event?.snapshot ?? null, address) && !jsonHoldsAddress(event, address)) continue;
      add(runs, row.id, plainRow({ id: row.id, automationId: row.automationId, status: row.status, event: event?.event ?? null, startedAt: row.startedAt, finishedAt: row.finishedAt, snapshot: event?.snapshot ?? null }));
    }
  }
  out.push(runs);

  // ── notifications to staff ────────────────────────────────────────────────
  const notifications = source('notifications', 'held');
  for await (const batch of batches((after) => {
    let query = db
      .selectFrom('adminium_notifications')
      .select(['id', 'kind', 'title', 'body', 'entity', 'createdAt', 'readAt'])
      .where((eb) => eb.or([holdsAny(meta, 'title', [address]), holdsAny(meta, 'body', [address]), ...(tableNeedles.length === 0 ? [] : [holdsAny(meta, 'entity', tableNeedles)])]));
    if (after !== null) query = query.where('id', '>', after);
    return query.orderBy('id', 'asc').limit(BATCH).execute();
  })) {
    for (const row of batch) {
      const entity = readJson<{ connectionId?: unknown; table?: unknown; pk?: unknown } | null>(row.entity);
      const theirs = entity !== null && typeof entity === 'object' && isOneOf(index, entity.connectionId, entity.table, refKey(entity.pk));
      if (!theirs && !holdsAddress(row.title, address) && !holdsAddress(row.body ?? '', address)) continue;
      add(notifications, row.id, plainRow({ id: row.id, kind: row.kind, title: row.title, body: row.body, createdAt: row.createdAt, readAt: row.readAt }));
    }
  }
  out.push(notifications);

  // ── files attached to their rows ──────────────────────────────────────────
  const files = source('files', 'gave');
  if (tables.length > 0) {
    for await (const batch of batches((after) => {
      let query = db
        .selectFrom('adminium_files')
        .select(['id', 'filename', 'mime', 'sizeBytes', 'kind', 'entityConnectionId', 'entityTable', 'entityId', 'createdAt', 'deletedAt'])
        .where('entityTable', 'in', tables)
        .where('entityId', 'in', [...new Set(rows.map((row) => row.key))]);
      if (after !== null) query = query.where('id', '>', after);
      return query.orderBy('id', 'asc').limit(BATCH).execute();
    })) {
      for (const row of batch) {
        if (!isOneOf(index, row.entityConnectionId, row.entityTable, row.entityId)) continue;
        add(files, row.id, plainRow({ id: row.id, filename: row.filename, mime: row.mime, sizeBytes: row.sizeBytes, kind: row.kind, table: row.entityTable, row: row.entityId, createdAt: row.createdAt, deletedAt: row.deletedAt }));
      }
    }
  }
  out.push(files);

  return out.filter((one) => one.count > 0);
}
