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
import type { Kysely } from 'kysely';
import type { DatabaseModel, TableModel } from '@adminium/engine';
import type { AppManifest } from '@adminium/manifest';
import type { AppTableRecord, MetaDb, Page, Role } from '@adminium/meta';

import type { SourceDatabase } from '../../connections/manager.js';
import type { ReadLimits } from '../../rbac/read-limits.js';

import type { CheckList } from './check.js';

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
  /** A Files library file's bytes by its id (mail attachments, pictures, a logo); null when it is gone. Absent: no file travels. */
  readFile?: ((fileId: string) => Promise<Uint8Array | null>) | undefined;
  /** How the rows part reads the database and its pictures; absent: no rows can be saved. */
  rows?: RowAccess | undefined;
}

/** Rows a table carries. */
export interface RowChoice {
  mode: 'none' | 'starting' | 'sample';
  /** Over 200 starting rows: the saved view whose order and filters pick them. */
  viewId?: string | undefined;
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
  /** The app's icon, a lucide icon name. */
  icon?: string;
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
  /** Whether the deployment-wide part travels (look, languages, wording, edited system emails, plain settings). Default: no. */
  instance?: boolean;

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
  /** Check answers "leave out": `<kind>:<source id>` (`page:<pageId>`, `view:<viewId>`, `table:<tableId>`…), by id since names repeat. */
  leaveOut?: readonly string[];
  /** Check answers "keep": a warning the person says is no secret, `<kind>:<item>:<field>`. */
  keep?: readonly string[];
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
  /** The rows part says here what it carried, by table id. */
  carried: RowsCarried;
}

export type ConvertPart = (ctx: ConvertContext) => Promise<ManifestPart>;

/** How the rows part reads the source database and its Files library. */
export interface RowAccess {
  db: Kysely<SourceDatabase>;
  /** A file of the Files library by its id, or null when it is not there. Without it, pictures stay behind. */
  readFile?: (fileId: string) => Promise<{ bytes: Uint8Array; filename: string; mime: string } | null>;
  /**
   * Who saves: their read limits hide columns of the rows as their reads do.
   * Absent, the host's (the command line): it reads every column. A code no
   * staff member reads never travels for anybody.
   */
  reader?: { superAdmin?: boolean; readLimits?: ReadLimits | undefined } | undefined;
}

/** What the rows part carried that needs the saver's own rights ("Download again" asks the same). */
export interface RowsCarried {
  /** Rows, by model table id: the columns whose values travel (the key left out: every reader sees it). */
  rows: Record<string, string[]>;
  /** The tables whose ticked personal or secret-looking columns' values travel (reading personal data was asked). */
  personal: string[];
  /** Each of those tables' ref in the file, by model table id. */
  refs: Record<string, string>;
}

export interface SavedTable {
  /** The model's id (`public.orders`). */
  id: string;
  ref: string;
  model: TableModel;
  /** The file must carry `name` (the real name differs from the ref). */
  needsName: boolean;
  /** The file must carry `schema` (Postgres, not the default schema). */
  needsSchema: boolean;
}

export interface HeldTable {
  id: string;
  record: AppTableRecord;
}

export interface SaveRefs {
  /** The tables that travel, in model order. */
  tables(): readonly SavedTable[];
  /** Model table id → ref, or null when the table does not travel. */
  table(id: string): string | null;
  /** A real name (`orders`, `sales.orders`) or a model id → ref, or null. A bare name means the default schema. */
  tableByName(real: string): string | null;
  /** A table an install holds on this database (an add-on's, a catalog app's), by model id. */
  heldBy(id: string): HeldTable | null;
  /**
   * A column's ref in the file: its own name (`order_date`, `orderDate`).
   * Null for a name no file can carry (a dot, a colon, a leading digit): the
   * part that meets one says so in Check.
   */
  column(tableId: string, name: string): string | null;

  pages(): readonly { page: Page; ref: string }[];
  page(id: string): string | null;

  roles(): readonly { role: Role; key: string }[];
  role(id: string): string | null;

  /** An email template key → its name in the file, marking it used; null when no such template may travel. */
  useTemplate(key: string): string | null;
  usedTemplates(): readonly { key: string; name: string }[];
  /** The `<appkey>-<name>` the install will give a template name. */
  installedTemplateKey(name: string): string;

  /** An option list key → its name in the file, marking it used; null for a built-in list (`builtin:…`) or one an app owns. */
  useOptionList(key: string): string | null;
  usedOptionLists(): readonly { key: string; name: string }[];
}
