// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PEOPLE TABLE'S E-MAIL SHEET: the owner's word on one table an app
 * declares as people ("E-mail settings for Contacts").
 *
 *  - "Can be e-mailed from campaigns": off keeps a declared table out of every
 *    campaign (it leaves the send dialog's list);
 *  - the e-mail and name columns: the app declares them; the owner may name
 *    another text column of the table;
 *  - "Existing customers": its own switch and tick (`existing-customers.ts`),
 *    offered only where the app declares the opt-out mark and who counts as a
 *    customer.
 *
 * The first two are kept as one `table.people` override row, as the other
 * `table.*` words are: a change writes a new row in the owner's name and
 * leaves the earlier ones disabled, so the newest active row stands
 * (`people/declared.ts` reads it). Every column the row names is a column the
 * sheet offered: a text column of the table, and for the address one the
 * person sees in clear.
 *
 * The sheet opens a table as the send dialog does (`openPeopleTable`: the
 * campaigns' grant, the table read, its addresses in clear), and also one the
 * owner switched off, so it can be switched back on.
 */
import { manifestsRepo, overridesRepo, type MetaDb } from '@adminium/meta';

import type { SnapshotView } from '../crud/identifiers.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { offersExistingCustomers } from '../outbox/marketing.js';
import { peopleTablesOf } from '../people/tables-of.js';
import { appNameOf, existingCustomersView, openPeopleTable, type AudienceDeps, type AudienceTableEntry, type PeopleTableAccess } from './audience-table.js';

export const PEOPLE_WORD_OP = 'table.people';

/** What an address or a name may be held in (`people/declared.ts`). */
const TEXT_TYPES: ReadonlySet<string> = new Set(['text', 'varchar']);

/** One column the sheet's pickers offer. */
export interface SheetColumn {
  name: string;
  label: string;
  /** May hold the address: the person sees it in clear. */
  address: boolean;
}

export interface PeopleTableSheet {
  connectionId: string;
  table: string;
  label: string;
  appName: string;
  kind: 'people' | 'companies';
  canEmail: boolean;
  email: string;
  name: string | null;
  columns: SheetColumn[];
  /** The column that says who counts as a customer, as the app declares it; null when it declares none. */
  customer: { column: string; label: string } | null;
  existingCustomers: AudienceTableEntry['existingCustomers'];
}

/** A people table in the list the sheet can be opened for, switched off or not. */
export interface PeopleTableListEntry {
  connectionId: string;
  table: string;
  label: string;
  appName: string;
  canEmail: boolean;
}

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('the e-mail sheet never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('the e-mail sheet never reads a credential');
  },
};

function labelOf(access: PeopleTableAccess, column: string): string {
  return access.table.table.columns.find((one) => one.name === column)?.label ?? column;
}

/** The text columns the person sees, each said whether it may hold the address. */
export function sheetColumns(access: PeopleTableAccess): SheetColumn[] {
  const out: SheetColumn[] = [];
  for (const column of access.table.columns.values()) {
    if (column.secret || column.unreadable === true || column.isPrimaryKey || !TEXT_TYPES.has(column.logicalType)) continue;
    out.push({ name: column.name, label: labelOf(access, column.name), address: !column.masked || access.canReadPii });
  }
  return out;
}

/** The sheet as the person reaches it (see the header). */
export async function peopleTableSheet(deps: AudienceDeps, access: PeopleTableAccess, appName: string): Promise<PeopleTableSheet> {
  const { declared } = access;
  return {
    connectionId: declared.connectionId,
    table: access.wholeTable.id,
    label: access.label,
    appName,
    kind: declared.kind,
    canEmail: declared.canEmail,
    email: declared.email as string,
    name: declared.name,
    columns: sheetColumns(access),
    customer: declared.customer === null ? null : { column: declared.customer, label: labelOf(access, declared.customer) },
    existingCustomers: await existingCustomersView(deps.meta, { offered: offersExistingCustomers(declared), switched: access.switched }),
  };
}

/** The name of the app that declares the table, for the sheet's sub-line. */
export async function declaringAppName(meta: MetaDb, appKey: string): Promise<string> {
  const app = (await manifestsRepo(meta, NO_SECRETS).list('app')).find((one) => one.row.manifestKey === appKey);
  return app === undefined ? appKey : appNameOf(app.document, appKey);
}

export class PeopleSheetError extends Error {
  override readonly name = 'PeopleSheetError';
  constructor(
    readonly field: 'email' | 'name',
    message: string,
  ) {
    super(message);
  }
}

/**
 * The owner's change of the sheet's first two parts: a new `table.people`
 * row in their name, the earlier active ones disabled. Nothing is written
 * when nothing changed. Returns whether it wrote.
 */
export async function setPeopleTableWord(
  meta: MetaDb,
  access: PeopleTableAccess,
  input: { canEmail: boolean; email: string; name: string | null; by: string },
  at: number = Date.now(),
): Promise<boolean> {
  const columns = sheetColumns(access);
  if (!columns.some((column) => column.name === input.email && column.address)) throw new PeopleSheetError('email', 'Pick a text column of the table whose addresses you see.');
  if (input.name !== null && !columns.some((column) => column.name === input.name)) throw new PeopleSheetError('name', 'Pick a text column of the table.');
  const { declared } = access;
  const name = input.name ?? declared.name;
  if (declared.canEmail === input.canEmail && declared.email === input.email && declared.name === name) return false;

  const overrides = overridesRepo(meta);
  const earlier = await meta.db
    .selectFrom('adminium_schema_overrides')
    .select('id')
    .where('connectionId', '=', declared.connectionId)
    .where('op', '=', PEOPLE_WORD_OP)
    .where('tableName', '=', access.wholeTable.id)
    .where('status', '=', 'active')
    .execute();
  await overrides.create(
    {
      connectionId: declared.connectionId,
      op: PEOPLE_WORD_OP,
      tableName: access.wholeTable.id,
      value: { canEmail: input.canEmail, email: input.email, ...(name === null ? {} : { name }) },
      origin: 'user',
      createdBy: input.by,
    },
    at,
  );
  for (const one of earlier) await overrides.setStatus(one.id, 'disabled', at);
  return true;
}

/** Every people table the person may open the sheet for, those switched off included. */
export async function peopleTablesForSheet(deps: AudienceDeps, userId: string): Promise<PeopleTableListEntry[]> {
  const installed = await manifestsRepo(deps.meta, NO_SECRETS).list('app');
  const out: PeopleTableListEntry[] = [];
  for (const app of installed) {
    const connectionId = app.row.connectionId;
    if (connectionId === null || app.row.status !== 'installed') continue;
    let whole: SnapshotView;
    try {
      whole = await loadSnapshotView(deps.meta, connectionId);
    } catch {
      continue;
    }
    for (const declared of await peopleTablesOf(deps.meta).all(connectionId, whole.model)) {
      if (declared.appKey !== app.row.manifestKey) continue;
      const opened = await openPeopleTable(deps, userId, connectionId, declared.table, { evenSwitchedOff: true });
      if (!('ok' in opened)) continue;
      out.push({ connectionId, table: opened.ok.wholeTable.id, label: opened.ok.label, appName: appNameOf(app.document, app.row.manifestKey), canEmail: declared.canEmail });
    }
  }
  return out;
}
