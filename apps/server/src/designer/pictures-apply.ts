// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Filling picture spots from the picture dialog, with no turn.
 *
 * Apply is a write of several files that must not be seen half done: a page
 * that shows a CC BY picture without its credit would say something untrue.
 * So it goes in this order:
 *
 *  1. Every picture is fetched first, outside the hold of the app's folder
 *     (`prepareFills`): a pick from a search was fetched when the person
 *     picked it, and is read from the session's folder; one whose page of
 *     results is gone is said back as gone ("Search again to use this
 *     picture"), and the rest go on.
 *  2. Then, under the hold (`writeFills`), each spot and row is checked
 *     against the version the dialog was opened with: one someone changed
 *     since is not written over, and is said back with what it is now. The
 *     others are written, each file whole (a temporary file, then a rename):
 *     the picture files, `CREDITS.json`, the sample rows, and `spots.json`
 *     last. `spots.json` is the commit point: an extra credit line is
 *     harmless, a missing one is not.
 *
 * A row's picture is the sample row's own file (`seeds/pictures/`), never one
 * another row names: rows keep one file each.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { checkApp } from '../project/apps/check-app.js';
import { lookInUse } from '../project/apps/look.js';
import { hasOwnBuild } from '../project/apps/own-build.js';
import { DEFAULT_LOOK } from '../project/apps/scaffold-app.js';
import { appDir, SIDES } from '../project/apps/read-app.js';
import type { Attachments } from './attachments.js';
import { holdsPeople, pictureWords } from './picture-words.js';
import type { LicenceCode } from './licences.js';
import { creditOf, UNSPLASH_HOST, type FoundPicture, type PictureCredit, type PictureShape } from './pictures.js';
import type { PictureDialog } from './picture-dialog.js';
import { CREDITS_FILE, PICTURES_DIR, plainWords, readCredits, readPictureFile, readSpots, spotsText, SPOTS_FILE, spotVersion, writeWhole, type SpotEntry } from './spots.js';
import type { PictureSites } from './tool-types.js';

export const FILLS_MAX = 60;
export const APPLY_IDS_KEPT = 20;
const ALT_MAX = 250;

export type FillFrom = { shelf: string; picture: string } | { attachment: string } | { file: string } | { placeholder: true };

/** One line of "what changes": a spot or a sample row, the version it was opened at, and where its picture comes from. */
export interface Fill {
  spot?: string;
  row?: { table: string; row: number };
  version: string;
  from: FillFrom;
  alt?: string;
  decorative?: boolean;
}

export type FillState = 'applied' | 'conflict' | 'gone';

export interface FillResult {
  /** `spot:hero`, `row:dishes:3`. */
  target: string;
  state: FillState;
  /** Applied with the source's small copy: the original was too large or gone. */
  small?: true;
}

/** A spot as the dialog draws it. */
export interface DialogSpot {
  id: string;
  label: string;
  shape: PictureShape;
  shows: string;
  search: string;
  version: string;
  /** Where its picture is shown from in the dialog; null for a wireframe. */
  thumb: string | null;
  /** The words a picture made with AI starts from, by plain code. */
  words: string;
  alt: string;
  decorative: boolean;
  licence: { code: LicenceCode; name: string; title: string; creator: string } | null;
}

export interface DialogRow {
  row: number;
  label: string;
  version: string;
  thumb: string | null;
  /** The words a picture made for this row starts from: no row name in it for a table of people. */
  words: string;
}

/** A column whose sample rows share a few values: "one picture for each" of them. */
export interface DialogGroup {
  column: string;
  label: string;
  values: { value: string; rows: number[]; words: string }[];
}

export interface DialogTable {
  table: string;
  label: string;
  column: string;
  rows: DialogRow[];
  /** The table holds people: their names are never sent to make a picture. */
  people: boolean;
  groups: DialogGroup[];
}

export interface InAppPicture {
  /** `file:<path under assets/pictures/>` or `attachment:<id>`. */
  key: string;
  name: string;
  thumb: string;
  licence: LicenceCode;
}

const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

interface Bundle {
  format?: string;
  assets?: Record<string, { file: string; sha256?: string }>;
  tables?: { ref: string; rows: Record<string, unknown>[] }[];
  [more: string]: unknown;
}

const bundleFile = (root: string, key: string): string => join(appDir(root, key), 'seeds', 'sample.json');

function readBundle(root: string, key: string): Bundle | null {
  try {
    const parsed = JSON.parse(readFileSync(bundleFile(root, key), 'utf8')) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Bundle) : null;
  } catch {
    return null;
  }
}

/** A sample row's picture as it is now: the version an Apply names, so a row someone changed is not written over. */
export const rowVersion = (value: unknown): string => sha(JSON.stringify(value ?? null)).slice(0, 16);

/** The app's name and what the person said of its look: what a made picture's words say it is for. */
function appWords(root: string, key: string, version: string): { name: string; look: string } {
  const manifest = checkApp(root, key, { version }).manifest;
  const raw = (manifest as { name?: unknown } | null)?.name;
  const name = typeof raw === 'string' ? raw : typeof (raw as Record<string, unknown> | undefined)?.['en-US'] === 'string' ? ((raw as Record<string, string>)['en-US'] as string) : '';
  let look = '';
  try {
    const parsed = JSON.parse(readFileSync(join(appDir(root, key), 'look.json'), 'utf8')) as { words?: unknown };
    if (typeof parsed.words === 'string') look = parsed.words;
  } catch {
    // No look, or one that does not read: the words say nothing of it.
  }
  return { name, look };
}

/** The tables whose sample rows take a picture: a text column marked as a picture, with sample rows. */
export function pictureTables(root: string, key: string, version: string): { table: string; label: string; column: string; labelColumn: string | null; columns: { ref: string; label: string; type: string; semantic?: string }[] }[] {
  const manifest = checkApp(root, key, { version }).manifest;
  if (manifest === null || manifest.kind !== 'app') return [];
  const out: { table: string; label: string; column: string; labelColumn: string | null; columns: { ref: string; label: string; type: string; semantic?: string }[] }[] = [];
  for (const table of manifest.requiredSchema?.tables ?? []) {
    const column = table.columns.find((candidate) => candidate.type === 'text' && 'semantic' in candidate && candidate.semantic === 'image');
    if (column === undefined) continue;
    const named = ['name', 'title', 'label'].find((ref) => table.columns.some((candidate) => candidate.ref === ref && candidate.type === 'text'));
    const text = table.columns.find((candidate) => candidate.type === 'text' && candidate.ref !== column.ref && !('semantic' in candidate && candidate.semantic === 'image'));
    const label = typeof table.label === 'string' ? table.label : typeof (table.label as Record<string, unknown> | undefined)?.['en-US'] === 'string' ? ((table.label as Record<string, string>)['en-US'] as string) : table.ref;
    const columnLabel = (candidate: { ref: string; label?: unknown }): string =>
      typeof candidate.label === 'string' ? candidate.label : typeof (candidate.label as Record<string, unknown> | undefined)?.['en-US'] === 'string' ? ((candidate.label as Record<string, string>)['en-US'] as string) : candidate.ref;
    const columns = table.columns.map((candidate) => ({
      ref: candidate.ref,
      label: columnLabel(candidate as { ref: string; label?: unknown }),
      type: candidate.type,
      ...('semantic' in candidate && typeof candidate.semantic === 'string' ? { semantic: candidate.semantic } : {}),
    }));
    out.push({ table: table.ref, label, column: column.ref, labelColumn: named ?? text?.ref ?? null, columns });
  }
  return out;
}

/**
 * The pictures an app's screens import from `assets/pictures/` themselves,
 * not through a spot: an app made before spots. The logo is the app's mark,
 * not a picture to swap.
 */
export function legacyPictures(root: string, key: string): string[] {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:tsx|jsx|ts|js)$/.test(entry.name)) {
        for (const match of readFileSync(path, 'utf8').matchAll(/\bimport\s+\w+\s+from\s+['"](?:\.\.\/)+assets\/pictures\/([^'"]+\.(?:jpe?g|png|webp|gif|avif))['"]/gi)) found.add(match[1] as string);
      }
    }
  };
  for (const side of SIDES) walk(join(appDir(root, key), side, 'src'));
  return [...found].sort();
}

/** The first table whose sample rows wait for a picture, as the person reads it, and how many rows wait; null when none does. */
export function emptyPictureRows(root: string, key: string, version: string): { table: string; count: number } | null {
  const bundle = readBundle(root, key);
  if (bundle === null) return null;
  for (const table of pictureTables(root, key, version)) {
    const rows = bundle.tables?.find((candidate) => candidate.ref === table.table)?.rows ?? [];
    const count = rows.filter((row) => row[table.column] === null || row[table.column] === undefined).length;
    if (count > 0) return { table: table.label, count };
  }
  return null;
}

/** What the picture dialog draws, for an app: its spots, its tables' sample rows, and the pictures already in it. */
export function picturesState(
  root: string,
  key: string,
  opts: { sessionId: string; version: string; attachments?: Attachments; fileUrl: (path: string) => string; attachmentUrl: (id: string) => string },
): { ownBuild: boolean; spots: DialogSpot[]; tables: DialogTable[]; inApp: InAppPicture[]; mode: 'placeholders' | 'choose' | null; legacy: number } {
  if (hasOwnBuild(root, key)) return { ownBuild: true, spots: [], tables: [], inApp: [], mode: 'placeholders', legacy: 0 };
  const credits = readCredits(root, key);
  const creditFor = (file: string): PictureCredit | undefined => credits.find((line) => line.file === file);
  const app = appWords(root, key, opts.version);
  const spots = readSpots(root, key).map((spot): DialogSpot => {
    const isAddress = spot.file !== null && spot.file.startsWith('https:');
    const file = spot.file === null ? null : isAddress ? spot.file : `${PICTURES_DIR}/${spot.file}`;
    const present = spot.file !== null && (isAddress || readPictureFile(root, key, spot.file) !== null);
    const credit = file === null ? undefined : creditFor(file);
    return {
      id: spot.id,
      label: spot.label,
      shape: spot.shape,
      shows: spot.shows,
      search: spot.search,
      words: pictureWords({ subject: spot.search || spot.shows || spot.label, appName: app.name, look: app.look, shape: spot.shape }),
      version: spotVersion(spot),
      thumb: !present || file === null ? null : isAddress ? file : opts.fileUrl(file),
      alt: spot.alt,
      decorative: spot.decorative,
      licence: file === null || !present ? null : { code: credit?.licenceCode ?? 'own', name: credit?.licence ?? '', title: credit?.title ?? '', creator: credit?.creator ?? '' },
    };
  });
  const bundle = readBundle(root, key);
  const tables = pictureTables(root, key, opts.version).flatMap((table): DialogTable[] => {
    const rows = bundle?.tables?.find((candidate) => candidate.ref === table.table)?.rows ?? [];
    if (rows.length === 0) return [];
    const people = holdsPeople(table.columns.map((column) => ({ name: column.ref, semantic: column.semantic })));
    const wordsFor = (subject: string): string => pictureWords({ subject, table: table.label, appName: app.name, look: app.look, shape: 'square', people });
    // Text and choice columns only, never ids, numbers or yes/no: 2 to 12 values, at least one shared by two rows.
    const groups = table.columns.flatMap((column): DialogGroup[] => {
      if (column.ref === table.column || column.ref === table.labelColumn || !['text', 'enum'].includes(column.type) || /(^|_)id$/i.test(column.ref) || column.semantic !== undefined) return [];
      const byValue = new Map<string, number[]>();
      rows.forEach((row, index) => {
        const value = row[column.ref];
        if (typeof value !== 'string' || value.trim() === '' || value.length > 80) return;
        byValue.set(value, [...(byValue.get(value) ?? []), index + 1]);
      });
      if (byValue.size < 2 || byValue.size > 12 || ![...byValue.values()].some((list) => list.length > 1)) return [];
      return [{ column: column.ref, label: column.label, values: [...byValue.entries()].map(([value, list]) => ({ value: plainWords(value, 80), rows: list, words: wordsFor(value) })) }];
    });
    return [
      {
        table: table.table,
        label: table.label,
        column: table.column,
        people,
        groups,
        rows: rows.map((row, index): DialogRow => {
          const value = row[table.column];
          const asset = value !== null && typeof value === 'object' ? bundle?.assets?.[String((value as Record<string, unknown>)['@asset'])] : undefined;
          const own = table.labelColumn === null ? null : row[table.labelColumn];
          const label = plainWords(typeof own === 'string' || typeof own === 'number' ? String(own) : '', 60) || `#${String(index + 1)}`;
          return {
            row: index + 1,
            label,
            words: wordsFor(label),
            version: rowVersion(value),
            thumb: asset !== undefined && typeof asset.file === 'string' && asset.file.startsWith('seeds/pictures/') ? opts.fileUrl(asset.file) : null,
          };
        }),
      },
    ];
  });
  const inApp: InAppPicture[] = [];
  const dir = join(appDir(root, key), ...PICTURES_DIR.split('/'));
  const walk = (folder: string, rel: string): void => {
    if (!existsSync(folder) || inApp.length >= 60) return;
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const path = `${rel}${entry.name}`;
      if (entry.isDirectory()) walk(join(folder, entry.name), `${path}/`);
      else if (readPictureFile(root, key, path) !== null && inApp.length < 60) inApp.push({ key: `file:${path}`, name: entry.name, thumb: opts.fileUrl(`${PICTURES_DIR}/${path}`), licence: creditFor(`${PICTURES_DIR}/${path}`)?.licenceCode ?? 'own' });
    }
  };
  walk(dir, '');
  for (const entry of opts.attachments?.list(opts.sessionId) ?? []) {
    if (entry.kind !== 'image' || entry.partOf !== undefined || entry.source !== undefined) continue;
    inApp.push({ key: `attachment:${entry.id}`, name: entry.label, thumb: opts.attachmentUrl(entry.id), licence: 'own' });
  }
  // The look the sides are drawn with keeps the choice (a style's, written by the first Apply that changes it); a look kept before styles cannot.
  const look = lookInUse(root, key, DEFAULT_LOOK);
  return { ownBuild: false, spots, tables, inApp, mode: look.direction === undefined ? (look.pictures ?? 'placeholders') : null, legacy: legacyPictures(root, key).length };
}

/** A fill whose picture is in hand, ready to be written under the hold. */
export interface Prepared {
  fill: Fill;
  target: string;
  /** The picture's bytes to write as a file; absent for a placeholder, a file already in the app, or a picture shown from its source's site. */
  bytes?: { data: Buffer; ext: string; sha256: string };
  /** A file already in `assets/pictures/`, used as it is. */
  file?: string;
  /** An address the picture is shown from (Unsplash). */
  shown?: string;
  credit?: Omit<PictureCredit, 'file'>;
  small?: boolean;
  /** The search result, to tell its source it was chosen once it is written. */
  picked?: FoundPicture;
  alt: string;
  decorative: boolean;
}

export const targetOf = (fill: Fill): string => (fill.spot !== undefined ? `spot:${fill.spot}` : `row:${fill.row?.table ?? ''}:${String(fill.row?.row ?? 0)}`);

/**
 * Every fill's picture in hand, before anything of the app is held: a pick
 * from a search from the session's own folder, an attachment's bytes, a file
 * already in the app. What cannot be had comes back as gone.
 */
export async function prepareFills(
  fills: readonly Fill[],
  ctx: { root: string; key: string; sessionId: string; dialog: PictureDialog; attachments?: Attachments; signal?: AbortSignal },
): Promise<{ ready: Prepared[]; gone: FillResult[] }> {
  const ready: Prepared[] = [];
  const gone: FillResult[] = [];
  for (const fill of fills) {
    const target = targetOf(fill);
    const alt = plainWords(fill.alt, ALT_MAX);
    const decorative = fill.decorative === true;
    if ('placeholder' in fill.from) {
      ready.push({ fill, target, alt: '', decorative: false });
      continue;
    }
    if ('shelf' in fill.from) {
      const picked = await ctx.dialog.picked(ctx.sessionId, fill.from.shelf, fill.from.picture, ctx.signal);
      if (picked === null) {
        gone.push({ target, state: 'gone' });
        continue;
      }
      const { file: _file, ...credit } = creditOf(picked.picture, '');
      if (picked.staged === null) {
        // Shown from the source's own site (Unsplash), never copied: a page can show only a spot, never a row, from there.
        if (picked.picture.shown === undefined || fill.spot === undefined) {
          gone.push({ target, state: 'gone' });
          continue;
        }
        ready.push({ fill, target, shown: picked.picture.shown, credit, picked: picked.picture, alt, decorative });
        continue;
      }
      ready.push({ fill, target, bytes: { data: picked.staged.bytes, ext: picked.staged.ext, sha256: picked.staged.sha256 }, credit, ...(picked.staged.small ? { small: true } : {}), picked: picked.picture, alt, decorative });
      continue;
    }
    if ('attachment' in fill.from) {
      const entry = ctx.attachments?.find(ctx.sessionId, fill.from.attachment) ?? null;
      const bytes = entry !== null && entry.kind === 'image' && entry.partOf === undefined && entry.source === undefined ? (ctx.attachments?.read(ctx.sessionId, entry.id) ?? null) : null;
      const picture = bytes === null ? null : readPictureBytes(bytes);
      if (picture === null) {
        gone.push({ target, state: 'gone' });
        continue;
      }
      ready.push({ fill, target, bytes: { data: bytes as Buffer, ext: picture, sha256: sha(bytes as Buffer) }, alt, decorative });
      continue;
    }
    const found = readPictureFile(ctx.root, ctx.key, fill.from.file);
    if (found === null) {
      gone.push({ target, state: 'gone' });
      continue;
    }
    // A row keeps a file of its own: a file already in the app is copied for it. A spot names the file as it is.
    if (fill.row !== undefined) ready.push({ fill, target, bytes: { data: found.bytes, ext: EXT_OF[found.mime] ?? 'jpg', sha256: sha(found.bytes) }, alt, decorative });
    else ready.push({ fill, target, file: found.path, alt, decorative });
  }
  return { ready, gone };
}

const EXT_OF: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

function readPictureBytes(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('latin1'))) return 'gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

export interface WriteOutcome {
  results: FillResult[];
  /** What was changed, by name, for the version and the chat: "Hero", "Spicy wings". */
  names: string[];
  /** A sample row took a new picture: the installed sample rows are added again. */
  rows: boolean;
  /** Search results written, to tell their source they were chosen. */
  chosen: FoundPicture[];
}

/**
 * Write what is ready, under the hold: each spot or row checked against the
 * version it was opened at, then the picture files, `CREDITS.json`, the
 * sample rows and `spots.json`, in that order, each whole.
 */
export async function writeFills(
  ready: readonly Prepared[],
  ctx: { root: string; key: string; version: string; by: { id: string | null; label: string }; pictureSites?: PictureSites; seam?: (step: 'write', detail: string) => void | Promise<void> },
): Promise<WriteOutcome> {
  const dir = appDir(ctx.root, ctx.key);
  const spots = readSpots(ctx.root, ctx.key);
  const bundle = readBundle(ctx.root, ctx.key);
  const tables = ready.some((one) => one.fill.row !== undefined) ? pictureTables(ctx.root, ctx.key, ctx.version) : [];
  const results: FillResult[] = [];
  const names: string[] = [];
  const credits = readCredits(ctx.root, ctx.key);
  const chosen: FoundPicture[] = [];
  const files: { path: string; data: Buffer }[] = [];
  const nextSpots = spots.map((spot) => ({ ...spot }));
  let rowsChanged = false;
  const freshCredits: PictureCredit[] = [];
  /** A picture file this Apply writes for a table's rows, by its bytes: written once, named by every row that shows it. */
  const sharedFiles = new Map<string, string>();
  /** The files sample rows named before this Apply. */
  const rowFilesBefore = Object.values(bundle?.assets ?? {}).map((asset) => asset.file);

  for (const one of ready) {
    if (one.fill.spot !== undefined) {
      const spot = nextSpots.find((candidate) => candidate.id === one.fill.spot);
      const before = spots.find((candidate) => candidate.id === one.fill.spot);
      if (spot === undefined || before === undefined || spotVersion(before) !== one.fill.version) {
        results.push({ target: one.target, state: 'conflict' });
        continue;
      }
      let file: string | null = null;
      if (one.bytes !== undefined) {
        const name = `${spot.id}-${one.bytes.sha256.slice(0, 8)}.${one.bytes.ext}`;
        files.push({ path: `${PICTURES_DIR}/${name}`, data: one.bytes.data });
        file = name;
      } else if (one.file !== undefined) file = one.file;
      else if (one.shown !== undefined) {
        const host = new URL(one.shown).hostname;
        // Shown from Unsplash's own site: only where the page may be let load pictures from it. The person's Apply is their yes.
        if (host !== UNSPLASH_HOST || ctx.pictureSites === undefined || (!ctx.pictureSites.covers(host) && ctx.pictureSites.closed() !== null)) {
          results.push({ target: one.target, state: 'gone' });
          continue;
        }
        if (!ctx.pictureSites.covers(host)) ctx.pictureSites.add(host, ctx.by);
        file = one.shown;
      }
      spot.file = file;
      spot.alt = file === null ? '' : one.decorative ? '' : one.alt;
      spot.decorative = file !== null && one.decorative;
      if (one.credit !== undefined && file !== null) freshCredits.push({ ...one.credit, file: file.startsWith('https:') ? file : `${PICTURES_DIR}/${file}` });
      if (one.picked !== undefined) chosen.push(one.picked);
      names.push(spot.label);
      results.push({ target: one.target, state: 'applied', ...(one.small === true ? { small: true as const } : {}) });
      continue;
    }
    // A sample row: its own file, in its own place.
    const row = one.fill.row as { table: string; row: number };
    const table = tables.find((candidate) => candidate.table === row.table);
    const rows = bundle?.tables?.find((candidate) => candidate.ref === row.table)?.rows;
    const at = rows?.[row.row - 1];
    if (table === undefined || at === undefined || rowVersion(at[table.column]) !== one.fill.version) {
      results.push({ target: one.target, state: 'conflict' });
      continue;
    }
    if (one.bytes === undefined) at[table.column] = null;
    else {
      // The same picture on several rows of a table is one file every row names.
      const sharedKey = `${row.table}\u0000${one.bytes.sha256}`;
      const shared = sharedFiles.get(sharedKey);
      const path = shared ?? `seeds/pictures/${row.table}-${String(row.row)}-${one.bytes.sha256.slice(0, 8)}.${one.bytes.ext}`;
      if (shared === undefined) {
        sharedFiles.set(sharedKey, path);
        files.push({ path, data: one.bytes.data });
        if (one.credit !== undefined) freshCredits.push({ ...one.credit, file: path });
      }
      const label = `picture-${row.table}-${String(row.row)}`;
      (bundle as Bundle).assets = { ...((bundle as Bundle).assets ?? {}), [label]: { file: path, sha256: one.bytes.sha256 } };
      at[table.column] = { '@asset': label };
    }
    if (one.picked !== undefined) chosen.push(one.picked);
    const own = table.labelColumn === null ? null : at[table.labelColumn];
    names.push(plainWords(typeof own === 'string' || typeof own === 'number' ? String(own) : '', 60) || `${table.label} ${String(row.row)}`);
    rowsChanged = true;
    results.push({ target: one.target, state: 'applied', ...(one.small === true ? { small: true as const } : {}) });
  }

  if (!results.some((result) => result.state === 'applied')) return { results, names, rows: false, chosen: [] };

  // 1. The picture files.
  for (const file of files) {
    await ctx.seam?.('write', file.path);
    writeWhole(join(dir, ...file.path.split('/')), file.data);
  }
  // 2. The credits: every picture a spot or a row now shows that asks for one, and none for a picture nothing shows.
  const shownFiles = new Set<string>([
    ...nextSpots.flatMap((spot) => (spot.file === null ? [] : [spot.file.startsWith('https:') ? spot.file : `${PICTURES_DIR}/${spot.file}`])),
    ...Object.values((bundle as Bundle | null)?.assets ?? {}).map((asset) => asset.file),
  ]);
  const madeHere = (file: string): boolean => /^(assets\/pictures\/[a-z][a-z0-9-]*-[0-9a-f]{8}\.[a-z]+|seeds\/pictures\/.+-[0-9a-f]{8}\.[a-z]+|https:.*)$/.test(file);
  const kept = credits.filter((line) => !freshCredits.some((fresh) => fresh.file === line.file) && (shownFiles.has(line.file) || !madeHere(line.file)));
  const nextCredits = [...kept, ...freshCredits];
  if (JSON.stringify(nextCredits) !== JSON.stringify(credits)) {
    await ctx.seam?.('write', CREDITS_FILE);
    writeWhole(join(dir, ...CREDITS_FILE.split('/')), `${JSON.stringify(nextCredits, null, 2)}\n`);
  }
  // 3. The sample rows.
  if (rowsChanged && bundle !== null) {
    await ctx.seam?.('write', 'seeds/sample.json');
    writeWhole(bundleFile(ctx.root, ctx.key), `${JSON.stringify(bundle, null, 2)}\n`);
  }
  // 4. The spots, last: the commit point.
  await ctx.seam?.('write', SPOTS_FILE);
  writeWhole(join(dir, ...SPOTS_FILE.split('/')), spotsText(nextSpots as SpotEntry[]));

  // A picture file Apply made that nothing names any more is taken away: a version still holds it, for going back.
  const rowFilesNow = new Set(Object.values((bundle as Bundle | null)?.assets ?? {}).map((asset) => asset.file));
  for (const file of rowFilesBefore) {
    if (!rowFilesNow.has(file) && madeHere(file) && file.startsWith('seeds/pictures/')) rmSync(join(dir, ...file.split('/')), { force: true });
  }
  for (const spot of spots) {
    const was = spot.file;
    if (was === null || was.startsWith('https:') || !madeHere(`${PICTURES_DIR}/${was}`) || nextSpots.some((next) => next.file === was)) continue;
    rmSync(join(dir, ...PICTURES_DIR.split('/'), ...was.split('/')), { force: true });
  }
  return { results, names, rows: rowsChanged, chosen };
}
