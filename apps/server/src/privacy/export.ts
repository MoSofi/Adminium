// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "DOWNLOAD EVERYTHING": a person's data as a .zip, for their access request.
 *
 * One JSON file and one CSV file per source the search found
 * (`sources.ts`): `people-crm-contacts.json` and `.csv`, `consent.json` and
 * `.csv`, and so on. Nothing else: no file for a source that holds nothing,
 * and nothing of anybody else (each source holds only the rows found for the
 * address).
 *
 * Written by a job (`privacy.export`), as the export of a table is:
 *   - the request keeps the person as the keyed hash of their address
 *     (`adminium_privacy_exports`); the job's payload carries the address
 *     sealed (`consent/keys.ts` `sealAddress`), so neither the queue nor the
 *     row holds it in clear;
 *   - the job asks again whether the person who asked still holds the
 *     privacy action, and writes nothing when they do not;
 *   - the file is downloaded by the person who asked, and nobody else, until
 *     `retention.exportsDays` is over, when it is deleted (`sweepPrivacyExports`);
 *   - the audit log is told the counts and the keyed hash, never the address.
 */
import { DAY_MS, auditRepo, filesRepo, newId, privacyExportsRepo, settingsRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';

import { addressKeyRing, openAddress } from '../consent/keys.js';
import { serializeCsvRow, EXPORT_BOM } from '../data-io/csv.js';
import type { FileStore } from '../files/store.js';
import type { JobRegistry } from '../jobs/registry.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import { findPerson, type FoundSource, type PersonFound, type PrivacyFindDeps } from './sources.js';

export const PRIVACY_EXPORT_KIND = 'privacy.export';

export const privacyExportPayloadSchema = z.object({
  exportId: z.string().min(1),
  /** Owner convention (routes/jobs): the person who asked. */
  userId: z.string().min(1),
  /** The address, sealed under the server's secret. */
  address: z.string().min(1),
});
export type PrivacyExportPayload = z.infer<typeof privacyExportPayloadSchema>;

/** A cell a spreadsheet would read as a formula starts with a quote instead. */
function safeCell(value: unknown): unknown {
  return typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** One source as CSV: the columns every row has, in the order first seen; nested values as JSON. */
export function sourceCsv(rows: readonly Record<string, unknown>[]): string {
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  let out = EXPORT_BOM + serializeCsvRow(columns);
  for (const row of rows) out += serializeCsvRow(columns.map((column) => safeCell(row[column] ?? null)));
  return out;
}

/** The .zip of a person's data: a JSON and a CSV file per source with something in it. */
export function personZip(found: PersonFound, at: number): Uint8Array {
  const files: Zippable = {};
  for (const source of found.sources) {
    if (source.rows.length === 0) continue;
    files[`${source.id}.json`] = strToU8(JSON.stringify(source.rows, null, 2));
    files[`${source.id}.csv`] = strToU8(sourceCsv(source.rows));
  }
  return zipSync(files, { mtime: new Date(at) });
}

/** Rows per source, by the source's id: what the request and the audit entry keep. */
export function countsOf(sources: readonly FoundSource[]): Record<string, number> {
  return Object.fromEntries(sources.map((source) => [source.id, source.count]));
}

export interface PrivacyExportDeps extends PrivacyFindDeps {
  storage: FileStore;
  secret: string;
  now?: () => number;
}

/** Whether a person may still use the privacy action: active, and holding it. */
export async function mayUsePrivacy(meta: MetaDb, userId: string): Promise<boolean> {
  const user = await usersRepo(meta).findById(userId);
  if (user === null || user.status !== 'active') return false;
  const set = await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.name });
  return permissionSetAllows(set, PERMISSIONS.privacyManage);
}

export async function runPrivacyExport(payload: PrivacyExportPayload, deps: PrivacyExportDeps): Promise<'ready' | 'failed' | 'skipped'> {
  const { meta } = deps;
  const now = deps.now ?? Date.now;
  const repo = privacyExportsRepo(meta);
  const row = await repo.findById(payload.exportId);
  if (row === null || row.status !== 'processing') return 'skipped';
  const address = { hash: row.address.hash, version: row.address.version };
  const audit = (action: string, after: Record<string, unknown>) =>
    auditRepo(meta).append({ actorKind: 'user', actorId: payload.userId, actorLabel: payload.userId, category: 'export', action, changes: { after: { exportId: row.id, address, ...after } } }, now());

  if (row.requestedBy !== payload.userId || !(await mayUsePrivacy(meta, payload.userId))) {
    await repo.markFailed(row.id, 'not-allowed', now());
    await audit('privacy.export.failed', { reason: 'not-allowed' });
    return 'failed';
  }
  try {
    const found = await findPerson(deps, openAddress(deps.secret, payload.address));
    const at = now();
    const bytes = Buffer.from(personZip(found, at));
    const fileId = newId('file');
    const filename = `person-data-${new Date(at).toISOString().slice(0, 10)}.zip`;
    const stored = await deps.storage.write({ id: fileId, kind: 'export', filename, mime: 'application/zip', bytes });
    await filesRepo(meta).create({ id: fileId, filename, mime: 'application/zip', sizeBytes: stored.sizeBytes, sha256: stored.sha256, kind: 'export', uploadedBy: payload.userId, storageKey: stored.storageKey, destinationId: stored.destinationId, storage: stored.storage }, at);
    const days = await settingsRepo(meta).get('retention.exportsDays');
    const counts = countsOf(found.sources);
    await repo.markReady(row.id, { fileId, counts, expiresAt: at + days * DAY_MS }, at);
    await audit('privacy.export.complete', { counts });
    return 'ready';
  } catch (error) {
    // The reason kept is the error's kind, never its message: a message may quote what was searched for.
    const reason = error instanceof Error ? error.name : 'Error';
    await repo.markFailed(row.id, reason, now());
    await audit('privacy.export.failed', { reason });
    return 'failed';
  }
}

export function registerPrivacyExportHandler(registry: JobRegistry, deps: PrivacyExportDeps): void {
  registry.registerJobHandler(
    PRIVACY_EXPORT_KIND,
    privacyExportPayloadSchema,
    async (payload) => ({ exportId: payload.exportId, state: await runPrivacyExport(payload, deps) }),
    // Queued only by `POST /privacy/exports`, never the generic `POST /jobs`: its payload names a person.
    { internal: true },
  );
}

/** The keyed hash a request keeps for an address (made under the newest key; the first is made when there is none). */
export async function personHash(meta: MetaDb, secret: string, address: string) {
  return addressKeyRing(meta, secret).hashForWrite(address);
}

/** Every hash an address has under the keys there are (to find a person's own downloads). */
export async function personHashes(meta: MetaDb, secret: string, address: string) {
  return addressKeyRing(meta, secret).hashesOf(address);
}

/** Deletes the files of downloads whose time is up, and marks them expired. */
export async function sweepPrivacyExports(meta: MetaDb, storage: FileStore, at: number = Date.now()): Promise<number> {
  const repo = privacyExportsRepo(meta);
  const files = filesRepo(meta);
  let swept = 0;
  for (;;) {
    const due = await repo.expiredBefore(at, 100);
    if (due.length === 0) break;
    for (const one of due) {
      if (one.fileId !== null) {
        const file = await files.findById(one.fileId);
        if (file !== null) {
          await storage.remove(file);
          await files.purge(file.id);
        }
      }
      await repo.markExpired(one.id);
      swept += 1;
    }
    if (due.length < 100) break;
  }
  return swept;
}
