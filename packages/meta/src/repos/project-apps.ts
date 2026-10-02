// SPDX-License-Identifier: AGPL-3.0-only
/**
 * projectAppsRepo — adminium_project_apps (wave 0049).
 *
 * One row per app a project folder carries: the manifest this instance last
 * applied, why the newest one was not, and a removal waiting for an answer.
 * The server decides what each means; this repo only stores them.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import type { AdminiumProjectAppsTable } from '../schema/tables.js';
import { packJson, readJson } from './util.js';

/** Why the folder's newest manifest was not applied. */
export interface ProjectAppFailure {
  /** The step it stopped at: `build`, `add-ons`, `tables`, `pages`, … */
  stage: string;
  message: string;
  /** The manifest it was about; the same one is not tried again. */
  hash: string;
  /**
   * Columns an earlier manifest declared and this one does not, which no
   * apply has dealt with yet. The installed document may already be the new
   * one, so the next apply could not work them out again.
   */
  owed?: { table: string; column: string }[];
}

/** One thing a manifest no longer declares that holds data. */
export interface ProjectAppRemovalChange {
  kind: 'table' | 'column' | 'narrow';
  /** The table's short name in the manifest it was last applied with. */
  table: string;
  /** The real table in the database. */
  tableName: string;
  column?: string;
  /** How many rows it holds (a table), hold a value (a column) or would not fit (a narrowing). */
  rows: number;
  /** For a narrowing: what would change, in words. */
  detail?: string;
}

/** A removal waiting for a person's answer. */
export interface ProjectAppRemovals {
  /** The manifest that asked. */
  hash: string;
  changes: ProjectAppRemovalChange[];
}

export interface ProjectAppRow {
  appKey: string;
  appliedHash: string | null;
  appliedAt: number | null;
  failure: ProjectAppFailure | null;
  removals: ProjectAppRemovals | null;
  declinedHash: string | null;
  updatedAt: number;
}

function decode(row: Selectable<AdminiumProjectAppsTable>): ProjectAppRow {
  return {
    appKey: row.appKey,
    appliedHash: row.appliedHash,
    appliedAt: row.appliedAt === null ? null : Number(row.appliedAt),
    failure: row.failure === null ? null : readJson<ProjectAppFailure>(row.failure),
    removals: row.removals === null ? null : readJson<ProjectAppRemovals>(row.removals),
    declinedHash: row.declinedHash,
    updatedAt: Number(row.updatedAt),
  };
}

export function projectAppsRepo(meta: MetaDb) {
  const { db } = meta;

  async function find(appKey: string): Promise<ProjectAppRow | null> {
    const row = await db.selectFrom('adminium_project_apps').selectAll().where('appKey', '=', appKey).executeTakeFirst();
    return row === undefined ? null : decode(row);
  }

  /** Write the given columns of one app's row, making the row when there is none. */
  async function write(
    appKey: string,
    values: {
      appliedHash?: string | null;
      appliedAt?: number | null;
      failure?: ProjectAppFailure | null;
      removals?: ProjectAppRemovals | null;
      declinedHash?: string | null;
    },
    at: number,
  ): Promise<void> {
    const set = {
      ...(values.appliedHash === undefined ? {} : { appliedHash: values.appliedHash }),
      ...(values.appliedAt === undefined ? {} : { appliedAt: values.appliedAt }),
      ...(values.failure === undefined ? {} : { failure: values.failure === null ? null : packJson(values.failure) }),
      ...(values.removals === undefined ? {} : { removals: values.removals === null ? null : packJson(values.removals) }),
      ...(values.declinedHash === undefined ? {} : { declinedHash: values.declinedHash }),
      updatedAt: at,
    };
    const updated = await db.updateTable('adminium_project_apps').set(set).where('appKey', '=', appKey).executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 0) {
      await db
        .insertInto('adminium_project_apps')
        .values({ appKey, appliedHash: null, appliedAt: null, failure: null, removals: null, declinedHash: null, ...set })
        .execute();
    }
  }

  return {
    find,

    async list(): Promise<ProjectAppRow[]> {
      const rows = await db.selectFrom('adminium_project_apps').selectAll().orderBy('appKey', 'asc').execute();
      return rows.map(decode);
    },

    /** This manifest is applied in full: nothing of it failed. */
    async setApplied(appKey: string, hash: string, at: number = Date.now()): Promise<void> {
      await write(appKey, { appliedHash: hash, appliedAt: at, failure: null }, at);
    },

    /**
     * This manifest was not applied, and why. What was applied before stays
     * recorded, unless the apply stopped after the installed document moved:
     * then nothing is applied in full, and the manifest that was is applied
     * again when the folder goes back to it.
     */
    async setFailure(
      appKey: string,
      failure: ProjectAppFailure,
      at: number = Date.now(),
      opts: { nothingApplied?: boolean } = {},
    ): Promise<void> {
      await write(appKey, { failure, ...(opts.nothingApplied === true ? { appliedHash: null, appliedAt: null } : {}) }, at);
    },

    /** A removal that waits for an answer, or none. */
    async setRemovals(appKey: string, removals: ProjectAppRemovals | null, at: number = Date.now()): Promise<void> {
      await write(appKey, { removals }, at);
    },

    /** The answer was "keep the data": the question goes, and this manifest does not ask again. */
    async decline(appKey: string, hash: string, at: number = Date.now()): Promise<void> {
      await write(appKey, { removals: null, declinedHash: hash }, at);
    },

    /** Forget an app: it was uninstalled. */
    async remove(appKey: string): Promise<void> {
      await db.deleteFrom('adminium_project_apps').where('appKey', '=', appKey).execute();
    },
  };
}
