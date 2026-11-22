// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE A REVIEW COMES FROM: THE APP'S `review` WORD, AS INSTALLED.
 *
 * Only an app's manifest says a table's rows may be reviewed (the manifest
 * check refuses the word anywhere else), so the word is read from the app's
 * installed manifest, by the app's key and the table's own record: never
 * from anything a browser sends. Its table refs are mapped to the tables as
 * this database has them, through the app's own records of them.
 *
 * Reviews are on for the app while the add-on that keeps them is installed
 * here, attached to the app and switched on for it, its two tables are
 * there, and the word's feature (`needs`) is on.
 */
import { isAddOnManifest, validateManifest, type Review } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, realTableOf, type MetaDb } from '@adminium/meta';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { reviewsOf, type ReviewTables } from './tables.js';

const NO_SECRETS = {
  encrypt: (): string => {
    throw new Error('reading an app\'s review word never stores a credential');
  },
  decrypt: (): string => {
    throw new Error('reading an app\'s review word never reads a credential');
  },
};

/** A table's review word, with the app's tables as this database has them. */
export interface HostReview {
  app: string;
  word: Review;
  /** The reviewed table's ref in the app's manifest. */
  tableRef: string;
  /** A table of the app, by its ref; null when it is not here. */
  table: (ref: string) => ResolvedTable | null;
  /** The app's ref of one of its tables, by the table's id here (its name when the app keeps no record of it). */
  refOf: (table: ResolvedTable) => string;
  /** The keeping add-on's tables, while reviews are on for the app; null when they are off. */
  keeper: ReviewTables | null;
}

/** The review word of one table of an app, with its tables as this database has them; whether reviews are on is {@link hostReviewOf}'s. */
export async function reviewWordOf(meta: MetaDb, view: SnapshotView, appKey: string, tableId: string): Promise<Omit<HostReview, 'keeper'> | null> {
  const connectionId = view.connectionId;
  const records = (await appTablesRepo(meta).forConnection(connectionId)).filter((record) => record.appKey === appKey);
  const resolve = (real: string): ResolvedTable | null => {
    try {
      return view.table(real);
    } catch {
      return view.linkTable(real);
    }
  };
  const own = records.find((record) => resolve(realTableOf(record))?.id === tableId);
  if (own === undefined) return null;
  const entry = (await manifestsRepo(meta, NO_SECRETS).list('app')).find((one) => one.row.manifestKey === appKey && (one.row.connectionId === connectionId || one.row.connectionId === null) && (one.row.status === 'installed' || one.row.status === 'disabled'));
  if (entry === undefined) return null;
  const read = validateManifest(entry.document);
  if (!read.ok || isAddOnManifest(read.manifest)) return null;
  const word = read.manifest.requiredSchema?.tables.find((table) => table.ref === own.ref)?.review;
  if (word === undefined) return null;
  const table = (ref: string): ResolvedTable | null => {
    const record = records.find((one) => one.ref === ref);
    return record === undefined ? null : resolve(realTableOf(record));
  };
  const refOf = (of: ResolvedTable): string => records.find((record) => resolve(realTableOf(record))?.id === of.id)?.ref ?? of.name;
  return { app: appKey, word, tableRef: own.ref, table, refOf };
}

/** The review word of one table of an app, or null when the table carries none. */
export async function hostReviewOf(meta: MetaDb, installs: AddOnInstalls, view: SnapshotView, appKey: string, tableId: string): Promise<HostReview | null> {
  const host = await reviewWordOf(meta, view, appKey, tableId);
  if (host === null) return null;
  const connectionId = view.connectionId;
  const { word } = host;
  // On: the keeper here, attached to the app and switched on for it, its tables there, the word's feature on.
  const installed = installs.installed(connectionId, word.by.addOn);
  const block = installed === null ? null : reviewsOf(installed.manifest);
  const reviews = block === null ? null : installs.tableOf(connectionId, word.by.addOn, block.reviews);
  const totals = block === null ? null : installs.tableOf(connectionId, word.by.addOn, block.totals);
  const on =
    installed !== null &&
    installed.status === 'installed' &&
    installed.hosts.get(appKey) === true &&
    reviews !== null &&
    totals !== null &&
    (word.needs === undefined || installs.featureOn(connectionId, appKey, word.needs));
  return { ...host, keeper: on ? { connectionId, addOn: word.by.addOn, reviews: reviews!, totals: totals! } : null };
}
