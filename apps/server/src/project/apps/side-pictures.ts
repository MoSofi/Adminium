// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pictures an app's screens and sample rows take from another site, read
 * from the files before a person meets them as broken images.
 *
 * A server shows pictures from itself and from the sites it names
 * (`ADMINIUM_CSP_IMG_HOSTS`); the browser refuses any other, and says so only
 * in its console. A screen builds whatever address it holds, so a page with
 * five photos from a stock site builds, opens, and shows five empty frames.
 *
 * It is a reading, not a proof: an address counts as a picture when it ends
 * as one, sits where a picture's address goes (`src=`, `url(`, a key named
 * for one), or is on a site that serves nothing else.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { appDir, appPath, SIDES } from './read-app.js';
import { code } from './side-calls.js';

export interface OutsidePicture {
  /** The host as written, lower case. */
  host: string;
  /** False for `http://`: a host is allowed over https only. */
  secure: boolean;
  /** The file, relative to the project. */
  file: string;
}

const ADDRESS = /(https?):\/\/([a-z0-9.-]+)(?::\d+)?(\/[^\s'"`)<>\\]*)?/gi;
const ENDS_AS_PICTURE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp)(?:[?#]|$)/i;
/** What stands before a picture's address: `src="`, `url(`, `"image_url": "`, `photo: '`. */
const BEFORE_A_PICTURE = /(?:src|srcset|poster|image|img|photo|picture|avatar|cover|logo|thumb|thumbnail|banner|hero|background|icon|url)\w*["'`]?\s*[:=(]\s*\{?\s*["'`]?$/i;
const PICTURE_SITES =
  /(?:^|\.)(?:unsplash\.com|pexels\.com|pixabay\.com|picsum\.photos|placehold\.co|placeholder\.com|placekitten\.com|imgur\.com|cloudinary\.com|imgix\.net|pravatar\.cc|dicebear\.com|loremflickr\.com|dummyimage\.com|staticflickr\.com|ui-avatars\.com)$/;

function files(root: string, key: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (folder: string, rel: string): void => {
    if (!existsSync(folder) || out.length >= 80) return;
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(join(folder, entry.name), `${rel}/${entry.name}`);
      else if (entry.isFile() && /\.(?:tsx?|jsx?|mjs|css|html|json)$/.test(entry.name) && out.length < 80) {
        const text = readFileSync(join(folder, entry.name), 'utf8');
        // An address quoted in a comment is not one the page loads. JSON has no comments, and its values hold `//`.
        out.push({ file: appPath(key, `${rel}/${entry.name}`), text: entry.name.endsWith('.json') ? text : code(text) });
      }
    }
  };
  for (const side of SIDES) walk(join(appDir(root, key), side, 'src'), `${side}/src`);
  walk(join(appDir(root, key), 'seeds'), 'seeds');
  return out;
}

/** Every picture the app's screens and sample rows take from another site, one entry per host and file. */
export function outsidePictures(root: string, key: string): OutsidePicture[] {
  const out: OutsidePicture[] = [];
  const seen = new Set<string>();
  for (const { file, text } of files(root, key)) {
    for (const found of text.matchAll(ADDRESS)) {
      const host = (found[2] as string).toLowerCase();
      if (!host.includes('.')) continue;
      const before = text.slice(Math.max(0, found.index - 60), found.index).split('\n').at(-1) ?? '';
      if (!ENDS_AS_PICTURE.test(found[3] ?? '') && !PICTURE_SITES.test(host) && !BEFORE_A_PICTURE.test(before)) continue;
      const mark = `${host} ${file}`;
      if (seen.has(mark)) continue;
      seen.add(mark);
      out.push({ host, secure: (found[1] as string).toLowerCase() === 'https', file });
    }
  }
  return out;
}

/**
 * The pictures that will not show, one line per site, for the model.
 * `allowed` says whether the server lets a host through; `canAsk` whether a
 * person's yes can add one here (`allow_picture_site`).
 */
export function outsidePictureLines(found: readonly OutsidePicture[], allowed: (host: string) => boolean, canAsk: boolean): string[] {
  const hosts = new Map<string, { files: Set<string>; secure: boolean }>();
  for (const entry of found) {
    if (entry.secure && allowed(entry.host)) continue;
    const held = hosts.get(entry.host) ?? { files: new Set<string>(), secure: true };
    held.files.add(entry.file);
    held.secure = held.secure && entry.secure;
    hosts.set(entry.host, held);
  }
  return [...hosts].map(([host, held]) => {
    const where = [...held.files].slice(0, 3).join(', ');
    const lead = `- Pictures from ${host} (${where}) will not show: this server shows pictures only from itself and from sites the person allowed, and the page gets an empty frame.`;
    if (!held.secure) return `${lead} A site is allowed over https only: write the address with https://, or use no picture from another site.`;
    return canAsk
      ? `${lead} Call allow_picture_site with "${host}" to ask the person; if they say no, take the pictures out (draw with the look's own parts or an inline SVG).`
      : `${lead} Take them out (draw with the look's own parts or an inline SVG), and tell the person that whoever runs this server can allow the site with ADMINIUM_CSP_IMG_HOSTS.`;
  });
}
