// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Put back the catalog apps and add-ons whose files are not on this server,
 * without a person: `POST /api/v1/operator/reinstall` (`operator/endpoint.ts`).
 *
 * WHEN THIS IS NEEDED. The meta store remembers every install; only the data
 * directory holds its files. An archive restore (`adminium archive restore`)
 * brings the installs back and never their packages (a copy is never trusted
 * from a file: it is fetched and checked again), and a host with no disk
 * empties the directory on every deploy. Either way Studio shows the install
 * as Missing until someone fetches it again.
 *
 * WHAT IT RUNS. The same work as Studio's Download button for a Missing
 * install, which is what that state needs: the install's tables, pages, roles
 * and settings are already in the meta store, and only its files are gone. So
 * each package is downloaded at the version that is installed, through the
 * download jobs' own functions (`downloadAddOnRelease`, `downloadAppRelease`):
 * the cached catalog's row (refreshed once when it lacks the package), its
 * minimum Adminium version, the download host, the integrity check and the
 * hardened unpack, audited as the operator. The install service is not run: it
 * would make the install over again, and refuses one that is there.
 *
 * Then what reads the store is told: the add-on runtime is built again, the
 * served apps are read again, and a copy of each package is kept where the
 * server keeps them, as at boot.
 *
 * One package failing never fails the call: each one is reported as put back,
 * already here, or failed with the reason. Add-ons go first, as apps may use
 * them. Calls never overlap: a second waits for the first and then finds what
 * it put back already here.
 */

import type { InstalledManifest } from '@adminium/meta';

import { addOnEntryFromCache, downloadAddOnRelease, refreshAddOnCatalog, type AddOnAcquireDeps } from '../jobs/add-on-acquire.js';
import { appEntryFromCache, downloadAppRelease, refreshAppCatalog, type AppAcquireDeps } from '../jobs/app-acquire.js';
import type { JobHandlerContext } from '../jobs/registry.js';

export type ReinstallKind = 'add-on' | 'app';

export interface ReinstallPackage {
  kind: ReinstallKind;
  key: string;
  version: string;
}

export interface ReinstallFailure extends ReinstallPackage {
  /** A refusal code (`UNKNOWN_APP`, `INTEGRITY_MISMATCH`, `CATALOG_DISABLED`, …), or `UNKNOWN`. */
  reason: string;
  message: string;
}

export interface ReinstallResult {
  reinstalled: ReinstallPackage[];
  present: ReinstallPackage[];
  failed: ReinstallFailure[];
}

/** One kind of package: where its files are, and how one is fetched. */
export interface ReinstallSide {
  kind: ReinstallKind;
  /** The store the files live in: a version listed here is on this server. */
  store: { versions(key: string): Promise<string[]> };
  installed(): Promise<readonly InstalledManifest[]>;
  /** Installs with no package at all (an app the project folder carries). */
  skip?: ((installed: InstalledManifest) => boolean) | undefined;
  catalogOn(): Promise<boolean>;
  /** Whether the cached catalog offers exactly this version. */
  offered(pkg: ReinstallPackage): Promise<boolean>;
  refresh(): Promise<void>;
  download(pkg: ReinstallPackage): Promise<void>;
  /** Called once when anything of this kind came back. */
  changed(): Promise<void>;
}

export interface PackageReinstallerDeps {
  /** In order: add-ons before apps. */
  sides: readonly ReinstallSide[];
  /** Waited on first: the boot's own seeding and restoring of packages, so this never races it. */
  ready?: (() => Promise<unknown>) | undefined;
  /** Keep a copy of a package that came back (`add-ons/package-copies.ts`). Never fatal. */
  keepCopy?: ((installed: InstalledManifest) => Promise<unknown>) | undefined;
  log: (message: string, data: Record<string, unknown>) => void;
}

export interface PackageReinstaller {
  reinstall(): Promise<ReinstallResult>;
}

/** A job context for running a job's work inline: nothing cancels it, nobody follows its progress. */
function inlineContext(): Pick<JobHandlerContext, 'jobId' | 'signal' | 'progress'> {
  return { jobId: 'operator-reinstall', signal: new AbortController().signal, progress: () => undefined };
}

const reasonOf = (error: unknown): string => {
  const reason = (error as { reason?: unknown; code?: unknown } | null)?.reason ?? (error as { code?: unknown } | null)?.code;
  return typeof reason === 'string' && reason !== '' ? reason : 'UNKNOWN';
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const offeredBy = async (find: () => Promise<unknown>): Promise<boolean> =>
  find().then(
    () => true,
    () => false,
  );

/** The add-on side, on the download job's own deps (`actorLabel` names who asked). */
export function addOnReinstallSide(
  acquire: AddOnAcquireDeps,
  extra: { installed: () => Promise<readonly InstalledManifest[]>; changed: () => Promise<void> },
): ReinstallSide {
  return {
    kind: 'add-on',
    store: acquire.store,
    installed: extra.installed,
    catalogOn: () => acquire.catalog.isEnabled(),
    offered: (pkg) => offeredBy(() => addOnEntryFromCache(acquire.store, pkg.key, pkg.version)),
    refresh: async () => {
      // No person asked: with the app list on too, both lists come in one request.
      await refreshAddOnCatalog(acquire, {}, inlineContext());
    },
    download: async (pkg) => {
      await downloadAddOnRelease(acquire, { key: pkg.key, version: pkg.version }, inlineContext());
    },
    changed: extra.changed,
  };
}

/** The app side, on the download job's own deps (`actorLabel` names who asked). */
export function appReinstallSide(
  acquire: AppAcquireDeps,
  extra: {
    installed: () => Promise<readonly InstalledManifest[]>;
    skip: (installed: InstalledManifest) => boolean;
    changed: () => Promise<void>;
  },
): ReinstallSide {
  return {
    kind: 'app',
    store: acquire.store,
    installed: extra.installed,
    skip: extra.skip,
    catalogOn: () => acquire.catalog.isEnabled(),
    offered: (pkg) => offeredBy(() => appEntryFromCache(acquire.store, pkg.key, pkg.version)),
    refresh: async () => {
      await refreshAppCatalog(acquire, {}, inlineContext());
    },
    download: async (pkg) => {
      await downloadAppRelease(acquire, { key: pkg.key, version: pkg.version }, inlineContext());
    },
    changed: extra.changed,
  };
}

export function createPackageReinstaller(deps: PackageReinstallerDeps): PackageReinstaller {
  let last: Promise<unknown> = Promise.resolve();

  async function run(): Promise<ReinstallResult> {
    await deps.ready?.();
    const result: ReinstallResult = { reinstalled: [], present: [], failed: [] };
    const cameBack: InstalledManifest[] = [];

    for (const side of deps.sides) {
      // One package per key and version: an install on several databases shares one set of files.
      const packages = new Map<string, { pkg: ReinstallPackage; rows: InstalledManifest[] }>();
      for (const installed of await side.installed()) {
        if (side.skip?.(installed) === true) continue;
        const pkg: ReinstallPackage = { kind: side.kind, key: installed.row.manifestKey, version: installed.row.version };
        const id = `${pkg.key}@${pkg.version}`;
        const seen = packages.get(id);
        if (seen === undefined) packages.set(id, { pkg, rows: [installed] });
        else seen.rows.push(installed);
      }

      const missing: { pkg: ReinstallPackage; rows: InstalledManifest[] }[] = [];
      for (const entry of packages.values()) {
        // As `packageIsInStore`: a store that cannot be read counts as "not here".
        const versions = await side.store.versions(entry.pkg.key).catch(() => [] as string[]);
        if (versions.includes(entry.pkg.version)) result.present.push(entry.pkg);
        else missing.push(entry);
      }
      if (missing.length === 0) continue;

      if (!(await side.catalogOn())) {
        for (const { pkg } of missing) {
          result.failed.push({
            ...pkg,
            reason: 'CATALOG_DISABLED',
            message: `The online ${side.kind === 'app' ? 'app' : 'add-on'} catalog is off on this server, so nothing can be downloaded.`,
          });
        }
        continue;
      }

      let refreshed: { ok: true } | { ok: false; error: unknown } | null = null;
      let any = false;
      for (const { pkg, rows } of missing) {
        try {
          // The catalog is read once, and only when what is cached lacks a package (a restored server has none cached).
          if (!(await side.offered(pkg))) {
            if (refreshed === null) {
              refreshed = await side.refresh().then(
                () => ({ ok: true as const }),
                (error: unknown) => ({ ok: false as const, error }),
              );
            }
            if (!refreshed.ok) throw refreshed.error;
          }
          await side.download(pkg);
          result.reinstalled.push(pkg);
          cameBack.push(...rows);
          any = true;
        } catch (error) {
          result.failed.push({ ...pkg, reason: reasonOf(error), message: messageOf(error) });
        }
      }

      if (any) {
        try {
          await side.changed();
        } catch (error) {
          deps.log('the server could not take up the packages the operator put back', { kind: side.kind, err: error });
        }
      }
    }

    for (const installed of cameBack) {
      try {
        await deps.keepCopy?.(installed);
      } catch (error) {
        deps.log('could not keep a copy of a package the operator put back', { key: installed.row.manifestKey, err: error });
      }
    }
    return result;
  }

  return {
    reinstall() {
      const next = last.then(run, run);
      last = next.catch(() => undefined);
      return next;
    },
  };
}
