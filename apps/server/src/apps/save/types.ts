// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP: THE SHAPES EVERY PART SHARES.
 *
 * Saving turns what a person built on ONE database into an ordinary app file
 * (`publisher: local`): its tables, pages, roles, rules, mails, documents,
 * saved parts, public access, payments setup and, when chosen, rows. The
 * installer is the inverse of every part here, and the file a save writes must
 * pass the same checks an upload meets.
 *
 * The converter runs in parts (`tables.ts`, `pages.ts`, …). Each part reads
 * the meta store and the database's model, writes its own blocks of the
 * manifest, adds the package files it needs and says, in the Check list, what
 * it could not carry. A part never writes a value it was not told to copy: an
 * allow-list per kind, everything else dropped (the secret rule).
 */
import type { DatabaseModel } from '@adminium/engine';
import type { AppManifest } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';

import type { CheckList } from './check.js';
import type { SaveRefs } from './refs.js';

export type SaveDialect = 'postgres' | 'mysql' | 'sqlite';

/** What is saved: one database's configuration and its latest model. */
export interface SaveSource {
  meta: MetaDb;
  connectionId: string;
  dialect: SaveDialect;
  /** The raw latest model, overrides NOT applied (`snapshotsRepo.latest` + `parseDatabaseModel`). */
  model: DatabaseModel;
  /** The running Adminium version, stamped as `minAdminiumVersion` when a page carries an envelope or views. */
  adminiumVersion: string;
}

/** Rows a table carries. */
export interface RowChoice {
  mode: 'none' | 'starting' | 'sample';
  /** Over 200 starting rows: the saved view whose order and filters pick them. */
  viewId?: string;
}

/**
 * What the person chose. Every list is optional: absent means the quick
 * save's default (everything on the database that may travel). Ids are the
 * source's own (model table ids, page ids, role ids…); they never reach the
 * file.
 */
export interface SaveChoices {
  /** The app's key, name and version. */
  key: string;
  name: string;
  version: string;
  description?: string;
  /** Where it was made, shown on the target ("Made at <label>"). Never a hostname. */
  label: string;
  /** The lineage drawn at the first save of this dashboard, else drawn now. */
  lineage: string;
  /** ISO time of the save. */
  savedAt: string;

  tables?: readonly string[];
  pages?: readonly string[];
  roles?: readonly string[];
  automations?: readonly string[];
  /** Template keys of campaigns (and other templates no rule names) to carry. */
  emailTemplates?: readonly string[];
  documents?: readonly string[];
  reports?: readonly string[];
  invoiceLayouts?: readonly string[];
  scheduledReports?: readonly string[];
  publicEndpoints?: readonly string[];
  /** Whether the payments setup travels. Default: yes when one exists. */
  payments?: boolean;

  /** Rows per table, by model table id. Default: none. */
  rows?: Readonly<Record<string, RowChoice>>;
  /** `<tableId>.<column>` with no manifest form the person chose to carry as text; the rest are left out. */
  carryAsText?: readonly string[];
  /** `<tableId>.<column>` of personal or secret-looking columns whose ROWS the person ticked. */
  personalColumns?: readonly string[];
  /** Personal view ids the person chose to make shared views of the app. */
  shareViews?: readonly string[];
  /** Check answers "clear this field": `<kind>:<item>:<field>`, as a hit names it. */
  clear?: readonly string[];
  /** Check answers "leave out": `<kind>:<item>`. */
  leaveOut?: readonly string[];
}

/** The blocks of the manifest one part writes. Parts write disjoint keys; `convert.ts` refuses an overlap. */
export type ManifestPart = Partial<AppManifest>;

/** What every part is handed. */
export interface ConvertContext {
  source: SaveSource;
  choices: SaveChoices;
  /** Source id → the ref, key or name it has in the file. Built once, before any part runs. */
  refs: SaveRefs;
  check: CheckList;
  /** Package files beside `manifest.json`, by their path in the package (`seeds/orders.json`, `emails/logo.png`). */
  files: Map<string, Uint8Array>;
}

export type ConvertPart = (ctx: ConvertContext) => Promise<ManifestPart>;
