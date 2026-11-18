// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FINDING A CHAT: which installed live chat add-on a visitor's address names
 * (`/x/chat/<add-on>`), with its tables and its settings.
 *
 * A chat lives in a chat add-on's own tables (the add-on block's `chat` word
 * names them, `@adminium/manifest` `chatOf`), on the add-on's own
 * connection. The engine reads and writes them there for a visitor; no
 * add-on code runs. An add-on key finds a chat only when all of this holds:
 *
 *  - an add-on with that key that declares `addOn.chat` is installed (status
 *    `installed`) on a connection, and switched on for at least one place it
 *    is attached to;
 *  - its package is vouched for (`vouched`: the trust the sandboxed deciders
 *    need, `forms/vouched.ts`); a package uploaded by hand serves nothing;
 *  - its four tables and its settings table are there, each with a single
 *    numbered key;
 *  - the privacy notice is set (a public chat is refused until it is).
 *
 * Everything else answers one same "not available", so the answer never
 * tells which add-ons are installed.
 *
 * A lookup and the settings row it read are kept for at most
 * {@link CHAT_CACHE_MS}: a window's config, its polls and its posts ask
 * within moments. Conversations and messages are never kept here: the store
 * (`store.ts`) reads them.
 */
import { chatOf, type AddOnChat, type AddOnManifest } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { WriteTarget } from '../crud/write-service.js';
import { privacyNoticeReady } from '../privacy/business.js';
import { readChatSettings, type ChatSettings } from './settings.js';

/** The longest a lookup is kept. */
export const CHAT_CACHE_MS = 5_000;
/** The most add-on keys kept at once: a flood of made-up keys cannot grow the cache past this. */
const CACHE_MAX = 200;
/** An add-on key as a manifest may spell one. */
const ADD_ON_KEY = /^[a-z][a-z0-9-]{1,79}$/;

/** One of a chat's tables, with its single key column. */
export interface ChatTable {
  table: ResolvedTable;
  pk: string;
}

/** A chat as the engine serves and writes it. */
export interface LiveChat {
  addOn: string;
  /** The add-on's install (`adminium_manifests.id`): what the answerer's daily tally is kept by. */
  installId: string;
  /** Its name, as its manifest gives it. */
  name: string;
  version: string;
  connectionId: string;
  manifest: AddOnManifest;
  block: AddOnChat;
  conversations: ChatTable;
  messages: ChatTable;
  answers: ChatTable;
  choices: ChatTable;
  settingsTable: ChatTable;
  /** The settings row, read when the lookup was made. */
  settings: ChatSettings;
  view: SnapshotView;
  db: Kysely<SourceDatabase>;
  dialect: WriteTarget['dialect'];
}

export type ChatLookup = { state: 'live'; chat: LiveChat } | { state: 'unavailable' };

/** What a vouching decision is asked about. */
export interface ChatPackage {
  key: string;
  version: string;
  manifest: AddOnManifest;
}

export interface ChatCatalogDeps {
  meta: MetaDb;
  /** What is installed where, read fresh (`keepAddOnInstalls`). */
  installs: () => Promise<AddOnInstalls>;
  /** A database's handle. */
  data: (connectionId: string) => Promise<{ db: Kysely<SourceDatabase>; dialect: WriteTarget['dialect'] }>;
  /** A database's snapshot, read as the routes read it. */
  viewFor: (connectionId: string) => Promise<SnapshotView | null>;
  /** Whether a package that declares chat may serve it: the same trust the sandboxed deciders need. */
  vouched: (pkg: ChatPackage) => boolean | Promise<boolean>;
  now?: () => number;
}

/** A table of the add-on's own, with one key column; null when it is not there or has no single key. */
function chatTable(installs: AddOnInstalls, view: SnapshotView, connectionId: string, addOn: string, ref: string | undefined): ChatTable | null {
  if (ref === undefined) return null;
  const id = installs.tableOf(connectionId, addOn, ref);
  if (id === null) return null;
  let table: ResolvedTable;
  try {
    table = view.table(id);
  } catch {
    return null;
  }
  const pk = table.primaryKey[0];
  return pk === undefined || table.primaryKey.length !== 1 ? null : { table, pk };
}

export function createChatCatalog(deps: ChatCatalogDeps) {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; lookup: Promise<ChatLookup> }>();

  /**
   * The chat an add-on key names, its tables and its settings, whatever is
   * vouched or set: null when no such add-on is installed with its tables.
   * `on`: switched on for at least one place it is attached to.
   */
  async function resolve(addOn: string, installId?: string): Promise<{ chat: LiveChat; on: boolean } | null> {
    if (!ADD_ON_KEY.test(addOn)) return null;
    let query = deps.meta.db
      .selectFrom('adminium_manifests')
      .select(['id', 'manifestKey', 'connectionId'])
      .where('kind', '=', 'add-on')
      .where('status', '=', 'installed')
      .where('manifestKey', '=', addOn);
    if (installId !== undefined) query = query.where('id', '=', installId);
    const rows = await query.orderBy('installedAt').execute();
    const installs = await deps.installs();
    for (const row of rows) {
      if (row.connectionId === null) continue;
      const installed = installs.installed(row.connectionId, addOn);
      const block = installed === null ? null : chatOf(installed.manifest);
      if (installed === null || installed.status !== 'installed' || block === null) continue;
      const view = await deps.viewFor(row.connectionId);
      if (view === null) continue;
      const settingsRef = (installed.manifest.addOn as { settingsTable?: string }).settingsTable;
      const of = (ref: string | undefined) => chatTable(installs, view, row.connectionId!, addOn, ref);
      const [conversations, messages, answers, choices, settingsTable] = [of(block.conversations), of(block.messages), of(block.answers), of(block.choices), of(settingsRef)];
      if (conversations === null || messages === null || answers === null || choices === null || settingsTable === null) continue;
      let handle: Awaited<ReturnType<ChatCatalogDeps['data']>>;
      let settingsRow: Record<string, unknown> | undefined;
      try {
        handle = await deps.data(row.connectionId);
        settingsRow = (await handle.db.selectFrom(settingsTable.table.id as never).selectAll().orderBy(handle.db.dynamic.ref(settingsTable.pk) as never).limit(1).executeTakeFirst()) as Record<string, unknown> | undefined;
      } catch {
        // A connection switched off, or a table that cannot be read: as a chat that is not there.
        continue;
      }
      const name = typeof installed.manifest.name === 'string' ? installed.manifest.name : addOn;
      return {
        chat: {
          addOn,
          installId: row.id,
          name,
          version: installed.version,
          connectionId: row.connectionId,
          manifest: installed.manifest,
          block,
          conversations,
          messages,
          answers,
          choices,
          settingsTable,
          settings: readChatSettings(settingsRow ?? null),
          view,
          db: handle.db,
          dialect: handle.dialect,
        },
        on: [...installed.hosts.values()].some(Boolean),
      };
    }
    return null;
  }

  async function lookUp(addOn: string): Promise<ChatLookup> {
    const found = await resolve(addOn);
    if (found === null || !found.on) return { state: 'unavailable' };
    if (!(await deps.vouched({ key: found.chat.addOn, version: found.chat.version, manifest: found.chat.manifest }))) return { state: 'unavailable' };
    if (!(await privacyNoticeReady(deps.meta))) return { state: 'unavailable' };
    return { state: 'live', chat: found.chat };
  }

  /** The chat an add-on key names, as visitors are served it now (kept a few seconds). */
  async function find(addOn: string): Promise<ChatLookup> {
    const at = now();
    const kept = cache.get(addOn);
    if (kept !== undefined && at - kept.at < CHAT_CACHE_MS) return kept.lookup;
    if (cache.size >= CACHE_MAX) {
      for (const [key, entry] of cache) if (at - entry.at >= CHAT_CACHE_MS) cache.delete(key);
      if (cache.size >= CACHE_MAX) cache.clear();
    }
    const lookup = lookUp(addOn);
    cache.set(addOn, { at, lookup });
    // A read that failed is not kept: the next request asks again.
    lookup.catch(() => cache.delete(addOn));
    return lookup;
  }

  /**
   * The chat an add-on key names, for staff (the preview, the staff routes):
   * installed with its tables, whether or not it is switched on, vouched for
   * or its privacy notice set; on the install `installId` names, when given.
   * Never cached: staff ask rarely, and a change they just made shows at once.
   */
  async function forStaff(addOn: string, installId?: string): Promise<LiveChat | null> {
    return (await resolve(addOn, installId))?.chat ?? null;
  }

  return { find, forStaff, forget: (addOn?: string) => (addOn === undefined ? cache.clear() : cache.delete(addOn)) };
}

export type ChatCatalog = ReturnType<typeof createChatCatalog>;
