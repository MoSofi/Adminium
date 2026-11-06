// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE OTHER APPS A SELF-MADE APP NEEDS ON ITS DATABASE (`apps.requires`).
 *
 * A dashboard saved with pages on a catalogue app's tables never carries that
 * app: it requires it. The plan finds the required app on the SAME database
 * (installs are per database; one on another database is no use to this
 * one), by its installed row, never by the marketplace's cached catalogue,
 * and refuses when it is not there, is another publisher's (a file that says
 * it is `pos` is not POS), or runs a version outside the range.
 *
 * The tables the dependent names as the required app's are never made by its
 * install: the plan points them at the required app's real tables and records
 * the dependent's use of them as `shared` (`owned: false`). A table another
 * app's record names is never dropped by an uninstall (`removal.ts`
 * `droppable`), so the required app's uninstall keeps them, and the
 * dependent's own uninstall only releases its records.
 *
 * And the other way: while a dependent is installed on a database, the app it
 * requires there is not uninstalled — the removal plan names who needs it,
 * and the uninstall is refused, as an add-on an app requires is.
 */
import { requiredAppTables, satisfiesSemverRange, type Manifest, type PlanProblem, type RequiredApp } from '@adminium/manifest';
import { realTableOf, type AppTableRecord, type InstalledManifest, type ManifestsRepo } from '@adminium/meta';

import { AppError } from '../errors.js';
import { installOnConnection } from '../installs/resolve.js';

/** The states in which the required app's record means its table is there, in its use. */
const IN_USE: ReadonlySet<string> = new Set(['created', 'adopted', 'shared']);

/** The statuses in which an install is there to be used (an `installing` or failed one is not). */
const THERE: ReadonlySet<string> = new Set(['installed', 'disabled']);

function needsInWords(need: RequiredApp): string {
  return `${need.key} by ${need.publisher}${need.range === undefined ? '' : ` (${need.range})`}`;
}

function nameOf(install: InstalledManifest): string {
  const name = (install.document as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : install.row.manifestKey;
}

function publisherOf(document: unknown): string | null {
  const id = (document as { publisher?: { id?: unknown } } | null)?.publisher?.id;
  return typeof id === 'string' ? id : null;
}

export interface RequiredAppsHere {
  /** Why the install cannot go ahead here: one problem per requirement not met, per table not found. */
  problems: PlanProblem[];
  /** The dependent's tables that are a required app's, as its own plan records them: shared, never its own. */
  records: Record<string, { table: string; owned: boolean; state: string }>;
  /** Their real names, for the live read the plan is made from. */
  names: Set<string>;
}

/**
 * What the apps this manifest requires are on this database: the problems that
 * refuse it, and the required tables it uses. Read only; the plan writes nothing.
 */
export async function requiredAppsHere(
  manifests: ManifestsRepo,
  manifest: Manifest,
  connectionId: string,
  recorded: readonly AppTableRecord[],
): Promise<RequiredAppsHere> {
  const out: RequiredAppsHere = { problems: [], records: {}, names: new Set() };
  if (manifest.kind !== 'app' || manifest.apps === undefined) return out;
  for (const need of manifest.apps.requires) {
    const found = await installOnConnection(manifests, need.key, connectionId);
    // An app's install on this database: a server-wide row of the key is an add-on's, never the app needed.
    const here = found !== null && found.row.kind === 'app' && found.row.connectionId === connectionId && THERE.has(found.row.status) ? found : null;
    if (here === null) {
      const elsewhere = (await manifests.listByKey(need.key)).some((install) => install.row.kind === 'app' && install.row.connectionId !== connectionId);
      out.problems.push({
        code: 'REQUIRED_APP_MISSING',
        table: need.key,
        message:
          `${manifest.name} needs ${needsInWords(need)}, which is not installed on this database. ` +
          (elsewhere ? 'It is installed on another database, and an app uses the one on its own database: install it here too, first.' : 'Install it here first.'),
      });
      continue;
    }
    const publisher = publisherOf(here.document);
    if (publisher !== need.publisher) {
      out.problems.push({
        code: 'REQUIRED_APP_PUBLISHER',
        table: need.key,
        message: `${manifest.name} needs ${needsInWords(need)}. The "${need.key}" on this database is ${publisher === null ? 'of no known publisher' : `published by ${publisher}`}, so it is not that app.`,
      });
      continue;
    }
    if (need.range !== undefined && !satisfiesSemverRange(here.row.version, need.range)) {
      out.problems.push({
        code: 'REQUIRED_APP_VERSION',
        table: need.key,
        message: `${manifest.name} needs ${nameOf(here)} ${need.range}, and this database has ${here.row.version}. Update ${nameOf(here)} first.`,
      });
      // Its tables are still the ones this app means: planned as shared, so the plan says only what is wrong.
    }
    for (const ref of need.tables ?? []) {
      const record = recorded.find((r) => r.appKey === need.key && r.ref === ref && r.role === 'app' && IN_USE.has(r.state));
      if (record === undefined) {
        out.problems.push({
          code: 'REQUIRED_APP_TABLE',
          table: ref,
          message: `${manifest.name} uses ${nameOf(here)}'s "${ref}" table, which ${nameOf(here)} does not keep on this database.`,
        });
        continue;
      }
      // Its table as it really is: one the required app keeps in a schema of its own is that schema's.
      out.records[ref] = { table: realTableOf(record), owned: false, state: 'shared' };
      out.names.add(realTableOf(record));
    }
  }
  return out;
}

/** The required tables that the live read did not find: recorded, and not in the database. */
export function requiredTablesGone(manifest: Manifest, here: RequiredAppsHere, live: readonly { ref: string }[]): PlanProblem[] {
  const needs = requiredAppTables(manifest.kind === 'app' ? manifest.apps : undefined);
  return Object.entries(here.records).flatMap(([ref, record]) =>
    live.some((table) => table.ref === record.table)
      ? []
      : [{ code: 'REQUIRED_APP_TABLE' as const, table: ref, message: `${manifest.name} uses ${needs.get(ref)?.key ?? 'another app'}'s "${record.table}" table, which is not in this database.` }],
  );
}

/** The apps installed on this database that require this install, by name. */
export async function dependentsOf(manifests: ManifestsRepo, install: InstalledManifest): Promise<{ key: string; name: string }[]> {
  const connectionId = install.row.connectionId;
  if (install.row.kind !== 'app' || connectionId === null) return [];
  const publisher = publisherOf(install.document);
  const apps = (await manifests.list('app')).filter((other) => other.row.connectionId === connectionId && other.row.id !== install.row.id);
  return apps
    .filter((other) => {
      const requires = (other.document as { apps?: { requires?: readonly { publisher?: unknown; key?: unknown }[] } } | null)?.apps?.requires ?? [];
      return requires.some((need) => need.key === install.row.manifestKey && need.publisher === publisher);
    })
    .map((other) => ({ key: other.row.manifestKey, name: nameOf(other) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** 409 `APP_REQUIRED_BY`: the apps on this database that cannot run without this one, named. */
export function requiredByError(key: string, dependents: readonly { key: string; name: string }[]): AppError {
  const names = dependents.map((dependent) => dependent.name);
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
  return new AppError(
    409,
    'APP_REQUIRED_BY',
    `"${key}" can’t be uninstalled from this database: ${list} ${names.length === 1 ? 'needs' : 'need'} it. Uninstall ${names.length === 1 ? 'that app' : 'those apps'} first.`,
    { key, apps: dependents },
  );
}
