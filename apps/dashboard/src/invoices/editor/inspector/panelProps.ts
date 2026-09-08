// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What every panel receives — the inspector's own props, minus the section
 * (each panel IS a section) — so the twenty-nine panels share one signature
 * and the switch in `Inspector.tsx` stays a switch.
 */
import type { SectionKey } from '../../model/blocks.js';
import type { EditorDraft } from '../../model/doc.js';
import type { DocumentEdits } from '../../model/edits.js';
import type { Totals } from '../../model/money.js';
import type { ImageRejected } from './upload.js';

export interface PanelProps {
  draft: EditorDraft;
  edits: DocumentEdits;
  totals: Totals;
  onSelect: (section: SectionKey) => void;
  onOpenAdd: () => void;
  onImageRejected: ImageRejected;
}
