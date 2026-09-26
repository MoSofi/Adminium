// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-ons an app names, as its install check, its install and its settings
 * page need them.
 *
 * An app's manifest says which add-ons it `requires`, which it `suggests`, and
 * which of its `features` stop without one. For each, this answers two things
 * kept apart, because the screen shows both ("Installed · v1.1.0 · Comes with
 * Adminium"):
 *
 *   state   attached | installed | outdated | absent | unavailable
 *   source  bundled (came with this Adminium) | catalog | upload
 *
 * and, for the install check, the add-on's OWN install plan — the tables it
 * creates or reuses and what stands in its way — because installing it with
 * the app is still installing it, and its consent is part of the app's.
 *
 * ─── The order of an install, and what survives a failure ──────────────────
 *
 * Everything that can refuse runs before anything is written: a required
 * add-on that cannot be had, one out of range that was not ticked to update,
 * one whose bytes are not on this server yet, one whose own plan is refused.
 * Then, after the app's row is written as `installing`, the add-ons go FIRST —
 * installed, updated or attached, into the app's own database — so a table
 * built on an add-on's shape and a foreign key into an add-on's table resolve
 * when the app's tables are made.
 *
 * A failure later in the app's install KEEPS the add-ons: they are shared, and
 * another app may already rely on one. "Try again" finds each add-on attached
 * and in range and does nothing to it; the steps an attempt took are written to
 * the app's audit log (`app.add-on-step`, with the install's row id), which is
 * where a resumed install's reply reads what was installed along the way.
 */
import {
  compareSemver,
  satisfiesSemverRange,
  type AddOnManifest,
  type AddOnNeeds,
  type Manifest,
} from '@adminium/manifest';
import { auditRepo, manifestsRepo, type InstalledManifest } from '@adminium/meta';

import { catalogSchema, isCurrentCatalogFormat, meetsMinimum, pickLocalized, type CatalogClient, type CatalogEntry } from '../add-ons/catalog.js';
import { bundledAddOnVersions } from '../add-ons/bundled.js';
import {
  DASHBOARD_HOST,
  addOnManifestFromStore,
  attachAddOn,
  attachRangeRefusal,
  declaresHost,
  hostProblems,
  hostsToAttach,
  installAddOn,
  parseAddOnDocument,
  planAddOn,
  pruneOlderVersions,
  upgradeAddOn,
  upgradeRangeRefusal,
  type Actor,
  type AddOnInstallerDeps,
  type HostApp,
} from '../add-ons/install.js';
import { featuresNeeding, needKindOf, needsOf, type AppNeed, type FeatureNeed, type NeedKind } from '../add-ons/needs.js';
import { AppError, ConflictError, ValidationFailedError } from '../errors.js';
import type { InstallPlanDto } from '../routes/add-ons/schema.js';

export interface AppAddOnDeps {
  installer: AddOnInstallerDeps;
  /** The online catalogue; absent or off, nothing is offered from it. */
  catalog?: CatalogClient | undefined;
  /** Where the bundled tarballs are; defaults to the boot seed's own rule. */
  bundledDir?: string | undefined;
  serverVersion: string;
}

export type AddOnState = 'attached' | 'installed' | 'outdated' | 'absent' | 'unavailable';
export type AddOnSource = 'bundled' | 'catalog' | 'upload';
export type AddOnAction = 'attach' | 'install' | 'update';

/** One add-on an app names, as the install check and the settings page show it. */
export interface AppAddOnRow {
  key: string;
  name: string;
  need: NeedKind;
  /** The versions the app works with. */
  range: string;
  /** Why the app wants it, in every language the app speaks. */
  reason: Readonly<Record<string, string>>;
  /** Ticked on the install check: always for a required add-on, as the manifest says for a suggestion. */
  checked: boolean;
  features: FeatureNeed[];
  state: AddOnState;
  /** Where the version it would run comes from; null when there is none. */
  source: AddOnSource | null;
  installedVersion: string | null;
  /** The version an install or "update it too" would bring; null when none in range is offered. */
  offeredVersion: string | null;
  /** Whether the INSTALLED version falls in the app's range. */
  satisfiesRange: boolean;
  /** Whether the offered version's bytes are on this server (else: download first). */
  staged: boolean;
  /** Attached to this app and switched on there. */
  enabled: boolean;
  /** What installing the app would do to it: nothing (null), attach, install or update. */
  action: AddOnAction | null;
  /** The other apps that name it. */
  usedBy: AppNeed[];
  /** Its own install plan, for an install or an update; null otherwise, or before its bytes are here. */
  plan: InstallPlanDto | null;
  /** What stands in the way; any one refuses the app's install when the add-on is required or ticked. */
  problems: { code: string; message: string }[];
}

/** Every version on offer for one key, newest first. */
interface Offer {
  version: string;
  source: AddOnSource;
  staged: boolean;
}

/** The cached feed's rows, when the catalogue is on and the cache is readable. */
async function feedRows(deps: AppAddOnDeps): Promise<Map<string, CatalogEntry>> {
  if (deps.catalog === undefined || !(await deps.catalog.isEnabled())) return new Map();
  const cached = await deps.installer.store.readCatalogCache();
  if (cached === null || !isCurrentCatalogFormat(cached.document)) return new Map();
  const parsed = catalogSchema.safeParse(cached.document);
  return parsed.success ? new Map(parsed.data.addOns.map((entry) => [entry.key, entry] as const)) : new Map();
}

/** What the server can reach for this add-on, and from where. */
async function offersFor(
  deps: AppAddOnDeps,
  key: string,
  bundled: ReadonlyMap<string, readonly string[]>,
  feed: ReadonlyMap<string, CatalogEntry>,
): Promise<Offer[]> {
  const listed = feed.get(key);
  const sourceOf = (version: string): AddOnSource =>
    (bundled.get(key) ?? []).includes(version) ? 'bundled' : listed?.version === version ? 'catalog' : 'upload';
  const offers: Offer[] = (await deps.installer.store.versions(key)).map((version) => ({
    version,
    source: sourceOf(version),
    staged: true,
  }));
  if (
    listed !== undefined &&
    !offers.some((offer) => offer.version === listed.version) &&
    meetsMinimum(listed.minAdminiumVersion, deps.serverVersion)
  ) {
    offers.push({ version: listed.version, source: 'catalog', staged: false });
  }
  return offers.sort((a, b) => compareSemver(b.version, a.version));
}

/** Where an INSTALLED version came from, as far as this server can tell. */
function sourceOfInstalled(
  key: string,
  version: string,
  bundled: ReadonlyMap<string, readonly string[]>,
  feed: ReadonlyMap<string, CatalogEntry>,
): AddOnSource {
  if ((bundled.get(key) ?? []).includes(version)) return 'bundled';
  return feed.get(key)?.version === version ? 'catalog' : 'upload';
}

/** The app as an attach host, before or after its row exists. */
export function appHost(manifest: Manifest, connectionId: string | null): HostApp {
  return {
    key: manifest.key,
    version: manifest.version,
    tables: (manifest.requiredSchema?.tables ?? []).map((table) => table.ref),
    connectionId,
  };
}

/** The add-ons an app manifest names. */
export function addOnNeedsOf(manifest: Manifest): AddOnNeeds | undefined {
  return manifest.kind === 'app' ? manifest.addOns : undefined;
}

/** A refusal's words, whatever threw it. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A refusal's code: the validator issue's when there is one, else the error's own. */
function codeOf(error: unknown): string {
  if (!(error instanceof AppError)) return 'ADD_ON_INVALID';
  const details = error.details as { code?: unknown; issues?: { code?: unknown }[] } | undefined;
  const issue = details?.issues?.find((entry) => typeof entry.code === 'string')?.code;
  if (typeof issue === 'string') return issue;
  return typeof details?.code === 'string' ? details.code : error.code;
}

/**
 * Every add-on the app names, resolved against this server.
 *
 * `withPlans` makes each add-on's own install plan (the install check); the
 * settings page leaves it off — a plan re-verifies the staged package.
 */
export async function resolveAppAddOns(
  deps: AppAddOnDeps,
  input: { manifest: Manifest; connectionId: string | null; withPlans: boolean },
): Promise<AppAddOnRow[]> {
  const needs = addOnNeedsOf(input.manifest);
  const named = [...(needs?.requires ?? []), ...(needs?.suggests ?? [])];
  if (named.length === 0) return [];
  const manifests = manifestsRepo(deps.installer.meta, deps.installer.credentialCrypto);
  const [bundled, feed] = await Promise.all([bundledAddOnVersions(deps.bundledDir), feedRows(deps)]);
  const app = input.manifest.key;
  const host = appHost(input.manifest, input.connectionId);
  const rows: AppAddOnRow[] = [];

  for (const entry of named) {
    const key = entry.key;
    const need = needKindOf(needs, key) ?? 'suggests';
    const installed = await manifests.findByKey(key);
    const isAddOn = installed !== null && installed.row.kind === 'add-on';
    const offers = await offersFor(deps, key, bundled, feed);
    const inRange = offers.filter((offer) => satisfiesSemverRange(offer.version, entry.range));
    const problems: { code: string; message: string }[] = [];
    let installedManifest: AddOnManifest | null = null;
    let name = pickLocalized(feed.get(key)?.name, 'en') ?? key;

    const row: AppAddOnRow = {
      key,
      name,
      need,
      range: entry.range,
      reason: entry.reason,
      checked: need === 'requires' || ('checked' in entry && entry.checked === true),
      features: featuresNeeding(needs, key),
      state: 'unavailable',
      source: null,
      installedVersion: null,
      offeredVersion: null,
      satisfiesRange: false,
      staged: false,
      enabled: false,
      action: null,
      usedBy: (await needsOf(deps.installer.meta, key)).filter((use) => use.app !== app),
      plan: null,
      problems,
    };

    if (installed !== null && !isAddOn) {
      problems.push({ code: 'ADD_ON_UNAVAILABLE', message: `"${key}" is an app on this server, not an add-on.` });
      rows.push(row);
      continue;
    }

    if (isAddOn) {
      const version = installed.row.version;
      row.installedVersion = version;
      row.satisfiesRange = satisfiesSemverRange(version, entry.range);
      const attachment = installed.attachments.find((a) => a.attachedTo === app);
      row.enabled = attachment !== undefined && attachment.disabledAt === null;
      try {
        installedManifest = parseAddOnDocument(installed.document, key).manifest;
        name = installedManifest.name;
        row.name = name;
      } catch (error) {
        problems.push({ code: 'ADD_ON_INVALID', message: messageOf(error) });
      }
      if (row.satisfiesRange) {
        row.state = row.enabled ? 'attached' : 'installed';
        row.action = row.enabled ? null : 'attach';
        row.source = sourceOfInstalled(key, version, bundled, feed);
        row.staged = true;
      } else {
        row.state = 'outdated';
        const newer = inRange.find((offer) => compareSemver(offer.version, version) > 0);
        if (newer === undefined) {
          problems.push({
            code: 'ADD_ON_OUT_OF_RANGE',
            message:
              `${input.manifest.name} works with ${name} ${entry.range}, and ${version} is installed. ` +
              'No version in that range is available on this server.',
          });
        } else {
          row.action = 'update';
          row.offeredVersion = newer.version;
          row.source = newer.source;
          row.staged = newer.staged;
        }
      }
    } else {
      const best = inRange[0];
      if (best === undefined) {
        row.state = 'unavailable';
        problems.push({
          code: 'ADD_ON_UNAVAILABLE',
          message:
            offers.length === 0
              ? `${name} isn’t available on this Adminium: it doesn’t come with it, and the add-on catalogue ` +
                'is off or has nothing for it. Upload it in Add-ons, or switch the catalogue on.'
              : `${input.manifest.name} works with ${name} ${entry.range}, and only ` +
                `${offers.map((offer) => offer.version).join(', ')} ${offers.length === 1 ? 'is' : 'are'} available here.`,
        });
      } else {
        row.state = 'absent';
        row.action = 'install';
        row.offeredVersion = best.version;
        row.source = best.source;
        row.staged = best.staged;
        // Its own name, from the package on disk: a read of one file, for a
        // label — the install re-verifies the whole tree before using it.
        if (best.staged) {
          try {
            const document = JSON.parse((await deps.installer.store.readFile(key, best.version, 'manifest.json')).toString('utf8')) as { name?: unknown };
            if (typeof document.name === 'string') row.name = document.name;
          } catch {
            // A label is not worth a refusal; the plan below reads it properly.
          }
        }
      }
    }

    // An add-on already mounted must still be one this app version may use.
    if (installedManifest !== null && row.action !== 'update') {
      for (const problem of hostProblems(installedManifest, [host])) problems.push({ code: problem.code, message: problem.message });
    }

    if (input.withPlans && problems.length === 0) {
      try {
        row.plan = await planFor(deps, row, installed, installedManifest, host, input.connectionId);
      } catch (error) {
        problems.push({ code: codeOf(error), message: messageOf(error) });
      }
      for (const problem of row.plan?.problems ?? []) problems.push({ code: problem.code, message: problem.message });
    }
    rows.push(row);
  }
  return rows;
}

/** The add-on's own plan for what installing the app would do to it. */
async function planFor(
  deps: AppAddOnDeps,
  row: AppAddOnRow,
  installed: InstalledManifest | null,
  installedManifest: AddOnManifest | null,
  host: HostApp,
  connectionId: string | null,
): Promise<InstallPlanDto | null> {
  const installer = deps.installer;
  if (row.action === 'install' && row.staged && row.offeredVersion !== null) {
    const first = await addOnManifestFromStore(installer, row.key, row.offeredVersion);
    const attachTo = hostsToAttach(first.manifest, [host.key]);
    const hosts = attachTo.map((key) => (key === host.key ? host : { key, version: null, tables: null, connectionId: null }));
    const { manifest, warnings } = parseAddOnDocument(first.document, row.key, hosts);
    return (
      await planAddOn(installer, manifest, {
        attachTo,
        hosts,
        ...(connectionId === null ? {} : { connectionId }),
        warnings,
      })
    ).dto;
  }
  if (row.action === 'update' && row.staged && row.offeredVersion !== null && installed !== null) {
    const attachedTo = [...new Set([...installed.attachments.map((a) => a.attachedTo), host.key])];
    const { manifest, warnings } = await addOnManifestFromStore(installer, row.key, row.offeredVersion);
    const declared = new Set(manifest.addOn.attaches.map((a) => a.app));
    const orphaned = declared.has('*') ? [] : installed.attachments.map((a) => a.attachedTo).filter((key) => !declared.has(key));
    const planned = await planAddOn(installer, manifest, {
      attachTo: installed.attachments.map((a) => a.attachedTo),
      hosts: [host],
      warnings,
    });
    const dto = planned.dto;
    const extra: InstallPlanDto['problems'] = [];
    if (orphaned.length > 0) {
      extra.push({ code: 'ATTACH_NOT_DECLARED', table: orphaned[0]!, message: `${manifest.name} ${manifest.version} no longer works with ${orphaned.join(', ')}.` });
    }
    const broken = await upgradeRangeRefusal(installer, manifest, attachedTo, { hosts: [host], except: host.key });
    if (broken !== null) extra.push({ code: broken.code, table: host.key, message: broken.message });
    if (dto.requiresSchemaChange) {
      extra.push({
        code: 'ADD_ON_NEEDS_TABLES',
        table: row.key,
        message: `${manifest.name} ${manifest.version} needs tables its installed version does not have; an update does not create them.`,
      });
    }
    return extra.length === 0 ? dto : { ...dto, installable: false, problems: [...dto.problems, ...extra] };
  }
  if (row.action === 'attach' && installed !== null && installedManifest !== null) {
    parseAddOnDocument(installed.document, row.key, [host]);
    if ((installedManifest.requiredSchema?.tables ?? []).length > 0 && connectionId !== null) {
      const { dto } = await planAddOn(installer, installedManifest, { attachTo: [host.key], connectionId });
      if (dto.create.length > 0) {
        return {
          ...dto,
          installable: false,
          problems: [
            ...dto.problems,
            {
              code: 'ADD_ON_OTHER_DATABASE',
              table: row.key,
              message: `${installedManifest.name}’s tables are not in this app’s database, so it cannot be connected to it.`,
            },
          ],
        };
      }
    }
    return null;
  }
  return null;
}

/** One step an install takes on an add-on. */
export interface AddOnStep {
  key: string;
  name: string;
  action: AddOnAction;
  version: string;
  /** The version it had, for an update. */
  from: string | null;
}

/** What the install body says about the add-ons. */
export interface AddOnChoice {
  key: string;
  version: string;
  update?: boolean | undefined;
}

/**
 * The steps an install will take on the app's add-ons, or the refusal — BEFORE
 * anything is written.
 *
 *  - A required add-on is always acted on: attached, or installed with the
 *    version on offer (it is part of the app), but UPDATED only when the body
 *    says `update: true` — an update changes an add-on other apps may use.
 *  - A suggested one only when the body names it.
 *  - A version named in the body must be the one offered (install, update) or
 *    installed (attach) — never a surprise.
 */
export function decideAddOnSteps(appName: string, rows: readonly AppAddOnRow[], choices: readonly AddOnChoice[]): AddOnStep[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const choice of choices) {
    if (!byKey.has(choice.key)) {
      throw new ValidationFailedError(`${appName} does not name the add-on "${choice.key}".`, {
        code: 'ADD_ON_NOT_NAMED',
        addOn: choice.key,
      });
    }
  }
  const steps: AddOnStep[] = [];
  for (const row of rows) {
    const choice = choices.find((c) => c.key === row.key);
    const required = row.need === 'requires';
    if (!required && choice === undefined) continue;
    const refuse = (message: string): never => {
      throw new AppError(422, required ? 'ADD_ON_REQUIRED' : 'ADD_ON_REFUSED', message, {
        addOn: row.key,
        name: row.name,
        range: row.range,
        state: row.state,
        installedVersion: row.installedVersion,
        offeredVersion: row.offeredVersion,
        problems: row.problems,
      });
    };
    if (row.state === 'unavailable') {
      refuse(required ? unavailableWords(appName, row) : `${row.name} isn’t available here.`);
    }
    if (row.state === 'outdated' && (row.action !== 'update' || choice?.update !== true)) {
      refuse(
        row.action === 'update'
          ? `${appName} needs ${row.name} ${row.range}, and ${row.installedVersion ?? '?'} is installed. Tick “Update it too” to update it with the app.`
          : noVersionWords(appName, row),
      );
    }
    if (row.problems.length > 0) refuse(problemsWords(appName, row));
    if (row.action === null) continue;
    const version = row.action === 'attach' ? row.installedVersion! : row.offeredVersion!;
    if (choice !== undefined && choice.version !== version) {
      throw new ConflictError(
        `${row.name} ${choice.version} is not what this install would ${row.action === 'attach' ? 'connect' : row.action}: ` +
          `${version} is. Check the install again.`,
        'SCHEMA_DRIFT',
        { addOn: row.key, expected: choice.version, actual: version },
      );
    }
    if (row.action !== 'attach' && !row.staged) {
      throw new AppError(409, 'ADD_ON_DOWNLOAD_REQUIRED', downloadWords(row, version), { addOn: row.key, version });
    }
    steps.push({ key: row.key, name: row.name, action: row.action, version, from: row.action === 'update' ? row.installedVersion : null });
  }
  return steps;
}

const unavailableWords = (appName: string, row: AppAddOnRow): string => `${appName} needs ${row.name}, which isn’t available here.`;

const noVersionWords = (appName: string, row: AppAddOnRow): string =>
  `${appName} needs ${row.name} ${row.range}, and no version in that range is available here.`;

const problemsWords = (appName: string, row: AppAddOnRow): string =>
  `${row.name} can’t be ${row.action === 'update' ? 'updated' : row.action === 'attach' ? 'connected' : 'installed'} with ${appName}: ` +
  row.problems.map((p) => p.message).join(' ');

const downloadWords = (row: AppAddOnRow, version: string): string =>
  `${row.name} ${version} is in the add-on catalogue but not on this server yet. Download it, then check the install again.`;

/**
 * What in the add-ons refuses the install WHATEVER its body says, as plan
 * problems (the table is the add-on's key) — so the plan's `installable`
 * agrees with the install that follows it.
 *
 * Only a REQUIRED add-on can hold the install this way: one that cannot be
 * had, one out of range with nothing in range here, one whose own plan is
 * refused, and one whose bytes are not on this server yet (downloading it is
 * a step of its own, after which the plan is asked again). A choice the body
 * makes — ticking a suggestion, "Update it too" — is not the plan's to guess:
 * a plan is installable when SOME install body goes through, and the rows say
 * which.
 */
export function addOnPlanProblems(appName: string, rows: readonly AppAddOnRow[]): { code: string; message: string; table: string }[] {
  const problems: { code: string; message: string; table: string }[] = [];
  for (const row of rows) {
    if (row.need !== 'requires') continue;
    const refusal =
      row.state === 'unavailable'
        ? unavailableWords(appName, row)
        : row.state === 'outdated' && row.action !== 'update'
          ? noVersionWords(appName, row)
          : row.problems.length > 0
            ? problemsWords(appName, row)
            : null;
    if (refusal !== null) {
      problems.push({ code: 'ADD_ON_REQUIRED', message: refusal, table: row.key });
    } else if ((row.action === 'install' || row.action === 'update') && !row.staged && row.offeredVersion !== null) {
      problems.push({ code: 'ADD_ON_DOWNLOAD_REQUIRED', message: downloadWords(row, row.offeredVersion), table: row.key });
    }
  }
  return problems;
}

/** The tables the app's required add-ons are about to create: the app's plan may point at them. */
export function tablesComingFromAddOns(rows: readonly AppAddOnRow[]): { ref: string; columns: { ref: string; isPrimaryKey: boolean }[] }[] {
  return rows
    .filter((row) => row.need === 'requires' && row.action === 'install' && row.plan !== null)
    .flatMap((row) =>
      row.plan!.create.map((table) => ({
        ref: table.ref,
        columns: table.columns.map((column) => ({ ref: column.ref, isPrimaryKey: column.type === 'id' })),
      })),
    );
}

/**
 * Table name → the installed add-on that declares it. An add-on's tables are
 * its own whoever else names them: an app may not rename one out of the way,
 * take it over, or drop it with itself. Nothing records which connection an
 * add-on's tables went to, so callers match these names against the tables
 * that are really there.
 */
export async function addOnTablesByName(installer: Pick<AddOnInstallerDeps, 'meta' | 'credentialCrypto'>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const installed of await manifestsRepo(installer.meta, installer.credentialCrypto).list('add-on')) {
    const tables = (installed.document as { requiredSchema?: { tables?: { ref?: unknown }[] } } | null)?.requiredSchema?.tables ?? [];
    for (const table of tables) {
      if (typeof table.ref === 'string' && !out.has(table.ref)) out.set(table.ref, installed.row.manifestKey);
    }
  }
  return out;
}

/** What the add-on half of an install did — the done line. */
export interface AddOnsDone {
  installed: { key: string; name: string; version: string }[];
  updated: { key: string; name: string; from: string; to: string }[];
  attached: { key: string; name: string; version: string }[];
}

/**
 * Take the steps, in order, recording each in the app's audit log with the
 * install's row id — the ledger a resumed install reads back.
 */
export async function runAddOnSteps(
  deps: AppAddOnDeps,
  input: { steps: readonly AddOnStep[]; host: HostApp; connectionId: string | null; actor: Actor; manifestRowId: string },
): Promise<AddOnsDone> {
  const done: AddOnsDone = { installed: [], updated: [], attached: [] };
  const via = `app:${input.host.key}`;
  for (const step of input.steps) {
    if (step.action === 'install') {
      await installAddOn(deps.installer, {
        key: step.key,
        version: step.version,
        attachTo: [input.host.key],
        hosts: [input.host],
        ...(input.connectionId === null ? {} : { connectionId: input.connectionId }),
        actor: input.actor,
        via,
      });
      done.installed.push({ key: step.key, name: step.name, version: step.version });
    } else if (step.action === 'update') {
      await upgradeAddOn(deps.installer, {
        key: step.key,
        to: step.version,
        actor: input.actor,
        via,
        hosts: [input.host],
        except: input.host.key,
        // Kept until the app's own install or update is done (see below).
        prune: false,
      });
      await attachAddOn(deps.installer, { key: step.key, host: input.host.key, hostApp: input.host, actor: input.actor, via });
      done.updated.push({ key: step.key, name: step.name, from: step.from ?? '', to: step.version });
    } else {
      await attachAddOn(deps.installer, { key: step.key, host: input.host.key, hostApp: input.host, actor: input.actor, via });
      done.attached.push({ key: step.key, name: step.name, version: step.version });
    }
    await auditRepo(deps.installer.meta).append({
      actorKind: 'user',
      actorId: input.actor.id,
      actorLabel: input.actor.label,
      category: 'app',
      action: 'app.add-on-step',
      changes: {
        after: {
          key: input.host.key,
          addOn: step.key,
          name: step.name,
          step: step.action,
          version: step.version,
          ...(step.from === null ? {} : { from: step.from }),
          manifestRowId: input.manifestRowId,
        },
      },
    });
  }
  return done;
}

/**
 * Once an app's install or update is DONE, the add-on versions older than the
 * installed ones go from disk — kept until then, so an update that stopped
 * part way leaves the version the running app works with where it can be put
 * back. Every add-on the app names, so a resumed update tidies what an
 * earlier attempt upgraded.
 */
export async function pruneNamedAddOns(installer: AddOnInstallerDeps, manifest: Manifest): Promise<void> {
  const needs = addOnNeedsOf(manifest);
  const manifests = manifestsRepo(installer.meta, installer.credentialCrypto);
  for (const key of new Set([...(needs?.requires ?? []), ...(needs?.suggests ?? [])].map((need) => need.key))) {
    const installed = await manifests.findByKey(key);
    if (installed === null || installed.row.kind !== 'add-on') continue;
    await pruneOlderVersions(installer, key, installed.row.version);
  }
}

/** The add-on steps earlier attempts of THIS install took, read back from the ledger. */
export async function stepsAlreadyTaken(deps: AppAddOnDeps, appKey: string, manifestRowId: string): Promise<AddOnsDone> {
  const done: AddOnsDone = { installed: [], updated: [], attached: [] };
  const entries = await auditRepo(deps.installer.meta).list({ category: 'app', limit: 500 });
  for (const entry of [...entries].reverse()) {
    if (entry.action !== 'app.add-on-step') continue;
    const after = (entry.changes as { after?: Record<string, unknown> } | null)?.after;
    if (after?.['key'] !== appKey || after['manifestRowId'] !== manifestRowId) continue;
    const key = String(after['addOn']);
    const name = String(after['name'] ?? key);
    const version = String(after['version']);
    if (after['step'] === 'install') done.installed.push({ key, name, version });
    else if (after['step'] === 'update') done.updated.push({ key, name, from: String(after['from'] ?? ''), to: version });
    else done.attached.push({ key, name, version });
  }
  return done;
}

/** Two ledgers as one done line, each add-on named once. */
export function mergeDone(a: AddOnsDone, b: AddOnsDone): AddOnsDone {
  const seen = new Set<string>();
  const keep = <T extends { key: string }>(list: T[]): T[] =>
    list.filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
  return {
    installed: keep([...a.installed, ...b.installed]),
    updated: keep([...a.updated, ...b.updated]),
    attached: keep([...a.attached, ...b.attached]),
  };
}

/**
 * An app update that would take an ATTACHED add-on outside its attach range:
 * refused, naming it, never silently detached. Only add-ons whose floor makes
 * their ranges binding count (see `RANGES_ENFORCED_ABOVE`).
 */
export async function attachedRangeRefusal(
  installer: Pick<AddOnInstallerDeps, 'meta' | 'credentialCrypto'>,
  appKey: string,
  newVersion: string,
): Promise<AppError | null> {
  const manifests = manifestsRepo(installer.meta, installer.credentialCrypto);
  for (const installed of await manifests.attachedToHost(appKey)) {
    let manifest: AddOnManifest;
    try {
      manifest = parseAddOnDocument(installed.document, installed.row.manifestKey).manifest;
    } catch {
      continue;
    }
    if (!declaresHost(manifest, appKey)) continue;
    const refusal = attachRangeRefusal(manifest, { key: appKey, version: newVersion });
    if (refusal !== null) {
      return new AppError(
        409,
        'ADD_ON_RANGE',
        `${refusal} Updating the app would leave it, so the update was not made. Update ${manifest.name} first.`,
        { addOn: manifest.key, app: appKey, version: newVersion },
      );
    }
  }
  return null;
}

/** The add-ons an uninstall keeps: every one attached to the app. */
export async function addOnsKeptBy(installer: Pick<AddOnInstallerDeps, 'meta' | 'credentialCrypto'>, appKey: string): Promise<{ key: string; name: string; version: string }[]> {
  const manifests = manifestsRepo(installer.meta, installer.credentialCrypto);
  return (await manifests.attachedToHost(appKey)).map((installed) => {
    const name = (installed.document as { name?: unknown } | null)?.name;
    return { key: installed.row.manifestKey, name: typeof name === 'string' ? name : installed.row.manifestKey, version: installed.row.version };
  });
}

/** Whether an app names any add-on at all — an app that names none installs exactly as before. */
export function namesAddOns(manifest: Manifest): boolean {
  const needs = addOnNeedsOf(manifest);
  return (needs?.requires ?? []).length + (needs?.suggests ?? []).length > 0;
}

export { DASHBOARD_HOST };
