// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REMOVING AN ADD-ON THAT KEEPS TABLES OF ITS OWN.
 *
 * It was installed the way an app is, so it is removed the way one is: its
 * pages nobody edited go (an edited one stays, as the owner's own page), its
 * roles go with their members' hold on them, the rules it wrote are taken
 * back while they are still as it wrote them, its emails and its document
 * layouts go. Its tables are KEPT, with every row, unless a Super Admin asks
 * for them to be dropped and types its key — and then only the ones it made.
 * A kept table's record is let go, so installing it again finds the same
 * tables, the same rows, the same ids.
 *
 * Everything that could refuse is asked BEFORE anything is removed. Then the
 * row leaves `installed` first, so nothing reads the add-on as live while its
 * parts go; a stop leaves it `updating`, and the same call finishes: every
 * step is safe to run twice.
 */
import { installsLikeAnApp, isAddOnManifest, validateManifest, type AddOnManifest } from '@adminium/manifest';
import { appTablesRepo, auditRepo, manifestsRepo, permissionsRepo, type InstalledManifest } from '@adminium/meta';

import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationFailedError } from '../errors.js';
import { deciderGate } from './decide.js';
import { addOnInUse } from './in-use.js';
import type { Actor, AddOnInstallerDeps } from './install.js';
import { pagesAreGated } from './page-gate.js';

export interface UninstallAddOnInput {
  key: string;
  /** Also delete the tables it made, with their rows. Super Admin only, and only with `confirmKey`. */
  dropTables?: boolean | undefined;
  /** The add-on's key, typed: what makes a drop deliberate. */
  confirmKey?: string | undefined;
  actor: Actor;
  /** Runs once its parts are gone and before its row goes: what else the server keeps for it (document profiles, settings). */
  beforeRowGoes?: (() => Promise<void>) | undefined;
}

export interface UninstallAddOnResult {
  key: string;
  version: string;
  /** False for an add-on that keeps no tables of its own: only its row and its package went, as always. */
  likeApp: boolean;
  removed: { pages: number; roles: number; rules: number; emails: number; endpoints: number; keys: number };
  kept: { pages: string[]; tables: string[] };
  dropped: string[];
  packageRemoved: boolean;
}

/** The stored manifest, when it still reads as an add-on's. */
function manifestOf(installed: InstalledManifest): AddOnManifest | null {
  const read = validateManifest(installed.document);
  return read.ok && isAddOnManifest(read.manifest) ? read.manifest : null;
}

/** Refuses a removal while a rule of the owner's, or a feature of an app, still hands rows to the add-on. */
async function refuseWhileInUse(deps: AddOnInstallerDeps, key: string): Promise<void> {
  const inUse = await addOnInUse(deps.meta, key);
  if (inUse.postings.length + inUse.features.length === 0) return;
  throw new AppError(
    409,
    'ADD_ON_IN_USE',
    `"${key}" can’t be removed while something still hands rows to it. Take those rules away, or switch those features off, first.`,
    {
      addOn: key,
      postings: inUse.postings.map((posting) => ({ table: posting.table.slice(posting.table.lastIndexOf('.') + 1), posting: posting.posting })),
      features: inUse.features.map((feature) => ({ app: feature.app, name: feature.appName, feature: feature.feature })),
    },
  );
}

/**
 * What a removal would take, keep and may drop — and what stands in its way.
 * Reads only.
 */
export async function addOnUninstallPlan(deps: AddOnInstallerDeps, key: string) {
  const installed = await manifestsRepo(deps.meta, deps.credentialCrypto).findByKey(key);
  if (installed === null || installed.row.kind !== 'add-on') throw new NotFoundError(`"${key}" is not installed.`);
  const manifest = manifestOf(installed);
  const core = deps.core?.() ?? null;
  const inUse = await addOnInUse(deps.meta, key);
  const likeApp = manifest !== null && installsLikeAnApp(manifest) && core !== null;
  const list = likeApp ? await core.removals.listOf(installed) : null;
  const listed = list as null | { pages?: { removed: { slug: string }[]; kept: { slug: string }[] }; roles?: { role: { slug: string }; members: unknown[] }[]; tables: readonly { droppable: boolean; record: { tableName: string } }[] };
  return {
    key,
    version: installed.row.version,
    likeApp,
    pages: { removed: (listed?.pages?.removed ?? []).map((page) => page.slug), kept: (listed?.pages?.kept ?? []).map((page) => page.slug) },
    roles: (listed?.roles ?? []).map((entry) => ({ slug: entry.role.slug, members: entry.members.length })),
    tables: (listed?.tables ?? []).map((entry) => ({ table: entry.record.tableName, droppable: entry.droppable })),
    inUse: {
      postings: inUse.postings.map((posting) => ({ table: posting.table.slice(posting.table.lastIndexOf('.') + 1), posting: posting.posting })),
      features: inUse.features.map((feature) => ({ app: feature.app, name: feature.appName, feature: feature.feature })),
    },
  };
}

export async function uninstallAddOn(deps: AddOnInstallerDeps, input: UninstallAddOnInput): Promise<UninstallAddOnResult> {
  const { key } = input;
  const manifests = manifestsRepo(deps.meta, deps.credentialCrypto);
  const installed = await manifests.findByKey(key);
  if (installed === null || installed.row.kind !== 'add-on') throw new NotFoundError(`"${key}" is not installed.`);
  const manifest = manifestOf(installed);
  const core = deps.core?.() ?? null;
  const likeApp = manifest !== null && installsLikeAnApp(manifest) && core !== null;
  const dropTables = input.dropTables === true;

  // Asked first, all of it: nothing below is undone.
  await refuseWhileInUse(deps, key);
  const superAdmin = (await input.actor.superAdmin?.()) ?? false;
  if (dropTables) {
    if (!likeApp) throw new ValidationFailedError(`"${key}" keeps no tables this server made for it, so there is nothing to drop.`, { reason: 'NOTHING_TO_DROP' });
    if (!superAdmin) throw new ForbiddenError('Deleting an add-on’s tables and data requires Super Admin.', 'FORBIDDEN', { reason: 'DROP_NEEDS_SUPER_ADMIN' });
    if (input.confirmKey !== key) throw new ValidationFailedError(`Type "${key}" to delete its tables and everything in them.`, { reason: 'CONFIRM_KEY_MISMATCH' });
  }
  const list = likeApp ? await core.removals.listOf(installed) : null;
  if (list !== null) await core!.removals.checkDrop(list, { dropTables, superAdmin });

  const result: UninstallAddOnResult = { key, version: installed.row.version, likeApp, removed: { pages: 0, roles: 0, rules: 0, emails: 0, endpoints: 0, keys: 0 }, kept: { pages: [], tables: [] }, dropped: [], packageRemoved: true };
  const work = async (): Promise<void> => {
    if (list !== null) {
      const listed = list as unknown as { pages: { removed: { slug: string }[]; kept: { slug: string }[] }; roles: unknown[]; endpoints: unknown[]; keys: unknown[] };
      const done = await core!.removals.remove(list, { dropTables, superAdmin, createdBy: input.actor.id });
      result.removed = { pages: listed.pages.removed.length, roles: listed.roles.length, rules: done.rulesRemoved, emails: done.emailsRemoved, endpoints: listed.endpoints.length, keys: listed.keys.length };
      result.kept.pages = listed.pages.kept.map((page) => page.slug);
      result.dropped = done.dropped;
      result.kept.tables = list.tables.map((entry) => entry.record.tableName).filter((name) => !done.dropped.includes(name));
      // A page of its own code has no page row: whoever was granted it by its ref — a role of the owner's too — holds nothing now.
      if (manifest !== null && pagesAreGated(manifest)) {
        for (const page of manifest.addOn.pages ?? []) await permissionsRepo(deps.meta).revokeAllForResource('page', page.ref);
      }
    } else if (installed.row.connectionId !== null) {
      // An add-on from before: its tables stay, as always; its records are let go so a reinstall finds them.
      const records = appTablesRepo(deps.meta);
      for (const record of await records.forInstall(installed.row.connectionId, key)) {
        if (record.state !== 'dropped') await records.setState(record.id, 'released');
        result.kept.tables.push(record.tableName);
      }
    }
    await input.beforeRowGoes?.();
    await manifests.uninstall(installed.row.id);
    // After the row: bytes left behind are untidy; an installed add-on whose code is gone would be broken.
    try {
      await deps.store.removeKey(key);
    } catch {
      result.packageRemoved = false;
    }
  };

  // Not live from the first step: nothing reads the add-on as installed while its parts go.
  const before = installed.row.status;
  await manifests.setStatus(installed.row.id, 'updating');
  try {
    const deciding = manifest !== null && (manifest.addOn.provides ?? []).some((provided) => provided.contract === 'posting-rows' || provided.contract === 'price-adjust');
    if (deciding) await deciderGate(key).write(work, { mark: false });
    else await work();
  } catch (error) {
    // The saves in flight did not finish in time: nothing was removed, so the row says what it said.
    if (error instanceof ConflictError && error.code === 'WRITE_CONFLICT') {
      await manifests.setStatus(installed.row.id, before as 'installed');
    }
    throw error;
  }

  await auditRepo(deps.meta).append({
    actorKind: input.actor.kind ?? 'user',
    actorId: input.actor.id,
    actorLabel: input.actor.label,
    category: 'add-on',
    action: 'add-on.uninstalled',
    changes: { after: { key, version: installed.row.version, packageRemoved: result.packageRemoved, tablesKept: result.dropped.length === 0, dropped: result.dropped, removed: result.removed } },
  });
  await deps.rebuildRuntime?.();
  return result;
}
