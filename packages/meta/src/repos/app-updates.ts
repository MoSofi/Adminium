// SPDX-License-Identifier: AGPL-3.0-only
/**
 * appUpdatesRepo — adminium_app_updates (0078): an app update that moved its
 * version and has not finished writing what the version brings. One row per
 * install at most; it goes when the update finishes.
 */
import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { APP_UPDATE_STAGE_WIDTH, APP_UPDATE_VERSION_WIDTH } from '../migrations/0078_app_updates.js';
import type { AdminiumAppUpdatesTable } from '../schema/tables.js';
import { packJson, readJson } from './util.js';

export interface AppUpdate {
  manifestId: string;
  fromVersion: string;
  toVersion: string;
  /** The table refs the version before had. */
  fromTables: string[];
  /** The step it stopped at; null while it runs. */
  stoppedAt: string | null;
  startedAt: number;
  updatedAt: number;
}

function decode(row: Selectable<AdminiumAppUpdatesTable>): AppUpdate {
  return {
    manifestId: row.manifestId,
    fromVersion: row.fromVersion,
    toVersion: row.toVersion,
    fromTables: readJson<string[]>(row.fromTables),
    stoppedAt: row.stoppedAt,
    startedAt: Number(row.startedAt),
    updatedAt: Number(row.updatedAt),
  };
}

function fits(value: string, width: number, what: string): void {
  if (value.length > width) throw new Error(`${what} "${value.slice(0, 20)}…" is longer than its column (${String(width)})`);
}

export function appUpdatesRepo(meta: MetaDb) {
  const { db } = meta;
  return {
    async find(manifestId: string): Promise<AppUpdate | null> {
      const row = await db.selectFrom('adminium_app_updates').selectAll().where('manifestId', '=', manifestId).executeTakeFirst();
      return row === undefined ? null : decode(row);
    },

    /**
     * The update has moved the version: what it came from is kept until it
     * finishes. Written again by a second run of the same update, which keeps
     * the version it first came from.
     */
    async begin(input: { manifestId: string; fromVersion: string; toVersion: string; fromTables: readonly string[] }, at: number = Date.now()): Promise<AppUpdate> {
      fits(input.fromVersion, APP_UPDATE_VERSION_WIDTH, 'A version');
      fits(input.toVersion, APP_UPDATE_VERSION_WIDTH, 'A version');
      const held = await this.find(input.manifestId);
      if (held !== null) {
        await db.updateTable('adminium_app_updates').set({ toVersion: input.toVersion, stoppedAt: null, updatedAt: at }).where('manifestId', '=', input.manifestId).execute();
        return { ...held, toVersion: input.toVersion, stoppedAt: null, updatedAt: at };
      }
      await db
        .insertInto('adminium_app_updates')
        .values({ manifestId: input.manifestId, fromVersion: input.fromVersion, toVersion: input.toVersion, fromTables: packJson([...input.fromTables]), stoppedAt: null, startedAt: at, updatedAt: at })
        .execute();
      return { manifestId: input.manifestId, fromVersion: input.fromVersion, toVersion: input.toVersion, fromTables: [...input.fromTables], stoppedAt: null, startedAt: at, updatedAt: at };
    },

    /** Where it stopped, for the next run and for anyone who asks. */
    async stopped(manifestId: string, stage: string, at: number = Date.now()): Promise<void> {
      fits(stage, APP_UPDATE_STAGE_WIDTH, 'A step');
      await db.updateTable('adminium_app_updates').set({ stoppedAt: stage, updatedAt: at }).where('manifestId', '=', manifestId).execute();
    },

    /** Every unfinished update, for the list of installed apps to say which copies have one. */
    async list(): Promise<AppUpdate[]> {
      return (await db.selectFrom('adminium_app_updates').selectAll().orderBy('manifestId').execute()).map(decode);
    },

    /** The update finished: nothing is left to resume. */
    async finish(manifestId: string): Promise<void> {
      await db.deleteFrom('adminium_app_updates').where('manifestId', '=', manifestId).execute();
    },
  };
}
