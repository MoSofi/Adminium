// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FILES FROM STRANGERS: taken, kept unattached for a while, attached by the
 * stranger's next write, removed with the row that took them.
 *
 * Generic: a form's file question is the first caller (`routes/forms-door/
 * files.ts`); an app's public write is the next (a file column a guest may
 * fill). Each caller says what a file is taken FOR (the binding: a kind and
 * a key, `form` + `<add-on>/<form id>`), which kinds it takes from the closed
 * list ({@link PUBLIC_UPLOAD_KINDS}) and how large one may be.
 *
 * ─── TAKING ONE ────────────────────────────────────────────────────────────
 *  1. The address's day: past `publicUploads.perAddressDaily` files from one
 *     network address (its /64) in 24 hours, refused (`cap`) before a byte is
 *     read.
 *  2. The store's room: once the files kept (attached or not) reach
 *     `publicUploads.quotaBytes`, refused (`quota`) before a byte is read, and
 *     again after, when this one would pass it.
 *  3. The bytes go through the engine's one upload path (`files/store.ts`
 *     `putUpload`): spooled with the caller's cap, the spool cut off and the
 *     body no longer read the moment it passes (`too-big`); the content
 *     sniffed, never the name or the type the browser claims (`kind`: a
 *     script renamed `.jpg` has no JPEG in it; a HEIC photo is no kind on the
 *     list); a picture read again without what the camera wrote beside it
 *     (`cleanPicture`: the place it was taken, the device). The file row is of
 *     kind `stranger`, which no staff files route serves.
 *  4. A row in `adminium_public_uploads`: a 32-character random id (the
 *     stranger's handle), the binding with the keyed hash of the address, the
 *     cleaned name, size and kind, and an expiry two hours on.
 *  The owner is told when 1 or 2 refuses, once an hour (`notices.ts`).
 *
 * ─── ATTACHING ─────────────────────────────────────────────────────────────
 * {@link PublicUploads.attach}: every id must be there, unattached, unexpired
 * and of exactly the write's binding (the same form, the same address), or
 * none is attached and the write is refused. The owner is the row the files
 * became part of (connection, table, key).
 *
 * ─── REMOVING ──────────────────────────────────────────────────────────────
 * Bytes first, then the file row, then this row: a crash between leaves a row
 * that names nothing, never bytes nothing names. Unattached files are swept
 * once their time is up ({@link PublicUploads.sweep}); attached ones go with
 * their row ({@link PublicUploads.removeOwned}) or with what they were taken
 * for ({@link PublicUploads.removeBound}).
 *
 * Never served to the public: staff open one through the grant of the row
 * that owns it (`routes/forms-files/`).
 */
import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';

import { filesRepo, publicUploadsRepo, settingsRepo, type MetaDb, type PublicUpload, type PublicUploadBinding, type PublicUploadOwner, type StoredFile } from '@adminium/meta';

import { rateAddress } from '../public-api/limiter.js';
import { SpoolTooLargeError } from '../files/spool.js';
import { UnsupportedFileTypeError, type FileStore } from '../files/store.js';
import type { SniffTypeKey } from '../files/sniff.js';
import type { UploadTrip } from './notices.js';

/**
 * The closed list of kinds a stranger may upload, each with the sniffed type
 * it must be. Pictures (cleaned of camera data), PDF and plain text. A caller
 * takes a part of it; plan 73's TIFF (stored, never drawn) is one more line
 * here. SVG and HEIC are never on it.
 */
export const PUBLIC_UPLOAD_KINDS = {
  jpg: 'jpeg',
  png: 'png',
  pdf: 'pdf',
  text: 'text',
} as const satisfies Readonly<Record<string, SniffTypeKey>>;
export type PublicUploadKind = keyof typeof PUBLIC_UPLOAD_KINDS;

/** How long an unattached file waits for the write that takes it. */
export const UPLOAD_TTL_MS = 2 * 3_600_000;
/** The window the per-address cap counts over. */
export const UPLOAD_DAY_MS = 24 * 3_600_000;
/** The longest name kept, in characters. */
export const UPLOAD_NAME_MAX = 255;

/** Why a file was not taken. */
export type UploadRefusal = 'too-big' | 'kind' | 'quota' | 'cap';

/** A file taken, as its stranger is told it. */
export interface TakenUpload {
  id: string;
  name: string;
  size: number;
  kind: PublicUploadKind;
}

export type TakeResult = { ok: true; upload: TakenUpload } | { ok: false; code: UploadRefusal };

export interface TakeInput {
  source: Readable;
  /** The name the browser gave: cleaned, never trusted for the kind. */
  name: string;
  /** What it is taken for (`form`, `<add-on>/<form id>`). */
  binding: { kind: string; key: string };
  /** The stranger's network address. */
  ip: string;
  kinds: readonly PublicUploadKind[];
  /** The largest file taken, in bytes. */
  maxBytes: number;
}

export interface PublicUploadsDeps {
  meta: MetaDb;
  storage: Pick<FileStore, 'putUpload' | 'remove' | 'open'>;
  /** `ADMINIUM_SECRET`: what addresses are hashed under. */
  secret: string;
  /** The owner is told uploads are refused (once an hour each; see `notices.ts`). */
  tell?: ((trip: UploadTrip, values: { gb?: string; n?: number }, at: number) => Promise<unknown>) | undefined;
  log?: { warn: (fields: Record<string, unknown>, message: string) => void } | undefined;
  now?: () => number;
}

/** The key an address is hashed under for uploads: its own derivation, so no other use of the secret shares it. */
function uploadAddressKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'adminium-public-uploads-v1', 'address', 32));
}

/**
 * A name as it is kept and shown: the last part of any path, no control or
 * direction-changing characters, spaces run together, at most 255 characters
 * (the end, with its extension, kept). Never empty.
 */
export function cleanUploadName(raw: string): string {
  const base = raw.normalize('NFC').split(/[/\\]/).pop() ?? '';
  // C0 and C1 controls, and the marks that turn text around (a name that reads "gpj.exe" as "exe.jpg").
  // eslint-disable-next-line no-control-regex -- the control characters are what this takes out
  const plain = base.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();
  const chars = [...plain];
  if (chars.length === 0) return 'file';
  if (chars.length <= UPLOAD_NAME_MAX) return plain;
  const dot = plain.lastIndexOf('.');
  const ext = dot > 0 ? [...plain.slice(dot)] : [];
  const keep = ext.length > 0 && ext.length <= 16 ? ext : [];
  return [...chars.slice(0, UPLOAD_NAME_MAX - keep.length), ...keep].join('');
}

/** The kind word for a sniffed type, among the caller's. */
function kindOf(sniffed: SniffTypeKey, kinds: readonly PublicUploadKind[]): PublicUploadKind | null {
  return kinds.find((kind) => PUBLIC_UPLOAD_KINDS[kind] === sniffed) ?? null;
}

const GB = 1024 * 1024 * 1024;

export function createPublicUploads(deps: PublicUploadsDeps) {
  const { meta, storage } = deps;
  const now = deps.now ?? Date.now;
  const repo = publicUploadsRepo(meta);
  const files = filesRepo(meta);
  const settings = settingsRepo(meta);
  const addressKey = uploadAddressKey(deps.secret);

  /** The binding of a write from `ip`: what it is for, and the keyed hash of the address's /64. */
  function bindingOf(kind: string, key: string, ip: string): PublicUploadBinding {
    return { kind, key, addressKey: createHmac('sha256', addressKey).update(rateAddress(ip)).digest('hex') };
  }

  async function tell(trip: UploadTrip, values: { gb?: string; n?: number }, at: number): Promise<void> {
    if (deps.tell === undefined) return;
    try {
      await deps.tell(trip, values, at);
    } catch (error) {
      deps.log?.warn({ err: error, trip }, 'public uploads: the owner could not be told');
    }
  }

  async function quotaRefusal(at: number, adding: number): Promise<TakeResult | null> {
    const quota = await settings.get('publicUploads.quotaBytes');
    const kept = await repo.keptBytes();
    // Before reading: refused once the store is full. After: refused when this file would pass the quota.
    if (adding === 0 ? kept < quota : kept + adding <= quota) return null;
    await tell('quota', { gb: (Math.round((quota / GB) * 10) / 10).toString() }, at);
    return { ok: false, code: 'quota' };
  }

  /** The bytes of one file, then its file row; failures are logged and left for a later pass. */
  async function dropBytes(upload: PublicUpload): Promise<boolean> {
    if (upload.fileId === null) return true;
    try {
      const file = await files.findById(upload.fileId);
      if (file !== null) {
        await storage.remove(file);
        await files.purge(file.id);
      }
      return true;
    } catch (error) {
      deps.log?.warn({ err: error, upload: upload.id }, 'public uploads: a file’s bytes could not be removed');
      return false;
    }
  }

  /** Remove these files whole: bytes, file rows, then their rows. Answers how many went. */
  async function removeAll(uploads: readonly PublicUpload[]): Promise<number> {
    const gone: string[] = [];
    for (const upload of uploads) if (await dropBytes(upload)) gone.push(upload.id);
    return repo.delete(gone);
  }

  return {
    bindingOf,

    async take(input: TakeInput): Promise<TakeResult> {
      const at = now();
      const binding = bindingOf(input.binding.kind, input.binding.key, input.ip);
      const cap = await settings.get('publicUploads.perAddressDaily');
      if ((await repo.countFrom(binding.addressKey, at - UPLOAD_DAY_MS)) >= cap) {
        await tell('cap', { n: cap }, at);
        return { ok: false, code: 'cap' };
      }
      const full = await quotaRefusal(at, 0);
      if (full !== null) return full;

      const name = cleanUploadName(input.name);
      const allowed = [...new Set(input.kinds.map((kind) => PUBLIC_UPLOAD_KINDS[kind]))];
      let stored: StoredFile;
      let kind: PublicUploadKind | null;
      try {
        const put = await storage.putUpload({ kind: 'stranger', filename: name, source: input.source, maxBytes: input.maxBytes, allowedTypes: allowed, uploadedBy: null, clean: true, at });
        stored = put.file;
        kind = kindOf(put.sniffed.key, input.kinds);
      } catch (error) {
        if (error instanceof SpoolTooLargeError) return { ok: false, code: 'too-big' };
        if (error instanceof UnsupportedFileTypeError) return { ok: false, code: 'kind' };
        throw error;
      }
      const drop = async () => {
        await storage.remove(stored).catch(() => undefined);
        await files.purge(stored.id).catch(() => undefined);
      };
      if (kind === null) {
        await drop();
        return { ok: false, code: 'kind' };
      }
      // Room checked again with this file in it: two strangers at the edge do not both get in.
      const over = await quotaRefusal(at, stored.sizeBytes);
      if (over !== null) {
        await drop();
        return over;
      }
      const id = randomBytes(24).toString('base64url');
      try {
        await repo.create({ id, binding, name, size: stored.sizeBytes, kind, fileId: stored.id, expiresAt: at + UPLOAD_TTL_MS }, at);
      } catch (error) {
        await drop();
        throw error;
      }
      return { ok: true, upload: { id, name, size: stored.sizeBytes, kind } };
    },

    /**
     * Attach `ids` to `owner`: each must be there, unattached, unexpired and
     * of exactly `binding` (the same thing, the same address), or none is.
     * Answers the files attached, or `null` when the write must be refused.
     */
    async attach(ids: readonly string[], binding: PublicUploadBinding, owner: PublicUploadOwner): Promise<PublicUpload[] | null> {
      if (ids.length === 0) return [];
      if (!(await repo.attach(ids, binding, owner, now()))) return null;
      return repo.findMany(ids);
    },

    /** Let go of files a write took that then did not stand: unattached again, for another two hours. */
    async detach(ids: readonly string[], owner: PublicUploadOwner): Promise<number> {
      return repo.detach(ids, owner, now() + UPLOAD_TTL_MS);
    },

    /** The files the rows `keys` of one table took. */
    list: (connectionId: string, table: string, keys: readonly string[]): Promise<PublicUpload[]> => repo.ownedBy(connectionId, table, keys),

    /** Every file taken for one thing (a form) that still holds its bytes, attached or not. */
    listBound: (kind: string, key: string): Promise<PublicUpload[]> => repo.boundTo(kind, key),

    /** The files the rows `keys` of one table took, removed whole. Answers how many went. */
    async removeOwned(connectionId: string, table: string, keys: readonly string[]): Promise<number> {
      return removeAll(await repo.ownedBy(connectionId, table, keys));
    },

    /** Every file taken for one thing (a form), attached or not, removed whole. */
    async removeBound(kind: string, key: string): Promise<number> {
      return removeAll(await repo.boundTo(kind, key));
    },

    /** One file and its bytes, for staff to open; null when it has none (swept, or never there). */
    async open(id: string): Promise<{ upload: PublicUpload; file: StoredFile } | null> {
      const upload = await repo.findById(id);
      if (upload === null || upload.fileId === null) return null;
      const file = await files.findById(upload.fileId);
      if (file === null || file.kind !== 'stranger' || file.deletedAt !== null) return null;
      return { upload, file };
    },

    /**
     * Unattached files whose time is up: their bytes and names go (the row
     * stays, empty, for the address's day), and empty rows past that day go.
     */
    async sweep(): Promise<{ swept: number; dropped: number }> {
      const at = now();
      let swept = 0;
      for (;;) {
        const due = await repo.expiredBefore(at, 100);
        let moved = 0;
        for (const upload of due) {
          // Bytes first: a file past its time can no longer be attached (attach asks for an expiry still ahead).
          if (!(await dropBytes(upload))) continue;
          if (await repo.markRemoved(upload.id, at)) swept += 1;
          moved += 1;
        }
        // A page whose files would not go: left for the next pass, which always ends.
        if (due.length < 100 || moved === 0) break;
      }
      const dropped = await repo.dropRemovedBefore(at - UPLOAD_DAY_MS);
      return { swept, dropped };
    },
  };
}

export type PublicUploads = ReturnType<typeof createPublicUploads>;
