// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a project's `hooks/*.ts` and `actions/*.ts` files import from
 * `@adminiumjs/adminium`: `defineHook`, `defineAction` and their types.
 *
 * Project code is the owner's own code. It runs inside the server with full
 * access, the way a Strapi or Directus extension does, and it is never loaded
 * by the desktop app or by `adminium try`.
 */

import type { Kysely } from 'kysely';

// A project's rows are untyped unless the project types them, and hook code
// such as `values.qty * values.price` has to compile without casts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecord = Record<string, any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawDatabase = Kysely<any>;

/** A record's key: the value of a one-column primary key, or `{ column: value }` for several. */
export type RecordId = string | number | Readonly<Record<string, string | number>>;

type Awaitable<T> = T | Promise<T>;

/** Where a change came from. */
export type ChangeOrigin =
  | 'dashboard'
  | 'bulk'
  | 'undo'
  | 'public'
  | 'automation'
  | 'import'
  | 'hook'
  | 'action';

/** Who made a change, or clicked an action. */
export interface ProjectUser {
  kind: 'user' | 'api-key' | 'public' | 'automation' | 'system';
  /** The user, API key or automation id; null for the public API. */
  id: string | null;
  name: string;
}

/** Lines in the server log, tagged with the file that wrote them. */
export interface ProjectLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface ListOptions<R extends AnyRecord = AnyRecord> {
  /** Rows whose columns equal these values. */
  where?: Partial<R>;
  /** The column to sort by; a leading `-` sorts descending. */
  orderBy?: string;
  /** 100 when unset, 1000 at most. */
  limit?: number;
  offset?: number;
}

/**
 * One table, read and written the way the dashboard does: writes run the
 * project's hooks, go into the audit trail and start automations.
 */
export interface ProjectTable<R extends AnyRecord = AnyRecord> {
  get(id: RecordId): Promise<R | null>;
  list(options?: ListOptions<R>): Promise<R[]>;
  insert(values: Partial<R>): Promise<R>;
  /** The row after the change, or null when there is no such row. */
  update(id: RecordId, values: Partial<R>): Promise<R | null>;
  /** False when there was no such row. */
  delete(id: RecordId): Promise<boolean>;
}

export interface ProjectDb {
  /** A table of this code's database, or of another one named in `adminium.config.ts`. */
  table<R extends AnyRecord = AnyRecord>(name: string, options?: { database?: string }): ProjectTable<R>;
  /**
   * Kysely for this code's database. Queries made here skip hooks, the audit
   * trail and automations.
   */
  readonly raw: RawDatabase;
  /** Kysely for another database in `adminium.config.ts`. Skips the same things. */
  rawFor(database: string): Promise<RawDatabase>;
}

interface HookArgs {
  /** The database key from `adminium.config.ts`. */
  database: string;
  /** The table, as the database names it, such as `public.orders`. */
  table: string;
  /** Who made the change; null when nobody signed in did (the public API). */
  user: ProjectUser | null;
  origin: ChangeOrigin;
  db: ProjectDb;
  log: ProjectLogger;
  /** Aborted when the hook runs past its time limit. */
  signal: AbortSignal;
}

interface Rejectable {
  /** Stop the change. The message is shown to the person who made it. */
  reject(message: string): never;
}

export interface BeforeCreateArgs<R extends AnyRecord = AnyRecord> extends HookArgs, Rejectable {
  /** The values about to be saved. Change them here. */
  values: Partial<R>;
}

export interface BeforeUpdateArgs<R extends AnyRecord = AnyRecord> extends HookArgs, Rejectable {
  /** The values about to be saved: only the columns that change. Change them here. */
  values: Partial<R>;
  /** The record as it is now. */
  record: R;
}

export interface BeforeDeleteArgs<R extends AnyRecord = AnyRecord> extends HookArgs, Rejectable {
  record: R;
}

export interface AfterCreateArgs<R extends AnyRecord = AnyRecord> extends HookArgs {
  record: R;
}

export interface AfterUpdateArgs<R extends AnyRecord = AnyRecord> extends HookArgs {
  record: R;
  /** The record before the change. */
  before: R;
}

export interface AfterDeleteArgs<R extends AnyRecord = AnyRecord> extends HookArgs {
  /** The record that was deleted. */
  record: R;
}

export interface HookDefinition<R extends AnyRecord = AnyRecord> {
  /** The table, such as `orders`, or `sales.orders` outside the default schema. */
  table: string;
  /** The database key from `adminium.config.ts`. Default `main`. */
  database?: string;
  /** Also run the after hooks for rows a CSV import writes. Before hooks always run. */
  onImport?: boolean;
  /** Time limits in milliseconds: 5,000 before a change and 30,000 after it by default. */
  timeout?: { before?: number; after?: number };
  beforeCreate?(args: BeforeCreateArgs<R>): Awaitable<void>;
  beforeUpdate?(args: BeforeUpdateArgs<R>): Awaitable<void>;
  beforeDelete?(args: BeforeDeleteArgs<R>): Awaitable<void>;
  afterCreate?(args: AfterCreateArgs<R>): Awaitable<void>;
  afterUpdate?(args: AfterUpdateArgs<R>): Awaitable<void>;
  afterDelete?(args: AfterDeleteArgs<R>): Awaitable<void>;
}

export type HookEvent =
  | 'beforeCreate'
  | 'beforeUpdate'
  | 'beforeDelete'
  | 'afterCreate'
  | 'afterUpdate'
  | 'afterDelete';

export const HOOK_EVENTS: readonly HookEvent[] = [
  'beforeCreate',
  'beforeUpdate',
  'beforeDelete',
  'afterCreate',
  'afterUpdate',
  'afterDelete',
];

export interface ActionArgs<R extends AnyRecord = AnyRecord> {
  /** The record the action runs on; the first one when several are selected. */
  record: R;
  /** Every selected record. One, unless the action sets `bulk`. */
  records: R[];
  database: string;
  table: string;
  user: ProjectUser;
  db: ProjectDb;
  log: ProjectLogger;
  /** Aborted when the action runs past its time limit. */
  signal: AbortSignal;
  /** Stop with a message for the person who clicked. Changes already made stay. */
  fail(message: string): never;
}

export interface ActionResult {
  /** Shown to the person who clicked. */
  message?: string;
  /** Reload the page's data afterwards. Default true. */
  refresh?: boolean;
}

export type ActionPermission = 'read' | 'create' | 'update' | 'delete';

export interface ActionDefinition<R extends AnyRecord = AnyRecord> {
  /** The table whose records get the button. */
  table: string;
  /** The database key from `adminium.config.ts`. Default `main`. */
  database?: string;
  /** The button's text. */
  label: string;
  /** A Lucide icon name, such as `undo-2`. */
  icon?: string;
  /** A question asked before the action runs. */
  confirm?: string;
  /** The table permission a person needs to see and run it. Default `update`. */
  permission?: ActionPermission;
  /** Also offer the action for several selected rows. */
  bulk?: boolean;
  /** Time limit in milliseconds. Default 60,000. */
  timeout?: number;
  run(args: ActionArgs<R>): Awaitable<ActionResult | undefined | void>;
}

/** Types a hook file's default export; returns it unchanged. */
export function defineHook<R extends AnyRecord = AnyRecord>(definition: HookDefinition<R>): HookDefinition<R> {
  return definition;
}

/** Types an action file's default export; returns it unchanged. */
export function defineAction<R extends AnyRecord = AnyRecord>(definition: ActionDefinition<R>): ActionDefinition<R> {
  return definition;
}
