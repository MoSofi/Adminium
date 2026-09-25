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
  isAddOnManifest,
  planInstall,
  satisfiesSemverRange,
  validateManifest,
  type AddOnManifest,
  type InstallPlan,
  type Manifest,
} from '@adminium/manifest';
import { auditRepo, manifestsRepo, type InstalledManifest, type MetaDb } from '@adminium/meta';

import { AppError, ConflictError, NotFoundError, ValidationFailedError } from '../errors.js';
import type { InstallPlanDto } from '../routes/add-ons/schema.js';
import { needsOf } from './needs.js';
import type { AddOnSchemaTarget } from './schema-target.js';
import type { AddOnStore } from './store.js';

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
}

/** Who did it, for the audit rows. */
export interface Actor {
  id: string | null;
  label: string;
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
): { manifest: AddOnManifest; warnings: string[] } {
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
  deps: Pick<AddOnInstallerDeps, 'schemaTarget'>,
  manifest: AddOnManifest,
  input: { attachTo: readonly string[]; hosts?: readonly HostApp[]; connectionId?: string | undefined; warnings?: readonly string[] },
): Promise<AddOnPlanned> {
  const tables = (await deps.schemaTarget?.read(input.attachTo, input.connectionId)) ?? [];
  const pure = planInstall(manifest, { tables });
  const extra = hostProblems(manifest, input.hosts ?? []);
  const plan: InstallPlan = { ...pure, installable: pure.installable && extra.length === 0 };
  return { plan, dto: toDto(plan, extra, input.warnings ?? []) };
}

/** Reads and re-verifies a staged package, then parses its manifest. */
export async function addOnManifestFromStore(
  deps: Pick<AddOnInstallerDeps, 'store'>,
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
  return { ...parseAddOnDocument(document, key, hosts), document };
}

/** Refuse, by name, what a plan says stands in the way. */
function refuseUnlessInstallable(
  key: string,
  plan: { problems: readonly { code: string; message: string; table: string }[]; installable: boolean },
  verb: 'installed' | 'attached',
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
): Promise<{ installed: InstalledManifest; plan: InstallPlanDto; created: string[] }> {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const { key, version } = input;
  if ((await manifests.findByKey(key)) !== null) {
    throw new ConflictError(`"${key}" is already installed. Uninstall it first, or upgrade it instead.`);
  }

  // Read once to learn the hosts it adds; the document is then checked
  // against those hosts' tables.
  const first = await addOnManifestFromStore(deps, key, version);
  const attachTo = hostsToAttach(first.manifest, input.attachTo);
  const hosts = await hostsFor(deps, attachTo, input.hosts);
  const { manifest, warnings } = parseAddOnDocument(first.document, key, hosts);
  if (manifest.key !== key) {
    throw new ValidationFailedError(`The staged package declares key "${manifest.key}", not "${key}".`);
  }

  const { plan: rawPlan, dto: plan } = await planAddOn(deps, manifest, {
    attachTo,
    hosts,
    connectionId: input.connectionId,
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
    ({ created } = await deps.schemaTarget.apply(rawPlan, manifest, attachTo, input.connectionId));
  }

  const installed = await manifests.install({
    manifestKey: key,
    version,
    kind: 'add-on',
    source: 'marketplace',
    document: manifest,
    installedBy: input.actor.id,
    attachTo,
  });

  await auditRepo(deps.meta).append({
    actorKind: 'user',
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
        ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
        ...(input.via === undefined ? {} : { via: input.via }),
      },
    },
  });
  await deps.rebuildRuntime?.();
  return { installed, plan, created };
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
  return null;
}

/**
 * Upgrade an installed add-on to a newer staged version, in place: the hosts it
 * is mounted on and the credential it was given survive it.
 */
export async function upgradeAddOn(
  deps: AddOnInstallerDeps,
  input: {
    key: string;
    to?: string | undefined;
    actor: Actor;
    via?: string;
    /** Hosts as they will be once the caller is done (an app install or update in progress). */
    hosts?: readonly HostApp[];
    /** The app whose own install asks for this version (see {@link upgradeRangeRefusal}). */
    except?: string | undefined;
  },
): Promise<{ installed: InstalledManifest; from: string; to: string; pruned: string[] }> {
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const { key } = input;
  const installed = await manifests.findByKey(key);
  if (installed === null) throw new NotFoundError(`"${key}" is not installed.`);

  const from = installed.row.version;
  const newer = (await deps.store.versions(key)).filter((candidate) => compareSemver(candidate, from) > 0);
  const to = input.to === undefined ? newer[0] : newer.find((candidate) => candidate === input.to);
  if (to === undefined) {
    throw new NotFoundError(
      input.to === undefined
        ? `No newer version of "${key}" is staged. Download one first.`
        : `"${key}" ${input.to} is not staged here as a version newer than ${from}. Download it first.`,
    );
  }

  const attachedTo = installed.attachments.map((a) => a.attachedTo);
  const hosts = await hostsFor(deps, attachedTo, input.hosts);
  // Re-hash, re-validate: an upgrade cannot carry past the checks what an
  // install could not.
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

  const { dto: upgradePlan } = await planAddOn(deps, manifest, { attachTo: attachedTo });
  if (!upgradePlan.installable || upgradePlan.requiresSchemaChange) {
    throw new ValidationFailedError(`"${key}" ${to} cannot be applied to this instance.`, {
      problems: upgradePlan.problems,
      requiresSchemaChange: upgradePlan.requiresSchemaChange,
    });
  }

  await manifests.setVersion(installed.row.id, { version: to, document: manifest });

  // Older directories are pruned only AFTER the upgrade verified, so a failure
  // anywhere above leaves the running version on disk.
  const pruned: string[] = [];
  for (const old of await deps.store.versions(key)) {
    if (compareSemver(old, to) >= 0) continue;
    await deps.store.removeVersion(key, old);
    pruned.push(old);
  }

  await auditRepo(deps.meta).append({
    actorKind: 'user',
    actorId: input.actor.id,
    actorLabel: input.actor.label,
    category: 'add-on',
    action: 'add-on.upgraded',
    changes: { after: { key, from, to, pruned, ...(input.via === undefined ? {} : { via: input.via }) } },
  });
  await deps.rebuildRuntime?.();
  return { installed: (await manifests.findByKey(key))!, from, to, pruned };
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
  const { manifest } = parseAddOnDocument(installed.document, input.key, hosts);
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
