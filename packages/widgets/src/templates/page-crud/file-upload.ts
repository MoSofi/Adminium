// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The host's upload transport for a file field, in a module of its own: the
 * file field and the picture field both take it, and neither imports the other
 * for it.
 */
import type { ResolvedFile } from '../../families/tables/cells.js';

export interface FileFieldUpload {
  /** Uploads and resolves to the value to store in the column. */
  (input: {
    file: File;
    column: string;
    signal: AbortSignal;
    onProgress: (fraction: number) => void;
  }): Promise<{ ref: string; file: ResolvedFile }>;
}
