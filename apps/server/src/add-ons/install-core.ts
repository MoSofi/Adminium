// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT THE ADD-ON INSTALLER ASKS OF WHOEVER CAN INSTALL "LIKE AN APP".
 *
 * An add-on that keeps tables of its own is installed the way an app is:
 * planned against a connection, its tables recorded and made, its pages,
 * roles and rules written, and all of it listed and removed again. The app
 * install service already does each of those. This file is the seam between
 * the two: types only, so the add-on installer never imports from `apps/`
 * (the arrow goes apps -> add-ons, and a cycle is refused by `check-deps`).
 * The app install service is the one answer; it is bound late, where the
 * server is put together.
 */
import type { InstallPlan, Manifest } from '@adminium/manifest';
import type { InstalledManifest } from '@adminium/meta';

import type { ExistingTable } from './install-ddl.js';

/** Who an install or update is done by. */
export interface InstallActor {
  /** The user's id, or null when no user stands behind it. */
  id: string | null;
  /** How the audit log names them. */
  label: string;
  /** `system` when no person stands behind it (an app applied from the project folder). A user when absent. */
  kind?: 'user' | 'system' | undefined;
  /** Whether they may open the row-ceiling door a schema edit can need. */
  superAdmin: () => Promise<boolean>;
  /** Whether they hold a permission; a server with no permission layer answers yes. */
  can: (permission: string) => Promise<boolean>;
}

/** What the helpers take from the server they run in. */
export interface InstallHost {
  log: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void };
  /** Tell open dashboards; absent where there is no realtime hub. */
  publish?: ((channel: 'config-changed', event: string, payload: Record<string, unknown>) => void) | undefined;
  /** Placement and status are what the surface gate reads; absent where nothing caches them. */
  invalidateSurfaceSettings?: (() => void) | undefined;
}

/** A checked set of tables, as `checkedPlan` answers it. The schema target is not part of the port. */
export interface CheckedTables {
  plan: InstallPlan;
  existing: readonly ExistingTable[];
  shapeRecords: ReadonlyMap<string, { builtOn: string; shapeColumns: string[] }>;
}

/** What a check answers that the installer reads; the rest of the reply is the route's to shape. */
export interface CoreCheck {
  checksum: string;
  installable: boolean;
  problems: readonly unknown[];
  create: readonly unknown[];
  reuse: readonly unknown[];
}

/** Whether an uninstall also deletes the tables it may, and who asks. */
export interface CoreDropOptions {
  dropTables: boolean;
  superAdmin: boolean;
}

/** What an uninstall would remove and keep. Opaque here: made by `listOf`, handed back to `checkDrop` and `remove`. */
export interface CoreUninstallList {
  key: string;
  connectionId: string | null;
  tables: readonly { droppable: boolean; record: { tableName: string } }[];
}

export interface InstallCore<List extends CoreUninstallList = CoreUninstallList> {
  planFor(manifest: Manifest, connectionId: string): Promise<{ plan: InstallPlan; dto: CoreCheck; existing: ExistingTable[] }>;
  checkedPlan(key: string, manifest: Manifest, connectionId: string, verb: 'installed' | 'updated', expectedChecksum?: string): Promise<CheckedTables>;
  /** Records the planned tables before any is made; answers the record id of each table still to make, by ref. */
  recordTables(input: { key: string; manifest: Manifest; rowId: string; connectionId: string; checked: CheckedTables; prefix: string | null }): Promise<ReadonlyMap<string, string>>;
  applyTables(
    checked: CheckedTables,
    manifest: Manifest,
    connectionId: string,
    opts: { superAdmin: boolean; createdBy: string | null },
    hooks?: { afterRenames?: () => Promise<void>; onCreated?: (ref: string) => Promise<void> },
  ): Promise<{ created: string[]; reused: string[] }>;
  createTables(
    key: string,
    manifest: Manifest,
    connectionId: string,
    verb: 'installed' | 'updated',
    opts: { superAdmin: boolean; createdBy: string | null },
    expectedChecksum?: string,
  ): Promise<{ created: string[]; reused: string[]; names: Record<string, string> }>;
  /** Rules, pages, roles, emails and public entries of a manifest; what each wrote is the reply's to shape. */
  writePages(
    actor: InstallActor,
    host: InstallHost,
    manifest: Manifest,
    rowId: string,
    connectionId: string | null,
    userId: string | null,
    strict?: boolean,
    names?: Readonly<Record<string, string>>,
    publicAccess?: boolean,
    grant?: true | { refusal: string },
    ownFolder?: boolean,
  ): Promise<Readonly<Record<string, unknown>> | undefined>;
  publicAccessOf(manifest: Manifest, connectionId: string, names: Readonly<Record<string, string>>, actor: InstallActor, installed?: boolean): Promise<unknown>;
  /**
   * The owner's document profiles, made or brought up to date with the
   * add-ons loaded as they are NOW. An add-on's install calls it once its own
   * code is loaded: what it prints for its own rows can be made only then.
   */
  makeDocuments(manifest: Manifest, connectionId: string, userId: string | null): Promise<unknown>;
  removals: {
    listOf(row: InstalledManifest): Promise<List>;
    checkDrop(list: List, opts: CoreDropOptions): Promise<void>;
    remove(list: List, opts: CoreDropOptions & { createdBy: string | null }): Promise<{ rulesRemoved: number; emailsRemoved: number; dropped: string[] }>;
  };
}
