// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE LANDING PAGES ADD-ONS OF AN INSTALL, WITH THEIR TABLES: each installed
 * add-on that declares `addOn.landing`, on the database it was installed on,
 * with its pages and funnels tables by their ids in that database's snapshot
 * and the column that keys each.
 *
 * What reads a pages add-on's own rows as the engine (a form's `landing`
 * ending, a funnel's rule, Milo's draft checking a link to another page)
 * finds them here, through the add-on's own record of each table: a table the
 * add-on no longer holds is not found. A pure read of what is installed:
 * nothing is written.
 */
import { landingOf, type AddOnLanding, type AddOnManifest } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';

import type { AddOnInstalls } from '../apps/table-ref.js';

/** One landing pages add-on on one database, with its tables (null: not there). */
export interface LandingAddOn {
  key: string;
  connectionId: string;
  manifest: AddOnManifest;
  version: string;
  /** Switched on for at least one place it is attached to. */
  on: boolean;
  block: AddOnLanding;
  /** The pages table's id, and the column that keys a page. */
  pages: string | null;
  pagesKey: string | null;
  /** The funnels table's id, and the column that keys a funnel. */
  funnels: string | null;
  funnelsKey: string | null;
}

/** The primary-key column of one of the add-on's own tables, by its manifest. */
export function primaryKeyOf(manifest: AddOnManifest, ref: string): string | null {
  const table = (manifest.requiredSchema?.tables ?? []).find((candidate) => candidate.ref === ref);
  return table?.columns.find((column) => column.role === 'pk')?.ref ?? null;
}

/** The landing pages add-on `key` on one database, or null when it is not installed there (or is being changed). */
export function landingAddOnOn(installs: AddOnInstalls, connectionId: string, key: string): LandingAddOn | null {
  const installed = installs.installed(connectionId, key);
  if (installed === null || installed.status !== 'installed') return null;
  const block = landingOf(installed.manifest);
  if (block === null) return null;
  return {
    key,
    connectionId,
    manifest: installed.manifest,
    version: installed.version,
    on: [...installed.hosts.values()].some(Boolean),
    block,
    pages: installs.tableOf(connectionId, key, block.pages),
    pagesKey: primaryKeyOf(installed.manifest, block.pages),
    funnels: installs.tableOf(connectionId, key, block.funnels),
    funnelsKey: primaryKeyOf(installed.manifest, block.funnels),
  };
}

/** Every installed landing pages add-on, with its install's id, oldest install first. */
export async function landingAddOns(meta: MetaDb, installs: AddOnInstalls): Promise<(LandingAddOn & { installId: string })[]> {
  const rows = await meta.db
    .selectFrom('adminium_manifests')
    .select(['id', 'manifestKey', 'connectionId'])
    .where('kind', '=', 'add-on')
    .where('status', '=', 'installed')
    .orderBy('installedAt')
    .orderBy('manifestKey')
    .execute();
  return rows.flatMap((row) => {
    const found = row.connectionId === null ? null : landingAddOnOn(installs, row.connectionId, row.manifestKey);
    return found === null ? [] : [{ ...found, installId: row.id }];
  });
}
