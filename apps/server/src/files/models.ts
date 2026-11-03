// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SHOP'S MODELS AND FONTS, told by their whole bytes before they are kept.
 *
 * The sniffer reads a file's head (`sniff.ts`). Four kinds need more than a
 * head to be what they say, because a 3D viewer or a slicer in the shopper's
 * browser opens them, and what it opens must hold no surprise:
 *
 *  - GLB (a preview model): glTF 2, its declared length the file's length,
 *    a JSON chunk of at most 4 MB that parses, every buffer and picture inside
 *    the file's own binary chunk (no `uri` anywhere: a viewer would fetch it,
 *    from anywhere), and only extensions a viewer draws without a decoder of
 *    its own (`KHR_materials_*`, `KHR_texture_transform`,
 *    `KHR_mesh_quantization`; Draco, meshopt and Basis textures refused).
 *  - STL (a print model) has no signature at all. It is reached by its name
 *    (`.stl`) and taken only in one of its two forms: binary, when 84 + 50 × n
 *    bytes is exactly its size (n at offset 80), whatever its 80-byte header
 *    says (many exporters write "solid" there); otherwise text, read whole by
 *    its grammar (`solid` … `endsolid`, every facet three vertices). Never by
 *    "starts with solid".
 *  - 3MF (a print model) is a zip. It is read from its central directory
 *    (`designer/site/zip.ts`'s strict rules, a piece of the file at a time,
 *    never the whole file held): at most 64 entries, each declared size within
 *    the 200 MB the whole may unpack to, `[Content_Types].xml`, `_rels/.rels`
 *    and the model part the relationships name. The two small parts are read
 *    at most 64 KB each; the model part is inflated as a stream that stops the
 *    moment it passes what it declared, so a small file declaring a small part
 *    that unpacks to gigabytes is refused after a few kilobytes of work, and
 *    one declaring a huge part is refused before any inflating at all.
 *  - WOFF2 (a web font): `wOF2`, and the length its header declares is its
 *    size. Browsers check a font's tables themselves before drawing it.
 *
 * Every refusal is a {@link ModelRefused} whose message the person reads.
 */
import { createReadStream, readSync, openSync, closeSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createInflateRaw, crc32 } from 'node:zlib';

import { readZipDirectoryOf, ZipRefusal, type ZipBytes, type ZipEntry } from '../designer/site/zip.js';
import { extensionOf, MODEL_TYPES, type SniffResult, type SniffTypeKey } from './sniff.js';

/** A file that is not the model or font it was taken for, with the sentence the person reads. */
export class ModelRefused extends Error {
  override readonly name = 'ModelRefused';
}

/** A spooled file: where its bytes are, how many, and its head. */
export interface WholeFile {
  path: string;
  sizeBytes: number;
  head: Buffer;
}

function refuse(message: string): never {
  throw new ModelRefused(message);
}

/* ───────────────────────────────────────────────────────────────────── GLB */

/** The largest JSON chunk a GLB may carry: what describes the model, not the model. */
export const GLB_JSON_MAX_BYTES = 4 * 1024 * 1024;

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/** Extensions a viewer draws with nothing of its own to fetch or decode. */
const GLB_EXTENSIONS_ALLOWED = (name: string): boolean => name.startsWith('KHR_materials_') || name === 'KHR_texture_transform' || name === 'KHR_mesh_quantization';

/** Said by name, because each needs a decoder the viewer would have to fetch. */
const GLB_EXTENSIONS_NAMED: Readonly<Record<string, string>> = {
  KHR_draco_mesh_compression: 'Draco compression',
  EXT_meshopt_compression: 'meshopt compression',
  KHR_meshopt_compression: 'meshopt compression',
  KHR_texture_basisu: 'Basis Universal textures',
};

/** The pictures a GLB may carry inside it. */
const GLB_IMAGE_MIMES = new Set(['image/png', 'image/jpeg']);

/** Whether a value, at any depth, has a property named `uri`: a file the viewer would fetch from elsewhere. */
function holdsUri(node: unknown, depth = 0): boolean {
  if (depth > 64) return refuse('This model is nested too deeply to be read.');
  if (Array.isArray(node)) return node.some((item) => holdsUri(item, depth + 1));
  if (typeof node !== 'object' || node === null) return false;
  return Object.entries(node).some(([key, value]) => key === 'uri' || holdsUri(value, depth + 1));
}

/** Read `length` bytes at `position` of an open file, all of them or a refusal. */
async function readAt(path: string, position: number, length: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const out = Buffer.alloc(length);
    const { bytesRead } = await handle.read(out, 0, length, position);
    if (bytesRead !== length) refuse('This file ends before it should.');
    return out;
  } finally {
    await handle.close();
  }
}

/** A GLB a shopper's viewer opens: self-contained glTF 2, as the header says. */
export async function checkGlb(file: WholeFile): Promise<void> {
  const { head, sizeBytes } = file;
  if (sizeBytes < 20 || head.length < 20 || head.readUInt32LE(0) !== GLB_MAGIC) refuse('This is not a GLB model.');
  if (head.readUInt32LE(4) !== 2) refuse('This GLB is not glTF 2, the only version taken.');
  if (head.readUInt32LE(8) !== sizeBytes) refuse('This GLB is not as long as its header says: it was cut short or has bytes after it.');
  const jsonLength = head.readUInt32LE(12);
  if (head.readUInt32LE(16) !== CHUNK_JSON) refuse('This GLB does not start with its description (JSON) chunk.');
  if (jsonLength > GLB_JSON_MAX_BYTES) refuse('The description inside this GLB is over 4 MB.');
  const jsonEnd = 20 + jsonLength;
  if (jsonLength === 0 || jsonEnd > sizeBytes) refuse('The description inside this GLB runs past its end.');

  // After the description: nothing, or exactly one binary chunk running to the end.
  let binLength: number | null = null;
  if (jsonEnd < sizeBytes) {
    if (jsonEnd + 8 > sizeBytes) refuse('This GLB has bytes after its description that are no chunk.');
    const chunk = await readAt(file.path, jsonEnd, 8);
    if (chunk.readUInt32LE(4) !== CHUNK_BIN) refuse('This GLB has a chunk after its description that is not its binary data.');
    binLength = chunk.readUInt32LE(0);
    if (jsonEnd + 8 + binLength !== sizeBytes) refuse('The binary data inside this GLB is not as long as it says.');
  }

  let json: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await readAt(file.path, 20, jsonLength));
    json = JSON.parse(text);
  } catch (error) {
    if (error instanceof ModelRefused) throw error;
    refuse('The description inside this GLB is not JSON that can be read.');
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) refuse('The description inside this GLB is not a glTF document.');
  const doc = json as Record<string, unknown>;
  const asset = doc['asset'];
  if (typeof asset !== 'object' || asset === null || typeof (asset as Record<string, unknown>)['version'] !== 'string' || !String((asset as Record<string, unknown>)['version']).startsWith('2.')) {
    refuse('This GLB does not say it is glTF 2.');
  }

  // Nothing fetched from anywhere: no `uri` at any depth, so every buffer and picture is inside the file.
  if (holdsUri(doc)) refuse('This GLB points at files outside it (a "uri"). Export it with everything embedded (one .glb file).');

  const extensions = new Set<string>();
  for (const key of ['extensionsUsed', 'extensionsRequired'] as const) {
    const named = doc[key];
    if (named === undefined) continue;
    if (!Array.isArray(named) || named.some((name) => typeof name !== 'string')) refuse(`This GLB's ${key} is not a list of names.`);
    for (const name of named as string[]) extensions.add(name);
  }
  for (const name of extensions) {
    const said = GLB_EXTENSIONS_NAMED[name];
    if (said !== undefined) refuse(`This GLB uses ${said}, which a shopper's viewer cannot open. Export it without compression.`);
    if (!GLB_EXTENSIONS_ALLOWED(name)) refuse(`This GLB uses the extension ${name}, which is not one taken here.`);
  }

  // One buffer at most, and it is the binary chunk: the only buffer with no `uri` a GLB may have.
  const buffers = doc['buffers'];
  if (buffers !== undefined) {
    if (!Array.isArray(buffers)) refuse("This GLB's buffers are not a list.");
    const list = buffers as unknown[];
    if (list.length > 1) refuse('This GLB has more than one buffer; only its own binary chunk is taken.');
    if (list.length === 1) {
      const byteLength = (list[0] as Record<string, unknown> | null)?.['byteLength'];
      if (binLength === null) refuse('This GLB names a buffer but carries no binary data.');
      if (typeof byteLength !== 'number' || !Number.isInteger(byteLength) || byteLength < 0 || byteLength > binLength) refuse("This GLB's buffer is larger than its binary data.");
    }
  }
  const images = doc['images'];
  if (images !== undefined) {
    if (!Array.isArray(images)) refuse("This GLB's pictures are not a list.");
    for (const image of images as unknown[]) {
      const one = (image ?? {}) as Record<string, unknown>;
      if (typeof one['bufferView'] !== 'number') refuse('A picture in this GLB is not inside the file.');
      if (typeof one['mimeType'] !== 'string' || !GLB_IMAGE_MIMES.has(one['mimeType'])) refuse('A picture in this GLB is not a PNG or a JPEG.');
    }
  }
}

/* ───────────────────────────────────────────────────────────────────── STL */

/** Whether an STL is the binary form: 84 + 50 × n bytes exactly, n at offset 80, at least one triangle. */
export function isBinaryStl(head: Buffer, sizeBytes: number): boolean {
  if (sizeBytes < 84 + 50 || head.length < 84) return false;
  const triangles = head.readUInt32LE(80);
  return triangles >= 1 && 84 + 50 * triangles === sizeBytes;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Whether a text STL is one by its grammar, read line by line to its end:
 * `solid [name]`, then facets — `facet normal x y z`, `outer loop`, three
 * `vertex x y z`, `endloop`, `endfacet` — then `endsolid [name]`; one solid
 * after another, nothing else but blank lines. Words in any case.
 */
export async function isTextStl(path: string): Promise<boolean> {
  const input = createReadStream(path, { encoding: 'latin1' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  type State = 'start' | 'solid' | 'loop' | 'vertex' | 'endloop' | 'endfacet';
  let state: State = 'start';
  let vertices = 0;
  let facets = 0;
  const numbers = (words: string[], from: number, count: number): boolean => words.length === from + count && words.slice(from).every((word) => NUMBER.test(word));
  try {
    for await (const raw of lines) {
      if (raw.includes('\0')) return false;
      const line = raw.trim();
      if (line === '') continue;
      const words = line.split(/\s+/);
      const first = words[0]!.toLowerCase();
      switch (state) {
        case 'start':
          if (first !== 'solid') return false;
          state = 'solid';
          break;
        case 'solid':
          if (first === 'endsolid') {
            state = 'start';
          } else if (first === 'facet' && words[1]?.toLowerCase() === 'normal' && numbers(words, 2, 3)) {
            state = 'loop';
          } else return false;
          break;
        case 'loop':
          if (first !== 'outer' || words[1]?.toLowerCase() !== 'loop' || words.length !== 2) return false;
          state = 'vertex';
          vertices = 0;
          break;
        case 'vertex':
          if (first !== 'vertex' || !numbers(words, 1, 3)) return false;
          vertices += 1;
          if (vertices === 3) state = 'endloop';
          break;
        case 'endloop':
          if (first !== 'endloop' || words.length !== 1) return false;
          state = 'endfacet';
          break;
        case 'endfacet':
          if (first !== 'endfacet' || words.length !== 1) return false;
          facets += 1;
          state = 'solid';
          break;
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return state === 'start' && facets >= 1;
}

/* ───────────────────────────────────────────────────────────────────── 3MF */

/** The most entries a 3MF may hold. */
export const THREE_MF_MAX_ENTRIES = 64;
/** The most all of a 3MF's entries together may unpack to. */
export const THREE_MF_MAX_UNPACKED = 200 * 1024 * 1024;
/** The most the package's own two small parts (its content types and relationships) may be. */
export const THREE_MF_PART_MAX = 64 * 1024;

const MODEL_RELATIONSHIP = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const MODEL_CONTENT_TYPE = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';

/**
 * A zip on disk, read a piece at a time: the end of the file (where the end
 * record and its comment are) once, then each header where it is.
 */
function fileZipBytes(fd: number, sizeBytes: number): ZipBytes {
  const tailFrom = Math.max(0, sizeBytes - (22 + 0xffff));
  const tail = Buffer.alloc(sizeBytes - tailFrom);
  if (readSync(fd, tail, 0, tail.length, tailFrom) !== tail.length) refuse('This file ends before it should.');
  const bytes = (from: number, to: number): Buffer => {
    if (from < 0 || to > sizeBytes || to < from) throw new RangeError('outside the file');
    if (from >= tailFrom) return tail.subarray(from - tailFrom, to - tailFrom);
    const out = Buffer.alloc(to - from);
    if (readSync(fd, out, 0, out.length, from) !== out.length) throw new RangeError('outside the file');
    return out;
  };
  return { length: sizeBytes, u16: (at) => bytes(at, at + 2).readUInt16LE(0), u32: (at) => bytes(at, at + 4).readUInt32LE(0), bytes };
}

/** The entries of a zip on disk, by the strict reader's rules, held to a 3MF's 64. */
export function readZipEntriesOnDisk(file: Pick<WholeFile, 'path' | 'sizeBytes'>): ZipEntry[] {
  const fd = openSync(file.path, 'r');
  try {
    return readZipDirectoryOf(fileZipBytes(fd, file.sizeBytes), 'This 3MF', { maxEntries: THREE_MF_MAX_ENTRIES });
  } finally {
    closeSync(fd);
  }
}

/**
 * One entry, inflated as a stream that stops past `cap` or past what the
 * entry declares; its length and checksum then checked. Never more than one
 * chunk of the inflater's output held at once beyond what is kept.
 */
async function inflateEntry(path: string, entry: ZipEntry, cap: number, keep: number): Promise<Buffer> {
  const damaged = (): ModelRefused => new ModelRefused(`This 3MF is damaged: ${entry.name} does not match its own size or checksum.`);
  if (entry.size > cap) throw new ModelRefused(`${entry.name} in this 3MF says it unpacks to more than is taken.`);
  if (entry.dataEnd === entry.dataStart) {
    if (entry.size !== 0) throw damaged();
    return Buffer.alloc(0);
  }
  const source = createReadStream(path, { start: entry.dataStart, end: entry.dataEnd - 1 });
  const inflater = entry.method === 8 ? createInflateRaw() : null;
  const stream = inflater === null ? source : source.pipe(inflater);
  const kept: Buffer[] = [];
  let keptBytes = 0;
  let total = 0;
  let crc = 0;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      total += chunk.length;
      // The running cap: past what it declared is a lie, and nothing more is inflated.
      if (total > entry.size) throw damaged();
      crc = crc32(chunk, crc);
      if (keptBytes < keep) {
        const piece = chunk.subarray(0, keep - keptBytes);
        kept.push(piece);
        keptBytes += piece.length;
      }
    }
  } catch (error) {
    if (error instanceof ModelRefused) throw error;
    throw damaged();
  } finally {
    source.destroy();
    inflater?.destroy();
  }
  if (total !== entry.size || crc >>> 0 !== entry.crc) throw damaged();
  return Buffer.concat(kept);
}

/** The value of one attribute of an XML start tag, read plainly (the two small parts are not drawn by anyone). */
function attributeOf(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return match === null ? undefined : (match[2] ?? match[3]);
}

/** Whether a zip's entry names say it is a 3MF package: its relationships, its content types, and a model part. */
export function namesA3mf(entries: readonly ZipEntry[]): boolean {
  const names = new Set(entries.map((entry) => entry.name));
  return names.has('_rels/.rels') && names.has('[Content_Types].xml') && entries.some((entry) => /^3D\/[^/]+\.model$/i.test(entry.name));
}

/** A 3MF a slicer opens: the package's parts, and its model part, within the caps. */
export async function check3mf(file: WholeFile, given?: readonly ZipEntry[]): Promise<void> {
  let entries: readonly ZipEntry[];
  try {
    entries = given ?? readZipEntriesOnDisk(file);
  } catch (error) {
    if (error instanceof ZipRefusal) refuse(error.reason === 'ZIP_TOO_MANY' ? `This 3MF has more than ${String(THREE_MF_MAX_ENTRIES)} files inside it.` : `This 3MF cannot be read: ${error.message}`);
    if (error instanceof RangeError) refuse('This 3MF cannot be read: it ends before it should.');
    throw error;
  }
  // Declared sizes first, before anything is inflated: one over the cap, or all together over it, is refused here.
  let unpacked = 0;
  for (const entry of entries) {
    if (entry.type === 'link' || entry.type === 'other') refuse(`This 3MF holds ${entry.name}, which is not a file.`);
    if (entry.size > THREE_MF_MAX_UNPACKED) refuse(`${entry.name} in this 3MF says it unpacks to more than 200 MB.`);
    unpacked += entry.size;
  }
  if (unpacked > THREE_MF_MAX_UNPACKED) refuse('This 3MF unpacks to more than 200 MB.');

  const named = (name: string): ZipEntry | undefined => entries.find((entry) => entry.name === name);
  const types = named('[Content_Types].xml');
  const rels = named('_rels/.rels');
  if (types === undefined || rels === undefined) refuse('This is not a 3MF: it has no package parts ([Content_Types].xml and _rels/.rels).');
  for (const part of [types, rels]) if (part.size > THREE_MF_PART_MAX) refuse(`${part.name} in this 3MF is over 64 KB.`);

  const typesText = (await inflateEntry(file.path, types, THREE_MF_PART_MAX, THREE_MF_PART_MAX)).toString('utf8');
  if (!typesText.includes(MODEL_CONTENT_TYPE)) refuse('This is not a 3MF: its content types name no 3D model.');
  const relsText = (await inflateEntry(file.path, rels, THREE_MF_PART_MAX, THREE_MF_PART_MAX)).toString('utf8');
  const relationships = relsText.match(/<Relationship\b[^>]*>/g) ?? [];
  const model = relationships.find((tag) => attributeOf(tag, 'Type') === MODEL_RELATIONSHIP);
  const target = model === undefined ? undefined : attributeOf(model, 'Target');
  if (target === undefined || target === '') refuse('This is not a 3MF: it names no model part.');
  const part = named(target.replace(/^\//, ''));
  if (part === undefined) refuse(`This is not a 3MF: its model part ${target} is missing.`);

  // The model part, inflated as a stream within its declared size and the cap; its start must be a 3MF model.
  const start = (await inflateEntry(file.path, part, THREE_MF_MAX_UNPACKED, 4096)).toString('utf8');
  const root = start.replace(/^﻿/, '').replace(/^\s*<\?xml[^>]*\?>/, '').replace(/^(\s*<!--[\s\S]*?-->)*/, '').trimStart();
  if (!/^<model[\s>]/.test(root)) refuse(`This is not a 3MF: ${part.name} is not a 3D model.`);
}

/* ─────────────────────────────────────────────────────────────────── WOFF2 */

/** A WOFF2 font: its signature, at least one table, and the length its header declares. */
export function checkWoff2(file: Pick<WholeFile, 'head' | 'sizeBytes'>): void {
  const { head, sizeBytes } = file;
  if (head.length < 48 || head.toString('latin1', 0, 4) !== 'wOF2') refuse('This is not a WOFF2 font.');
  if (head.readUInt32BE(8) !== sizeBytes) refuse('This WOFF2 font is not as long as its header says.');
  if (head.readUInt16BE(12) === 0) refuse('This WOFF2 font has no tables.');
}

/* ─────────────────────────────────────────────────────────────── the gate */

/**
 * What a spooled file is, once its whole bytes are read for the kinds that
 * need them. The sniffer's answer stands for every other kind. Only the kinds
 * this upload may take are read whole: one the upload does not take is
 * refused by the allowlist after, at no cost.
 *
 *  - a GLB or a WOFF2 by its signature: checked whole, refused if wrong;
 *  - a file named `.stl`: an STL when its form says so; otherwise what the
 *    sniffer found, or refused as no STL;
 *  - a zip named `.3mf`, or whose own entries name a 3MF's parts: checked as
 *    a 3MF, refused if wrong (a plain zip renamed is refused as no 3MF).
 */
export async function confirmKind(file: WholeFile, sniffed: SniffResult, filename: string, allowed: readonly SniffTypeKey[]): Promise<SniffResult> {
  const ext = extensionOf(filename);
  const takes = (key: SniffTypeKey): boolean => allowed.includes(key);
  if (sniffed.ok && sniffed.type.key === 'glb' && takes('glb')) {
    await checkGlb(file);
    return sniffed;
  }
  if (sniffed.ok && sniffed.type.key === 'woff2' && takes('woff2')) {
    checkWoff2(file);
    return sniffed;
  }
  if (ext === 'stl' && takes('stl')) {
    if (isBinaryStl(file.head, file.sizeBytes) || (await isTextStl(file.path))) return { ok: true, type: { ...MODEL_TYPES.stl } };
    if (!sniffed.ok || !takes(sniffed.type.key)) refuse('This is not an STL model: it is neither a binary STL of the size its header says nor a text STL.');
    return sniffed;
  }
  if (sniffed.ok && sniffed.type.key === 'zip' && takes('3mf')) {
    let entries: ZipEntry[] | null = null;
    try {
      entries = readZipEntriesOnDisk(file);
    } catch (error) {
      if (!(error instanceof ZipRefusal) && !(error instanceof RangeError)) throw error;
      if (ext === '3mf') await check3mf(file);
    }
    if (ext === '3mf' || (entries !== null && namesA3mf(entries))) {
      await check3mf(file, entries ?? undefined);
      return { ok: true, type: { ...MODEL_TYPES['3mf'] } };
    }
  }
  return sniffed;
}
