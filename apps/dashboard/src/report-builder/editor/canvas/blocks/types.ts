// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What every canvas block body receives: ONE block object plus the editing
 * surface, and the viewer's locale for the three figures `Intl` formats
 * (D11).
 *
 * A PRIVATE SET. These components import nothing from `src/invoices`, nothing
 * from `@adminium/widgets` and nothing from `@adminium/charts`: seventeen of
 * the 25 kinds share a NAME with an invoice block and not its fields (trap
 * 3), the widget blocks receive only `format` and are inert (fact 3), and the
 * two chart primitives pad differently from the four lines the comp draws
 * (623-624).
 */
import type { DocumentEdits } from '../../../model/edits.js';
import type { BlockOf, ReportBlockKind } from '../../../model/envelope.js';

export interface BlockBodyProps<K extends ReportBlockKind = ReportBlockKind> {
  block: BlockOf<K>;
  edits: DocumentEdits;
  /** BCP-47, from the viewer's preference — the comp's `'en-US'` literal (618). */
  locale: string;
}
