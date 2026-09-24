// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a group keyed by a foreign key is called — "Dr Rao", not `7`.
 *
 * `descriptor.groupLabel` names one column of the row the grouped key points
 * at (`clinician_id.short_name`). After the aggregate runs, the keys it
 * returned are looked up in that table, in one query, and handed to the
 * shaper as each group's label. The same rules as a lookup: the caller must
 * be able to read that table (else the groups keep their keys — a label is
 * never the reason a widget fails), a masked column reads only for a caller
 * who sees personal data, and a secret column never.
 */
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { ValidationFailedError } from '../errors.js';
import type { CompiledWidgetQuery } from './compiler.js';

/** Keys labelled per query: the shaper folds anything past its own cap anyway. */
const LABEL_KEYS_MAX = 500;

export async function groupLabelsFor(input: {
  path: string | undefined;
  compiled: CompiledWidgetQuery;
  rows: readonly Row[];
  view: SnapshotView;
  db: Kysely<SourceDatabase>;
  canReadPii: boolean;
  canReadTable: (tableId: string) => Promise<boolean>;
}): Promise<ReadonlyMap<string, string> | undefined> {
  const { path, compiled, view } = input;
  if (path === undefined) return undefined;
  const [link, column] = path.split('.');
  if (link === undefined || column === undefined || link !== compiled.groupColumns[0] || compiled.groupAlias === null) {
    throw new ValidationFailedError('groupLabel names a column one link away from the column grouped by: "<grouped column>.<label column>".', { groupLabel: path });
  }
  const relation = view.model.relations.find(
    (candidate) => candidate.from.tableId === compiled.table.id && candidate.from.columns.length === 1 && candidate.from.columns[0] === link,
  );
  const referenced = relation?.to.columns[0];
  if (relation === undefined || referenced === undefined) {
    throw new ValidationFailedError(`"${link}" does not point at another table, so its groups have no label to read.`, { groupLabel: path });
  }
  const target = view.table(relation.to.tableId);
  const label = target.columns.get(column);
  if (label === undefined || label.secret) {
    throw new ValidationFailedError(`"${column}" is not a column of ${target.id} a label can be read from.`, { groupLabel: path });
  }
  if (!(await input.canReadTable(target.id))) return undefined;
  if (label.masked && !input.canReadPii) return undefined;

  const alias = compiled.groupAlias;
  const keys = [...new Set(input.rows.map((row) => row[alias]).filter((key) => key !== null && key !== undefined))].slice(0, LABEL_KEYS_MAX);
  if (keys.length === 0) return new Map();
  const found = (await input.db
    .selectFrom(target.id as never)
    .select([`${referenced} as k` as never, `${column} as l` as never])
    .where(referenced as never, 'in', keys as never)
    .execute()) as { k: unknown; l: unknown }[];
  return new Map(found.filter((row) => row.l !== null && row.l !== undefined && String(row.l) !== '').map((row) => [String(row.k), String(row.l)]));
}
