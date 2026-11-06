// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0076 — the same app or add-on once per database.
 *
 * An install is a `manifests` row; its id is the install id. Before this
 * wave a key had one row (`uq_adminium_manifests_manifest_key`). Now:
 *
 *  - `scope_key` (NOT NULL): the database the install is for — its connection
 *    id — or `server` for an add-on kept once per server (a payment
 *    provider). Unique with the key. A NULL connection cannot slip past it,
 *    because NULLs are distinct in a unique key on all three engines.
 *  - `instance_slug` (NOT NULL, `''` = the bare addresses `/a/<key>`,
 *    `/apps/<key>/<side>/` and the bare grants). Unique with the key, so the
 *    bare form has exactly one owner. Every row here owns it: each key had
 *    one install. A later install's slug is made at install and never
 *    changes.
 *
 * `manifests` is a foreign-key PARENT (attachments, credentials, outboxes,
 * after-install items). Rebuilding it on SQLite with `foreign_keys = ON`
 * would cascade-delete those rows, so its constraint change is a named-index
 * swap only: the table is never rebuilt.
 *
 * Keyed by the install from here on, never by the key or the connection:
 *
 *  - `add_on_settings`: primary key `manifest_id` (FK cascade), backfilled
 *    from the key's only install. Settings of a key with no install are
 *    dropped, as uninstall already clears them. SQLite rebuilds the table
 *    (create, copy, drop, rename: nothing references it); Postgres and MySQL
 *    swap the key in place.
 *  - `app_outboxes`: unique on `manifest_id`. SQLite rebuilds it (its unique
 *    on `app_key` is an inline autoindex that cannot be dropped); Postgres
 *    and MySQL drop that unique by its generated name.
 *  - `roles.manifest_id` (FK set null): the install whose manifest made an
 *    app role, backfilled from the only install of `app_key`.
 *  - `manifest_attachments.host_install` (NOT NULL, `''` = the host key is
 *    not installed): the host install an add-on is attached to. The unique
 *    pair becomes (add-on, host key, host install). `flag = 'crosses'` marks
 *    an attachment whose add-on keeps its tables on another database than
 *    its host: only a server-wide add-on may do that.
 *  - `install_id` on what an install made: managed automations, email
 *    templates, public keys and endpoints; and on document profiles and
 *    issued documents, the install of the add-on that renders them (an app
 *    that made a profile is `owner_app` on the profile's connection, which
 *    names one install). Backfilled from the key's only install.
 *
 * Every step asks first whether it is done (`probe.ts`): MySQL keeps each
 * statement before a stop, so a run that stopped part way is finished by the
 * next run instead of failing on its first statement. The backfills write
 * values worked out from rows this wave never changes, so writing them again
 * writes the same.
 */
import { sql, type Kysely } from 'kysely';

import type { ColumnHelpers } from '../columns.js';
import { metaTable } from '../prefix.js';
import { columnExists, constraintExists, indexExists, primaryKeyColumns, tableExists } from './probe.js';

/** The scope of an add-on kept once per server. */
export const SERVER_SCOPE = 'server';

interface ManifestRow {
  id: string;
  manifestKey: string;
  kind: string;
  connectionId: string | null;
  manifest: unknown;
}

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;

function parse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** `addOn.scope: "server"`, or a payment provider (they are server-wide until their manifests say so). */
export function declaresServerScope(document: unknown): boolean {
  const addOn = (document as { addOn?: { scope?: unknown; provides?: unknown } } | null)?.addOn;
  if (addOn === undefined || addOn === null || typeof addOn !== 'object') return false;
  if (addOn.scope === 'server') return true;
  return Array.isArray(addOn.provides) && addOn.provides.some((entry) => (entry as { contract?: unknown } | null)?.contract === 'payment-provider');
}

/** MySQL names the table an index is on; Postgres and SQLite refuse it. Gone already: nothing to do. */
async function dropIndex(db: Kysely<unknown>, c: ColumnHelpers, name: string, table: string): Promise<void> {
  if (!(await indexExists(db, c.dialect, table, name))) return;
  const drop = db.schema.dropIndex(name);
  await (c.dialect === 'mysql' ? drop.on(table) : drop).execute();
}

/** An index, made unless a run before this one made it. */
async function createIndex(db: Kysely<unknown>, c: ColumnHelpers, name: string, table: string, columns: string[], unique = false): Promise<void> {
  if (await indexExists(db, c.dialect, table, name)) return;
  const create = db.schema.createIndex(name).on(table).columns(columns);
  await (unique ? create.unique() : create).execute();
}

/** A nullable column, added unless a run before this one added it. */
async function addColumn(db: Kysely<unknown>, c: ColumnHelpers, table: string, column: string, add: () => Promise<unknown>): Promise<void> {
  if (await columnExists(db, c.dialect, table, column)) return;
  await add();
}

export async function up(db: Kysely<unknown>, c: ColumnHelpers): Promise<void> {
  const any = db as unknown as AnyDb;
  const manifests = metaTable('manifests');
  const attachments = metaTable('manifest_attachments');

  // ── manifests: scope and address ──────────────────────────────────────────
  await addColumn(db, c, manifests, 'scope_key', () => db.schema.alterTable(manifests).addColumn('scope_key', c.str(40), (col) => col.notNull().defaultTo('')).execute());
  await addColumn(db, c, manifests, 'instance_slug', () => db.schema.alterTable(manifests).addColumn('instance_slug', c.str(32), (col) => col.notNull().defaultTo('')).execute());

  const rows = (await any.selectFrom(manifests).select(['id', 'manifestKey', 'kind', 'connectionId', 'manifest']).execute()) as unknown as ManifestRow[];
  const byKey = new Map(rows.map((row) => [row.manifestKey, row] as const));
  const links = (await any.selectFrom(attachments).select(['id', 'manifestId', 'attachedTo']).execute()) as unknown as { id: string; manifestId: string; attachedTo: string }[];

  for (const row of rows) {
    let scope: string;
    const document = parse(row.manifest);
    if (row.kind === 'add-on' && declaresServerScope(document)) scope = SERVER_SCOPE;
    else if (row.connectionId !== null) scope = row.connectionId;
    else if (row.kind === 'add-on') {
      // A table-less add-on goes with its host: the one database its hosts are on, else the server.
      const hosts = new Set(
        links
          .filter((link) => link.manifestId === row.id)
          .map((link) => byKey.get(link.attachedTo)?.connectionId ?? null)
          .filter((connection): connection is string => connection !== null),
      );
      scope = hosts.size === 1 ? [...hosts][0]! : SERVER_SCOPE;
    } else scope = SERVER_SCOPE;
    await any.updateTable(manifests).set({ scopeKey: scope }).where('id', '=', row.id).execute();
  }
  // The `''` default stays on every engine (SQLite cannot drop one): the repo always writes a scope, and a
  // row without one is in no database's scope, so nothing resolves to it.
  await dropIndex(db, c, 'uq_adminium_manifests_manifest_key', manifests);
  await createIndex(db, c, 'uq_adminium_manifests_key_scope', manifests, ['manifest_key', 'scope_key'], true);
  await createIndex(db, c, 'uq_adminium_manifests_key_slug', manifests, ['manifest_key', 'instance_slug'], true);
  // The reads by database: "what is installed on this connection".
  await createIndex(db, c, 'ix_adminium_manifests_scope', manifests, ['scope_key']);

  // ── attachments: the host install ─────────────────────────────────────────
  await addColumn(db, c, attachments, 'host_install', () => db.schema.alterTable(attachments).addColumn('host_install', c.str(36), (col) => col.notNull().defaultTo('')).execute());
  await addColumn(db, c, attachments, 'flag', () => db.schema.alterTable(attachments).addColumn('flag', c.str(12)).execute());
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  for (const link of links) {
    const host = byKey.get(link.attachedTo);
    const addOn = byId.get(link.manifestId);
    const crosses =
      host !== undefined &&
      addOn !== undefined &&
      host.connectionId !== null &&
      addOn.connectionId !== null &&
      host.connectionId !== addOn.connectionId &&
      !declaresServerScope(parse(addOn.manifest));
    await any
      .updateTable(attachments)
      .set({ hostInstall: host?.id ?? '', flag: crosses ? 'crosses' : null })
      .where('id', '=', link.id)
      .execute();
  }
  // The new index first: on MySQL the old one carries the manifest FK until another index leads with its column.
  await createIndex(db, c, 'uq_adminium_manifest_attachments_host', attachments, ['manifest_id', 'attached_to', 'host_install'], true);
  await dropIndex(db, c, 'uq_adminium_manifest_attachments_pair', attachments);
  await createIndex(db, c, 'ix_adminium_manifest_attachments_host_install', attachments, ['host_install']);

  // ── add-on settings: by install ───────────────────────────────────────────
  const settings = metaTable('add_on_settings');
  const settingRows = (await any.selectFrom(settings).select(['addOnKey']).execute()) as unknown as { addOnKey: string }[];
  if (c.dialect === 'sqlite') {
    const next = metaTable('add_on_settings_0076');
    // Rebuilt already (it has the column): nothing to copy. A copy left half made is made again.
    const rebuilt = await columnExists(db, c.dialect, settings, 'manifest_id');
    if (!rebuilt && (await tableExists(db, c.dialect, next))) await db.schema.dropTable(next).execute();
    if (!rebuilt) await db.schema
      .createTable(next)
      .addColumn('manifest_id', c.id, (col) => col.primaryKey())
      .addColumn('add_on_key', c.str(80), (col) => col.notNull())
      .addColumn('values', c.json, (col) => col.notNull())
      .addColumn('updated_by', c.id)
      .addColumn('updated_at', c.ts, (col) => col.notNull())
      .addForeignKeyConstraint('fk_adminium_add_on_settings_manifest', ['manifest_id'], manifests, ['id'], (cb) => cb.onDelete('cascade'))
      .addForeignKeyConstraint('fk_adminium_add_on_settings_updated_by', ['updated_by'], metaTable('users'), ['id'], (cb) => cb.onDelete('set null'))
      .execute();
    if (!rebuilt) {
      await sql`INSERT INTO ${sql.table(next)} (manifest_id, add_on_key, ${sql.ref('values')}, updated_by, updated_at)
        SELECT m.id, s.add_on_key, s.${sql.ref('values')}, s.updated_by, s.updated_at
        FROM ${sql.table(settings)} s JOIN ${sql.table(manifests)} m ON m.manifest_key = s.add_on_key`.execute(db);
      await db.schema.dropTable(settings).execute();
      await db.schema.alterTable(next).renameTo(settings).execute();
    }
  } else {
    await addColumn(db, c, settings, 'manifest_id', () => db.schema.alterTable(settings).addColumn('manifest_id', c.id).execute());
    for (const row of settingRows) {
      const install = byKey.get(row.addOnKey);
      if (install === undefined) await any.deleteFrom(settings).where('addOnKey', '=', row.addOnKey).execute();
      else await any.updateTable(settings).set({ manifestId: install.id }).where('addOnKey', '=', row.addOnKey).execute();
    }
    // The key moves to the install: done already when the primary key is `manifest_id`.
    const keyed = (await primaryKeyColumns(db, c.dialect, settings)).join(',') === 'manifest_id';
    if (c.dialect === 'postgres') {
      await db.schema.alterTable(settings).alterColumn('manifest_id', (col) => col.setNotNull()).execute();
      if (await constraintExists(db, c.dialect, settings, `${settings}_pkey`)) {
        await sql`ALTER TABLE ${sql.table(settings)} DROP CONSTRAINT ${sql.id(`${settings}_pkey`)}`.execute(db);
      }
      if (!keyed) await db.schema.alterTable(settings).addPrimaryKeyConstraint('pk_adminium_add_on_settings', ['manifest_id']).execute();
    } else {
      await sql`ALTER TABLE ${sql.table(settings)} MODIFY COLUMN manifest_id char(36) NOT NULL`.execute(db);
      if (!keyed) await sql`ALTER TABLE ${sql.table(settings)} DROP PRIMARY KEY, ADD PRIMARY KEY (manifest_id)`.execute(db);
    }
    if (!(await constraintExists(db, c.dialect, settings, 'fk_adminium_add_on_settings_manifest'))) {
      await db.schema
        .alterTable(settings)
        .addForeignKeyConstraint('fk_adminium_add_on_settings_manifest', ['manifest_id'], manifests, ['id'], (cb) => cb.onDelete('cascade'))
        .execute();
    }
  }
  await createIndex(db, c, 'ix_adminium_add_on_settings_key', settings, ['add_on_key']);

  // ── app outboxes: unique by install ───────────────────────────────────────
  const outboxes = metaTable('app_outboxes');
  // Rebuilt (SQLite) or its unique on the key dropped (Postgres, MySQL) already: the unique by install is there.
  const outboxesDone = await indexExists(db, c.dialect, outboxes, 'uq_adminium_app_outboxes_manifest');
  if (outboxesDone) {
    // Nothing left of this step but the indexes below.
  } else if (c.dialect === 'sqlite') {
    const next = metaTable('app_outboxes_0076');
    if (await tableExists(db, c.dialect, next)) await db.schema.dropTable(next).execute();
    await db.schema
      .createTable(next)
      .addColumn('id', c.id, (col) => col.primaryKey())
      .addColumn('app_key', c.str(80), (col) => col.notNull())
      .addColumn('manifest_id', c.id, (col) => col.notNull())
      .addColumn('connection_id', c.id, (col) => col.notNull())
      .addColumn('definition', c.text, (col) => col.notNull())
      .addColumn('scanned_at', c.ts)
      .addColumn('created_at', c.ts, (col) => col.notNull())
      .addColumn('updated_at', c.ts, (col) => col.notNull())
      .addForeignKeyConstraint('fk_adminium_app_outboxes_manifest', ['manifest_id'], manifests, ['id'], (cb) => cb.onDelete('cascade'))
      .addForeignKeyConstraint('fk_adminium_app_outboxes_connection', ['connection_id'], metaTable('connections'), ['id'], (cb) => cb.onDelete('cascade'))
      .execute();
    const columns = sql.raw('id, app_key, manifest_id, connection_id, definition, scanned_at, created_at, updated_at');
    await sql`INSERT INTO ${sql.table(next)} (${columns}) SELECT ${columns} FROM ${sql.table(outboxes)}`.execute(db);
    await db.schema.dropTable(outboxes).execute();
    await db.schema.alterTable(next).renameTo(outboxes).execute();
  } else if (c.dialect === 'postgres') {
    if (await constraintExists(db, c.dialect, outboxes, `${outboxes}_app_key_key`)) {
      await sql`ALTER TABLE ${sql.table(outboxes)} DROP CONSTRAINT ${sql.id(`${outboxes}_app_key_key`)}`.execute(db);
    }
  } else if (await indexExists(db, c.dialect, outboxes, 'app_key')) {
    await sql`ALTER TABLE ${sql.table(outboxes)} DROP INDEX app_key`.execute(db);
  }
  await createIndex(db, c, 'uq_adminium_app_outboxes_manifest', outboxes, ['manifest_id'], true);
  await createIndex(db, c, 'ix_adminium_app_outboxes_app_key', outboxes, ['app_key']);

  // ── roles: the install that made an app role ──────────────────────────────
  const roles = metaTable('roles');
  if (c.dialect === 'sqlite') {
    await addColumn(db, c, roles, 'manifest_id', () => sql`ALTER TABLE ${sql.table(roles)} ADD COLUMN manifest_id char(36) REFERENCES ${sql.table(manifests)}(id) ON DELETE SET NULL`.execute(db));
  } else {
    await addColumn(db, c, roles, 'manifest_id', () => db.schema.alterTable(roles).addColumn('manifest_id', c.id).execute());
    if (!(await constraintExists(db, c.dialect, roles, 'fk_adminium_roles_manifest_id'))) {
      await db.schema
        .alterTable(roles)
        .addForeignKeyConstraint('fk_adminium_roles_manifest_id', ['manifest_id'], manifests, ['id'], (cb) => cb.onDelete('set null'))
        .execute();
    }
  }
  for (const row of rows) {
    await any.updateTable(roles).set({ manifestId: row.id }).where('appKey', '=', row.manifestKey).execute();
  }
  await createIndex(db, c, 'ix_adminium_roles_manifest', roles, ['manifest_id']);

  // ── what an install made: its id beside the key ───────────────────────────
  const made: { table: string; key: string }[] = [
    { table: 'automations', key: 'managedBy' },
    { table: 'email_templates', key: 'managedBy' },
    { table: 'public_keys', key: 'managedBy' },
    { table: 'public_endpoints', key: 'managedBy' },
    { table: 'document_profiles', key: 'addOnKey' },
    { table: 'documents', key: 'addOnKey' },
  ];
  for (const { table, key } of made) {
    const name = metaTable(table);
    await addColumn(db, c, name, 'install_id', () => db.schema.alterTable(name).addColumn('install_id', c.id).execute());
    for (const row of rows) {
      await any.updateTable(name).set({ installId: row.id }).where(key, '=', row.manifestKey).execute();
    }
    await createIndex(db, c, `ix_adminium_${table}_install`, name, ['install_id']);
  }
}
