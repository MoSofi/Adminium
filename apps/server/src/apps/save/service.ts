// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP: THE SERVICE THE ROUTES AND THE CLI CALL.
 *
 * `plan` runs the converter and the gates and writes nothing: it is what the
 * wizard's Check step shows. `save` runs the same, refuses while a choice is
 * unanswered or a gate refuses, then packs the file, takes its fingerprint,
 * keeps a copy in the Files library and records the save. A save is never
 * written from an earlier plan: the person's answers are carried, the file is
 * made again.
 *
 * Who may save what:
 *  - configuration: `system:manifests:manage` (the route asks it);
 *  - rows of a table: the saver's own `read` and `export` on that table, and
 *    the whole table within their reach (a person who reads part of a table
 *    never saves its rows);
 *  - a personal column's rows: `read_pii` on that table;
 *  - files in the file (mail attachments, pictures): `system:files:manage`,
 *    since the Files library cannot say whose they were once copied.
 * The CLI has no person. It runs with host access, which reads everything,
 * and passes a `rights` that allows all.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { parseDatabaseModel } from '@adminium/engine';
import type { AppManifest } from '@adminium/manifest';
import { appSavesRepo, filesRepo, newId, snapshotsRepo, type AppSave, type MetaDb } from '@adminium/meta';

import type { Kysely } from 'kysely';

import { packStagedTree } from '../../add-ons/pack.js';
import type { SourceDatabase } from '../../connections/manager.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../errors.js';
import type { FileStore } from '../../files/store.js';
import type { CheckItem } from './check.js';
import { carryOutAnswers } from './answers.js';
import { convertToApp } from './convert.js';
import { saveInventory, type SaveInventory } from './inventory.js';
import { runSaveGates, type GateProblem } from './gates/index.js';
import type { RowChoice, SaveChoices, SaveDialect, SaveSource } from './types.js';

export interface SaveRequest {
  connectionId: string;
  key: string;
  name: string;
  version?: string | undefined;
  description?: string | undefined;
  label?: string | undefined;
  include?:
    | {
        tables?: string[] | undefined;
        pages?: string[] | undefined;
        roles?: string[] | undefined;
        automations?: string[] | undefined;
        emailTemplates?: string[] | undefined;
        documents?: string[] | undefined;
        reports?: string[] | undefined;
        invoiceLayouts?: string[] | undefined;
        scheduledReports?: string[] | undefined;
        publicEndpoints?: string[] | undefined;
        payments?: boolean | undefined;
        instance?: boolean | undefined;
      }
    | undefined;
  rows?: Record<string, RowChoice> | undefined;
  answers?:
    | {
        carryAsText?: string[] | undefined;
        personalColumns?: string[] | undefined;
        shareViews?: string[] | undefined;
        clear?: string[] | undefined;
        leaveOut?: string[] | undefined;
        keep?: string[] | undefined;
      }
    | undefined;
}

/** What the person saving may do, asked by the route of the request (or "everything", by the CLI). */
export interface SaveRights {
  userId: string | null;
  /** A grant string (`table:<connectionId>:<tableId>:read`, `system:files:manage`…). */
  can(grant: string): Promise<boolean>;
  /** Whether the saver reads the whole table (no row reach narrows it). */
  readsWhole(connectionId: string, tableId: string): Promise<boolean>;
}

export interface SavePlan {
  key: string;
  version: string;
  lineage: 'new' | 'kept';
  label: string;
  minAdminiumVersion: string;
  /** Nothing to answer and nothing refused: `save` would write the file. */
  ready: boolean;
  check: CheckItem[];
  problems: GateProblem[];
  /** How many of each kind travel. */
  counts: Record<string, number>;
}

export interface SavedFile {
  id: string;
  key: string;
  version: string;
  integrity: string;
  bytes: number;
  filename: string;
  savedAt: number;
}

/** A file made and checked, not yet recorded (see `make`). */
export interface MadeFile {
  plan: SavePlan;
  /** The manifest inside, as written. */
  manifest: AppManifest;
  tarball: Uint8Array;
  integrity: string;
  filename: string;
  /** Keep its copy and record the save. */
  commit(): Promise<SavedFile & { tarball: Uint8Array }>;
}

export interface SaveServiceDeps {
  meta: MetaDb;
  /** Where "Download again" keeps its copy; null keeps none (the CLI writes the file itself). */
  storage: FileStore | null;
  masterSecret: string;
  adminiumVersion: string;
  projectEnvFile?: string | null;
  /** The engine of a connection, or null when there is no such connection. */
  dialectOf(connectionId: string): Promise<SaveDialect | null>;
  /** The deployment's display name: the label's default. */
  displayName(): Promise<string>;
  /** The database's own rows, for a save that carries some. */
  dataDb?: ((connectionId: string) => Promise<Kysely<SourceDatabase>>) | undefined;
  now?: () => number;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function createSaveService(deps: SaveServiceDeps) {
  const now = deps.now ?? Date.now;

  async function prepare(request: SaveRequest, rights: SaveRights) {
    const dialect = await deps.dialectOf(request.connectionId);
    if (dialect === null) throw new NotFoundError('That database is not connected here.');
    const snapshot = await snapshotsRepo(deps.meta).latest(request.connectionId);
    if (snapshot === null) throw new ConflictError('This database has not been read yet. Refresh its schema, then save.', 'CONFLICT', { reason: 'SNAPSHOT_MISSING' });
    const model = parseDatabaseModel(snapshot.schema);

    const saves = await appSavesRepo(deps.meta).listForKey(request.key);
    const elsewhere = saves.find((one) => one.connectionId !== null && one.connectionId !== request.connectionId);
    if (elsewhere !== undefined) {
      throw new ConflictError(`"${request.key}" was saved from another database. Give this app another key.`, 'CONFLICT', { reason: 'APP_KEY_SAVED_ELSEWHERE' });
    }
    const version = request.version ?? nextVersion(saves);
    if (!SEMVER.test(version)) throw new ValidationFailedError(`"${version}" is not a version like 1.2.0.`);
    const held = saves.find((one) => one.version === version);
    if (held !== undefined) throw new ConflictError(`${request.key} ${version} was saved before. Save a newer version.`, 'CONFLICT', { reason: 'APP_VERSION_SAVED' });
    const highest = saves.map((one) => one.version).sort(compareSemver).at(-1);
    if (highest !== undefined && compareSemver(version, highest) <= 0) {
      throw new ConflictError(`${request.key} ${highest} was saved before. Save a version above it.`, 'CONFLICT', { reason: 'APP_VERSION_OLDER' });
    }
    const kept = saves[0]?.lineage;
    const lineage = kept ?? randomBytes(16).toString('base64url');

    await refuseWithoutRights(request, rights);

    const label = request.label?.trim() || (await deps.displayName());
    const choices: SaveChoices = {
      key: request.key,
      name: request.name,
      version,
      ...(request.description === undefined ? {} : { description: request.description }),
      label,
      lineage,
      savedAt: new Date(now()).toISOString(),
      ...definedOf(request.include ?? {}),
      ...(request.rows === undefined ? {} : { rows: request.rows }),
      ...definedOf(request.answers ?? {}),
    };
    const storage = deps.storage;
    const source: SaveSource = {
      meta: deps.meta,
      connectionId: request.connectionId,
      dialect,
      model,
      adminiumVersion: deps.adminiumVersion,
      ...(storage === null
        ? {}
        : {
            readFile: async (fileId: string) => {
              const file = await filesRepo(deps.meta).findById(fileId);
              if (file === null || file.deletedAt !== null) return null;
              const chunks: Buffer[] = [];
              for await (const chunk of await storage.read(file)) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
              return new Uint8Array(Buffer.concat(chunks));
            },
          }),
    };
    const wantsRows = Object.values(request.rows ?? {}).some((choice) => choice.mode !== 'none');
    if (wantsRows && deps.dataDb !== undefined) {
      const readFile = source.readFile;
      source.rows = {
        db: await deps.dataDb(request.connectionId),
        ...(readFile === undefined
          ? {}
          : {
              readFile: async (fileId: string) => {
                const file = await filesRepo(deps.meta).findById(fileId);
                const bytes = file === null ? null : await readFile(fileId);
                return file === null || bytes === null ? null : { bytes, filename: file.filename, mime: file.mime };
              },
            }),
      };
    }
    const made = await convertToApp(source, choices);
    // The gates' answers carried out on the file itself, before the gates look again.
    const converted = { ...made, ...carryOutAnswers(made.manifest, made.files, choices) };
    const gates = await runSaveGates({ manifest: converted.manifest, files: converted.files, source, choices }, { masterSecret: deps.masterSecret, projectEnvFile: deps.projectEnvFile ?? null });
    const check = [...converted.check, ...gates.choices];
    const plan: SavePlan = {
      key: request.key,
      version,
      lineage: kept === undefined ? 'new' : 'kept',
      label,
      minAdminiumVersion: converted.manifest.compatibility.minAdminiumVersion,
      ready: gates.problems.length === 0 && check.every((item) => item.group !== 'choice'),
      check,
      problems: gates.problems,
      counts: countsOf(converted.manifest, converted.files),
    };
    return { plan, converted, lineage };
  }

  async function refuseWithoutRights(request: SaveRequest, rights: SaveRights): Promise<void> {
    if (request.include?.instance === true && !(await rights.can('system:settings:manage'))) {
      throw new ConflictError('Saving the look, languages, wording and system emails needs managing settings.', 'CONFLICT', { reason: 'SAVE_INSTANCE_NOT_YOURS' });
    }
    for (const [tableId, choice] of Object.entries(request.rows ?? {})) {
      if (choice.mode === 'none') continue;
      const base = `table:${request.connectionId}:${tableId}`;
      if (!(await rights.can(`${base}:read`)) || !(await rights.can(`${base}:export`))) {
        throw new ConflictError(`You may not save the rows of ${tableId}: it needs reading and exporting that table.`, 'CONFLICT', { reason: 'SAVE_ROWS_NOT_YOURS' });
      }
      if (!(await rights.readsWhole(request.connectionId, tableId))) {
        throw new ConflictError(`You read only part of ${tableId}, so you may not save its rows.`, 'CONFLICT', { reason: 'SAVE_ROWS_NOT_YOURS' });
      }
    }
    for (const target of request.answers?.personalColumns ?? []) {
      const dot = target.lastIndexOf('.');
      const tableId = dot > 0 ? target.slice(0, dot) : target;
      if (!(await rights.can(`table:${request.connectionId}:${tableId}:read_pii`))) {
        throw new ConflictError(`You may not save personal columns of ${tableId}: it needs reading them.`, 'CONFLICT', { reason: 'SAVE_ROWS_NOT_YOURS' });
      }
    }
  }

  async function make(request: SaveRequest, rights: SaveRights): Promise<MadeFile> {
    const { plan, converted, lineage } = await prepare(request, rights);
    if (plan.problems.length > 0) throw new ConflictError(`The file cannot be made: ${plan.problems.map((p) => p.message).join(' ')}`, 'CONFLICT', { reason: 'SAVE_REFUSED' });
    const open = plan.check.filter((item) => item.group === 'choice');
    if (open.length > 0) throw new ConflictError(`${String(open.length)} item(s) in Check need an answer before the file is made.`, 'CONFLICT', { reason: 'SAVE_NEEDS_ANSWERS' });
    if (converted.files.size > 0 && !(await rights.can('system:files:manage'))) {
      throw new ConflictError('The app carries files from the Files library, and saving them needs managing files.', 'CONFLICT', { reason: 'SAVE_FILES_NOT_YOURS' });
    }

    const tarball = await packManifest(converted.manifest, converted.files);
    const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
    const filename = `${request.key}-${plan.version}.tgz`;
    return {
      plan,
      manifest: converted.manifest,
      tarball,
      integrity,
      filename,
      async commit() {
        const at = now();
        let fileId: string | null = null;
        if (deps.storage !== null) {
          fileId = newId('file');
          const stored = await deps.storage.write({ id: fileId, kind: 'export', filename, mime: 'application/gzip', bytes: Buffer.from(tarball) });
          await filesRepo(deps.meta).create(
            { id: fileId, filename, mime: 'application/gzip', sizeBytes: stored.sizeBytes, sha256: stored.sha256, kind: 'export', uploadedBy: rights.userId, storageKey: stored.storageKey, destinationId: stored.destinationId, storage: stored.storage },
            at,
          );
        }
        const row = await appSavesRepo(deps.meta).create(
          { appKey: request.key, version: plan.version, lineage, connectionId: request.connectionId, label: plan.label, savedBy: rights.userId, integrity, bytes: tarball.byteLength, fileId, name: request.name, description: request.description?.trim() || null },
          at,
        );
        return { id: row.id, key: row.appKey, version: row.version, integrity, bytes: tarball.byteLength, filename, savedAt: row.savedAt, tarball };
      },
    };
  }

  return {
    async plan(request: SaveRequest, rights: SaveRights): Promise<SavePlan> {
      return (await prepare(request, rights)).plan;
    },

    async save(request: SaveRequest, rights: SaveRights): Promise<SavedFile & { tarball: Uint8Array }> {
      return (await make(request, rights)).commit();
    },

    /**
     * The file made and checked, not yet recorded: `commit` keeps its copy and
     * records the save. A workspace save makes every app's file first and
     * records them only when the whole workspace file can be made, so a
     * refusal of the whole never uses up an app's version.
     */
    make,

    /** The saved file again ("Download again"), or null when its copy is gone. */
    async file(id: string): Promise<{ save: AppSave; filename: string; bytes: Uint8Array } | null> {
      const save = await appSavesRepo(deps.meta).findById(id);
      if (save === null || save.fileId === null || deps.storage === null) return null;
      const storage = deps.storage;
      const file = await filesRepo(deps.meta).findById(save.fileId);
      if (file === null) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of await storage.read(file)) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      return { save, filename: `${save.appKey}-${save.version}.tgz`, bytes: Buffer.concat(chunks) };
    },

    async list(): Promise<AppSave[]> {
      return appSavesRepo(deps.meta).list();
    },

    /** What the database could put in its app, for the wizard's "What to include". */
    async inventory(connectionId: string, rights: SaveRights): Promise<SaveInventory> {
      const dialect = await deps.dialectOf(connectionId);
      if (dialect === null) throw new NotFoundError('That database is not connected here.');
      const snapshot = await snapshotsRepo(deps.meta).latest(connectionId);
      if (snapshot === null) throw new ConflictError('This database has not been read yet. Refresh its schema, then save.', 'CONFLICT', { reason: 'SNAPSHOT_MISSING' });
      return saveInventory({ meta: deps.meta, connectionId, dialect, model: parseDatabaseModel(snapshot.schema), adminiumVersion: deps.adminiumVersion }, rights);
    },
  };
}

export type SaveService = ReturnType<typeof createSaveService>;

/** The next version after the highest saved: 1.0.0 first, then the patch number + 1. */
export function nextVersion(saves: readonly Pick<AppSave, 'version'>[]): string {
  const highest = saves.map((one) => one.version).filter((v) => SEMVER.test(v)).sort(compareSemver).at(-1);
  if (highest === undefined) return '1.0.0';
  const [, major, minor, patch] = SEMVER.exec(highest) as RegExpExecArray;
  return `${major}.${minor}.${String(Number(patch) + 1)}`;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function definedOf<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

/** A file's package tree, packed the way the add-on packer packs: deterministic bytes. */
export async function packManifest(manifest: unknown, files: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'adminium-save-'));
  try {
    await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const [path, bytes] of files) {
      const target = join(dir, path);
      if (!target.startsWith(`${dir}/`)) throw new Error(`save: "${path}" is outside the package`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    return (await packStagedTree(dir)).tarball;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function countsOf(manifest: Record<string, unknown> | object, files: ReadonlyMap<string, Uint8Array>): Record<string, number> {
  const m = manifest as Record<string, unknown>;
  const length = (value: unknown): number => (Array.isArray(value) ? value.length : value !== null && typeof value === 'object' ? Object.keys(value).length : 0);
  const schema = m['requiredSchema'] as { tables?: unknown[] } | undefined;
  return {
    tables: length(schema?.tables),
    pages: length(m['pages']),
    roles: length(m['roles']),
    automations: length((m['automations'] as { rules?: unknown } | undefined)?.rules ?? m['automations']),
    emailTemplates: length(m['emailTemplates']),
    documents: length(m['documents']),
    reports: length(m['reports']),
    invoiceLayouts: length(m['invoiceLayouts']),
    scheduledReports: length(m['scheduledReports']),
    publicAccess: length(m['publicAccess']),
    optionLists: length(m['optionLists']),
    seeds: length(m['seeds']),
    files: files.size,
  };
}
