// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Block ids for documents the server authors (starters, resets). The editor
 * mints its own (`nextBid`, comp 1104); the meta repo mints them for mirrored
 * clones. Same grammar everywhere: short, opaque, unique within a document.
 */
import { newEmailBlockId } from '@adminium/meta';

export function newBlockId(): string {
  return newEmailBlockId();
}
