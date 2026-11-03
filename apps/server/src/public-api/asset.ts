// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PRODUCT ASSET every visitor's browser loads: a preview model a 3D viewer
 * `fetch`es (GLB), a print model (STL, 3MF), a web font `@font-face` loads
 * (WOFF2), an SVG piece a page draws. Served as kept: each was read whole as
 * it was uploaded (`files/models.ts`) or written again by the cleaner
 * (`files/svg.ts`), so nothing is cleaned when it is served.
 *
 * Each kind has its own cap (a model 30 MiB, a font or an SVG 2 MiB,
 * `PUBLIC_ASSET_MAX_BYTES`), held where a file is chosen for such a column
 * and again where it is served. A file's bytes never change under its id, so
 * it is cached a day as immutable and asked again by its tag.
 */
import { ASSET_FILE_KINDS, PUBLIC_ASSET_MAX_BYTES } from '@adminium/manifest';

import { mimesForKeys, type SniffTypeKey } from '../files/sniff.js';
import { isSvgMime, SVG_CONTENT_POLICY } from '../files/svg.js';

export type AssetKind = (typeof ASSET_FILE_KINDS)[number];

/** How long a browser or a cache keeps an asset before asking again by its tag. */
export const ASSET_MAX_AGE_SECONDS = 86_400;

/** The asset kind of a stored file's (sniffed) mime, or null for anything else. */
export function assetKindOf(mime: string): AssetKind | null {
  const type = mime.toLowerCase().split(';')[0]!.trim();
  for (const kind of ASSET_FILE_KINDS) if (mimesForKeys([kind]).includes(type)) return kind;
  return null;
}

/** The caps of the asset kinds an upload may take, by kind; empty when it takes none. */
export function assetCapsFor(allowed: readonly SniffTypeKey[]): Partial<Record<SniffTypeKey, number>> {
  const out: Partial<Record<SniffTypeKey, number>> = {};
  for (const kind of ASSET_FILE_KINDS) if (allowed.includes(kind)) out[kind] = PUBLIC_ASSET_MAX_BYTES[kind];
  return out;
}

const mib = (bytes: number): string => String(Math.round((bytes / (1024 * 1024)) * 10) / 10);

/** Why a file is too large for a column of assets, in plain words. */
export function assetTooLargeWords(): string {
  return (
    `Every visitor's browser loads the files in this column, so a 3D model in it can be at most ${mib(PUBLIC_ASSET_MAX_BYTES.glb)} MB, ` +
    `and a font or an SVG at most ${mib(PUBLIC_ASSET_MAX_BYTES.woff2)} MB. Make the file smaller first.`
  );
}

/** The tag an asset is served under: its kept bytes' hash, which its id never changes. */
export function assetTag(sha256: string): string {
  return `"a-${sha256}"`;
}

/** The headers an asset is served with: any page may load it, nothing in it runs. */
export function assetHeaders(file: { mime: string; sha256: string }, column: string, kind: AssetKind, length?: number): Record<string, string> {
  return {
    'content-type': file.mime,
    ...(length === undefined ? {} : { 'content-length': String(length) }),
    // Never the name staff gave the file.
    'content-disposition': `inline; filename="${column.replace(/[^A-Za-z0-9_-]/g, '_')}.${kind}"`,
    // An SVG draws with its own inline styles and nothing else; nothing else runs anything.
    'content-security-policy': isSvgMime(file.mime) ? SVG_CONTENT_POLICY : "default-src 'none'; sandbox",
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'cross-origin',
    // A viewer's `fetch` and a page's `@font-face` are cross-origin reads: they need this where an <img> did not.
    'access-control-allow-origin': '*',
    'cache-control': `public, max-age=${String(ASSET_MAX_AGE_SECONDS)}, immutable`,
    etag: assetTag(file.sha256),
    'referrer-policy': 'no-referrer',
  };
}
