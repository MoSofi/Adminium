// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What every inspector field group receives (I6): ONE block object and the
 * editing surface. The width segment, the *Show in export* toggle and *Delete
 * block* are the panel's, not a group's — every kind carries them (377-426).
 */
import type { DocumentEdits } from '../../../model/edits.js';
import type { BlockOf, ReportBlockKind } from '../../../model/envelope.js';

export interface FieldsProps<K extends ReportBlockKind = ReportBlockKind> {
  block: BlockOf<K>;
  edits: DocumentEdits;
}
