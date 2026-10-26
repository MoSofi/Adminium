// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PEOPLE TABLES OF ONE DATABASE, AS A WRITE READS THEM.
 *
 * The write path asks, for the table a row goes to, whether an app declares
 * it as people, and which of its columns is the address, the consent and the
 * opt-out mark (`declared.ts`). It asks on every write that could care (a
 * table with a strict stamp, a table whose consent the log hears of), so the
 * answer is kept: per snapshot of the database (the model object a view is
 * built over, which is new whenever the schema or the owner's overrides
 * move) and for at most half a minute (an app switched off or on changes no
 * snapshot). One reader per meta store, shared by every write service built
 * over it.
 */
import type { MetaDb } from '@adminium/meta';

import type { EffectiveModel } from '../connections/effective-schema.js';
import { declaredPeople, type DeclaredPeopleTable, type PeopleModel } from './declared.js';

/** How long a database's declarations are kept before they are read again. */
const KEPT_MS = 30_000;

export interface PeopleTables {
  /** Every people table an installed app declares on this database. */
  all(connectionId: string, model: EffectiveModel | undefined): Promise<DeclaredPeopleTable[]>;
  /** The declaration of one table (its id in the snapshot), or null. */
  of(connectionId: string, model: EffectiveModel | undefined, tableId: string): Promise<DeclaredPeopleTable | null>;
}

/** The snapshot as the resolver reads it. */
function asPeopleModel(model: EffectiveModel): PeopleModel {
  return {
    tables: model.tables.map((table) => ({
      id: table.id,
      name: table.name,
      ...(typeof table.schema === 'string' ? { schema: table.schema } : {}),
      columns: table.columns.map((column) => ({ name: column.name, logicalType: column.logicalType })),
    })),
  };
}

export function createPeopleTables(meta: MetaDb, now: () => number = Date.now): PeopleTables {
  const kept = new WeakMap<object, Map<string, { at: number; tables: Promise<DeclaredPeopleTable[]> }>>();

  function all(connectionId: string, model: EffectiveModel | undefined): Promise<DeclaredPeopleTable[]> {
    if (model === undefined) return Promise.resolve([]);
    let byConnection = kept.get(model);
    if (byConnection === undefined) {
      byConnection = new Map();
      kept.set(model, byConnection);
    }
    const held = byConnection.get(connectionId);
    if (held !== undefined && now() - held.at < KEPT_MS) return held.tables;
    const read = declaredPeople(meta, async (id) => (id === connectionId ? asPeopleModel(model) : null)).then((tables) => tables.filter((table) => table.connectionId === connectionId));
    const entry = { at: now(), tables: read };
    byConnection.set(connectionId, entry);
    // A read that failed is not kept: the next write reads again.
    read.catch(() => {
      if (byConnection.get(connectionId) === entry) byConnection.delete(connectionId);
    });
    return read;
  }

  return {
    all,
    async of(connectionId, model, tableId) {
      return (await all(connectionId, model)).find((table) => table.table === tableId) ?? null;
    },
  };
}

const READERS = new WeakMap<MetaDb, PeopleTables>();

/** The one reader of a meta store. */
export function peopleTablesOf(meta: MetaDb): PeopleTables {
  let reader = READERS.get(meta);
  if (reader === undefined) {
    reader = createPeopleTables(meta);
    READERS.set(meta, reader);
  }
  return reader;
}
