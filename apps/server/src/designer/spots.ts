// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Picture spots: the named places on an app's pages where a picture goes.
 *
 * The Designer draws every page picture as `<Picture spot="hero" />` and
 * names the spot here, with its shape and a line of what belongs there. The
 * PERSON fills it, from the picture dialog; the model never chooses a page's
 * picture and never moves one the person placed. A spot with no picture is
 * drawn as a wireframe.
 *
 * `apps/<key>/assets/pictures/spots.json` holds the spots, in the order they
 * were made:
 *
 *     { "hero": { "label": "Hero", "shape": "wide", "shows": "the dining room in the evening",
 *                 "search": "restaurant evening", "file": "hero-3f2a9c1e.jpg",
 *                 "alt": "A long table set for dinner", "decorative": false } }
 *
 * `file` is a path relative to `assets/pictures/`, or the address of a
 * picture Unsplash serves (its pictures are shown from its own host and never
 * copied). Who made a picture and under which licence is in `CREDITS.json`
 * beside it, by file: that one list is what a screen's credits are drawn
 * from, whatever put the picture there.
 *
 * Only the server writes either file (`serverOwned` refuses the model's
 * write tools); a person may edit them by hand, and a hand save is read with
 * the same rules as here. Everything read is cleaned: an unknown key is
 * dropped, a word cut, a path that is not plain or that leaves
 * `assets/pictures/` refused, an Unsplash address taken only when it is
 * exactly one of Unsplash's own.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { appDir } from '../project/apps/read-app.js';
import { imageTypeOf } from './attachments.js';
import { isLicenceCode } from './licences.js';
import { PICTURE_SHAPES, UNSPLASH_HOST, type PictureCredit, type PictureShape } from './pictures.js';

/** Where an app's page pictures live, inside the app's folder. */
export const PICTURES_DIR = 'assets/pictures';
export const SPOTS_FILE = `${PICTURES_DIR}/spots.json`;
export const CREDITS_FILE = `${PICTURES_DIR}/CREDITS.json`;

/** A spot's id: what a screen names it by, in `<Picture spot="…" />`. */
export const SPOT_ID = /^[a-z][a-z0-9-]{0,39}$/;
/** The most spots an app keeps. */
export const SPOTS_MAX = 60;
/** The largest picture a spot takes: an attachment's own cap. */
export const SPOT_FILE_MAX_BYTES = 5 * 1024 * 1024;
const LABEL_MAX = 40;
const SHOWS_MAX = 200;
const SEARCH_MAX = 60;
const ALT_MAX = 250;
const PATH_MAX = 160;
const PATH_DEPTH = 4;

export interface Spot {
  /** The spot's name as the person reads it, in their language: "Hero", "Team". */
  label: string;
  shape: PictureShape;
  /** What belongs there, as the Designer wrote it: a note, never the alt text. */
  shows: string;
  /** Two to four words the picture dialog searches with first. */
  search: string;
  /** The picture: a path under `assets/pictures/`, an Unsplash address, or none (a wireframe). */
  file: string | null;
  /** What the picture shows, for someone who cannot see it. */
  alt: string;
  /** The person ticked "Decorative: say nothing": the picture is drawn with `alt=""`. */
  decorative: boolean;
}

export type SpotEntry = Spot & { id: string };

/** One line of plain words: nothing that could pass for markup or a second instruction. */
export function plainWords(value: unknown, most: number): string {
  if (typeof value !== 'string') return '';
  const line = [...value]
    .map((mark) => ((mark.codePointAt(0) ?? 0) < 32 || mark === '\u007f' || '<>`{}'.includes(mark) ? ' ' : mark))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > most ? line.slice(0, most).trimEnd() : line;
}

/**
 * A picture file's path under `assets/pictures/`, made plain or refused, by
 * the rules an archive's member paths are read with: no control mark, no
 * backslash, not absolute, no `..`, no empty or `.` part, not too deep or
 * long; then only the marks a file name of ours uses, and a picture's
 * extension. Null when it is refused.
 */
export function cleanPicturePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > PATH_MAX) return null;
  // eslint-disable-next-line no-control-regex -- refusing control marks is the point
  if (/[\u0000-\u001f\u007f]/.test(raw) || raw.includes('\\') || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) return null;
  const parts = raw.split('/');
  if (parts.length > PATH_DEPTH || parts.some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.') || !/^[A-Za-z0-9._-]+$/.test(part))) return null;
  return /\.(?:png|jpe?g|webp|gif)$/i.test(raw) ? raw : null;
}

/**
 * An address of a picture Unsplash serves, as it is to be written, or null.
 * Read as an address, never by its first letters: a host that only begins
 * with Unsplash's name, or one hidden behind an `@`, is someone else's.
 */
export function unsplashAddress(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== UNSPLASH_HOST || url.username !== '' || url.password !== '' || url.port !== '') return null;
  return url.href;
}

/** A spot's file as it may be written: a plain path under `assets/pictures/`, an Unsplash address, or null. */
export const cleanSpotFile = (raw: unknown): string | null => (typeof raw === 'string' && raw.startsWith('https:') ? unsplashAddress(raw) : cleanPicturePath(raw));

/** A spot with only what a spot may hold; null when it is not one. */
export function cleanSpot(raw: unknown): Spot | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const given = raw as Record<string, unknown>;
  const label = plainWords(given['label'], LABEL_MAX);
  const shape = (PICTURE_SHAPES as readonly unknown[]).includes(given['shape']) ? (given['shape'] as PictureShape) : null;
  if (label === '' || shape === null) return null;
  return {
    label,
    shape,
    shows: plainWords(given['shows'], SHOWS_MAX),
    search: plainWords(given['search'], SEARCH_MAX),
    file: cleanSpotFile(given['file']),
    alt: plainWords(given['alt'], ALT_MAX),
    decorative: given['decorative'] === true,
  };
}

/** `spots.json`'s text, cleaned: the spots it holds, in order, and what in it was not one. */
export function parseSpots(text: string): { spots: SpotEntry[]; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { spots: [], problems: [`It is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { spots: [], problems: ['It holds one object: each spot by its id.'] };
  const spots: SpotEntry[] = [];
  const problems: string[] = [];
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SPOT_ID.test(id)) {
      problems.push(`"${id.slice(0, 40)}" is not a spot's id (small letters, digits and -, starting with a letter).`);
      continue;
    }
    const spot = cleanSpot(value);
    if (spot === null) {
      problems.push(`"${id}" needs a "label" and a "shape" (wide, tall or square).`);
      continue;
    }
    const file = (value as Record<string, unknown>)['file'];
    if (file !== null && file !== undefined && spot.file === null) problems.push(`"${id}": its file is not a picture in assets/pictures/ or an address of ${UNSPLASH_HOST}.`);
    if (spots.length >= SPOTS_MAX) {
      problems.push(`An app keeps at most ${String(SPOTS_MAX)} spots.`);
      break;
    }
    spots.push({ id, ...spot });
  }
  return { spots, problems };
}

/** An app's spots, in order; none when it has no `spots.json` or the file does not read. */
export function readSpots(root: string, key: string): SpotEntry[] {
  const file = join(appDir(root, key), ...SPOTS_FILE.split('/'));
  if (!existsSync(file)) return [];
  try {
    return parseSpots(readFileSync(file, 'utf8')).spots;
  } catch {
    return [];
  }
}

/** Whether the app has a `spots.json`: an app made before spots has none. */
export const hasSpotsFile = (root: string, key: string): boolean => existsSync(join(appDir(root, key), ...SPOTS_FILE.split('/')));

/** `spots.json` as it is written: each spot by its id, in order. */
export const spotsText = (spots: readonly SpotEntry[]): string =>
  `${JSON.stringify(
    Object.fromEntries(spots.map(({ id, ...spot }) => [id, spot])),
    null,
    2,
  )}\n`;

/**
 * Which version of a spot this is: what a dialog opened with, and what its
 * Apply names, so a spot someone changed since is never written over.
 */
export const spotVersion = (spot: Spot): string =>
  createHash('sha256')
    .update(JSON.stringify([spot.label, spot.shape, spot.shows, spot.search, spot.file, spot.alt, spot.decorative]))
    .digest('hex')
    .slice(0, 16);

/** Write a file of the app's whole or not at all: a temporary file beside it, then renamed over it. */
export function writeWhole(target: string, data: string | Buffer): void {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, data);
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function writeSpots(root: string, key: string, spots: readonly SpotEntry[]): void {
  writeWhole(join(appDir(root, key), ...SPOTS_FILE.split('/')), spotsText(spots));
}

/** The app's credits, one line a picture; none when there is no list or it does not read. */
export function readCredits(root: string, key: string): PictureCredit[] {
  const file = join(appDir(root, key), ...CREDITS_FILE.split('/'));
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry: unknown): PictureCredit[] => {
      if (entry === null || typeof entry !== 'object') return [];
      const line = entry as Record<string, unknown>;
      const text = (name: string, most: number): string => plainWords(line[name], most);
      const https = (name: string): string => (typeof line[name] === 'string' && /^https:\/\/[^\s"'<>]{1,1000}$/.test(line[name]) ? line[name] : '');
      const file = typeof line['file'] === 'string' ? line['file'] : '';
      if (file === '' || file.length > 1000) return [];
      return [
        {
          file,
          title: text('title', 120),
          creator: text('creator', 80),
          creatorUrl: https('creatorUrl'),
          licence: text('licence', 40),
          licenceUrl: https('licenceUrl'),
          source: text('source', 40),
          page: https('page'),
          ...(isLicenceCode(line['licenceCode']) ? { licenceCode: line['licenceCode'] } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

export function writeCredits(root: string, key: string, credits: readonly PictureCredit[]): void {
  writeWhole(join(appDir(root, key), ...CREDITS_FILE.split('/')), `${JSON.stringify(credits, null, 2)}\n`);
}

/**
 * A picture file of the app's, by its path under `assets/pictures/` (or
 * `under`), read whole: only a plain file inside that folder by its real
 * path (a link out of it opens nothing), no larger than a spot takes, whose
 * bytes are a PNG, JPEG, WebP or GIF. Null for anything else.
 */
export function readPictureFile(root: string, key: string, path: unknown, under: string = PICTURES_DIR): { path: string; absolute: string; bytes: Buffer; mime: string } | null {
  const clean = cleanPicturePath(path);
  if (clean === null) return null;
  const folder = join(appDir(root, key), ...under.split('/'));
  const target = join(folder, ...clean.split('/'));
  try {
    if (!existsSync(target) || lstatSync(target).isSymbolicLink()) return null;
    const real = realpathSync(target);
    const realFolder = realpathSync(folder);
    if (!real.startsWith(`${realFolder}${sep}`) || !statSync(real).isFile() || statSync(real).size > SPOT_FILE_MAX_BYTES) return null;
    const bytes = readFileSync(real);
    const mime = imageTypeOf(bytes);
    return mime === null ? null : { path: clean, absolute: real, bytes, mime };
  } catch {
    return null;
  }
}

/**
 * A hand save of `spots.json`, read as the server would read it: what in it
 * cannot be kept, as one sentence; null when the whole of it reads.
 */
export function spotsFileProblem(root: string, key: string, text: string): string | null {
  const { spots, problems } = parseSpots(text);
  if (problems.length > 0) return problems[0] as string;
  for (const spot of spots) {
    if (spot.file === null || spot.file.startsWith('https:')) continue;
    if (readPictureFile(root, key, spot.file) === null) return `"${spot.id}": ${PICTURES_DIR}/${spot.file} is not a picture of this app.`;
  }
  return null;
}

/**
 * Why the model may not write this path of an app with its file tools, as a
 * sentence it can act on; null when it may. Asked by the model's write tools
 * alone: the person can read and hand-edit every file of their app, and a
 * hand save of `spots.json` is read like the server reads it.
 *
 *  - `spots.json` and `CREDITS.json`: the person fills spots from the picture
 *    dialog; the model names spots with `add_spots`;
 *  - `template-plan.json`: the plan the person approved;
 *  - `src/site/`: written by `use_site` alone.
 */
export function serverOwned(appKey: string, normal: string): string | null {
  const folded = normal.normalize('NFC').toLowerCase();
  const lead = `apps/${appKey}/`;
  if (!folded.startsWith(lead)) return null;
  const inside = folded.slice(lead.length);
  if (inside === SPOTS_FILE.toLowerCase() || inside === CREDITS_FILE.toLowerCase()) {
    return `${normal} is the person's: they fill the picture spots in the Pictures dialog, and the server writes it. Name a new spot with add_spots; put a picture the person attached in this message into a spot with fill_spot. Never write, edit or delete this file.`;
  }
  if (inside === 'template-plan.json') return `${normal} is the plan the person approved, written by the server. Never write, edit or delete it.`;
  if (/(^|\/)src\/site\//.test(inside)) return `${normal} is the person's site template, as use_site wrote it: change it with use_site, never with a file tool.`;
  return null;
}

/** A screen that draws a spot: the file, as the app names it (`customer/src/App.tsx`), and what a person calls it. */
export interface SpotScreen {
  file: string;
  screen: string;
}

const DRAWN = /<Picture\b[^>]*?\bspot\s*=\s*(?:"([a-z][a-z0-9-]{0,39})"|'([a-z][a-z0-9-]{0,39})'|\{\s*["']([a-z][a-z0-9-]{0,39})["']\s*\})/g;

/** What a person calls a screen, from its file: the side's first screen is Home, any other its own name in words. */
export function screenName(file: string): string {
  const base = file.split('/').pop()?.replace(/\.[a-z]+$/i, '') ?? file;
  if (/^(app|main|index|home)$/i.test(base)) return 'Home';
  return base.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/\b(page|screen)\b/gi, '').trim() || base;
}

/** Which screens of the app's web sides draw each spot, by the spot's id. */
export function spotScreens(root: string, key: string): Map<string, SpotScreen[]> {
  const out = new Map<string, SpotScreen[]>();
  for (const side of ['staff', 'customer'] as const) {
    const src = join(appDir(root, key), side, 'src');
    const walk = (dir: string, rel: string): void => {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(join(dir, entry.name), `${rel}${entry.name}/`);
        else if (/\.(?:tsx|jsx)$/.test(entry.name) && statSync(join(dir, entry.name)).size <= 512 * 1024) {
          const file = `${side}/src/${rel}${entry.name}`;
          for (const match of readFileSync(join(dir, entry.name), 'utf8').matchAll(DRAWN)) {
            const id = match[1] ?? match[2] ?? match[3] ?? '';
            const list = out.get(id) ?? [];
            if (!list.some((one) => one.file === file)) list.push({ file, screen: screenName(`${rel}${entry.name}`) });
            out.set(id, list);
          }
        }
      }
    };
    walk(src, '');
  }
  return out;
}
