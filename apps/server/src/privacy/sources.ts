// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S DATA, FOUND BY THEIR ADDRESS: everything the install keeps
 * about one e-mail address, source by source.
 *
 *   - every people table an installed app declares (`people/declared.ts`,
 *     the owner's overrides included): the rows whose address column is the
 *     address;
 *   - each declared copy of a person on another table: a copy that holds an
 *     address, by the address; a copy that holds a name or a phone, by its
 *     link back to one of the person's rows;
 *   - the app's own outbox: mail to the address, or to one of their rows;
 *   - the consent log (by the address and by each of their rows) and the
 *     do-not-email list, through the consent door (never by reading their
 *     address columns: those hold keyed hashes);
 *   - what Adminium keeps itself (`meta-sources.ts`).
 *
 * It reads as the privacy action, not as a role: no table limit, no row
 * limit, no masked column stands between the request and the person's rows
 * (a role's limits would hide the very links that tie rows to a person).
 * A private table is not read: its rows are the people's they belong to.
 * Secret columns (a password's hash, a key) are never read out.
 *
 * Only the sources this release has are searched: no form answers, chats,
 * uploaded files of strangers or page visits exist yet.
 *
 * The address is compared as `normaliseAddress` spells it, trimmed and in
 * lower case on both sides; nothing else is folded.
 */
import { KEPT_BY_LAW_REASONS, type KeptByLawReason, type Outbox } from '@adminium/manifest';
import { appOutboxesRepo, appTablesRepo, manifestsRepo, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import { looksLikeAddress, type ConsentEvent, type ConsentService } from '../consent/index.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { ValidationFailedError } from '../errors.js';
import { rowKeyOf } from '../payments/payables.js';
import { peopleTablesOf } from '../people/tables-of.js';
import type { DeclaredPeopleTable } from '../people/declared.js';
import { normaliseAddress } from '../public-api/claim-code.js';
import { findInMeta, ROWS_MAX, type FoundRow } from './meta-sources.js';
import type { FoundSource } from './types.js';
import { plainRow, plainValue } from './values.js';

export { SOURCE_KINDS, type FoundSource, type SourceGroup, type SourceKind } from './types.js';

/** Rows of a kept-by-law table that point at one of the person's rows (an invoice to them): "What stays" lists them. */
export interface LawLinkedRows {
  connectionId: string;
  table: string;
  app: string;
  label: string;
  reason: KeptByLawReason;
  count: number;
}

export interface PersonFound {
  /** As `normaliseAddress` spells it. */
  address: string;
  /** Their name (and company) as the first people row found gives it; null when no row holds it. */
  person: { name: string | null; company: string | null } | null;
  sources: FoundSource[];
  /** Kept-by-law rows that point at them. */
  lawLinked: LawLinkedRows[];
}

export interface PrivacyFindDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  consent: ConsentService;
}

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('finding a person never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('finding a person never reads a credential');
  },
};

/** The states in which an app still holds a table. */
const HELD = new Set(['created', 'adopted', 'shared']);
/** Apps whose tables are still there. */
const PRESENT = new Set(['installed', 'disabled']);

/** The address a search is for, as kept; refused when it is no address. */
export function searchAddress(raw: string): string {
  if (!looksLikeAddress(raw)) throw new ValidationFailedError('That is not an e-mail address.', { field: 'address' });
  return normaliseAddress(raw);
}

/** A table of the view, or null when it is gone (or private: the view has none). */
function tableOf(view: SnapshotView, name: string): ResolvedTable | null {
  try {
    return view.table(name);
  } catch {
    return null;
  }
}

/** A row as the download writes it: every column but the secret ones. */
function exported(table: ResolvedTable, row: Row, only?: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    const column = table.columns.get(name);
    if (column?.secret === true) continue;
    if (only !== undefined && !only.has(name) && !table.primaryKey.includes(name)) continue;
    out[name] = plainValue(value);
  }
  return out;
}

/** `lower(trim(column)) = address`: the address as stored, in either case, spaces around it or not. */
const addressIs = (column: string, address: string) => sql<boolean>`lower(trim(${sql.ref(column)})) = ${address}`;

async function rowsWhere(db: Kysely<SourceDatabase>, table: ResolvedTable, conditions: ReturnType<typeof sql<boolean>>[]): Promise<Row[]> {
  if (conditions.length === 0) return [];
  return (await db
    .selectFrom(table.id as never)
    .selectAll()
    .where(sql<boolean>`(${sql.join(conditions, sql` or `)})`)
    .limit(ROWS_MAX)
    .execute()) as Row[];
}

/** Each installed app on a database: its key, the manifest it stored, and its records of its tables. */
interface AppOnDatabase {
  appKey: string;
  document: { requiredSchema?: { tables?: unknown } } | null;
}

/** The kept-by-law reason of each table of the database (by snapshot id), from the apps' `keep` words. */
async function keptTablesOf(meta: MetaDb, connectionId: string, apps: readonly AppOnDatabase[], view: SnapshotView): Promise<Map<string, { reason: KeptByLawReason; app: string }>> {
  const out = new Map<string, { reason: KeptByLawReason; app: string }>();
  const records = await appTablesRepo(meta).forConnection(connectionId);
  for (const app of apps) {
    const tables = Array.isArray(app.document?.requiredSchema?.tables) ? (app.document.requiredSchema.tables as unknown[]) : [];
    for (const one of tables) {
      const table = one as { ref?: unknown; keep?: { law?: unknown } } | null;
      const law = table?.keep?.law;
      if (typeof table?.ref !== 'string' || typeof law !== 'string' || !(KEPT_BY_LAW_REASONS as readonly string[]).includes(law)) continue;
      const record = records.find((candidate) => candidate.appKey === app.appKey && candidate.ref === table.ref && HELD.has(candidate.state));
      const resolved = record === undefined ? null : tableOf(view, record.schemaName === null ? record.tableName : `${record.schemaName}.${record.tableName}`) ?? tableOf(view, record?.tableName ?? '');
      if (resolved !== null) out.set(resolved.id, { reason: law as KeptByLawReason, app: app.appKey });
    }
  }
  return out;
}

/** Their name and company, from a people row: the company read through its link, by the companies table's own name column. */
async function personOf(db: Kysely<SourceDatabase>, view: SnapshotView, declared: readonly DeclaredPeopleTable[], entry: DeclaredPeopleTable, table: ResolvedTable, row: Row): Promise<{ name: string | null; company: string | null }> {
  const raw = entry.name === null ? null : row[entry.name];
  const name = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  let company: string | null = null;
  if (entry.company !== null && row[entry.company] !== null && row[entry.company] !== undefined) {
    const relation = view.model.relations.find((one) => one.through === null && one.from.tableId === table.id && one.from.columns.length === 1 && one.from.columns[0] === entry.company);
    const target = relation === undefined ? null : tableOf(view, relation.to.tableId);
    const companies = target === null ? undefined : declared.find((one) => one.table === target.id && one.name !== null);
    if (relation !== undefined && target !== null && companies !== undefined && relation.to.columns.length === 1) {
      const found = (await db
        .selectFrom(target.id as never)
        .select(sql.ref(companies.name!).as('name') as never)
        .where(sql<boolean>`${sql.ref(relation.to.columns[0]!)} = ${row[entry.company] as never}`)
        .limit(1)
        .execute()) as { name?: unknown }[];
      const value = found[0]?.name;
      company = typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    }
  }
  return { name, company };
}

function appSource(kind: 'people' | 'copy' | 'outbox', id: string, connectionId: string, table: ResolvedTable, app: string, ref: string, keptByLaw: KeptByLawReason | null): FoundSource {
  return { id, kind, group: kind === 'outbox' ? 'held' : 'gave', connectionId, table: table.id, app, ref, label: table.table.label ?? table.name, keptByLaw, count: 0, keys: [], rows: [] };
}

/** A consent event as the download writes it: no staff id and no hash (what the person reads is who and when). */
function consentRow(event: ConsentEvent): Record<string, unknown> {
  return plainRow({
    id: event.id,
    purpose: event.purpose,
    state: event.state,
    source: event.source,
    detail: event.detail,
    how: event.how,
    note: event.note,
    recordedBy: event.staffLabel,
    wording: event.wording,
    wordingVersion: event.wordingVersion,
    ip: event.ip,
    browser: event.userAgent,
    at: new Date(event.at),
    confirmedAt: event.confirmedAt === null ? null : new Date(event.confirmedAt),
    table: event.person?.table ?? null,
    row: event.person?.key ?? null,
  });
}

/** Everything the install keeps about one address (see the header). `rawAddress` is refused when it is no address. */
export async function findPerson(deps: PrivacyFindDeps, rawAddress: string): Promise<PersonFound> {
  const { meta, consent } = deps;
  const address = searchAddress(rawAddress);
  const sources: FoundSource[] = [];
  const lawLinked: LawLinkedRows[] = [];
  const appRows: FoundRow[] = [];
  const peopleRows: { connectionId: string; table: string; key: string }[] = [];
  let person: PersonFound['person'] = null;

  const installed = (await manifestsRepo(meta, NO_SECRETS).list('app')).filter((entry) => entry.row.connectionId !== null && PRESENT.has(entry.row.status));
  const outboxes = await appOutboxesRepo(meta).list();
  const connections = [...new Set(installed.map((entry) => entry.row.connectionId as string))].sort();

  for (const connectionId of connections) {
    let view: SnapshotView;
    try {
      view = await loadSnapshotView(meta, connectionId, { forOthers: true });
    } catch {
      continue;
    }
    const apps: AppOnDatabase[] = installed.filter((entry) => entry.row.connectionId === connectionId).map((entry) => ({ appKey: entry.row.manifestKey, document: entry.document as AppOnDatabase['document'] }));
    const declared = await peopleTablesOf(meta).all(connectionId, view.model);
    const ownOutboxes = outboxes.filter((one) => one.connectionId === connectionId && apps.some((app) => app.appKey === one.appKey));
    if (declared.length === 0 && ownOutboxes.length === 0) continue;
    const { db } = await deps.manager.data(connectionId);
    const kept = await keptTablesOf(meta, connectionId, apps, view);
    /** The key values of the person's rows, per people table: what a copy's link and an outbox's recipient point at. */
    const keysOf = new Map<string, unknown[]>();
    const note = (table: ResolvedTable, rows: readonly Row[]) => {
      for (const row of rows) appRows.push({ connectionId, table: table.id, tableName: table.name, key: rowKeyOf(table, row) });
    };

    // ── the people tables ───────────────────────────────────────────────────
    for (const entry of declared) {
      const table = tableOf(view, entry.table);
      if (table === null || entry.email === null) continue;
      const rows = await rowsWhere(db, table, [addressIs(entry.email, address)]);
      if (rows.length === 0) continue;
      const found = appSource('people', `people-${entry.appKey}-${entry.ref}`, connectionId, table, entry.appKey, entry.ref, kept.get(table.id)?.reason ?? null);
      for (const row of rows) {
        found.count += 1;
        found.keys.push(rowKeyOf(table, row));
        found.rows.push(exported(table, row));
        peopleRows.push({ connectionId, table: table.id, key: rowKeyOf(table, row) });
      }
      note(table, rows);
      if (table.primaryKey.length === 1) keysOf.set(table.id, [...(keysOf.get(table.id) ?? []), ...rows.map((row) => row[table.primaryKey[0]!])]);
      if (person === null && entry.kind === 'people') person = await personOf(db, view, declared, entry, table, rows[0]!);
      sources.push(found);
    }

    // ── their copies on other tables ────────────────────────────────────────
    for (const entry of declared) {
      const owner = tableOf(view, entry.table);
      const pks = owner === null ? [] : (keysOf.get(owner.id) ?? []);
      const byTable = new Map<string, typeof entry.copies>();
      for (const copy of entry.copies) byTable.set(copy.table, [...(byTable.get(copy.table) ?? []), copy]);
      for (const [copyTableId, copies] of byTable) {
        const table = tableOf(view, copyTableId);
        if (table === null) continue;
        const conditions = copies.flatMap((copy) => [
          ...(copy.holds === 'email' ? [addressIs(copy.column, address)] : []),
          ...(copy.via !== null && pks.length > 0 ? [sql<boolean>`${sql.ref(copy.via)} in (${sql.join(pks.map((pk) => sql`${pk as never}`))})`] : []),
        ]);
        const rows = await rowsWhere(db, table, conditions);
        if (rows.length === 0) continue;
        // Only what holds the person: the copies and their links (the rest of a quote is the business's).
        const only = new Set(copies.flatMap((copy) => [copy.column, ...(copy.via === null ? [] : [copy.via])]));
        const found = appSource('copy', `copy-${entry.appKey}-${entry.ref}-${copies[0]!.ref}`, connectionId, table, entry.appKey, copies[0]!.ref, kept.get(table.id)?.reason ?? null);
        for (const row of rows) {
          // A row matched by a link alone, whose copies hold nobody (blank), is still the person's.
          found.count += 1;
          found.keys.push(rowKeyOf(table, row));
          found.rows.push(exported(table, row, only));
        }
        note(table, rows);
        sources.push(found);
      }
    }

    // ── the apps' own outboxes ──────────────────────────────────────────────
    for (const one of ownOutboxes) {
      let definition: Outbox;
      try {
        definition = JSON.parse(one.definition) as Outbox;
      } catch {
        continue;
      }
      const table = tableOf(view, definition.table);
      if (table === null) continue;
      const recipients = tableOf(view, definition.recipient.table);
      const pks = recipients === null ? [] : (keysOf.get(recipients.id) ?? []);
      const conditions = [
        addressIs(definition.columns.to, address),
        ...(pks.length > 0 ? [sql<boolean>`${sql.ref(definition.recipient.via)} in (${sql.join(pks.map((pk) => sql`${pk as never}`))})`] : []),
      ];
      const rows = await rowsWhere(db, table, conditions);
      if (rows.length === 0) continue;
      const found = appSource('outbox', `outbox-${one.appKey}`, connectionId, table, one.appKey, 'outbox', null);
      for (const row of rows) {
        found.count += 1;
        found.keys.push(rowKeyOf(table, row));
        found.rows.push(exported(table, row));
      }
      note(table, rows);
      sources.push(found);
    }

    // ── kept-by-law rows that point at them ─────────────────────────────────
    for (const [tableId, law] of kept) {
      const table = tableOf(view, tableId);
      if (table === null) continue;
      const links = view.model.relations.filter((relation) => relation.through === null && relation.from.tableId === tableId && relation.from.columns.length === 1 && (keysOf.get(relation.to.tableId)?.length ?? 0) > 0);
      if (links.length === 0) continue;
      const rows = await rowsWhere(
        db,
        table,
        links.map((relation) => sql<boolean>`${sql.ref(relation.from.columns[0]!)} in (${sql.join(keysOf.get(relation.to.tableId)!.map((pk) => sql`${pk as never}`))})`),
      );
      if (rows.length === 0) continue;
      lawLinked.push({ connectionId, table: table.id, app: law.app, label: table.table.label ?? table.name, reason: law.reason, count: rows.length });
      // Their invoice's rendered document and its payment are theirs too.
      note(table, rows);
    }
  }

  // ── consent and the do-not-email list, through the consent door ─────────
  const events = new Map<string, ConsentEvent>();
  for (const one of await consent.history({ address }, { limit: 500 })) events.set(one.id, one);
  for (const row of peopleRows) {
    for (const one of await consent.history({ person: row }, { limit: 500 })) events.set(one.id, one);
  }
  if (events.size > 0) {
    const ordered = [...events.values()].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
    sources.push({ id: 'consent', kind: 'consent', group: 'agreed', connectionId: null, table: null, app: null, ref: null, label: null, keptByLaw: null, count: ordered.length, keys: ordered.map((one) => one.id), rows: ordered.map(consentRow) });
  }
  const stopped = await consent.stop.entryFor(address);
  if (stopped !== null) {
    sources.push({
      id: 'stop-list',
      kind: 'stop-list',
      group: 'agreed',
      connectionId: null,
      table: null,
      app: null,
      ref: null,
      label: null,
      keptByLaw: null,
      count: 1,
      keys: [stopped.id],
      rows: [plainRow({ address: stopped.address, reason: stopped.reason, origin: stopped.origin, addedAt: new Date(stopped.addedAt), addedBy: stopped.addedBy?.label ?? null })],
    });
  }

  // ── what Adminium keeps itself ────────────────────────────────────────────
  sources.push(...(await findInMeta(meta, address, appRows)));

  return { address, person, sources, lawLinked };
}
