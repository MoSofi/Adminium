// SPDX-License-Identifier: AGPL-3.0-only
import type { Manifest } from '@adminium/manifest';

/**
 * A file saved from a database on an Adminium: `publisher: local` with the
 * `provenance` a save writes. A project's own app is `local` too, and is not
 * one: its author wrote what it says.
 */
export function isSavedFile(manifest: Manifest): boolean {
  if (manifest.kind !== 'app') return false;
  return (manifest.publisher as { id?: string } | undefined)?.id === 'local' && (manifest as { provenance?: unknown }).provenance !== undefined;
}
