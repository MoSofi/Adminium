// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Getting an add-on from inside a Designer turn.
 *
 * The model names a KEY and nothing else: the name, the version and the file's
 * fingerprint come from the list this server cached from adminium.dev, and the
 * words a person reads are built here from that list. A yes runs what the
 * Add-ons page runs: its download job, then its installer. Nothing is fetched,
 * and no list is switched on, before a person who may change this server's
 * add-ons has said yes.
 */
import { auditRepo, jobsRepo, manifestsRepo, settingsRepo, type MetaDb } from '@adminium/meta';

import { CATALOG_ENABLED_SETTING, catalogSchema, isCurrentCatalogFormat, meetsMinimum, pickLocalized, type CatalogClient } from '../add-ons/catalog.js';
import { installAddOn, type AddOnInstallerDeps } from '../add-ons/install.js';
import { AppError } from '../errors.js';
import { enqueueAddOnDownload, enqueueCatalogRefresh } from '../jobs/add-on-acquire.js';
import type { Actor } from './tool-types.js';

/** What this server knows of an add-on, by its key. */
export type AddOnLook =
  /** Installed: there is nothing to get. */
  | { state: 'installed'; name: string; version: string }
  /** In this server's own store (bundled, uploaded, or downloaded before) and not installed. */
  | { state: 'here'; name: string; version: string; line: string; tables: number }
  /** In the list adminium.dev gave, and not on this server. */
  | { state: 'listed'; name: string; version: string; line: string }
  /** The list names it and this server is too old for it. */
  | { state: 'too-new'; name: string; needs: string }
  /** The list is on and does not name it. */
  | { state: 'unknown' }
  /** The list is off on this server: what it holds is not known. `vetoed` when the environment forbids it, so no switch can turn it on. */
  | { state: 'off'; vetoed: boolean };

export type GetAddOnResult = { ok: true; name: string; version: string } | { ok: false; why: string };

export interface AddOnGetter {
  look(key: string): Promise<AddOnLook>;
  /** Whether this person may add an add-on to this server (and switch its list on). */
  allowed(by: Actor): Promise<boolean>;
  /** Turn the list of adminium.dev on and read it, as the page's switch does. Nothing is downloaded. */
  switchOn(by: Actor, signal: AbortSignal): Promise<{ ok: true } | { ok: false; why: string }>;
  /** Download (when it is not here) and install, at the version the person was shown: a list that moved since is refused, not followed. */
  get(key: string, by: Actor, signal: AbortSignal, opts: { version: string; appKey?: string | undefined }): Promise<GetAddOnResult>;
}

export interface AddOnGetterDeps {
  meta: MetaDb;
  installer: AddOnInstallerDeps;
  catalog: CatalogClient;
  serverVersion: string;
  /** `manifests.manage`; on a live server, a Super Admin. */
  allowed(by: Actor): Promise<boolean>;
  /**
   * The database of the app a turn is building: where an add-on that keeps
   * tables of its own goes. The card has no picker, so on a project with two
   * databases this is the only way such an add-on has somewhere to go.
   */
  connectionFor?: ((appKey: string) => Promise<string | null>) | undefined;
  /** How long a job may take before the turn stops waiting for it. */
  jobTimeoutMs?: number;
  pollMs?: number;
}

const KEY = /^[a-z][a-z0-9-]{0,79}$/;

/** Why an add-on that is here was not installed, said as what the person does next. */
export function notInstalledInWords(name: string, error: unknown): string {
  const code = error instanceof AppError ? error.code : null;
  if (code === 'ADD_ON_SCHEMA_CONNECTION' || code === 'ADD_ON_OTHER_DATABASE') {
    return `${name} keeps its tables in one database, and this server has more than one. Tell the person to install it from Workspace settings → Add-ons, where they choose the database; then call the tool again.`;
  }
  if (code === 'ADD_ON_UNTRUSTED') {
    return `${name} was downloaded, and this server will not run its rules: the file is not one Adminium vouches for. Tell the person; build the rest of the app without it.`;
  }
  return `${name} was downloaded and could not be installed: ${error instanceof Error ? error.message : String(error)}`;
}

export function createAddOnGetter(deps: AddOnGetterDeps): AddOnGetter {
  const manifests = () => manifestsRepo(deps.meta, deps.installer.credentialCrypto);
  const { store } = deps.installer;

  /** The add-on in this server's store, newest version, read from its own manifest. */
  async function inStore(key: string): Promise<{ name: string; version: string; line: string; tables: number } | null> {
    try {
      const version = (await store.versions(key)).at(-1);
      if (version === undefined) return null;
      const document = JSON.parse((await store.readFile(key, version, 'manifest.json')).toString('utf8')) as { name?: unknown; description?: { fallback?: unknown }; requiredSchema?: { tables?: unknown } };
      return {
        name: typeof document.name === 'string' ? document.name : key,
        version,
        line: typeof document.description?.fallback === 'string' ? document.description.fallback : '',
        // The tables it keeps of its own, by its manifest: what the card says it adds.
        tables: Array.isArray(document.requiredSchema?.tables) ? document.requiredSchema.tables.length : 0,
      };
    } catch {
      return null;
    }
  }

  async function look(key: string): Promise<AddOnLook> {
    if (!KEY.test(key)) return { state: 'unknown' };
    const installed = await manifests().findByKey(key);
    if (installed !== null && installed.row.kind === 'add-on') {
      const document = (installed.document ?? {}) as { name?: unknown };
      return { state: 'installed', name: typeof document.name === 'string' ? document.name : key, version: installed.row.version };
    }
    const here = await inStore(key);
    if (here !== null) return { state: 'here', ...here };
    // A list that is off is not read, even where an older one is still on disk.
    if (!(await deps.catalog.isEnabled())) return { state: 'off', vetoed: !deps.catalog.networkFeaturesAllowed() };
    const cached = await store.readCatalogCache();
    if (cached === null || !isCurrentCatalogFormat(cached.document)) return { state: 'unknown' };
    const parsed = catalogSchema.safeParse(cached.document);
    if (!parsed.success) return { state: 'unknown' };
    const entry = parsed.data.addOns.find((addOn) => addOn.key === key);
    if (entry === undefined) return { state: 'unknown' };
    const name = pickLocalized(entry.name, 'en-US') ?? key;
    if (!meetsMinimum(entry.minAdminiumVersion, deps.serverVersion)) return { state: 'too-new', name, needs: entry.minAdminiumVersion };
    return { state: 'listed', name, version: entry.version, line: pickLocalized(entry.tagline, 'en-US') ?? '' };
  }

  /** Wait for a job this turn started (or joined). The turn's stop ends the wait; the job itself runs on. */
  async function follow(jobId: string, signal: AbortSignal): Promise<string | null> {
    const until = Date.now() + (deps.jobTimeoutMs ?? 120_000);
    for (;;) {
      if (signal.aborted) return 'The turn was stopped.';
      const job = await jobsRepo(deps.meta).findById(jobId);
      if (job === null) return 'The job is gone.';
      if (job.status === 'succeeded') return null;
      if (job.status === 'failed' || job.status === 'cancelled') return job.lastError ?? 'It did not finish.';
      if (Date.now() > until) return 'adminium.dev did not answer in time.';
      await new Promise((resolve) => setTimeout(resolve, deps.pollMs ?? 500));
    }
  }

  return {
    look,
    allowed: (by) => deps.allowed(by),
    async switchOn(by, signal) {
      if (!(await deps.allowed(by))) return { ok: false, why: 'This person may not switch this server’s add-on list on.' };
      if (!deps.catalog.networkFeaturesAllowed()) return { ok: false, why: 'This server is set to ask nothing of adminium.dev (ADMINIUM_NETWORK_FEATURES=off).' };
      if (!(await deps.catalog.isEnabled())) {
        // The page's switch, by the same person, kept in the same audit row.
        await settingsRepo(deps.meta).set(CATALOG_ENABLED_SETTING, true, { updatedBy: by.id });
        await auditRepo(deps.meta).append({
          actorKind: 'user',
          actorId: by.id,
          actorLabel: by.label,
          category: 'add-on',
          action: 'add-on.catalog-toggled',
          changes: { before: { onlineEnabled: false }, after: { onlineEnabled: true, from: 'designer' } },
        });
      }
      // No user on the job: with the app list on as well, one request fills both.
      const failed = await follow((await enqueueCatalogRefresh(deps.meta)).id, signal);
      return failed === null ? { ok: true } : { ok: false, why: `The list is on now, and it could not be read: ${failed}` };
    },
    async get(key, by, signal, opts) {
      // Asked again here: the person may have lost the permission between the card and its answer.
      if (!(await deps.allowed(by))) return { ok: false, why: 'This person may not add an add-on to this server.' };
      const found = await look(key);
      if (found.state === 'installed') return { ok: true, name: found.name, version: found.version };
      if (found.state === 'unknown') return { ok: false, why: `adminium.dev lists no add-on "${key}".` };
      if (found.state === 'too-new') return { ok: false, why: `${found.name} needs Adminium ${found.needs} or later; this server is ${deps.serverVersion}.` };
      if (found.state === 'off') return { ok: false, why: 'The list of adminium.dev is off on this server.' };
      // What the card showed is what is got: a list that moved between the card and the yes is not followed.
      if (found.version !== opts.version) {
        return { ok: false, why: `${found.name} is now at version ${found.version}, not the ${opts.version} the person was shown. Ask again, and the card will show the new one.` };
      }
      if (found.state === 'listed') {
        // The page's own job: the address and the fingerprint are the list's, checked again inside it.
        const job = await enqueueAddOnDownload(deps.meta, { key, version: found.version, userId: by.id ?? undefined });
        const failed = await follow(job.id, signal);
        if (failed !== null) return { ok: false, why: `${found.name} could not be downloaded: ${failed}` };
      }
      try {
        const connectionId = opts.appKey === undefined ? null : ((await deps.connectionFor?.(opts.appKey)) ?? null);
        // No public entry of the add-on is opened by this card: the app's own apply decides that, with the person's say.
        await installAddOn(deps.installer, { key, version: found.version, attachTo: [], ...(connectionId === null ? {} : { connectionId }), publicAccess: false, actor: { id: by.id, label: by.label } });
      } catch (error) {
        return { ok: false, why: notInstalledInWords(found.name, error) };
      }
      return { ok: true, name: found.name, version: found.version };
    },
  };
}
