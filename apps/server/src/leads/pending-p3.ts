// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A STAND-IN, until the companies word (`people[].lead`) is read by the
 * engine with the owner's overrides: which column of a declared companies
 * table holds the company's country, read straight from the app's stored
 * manifest. The tell mail asks it for the language a found person is told
 * in. The resolved declaration replaces this file.
 */
import { manifestsRepo, type MetaDb } from '@adminium/meta';

import type { ResolvedTable } from '../crud/identifiers.js';
import type { DeclaredPeopleTable } from '../people/declared.js';

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading a companies table never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading a companies table never reads a credential');
  },
};

/** The column of a declared companies table that holds a company's two-letter country, or null. */
export async function companyCountryColumn(meta: MetaDb, declared: DeclaredPeopleTable, table: ResolvedTable): Promise<string | null> {
  if (declared.kind !== 'companies') return null;
  const entry = (await manifestsRepo(meta, NO_SECRETS).list('app')).find((one) => one.row.manifestKey === declared.appKey && one.row.connectionId === declared.connectionId);
  const people = (entry?.document as { people?: unknown } | undefined)?.people;
  if (!Array.isArray(people)) return null;
  for (const one of people) {
    const found = one as { table?: unknown; kind?: unknown; lead?: { address?: { country?: unknown } } } | null;
    if (found?.table !== declared.ref || found.kind !== 'companies') continue;
    const column = found.lead?.address?.country;
    return typeof column === 'string' && table.columns.has(column) ? column : null;
  }
  return null;
}
