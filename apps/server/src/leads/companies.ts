// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE COMPANIES TABLES A FOUND COMPANY GOES IN, AS THE OWNER LEFT THEM.
 *
 * An app declares which of its tables hold companies (`people[]` with
 * `kind: "companies"`), and where a found company's details go (its `lead`
 * word: number, website, phone, address, activity, about, owner). The
 * owner's sheet for the table may say otherwise. `people/declared.ts`
 * resolves both into real columns of the database; this file only picks
 * among what it resolved:
 *
 *  - {@link companiesTablesOn}: every declared companies table of a
 *    database, in the order the apps declare them;
 *  - {@link companiesTableFor}: the one a request names (by its id, or its
 *    stored name `<app>:<ref>`), else the first;
 *  - {@link companyCountryColumn}: the column that holds a company's
 *    two-letter country (the language its people are told in).
 */
import type { MetaDb } from '@adminium/meta';

import { resolveTableRef, storedTableRef, tableRefIndex } from '../apps/table-ref.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { DeclaredPeopleTable } from '../people/declared.js';
import { peopleTablesOf } from '../people/tables-of.js';

/** A declared companies table, with the table it is and the name it is stored by. */
export interface CompaniesTable {
  declared: DeclaredPeopleTable;
  table: ResolvedTable;
  /** `<app>:<ref>`: how the add-on's tables name it. */
  ref: string;
}

/** The column of a declared companies table that holds a company's two-letter country, or null. */
export function companyCountryColumn(declared: DeclaredPeopleTable, table: Pick<ResolvedTable, 'columns'>): string | null {
  if (declared.kind !== 'companies') return null;
  const column = declared.lead?.address?.country;
  return column !== undefined && table.columns.has(column) ? column : null;
}

/** Every companies table the apps on a database declare, with a name column. */
export async function companiesTablesOn(meta: MetaDb, connectionId: string, view: SnapshotView): Promise<CompaniesTable[]> {
  const index = await tableRefIndex(meta, connectionId, view.model);
  const out: CompaniesTable[] = [];
  for (const declared of await peopleTablesOf(meta).all(connectionId, view.model)) {
    if (declared.kind !== 'companies' || declared.name === null) continue;
    let table: ResolvedTable;
    try {
      table = view.table(declared.table);
    } catch {
      continue;
    }
    out.push({ declared, table, ref: storedTableRef(index, declared.table) });
  }
  return out;
}

/** The companies table a request names (its id or `<app>:<ref>`), else the first; null when there is none. */
export async function companiesTableFor(meta: MetaDb, connectionId: string, view: SnapshotView, named: string | undefined): Promise<CompaniesTable | null> {
  const all = await companiesTablesOn(meta, connectionId, view);
  if (named === undefined || named === '') return all[0] ?? null;
  const index = await tableRefIndex(meta, connectionId, view.model);
  const id = resolveTableRef(index, named)?.tableId ?? named;
  return all.find((one) => one.table.id === id) ?? null;
}
