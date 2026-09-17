// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Content sniffing over a closed allowlist.
 *
 * WHY A HAND-ROLLED TABLE AND NOT `file-type`. Fifteen signatures are fifteen
 * byte comparisons. The dependency is ~40 kB of tables covering hundreds of
 * formats this server refuses anyway, it lands in the Docker image and the
 * Electron bundle, and every one of its formats would have to be re-checked
 * against the allowlist regardless — the allowlist, not the detector, is the
 * security boundary.
 *
 * WHY THE CLIENT'S CONTENT-TYPE IS ADVISORY. It is attacker-controlled. The
 * stored `mime` is always the SNIFFED one, and a mismatch is refused by naming
 * what was actually found — "this is application/pdf, not image/png" is
 * actionable; "invalid file" is not.
 *
 * TEXT HAS NO SIGNATURE, which is the one honest hole in a magic-byte gate.
 * CSV, plain text, Markdown and JSON are bytes that could be anything, so they
 * are admitted by extension AND strict UTF-8 validity: a file claiming `.csv`
 * whose head is not valid UTF-8 (or carries NUL) is refused. That is weaker
 * than a signature and it is why text types are the only ones a caller can
 * reach by claiming an extension.
 */

/** Bytes held back from the head of the stream for this module. */
export const SNIFF_HEAD_BYTES = 8192;

/**
 * The closed allowlist, keyed by the stable id `files.allowedTypes` stores.
 * The key is NOT the mime type: `office` covers three mimes that share one
 * signature, and an operator narrowing the allowlist should not have to know
 * which of `application/vnd.openxmlformats-…` spellings they mean.
 */
export const SNIFF_TYPE_KEYS = [
  'pdf',
  'png',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'svg',
  'zip',
  'office',
  'mp4',
  'mp3',
  'wav',
  'webm',
  'ogg',
  'csv',
  'text',
  'markdown',
  'json',
] as const;

export type SniffTypeKey = (typeof SNIFF_TYPE_KEYS)[number];

export interface SniffedType {
  /** The allowlist key — what `files.allowedTypes` and a column's `accept` name. */
  key: SniffTypeKey;
  /** The mime stored on the row and served back on download. */
  mime: string;
  /** Canonical extension, used only for the remote key layout (D19). */
  ext: string;
}

export interface SniffRefusal {
  /** `unknown` = no signature matched; `mismatch` = the extension claimed a text type the bytes are not. */
  reason: 'unknown' | 'not-text';
  /** What the head actually looks like, for the 415 body. */
  detail: string;
}

export type SniffResult = { ok: true; type: SniffedType } | { ok: false; refusal: SniffRefusal };

/** A binary signature: bytes that must match at an offset, optionally twice. */
interface Signature {
  key: SniffTypeKey;
  mime: string;
  ext: string;
  /** Every clause must match for the signature to fire. */
  at: { offset: number; bytes: readonly number[] }[];
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/**
 * Ordered: the first match wins, so a more specific signature must precede a
 * more general one. The only pair where that matters today is HEIC/MP4 — both
 * are ISO base media containers whose discriminator is the `ftyp` brand at
 * offset 8 — so both are listed with their brands and neither is a bare
 * `ftyp` catch-all.
 */
const SIGNATURES: readonly Signature[] = [
  { key: 'pdf', mime: 'application/pdf', ext: 'pdf', at: [{ offset: 0, bytes: ascii('%PDF-') }] },
  { key: 'png', mime: 'image/png', ext: 'png', at: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  { key: 'jpeg', mime: 'image/jpeg', ext: 'jpg', at: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { key: 'gif', mime: 'image/gif', ext: 'gif', at: [{ offset: 0, bytes: ascii('GIF8') }] },
  // RIFF....WEBP — the four size bytes between are skipped by using two clauses.
  { key: 'webp', mime: 'image/webp', ext: 'webp', at: [{ offset: 0, bytes: ascii('RIFF') }, { offset: 8, bytes: ascii('WEBP') }] },
  { key: 'wav', mime: 'audio/wav', ext: 'wav', at: [{ offset: 0, bytes: ascii('RIFF') }, { offset: 8, bytes: ascii('WAVE') }] },
  { key: 'heic', mime: 'image/heic', ext: 'heic', at: [{ offset: 4, bytes: ascii('ftyp') }, { offset: 8, bytes: ascii('heic') }] },
  { key: 'heic', mime: 'image/heif', ext: 'heif', at: [{ offset: 4, bytes: ascii('ftyp') }, { offset: 8, bytes: ascii('mif1') }] },
  { key: 'mp4', mime: 'video/mp4', ext: 'mp4', at: [{ offset: 4, bytes: ascii('ftyp') }, { offset: 8, bytes: ascii('isom') }] },
  { key: 'mp4', mime: 'video/mp4', ext: 'mp4', at: [{ offset: 4, bytes: ascii('ftyp') }, { offset: 8, bytes: ascii('mp42') }] },
  { key: 'mp4', mime: 'video/quicktime', ext: 'mov', at: [{ offset: 4, bytes: ascii('ftyp') }, { offset: 8, bytes: ascii('qt  ') }] },
  { key: 'mp3', mime: 'audio/mpeg', ext: 'mp3', at: [{ offset: 0, bytes: ascii('ID3') }] },
  // A frame-synced MP3 with no ID3 tag: 11 sync bits. 0xFB/0xF3/0xF2 are the
  // MPEG-1/2 Layer III variants that appear in practice.
  { key: 'mp3', mime: 'audio/mpeg', ext: 'mp3', at: [{ offset: 0, bytes: [0xff, 0xfb] }] },
  { key: 'mp3', mime: 'audio/mpeg', ext: 'mp3', at: [{ offset: 0, bytes: [0xff, 0xf3] }] },
  { key: 'mp3', mime: 'audio/mpeg', ext: 'mp3', at: [{ offset: 0, bytes: [0xff, 0xf2] }] },
  { key: 'webm', mime: 'video/webm', ext: 'webm', at: [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }] },
  { key: 'ogg', mime: 'audio/ogg', ext: 'ogg', at: [{ offset: 0, bytes: ascii('OggS') }] },
];

/** Office documents are zips; only the head's entry names tell them apart. */
const OFFICE_BY_ENTRY: readonly { entry: string; mime: string; ext: string }[] = [
  { entry: 'word/', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  { entry: 'xl/', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  { entry: 'ppt/', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: 'pptx' },
];

/** Text kinds, reachable only via a claimed extension + a UTF-8 head (see header). */
const TEXT_BY_EXTENSION: Readonly<Record<string, SniffedType>> = {
  csv: { key: 'csv', mime: 'text/csv', ext: 'csv' },
  tsv: { key: 'csv', mime: 'text/tab-separated-values', ext: 'tsv' },
  txt: { key: 'text', mime: 'text/plain', ext: 'txt' },
  log: { key: 'text', mime: 'text/plain', ext: 'log' },
  md: { key: 'markdown', mime: 'text/markdown', ext: 'md' },
  markdown: { key: 'markdown', mime: 'text/markdown', ext: 'md' },
  json: { key: 'json', mime: 'application/json', ext: 'json' },
};

function matches(head: Buffer, sig: Signature): boolean {
  return sig.at.every(
    (clause) =>
      head.length >= clause.offset + clause.bytes.length &&
      clause.bytes.every((b, i) => head[clause.offset + i] === b),
  );
}

/** Lowercased extension without the dot; `''` when the name carries none. */
export function extensionOf(filename: string): string {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/**
 * Strict UTF-8 validity over the head, plus a NUL check.
 *
 * `Buffer.toString('utf8')` is lossy — it substitutes U+FFFD rather than
 * failing — so it cannot answer this. `TextDecoder` with `fatal: true` can, at
 * the cost of one false negative this function accepts deliberately: a
 * multi-byte character straddling the 8 KiB boundary looks truncated. The head
 * is therefore trimmed back to the last byte that cannot be a continuation
 * before decoding, which loses at most three bytes of a file whose remaining
 * megabytes are not being checked either.
 */
function isUtf8Text(head: Buffer): boolean {
  if (head.includes(0)) return false;
  let end = head.length;
  for (let i = 0; i < 3 && end > 0; i += 1) {
    const byte = head[end - 1] as number;
    // 10xxxxxx is a continuation byte; a lead byte ends the trim.
    if ((byte & 0xc0) !== 0x80) {
      // A lead byte at the very end announces bytes that are not here.
      if ((byte & 0x80) !== 0) end -= 1;
      break;
    }
    end -= 1;
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

/**
 * SVG is XML, so it has no fixed magic — an XML prologue, a comment, a
 * doctype or whitespace may precede the root element. Scan the (UTF-8, no-NUL)
 * head for `<svg` after skipping what may legally come first.
 */
function looksLikeSvg(head: Buffer): boolean {
  if (!isUtf8Text(head)) return false;
  const text = head.toString('utf8', 0, Math.min(head.length, 2048)).toLowerCase();
  const at = text.indexOf('<svg');
  if (at < 0) return false;
  // Everything before the root element must be prologue, not markup of its own.
  const before = text.slice(0, at).replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/g, '');
  return before.trim().length === 0;
}

/** Zip head: `PK\x03\x04`, then the first local entry's name at offset 30. */
function sniffZip(head: Buffer): SniffedType {
  const nameLength = head.length >= 28 ? head.readUInt16LE(26) : 0;
  const name = head.toString('latin1', 30, Math.min(30 + nameLength, head.length));
  // An OOXML package's first entry is `[Content_Types].xml`; the discriminator
  // is the directory that follows it, which lands inside the same 8 KiB head.
  if (name.startsWith('[Content_Types].xml')) {
    const window = head.toString('latin1', 0, Math.min(head.length, 4096));
    for (const office of OFFICE_BY_ENTRY) {
      if (window.includes(office.entry)) return { key: 'office', mime: office.mime, ext: office.ext };
    }
  }
  return { key: 'zip', mime: 'application/zip', ext: 'zip' };
}

/**
 * Identify the bytes. `filename` is used ONLY to reach the text kinds, which
 * have no signature; it can never override a binary signature that matched.
 */
export function sniff(head: Buffer, filename: string): SniffResult {
  for (const sig of SIGNATURES) {
    if (matches(head, sig)) return { ok: true, type: { key: sig.key, mime: sig.mime, ext: sig.ext } };
  }
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    return { ok: true, type: sniffZip(head) };
  }
  if (looksLikeSvg(head)) return { ok: true, type: { key: 'svg', mime: 'image/svg+xml', ext: 'svg' } };

  const ext = extensionOf(filename);
  const text = TEXT_BY_EXTENSION[ext];
  if (text !== undefined) {
    if (isUtf8Text(head)) return { ok: true, type: text };
    return {
      ok: false,
      refusal: { reason: 'not-text', detail: `.${ext} must be valid UTF-8 text; these bytes are not` },
    };
  }
  return {
    ok: false,
    refusal: {
      reason: 'unknown',
      detail: head.length === 0 ? 'the file is empty' : `unrecognised content (starts with ${describeHead(head)})`,
    },
  };
}

/** A short, safe rendering of the head for an error body — hex, never the bytes themselves. */
function describeHead(head: Buffer): string {
  return `0x${head.subarray(0, 4).toString('hex')}`;
}

/** Every mime the allowlist can produce — the OpenAPI enum and the docs read this. */
export function mimesForKeys(keys: readonly SniffTypeKey[]): string[] {
  const set = new Set<string>();
  for (const sig of SIGNATURES) if (keys.includes(sig.key)) set.add(sig.mime);
  for (const office of OFFICE_BY_ENTRY) if (keys.includes('office')) set.add(office.mime);
  for (const text of Object.values(TEXT_BY_EXTENSION)) if (keys.includes(text.key)) set.add(text.mime);
  if (keys.includes('svg')) set.add('image/svg+xml');
  if (keys.includes('zip')) set.add('application/zip');
  return [...set].sort();
}
