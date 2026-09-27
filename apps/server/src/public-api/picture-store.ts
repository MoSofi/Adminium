// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PICTURE, CLEANED ONCE AND KEPT — beside the file it was cleaned from, in
 * the same destination, so a restart, a second instance or a busy minute
 * never cleans it again (`picture.ts` does the cleaning).
 *
 * The cleaned bytes are stored under a key worked out from the file's id and
 * the cleaning's version, and nothing else: no meta row says where they are,
 * so none can drift. On this server's disk the key keeps the files root's
 * grammar (`file_` and 26 letters): a zero time — no upload is ever given
 * one — and the rest from a hash of the id and the version. A remote
 * destination files it by the original's upload month, as every key there.
 *
 * What is stored is a short header, then the picture as it is served. The
 * header says what the bytes are and their tag, so a browser asking "still
 * this one?" is answered from its first bytes, and the picture is streamed
 * after it without being read into memory. A stored copy that does not read
 * back as one (cut short, another version, not ours) is none: the picture is
 * cleaned again and written over it.
 *
 * The copy goes with the file: the retention sweep that removes a file's
 * bytes removes this too (`removeCleanedPicture`).
 */
import { createHash, randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import type { FileStore } from '../files/store.js';
import { isPictureMime, PICTURE_PIPELINE, type CleanPicture, type PictureMime } from './picture.js';

/** The file a picture was cleaned from: where its bytes are, and when it was uploaded. */
export interface PictureSource {
  id: string;
  destinationId: string | null;
  createdAt: number;
  mime: string;
}

/** What a stored copy says of itself. */
export interface StoredPicture {
  mime: PictureMime;
  etag: string;
  length: number;
}

/** The header's size: fixed, so it is read in one short range. */
const HEADER_BYTES = 160;
const MAGIC = 'ADMPIC';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The id the cleaned copy of a file is kept under: a zero time, then 16 letters of a hash of the file and the version. */
export function cleanedPictureId(fileId: string, pipeline = PICTURE_PIPELINE): string {
  const hash = createHash('sha256').update(`picture|${fileId}|${pipeline}`).digest();
  let tail = '';
  for (let i = 0; i < 16; i += 1) tail += CROCKFORD[hash[i]! % 32];
  return `file_0000000000${tail}`;
}

function headerOf(picture: CleanPicture): Buffer {
  const text = `${MAGIC} ${PICTURE_PIPELINE} ${picture.mime} ${String(picture.bytes.length)} ${picture.etag}\n`;
  const out = Buffer.alloc(HEADER_BYTES, 0x20);
  if (Buffer.byteLength(text, 'latin1') > HEADER_BYTES) throw new Error('a picture header too long');
  out.write(text, 0, 'latin1');
  return out;
}

function readHeader(head: Buffer): StoredPicture | null {
  if (head.length < HEADER_BYTES) return null;
  const line = head.toString('latin1', 0, HEADER_BYTES);
  const end = line.indexOf('\n');
  if (end < 0) return null;
  const [magic, pipeline, mime, length, etag, ...rest] = line.slice(0, end).split(' ');
  if (magic !== MAGIC || pipeline !== PICTURE_PIPELINE || rest.length > 0 || mime === undefined || !isPictureMime(mime) || etag === undefined || !/^\d+$/.test(length ?? '')) return null;
  if (!etag.startsWith(`"${PICTURE_PIPELINE}-`)) return null;
  return { mime: mime as PictureMime, etag, length: Number(length) };
}

async function readAll(stream: Readable, max: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += part.length;
    if (total > max) {
      stream.destroy();
      break;
    }
    parts.push(part);
  }
  return Buffer.concat(parts);
}

export interface PictureStore {
  /** What the stored copy says of itself, from its first bytes; null when there is none that reads back. */
  head(file: PictureSource): Promise<StoredPicture | null>;
  /** The stored copy's picture, streamed after its header; null when there is none that reads back. */
  open(file: PictureSource, expected: StoredPicture): Promise<{ stream: Readable; length: number } | null>;
  /** Keep a cleaned picture beside its file. */
  save(file: PictureSource, picture: CleanPicture): Promise<void>;
  /** Remove the cleaned copy (a missing one is no error). */
  remove(file: Pick<PictureSource, 'id' | 'destinationId' | 'createdAt'>): Promise<void>;
}

export function createPictureStore(storage: Pick<FileStore, 'driverFor'>): PictureStore {
  const keyOf = async (file: Pick<PictureSource, 'id' | 'destinationId' | 'createdAt'>) => {
    const driver = await storage.driverFor(file.destinationId);
    return { driver, key: driver.keyFor({ id: cleanedPictureId(file.id), kind: 'picture', filename: 'picture', createdAt: file.createdAt }) };
  };
  return {
    async head(file) {
      const { driver, key } = await keyOf(file);
      let opened;
      try {
        opened = await driver.open(key, { start: 0, end: HEADER_BYTES - 1 });
      } catch {
        return null;
      }
      const stored = readHeader(await readAll(opened.stream, HEADER_BYTES));
      return stored !== null && stored.mime === file.mime.toLowerCase().split(';')[0]!.trim() ? stored : null;
    },
    async open(file, expected) {
      const { driver, key } = await keyOf(file);
      let opened;
      try {
        opened = await driver.open(key, { start: HEADER_BYTES });
      } catch {
        return null;
      }
      // A copy cut short (or longer than it says) is none: cleaned again.
      if (opened.sizeBytes !== expected.length) {
        opened.stream.destroy();
        return null;
      }
      return { stream: opened.stream, length: expected.length };
    },
    async save(file, picture) {
      const { driver, key } = await keyOf(file);
      const bytes = Buffer.concat([headerOf(picture), picture.bytes]);
      const path = join(tmpdir(), `adminium-picture-${randomBytes(8).toString('hex')}`);
      await writeFile(path, bytes, { mode: 0o600 });
      try {
        await driver.put(key, { path, sizeBytes: bytes.length, mime: 'application/octet-stream', sha256: createHash('sha256').update(bytes).digest('hex') });
      } finally {
        // The local driver moved it; a remote one copied it.
        await rm(path, { force: true });
      }
    },
    async remove(file) {
      const { driver, key } = await keyOf(file);
      await driver.remove(key);
    },
  };
}

/** Remove the cleaned copy of a file whose bytes are going, when it is one a picture could be. */
export async function removeCleanedPicture(storage: Pick<FileStore, 'driverFor'>, file: Pick<PictureSource, 'id' | 'destinationId' | 'createdAt' | 'mime'>): Promise<void> {
  if (!isPictureMime(file.mime)) return;
  await createPictureStore(storage).remove(file);
}
