// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PEOPLE MENTIONED IN A TEXT.
 *
 * A text column marked for mentions holds, wherever its writer named a
 * colleague, `@[Dana Reyes](usr_…)`: the name as it read when it was written,
 * and the id of the person meant. Two things follow from a save.
 *
 * INSIDE THE WRITE, each person named is checked to be somebody who signs in
 * here. One who is not refuses the save by the column's name, before anything
 * is written — so the text stays in the box it was typed in.
 *
 * AFTER THE SAVE, each person newly named is told who mentioned them and on
 * which record; never what was written. Anybody who signs in may be named,
 * also one who cannot open the record: their notice then has no way in. A
 * column may say which record a mention in it is about (`about`: a comment's
 * deal), and that is the record the notice names and opens.
 */
import { pagesRepo, usersRepo, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { EffectiveTable } from '../connections/effective-schema.js';
import { ValidationFailedError } from '../errors.js';
import { notify, type NotificationPublisher } from '../notifications/notify.js';
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import { labelColumnFor } from './labels.js';
import type { Row } from './mask.js';
import { fetchByPk, pkLabel } from './records.js';
import { fetchVisible } from './row-limit.js';
import { rowLimitContextOf } from './row-limit-context.js';

export const MENTION_KIND = 'mention';
/** How many people one text may name: a save checks each of them. */
export const MENTIONS_MAX = 20;

const TOKEN = /@\[([^\]\n]{1,120})\]\((usr_[0-9A-Za-z]{6,40})\)/g;

/** The people a text names, each once, in the order they are first named. */
export function mentionedIn(text: unknown): string[] {
  if (typeof text !== 'string' || !text.includes('@[')) return [];
  const out: string[] = [];
  for (const match of text.matchAll(TOKEN)) if (!out.includes(match[2]!)) out.push(match[2]!);
  return out;
}

type Marked = { name: string; about: string | null };

/** The columns of a table in which people are mentioned. */
export function mentionColumns(table: Pick<EffectiveTable, 'columns'>): Marked[] {
  return table.columns.flatMap((column) => (column.mentions === undefined ? [] : [{ name: column.name, about: column.mentions === true ? null : column.mentions.about }]));
}

/**
 * Judge the people a write names in its text. `values` is what the writer
 * sent; a column not sent names nobody new.
 */
export async function assertMentions(meta: MetaDb, table: Pick<EffectiveTable, 'columns'> | undefined, values: Row): Promise<void> {
  if (table === undefined) return;
  const users = usersRepo(meta);
  for (const column of mentionColumns(table)) {
    if (!(column.name in values)) continue;
    const named = mentionedIn(values[column.name]);
    if (named.length > MENTIONS_MAX) throw new ValidationFailedError('Some values were refused.', { fields: { [column.name]: { code: 'too-many-mentions', max: MENTIONS_MAX } } });
    for (const id of named) {
      const user = await users.findById(id);
      // Somebody who signs in, or one of the sample's people; nobody removed or suspended.
      if (user === null || (user.status !== 'active' && user.status !== 'sample')) throw new ValidationFailedError('Some values were refused.', { fields: { [column.name]: { code: 'mention-unknown' } } });
    }
  }
}

export interface MentionDeps {
  meta: MetaDb;
  manager: ConnectionManager;
  hub?: NotificationPublisher | undefined;
}

export interface MentionWrite {
  connectionId: string;
  /** The connection as a rule reads it: every table, whole. */
  view: SnapshotView;
  table: ResolvedTable;
  before: Row | null;
  after: Row;
  writer: { id: string; name: string };
  /** The origin a notice's email writes its link with. */
  origin?: string | undefined;
  at?: number | undefined;
}

/** `config.source.table` of a page: which table it shows. */
function sourceTableOf(config: unknown): string | null {
  const source = (config as { source?: { table?: unknown } } | null)?.source;
  return typeof source?.table === 'string' && source.table.length > 0 ? source.table : null;
}

/** The record a mention in `column` is about: the row itself, or the row its `about` link names. */
function recordMeant(view: SnapshotView, table: ResolvedTable, row: Row, about: string | null): { table: ResolvedTable; pk: Row } | null {
  const own = { table, pk: Object.fromEntries(table.primaryKey.map((column) => [column, row[column]])) };
  if (about === null) return own;
  const relation = view.model.relations.find((candidate) => candidate.through === null && candidate.from.tableId === table.id && candidate.from.columns.length === 1 && candidate.from.columns[0] === about);
  const value = row[about];
  if (relation === undefined || value === null || value === undefined || value === '') return own;
  const far = view.linkTable(relation.to.tableId);
  if (far === null || relation.to.columns.length !== 1) return null;
  return { table: far, pk: { [relation.to.columns[0]!]: value } };
}

/**
 * Tell each person a save newly named. Called once the write has committed;
 * it reads and tells, and writes nothing to the business's tables. Returns
 * how many were told.
 */
export async function tellMentioned(deps: MentionDeps, write: MentionWrite): Promise<number> {
  const columns = mentionColumns(write.table.table);
  if (columns.length === 0) return 0;
  const { meta } = deps;
  const at = write.at ?? Date.now();
  let told = 0;
  const done = new Set<string>();
  for (const column of columns) {
    const was = new Set(write.before === null ? [] : mentionedIn(write.before[column.name]));
    const fresh = mentionedIn(write.after[column.name]).filter((id) => !was.has(id) && id !== write.writer.id && !done.has(id));
    if (fresh.length === 0) continue;
    const meant = recordMeant(write.view, write.table, write.after, column.about);
    if (meant === null) continue;
    const { db } = await deps.manager.data(write.connectionId);
    const source = db as Kysely<SourceDatabase>;
    // The record's name as its table shows it, never a masked column; its key when it has none.
    const labelColumn = labelColumnFor(write.view, meant.table);
    const row = meant.table === write.table && column.about === null ? write.after : await fetchByPk(source, meant.table, meant.pk);
    if (row === undefined) continue;
    const label = labelColumn !== null && row[labelColumn] !== null && row[labelColumn] !== undefined && String(row[labelColumn]).trim() !== '' ? String(row[labelColumn]) : pkLabel(meant.table, meant.pk);
    const where = `${meant.table.table.label ?? meant.table.table.name}: ${label}`;
    const page = (await pagesRepo(meta).listForConnection(write.connectionId)).find((candidate) => candidate.isEnabled && sourceTableOf(candidate.config) === meant.table.id);
    const keys = Object.values(meant.pk);
    const recordId = keys.length === 1 ? String(keys[0]) : JSON.stringify(keys);

    for (const id of fresh) {
      done.add(id);
      const user = await usersRepo(meta).findById(id);
      if (user === null || user.status !== 'active') continue;
      // A way in only for somebody who can open the record: their roles read the table, and this row is one they reach.
      const set = await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.name });
      let opens = permissionSetAllows(set, `table:${write.connectionId}:${meant.table.id}:read`);
      if (opens) {
        const reach = await rowLimitContextOf(meta, set, write.connectionId, write.view.model, new Date(at));
        if (reach !== null) opens = (await fetchVisible(reach, source, meant.table, meant.pk, 'read')) !== undefined;
      }
      await notify(
        meta,
        {
          userId: user.id,
          kind: MENTION_KIND,
          actorLabel: write.writer.name,
          title: `${write.writer.name} mentioned you`,
          body: where,
          ...(opens ? { entity: { connectionId: write.connectionId, table: meant.table.id, pk: meant.pk } } : {}),
          actionUrl: opens && page !== undefined ? `/p/${page.slug}/r/${encodeURIComponent(recordId)}` : null,
        },
        { ...(deps.hub === undefined ? {} : { hub: deps.hub }), at, ...(write.origin === undefined ? {} : { origin: write.origin }) },
      );
      told += 1;
    }
  }
  return told;
}
