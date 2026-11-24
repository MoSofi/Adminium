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
 *     privacy action, and writes nothing when they do not; it searches only
 *     as far as that action reaches for them now (`scope.ts`: a shop owner's
 *     own apps), and writes nothing about a staff account's address for one
 *     who does not manage privacy for the whole workspace;
 *   - the file is downloaded by the person who asked, and nobody else, until
 *     `retention.exportsDays` is over, when it is deleted (`sweepPrivacyExports`);
 *   - the audit log is told the counts and the keyed hash, never the address.
 *
 * TEXTS. The person's text records go too (`sms/export.ts`): their yes and no
 * to texts with the words they were shown, the stop entry, their
 * conversations in clear and the texts sent to them, found by every number on
 * their rows. A person known only by phone is asked for by the number
 * (`POST /privacy/phone/exports`): the job then finds the rows that hold it,
 * and the same text records.
 */
import { DAY_MS, auditRepo, filesRepo, newId, privacyExportsRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';

import { addressKeyRing, openAddress } from '../consent/keys.js';
import { serializeCsvRow, EXPORT_BOM } from '../data-io/csv.js';
import type { FileStore } from '../files/store.js';
import type { JobRegistry } from '../jobs/registry.js';
import type { TextExport } from '../sms/export.js';
import { findPersonRows, textTargets, type PersonRows } from './erase-rows.js';
import { privacyScopeOf, refuseStaffAddress } from './scope.js';
import { erasedNameOf, findPerson, searchAddress, type FoundSource, type PersonFound, type PrivacyFindDeps } from './sources.js';
import { plainValue } from './values.js';

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

/** A file of the download that is no source of the search: the text records, and the rows found by a number. */
export interface ExtraFile {
  id: string;
  rows: Record<string, unknown>[];
}

/** The .zip of a person's data: a JSON and a CSV file per source with something in it. */
export function personZip(found: PersonFound, at: number, extra: readonly ExtraFile[] = []): Uint8Array {
  const files: Zippable = {};
  const all: { id: string; rows: Record<string, unknown>[]; csvRows?: Record<string, unknown>[] | undefined }[] = [...found.sources, ...extra];
  for (const source of all) {
    if (source.rows.length === 0) continue;
    files[`${source.id}.json`] = strToU8(JSON.stringify(source.rows, null, 2));
    files[`${source.id}.csv`] = strToU8(sourceCsv(source.csvRows ?? source.rows));
  }
  return zipSync(files, { mtime: new Date(at) });
}

/** What a request by phone carries in place of an address. */
export const PHONE_SUBJECT = 'tel:';

/** The rows a number was found on, as the download writes them. */
function rowsFoundBy(rows: PersonRows): ExtraFile[] {
  return rows.databases.flatMap((database) =>
    database.sources
      .filter((source) => source.rows.length > 0)
      .map((source) => ({ id: source.id.replace(/[^a-z0-9-]+/gi, '-').toLowerCase(), rows: source.rows.map((row) => Object.fromEntries(Object.entries(row.before).map(([column, value]) => [column, plainValue(value)]))) })),
  );
}

/** Rows per source, by the source's id: what the request and the audit entry keep. */
export function countsOf(sources: readonly FoundSource[]): Record<string, number> {
  return Object.fromEntries(sources.map((source) => [source.id, source.count]));
}

export interface PrivacyExportDeps extends PrivacyFindDeps {
  storage: FileStore;
  secret: string;
  /** A person's text records (`sms/export.ts`); none are written without it. */
  texts?: TextExport | undefined;
  now?: () => number;
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

  // Whether, and how far, the person who asked may still use the privacy action.
  const scope = row.requestedBy === payload.userId ? await privacyScopeOf(meta, payload.userId) : null;
  const refuse = async (): Promise<'failed'> => {
    await repo.markFailed(row.id, 'not-allowed', now());
    await audit('privacy.export.failed', { reason: 'not-allowed' });
    return 'failed';
  };
  if (scope === null) return refuse();
  try {
    const subject = openAddress(deps.secret, payload.address);
    const phone = subject.startsWith(PHONE_SUBJECT) ? subject.slice(PHONE_SUBJECT.length) : null;
    // A staff account's address, for one who holds `privacy.people` alone: nothing is written.
    if (phone === null && !(await refuseStaffAddress(meta, scope, subject).then(() => true, () => false))) return await refuse();
    const country = deps.texts === undefined ? null : await deps.texts.country();
    const extra: ExtraFile[] = [];
    let found: PersonFound;
    let rows: PersonRows | null = null;
    if (phone === null) {
      found = await findPerson(deps, subject, scope.apps);
    } else {
      // By the number: the rows that hold it, as the erasure by phone finds them.
      rows = await findPersonRows({ meta, manager: deps.manager, erasedName: await erasedNameOf(meta), now }, '', scope.apps, { e164: phone, country });
      found = { address: '', person: null, sources: [], lawLinked: [], parcelRows: [] };
      extra.push(...rowsFoundBy(rows));
    }
    if (deps.texts !== undefined) {
      rows ??= await findPersonRows({ meta, manager: deps.manager, erasedName: await erasedNameOf(meta), now }, searchAddress(subject), scope.apps);
      const targets = [...(phone === null ? [] : [{ phone, person: null }]), ...textTargets(rows)];
      extra.push(...(await deps.texts.recordsFor({ targets, country, apps: scope.apps })));
    }
    const at = now();
    const bytes = Buffer.from(personZip(found, at, extra));
    const fileId = newId('file');
    const filename = `person-data-${new Date(at).toISOString().slice(0, 10)}.zip`;
    const stored = await deps.storage.write({ id: fileId, kind: 'export', filename, mime: 'application/zip', bytes });
    await filesRepo(meta).create({ id: fileId, filename, mime: 'application/zip', sizeBytes: stored.sizeBytes, sha256: stored.sha256, kind: 'export', uploadedBy: payload.userId, storageKey: stored.storageKey, destinationId: stored.destinationId, storage: stored.storage }, at);
    const days = await settingsRepo(meta).get('retention.exportsDays');
    const counts = { ...countsOf(found.sources), ...Object.fromEntries(extra.filter((file) => file.rows.length > 0).map((file) => [file.id, file.rows.length])) };
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
