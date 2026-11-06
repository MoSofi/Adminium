// SPDX-License-Identifier: AGPL-3.0-only
/**
 * manifestsRepo — `adminium_manifests`, its attachments and its
 * credentials.
 *
 * The table has existed since migration 0006 and until now had no repo, no
 * writer and zero rows — which is how three planning documents came to record a
 * shipped table as absent. This is the writer.
 *
 * ─── One repo, three tables, because they are one lifecycle ────────────────
 *
 * `adminium_manifests` says what is installed, `adminium_manifest_attachments`
 * which hosts it is mounted on and whether it is on for each, and
 * `adminium_add_on_credentials` what secret it was given. Install writes the
 * first two, connect writes the third, disconnect deletes only the third, and
 * uninstall deletes the first and lets the FKs take the rest. Splitting them
 * across three repos would put that sequence in the caller, where it is one
 * forgotten delete away from an orphaned secret.
 *
 * ─── Repos never see key material ─────────────────────────────────────────
 *
 * `CredentialCrypto` is the same closure shape `connectionsRepo` takes for
 * DSNs: the server builds it from `ADMINIUM_SECRET` and hands it in. Nothing
 * here derives a key, and the ciphertext is the only form a credential takes on
 * this side of the boundary.
 *
 * `licenseKeyEncrypted` is shipped in the table and is never read or written by
 * anything below: 17 defers licences BY NAME, so honouring that costs nothing.
 *
 * ─── An install is a row, and a key may have several (wave 0076) ──────────
 *
 * The same app or add-on may be installed once per database: one row per
 * (`manifest_key`, `scope_key`), where the scope is the connection id or
 * `server`. The row's id is the INSTALL ID, and everything an install owns
 * is keyed by it. There is deliberately no "find by key": with two installs
 * it would answer the first row, which is a silent wrong answer. A caller
 * with only a key lists the installs (`listByKey`) or names the scope or the
 * slug, and the server's resolver decides — or answers that it cannot.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type {
  AdminiumManifestAttachmentsTable,
  AdminiumManifestsTable,
} from '../schema/tables.js';
import { inIdOrder, packJson, readJson, readJsonOrNull } from './util.js';

export type ManifestRow = Selectable<AdminiumManifestsTable>;
export type ManifestAttachmentRow = Selectable<AdminiumManifestAttachmentsTable>;

/** The scope of an install kept once per server: a server-wide add-on (a payment provider). */
export const SERVER_SCOPE = 'server';

/** The slug of the install that owns a key's bare addresses and grants. */
export const BARE_SLUG = '';

/** A host an add-on is attached to: the host key and, once it is installed, the host install. */
export interface AttachTarget {
  key: string;
  /** The host install id; `''` while the key is not installed. */
  hostInstall: string;
}

/** Encrypt/decrypt closures over `ADMINIUM_SECRET`; the repo never sees the key. */
export interface CredentialCrypto {
  encrypt(plaintext: string): string;
  decrypt(token: string): string;
}

/** `none` never reaches the credential table — there is nothing to store. */
export type ConnectKind = 'api-key' | 'oauth2';

/** An installed manifest with the hosts it is attached to. */
export interface InstalledManifest {
  row: ManifestRow;
  /** The parsed manifest document. */
  document: unknown;
  attachments: ManifestAttachmentRow[];
}

export interface InstallManifestInput {
  manifestKey: string;
  version: string;
  kind: 'app' | 'add-on';
  /** `marketplace` | `file` — how it arrived. */
  source: string;
  /** The validated manifest document, stored verbatim. */
  document: unknown;
  connectionId?: string | null;
  /**
   * The database the install is for (its connection id), or `server`
   * (SERVER_SCOPE). Absent: its connection, else the server.
   */
  scopeKey?: string;
  /** `''` (the default) = the bare addresses; a later install's slug otherwise. */
  instanceSlug?: string;
  installedBy?: string | null;
  /** The hosts to attach on install; a bare key is that key's install with the bare addresses (or none yet). */
  attachTo?: readonly (AttachTarget | string)[];
  /**
   * `installed` (the default) or `installing` — an app install writes its row
   * FIRST, as `installing`, and flips it last. An `installing` row
   * is never served.
   */
  status?: ManifestStatus;
  /** The parts of an app and the owner's switch for each. */
  modules?: AppModules | null;
}

/**
 * The parts of an installed app. `defs` is what its manifest says of each:
 * the default and the add-ons its feature needs (all of them connected, or
 * the part is off whatever its switch says). `on` is the owner's switch; a
 * part with none follows its default.
 */
export interface AppModules {
  defs: { id: string; default: 'on' | 'off' | 'always'; needs: string[] }[];
  on: Record<string, boolean>;
  /** The app's public entries that belong to a part, by the entry's ref: closed while that part is off. */
  doors?: Record<string, string>;
  /**
   * What this install did not make because the add-on a part is built on is
   * not connected: the parts, their tables, and the link columns into them on
   * the tables that were made. Absent when nothing was left out.
   */
  leftOut?: { modules: string[]; tables: string[]; columns: Record<string, string[]> };
}

/** The stored parts of an app, or null when it has none or the value is not one. */
export function readAppModules(value: unknown): AppModules | null {
  if (value === null || value === undefined) return null;
  const read = readJson<{ defs?: unknown; on?: unknown }>(value);
  if (read === null || typeof read !== 'object' || !Array.isArray(read.defs)) return null;
  const defs = read.defs.flatMap((def: unknown) => {
    const one = def as { id?: unknown; default?: unknown; needs?: unknown };
    if (one === null || typeof one !== 'object' || typeof one.id !== 'string') return [];
    const start: AppModules['defs'][number]['default'] = one.default === 'on' || one.default === 'off' ? one.default : 'always';
    return [{ id: one.id, default: start, needs: Array.isArray(one.needs) ? one.needs.filter((key): key is string => typeof key === 'string') : [] }];
  });
  if (defs.length === 0) return null;
  const on = Object.fromEntries(Object.entries((read.on ?? {}) as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  const doors = Object.fromEntries(Object.entries(((read as { doors?: unknown }).doors ?? {}) as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const out = (read as { leftOut?: { modules?: unknown; tables?: unknown; columns?: unknown } }).leftOut;
  const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []);
  const leftOut =
    out === undefined || out === null || typeof out !== 'object' || strings(out.tables).length === 0
      ? undefined
      : { modules: strings(out.modules), tables: strings(out.tables), columns: Object.fromEntries(Object.entries((out.columns ?? {}) as Record<string, unknown>).map(([table, columns]) => [table, strings(columns)])) };
  return { defs, on, ...(Object.keys(doors).length === 0 ? {} : { doors }), ...(leftOut === undefined ? {} : { leftOut }) };
}

/** `installing` → `installed` ⇄ `disabled`; `error` is kept for a broken row. */
/**
 * `updating`: an add-on whose install, update or uninstall is under way. Its
 * code is not asked anything until the row says `installed` again, in this
 * process (which also holds a gate) and in every other.
 */
export const MANIFEST_STATUSES = ['installing', 'installed', 'disabled', 'error', 'updating'] as const;
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];

/** The decrypted credential envelope, as the connect routes hand it over. */
export interface CredentialEnvelope {
  kind: ConnectKind;
  /** Shape differs per kind; opaque to this layer. */
  secret: Record<string, unknown>;
  expiresAt?: number | null;
  scopes?: string[] | null;
}

/**
 * The parts of the apps named (every app when none is), without their
 * manifests: what "is this part on" is answered from.
 */
export async function appModulesOf(meta: MetaDb, keys?: readonly string[]): Promise<{ key: string; id: string; status: string; connectionId: string | null; modules: AppModules | null }[]> {
  if (keys !== undefined && keys.length === 0) return [];
  let query = meta.db.selectFrom('adminium_manifests').select(['id', 'manifestKey', 'status', 'connectionId', 'modules']).where('kind', '=', 'app');
  if (keys !== undefined) query = query.where('manifestKey', 'in', [...keys]);
  const rows = await query.execute();
  return rows.map((row) => ({ key: row.manifestKey, id: row.id, status: row.status, connectionId: row.connectionId, modules: readAppModules(row.modules) }));
}

export function manifestsRepo(meta: MetaDb, crypto: CredentialCrypto) {
  const { db } = meta;

  async function attachmentsFor(manifestId: string): Promise<ManifestAttachmentRow[]> {
    return db
      .selectFrom('adminium_manifest_attachments')
      .selectAll()
      .where('manifestId', '=', manifestId)
      .orderBy('attachedTo', 'asc')
      .execute();
  }

  function hydrate(row: ManifestRow, attachments: ManifestAttachmentRow[]): InstalledManifest {
    return { row, document: readJson(row.manifest), attachments };
  }

  /**
   * The rows of `ids`, in the order given, each with its attachments. A list
   * sorts ids alone and fetches the rows after, unsorted: sorting whole rows
   * made MySQL carry each manifest through its sort buffer, and Client
   * Portal's (about 350 KB) did not fit the default 256 KB one. The apps and
   * add-ons lists then answered 500, and a restart served no app at all.
   */
  async function inOrder(ids: readonly string[]): Promise<InstalledManifest[]> {
    if (ids.length === 0) return [];
    const rows = await db.selectFrom('adminium_manifests').selectAll().where('id', 'in', ids).execute();
    const out: InstalledManifest[] = [];
    for (const row of inIdOrder(ids, rows)) out.push(hydrate(row, await attachmentsFor(row.id)));
    return out;
  }

  /** A host named by key alone: the key's install with the bare addresses, or `''` while it has none. */
  async function hostOf(host: AttachTarget | string): Promise<AttachTarget> {
    if (typeof host !== 'string') return host;
    const bare = await db
      .selectFrom('adminium_manifests')
      .select('id')
      .where('manifestKey', '=', host)
      .where('instanceSlug', '=', BARE_SLUG)
      .where('kind', '=', 'app')
      .executeTakeFirst();
    return { key: host, hostInstall: bare?.id ?? '' };
  }

  return {
    /**
     * Install: one manifest row plus an attachment per host.
     *
     * NOT a transaction here, deliberately — the meta store's own migrator is
     * the only thing in this package that opens one, and the caller
     * (`applyInstall`) already owns a transaction spanning the DATA-source DDL
     * and these rows. Wrapping again would nest.
     */
    async install(input: InstallManifestInput, at: number = Date.now()): Promise<InstalledManifest> {
      // Built as the INSERT shape, not as `ManifestRow`: `JsonColumn` is
      // `ColumnType<unknown, string, string>`, so the column reads back as
      // `unknown` and writes as a serialized string. The row returned to the
      // caller carries the parsed document instead (see the return below).
      const values = {
        id: newId('mft'),
        manifestKey: input.manifestKey,
        version: input.version,
        source: input.source,
        manifest: packJson(input.document),
        licenseKeyEncrypted: null,
        connectionId: input.connectionId ?? null,
        scopeKey: input.scopeKey ?? input.connectionId ?? SERVER_SCOPE,
        instanceSlug: input.instanceSlug ?? BARE_SLUG,
        status: input.status ?? 'installed',
        kind: input.kind,
        // No copy is held until one has actually been uploaded, which happens
        // after this row exists. `setPackageCopy` writes both then.
        packageIntegrity: null,
        packageFileId: null,
        // Written only for an app with parts: a store part-way through its waves has no such column yet.
        ...(input.modules === undefined || input.modules === null ? {} : { modules: packJson(input.modules) }),
        installedBy: input.installedBy ?? null,
        installedAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_manifests').values(values).execute();
      const row = values as unknown as ManifestRow;

      const attachments: ManifestAttachmentRow[] = [];
      for (const named of input.attachTo ?? []) {
        const host = await hostOf(named);
        const attachment: ManifestAttachmentRow = {
          id: newId('mat'),
          manifestId: row.id,
          attachedTo: host.key,
          hostInstall: host.hostInstall,
          flag: null,
          disabledAt: null,
          createdAt: at,
        };
        await db.insertInto('adminium_manifest_attachments').values(attachment).execute();
        attachments.push(attachment);
      }
      return { row, document: input.document, attachments };
    },

    /**
     * Every install of a key, the first installed first (the bare install
     * leads while it is there). Empty when the key is not installed. A
     * caller that needs ONE install resolves it from this list and a
     * selector; it never takes `[0]` on a key that may have two.
     */
    async listByKey(manifestKey: string): Promise<InstalledManifest[]> {
      const ids = await db
        .selectFrom('adminium_manifests')
        .select('id')
        .where('manifestKey', '=', manifestKey)
        .orderBy('installedAt', 'asc')
        .orderBy('id', 'asc')
        .execute();
      return inOrder(ids.map((row) => row.id));
    },

    /** The install of a key for one database (its connection id) or for the server. */
    async findInScope(manifestKey: string, scopeKey: string): Promise<InstalledManifest | null> {
      const row = await db
        .selectFrom('adminium_manifests')
        .selectAll()
        .where('manifestKey', '=', manifestKey)
        .where('scopeKey', '=', scopeKey)
        .executeTakeFirst();
      if (row === undefined) return null;
      return hydrate(row, await attachmentsFor(row.id));
    },

    /** The install of a key at an address: `''` is the bare one, else its slug. */
    async findBySlug(manifestKey: string, instanceSlug: string): Promise<InstalledManifest | null> {
      const row = await db
        .selectFrom('adminium_manifests')
        .selectAll()
        .where('manifestKey', '=', manifestKey)
        .where('instanceSlug', '=', instanceSlug)
        .executeTakeFirst();
      if (row === undefined) return null;
      return hydrate(row, await attachmentsFor(row.id));
    },

    /** Every install on one database (its connection id), or every server-wide one. */
    async listInScope(scopeKey: string, kind?: 'app' | 'add-on'): Promise<InstalledManifest[]> {
      let q = db.selectFrom('adminium_manifests').select('id').where('scopeKey', '=', scopeKey);
      if (kind !== undefined) q = q.where('kind', '=', kind);
      const ids = await q.orderBy('manifestKey', 'asc').orderBy('id', 'asc').execute();
      return inOrder(ids.map((row) => row.id));
    },

    async findById(id: string): Promise<InstalledManifest | null> {
      const row = await db
        .selectFrom('adminium_manifests')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (row === undefined) return null;
      return hydrate(row, await attachmentsFor(row.id));
    },

    /** Every installed manifest of `kind`, newest first. */
    async list(kind?: 'app' | 'add-on'): Promise<InstalledManifest[]> {
      let q = db.selectFrom('adminium_manifests').select('id');
      if (kind !== undefined) q = q.where('kind', '=', kind);
      // The id breaks a tie between two installed in the same millisecond, the newer first.
      const ids = await q.orderBy('installedAt', 'desc').orderBy('id', 'desc').execute();
      return inOrder(ids.map((row) => row.id));
    },

    /**
     * The read a HOST makes on every page load: what is attached here and on.
     * Disabled attachments are excluded rather than returned with a flag — a
     * host that has to remember to filter is a host that will forget once.
     */
    async enabledForHost(attachedTo: string, hostInstall?: string): Promise<InstalledManifest[]> {
      let query = db
        .selectFrom('adminium_manifest_attachments as a')
        .innerJoin('adminium_manifests as m', 'm.id', 'a.manifestId')
        .select('m.id')
        .where('a.attachedTo', '=', attachedTo);
      // One host install's add-ons (wave 0076): Kiln's Print Shop never shows Fernhill's.
      if (hostInstall !== undefined) query = query.where('a.hostInstall', '=', hostInstall);
      const rows = await query
        .where('a.disabledAt', 'is', null)
        .where('m.kind', '=', 'add-on')
        .where('m.status', '=', 'installed')
        .orderBy('m.manifestKey', 'asc')
        .execute();
      return inOrder(rows.map((row) => row.id));
    },

    /**
     * Install again over an install: the same row (its id is the install id,
     * and what it owns — settings, outbox, links, after-install items — is
     * keyed by it) takes the new version, document and status.
     */
    async reinstall(
      id: string,
      input: { version: string; source: string; document: unknown; status: ManifestStatus; modules?: AppModules | null; installedBy?: string | null; connectionId?: string | null },
      at: number = Date.now(),
    ): Promise<void> {
      await db
        .updateTable('adminium_manifests')
        .set({
          version: input.version,
          source: input.source,
          manifest: packJson(input.document),
          status: input.status,
          modules: input.modules === undefined || input.modules === null ? null : packJson(input.modules),
          ...(input.installedBy === undefined ? {} : { installedBy: input.installedBy }),
          ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
          // The held copy is of the old bytes (see `setVersion`).
          packageIntegrity: null,
          packageFileId: null,
          updatedAt: at,
        })
        .where('id', '=', id)
        .execute();
    },

    /** Upgrade in place: a new version and document over the same row. */
    /** The parts of an app and the owner's switches: written by its install and update, and by the switch itself. */
    async setModules(id: string, modules: AppModules | null, at: number = Date.now()): Promise<void> {
      await db
        .updateTable('adminium_manifests')
        .set({ modules: modules === null ? null : packJson(modules), updatedAt: at })
        .where('id', '=', id)
        .execute();
    },

    /**
     * One part's switch, written over what the row holds NOW: read and written
     * back in one breath, so a switch of another part made a moment ago is
     * not lost to this one. Answers the parts as they then stand, or null for
     * a row with none.
     */
    async setModuleSwitch(id: string, module: string, on: boolean, at: number = Date.now()): Promise<AppModules | null> {
      const row = await db.selectFrom('adminium_manifests').select('modules').where('id', '=', id).executeTakeFirst();
      const held = readAppModules(row?.modules);
      if (held === null) return null;
      const next = { ...held, on: { ...held.on, [module]: on } };
      await db.updateTable('adminium_manifests').set({ modules: packJson(next), updatedAt: at }).where('id', '=', id).execute();
      return next;
    },

    /** The parts a row holds now, read alone (never the manifest). */
    async modulesOfRow(id: string): Promise<AppModules | null> {
      const row = await db.selectFrom('adminium_manifests').select('modules').where('id', '=', id).executeTakeFirst();
      return readAppModules(row?.modules);
    },

    /** Move a row along its life. */
    async setStatus(id: string, status: ManifestStatus, at: number = Date.now()): Promise<void> {
      await db.updateTable('adminium_manifests').set({ status, updatedAt: at }).where('id', '=', id).execute();
    },
    /** Say which database a manifest's tables are in: an add-on whose earlier version kept none has no answer until a version that does. */
    async setConnection(id: string, connectionId: string, at: number = Date.now()): Promise<void> {
      await db.updateTable('adminium_manifests').set({ connectionId, updatedAt: at }).where('id', '=', id).execute();
    },

    /**
     * An install kept for the server that now lives on one database (an
     * add-on whose new version brings its first tables): its connection and
     * its scope move together, so it is that database's install from now on.
     */
    async moveToDatabase(id: string, connectionId: string, at: number = Date.now()): Promise<void> {
      await db.updateTable('adminium_manifests').set({ connectionId, scopeKey: connectionId, updatedAt: at }).where('id', '=', id).execute();
    },

    async setVersion(
      id: string,
      input: { version: string; document: unknown },
      at: number = Date.now(),
    ): Promise<void> {
      await db
        .updateTable('adminium_manifests')
        .set({
          version: input.version,
          manifest: packJson(input.document),
          // The held copy is of the OLD version's bytes, so it stops describing
          // this row the moment the version moves. Clearing it is what makes a
          // half-finished upgrade read as "no copy" rather than as a copy that
          // would restore the wrong package. The file row is left for the
          // caller to remove: dropping the pointer inside a version change
          // must not also delete bytes a rollback might still want.
          packageIntegrity: null,
          packageFileId: null,
          updatedAt: at,
        })
        .where('id', '=', id)
        .execute();
    },

    /**
     * Record the copy now held in the storage destination, or clear it.
     *
     * BOTH COLUMNS MOVE TOGETHER, which is why there is no setter for either
     * one alone: a fingerprint with no file to fetch, or a file with nothing to
     * verify it against, is a state the restore cannot act on and would have to
     * interpret. Written only after the upload has succeeded — the columns mean
     * "a copy matching this exists", and writing them first would make a failed
     * upload look like protection.
     */
    async setPackageCopy(
      id: string,
      copy: { fileId: string; integrity: string } | null,
      at: number = Date.now(),
    ): Promise<void> {
      await db
        .updateTable('adminium_manifests')
        .set({
          packageIntegrity: copy?.integrity ?? null,
          packageFileId: copy?.fileId ?? null,
          updatedAt: at,
        })
        .where('id', '=', id)
        .execute();
    },

    /** Attach to one more host; idempotent (the unique index is the guarantee). */
    async attach(
      manifestId: string,
      named: AttachTarget | string,
      at: number = Date.now(),
    ): Promise<ManifestAttachmentRow> {
      const host = await hostOf(named);
      const existing = await db
        .selectFrom('adminium_manifest_attachments')
        .selectAll()
        .where('manifestId', '=', manifestId)
        .where('attachedTo', '=', host.key)
        .where('hostInstall', '=', host.hostInstall)
        .executeTakeFirst();
      if (existing !== undefined) return existing;
      const row: ManifestAttachmentRow = {
        id: newId('mat'),
        manifestId,
        attachedTo: host.key,
        hostInstall: host.hostInstall,
        flag: null,
        disabledAt: null,
        createdAt: at,
      };
      await db.insertInto('adminium_manifest_attachments').values(row).execute();
      return row;
    },

    /**
     * Enable/disable on ONE host (`PATCH`). Per attachment, not per
     * manifest: an add-on can legitimately be live on one host and off on
     * another, and a single flag would make that unrepresentable.
     */
    async setAttachmentEnabled(
      manifestId: string,
      named: AttachTarget | string,
      enabled: boolean,
      at: number = Date.now(),
    ): Promise<boolean> {
      const host = await hostOf(named);
      const res = await db
        .updateTable('adminium_manifest_attachments')
        .set({ disabledAt: enabled ? null : at })
        .where('manifestId', '=', manifestId)
        .where('attachedTo', '=', host.key)
        .where('hostInstall', '=', host.hostInstall)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /**
     * A host key's install arrived: the attachments made while it was not
     * installed (`host_install = ''`) become this install's. Only the first
     * install of a key claims them; later installs start with none.
     */
    async claimAttachments(attachedTo: string, hostInstall: string): Promise<number> {
      const res = await db
        .updateTable('adminium_manifest_attachments')
        .set({ hostInstall })
        .where('attachedTo', '=', attachedTo)
        .where('hostInstall', '=', '')
        .executeTakeFirst();
      return Number(res.numUpdatedRows ?? 0n);
    },

    /**
     * Every add-on attached to one host, on or off, with its row — what an
     * app's uninstall keeps (the add-ons stay; only the links go).
     */
    async attachedToHost(attachedTo: string, hostInstall?: string): Promise<InstalledManifest[]> {
      let query = db
        .selectFrom('adminium_manifest_attachments as a')
        .innerJoin('adminium_manifests as m', 'm.id', 'a.manifestId')
        .select('m.id')
        .where('a.attachedTo', '=', attachedTo);
      if (hostInstall !== undefined) query = query.where('a.hostInstall', '=', hostInstall);
      const rows = await query
        .where('m.kind', '=', 'add-on')
        .orderBy('m.manifestKey', 'asc')
        .execute();
      return inOrder(rows.map((row) => row.id));
    },

    /**
     * Take every add-on off one host: the rows that say "mounted on this app".
     *
     * They belong to the ADD-ON's manifest row, so deleting the host app's own
     * row cascades none of them — without this an uninstalled app's key would
     * still be listed as a host, and a later app installed under the same key
     * would inherit add-ons nobody attached to it. Idempotent.
     */
    async detachHost(named: AttachTarget | string): Promise<number> {
      const host = await hostOf(named);
      // One host install's links (wave 0076): uninstalling Kiln's Print Shop leaves Fernhill's add-ons on it.
      const res = await db
        .deleteFrom('adminium_manifest_attachments')
        .where('attachedTo', '=', host.key)
        .where('hostInstall', '=', host.hostInstall)
        .executeTakeFirst();
      return Number(res.numDeletedRows ?? 0n);
    },

    /**
     * Uninstall: delete the manifest row. Attachments and credentials follow by
     * FK cascade; every table the add-on BROUGHT stays, because nothing here
     * touches the data source.
     */
    async uninstall(id: string): Promise<boolean> {
      const res = await db.deleteFrom('adminium_manifests').where('id', '=', id).executeTakeFirst();
      return Number(res.numDeletedRows) === 1;
    },

    // ─── Credentials ────────────────────────────────────────────────────────

    /**
     * Connect: store the envelope encrypted, one row per add-on.
     *
     * An upsert rather than an insert, because the unique index makes a second
     * connect a violation and a re-connect is an ordinary thing to do (a
     * rotated API key, a re-authorised OAuth grant).
     */
    async setCredential(
      manifestId: string,
      envelope: CredentialEnvelope,
      at: number = Date.now(),
    ): Promise<void> {
      const payload = crypto.encrypt(JSON.stringify(envelope.secret));
      const existing = await db
        .selectFrom('adminium_add_on_credentials')
        .select('id')
        .where('manifestId', '=', manifestId)
        .executeTakeFirst();

      const shared = {
        kind: envelope.kind,
        payload,
        expiresAt: envelope.expiresAt ?? null,
        scopes: envelope.scopes == null ? null : packJson(envelope.scopes),
        updatedAt: at,
      };

      if (existing !== undefined) {
        await db
          .updateTable('adminium_add_on_credentials')
          .set(shared)
          .where('id', '=', existing.id)
          .execute();
        return;
      }
      await db
        .insertInto('adminium_add_on_credentials')
        .values({ id: newId('aoc'), manifestId, createdAt: at, ...shared })
        .execute();
    },

    /**
     * The decrypted envelope, for the server code that is about to make a call
     * with it. Never reached by a route that serves a browser.
     */
    async getCredential(manifestId: string): Promise<CredentialEnvelope | null> {
      const row = await db
        .selectFrom('adminium_add_on_credentials')
        .selectAll()
        .where('manifestId', '=', manifestId)
        .executeTakeFirst();
      if (row === undefined) return null;
      return {
        kind: row.kind as ConnectKind,
        secret: JSON.parse(crypto.decrypt(row.payload)) as Record<string, unknown>,
        expiresAt: row.expiresAt,
        scopes: readJsonOrNull<string[]>(row.scopes),
      };
    },

    /**
     * Whether an add-on is connected, and when its grant lapses — WITHOUT
     * decrypting anything. This is what the Studio page and the connect status
     * read, so a list of add-ons never touches key material.
     */
    async credentialStatus(
      manifestId: string,
    ): Promise<{ kind: ConnectKind; expiresAt: number | null; scopes: string[] | null } | null> {
      const row = await db
        .selectFrom('adminium_add_on_credentials')
        .select(['kind', 'expiresAt', 'scopes'])
        .where('manifestId', '=', manifestId)
        .executeTakeFirst();
      if (row === undefined) return null;
      return {
        kind: row.kind as ConnectKind,
        expiresAt: row.expiresAt,
        scopes: readJsonOrNull<string[]>(row.scopes),
      };
    },

    /**
     * Disconnect (D5): the keys go and NOTHING else does. One statement over a
     * table that holds only secrets, which is what makes "keeps your data" a
     * property of the schema rather than of the caller's care.
     */
    async deleteCredential(manifestId: string): Promise<boolean> {
      const res = await db
        .deleteFrom('adminium_add_on_credentials')
        .where('manifestId', '=', manifestId)
        .executeTakeFirst();
      return Number(res.numDeletedRows) === 1;
    },
  };
}

export type ManifestsRepo = ReturnType<typeof manifestsRepo>;
