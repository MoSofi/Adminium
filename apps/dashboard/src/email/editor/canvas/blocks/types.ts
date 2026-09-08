// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What every block preview receives. The canvas is a PREVIEW: blocks are
 * edited in the inspector, except the heading, which the comp edits inline
 * (534) — hence the two optional heading callbacks.
 */
import type { EmailBlockRecord } from '../../../api.js';
import type { EmailBlockDef } from '../../../model/blocks.js';
import type { FileDto } from '../../../../files/api.js';

export interface BlockPreviewProps {
  block: EmailBlockRecord;
  def: EmailBlockDef;
  /** The block's translated label — the heading textarea's accessible name. */
  label: string;
  /** Library files referenced by image blocks, resolved once for the document (D9). */
  files: ReadonlyMap<string, FileDto | null>;
  onHeadingChange?: ((text: string) => void) | undefined;
  onHeadingFocus?: (() => void) | undefined;
}
