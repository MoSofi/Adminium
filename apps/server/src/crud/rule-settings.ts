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
import type { TableRules } from './column-rules.js';
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

const empty = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

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
    out ??= { ...values };
    out[rule.column] = value;
  }
  return out ?? values;
}
