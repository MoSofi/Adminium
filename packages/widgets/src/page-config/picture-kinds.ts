// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What makes a column a PICTURE column on a page: its `file` block takes
 * pictures, and nothing else. A block with no `accept`, or one that also takes
 * a PDF, is a FILE column. Stored pages keep reading as they always did: a
 * block generated before this rule existed has no `accept`, so it stays File
 * until somebody chooses Picture.
 *
 * The kinds are the allowlist's own words (`files.allowedTypes`, the server's
 * content check). Never SVG, which can carry script.
 */

/** The kinds a picture column takes, in the order they are named. */
export const PICTURE_KINDS = ['png', 'jpeg', 'webp', 'gif'] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

/** How each kind is written in a sentence ("PNG, JPEG, WebP or GIF"). */
export const PICTURE_KIND_NAMES: Readonly<Record<PictureKind, string>> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', gif: 'GIF' };

/** The type a browser and the server give each kind. */
export const PICTURE_KIND_MIMES: Readonly<Record<PictureKind, string>> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

export function isPictureKind(kind: string): kind is PictureKind {
  return (PICTURE_KINDS as readonly string[]).includes(kind);
}

/** Whether a column's `file` block makes it a picture column: it takes kinds, all of them pictures. */
export function isPictureBlock(file: unknown): boolean {
  const accept = (file as { accept?: unknown } | null | undefined)?.accept;
  return Array.isArray(accept) && accept.length > 0 && accept.every((kind) => typeof kind === 'string' && isPictureKind(kind));
}

/** The picture kind of a file's type, or null for anything that is not one of them. */
export function pictureKindOf(mime: string): PictureKind | null {
  const found = (Object.entries(PICTURE_KIND_MIMES) as [PictureKind, string][]).find(([, type]) => type === mime);
  return found === undefined ? null : found[0];
}
