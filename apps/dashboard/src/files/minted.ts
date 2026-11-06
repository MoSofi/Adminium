// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What this tab uploaded or copied for a column. Its own module: every save
 * asks it (`api/crud.ts`, on the first paint), and the files transport around
 * it loads only with a screen that uploads.
 */

/**
 * The values this tab minted for a column (an upload's or a copy's reference):
 * a save that names one carries the page's revision, so a form opened before
 * the page stopped holding files there is refused rather than leaving the
 * file to the sweep.
 */
const minted = new Set<string>();

/** Whether a stored value names a file this tab uploaded or copied for a column. */
export function namesMintedFile(value: unknown): boolean {
  if (typeof value !== 'string' || value === '') return false;
  if (minted.has(value)) return true;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[')) return false;
  try {
    const list = JSON.parse(trimmed) as unknown;
    return Array.isArray(list) && list.some((entry) => typeof entry === 'string' && minted.has(entry));
  } catch {
    return false;
  }
}

/** Remember a value an upload or a copy minted. */
export function rememberMinted(ref: string | undefined): void {
  if (ref !== undefined && ref !== '') minted.add(ref);
}
