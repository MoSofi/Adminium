// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RUN'S RECORD, AS ONE PERSON MAY OPEN IT.
 *
 * Two steps hand a person the record a run is about: a notice to the lead of
 * the person on the row (only a lead who can open the record is told), and a
 * rule's e-mail to a person, whose `{{recordUrl}}` is the record's address.
 * Both ask the same question: do this person's roles read the record's table,
 * and is this row among the rows they reach? Asked as that person, never as
 * the rule, which reads the connection whole. And what such a step says of
 * the record is what that person reads of it (`tokensAs`): a column their
 * role is not shown is empty in their notice and their mail.
 *
 * The address is the one a notice's e-mail carries: the app's own screen for
 * the record when the person's roles open the app's staff side, else the
 * dashboard's record page; on the operator's mapped host or the server's
 * public address. Somebody who cannot open the record gets no address at all.
 */
import { pagesRepo, settingsRepo } from '@adminium/meta';

import { placeLink, recordPlaceForUser } from '../apps/record-address.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { labelColumnFor } from '../crud/labels.js';
import { UNMASK_PERMISSION, type Row } from '../crud/mask.js';
import { readTableOf, readViewOf } from '../crud/read-view.js';
import { pkLabel } from '../crud/records.js';
import { fetchVisible, type RowLimitContext } from '../crud/row-limit.js';
import { rowLimitContextOf } from '../crud/row-limit-context.js';
import { permissionSetAllows, resolvePermissionSet, type PermissionSet } from '../rbac/resolver.js';
import { rowReachesOf } from '../rbac/row-limits.js';
import type { ActionContext } from './actions/types.js';
import { tokensFor, type TokenMap } from './templating.js';

/** Somebody who opens the run's record: their roles, and the connection as they read it. */
export interface RecordReader {
  userId: string;
  set: PermissionSet;
  /** The connection as they read it (`readViewOf`): a column their role is not shown is hidden. */
  view: SnapshotView;
  /** Their reach of rows, by table: null when nothing limits them. */
  reach: RowLimitContext | null;
}

/**
 * Whether somebody's roles open the run's record — they read its table, and
 * it is among the rows they reach — and if so, how they read it.
 */
export async function readerOfRecord(ctx: Pick<ActionContext, 'meta' | 'source' | 'now'>, userId: string): Promise<RecordReader | null> {
  const source = ctx.source;
  if (source === null) return null;
  // A private table's rows are read by their own people on the screen, and no rule tells anybody of one (its rules start nothing).
  if (source.table.table.private === true) return null;
  const set = await resolvePermissionSet(ctx.meta, { kind: 'user', id: userId, label: userId });
  if (!permissionSetAllows(set, `table:${source.connectionId}:${source.table.id}:read`)) return null;
  const reach = await rowLimitContextOf(ctx.meta, set, source.connectionId, source.view.model, new Date(ctx.now));
  if (reach !== null) {
    // A removed row cannot be read again, so somebody whose read of its table is limited cannot be shown to reach it: they are not told of it.
    if (source.removed === true) {
      if (rowReachesOf(set, source.connectionId, source.table.id, 'read') !== null) return null;
    } else if ((await fetchVisible(reach, source.db, source.table, source.record.pk as Row, 'read')) === undefined) return null;
  }
  return { userId, set, view: readViewOf(source.view, set), reach };
}

/** Whether somebody's roles open the run's record: they read its table, and it is among the rows they reach. */
export async function opensRecord(ctx: Pick<ActionContext, 'meta' | 'source' | 'now'>, userId: string): Promise<boolean> {
  return (await readerOfRecord(ctx, userId)) !== null;
}

/**
 * The placeholders of a run about a record, as one reader of it reads them:
 * a column their role is not shown writes nothing (the record's, as it was,
 * the name of the person a staff column names); a row a link names, nothing
 * at all when they do not read its table or reach it; the record's label as
 * their screen names it. `mail`: a mail to them, which carries a personal
 * column of a table whose personal columns they are shown, and no other.
 * The rows the run's steps made are read as the rule reads them.
 */
export async function tokensAs(ctx: Pick<ActionContext, 'meta' | 'source' | 'now' | 'rule' | 'tokens'>, reader: RecordReader, mail = false): Promise<TokenMap> {
  const source = ctx.source;
  if (source === null) return ctx.tokens;
  const shown = (table: ResolvedTable): ResolvedTable => reader.view.linkTable(table.id) ?? table;
  const hidden = (table: ResolvedTable, name: string): boolean => {
    const column = shown(table).columns.get(name);
    return column === undefined || column.unreadable === true || column.secret;
  };
  const allows = (permission: string): boolean => permissionSetAllows(reader.set, permission);
  const related = new Map<string, { table: ResolvedTable; row: Row | null }>();
  for (const [link, far] of source.related ?? []) {
    let row = far.row;
    if (row !== null && (hidden(source.table, link) || !allows(`table:${source.connectionId}:${far.table.id}:read`) || far.table.table.private === true)) row = null;
    if (row !== null && reader.reach !== null) {
      const pk = Object.fromEntries(far.table.primaryKey.map((key) => [key, row![key]]));
      if ((await fetchVisible(reader.reach, source.db, far.table, pk, 'read')) === undefined) row = null;
    }
    related.set(link, { table: far.table, row });
  }
  const labelColumn = labelColumnFor(reader.view, readTableOf(reader.view, source.table));
  const labelled = labelColumn === null ? undefined : source.row[labelColumn];
  const recordLabel = !reader.view.readLimited ? source.record.label : labelled !== null && labelled !== undefined && String(labelled).trim() !== '' ? String(labelled) : pkLabel(source.table, source.record.pk as Row);
  const steps = Object.fromEntries(Object.entries(ctx.tokens).filter(([key]) => key.startsWith('steps.')));
  return {
    ...tokensFor({
      row: source.row,
      table: source.table,
      related,
      people: source.people,
      was: source.was,
      ruleName: ctx.rule.name,
      recordLabel,
      now: ctx.now,
      hidden,
      includeMasked: mail ? (table) => allows(UNMASK_PERMISSION) || allows(`table:${source.connectionId}:${table.id}:read_pii`) : false,
    }),
    ...steps,
  };
}

/** `config.source.table` of a page: which table it shows. */
function sourceTableOf(config: unknown): string | null {
  const source = (config as { source?: { table?: unknown } } | null)?.source;
  return typeof source?.table === 'string' && source.table.length > 0 ? source.table : null;
}

/** The record's id as its page takes it: the key, or the keys as JSON. */
export function recordIdOf(pk: Readonly<Record<string, unknown>>): string {
  const values = Object.values(pk);
  return values.length === 1 ? String(values[0]) : JSON.stringify(values);
}

/** The dashboard's page for the run's record (`/p/<slug>/r/<id>`), or null when no page shows its table. */
export async function recordPagePath(ctx: Pick<ActionContext, 'meta' | 'source'>): Promise<string | null> {
  const source = ctx.source;
  if (source === null) return null;
  const page = (await pagesRepo(ctx.meta).listForConnection(source.connectionId)).find((row) => row.isEnabled && sourceTableOf(row.config) === source.table.id);
  return page === undefined ? null : `/p/${page.slug}/r/${encodeURIComponent(recordIdOf(source.record.pk))}`;
}

/** The address an e-mail gives this person to the run's record; empty when they cannot open it or nothing shows it. */
export async function recordUrlFor(ctx: Pick<ActionContext, 'meta' | 'source' | 'now'>, user: { id: string; name: string }): Promise<string> {
  const source = ctx.source;
  if (source === null || !(await opensRecord(ctx, user.id))) return '';
  const stored = await settingsRepo(ctx.meta).get('system.publicOrigin').catch(() => null);
  const origin = typeof stored === 'string' && stored !== '' ? stored.replace(/\/+$/, '') : undefined;
  const place = await recordPlaceForUser(ctx.meta, user, { connectionId: source.connectionId, table: source.table.id, recordId: recordIdOf(source.record.pk) });
  if (place !== null) return placeLink(place, origin);
  const path = await recordPagePath(ctx);
  if (path === null) return '';
  return origin === undefined ? path : `${origin}${path}`;
}
