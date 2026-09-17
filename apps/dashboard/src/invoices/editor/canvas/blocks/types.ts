// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What every canvas block receives: the body it draws, the ONE totals
 * derivation (six consumers, one `totalsOf`), the edits surface,
 * and the selection.
 */
import type { DocumentEdits } from '../../../model/edits.js';
import type { InvoiceBody } from '../../../model/envelope.js';
import type { SectionKey } from '../../../model/blocks.js';
import type { Totals } from '../../../model/money.js';
import type { ImageRejection } from '../inline.js';

export interface BlockProps {
  body: InvoiceBody;
  totals: Totals;
  edits: DocumentEdits;
  /** The selected section. */
  section: SectionKey;
  onSelect: (section: SectionKey) => void;
  /** `delCustom` (comp 1317) plus the editor's selection fallback to `items`. */
  onRemoveCustom: (id: string) => void;
  onImageRejected: (result: ImageRejection) => void;
}
