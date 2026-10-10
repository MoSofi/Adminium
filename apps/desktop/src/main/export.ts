// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Export this project…": one ZIP of a project folder, made by the app, with
 * the choice of what goes in it (plan 66, spec 08 §6).
 *
 *  - `everything`: the apps, the data and the key. Whoever opens it can read
 *    all of it, saved database connections included.
 *  - `apps`: without the data, the key and the Designer's chats. Whoever opens
 *    it starts with empty data.
 *
 * In both: no packages (they are fetched again where it is opened), no build
 * output, no backups, and NEVER a model or picture key, whatever a `.env`
 * that was written on a terminal holds. The server is stopped while this runs
 * (main does that), so a database file is never copied beside a write in
 * flight.
 *
 * Written as a stream: a project's data can be larger than memory should hold.
 * ELECTRON-FREE.
 */
import { createReadStream, createWriteStream, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

import { KEPT_KEY_NAMES } from '../server/protocol.js';

export type ExportKind = 'everything' | 'apps';

/** Left out of every export, wherever in the folder they are. */
const NEVER_NAMES = new Set(['node_modules', '.DS_Store', 'Thumbs.db', '.git']);
/** Left out of every export, by their path from the project's root. */
const NEVER_PATHS = ['.adminium/build', '.adminium/running.json', '.adminium/approved-builds.json', '.adminium/export.json', 'data/backups'];
/** Left out when the data and the key do not travel. */
const NOT_WITH_APPS_ONLY = ['.env', 'data', '.adminium/designer/sessions'];
/** Already packed: storing them as they are is as small and much faster. */
const STORED = /\.(zip|gz|tgz|png|jpe?g|webp|gif|woff2?|mp4|mov|pdf)$/i;

const under = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`);

/** Whether a path (from the project's root, with `/`) goes into an export of that kind. */
export function exported(path: string, kind: ExportKind): boolean {
  if (path.split('/').some((part) => NEVER_NAMES.has(part))) return false;
  if (NEVER_PATHS.some((never) => under(path, never))) return false;
  // A backup archive is a copy of the data, wherever a person put it.
  if (/\.adminium-backup(\.zip)?$/i.test(path)) return false;
  // The data moved aside by "Start the data fresh" is data.
  if (kind === 'apps' && (NOT_WITH_APPS_ONLY.some((left) => under(path, left)) || /^data\.before-[^/]+(\/|$)/.test(path) || path === '.env.before')) return false;
  return true;
}

/** A `.env` as it may travel: every model and picture line taken out, the rest as it was. */
export function envForExport(text: string): string {
  const names = new Set<string>(KEPT_KEY_NAMES);
  return text
    .split(/(?<=\n)/)
    .filter((line) => {
      const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
      return name === undefined || !names.has(name);
    })
    .join('');
}

/** Every file that goes in, by its path from the root, in a steady order. Links are not followed and not written. */
export function exportList(root: string, kind: ExportKind): string[] {
  const out: string[] = [];
  const walk = (relative: string): void => {
    for (const name of readdirSync(relative === '' ? root : join(root, relative)).sort()) {
      const path = relative === '' ? name : `${relative}/${name}`;
      if (!exported(path, kind)) continue;
      const stat = lstatSync(join(root, path));
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) out.push(path);
    }
  };
  walk('');
  return out;
}

export interface ExportStamp {
  kind: ExportKind;
  system: string;
  chip: string;
  engine: string;
  exportedAt: string;
}

export interface ExportResult {
  files: number;
  bytes: number;
}

/**
 * Write the ZIP. Entries sit under one top folder named after the project's
 * own folder; no absolute path and no link is written. A file that cannot be
 * finished is removed: half an export is not an export.
 */
export async function writeProjectZip(opts: { root: string; kind: ExportKind; to: string; stamp: Omit<ExportStamp, 'kind'>; signal?: AbortSignal }): Promise<ExportResult> {
  const top = basename(opts.root);
  const files = exportList(opts.root, opts.kind);
  const out = createWriteStream(opts.to);
  let bytes = 0;
  let failed: Error | null = null;
  const done = new Promise<void>((resolve, reject) => {
    out.once('error', (error) => {
      failed = error;
      reject(error);
    });
    out.once('finish', resolve);
  });
  // Awaited at the end; a failure met earlier is thrown from the loop, and must not also surface here unheard.
  done.catch(() => undefined);
  const zip = new Zip((error, chunk, final) => {
    if (error !== null) {
      failed = error;
      out.destroy(error);
      return;
    }
    bytes += chunk.length;
    out.write(chunk);
    if (final) out.end();
  });

  const add = async (path: string, source: AsyncIterable<Buffer> | Buffer): Promise<void> => {
    const entry = STORED.test(path) ? new ZipPassThrough(`${top}/${path}`) : new ZipDeflate(`${top}/${path}`, { level: 6 });
    zip.add(entry);
    if (Buffer.isBuffer(source)) {
      entry.push(source, true);
      return;
    }
    for await (const chunk of source) {
      if (opts.signal?.aborted === true) throw new Error('The export was stopped.');
      if (failed !== null) throw failed as Error;
      entry.push(chunk, false);
      // Not faster than the disk takes it: a large database must not sit in memory waiting to be written.
      if (out.writableNeedDrain) await new Promise<void>((drained) => out.once('drain', drained));
    }
    entry.push(new Uint8Array(0), true);
  };

  try {
    for (const path of files) {
      if (failed !== null) throw failed as Error;
      if (path === '.env') await add(path, Buffer.from(envForExport(readFileSync(join(opts.root, path), 'utf8'))));
      else await add(path, createReadStream(join(opts.root, path)));
    }
    // What this folder is, said before anything of it is run where it is opened.
    await add('.adminium/export.json', Buffer.from(`${JSON.stringify({ kind: opts.kind, ...opts.stamp } satisfies ExportStamp, null, 2)}\n`));
    if (failed !== null) throw failed as Error;
    zip.end();
    await done;
    return { files: files.length, bytes };
  } catch (error) {
    out.destroy();
    rmSync(opts.to, { force: true });
    throw error;
  }
}

/** `juniper-kitchen.zip`: the name proposed for a project's export. */
export function exportFileName(root: string): string {
  return `${basename(root)}.zip`;
}
