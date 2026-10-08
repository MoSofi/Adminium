// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE SETTINGS A RULE READS when it runs — a document's currency from the
 * connection, a tax rate from the app's settings row, an invoice prefix from
 * an add-on's settings — and the fill that uses them (`column.default` of
 * kind `from`).
 *
 * A settings row is read through the write's own handle (inside its
 * transaction, when there is one). The connection's currency and an add-on's
 * settings live in the meta store, so the write service is handed a reader
 * for them, as it is handed the meta store's counters (`write-stores.ts`). A
 * service built without one reads no currency (a `currency` scale then keeps
 * 2 places) and no add-on setting: the fill leaves the column empty rather
 * than inventing a value.
 */
import { sql, type Kysely } from 'kysely';

import type { RuleSetting } from '../connections/effective-schema.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { SoftLink, TableRules } from './column-rules.js';
import type { Row } from './mask.js';
import type { WriteAction } from './write-context.js';

/** What the write service reads from the meta store for a rule. */
export interface RuleSettingsReader {
  /** The connection's currency (ISO 4217), or null when it names none. */
  currency(connectionId: string): Promise<string | null>;
  /** One of an add-on's settings, or undefined. */
  addOnSetting(addOnKey: string, setting: string): Promise<unknown>;
}

type Db = Kysely<SourceDatabase>;

/** A setting's value now: the settings row's column, or the add-on's setting; undefined when there is none. */
export async function settingValue(db: Db, setting: RuleSetting, reader: RuleSettingsReader | undefined): Promise<unknown> {
  if ('addOn' in setting) return reader?.addOnSetting(setting.addOn, setting.setting);
  const row = (await db
    .selectFrom(setting.table)
    .select(sql<unknown>`${sql.ref(setting.column)}`.as('value'))
    .limit(1)
    .executeTakeFirst()) as { value?: unknown } | undefined;
  return row?.value ?? undefined;
}

/**
 * Whether a default for a link into an add-on's table names a row there now.
 * Nobody chose this value in this save, so it never refuses one: while the
 * add-on is not there for the table, and when the row the setting names has
 * gone, the link is left empty — as it would be with no setting at all.
 */
async function namesRow(db: Db, link: SoftLink, value: unknown): Promise<boolean> {
  if (link.tableId === null || link.key === null) return false;
  const found = await db
    .selectFrom(link.tableId as never)
    .select(sql<number>`1`.as('one'))
    .where(sql.ref(link.key), '=', value as never)
    .limit(1)
    .executeTakeFirst();
  return found !== undefined;
}

const empty = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

/**
 * A create's values with every LINK the settings fill, filled — before the
 * copies run, so what is copied through such a link is copied in the same
 * save (a new item with no unit chosen takes the settings' unit, and the
 * unit's code with it). Only a link no copy fills itself: where a copy and
 * the settings may both fill a column, the copy stands and the settings are
 * the fallback (`fillFromElsewhere`, after the copies). The same object when
 * nothing was filled.
 */
export async function fillLinksFromElsewhere(
  rules: TableRules | null,
  action: WriteAction,
  target: { db: Db; connectionId: string },
  values: Row,
  reader: RuleSettingsReader | undefined,
): Promise<Row> {
  if (action !== 'create' || (rules?.defaultsFrom?.length ?? 0) === 0 || (rules?.copies?.length ?? 0) === 0) return values;
  const copies = rules!.copies!;
  const links = rules!.defaultsFrom!.filter((rule) => copies.some((copy) => copy.via === rule.column) && !copies.some((copy) => copy.column === rule.column));
  return links.length === 0 ? values : fillFromElsewhere({ ...rules!, defaultsFrom: links }, action, target, values, reader);
}

/**
 * A create's values with every `default {from}` column that is still empty
 * filled — after a copy on the same column, so a client's own tax rate wins
 * and a client with none falls back to the settings' rate. The same object
 * when nothing was filled.
 */
export async function fillFromElsewhere(
  rules: TableRules | null,
  action: WriteAction,
  target: { db: Db; connectionId: string },
  values: Row,
  reader: RuleSettingsReader | undefined,
): Promise<Row> {
  if (action !== 'create' || (rules?.defaultsFrom?.length ?? 0) === 0) return values;
  let out: Row | null = null;
  for (const rule of rules!.defaultsFrom!) {
    if (!empty(values[rule.column])) continue;
    const value =
      rule.from === 'connection.currency'
        ? await reader?.currency(target.connectionId)
        : await settingValue(target.db, rule.from, reader);
    if (empty(value)) continue;
    // A link into an add-on's table, filled from the settings row's own link: only with a row it can name.
    const link = rules!.addOnLinks?.find((one) => one.column === rule.column);
    if (link !== undefined && !(await namesRow(target.db, link, value))) continue;
    out ??= { ...values };
    out[rule.column] = value;
  }
  return out ?? values;
}
