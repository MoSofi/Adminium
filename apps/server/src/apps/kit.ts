// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit for an app's own screens: where this server's dashboard build keeps
 * it, as a staff side's config says it.
 *
 * The dashboard's build writes the kit's parts under `assets/kit/` with a
 * hash in every name, and `assets/kit/kit.json` beside them naming the one
 * file a screen imports (apps/dashboard/vite.config.ts). A screen cannot
 * guess a hash, so its side's config carries the address: `kit.entry`. The
 * screen imports that, calls `mount`, and never reads `kit.json` itself.
 *
 * `/assets` is the dashboard build's own directory and passes on a mapped
 * staff host (plugins/surfaces.ts), which is why the kit lives there. A
 * customer host refuses it, and a customer side's config does not name it.
 *
 * A build with no kit (an API-only server, a dashboard older than the kit)
 * answers null and the config leaves the field out: the app then shows the
 * part's place as not available.
 */
import { readFile, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

export const KIT_PATH = '/assets/kit/';

export interface KitAddress {
  /** The mount contract's number; an app built for another shows the part as unavailable. */
  contract: number;
  /** The file a screen imports: an absolute same-origin path. */
  entry: string;
  /** The kit's sheet, for a screen that wants it fetched early; the kit loads it itself. Null when there is none. */
  styles: string | null;
}

/** A hashed file of the kit, by name: no directory, nothing but the build's own alphabet. */
const KIT_FILE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*\.(js|css)$/;

/** What `kit.json` says, or null when it says nothing usable. Never throws: a broken file is a build with no kit. */
export function parseKitManifest(text: string): KitAddress | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null) return null;
  const { contract, entry, styles } = doc as { contract?: unknown; entry?: unknown; styles?: unknown };
  if (typeof contract !== 'number' || !Number.isInteger(contract) || contract < 1) return null;
  if (typeof entry !== 'string' || !KIT_FILE.test(entry) || !entry.endsWith('.js')) return null;
  const sheet = typeof styles === 'string' && KIT_FILE.test(styles) && styles.endsWith('.css') ? styles : null;
  return { contract, entry: `${KIT_PATH}${entry}`, styles: sheet === null ? null : `${KIT_PATH}${sheet}` };
}

const held = new Map<string, { mtimeMs: number; kit: KitAddress | null }>();

/**
 * The kit of the dashboard build at `spaRoot`. Read again only when the file
 * changes (a dashboard rebuilt under a running server), so a config costs one
 * `stat`.
 */
export async function kitOf(spaRoot: string | null): Promise<KitAddress | null> {
  if (spaRoot === null) return null;
  const file = join(spaRoot, 'assets', 'kit', 'kit.json');
  try {
    const { mtimeMs } = await stat(file);
    const known = held.get(file);
    if (known?.mtimeMs === mtimeMs) return known.kit;
    const kit = parseKitManifest(await readFile(file, 'utf8'));
    held.set(file, { mtimeMs, kit });
    return kit;
  } catch {
    held.delete(file);
    return null;
  }
}

/**
 * How long a browser may keep a file of the dashboard's build, or undefined
 * for the server's usual answer. A kit file's name carries a hash of what is
 * in it, so its address never changes meaning; `kit.json` is the one name
 * that does, and nothing may keep it.
 */
export function kitCacheControl(spaRoot: string, filePath: string): string | undefined {
  const inKit = join(spaRoot, 'assets', 'kit') + sep;
  if (!filePath.startsWith(inKit)) return undefined;
  const name = filePath.slice(inKit.length);
  if (name === 'kit.json') return 'no-store';
  return /-[A-Za-z0-9_-]{8}\.(js|css)$/.test(name) ? 'public, max-age=31536000, immutable' : undefined;
}
