// SPDX-License-Identifier: AGPL-3.0-only
/**
 * manifestsRepo — `adminium_manifests`, its attachments and its credentials
 * (07-meta-store.md §3.32; 26-add-on-runtime.md §4).
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
 * uninstall deletes the first and lets the FKs take the rest (26 D5). Splitting
 * them across three repos would put that sequence in the caller, where it is
 * one forgotten delete away from an orphaned secret.
 *
 * ─── Repos never see key material ─────────────────────────────────────────
 *
 * `CredentialCrypto` is the same closure shape `connectionsRepo` takes for DSNs
 * (01-architecture.md §3/§7): the server builds it from `ADMINIUM_SECRET` and
 * hands it in. Nothing here derives a key, and the ciphertext is the only form
 * a credential takes on this side of the boundary.
 *
 * `licenseKeyEncrypted` is shipped in the table and is never read or written by
 * anything below: 17 defers licences BY NAME, so honouring that costs nothing.
 */

import type { Selectable } from 'kysely';

import type { MetaDb } from '../connect.js';
import { newId } from '../ids.js';
import type {
  AdminiumManifestAttachmentsTable,
  AdminiumManifestsTable,
} from '../schema/tables.js';
import { packJson, readJson, readJsonOrNull } from './util.js';

export type ManifestRow = Selectable<AdminiumManifestsTable>;
export type ManifestAttachmentRow = Selectable<AdminiumManifestAttachmentsTable>;

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
  installedBy?: string | null;
  /** Host `manifest_key`s to attach on install. */
  attachTo?: readonly string[];
}

/** The decrypted credential envelope, as the connect routes hand it over. */
export interface CredentialEnvelope {
  kind: ConnectKind;
  /** Shape differs per kind; opaque to this layer. */
  secret: Record<string, unknown>;
  expiresAt?: number | null;
  scopes?: string[] | null;
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
        status: 'installed',
        kind: input.kind,
        installedBy: input.installedBy ?? null,
        installedAt: at,
        updatedAt: at,
      };
      await db.insertInto('adminium_manifests').values(values).execute();
      const row = values as unknown as ManifestRow;

      const attachments: ManifestAttachmentRow[] = [];
      for (const host of input.attachTo ?? []) {
        const attachment: ManifestAttachmentRow = {
          id: newId('mat'),
          manifestId: row.id,
          attachedTo: host,
          disabledAt: null,
          createdAt: at,
        };
        await db.insertInto('adminium_manifest_attachments').values(attachment).execute();
        attachments.push(attachment);
      }
      return { row, document: input.document, attachments };
    },

    async findByKey(manifestKey: string): Promise<InstalledManifest | null> {
      const row = await db
        .selectFrom('adminium_manifests')
        .selectAll()
        .where('manifestKey', '=', manifestKey)
        .executeTakeFirst();
      if (row === undefined) return null;
      return hydrate(row, await attachmentsFor(row.id));
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
      let q = db.selectFrom('adminium_manifests').selectAll();
      if (kind !== undefined) q = q.where('kind', '=', kind);
      const rows = await q.orderBy('installedAt', 'desc').execute();
      const out: InstalledManifest[] = [];
      for (const row of rows) out.push(hydrate(row, await attachmentsFor(row.id)));
      return out;
    },

    /**
     * The read a HOST makes on every page load: what is attached here and on.
     * Disabled attachments are excluded rather than returned with a flag — a
     * host that has to remember to filter is a host that will forget once.
     */
    async enabledForHost(attachedTo: string): Promise<InstalledManifest[]> {
      const rows = await db
        .selectFrom('adminium_manifest_attachments as a')
        .innerJoin('adminium_manifests as m', 'm.id', 'a.manifestId')
        .selectAll('m')
        .where('a.attachedTo', '=', attachedTo)
        .where('a.disabledAt', 'is', null)
        .where('m.kind', '=', 'add-on')
        .where('m.status', '=', 'installed')
        .orderBy('m.manifestKey', 'asc')
        .execute();
      const out: InstalledManifest[] = [];
      for (const row of rows) out.push(hydrate(row, await attachmentsFor(row.id)));
      return out;
    },

    /** Upgrade in place: a new version and document over the same row (26-T17). */
    async setVersion(
      id: string,
      input: { version: string; document: unknown },
      at: number = Date.now(),
    ): Promise<void> {
      await db
        .updateTable('adminium_manifests')
        .set({ version: input.version, manifest: packJson(input.document), updatedAt: at })
        .where('id', '=', id)
        .execute();
    },

    /** Attach to one more host; idempotent (the unique index is the guarantee). */
    async attach(
      manifestId: string,
      attachedTo: string,
      at: number = Date.now(),
    ): Promise<ManifestAttachmentRow> {
      const existing = await db
        .selectFrom('adminium_manifest_attachments')
        .selectAll()
        .where('manifestId', '=', manifestId)
        .where('attachedTo', '=', attachedTo)
        .executeTakeFirst();
      if (existing !== undefined) return existing;
      const row: ManifestAttachmentRow = {
        id: newId('mat'),
        manifestId,
        attachedTo,
        disabledAt: null,
        createdAt: at,
      };
      await db.insertInto('adminium_manifest_attachments').values(row).execute();
      return row;
    },

    /**
     * Enable/disable on ONE host (§5.1's `PATCH`). Per attachment, not per
     * manifest: an add-on can legitimately be live on one host and off on
     * another, and a single flag would make that unrepresentable.
     */
    async setAttachmentEnabled(
      manifestId: string,
      attachedTo: string,
      enabled: boolean,
      at: number = Date.now(),
    ): Promise<boolean> {
      const res = await db
        .updateTable('adminium_manifest_attachments')
        .set({ disabledAt: enabled ? null : at })
        .where('manifestId', '=', manifestId)
        .where('attachedTo', '=', attachedTo)
        .executeTakeFirst();
      return Number(res.numUpdatedRows) === 1;
    },

    /**
     * Uninstall: delete the manifest row. Attachments and credentials follow by
     * FK cascade; every table the add-on BROUGHT stays, because nothing here
     * touches the data source (24 D16 / 26 D5).
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
     * with it. Never reached by a route that serves a browser (24 D15).
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
