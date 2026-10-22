// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ROW PUT BACK TAKES ITS COPIES AGAIN.
 *
 * An undo of a removal puts the row back exactly as it was — but a copy that
 * always wins (`copy {mode: 'always'}`) is not the row's own to keep: it is
 * the linked row's value, and on a create it is always taken from there. Put
 * back as it was, a member row removed and restored after its deal changed
 * hands would name the deal's old owner, and every reach that reads the copy
 * would follow the old owner. So each such copy is read again from the linked
 * row as it is now, held for share inside the undo's transaction (the order a
 * write to the row takes), and the formulas that read one are worked out
 * again. A copy that only fills a blank (`mode: 'default'`) holds what its
 * writer chose, and is put back as it was.
 */
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { SourceDatabase } from '../connections/manager.js';
import type { TableRules } from './column-rules.js';
import { evaluateAll, touchedFormulas } from './formulas.js';
import type { Row } from './mask.js';
import { sameValue } from './write-values.js';

type Db = Kysely<SourceDatabase>;

/** The values with every copy that always wins taken again from its linked row; the same object when nothing moved. */
export async function copiesAgain(input: { db: Db; dialect: Dialect; rules: TableRules | null; values: Row; currency: () => Promise<string | null> }): Promise<Row> {
  const { db, dialect, rules, values } = input;
  const copies = (rules?.copies ?? []).filter((copy) => copy.mode === 'always' && values[copy.via] !== null && values[copy.via] !== undefined);
  if (copies.length === 0) return values;
  const next: Row = {};
  const byParent = new Map<string, typeof copies>();
  for (const copy of copies) {
    const key = `${copy.toTable}\u0000${copy.toColumn}\u0000${copy.via}`;
    byParent.set(key, [...(byParent.get(key) ?? []), copy]);
  }
  for (const group of byParent.values()) {
    const { toTable, toColumn, via } = group[0]!;
    let query = db
      .selectFrom(toTable)
      .select([...new Set(group.map((copy) => copy.from))] as never)
      .where((eb) => eb(db.dynamic.ref(toColumn), '=', values[via]));
    if (dialect !== 'sqlite') query = query.forShare();
    const parent = (await query.executeTakeFirst()) as Row | undefined;
    // The linked row is gone: the row goes back as it was, and its foreign key says the rest.
    if (parent === undefined) continue;
    for (const copy of group) if (!sameValue(values[copy.column], parent[copy.from])) next[copy.column] = parent[copy.from] ?? null;
  }
  if (Object.keys(next).length === 0) return values;
  const formulas = touchedFormulas(rules?.formulas ?? [], Object.keys(next));
  if (formulas.length > 0) {
    const currency = formulas.some((formula) => formula.scale === 'currency') ? await input.currency() : null;
    Object.assign(next, evaluateAll(formulas, { ...values, ...next }, rules?.currencyColumn, currency));
  }
  return { ...values, ...next };
}
