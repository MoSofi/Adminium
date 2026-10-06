// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing, upgrading and attaching an add-on — ONE body, two doors.
 *
 * `POST /add-ons` (Studio → Add-ons) and `POST /apps/install` (an app that
 * needs an add-on) both install add-ons. Two copies of the install would be two
 * places for the checks to drift apart — the staged tree re-verified, the full
 * validator, the declared hosts, the plan, the tables before the meta row — so
 * both routes call these functions, and so do upgrade and the attach route.
 *
 * ─── What an attach is checked against ─────────────────────────────────────
 *
 * Mounting an add-on on a host runs its code against that host's data, so an
 * attach — at install, by the attach route, or by an app install — asks:
 *
 *  - does the add-on SAY it attaches there (`attaches[].app`, or `*`);
 *  - does the host's version fall inside the add-on's `attaches[].range` —
 *    only for an add-on whose own floor is above 0.3.0 (see
 *    {@link RANGES_ENFORCED_ABOVE});
 *  - can every `records:<table>` scope it asks for reach a table the host
 *    declares (the validator's SCOPE_OUT_OF_RANGE, given the host's tables);
 *  - are its tables in the host's database — attaching creates nothing.
 *
 * ─── The tables go where the app is ────────────────────────────────────────
 *
 * With an app, the add-on's tables are created in the APP's connection, named
 * explicitly: the app's row may not exist yet for the target to infer it from,
 * and "the only connection" is the wrong answer on an instance with two.
 */
import {
  compareSemver,
  installsLikeAnApp,
  isAddOnManifest,
  planInstall,
  prefixFor,
  satisfiesSemverRange,
  validateManifest,
  type AddOnManifest,
  type InstallPlan,
  type Manifest,
} from '@adminium/manifest';
import { appTablesRepo, auditRepo, inIdOrder, manifestsRepo, readJson, type InstalledManifest, type MetaDb } from '@adminium/meta';

import { refuseUnbuiltManifest } from '../crud/unbuilt-rules.js';
import { AppError, ConflictError, NotFoundError, ValidationFailedError } from '../errors.js';
import type { InstallPlanDto } from '../routes/add-ons/schema.js';
import { DECIDER_CONTRACTS, deciderGate } from './decide.js';
import type { InstallActor, InstallCore, InstallHost } from './install-core.js';
import { needsOf } from './needs.js';
import type { AddOnSchemaTarget } from './schema-target.js';
import type { AddOnStore } from './store.js';
import { APP_VERSION } from '../version.js';

/** The host a stock deployment's own pages hang off — the dashboard's rail. */
export const DASHBOARD_HOST = 'dashboard';

/**
 * Attach ranges are ENFORCED only for an add-on whose own floor is above this.
 *
 * Every add-on published before this server declared `range: "^1.0.0"` against
 * apps that are all at 0.x — ranges were parsed and never checked, so nothing
 * noticed. Enforcing them now would refuse every published add-on on the very
 * apps it was written for. An add-on built for this server (its floor says so)
 * wrote its ranges knowing they are checked; older ones stay advisory.
 */
export const RANGES_ENFORCED_ABOVE = '0.3.0';

export interface AddOnInstallerDeps {
  meta: MetaDb;
  store: AddOnStore;
  credentialCrypto: { encrypt(v: string): string; decrypt(v: string): string };
  schemaTarget?: AddOnSchemaTarget | undefined;
  rebuildRuntime?: (() => Promise<void>) | undefined;
  /**
   * Tests only: the words this server refuses a manifest for. Production
   * reads the server's own list (`crud/unbuilt-rules.ts`).
   */
  unbuiltWords?: Readonly<Record<string, string>> | undefined;
  /**
   * Installing "like an app" (an add-on that keeps tables of its own, with
   * pages, roles and rules): the app install service, bound late. Absent or
   * null, an add-on that needs it is refused, by name.
   */
  core?: (() => InstallCore | null) | undefined;
}

/** Who did it, for the audit rows. */
export interface Actor {
  id: string | null;
  label: string;
  /** `system` when no person stands behind it. A user when absent. */
  kind?: 'user' | 'system' | undefined;
  /** Whether they may open the row-ceiling door a schema edit can need. No when absent. */
  superAdmin?: (() => Promise<boolean>) | undefined;
  /** Whether they hold a permission; yes when absent (a caller with no permission layer). */
  can?: ((permission: string) => Promise<boolean>) | undefined;
}

/** A host as the attach checks see it; `version` and `tables` are null for the dashboard. */
export interface HostApp {
  key: string;
  version: string | null;
  /** The table refs its manifest declares, or null when it is not an app. */
  tables: readonly string[] | null;
  connectionId: string | null;
}

/** Why an add-on may not be mounted on a host. */
export interface HostProblem {
  code: 'ATTACH_NOT_DECLARED' | 'ADD_ON_RANGE';
  table: string;
  message: string;
}

/** An add-on plan, with the attach checks folded in. */
export interface AddOnPlanned {
  plan: InstallPlan;
  dto: InstallPlanDto;
  /** For an add-on that installs like an app: what the plan was made against, and its identity. */
  connectionId?: string | undefined;
  checksum?: string | undefined;
}

/**
 * The FULL validator over a stored or staged add-on document.
 *
 * `validateManifest` adds the policy layer a schema parse does not: the
 * publisher gate and `FRONTEND_SECRET_LEAK` (a `publicSettings` entry naming a
 * secret). Given hosts, it also bounds the add-on's scopes by their tables.
 */
export function parseAddOnDocument(
  document: unknown,
  key: string,
  hosts: readonly HostApp[] = [],
  /**
   * The words a manifest is refused for; the server's own list when absent.
   * `installed`: the document is one this server already installed, so the
   * question was asked then and is not asked again.
   */
  unbuiltWords?: Readonly<Record<string, string>> | 'installed',
): { manifest: AddOnManifest; warnings: string[] } {
  // A word this server reads and does not run yet: refused whole, never installed in part.
  if (unbuiltWords !== 'installed') refuseUnbuiltManifest(document, `"${key}"`, APP_VERSION, unbuiltWords);
  const hostTables = tablesOfHosts(hosts);
  const result = validateManifest(document, {
    // Every host this check knows: the ones being attached, and the dashboard.
    knownAppKeys: [DASHBOARD_HOST, ...hosts.map((host) => host.key)],
    ...(hostTables === undefined ? {} : { hostTables }),
  });
  if (!result.ok) {
    /*
     * AN UNKNOWN TARGET IS ADVICE HERE, NOT A REFUSAL. Every published add-on
     * names app keys an instance usually does not have (`printing`, `maker`,
     * `hr`); an attach to a host it does name is already checked by
     * `declares`. Every other issue refuses.
     */
    const refusing = result.issues.filter((issue) => issue.code !== 'ATTACH_TARGET_UNKNOWN');
    if (refusing.length > 0) {
      throw new ValidationFailedError(`The manifest for "${key}" is not a valid add-on manifest here.`, {
        issues: refusing,
      });
    }
    const parsed = validateManifest(document);
    if (!parsed.ok || !isAddOnManifest(parsed.manifest)) {
      throw new ValidationFailedError(`The manifest for "${key}" is not a valid add-on manifest.`, {
        issues: parsed.ok ? [] : parsed.issues,
      });
    }
    return {
      manifest: parsed.manifest,
      warnings: result.issues.map((issue) => `${issue.path}: ${issue.message}`),
    };
  }
  if (!isAddOnManifest(result.manifest)) {
    throw new ValidationFailedError(`"${key}" is an app manifest, not an add-on.`);
  }
  return { manifest: result.manifest, warnings: [] };
}

/** The table refs every app host declares, or undefined when no host is an app. */
function tablesOfHosts(hosts: readonly HostApp[]): string[] | undefined {
  const apps = hosts.filter((host) => host.tables !== null);
  if (apps.length === 0) return undefined;
  return [...new Set(apps.flatMap((host) => host.tables ?? []))];
}

/** Whether the add-on says it attaches to `host`. */
export function declaresHost(manifest: AddOnManifest, host: string): boolean {
  return manifest.addOn.attaches.some((target) => target.app === '*' || target.app === host);
}

/**
 * Why `manifest` may not attach to an app at `version`, or null.
 *
 * The entries naming the app itself decide; only when none does, a `*` entry's
 * range does. A range that does not parse is out of range, never "any".
 */
export function attachRangeRefusal(manifest: AddOnManifest, host: { key: string; version: string | null }): string | null {
  if (host.version === null) return null;
  if (compareSemver(manifest.compatibility.minAdminiumVersion, RANGES_ENFORCED_ABOVE) <= 0) return null;
  const named = manifest.addOn.attaches.filter((target) => target.app === host.key);
  const entries = named.length > 0 ? named : manifest.addOn.attaches.filter((target) => target.app === '*');
  const ranges = entries.flatMap((target) => (target.range === undefined ? [] : [target.range]));
  if (ranges.length === 0 || ranges.some((range) => satisfiesSemverRange(host.version!, range))) return null;
  return (
    `${manifest.name} ${manifest.version} works with ${host.key} ${ranges.join(' or ')}, ` +
    `and ${host.key} is ${host.version}.`
  );
}

/**
 * The hosts an add-on attaches to, as the checks need them: an installed app
 * from its row, an app not installed yet from `given`, the dashboard as is.
 */
export async function hostsFor(
  deps: Pick<AddOnInstallerDeps, 'meta' | 'credentialCrypto'>,
  keys: readonly string[],
  given: readonly HostApp[] = [],
): Promise<HostApp[]> {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const out: HostApp[] = [];
  for (const key of keys) {
    const known = given.find((host) => host.key === key);
    if (known !== undefined) {
      out.push(known);
      continue;
    }
    const row = await manifests.findByKey(key);
    if (row === null || row.row.kind !== 'app') {
      out.push({ key, version: null, tables: null, connectionId: null });
      continue;
    }
    out.push(hostOfApp(row));
  }
  return out;
}

/** An installed app row as a host. */
export function hostOfApp(row: InstalledManifest): HostApp {
  const document = row.document as Manifest | null;
  return {
    key: row.row.manifestKey,
    version: row.row.version,
    tables: (document?.requiredSchema?.tables ?? []).map((table) => table.ref),
    connectionId: row.row.connectionId,
  };
}

/** The hosts to attach at install: the ones asked for, and the dashboard when the add-on has pages. */
export function hostsToAttach(manifest: AddOnManifest, attachTo: readonly string[]): string[] {
  const hosts = [...new Set(attachTo)];
  /*
   * AN ADD-ON WITH PAGES IS MOUNTED ON THE DASHBOARD TOO. Its pages reach the
   * rail only through a `dashboard` attachment; installed without one, the
   * page was declared, listed nowhere and unreachable — the Studio install
   * attached to nothing at all.
   */
  if ((manifest.addOn.pages ?? []).length > 0 && !hosts.includes(DASHBOARD_HOST) && declaresHost(manifest, DASHBOARD_HOST)) {
    hosts.push(DASHBOARD_HOST);
  }
  return hosts;
}

/** The plan as the consent dialog reads it, the attach checks among its problems. */
function toDto(plan: InstallPlan, extra: readonly HostProblem[], warnings: readonly string[]): InstallPlanDto {
  return {
    addOnKey: plan.addOnKey,
    version: plan.version,
    installable: plan.installable,
    touchesData: plan.touchesData,
    create: plan.create.map((t) => ({
      ref: t.ref,
      columns: t.columns.map((c) => ({ ref: c.ref, type: c.type })),
    })),
    reuse: plan.reuse.map((t) => ({ ref: t.ref, missingColumns: t.missingColumns })),
    references: plan.references,
    problems: [
      ...plan.problems.map((p) => ({
        code: p.code as string,
        message: p.message,
        table: p.table,
        ...(p.column === undefined ? {} : { column: p.column }),
      })),
      ...extra.map((p) => ({ code: p.code as string, message: p.message, table: p.table })),
    ],
    requiresSchemaChange: plan.create.length > 0 || plan.reuse.some((t) => t.missingColumns.length > 0),
    ...(plan.names === undefined ? {} : { names: plan.names }),
    ...(warnings.length === 0 ? {} : { warnings: [...warnings] }),
  };
}

/**
 * What stands in the way of mounting `manifest` on these hosts: a host it does
 * not say it works with, or one outside its (enforced) attach range. Pure.
 */
export function hostProblems(manifest: AddOnManifest, hosts: readonly HostApp[]): HostProblem[] {
  const problems: HostProblem[] = [];
  for (const host of hosts) {
    if (!declaresHost(manifest, host.key)) {
      problems.push({
        code: 'ATTACH_NOT_DECLARED',
        table: host.key,
        message: `${manifest.name} does not say it works with "${host.key}".`,
      });
      continue;
    }
    const outOfRange = attachRangeRefusal(manifest, host);
    if (outOfRange !== null) problems.push({ code: 'ADD_ON_RANGE', table: host.key, message: outOfRange });
  }
  return problems;
}

/**
 * What installing `manifest` on these hosts would do, with the attach checks
 * as plan problems — so the consent dialog and an app's install check both
 * show a refusal before anyone agrees to anything.
 */
export async function planAddOn(
  deps: Pick<AddOnInstallerDeps, 'schemaTarget' | 'core'>,
  manifest: AddOnManifest,
  input: { attachTo: readonly string[]; hosts?: readonly HostApp[]; connectionId?: string | undefined; warnings?: readonly string[] },
): Promise<AddOnPlanned> {
  // An add-on that installs like an app is planned the way an app is: on one connection, under its own prefix.
  if (installsLikeAnApp(manifest)) {
    const core = deps.core?.() ?? null;
    if (core === null || input.connectionId === undefined) {
      throw new ValidationFailedError(
        core === null
          ? `"${manifest.key}" keeps tables of its own, which this instance cannot install: nothing that installs an app is wired into the add-on installer here.`
          : `"${manifest.key}" keeps tables of its own: say which database it is installed in.`,
        { code: core === null ? 'ADD_ON_DDL_REQUIRED' : 'ADD_ON_SCHEMA_CONNECTION' },
      );
    }
    const planned = await core.planFor(manifest, input.connectionId);
    const extra = hostProblems(manifest, input.hosts ?? []);
    const plan: InstallPlan = { ...planned.plan, installable: planned.plan.installable && extra.length === 0 };
    return { plan, dto: toDto(plan, extra, input.warnings ?? []), connectionId: input.connectionId, checksum: planned.dto.checksum };
  }
  // An add-on that declares no tables reads no database, and so is never asked which.
  const declares = (manifest.requiredSchema?.tables ?? []).length > 0;
  const tables = declares ? ((await deps.schemaTarget?.read(input.attachTo, input.connectionId)) ?? []) : [];
  const pure = planInstall(manifest, { tables });
  const extra = hostProblems(manifest, input.hosts ?? []);
  const plan: InstallPlan = { ...pure, installable: pure.installable && extra.length === 0 };
  return { plan, dto: toDto(plan, extra, input.warnings ?? []) };
}

/** Reads and re-verifies a staged package, then parses its manifest. */
export async function addOnManifestFromStore(
  deps: Pick<AddOnInstallerDeps, 'store' | 'unbuiltWords'>,
  key: string,
  version: string,
  hosts: readonly HostApp[] = [],
): Promise<{ manifest: AddOnManifest; warnings: string[]; document: unknown }> {
  try {
    // The TOCTOU close: the tree is checked against the per-file pin recorded
    // at unpack before anything reads it.
    await deps.store.verifyTree(key, version);
  } catch (error) {
    const reason = (error as { reason?: string }).reason ?? 'UNKNOWN';
    if (reason === 'TREE_MISSING') {
      throw new NotFoundError(
        `No verified package for "${key}@${version}" is staged on this instance. ` +
          'Download it from the catalog, or upload its tarball, before installing.',
      );
    }
    throw new ValidationFailedError(
      `The staged package for "${key}@${version}" no longer matches the bytes that were ` +
        'verified when it was downloaded, so it will not be installed.',
      { reason },
    );
  }
  const bytes = await deps.store.readFile(key, version, 'manifest.json');
  let document: unknown;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ValidationFailedError(`The manifest in "${key}@${version}" is not readable JSON.`);
  }
  return { ...parseAddOnDocument(document, key, hosts, deps.unbuiltWords), document };
}

/** Refuse, by name, what a plan says stands in the way. */
function refuseUnlessInstallable(
  key: string,
  plan: { problems: readonly { code: string; message: string; table: string }[]; installable: boolean },
  verb: 'installed' | 'attached' | 'updated',
): void {
  const range = plan.problems.find((problem) => problem.code === 'ADD_ON_RANGE');
  if (range !== undefined) {
    throw new AppError(409, 'ADD_ON_RANGE', range.message, { addOn: key, app: range.table, problems: plan.problems });
  }
  const undeclared = plan.problems.filter((problem) => problem.code === 'ATTACH_NOT_DECLARED').map((p) => p.table);
  if (undeclared.length > 0) {
    throw new ValidationFailedError(`"${key}" does not declare that it attaches to ${undeclared.join(', ')}.`, {
      refused: undeclared,
    });
  }
  if (!plan.installable) {
    throw new ValidationFailedError(`"${key}" cannot be ${verb} on this instance.`, { problems: plan.problems });
  }
}

export interface InstallAddOnInput {
  key: string;
  version: string;
  attachTo: readonly string[];
  /** The app hosts not installed yet (an app install in progress), as the checks need them. */
  hosts?: readonly HostApp[];
  /** Where its tables go; absent, the target infers it from the hosts. */
  connectionId?: string | undefined;
  /** The `checksum` of the plan the person looked at; a database that moved since answers `SCHEMA_DRIFT`. */
  planChecksum?: string | undefined;
  /** The server the install runs in: its log, and how open dashboards are told. A quiet one when absent. */
  host?: InstallHost | undefined;
  actor: Actor;
  /** How the audit row says it arrived. */
  via?: string;
}

/**
 * Install a staged add-on: verify, check, create its tables, then the meta row.
 *
 * The DDL runs BEFORE the meta row is written: a multi-table install cannot be
 * one transaction on MySQL, so a failure halfway leaves real tables and nothing
 * registered, and every create is `IF NOT EXISTS` — a retry completes it.
 */
export async function installAddOn(
  deps: AddOnInstallerDeps,
  input: InstallAddOnInput,
): Promise<{ installed: InstalledManifest; plan: InstallPlanDto; created: string[]; reused?: string[]; connectionId?: string | null; written?: Readonly<Record<string, unknown>> }> {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const { key, version } = input;
  const existing = await manifests.findByKey(key);
  // An install that stopped part way left its row `installing`: the same call finishes it (below).
  if (existing !== null && !(existing.row.kind === 'add-on' && existing.row.status === 'installing' && existing.row.version === version)) {
    throw new ConflictError(`"${key}" is already installed. Uninstall it first, or upgrade it instead.`);
  }

  // Read once to learn the hosts it adds; the document is then checked
  // against those hosts' tables.
  const first = await addOnManifestFromStore(deps, key, version);
  const attachTo = hostsToAttach(first.manifest, input.attachTo);
  const hosts = await hostsFor(deps, attachTo, input.hosts);
  const { manifest, warnings } = parseAddOnDocument(first.document, key, hosts, deps.unbuiltWords);
  if (manifest.key !== key) {
    throw new ValidationFailedError(`The staged package declares key "${manifest.key}", not "${key}".`);
  }
  if (installsLikeAnApp(manifest)) return installLikeAnApp(deps, input, { manifest, warnings, attachTo, hosts, resumed: existing });
  if (existing !== null) throw new ConflictError(`"${key}" is already installed. Uninstall it first, or upgrade it instead.`);

  // Where its tables are, when it declares any: asked once, kept on its row and on a record per table.
  const ownsTables = (manifest.requiredSchema?.tables ?? []).length > 0;
  const connectionId = input.connectionId ?? (ownsTables ? ((await deps.schemaTarget?.resolve?.({ ownsTables, attachTo })) ?? null) : null);

  const { plan: rawPlan, dto: plan } = await planAddOn(deps, manifest, {
    attachTo,
    hosts,
    connectionId: connectionId ?? undefined,
    warnings,
  });
  refuseUnlessInstallable(key, plan, 'installed');

  // A table that EXISTS but is missing columns the add-on needs is refused:
  // altering a table the operator already owns is their conversation to have.
  const incomplete = plan.reuse.filter((t) => t.missingColumns.length > 0);
  if (incomplete.length > 0) {
    throw new ValidationFailedError(
      `"${key}" needs columns that tables in this database do not have. Adding columns to ` +
        'tables you already own is not something an install will do.',
      { code: 'ADD_ON_COLUMNS_REQUIRED', incomplete },
    );
  }

  let created: string[] = [];
  if (plan.create.length > 0) {
    if (deps.schemaTarget === undefined) {
      throw new ValidationFailedError(
        `"${key}" needs tables this instance cannot create, because no data source is ` +
          'wired into the add-on installer here.',
        { code: 'ADD_ON_DDL_REQUIRED', create: plan.create.map((t) => t.ref) },
      );
    }
    ({ created } = await deps.schemaTarget.apply(rawPlan, manifest, attachTo, connectionId ?? undefined));
  }

  const installed = await manifests.install({
    manifestKey: key,
    version,
    kind: 'add-on',
    source: 'marketplace',
    document: manifest,
    connectionId,
    installedBy: input.actor.id,
    attachTo,
  });
  // One record per table it declares: made here, or found and taken as it is.
  if (connectionId !== null) {
    const records = appTablesRepo(deps.meta);
    for (const table of manifest.requiredSchema?.tables ?? []) {
      const made = created.includes(table.ref);
      await records.record({ appKey: key, manifestId: installed.row.id, connectionId, ref: table.ref, tableName: table.ref, owned: made, state: made ? 'created' : 'adopted', prefix: null });
    }
  }

  await auditRepo(deps.meta).append({
    actorKind: input.actor.kind ?? 'user',
    actorId: input.actor.id,
    actorLabel: input.actor.label,
    category: 'add-on',
    action: 'add-on.installed',
    changes: {
      after: {
        key,
        version,
        attachTo,
        tables: plan.reuse.map((t) => t.ref),
        created,
        ...(connectionId === null ? {} : { connectionId }),
        ...(input.via === undefined ? {} : { via: input.via }),
      },
    },
  });
  await deps.rebuildRuntime?.();
  return { installed, plan, created, connectionId };
}

/** Whether a package ships code that decides inside a save: its install goes through that code's gate. */
function decides(manifest: AddOnManifest): boolean {
  return (manifest.addOn.provides ?? []).some((provided) => DECIDER_CONTRACTS[provided.contract] !== undefined);
}

/**
 * AN ADD-ON THAT INSTALLS LIKE AN APP: its own tables, under its own prefix,
 * in one database, with a record per table.
 *
 * The row is written FIRST, as `installing`, so a failure part way leaves a
 * record of what was started and the same call finishes it: nothing is rolled
 * back (a multi-table install cannot be one transaction on MySQL). Only when
 * every step is done does the row say `installed`, and only then is its code
 * loaded.
 */
async function installLikeAnApp(
  deps: AddOnInstallerDeps,
  input: InstallAddOnInput,
  ctx: { manifest: AddOnManifest; warnings: string[]; attachTo: string[]; hosts: readonly HostApp[]; resumed: InstalledManifest | null },
): Promise<{ installed: InstalledManifest; plan: InstallPlanDto; created: string[]; reused: string[]; connectionId: string; written: Readonly<Record<string, unknown>> }> {
  const { manifest, attachTo, hosts } = ctx;
  const { key, version } = input;
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const core = deps.core?.() ?? null;
  if (core === null || deps.schemaTarget?.resolve === undefined) {
    throw new ValidationFailedError(`"${key}" keeps tables of its own, which this instance cannot install: nothing that installs an app is wired into the add-on installer here.`, {
      code: 'ADD_ON_DDL_REQUIRED',
    });
  }
  // The database: the one a stopped install chose, else the one named, else the one that can be worked out.
  const connectionId = ctx.resumed?.row.connectionId ?? (await deps.schemaTarget.resolve({ ownsTables: true, attachTo, connectionId: input.connectionId }));
  if (connectionId === null) {
    throw new ValidationFailedError(`"${key}" needs tables, and this instance has no database connection to create them in. Connect a data source first.`, { code: 'ADD_ON_NO_CONNECTION' });
  }
  if (ctx.resumed !== null && input.connectionId !== undefined && input.connectionId !== connectionId) {
    throw new ConflictError(`An install of "${key}" was started in another database and has not finished. Finish it there, or uninstall it first.`);
  }

  const planned = await planAddOn(deps, manifest, { attachTo, hosts, connectionId, warnings: ctx.warnings });
  refuseUnlessInstallable(key, planned.dto, 'installed');
  if (input.planChecksum !== undefined && planned.checksum !== undefined && input.planChecksum !== planned.checksum) {
    throw new AppError(409, 'SCHEMA_DRIFT', `The database changed since "${key}" was checked. Check again, then install.`, { addOn: key, connectionId });
  }

  const records = appTablesRepo(deps.meta);
  let stage: 'tables' | 'writers' | 'seeds' | 'finish' = 'tables';
  const created: string[] = [];
  let reused: string[] = [];
  let written: Readonly<Record<string, unknown>> = {};
  const who: InstallActor = {
    id: input.actor.id,
    label: input.actor.label,
    kind: input.actor.kind,
    superAdmin: input.actor.superAdmin ?? (() => Promise.resolve(false)),
    can: input.actor.can ?? (() => Promise.resolve(true)),
  };
  const where: InstallHost = input.host ?? { log: { info: () => undefined, warn: () => undefined } };
  let installed = ctx.resumed;
  const work = async (): Promise<InstalledManifest> => {
    const row =
      installed ??
      (await manifests.install({ manifestKey: key, version, kind: 'add-on', source: 'marketplace', document: manifest, connectionId, status: 'installing', installedBy: input.actor.id, attachTo }));
    installed = row;
    // A reinstall takes back the records an uninstall released; then each table is recorded BEFORE it is made.
    await records.attach(connectionId, key, row.row.id);
    const checked = await core.checkedPlan(key, manifest, connectionId, 'installed', input.planChecksum);
    const pending = new Map<string, string>();
    const prefix = manifest.requiredSchema?.prefixed === true ? prefixFor(key) : null;
    const applied = await core.applyTables(
      checked,
      manifest,
      connectionId,
      { superAdmin: await who.superAdmin(), createdBy: input.actor.id },
      {
        afterRenames: async () => {
          for (const [ref, id] of await core.recordTables({ key, manifest, rowId: row.row.id, connectionId, checked, prefix })) pending.set(ref, id);
        },
        onCreated: async (ref) => {
          created.push(ref);
          const id = pending.get(ref);
          if (id !== undefined) await records.setState(id, 'created');
        },
      },
    );
    reused = applied.reused;
    /*
     * What it declares beside its tables, in the order an app's are written:
     * option lists and rules, pages, roles, emails. Strict: one that cannot be
     * written stops the install here, to be finished by the same call.
     */
    stage = 'writers';
    written = (await core.writePages(who, where, manifest, row.row.id, connectionId, input.actor.id, true, checked.plan.names ?? {}, false)) ?? {};
    /*
     * The rows its tables start with, and its one settings row: after the
     * rules, so each row gets its table's own defaults, numbers and codes;
     * into empty tables only, so finishing a stopped install adds none twice.
     */
    stage = 'seeds';
    if ((manifest.seeds ?? []).length > 0 || manifest.addOn.settingsTable !== undefined) {
      const seeded = await core.writeSeeds({
        actor: who,
        manifest,
        connectionId,
        names: checked.plan.names ?? {},
        readFile: async (path) => (await deps.store.readVerifiedFile(key, version, path)).bytes,
      });
      written = { ...written, seeds: seeded.written, seedsKept: seeded.kept };
    }
    stage = 'finish';
    await manifests.setStatus(row.row.id, 'installed');
    // Loaded before any save is let back in: the next one runs this version's code.
    await deps.rebuildRuntime?.();
    // What it prints for its own rows: made now that its own code is loaded. Never what stops an install.
    try {
      const documents = await core.makeDocuments(manifest, connectionId, input.actor.id);
      if (documents !== undefined) written = { ...written, documents };
    } catch (error) {
      where.log.warn({ err: error, addOn: key }, 'the add-on is installed, but its document profiles were not made');
    }
    return { ...row, row: { ...row.row, status: 'installed' } };
  };

  try {
    // Code that decides inside a save is not asked anything while its tables are being made.
    installed = decides(manifest) ? await deciderGate(key).write(work, { mark: false }) : await work();
  } catch (error) {
    if (installed === null) throw error;
    const pending = (await records.forInstall(connectionId, key)).filter((record) => record.state === 'pending').map((record) => record.ref);
    await auditRepo(deps.meta).append({
      actorKind: input.actor.kind ?? 'user',
      actorId: input.actor.id,
      actorLabel: input.actor.label,
      category: 'add-on',
      action: 'add-on.install-failed',
      changes: { after: { key, version, connectionId, stage, created, pending } },
    });
    throw new AppError(
      409,
      'ADD_ON_INSTALL_INCOMPLETE',
      `"${key}" was not installed completely: it stopped at the ${stage} stage. Nothing was undone; install it again to finish.`,
      { addOn: key, version, stage, created, pending, cause: error instanceof AppError ? { code: error.code, message: error.message } : { message: error instanceof Error ? error.message : String(error) } },
    );
  }

  await auditRepo(deps.meta).append({
    actorKind: input.actor.kind ?? 'user',
    actorId: input.actor.id,
    actorLabel: input.actor.label,
    category: 'add-on',
    action: 'add-on.installed',
    changes: {
      after: { key, version, attachTo, connectionId, tables: reused, created, ...(ctx.resumed === null ? {} : { resumed: true }), ...(input.via === undefined ? {} : { via: input.via }) },
    },
  });
  return { installed, plan: planned.dto, created, reused, connectionId, written };
}

/**
 * Why moving `key` to `to` would break an app that relies on it, or null:
 * an attached app outside the new version's attach range (enforced floors
 * only), or an app whose `addOns.requires` range the new version leaves.
 */
export async function upgradeRangeRefusal(
  deps: Pick<AddOnInstallerDeps, 'meta' | 'credentialCrypto'>,
  manifest: AddOnManifest,
  attachedTo: readonly string[],
  /**
   * Hosts as they WILL be (an app being updated to a new version), and the app
   * whose own new manifest already chose this version — its stored needs are
   * the old version's and would refuse the very update it asks for.
   */
  opts: { hosts?: readonly HostApp[]; except?: string | undefined } = {},
): Promise<AppError | null> {
  for (const host of await hostsFor(deps, attachedTo, opts.hosts)) {
    const outOfRange = attachRangeRefusal(manifest, host);
    if (outOfRange !== null) {
      return new AppError(409, 'ADD_ON_RANGE', outOfRange, { addOn: manifest.key, app: host.key, version: manifest.version });
    }
  }
  for (const need of await needsOf(deps.meta, manifest.key)) {
    if (need.app === opts.except) continue;
    if (need.need !== 'requires' || need.range === null) continue;
    if (satisfiesSemverRange(manifest.version, need.range)) continue;
    return new AppError(
      409,
      'ADD_ON_RANGE',
      `${need.appName} works with ${manifest.name} ${need.range}, so ${manifest.version} would break it. ` +
        `Update ${need.appName} first.`,
      { addOn: manifest.key, app: need.app, range: need.range, version: manifest.version },
    );
  }
  /*
   * A SHAPE VERSION AN APP IS BUILT ON STAYS. An app pins `invoice@1`; a new
   * add-on version may bring `invoice@2` beside it, never instead of it, while
   * any installed app — switched off or part-installed included — still pins
   * it. Only that app's own update moves the pin.
   */
  const offered = new Set(
    (manifest.addOn as { shapes?: { name?: unknown; version?: unknown }[] }).shapes?.flatMap((shape) =>
      typeof shape.name === 'string' && typeof shape.version === 'number' ? [`${manifest.key}/${shape.name}@${String(shape.version)}`] : [],
    ) ?? [],
  );
  // Ids sorted, rows fetched after: a sort carrying the manifests fails on MySQL (`inIdOrder`).
  const order = (
    await deps.meta.db.selectFrom('adminium_manifests').select('id').where('kind', '=', 'app').orderBy('manifestKey', 'asc').execute()
  ).map((row) => row.id);
  const apps =
    order.length === 0
      ? []
      : inIdOrder(order, await deps.meta.db.selectFrom('adminium_manifests').select(['id', 'manifestKey', 'manifest']).where('id', 'in', order).execute());
  for (const app of apps) {
    if (app.manifestKey === opts.except) continue;
    const document = readJson<{ name?: unknown; requiredSchema?: { tables?: { ref?: unknown; builtOn?: unknown }[] } } | null>(app.manifest);
    for (const table of document?.requiredSchema?.tables ?? []) {
      if (typeof table.builtOn !== 'string' || !table.builtOn.startsWith(`${manifest.key}/`) || offered.has(table.builtOn)) continue;
      const appName = typeof document?.name === 'string' ? document.name : app.manifestKey;
      return new AppError(
        409,
        'ADD_ON_SHAPE_IN_USE',
        `${manifest.name} ${manifest.version} no longer has "${table.builtOn.slice(manifest.key.length + 1)}", which ${appName} is built on. ` +
          `Update ${appName} first.`,
        { addOn: manifest.key, app: app.manifestKey, shape: table.builtOn, version: manifest.version },
      );
    }
  }
  return null;
}

export interface UpdateAddOnInput {
  key: string;
  to?: string | undefined;
  actor: Actor;
  via?: string;
  /** Hosts as they will be once the caller is done (an app install or update in progress). */
  hosts?: readonly HostApp[];
  /** The app whose own install asks for this version (see {@link upgradeRangeRefusal}). */
  except?: string | undefined;
  /**
   * False: keep the earlier versions on disk. An app's install or update
   * that upgrades an add-on keeps them until it has finished, so an update
   * that stops part way can still be put back.
   */
  prune?: boolean;
  /**
   * `refuse`: a version that would change tables is not applied (the old
   * upgrade door). `apply`, the default: an add-on that keeps tables of its
   * own gets what the version adds to them.
   */
  schema?: 'apply' | 'refuse' | undefined;
  /** The `checksum` of the plan the person looked at; a database that moved since answers `SCHEMA_DRIFT`. */
  planChecksum?: string | undefined;
  /** The server the update runs in: its log, and how open dashboards are told. A quiet one when absent. */
  host?: InstallHost | undefined;
}

export interface UpdateAddOnResult {
  installed: InstalledManifest;
  from: string;
  to: string;
  pruned: string[];
  /** For an add-on that keeps tables of its own: where they are, what this update made, and what its writers wrote. */
  connectionId?: string | null;
  created?: string[];
  reused?: string[];
  written?: Readonly<Record<string, unknown>>;
}

/** What an update is from and to, re-hashed and re-checked: an update cannot carry past the checks what an install could not. */
async function updateTarget(deps: AddOnInstallerDeps, input: Pick<UpdateAddOnInput, 'key' | 'to' | 'hosts' | 'except'>) {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const { key } = input;
  const installed = await manifests.findByKey(key);
  if (installed === null || installed.row.kind !== 'add-on') throw new NotFoundError(`"${key}" is not installed.`);

  const from = installed.row.version;
  const newer = (await deps.store.versions(key)).filter((candidate) => compareSemver(candidate, from) > 0);
  /*
   * AN UPDATE THAT STOPPED PART WAY is finished by the same call. Its row
   * says `updating`; when it stopped after the version moved, the version to
   * finish is the one the row already carries, and there is none newer.
   */
  const resumed = installed.row.status === 'updating' && (input.to === undefined ? newer.length === 0 : input.to === from);
  const to = resumed ? from : input.to === undefined ? newer[0] : newer.find((candidate) => candidate === input.to);
  if (to === undefined) {
    throw new NotFoundError(
      input.to === undefined
        ? `No newer version of "${key}" is staged. Download one first.`
        : `"${key}" ${input.to} is not staged here as a version newer than ${from}. Download it first.`,
    );
  }

  const attachedTo = installed.attachments.map((a) => a.attachedTo);
  const hosts = await hostsFor(deps, attachedTo, input.hosts);
  const { manifest } = await addOnManifestFromStore(deps, key, to, hosts);
  if (manifest.key !== key) {
    throw new ValidationFailedError(`The staged package declares key "${manifest.key}", not "${key}".`);
  }

  // A new version may have DROPPED a host this instance has it mounted on.
  const declared = new Set(manifest.addOn.attaches.map((a) => a.app));
  const orphaned = declared.has('*') ? [] : attachedTo.filter((host) => !declared.has(host));
  if (orphaned.length > 0) {
    throw new ValidationFailedError(
      `"${key}" ${to} no longer attaches to ${orphaned.join(', ')}, which this instance ` +
        'has it mounted on.',
      { orphaned, declared: [...declared] },
    );
  }

  const broken = await upgradeRangeRefusal(deps, manifest, attachedTo, { hosts, except: input.except });
  if (broken !== null) throw broken;
  return { manifests, installed, from, to, manifest, attachedTo, hosts, resumed };
}

/**
 * What an update would do, before it does it: the plan of the version's
 * tables against the database the add-on lives in, and that plan's identity.
 * Writes nothing.
 */
export async function planAddOnUpdate(
  deps: AddOnInstallerDeps,
  input: Pick<UpdateAddOnInput, 'key' | 'to' | 'hosts' | 'except'>,
): Promise<{ plan: InstallPlanDto; from: string; to: string; connectionId: string | null; checksum?: string | undefined; manifest: AddOnManifest }> {
  const target = await updateTarget(deps, input);
  const { manifest, attachedTo, hosts, installed } = target;
  if (!installsLikeAnApp(manifest)) {
    return { plan: (await planAddOn(deps, manifest, { attachTo: attachedTo })).dto, from: target.from, to: target.to, connectionId: installed.row.connectionId, manifest };
  }
  const connectionId = installed.row.connectionId ?? (await deps.schemaTarget?.resolve?.({ ownsTables: true, attachTo: attachedTo })) ?? null;
  if (connectionId === null) {
    throw new ValidationFailedError(`"${input.key}" needs tables, and this instance has no database connection to create them in. Connect a data source first.`, { code: 'ADD_ON_NO_CONNECTION' });
  }
  const planned = await planAddOn(deps, manifest, { attachTo: attachedTo, hosts, connectionId, warnings: [] });
  return { plan: planned.dto, from: target.from, to: target.to, connectionId, checksum: planned.checksum, manifest };
}

/**
 * Update an installed add-on to a newer staged version, in place: the hosts it
 * is mounted on and the credential it was given survive it.
 *
 * An add-on that keeps tables of its own gets what the version adds to them
 * — new tables, new columns, indexes — and then what it declares beside them,
 * the way an app's update does: what the owner changed (a page, a rule, a
 * role's reach) is kept. While it runs its row says `updating`, so nothing
 * asks its code anything; a stop leaves it so, and the same call finishes.
 */
export async function updateAddOn(deps: AddOnInstallerDeps, input: UpdateAddOnInput): Promise<UpdateAddOnResult> {
  const { key } = input;
  const target = await updateTarget(deps, input);
  const { manifests, installed, from, to, manifest, attachedTo, hosts, resumed } = target;
  const likeApp = installsLikeAnApp(manifest);

  if (!likeApp || input.schema === 'refuse') {
    const { dto: upgradePlan } = likeApp
      ? await planAddOn(deps, manifest, { attachTo: attachedTo, hosts, connectionId: installed.row.connectionId ?? undefined, warnings: [] })
      : await planAddOn(deps, manifest, { attachTo: attachedTo });
    if (!upgradePlan.installable || upgradePlan.requiresSchemaChange) {
      throw new ValidationFailedError(`"${key}" ${to} cannot be applied to this instance.`, {
        problems: upgradePlan.problems,
        requiresSchemaChange: upgradePlan.requiresSchemaChange,
      });
    }
  }
  if (!likeApp) {
    await manifests.setVersion(installed.row.id, { version: to, document: manifest });
    // Older directories are pruned only AFTER the upgrade verified, so a failure
    // anywhere above leaves the running version on disk — and, for an upgrade
    // made by an app's update, only once that whole update is done.
    const pruned = input.prune === false ? [] : await pruneOlderVersions(deps, key, to);
    await auditRepo(deps.meta).append({
      actorKind: input.actor.kind ?? 'user',
      actorId: input.actor.id,
      actorLabel: input.actor.label,
      category: 'add-on',
      action: 'add-on.upgraded',
      changes: { after: { key, from, to, pruned, ...(input.via === undefined ? {} : { via: input.via }) } },
    });
    await deps.rebuildRuntime?.();
    return { installed: (await manifests.findByKey(key))!, from, to, pruned };
  }

  const core = deps.core?.() ?? null;
  if (core === null || deps.schemaTarget?.resolve === undefined) {
    throw new ValidationFailedError(`"${key}" keeps tables of its own, which this instance cannot update: nothing that installs an app is wired into the add-on installer here.`, { code: 'ADD_ON_DDL_REQUIRED' });
  }
  const connectionId = installed.row.connectionId ?? (await deps.schemaTarget.resolve({ ownsTables: true, attachTo: attachedTo }));
  if (connectionId === null) {
    throw new ValidationFailedError(`"${key}" needs tables, and this instance has no database connection to create them in. Connect a data source first.`, { code: 'ADD_ON_NO_CONNECTION' });
  }
  const planned = await planAddOn(deps, manifest, { attachTo: attachedTo, hosts, connectionId, warnings: [] });
  refuseUnlessInstallable(key, planned.dto, 'updated');
  if (input.planChecksum !== undefined && planned.checksum !== undefined && input.planChecksum !== planned.checksum) {
    throw new AppError(409, 'SCHEMA_DRIFT', `The database changed since "${key}" was checked. Check again, then update.`, { addOn: key, connectionId });
  }

  const records = appTablesRepo(deps.meta);
  const who: InstallActor = {
    id: input.actor.id,
    label: input.actor.label,
    kind: input.actor.kind,
    superAdmin: input.actor.superAdmin ?? (() => Promise.resolve(false)),
    can: input.actor.can ?? (() => Promise.resolve(true)),
  };
  const where: InstallHost = input.host ?? { log: { info: () => undefined, warn: () => undefined } };
  let stage: 'tables' | 'writers' | 'seeds' | 'finish' = 'tables';
  const created: string[] = [];
  let reused: string[] = [];
  let written: Readonly<Record<string, unknown>> = {};
  let pruned: string[] = [];
  const before = installed.row.status;
  const hadBefore = new Set(((installed.document as { requiredSchema?: { tables?: { ref?: unknown }[] } } | null)?.requiredSchema?.tables ?? []).map((table) => table.ref));
  const broughtByThisVersion = new Set((manifest.requiredSchema?.tables ?? []).map((table) => table.ref).filter((ref) => !hadBefore.has(ref)));

  const work = async (): Promise<void> => {
    if (installed.row.connectionId === null) await manifests.setConnection(installed.row.id, connectionId);
    await records.attach(connectionId, key, installed.row.id);
    const checked = await core.checkedPlan(key, manifest, connectionId, 'updated', input.planChecksum);
    const pending = new Map<string, string>();
    const prefix = manifest.requiredSchema?.prefixed === true ? prefixFor(key) : null;
    const applied = await core.applyTables(
      checked,
      manifest,
      connectionId,
      { superAdmin: await who.superAdmin(), createdBy: input.actor.id },
      {
        afterRenames: async () => {
          for (const [ref, id] of await core.recordTables({ key, manifest, rowId: installed.row.id, connectionId, checked, prefix })) pending.set(ref, id);
        },
        onCreated: async (ref) => {
          created.push(ref);
          const id = pending.get(ref);
          if (id !== undefined) await records.setState(id, 'created');
        },
      },
    );
    reused = applied.reused;
    stage = 'writers';
    written = (await core.writePages(who, where, manifest, installed.row.id, connectionId, input.actor.id, true, checked.plan.names ?? {}, false)) ?? {};
    /*
     * Starting rows only for the tables THIS version brings: a table the
     * version before already had is the owner's by now, empty or not. Read
     * from what the row still says is installed — the version moves last —
     * so an update that stopped and is taken up again answers the same. The
     * settings row only while its table holds none.
     */
    stage = 'seeds';
    if ((manifest.seeds ?? []).length > 0 || manifest.addOn.settingsTable !== undefined) {
      const seeded = await core.writeSeeds({
        actor: who,
        manifest,
        connectionId,
        names: checked.plan.names ?? {},
        readFile: async (path) => (await deps.store.readVerifiedFile(key, to, path)).bytes,
        only: broughtByThisVersion,
      });
      written = { ...written, seeds: seeded.written, seedsKept: seeded.kept };
    }
    // The version moves last: everything it needs is there, and until now a stop could be taken up from the top.
    stage = 'finish';
    await manifests.setVersion(installed.row.id, { version: to, document: manifest });
    pruned = input.prune === false ? [] : await pruneOlderVersions(deps, key, to);
    await manifests.setStatus(installed.row.id, 'installed');
    await deps.rebuildRuntime?.();
    try {
      const documents = await core.makeDocuments(manifest, connectionId, input.actor.id);
      if (documents !== undefined) written = { ...written, documents };
    } catch (error) {
      where.log.warn({ err: error, addOn: key }, 'the add-on is updated, but its document profiles were not brought up to date');
    }
  };

  // Other processes read the row: from here until the end nothing asks this add-on's code anything.
  await manifests.setStatus(installed.row.id, 'updating');
  try {
    // Code that decides inside a save waits for the saves in flight, and none starts while its tables change.
    const deciding = decides(manifest) || (isAddOnManifest(installed.document as never) && decides(installed.document as AddOnManifest));
    if (deciding) await deciderGate(key).write(work, { mark: false });
    else await work();
  } catch (error) {
    // The saves in flight did not finish in time: nothing moved, so the row goes back to what it said.
    if (error instanceof ConflictError && error.code === 'WRITE_CONFLICT') {
      if (!resumed) await manifests.setStatus(installed.row.id, before as 'installed');
      throw error;
    }
    await auditRepo(deps.meta).append({
      actorKind: input.actor.kind ?? 'user',
      actorId: input.actor.id,
      actorLabel: input.actor.label,
      category: 'add-on',
      action: 'add-on.update-failed',
      changes: { after: { key, from, to, connectionId, stage, created } },
    });
    throw new AppError(
      409,
      'ADD_ON_UPDATE_INCOMPLETE',
      `"${key}" was not updated completely: it stopped at the ${stage} stage. Nothing was undone; update it again to finish.`,
      { addOn: key, stage, from, to, created, cause: error instanceof AppError ? { code: error.code, message: error.message } : { message: error instanceof Error ? error.message : String(error) } },
    );
  }

  await auditRepo(deps.meta).append({
    actorKind: input.actor.kind ?? 'user',
    actorId: input.actor.id,
    actorLabel: input.actor.label,
    category: 'add-on',
    action: 'add-on.upgraded',
    changes: { after: { key, from, to, pruned, connectionId, created, ...(resumed ? { resumed: true } : {}), ...(input.via === undefined ? {} : { via: input.via }) } },
  });
  return { installed: (await manifests.findByKey(key))!, from, to, pruned, connectionId, created, reused, written };
}

/**
 * The old upgrade door: a newer version in place, and never a change to a
 * table. A version that would change one is refused; `updateAddOn` applies it.
 */
export async function upgradeAddOn(deps: AddOnInstallerDeps, input: Omit<UpdateAddOnInput, 'schema' | 'planChecksum' | 'host'>): Promise<{ installed: InstalledManifest; from: string; to: string; pruned: string[] }> {
  const { installed, from, to, pruned } = await updateAddOn(deps, { ...input, schema: 'refuse' });
  return { installed, from, to, pruned };
}

/** Remove the versions of `key` on disk older than `keep`; the ones removed. */
export async function pruneOlderVersions(deps: Pick<AddOnInstallerDeps, 'store'>, key: string, keep: string): Promise<string[]> {
  const pruned: string[] = [];
  for (const old of await deps.store.versions(key)) {
    if (compareSemver(old, keep) >= 0) continue;
    await deps.store.removeVersion(key, old);
    pruned.push(old);
  }
  return pruned;
}

/**
 * Mount an installed add-on on one more host, or switch it back on there.
 * Idempotent: attached and on already is no change.
 */
export async function attachAddOn(
  deps: AddOnInstallerDeps,
  input: { key: string; host: string; hostApp?: HostApp | undefined; actor: Actor; via?: string },
): Promise<{ installed: InstalledManifest; change: 'attached' | 'enabled' | null }> {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const installed = await manifests.findByKey(input.key);
  if (installed === null || installed.row.kind !== 'add-on') throw new NotFoundError(`"${input.key}" is not installed.`);
  const hosts = await hostsFor(deps, [input.host], input.hostApp === undefined ? [] : [input.hostApp]);
  const host = hosts[0]!;
  // A host is the dashboard or an app this server has; a link to a key
  // nothing answers to would wait there for whatever is installed under it.
  if (host.key !== DASHBOARD_HOST && host.tables === null) {
    throw new NotFoundError(`"${input.host}" is not an app installed here.`);
  }
  const { manifest } = parseAddOnDocument(installed.document, input.key, hosts, 'installed');
  const problems = hostProblems(manifest, hosts);
  refuseUnlessInstallable(input.key, { problems, installable: problems.length === 0 }, 'attached');

  /*
   * ATTACHING CREATES NOTHING. An add-on whose tables live in another app's
   * database would be mounted on a host where its tables are not; say so
   * rather than let its first write fail.
   */
  if ((manifest.requiredSchema?.tables ?? []).length > 0 && host.connectionId !== null) {
    const { plan } = await planAddOn(deps, manifest, { attachTo: [input.host], connectionId: host.connectionId });
    if (plan.create.length > 0) {
      throw new ValidationFailedError(
        `${manifest.name}’s tables are not in the database "${input.host}" reads, so it cannot be connected ` +
          'to it. Install it against that database instead.',
        { code: 'ADD_ON_OTHER_DATABASE', missing: plan.create.map((t) => t.ref) },
      );
    }
  }

  const existing = installed.attachments.find((a) => a.attachedTo === input.host);
  let change: 'attached' | 'enabled' | null = null;
  if (existing === undefined) {
    await manifests.attach(installed.row.id, input.host);
    change = 'attached';
  } else if (existing.disabledAt !== null) {
    await manifests.setAttachmentEnabled(installed.row.id, input.host, true);
    change = 'enabled';
  }
  if (change !== null) {
    await auditRepo(deps.meta).append({
      actorKind: 'user',
      actorId: input.actor.id,
      actorLabel: input.actor.label,
      category: 'add-on',
      action: change === 'attached' ? 'add-on.attached' : 'add-on.enabled',
      changes: {
        after: { key: input.key, attachedTo: input.host, ...(input.via === undefined ? {} : { via: input.via }) },
      },
    });
    await deps.rebuildRuntime?.();
  }
  return { installed: (await manifests.findByKey(input.key))!, change };
}
