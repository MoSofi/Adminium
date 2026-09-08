// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `FileStore` — the one seam every byte Adminium stores goes through
 * (37-files-and-storage.md §3.1, D1, D18).
 *
 * Above it: exports, imports, the branding logo, schema files, report
 * snapshots, uploads, and (34) rendered documents. Below it: three drivers and
 * a destination table. This module is what makes "one seam, many destinations"
 * true rather than aspirational — there is no second place that opens a file.
 *
 * ONE DEFAULT FOR EVERY KIND (D18/D38). When a default destination exists,
 * every NEW row of every kind is written there. Not just uploads: an export
 * artifact and a branding logo are not safer on a disk that does not persist,
 * and `deploy/do-app.yaml` says in its own header that App Platform containers
 * have none — which is why, today, every export and the uploaded logo is lost
 * on each redeploy with the meta row left pointing at nothing. One seam with
 * one default is the only rule an operator can predict, and it closes that
 * defect as a side effect.
 *
 * EXISTING ROWS ARE NEVER MOVED by writing. A row's own `destination_id` is
 * where its bytes are, forever, until the migrate job (D20) says otherwise.
 * Changing the default changes where the NEXT file goes and nothing else.
 *
 * WITH NO DESTINATION CONFIGURED THIS IS BYTE-IDENTICAL TO WHAT SHIPPED. The
 * implicit destination is `<dataDir>/files` with the flat `file_<ULID>` key
 * grammar, which is what `files/storage.ts` has done since M4 — so the
 * exports, imports, branding and schema-import suites pass unchanged, and a
 * store that never opens Studio → Storage sees no difference at all.
 */

import type { Readable } from 'node:stream';

import type { FileKind, FilesRepo, RecordRef, StoredFile } from '@adminium/meta';
import { newId } from '@adminium/meta';

import type { DestinationResolver } from './destinations.js';
import type { ByteRange, FileDriver, OpenedBytes } from './drivers/driver.js';
import { sniff, type SniffTypeKey, type SniffedType } from './sniff.js';
import type { Spool, SpooledFile } from './spool.js';

/** Everything a row needs to say where its bytes are. */
export interface StoredBytes {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  /** NULL = this server's disk (D3). */
  destinationId: string | null;
  /** The driver that wrote them; informational (`destination_id` is the authority). */
  storage: string;
}

/** The subset of a file row this module needs to find bytes again. */
export interface ByteLocation {
  destinationId: string | null;
  storageKey: string;
}

export interface StoreWriter {
  write(chunk: Buffer | string): Promise<void>;
  /** Finish, hand the bytes to the driver, and report what the row should say. */
  close(): Promise<StoredBytes>;
  abort(): Promise<void>;
}

/** An upload that failed the allowlist or the sniffing gate (D8). */
export class UnsupportedFileTypeError extends Error {
  override readonly name = 'UnsupportedFileTypeError';
  constructor(message: string, readonly sniffedMime?: string) {
    super(message);
  }
}

export interface PutUploadInput {
  kind: FileKind;
  filename: string;
  /** The request's `content-type`. ADVISORY — the sniffed type is what is stored. */
  claimedMime?: string | undefined;
  source: Readable;
  maxBytes: number;
  /** The `files.allowedTypes` setting, narrowed by a column's `accept` when there is one. */
  allowedTypes: readonly SniffTypeKey[];
  uploadedBy?: string | null | undefined;
  /** Attach at creation, when the record already exists. */
  entity?: RecordRef | null | undefined;
  /**
   * The connection this file belongs to when no record claims it yet (38 D4).
   * Ignored when `entity` is given, which carries its own.
   */
  entityConnectionId?: string | undefined;
  /**
   * Is this file CLAIMED, with no record behind it? — the library upload.
   *
   * The distinction this flag exists for, and it is not derivable from
   * `entityConnectionId`, because two different things carry a connection and
   * no record:
   *
   *   - the create form, whose record does not exist YET. Unclaimed: if the
   *     form is abandoned the daily sweep must collect the file, which it does
   *     by looking for `attached_at IS NULL`.
   *   - the Files page's own upload, which belongs to the workspace and to
   *     nothing else. Claimed: there is no later write coming to claim it, so
   *     leaving it unstamped would delete it within `files.unattachedHours`.
   *
   * Getting this wrong is silent in both directions — one leaks abandoned
   * uploads forever, the other deletes the operator's library overnight.
   */
  claimed?: boolean | undefined;
  /** Override the default destination — a per-column choice, or the migrate job. */
  destinationId?: string | null | undefined;
  at?: number;
}

export interface PutUploadResult {
  file: StoredFile;
  sniffed: SniffedType;
}

export interface FileStore {
  /** Where a NEW file of any kind goes right now; `null` is this server's disk. */
  defaultDestinationId(): Promise<string | null>;

  /**
   * Write a finished buffer under a PRE-MINTED id. The id-first contract is
   * the repo's (`CreateFileInput.id` exists "so the storage layer can write
   * bytes under the final id first"), and it is what lets a failure leave
   * bytes with no row rather than a row with no bytes.
   */
  write(input: { id: string; kind: string; filename: string; mime: string; bytes: Buffer | string; destinationId?: string | null }): Promise<StoredBytes>;

  /** Incremental writer for producers that push pages in (`export-run`). */
  openWriter(input: { id: string; kind: string; filename: string; mime: string; destinationId?: string | null }): Promise<StoreWriter>;

  /** Read a row's bytes, optionally a range. */
  open(file: ByteLocation, range?: ByteRange): Promise<OpenedBytes>;

  /** Read a row's bytes as a stream — the shape the pre-0024 callers used. */
  read(file: ByteLocation): Promise<Readable>;

  head(file: ByteLocation): Promise<{ sizeBytes: number } | null>;

  /** Idempotent; a missing object is success. */
  remove(file: ByteLocation): Promise<void>;

  /**
   * The upload path (§3.3): spool → sniff → allowlist → driver → row. Used by
   * the `/files` routes; the byte-level methods above are what the pre-existing
   * artifact pipelines use, because they have already decided what they are
   * writing and do not go through a content gate.
   */
  putUpload(input: PutUploadInput): Promise<PutUploadResult>;

  /** The driver for a destination — the Test button and the migrate job need one. */
  driverFor(destinationId: string | null): Promise<FileDriver>;
}

export interface FileStoreOptions {
  spool: Spool;
  destinations: DestinationResolver;
  files: FilesRepo;
}

export function createFileStore(opts: FileStoreOptions): FileStore {
  const { spool, destinations, files } = opts;

  /**
   * Resolve where to write. An explicitly named destination wins (a per-column
   * choice, or the migrate job's target); otherwise the default; otherwise this
   * server's disk. `undefined` and `null` mean different things here —
   * `undefined` is "you decide", `null` is "the local disk, explicitly" — which
   * is why the parameter is not simply defaulted.
   */
  async function chooseDestination(explicit: string | null | undefined): Promise<string | null> {
    if (explicit !== undefined) return explicit;
    return destinations.defaultDestinationId();
  }

  /** Hand a finished spool file to a driver and report what the row should say. */
  async function commit(
    spooled: SpooledFile,
    input: { id: string; kind: string; filename: string; mime: string; createdAt: number },
    destinationId: string | null,
  ): Promise<StoredBytes> {
    const driver = await destinations.driverFor(destinationId);
    const storageKey = driver.keyFor({ id: input.id, kind: input.kind, filename: input.filename, createdAt: input.createdAt });
    try {
      await driver.put(storageKey, {
        path: spooled.path,
        sizeBytes: spooled.sizeBytes,
        mime: input.mime,
        sha256: spooled.sha256,
      });
    } finally {
      // On local this is already a rename and the spool file is gone; on a
      // remote driver the copy stays until here. Either way `release` is
      // idempotent, so this needs no branch.
      await spooled.release();
    }
    return {
      storageKey,
      sizeBytes: spooled.sizeBytes,
      sha256: spooled.sha256,
      destinationId,
      storage: driver.kind,
    };
  }

  return {
    defaultDestinationId: () => destinations.defaultDestinationId(),
    driverFor: (destinationId) => destinations.driverFor(destinationId),

    async write(input) {
      const destinationId = await chooseDestination(input.destinationId);
      const writer = await spool.openWriter();
      let spooled: SpooledFile;
      try {
        await writer.write(input.bytes);
        spooled = await writer.close();
      } catch (error) {
        await writer.abort();
        throw error;
      }
      return commit(spooled, { ...input, createdAt: Date.now() }, destinationId);
    },

    async openWriter(input) {
      const destinationId = await chooseDestination(input.destinationId);
      const writer = await spool.openWriter();
      const createdAt = Date.now();
      return {
        write: (chunk) => writer.write(chunk),
        close: async () => commit(await writer.close(), { ...input, createdAt }, destinationId),
        abort: () => writer.abort(),
      };
    },

    async open(file, range) {
      const driver = await destinations.driverFor(file.destinationId);
      return driver.open(file.storageKey, range);
    },

    async read(file) {
      const driver = await destinations.driverFor(file.destinationId);
      return (await driver.open(file.storageKey)).stream;
    },

    async head(file) {
      const driver = await destinations.driverFor(file.destinationId);
      return driver.head(file.storageKey);
    },

    async remove(file) {
      const driver = await destinations.driverFor(file.destinationId);
      await driver.remove(file.storageKey);
    },

    async putUpload(input) {
      const at = input.at ?? Date.now();
      const destinationId = await chooseDestination(input.destinationId);
      // The id is minted BEFORE the bytes land, because it is part of the key
      // on every driver — the repo's pre-minted-id contract, used as designed.
      const id = newId('file');

      const spooled = await spool.spool(input.source, { maxBytes: input.maxBytes });

      // The gate runs on the spooled head, never on the client's claim. A
      // refusal here has already cost one local write and nothing else — no
      // object in a bucket to clean up, which is the whole point of D4.
      const result = sniff(spooled.head, input.filename);
      if (!result.ok) {
        await spooled.release();
        throw new UnsupportedFileTypeError(
          result.refusal.reason === 'not-text'
            ? `That file cannot be stored: ${result.refusal.detail}.`
            : `That file type is not accepted: ${result.refusal.detail}.`,
        );
      }
      if (!input.allowedTypes.includes(result.type.key)) {
        await spooled.release();
        throw new UnsupportedFileTypeError(
          `Files of type ${result.type.mime} are not accepted here.`,
          result.type.mime,
        );
      }

      const bytes = await commit(
        spooled,
        { id, kind: input.kind, filename: input.filename, mime: result.type.mime, createdAt: at },
        destinationId,
      );

      const file = await files.create(
        {
          id,
          filename: input.filename,
          mime: result.type.mime,
          sizeBytes: bytes.sizeBytes,
          sha256: bytes.sha256,
          kind: input.kind,
          storageKey: bytes.storageKey,
          destinationId: bytes.destinationId,
          storage: bytes.storage,
          uploadedBy: input.uploadedBy ?? null,
          ...(input.entity === undefined || input.entity === null ? {} : { entity: input.entity, attachedAt: at }),
          // No record yet: the row still records its connection, and stamps
          // `attachedAt` only when nothing is coming to claim it later.
          ...(input.entity == null && input.entityConnectionId !== undefined
            ? {
                entityConnectionId: input.entityConnectionId,
                ...(input.claimed === true ? { attachedAt: at } : {}),
              }
            : {}),
        },
        at,
      );
      return { file, sniffed: result.type };
    },
  };
}
