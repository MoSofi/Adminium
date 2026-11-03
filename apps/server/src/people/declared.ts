// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PEOPLE TABLES OF AN INSTALL, AS ITS OWNER LEFT THEM.
 *
 * An app declares which of its tables hold people (or companies) in its
 * manifest's `people` list: the address, the name, the consent column, the
 * copies of a person on other tables (see `@adminium/manifest` `people.ts`).
 * E-mail to contacts reads it for an audience, a person's data (find, export,
 * erase) for where a person is, the consent log for the column it mirrors.
 * This is the one place that turns those declarations into real tables:
 *
 *  - each installed app's entries, read from the manifest it stored, on the
 *    database it was installed on;
 *  - each table by its id in that database's snapshot (`public.crm_contacts`),
 *    through the app's own record of the table: a table the app no longer
 *    holds (uninstalled, dropped, left out with a part of the app) is not
 *    declared, and neither is a copy kept on one;
 *  - a column the database no longer has reads as none;
 *  - the owner's word last: a `table.people` override (the table's e-mail
 *    sheet) switches campaigns off for the table, or names another column
 *    for the address or the name. An override that names a column the table
 *    does not have, or one that holds no text, is not taken.
 *
 * A pure read: nothing is written, nothing is served. The loader reads the
 * meta store once; `resolveDeclaredPeople` does the rest and is what the
 * tests drive.
 */
import { FIRST_WORD_OF_NAME, LINK_PATH, isAddOnCopy, optOutMarkColumn, peopleSchema, type PeopleCopy, type PeopleEntry } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, overridesRepo, type AppTableRecord, type MetaDb, type SchemaOverride } from '@adminium/meta';

/** A column on another table that holds a copy of the person's address or name. */
export interface DeclaredCopy {
  /** The table's id in the snapshot. */
  table: string;
  /** The app's short name for it (an add-on's table: `<add-on>-<its short name>`, safe in a file name). */
  ref: string;
  column: string;
  holds: PeopleCopy['holds'];
  /** The copy table's link back to the person, when there is one. */
  via: string | null;
  /**
   * The column keeps JSON (a design's words), as its manifest declares it or
   * the database says: blanked to an empty value of its own, and downloaded
   * as the value it holds, on every engine (SQLite keeps it as text).
   */
  json?: true;
  /**
   * A copy on a table of an add-on the app requires: the app's own table
   * whose link names the add-on's rows (`line`, its column `link`), and how
   * that table reaches the person — it is their table or one of their copy
   * tables (`up` null), or links to one (`up`: its column and the table it
   * points at). The add-on's rows its rows name are the person's.
   */
  through?: { line: string; link: string; up: { column: string; to: string } | null };
}

/** One people (or companies) table, resolved. Every table is a snapshot id, every column a real column of it. */
export interface DeclaredPeopleTable {
  connectionId: string;
  /** The app that declares it, and that app's status (`installed`, `disabled`, …). */
  appKey: string;
  appStatus: string;
  /** The app's short name for the table, and its id in the snapshot. */
  ref: string;
  table: string;
  kind: 'people' | 'companies';
  email: string | null;
  name: string | null;
  firstName: { column: string } | typeof FIRST_WORD_OF_NAME | null;
  language: string | null;
  /** The link to the company the person works for. */
  company: string | null;
  consent: { column: string; purpose: NonNullable<PeopleEntry['consent']>['purpose'] } | null;
  copies: DeclaredCopy[];
  /** A yes/no or number column that says the person is a customer. */
  customer: string | null;
  /** The strict stamp the app's screens set where they show the opt-out line. */
  optOutMark: string | null;
  /** The mark of the row a person is made from (a claimed enquiry's), which the save that makes them copies. */
  optOutMarkFrom: { table: string; ref: string; column: string } | null;
  /** Whether campaigns may mail the table: it has an address, and the owner has not switched it off. */
  canEmail: boolean;
}

/** What the resolver reads of a database's snapshot. */
export interface PeopleModel {
  tables: readonly { id: string; name: string; schema?: string | undefined; columns: readonly { name: string; logicalType?: string | undefined }[] }[];
}

/** Everything the resolver reads, already loaded. */
export interface PeopleSource {
  /** Installed apps: their key, the database they were installed on, their status and the manifest they stored. */
  apps: readonly { appKey: string; connectionId: string | null; status: string; document: unknown }[];
  /** Installed add-ons and the manifests they stored: what their tables' columns are, for the copies kept on them. */
  addOns?: readonly { key: string; document: unknown }[];
  /** The apps' records of their tables, on every database. */
  records: readonly Pick<AppTableRecord, 'appKey' | 'connectionId' | 'ref' | 'tableName' | 'schemaName' | 'owned' | 'state'>[];
  /** Each database's snapshot, by connection id. */
  models: ReadonlyMap<string, PeopleModel>;
  /** The owner's overrides, of every database (only active `table.people` rows are read). */
  overrides: readonly Pick<SchemaOverride, 'connectionId' | 'op' | 'tableName' | 'value' | 'status'>[];
}

/** The states in which an app still holds a table. */
const HELD = new Set(['created', 'adopted', 'shared']);
/** What an address or a name may be held in. */
const TEXT_TYPES = new Set(['text', 'varchar']);
/** The statuses whose apps' people are still there: one being installed is not yet, a broken row is not read. */
const PRESENT = new Set(['installed', 'disabled']);

/** The `json` columns of each table a stored manifest declares, by its short names. */
function jsonColumnsOf(document: unknown): Map<string, Set<string>> {
  const tables = (document as { requiredSchema?: { tables?: unknown } } | null)?.requiredSchema?.tables;
  const out = new Map<string, Set<string>>();
  for (const table of Array.isArray(tables) ? (tables as { ref?: unknown; columns?: unknown }[]) : []) {
    if (typeof table?.ref !== 'string' || !Array.isArray(table.columns)) continue;
    const json = (table.columns as { ref?: unknown; type?: unknown }[]).flatMap((column) => (column.type === 'json' && typeof column.ref === 'string' ? [column.ref] : []));
    if (json.length > 0) out.set(table.ref, new Set(json));
  }
  return out;
}

/** An app's `people`, read from the manifest it stored; a list that does not read is none. */
function peopleOf(document: unknown): { entries: PeopleEntry[]; keyFields: Map<string, string>; links: Map<string, { column: string; to: string }[]>; requires: Set<string> } {
  const doc = typeof document === 'object' && document !== null ? (document as { people?: unknown; requiredSchema?: { tables?: unknown }; addOns?: { requires?: unknown } }) : {};
  const parsed = peopleSchema.safeParse(doc.people);
  const tables = Array.isArray(doc.requiredSchema?.tables) ? (doc.requiredSchema.tables as unknown[]) : [];
  const keyFields = new Map(
    tables.flatMap((table) => {
      const one = table as { ref?: unknown; keyField?: unknown } | null;
      return typeof one?.ref === 'string' && typeof one.keyField === 'string' ? [[one.ref, one.keyField] as const] : [];
    }),
  );
  // Each table's foreign keys, by the app's short names: how a line reaches the person.
  const links = new Map(
    tables.flatMap((table) => {
      const one = table as { ref?: unknown; columns?: unknown } | null;
      if (typeof one?.ref !== 'string' || !Array.isArray(one.columns)) return [];
      const fks = (one.columns as { ref?: unknown; type?: unknown; references?: unknown }[]).flatMap((column) => (column.type === 'fk' && typeof column.ref === 'string' && typeof column.references === 'string' ? [{ column: column.ref, to: column.references }] : []));
      return [[one.ref, fks] as const];
    }),
  );
  const requires = new Set(Array.isArray(doc.addOns?.requires) ? (doc.addOns.requires as { key?: unknown }[]).flatMap((one) => (typeof one.key === 'string' ? [one.key] : [])) : []);
  return { entries: parsed.success ? parsed.data : [], keyFields, links, requires };
}

/** Every people table of the install, resolved against its database and the owner's word. */
export function resolveDeclaredPeople(source: PeopleSource): DeclaredPeopleTable[] {
  const out: DeclaredPeopleTable[] = [];
  /** Which declaration of a real table stands: the one of the app that made it, else the first by app key. */
  const owner = new Map<string, { index: number; owned: boolean }>();
  const apps = [...source.apps].filter((app) => app.connectionId !== null && PRESENT.has(app.status)).sort((a, b) => a.appKey.localeCompare(b.appKey));
  // Each add-on's JSON columns, from the first manifest it stored (its tables' shape is its own, whichever app it is for).
  const addOnJson = new Map<string, Map<string, Set<string>>>();
  for (const addOn of source.addOns ?? []) if (!addOnJson.has(addOn.key)) addOnJson.set(addOn.key, jsonColumnsOf(addOn.document));

  for (const app of apps) {
    const connectionId = app.connectionId as string;
    const model = source.models.get(connectionId);
    if (model === undefined) continue;
    const { entries, keyFields, links, requires } = peopleOf(app.document);
    const appJson = jsonColumnsOf(app.document);
    /** Whether a copy's column keeps JSON: its manifest says so, or the database does. */
    const keepsJson = (declared: Map<string, Set<string>> | undefined, ref: string, column: string, real: PeopleModel['tables'][number]): boolean =>
      declared?.get(ref)?.has(column) === true || real.columns.find((candidate) => candidate.name === column)?.logicalType === 'json';
    /** The real table an app's (or an add-on's) short name stands for here, while it still holds it. */
    const tableOf = (ref: string, owner: string = app.appKey) => {
      const record = source.records.find((candidate) => candidate.connectionId === connectionId && candidate.appKey === owner && candidate.ref === ref && HELD.has(candidate.state));
      if (record === undefined) return undefined;
      const table = model.tables.find((candidate) => candidate.name === record.tableName && (record.schemaName === null || candidate.schema === undefined || candidate.schema === record.schemaName));
      return table === undefined ? undefined : { table, owned: record.owned };
    };

    for (const entry of entries) {
      const found = tableOf(entry.table);
      if (found === undefined) continue;
      const { table } = found;
      const column = (name: string | undefined): string | null => (name !== undefined && table.columns.some((candidate) => candidate.name === name) ? name : null);
      const textColumn = (name: unknown): string | null => {
        if (typeof name !== 'string') return null;
        const held = table.columns.find((candidate) => candidate.name === name);
        return held !== undefined && (held.logicalType === undefined || TEXT_TYPES.has(held.logicalType)) ? name : null;
      };

      let email = column(entry.email);
      let name = column(entry.name ?? keyFields.get(entry.table));
      let switchedOff = false;
      // The owner's word, in the order it was written: a later row wins.
      for (const row of source.overrides) {
        if (row.status !== 'active' || row.op !== 'table.people' || row.connectionId !== connectionId || row.tableName !== table.id) continue;
        const value = row.value as { canEmail?: unknown; email?: unknown; name?: unknown };
        if (typeof value.canEmail === 'boolean') switchedOff = !value.canEmail;
        email = textColumn(value.email) ?? email;
        name = textColumn(value.name) ?? name;
      }

      /** The app's tables that reach the person: their own, and each copy table of the app's own. */
      const reaching = new Set([entry.table, ...(entry.copies ?? []).filter((copy) => !isAddOnCopy(copy)).map((copy) => copy.table)]);
      const copies: DeclaredCopy[] = (entry.copies ?? []).flatMap((copy) => {
        if (isAddOnCopy(copy)) {
          // On an add-on's table, through the app's link into it: only an add-on the app requires, while both hold their tables here.
          const path = LINK_PATH.exec(copy.via);
          if (path === null || !requires.has(copy.addOn)) return [];
          const [, lineRef, link] = path as unknown as [string, string, string];
          const held = tableOf(copy.table, copy.addOn);
          const line = tableOf(lineRef);
          if (held === undefined || line === undefined || !held.table.columns.some((candidate) => candidate.name === copy.column) || !line.table.columns.some((candidate) => candidate.name === link)) return [];
          let up: { column: string; to: string } | null = null;
          if (!reaching.has(lineRef)) {
            const fk = (links.get(lineRef) ?? []).find((candidate) => reaching.has(candidate.to) && line.table.columns.some((column) => column.name === candidate.column));
            const to = fk === undefined ? undefined : tableOf(fk.to);
            if (fk === undefined || to === undefined) return [];
            up = { column: fk.column, to: to.table.id };
          }
          const json = keepsJson(addOnJson.get(copy.addOn), copy.table, copy.column, held.table);
          return [{ table: held.table.id, ref: `${copy.addOn}-${copy.table}`, column: copy.column, holds: copy.holds, via: null, ...(json ? { json: true as const } : {}), through: { line: line.table.id, link, up } }];
        }
        const held = tableOf(copy.table);
        if (held === undefined || !held.table.columns.some((candidate) => candidate.name === copy.column)) return [];
        const via = copy.via !== undefined && held.table.columns.some((candidate) => candidate.name === copy.via) ? copy.via : null;
        const json = keepsJson(appJson, copy.table, copy.column, held.table);
        return [{ table: held.table.id, ref: copy.table, column: copy.column, holds: copy.holds, via, ...(json ? { json: true as const } : {}) }];
      });
      const firstName = entry.firstName === undefined ? null : typeof entry.firstName === 'object' ? (column(entry.firstName.column) === null ? null : { column: entry.firstName.column }) : FIRST_WORD_OF_NAME;
      const consentColumn = entry.consent === undefined ? null : column(entry.consent.column);
      const carried = typeof entry.optOutMark === 'object' ? entry.optOutMark.carryFrom : undefined;
      const carriedFrom = carried === undefined ? undefined : tableOf(carried.table);
      const markFrom = carried !== undefined && carriedFrom !== undefined && carriedFrom.table.columns.some((candidate) => candidate.name === carried.column) ? { table: carriedFrom.table.id, ref: carried.table, column: carried.column } : null;

      const declared: DeclaredPeopleTable = {
        connectionId,
        appKey: app.appKey,
        appStatus: app.status,
        ref: entry.table,
        table: table.id,
        kind: entry.kind,
        email,
        name,
        firstName,
        language: column(entry.language),
        company: column(entry.company),
        consent: entry.consent === undefined || consentColumn === null ? null : { column: consentColumn, purpose: entry.consent.purpose },
        copies,
        customer: column(entry.customer),
        optOutMark: column(optOutMarkColumn(entry)),
        optOutMarkFrom: markFrom,
        canEmail: email !== null && !switchedOff,
      };

      // One declaration a real table: the app that made it says it, else the first app by key.
      const key = `${connectionId}\u0000${table.id}`;
      const standing = owner.get(key);
      if (standing === undefined) {
        owner.set(key, { index: out.length, owned: found.owned });
        out.push(declared);
      } else if (found.owned && !standing.owned) {
        out[standing.index] = declared;
        owner.set(key, { index: standing.index, owned: true });
      }
    }
  }
  return out;
}

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading the people tables never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading the people tables never reads a credential');
  },
};

/**
 * Every people table of the install: the apps, their records and the
 * owner's overrides read from the meta store, each database's snapshot
 * through `models` (a database with none declares nothing).
 */
export async function declaredPeople(meta: MetaDb, models: (connectionId: string) => Promise<PeopleModel | null>): Promise<DeclaredPeopleTable[]> {
  const installed = await manifestsRepo(meta, NO_SECRETS).list('app');
  const apps = installed.map((entry) => ({ appKey: entry.row.manifestKey, connectionId: entry.row.connectionId, status: entry.row.status, document: entry.document }));
  const addOns = (await manifestsRepo(meta, NO_SECRETS).list('add-on')).map((entry) => ({ key: entry.row.manifestKey, document: entry.document }));
  const connectionIds = [...new Set(apps.flatMap((app) => (app.connectionId === null ? [] : [app.connectionId])))];
  const records: AppTableRecord[] = [];
  const overrides: SchemaOverride[] = [];
  const loaded = new Map<string, PeopleModel>();
  for (const connectionId of connectionIds) {
    const model = await models(connectionId);
    if (model === null) continue;
    loaded.set(connectionId, model);
    records.push(...(await appTablesRepo(meta).forConnection(connectionId)));
    overrides.push(...(await overridesRepo(meta).listForConnection(connectionId, { status: 'active' })));
  }
  return resolveDeclaredPeople({ apps, addOns, records, models: loaded, overrides });
}
