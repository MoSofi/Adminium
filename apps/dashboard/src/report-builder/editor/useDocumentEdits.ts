// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `DocumentEdits` implementation (model/edits.ts) over `model/ops.ts`,
 * bound to the editor's draft actions. The 25 canvas blocks and the 25
 * inspector field groups speak only to this object.
 *
 * THE COMP'S TWO TEMPOS, BY LINE (523-525, 534-545): a keystroke `mutate`s
 * (`mutate` 525, `patchBlock` 534, `updArr`/`updObjArr` 540, `updRow` 543);
 * a discrete choice or a structural edit `histMutate`s (`histMutate` 526,
 * `histPatchBlock` 534, `addBlock` 535, `moveBlock` 537, `delBlock` 538,
 * `reorderBlock` 539, `addArr`/`delArr` 541-542, `addRow`/`delRow` 544-545);
 * focus `beginEdit`s (523).
 *
 * `reorderBlock` is the one edit whose comp path is NOT `histMutate`: 539
 * calls `pushHist()` itself and then writes through `setCur` + `markDirty`,
 * which is the same pair in the other order. It is a history step here.
 */
import { useCallback, useMemo } from 'react';

import type { EditorDraft } from '../model/doc.js';
import type { DocumentEdits } from '../model/edits.js';
import type { ReportBody } from '../model/envelope.js';
import { newBlock } from '../model/blocks.js';
import {
  addArrayItem,
  addBlock,
  addRow,
  deleteBlock,
  patchBlock,
  removeArrayItem,
  removeRow,
  reorderBlock,
  setHeaderField,
  swapBlock,
  updateArrayItem,
  updateRow,
} from '../model/ops.js';
import type { Selection } from '../model/ops.js';
import { blockSeed } from './blockText.js';
import type { EditorActions } from './useEditorDraft.js';

export interface DocumentEditsDeps {
  actions: EditorActions;
  /** Where the inspector points; `addBlock` and `deleteBlock` move it (535, 538). */
  onSelect: (selection: Selection) => void;
}

export function useDocumentEdits({ actions, onSelect }: DocumentEditsDeps): DocumentEdits {
  const body = useCallback(
    (change: (body: ReportBody) => ReportBody, history: boolean) => {
      const apply = (draft: EditorDraft): EditorDraft => ({ ...draft, body: change(draft.body) });
      if (history) actions.histMutate(apply);
      else actions.mutate(apply);
    },
    [actions],
  );

  return useMemo<DocumentEdits>(
    () => ({
      beginEdit: actions.beginEdit,

      setHeader: (key, value) => body((current) => setHeaderField(current, key, value), false),
      histSetHeader: (key, value) => body((current) => setHeaderField(current, key, value), true),
      setName: (name) => actions.mutate({ name }),
      histSetStatus: (status) => actions.histMutate({ status }),

      patchBlock: (id, patch) => body((current) => patchBlock(current, id, patch), false),
      histPatchBlock: (id, patch) => body((current) => patchBlock(current, id, patch), true),

      addBlock: (kind) => {
        const block = newBlock(kind, blockSeed(kind));
        body((current) => addBlock(current, block).body, true);
        onSelect(block.id);
      },
      swapBlock: (id, dir) => body((current) => swapBlock(current, id, dir), true),
      reorderBlock: (from, to) => body((current) => reorderBlock(current, from, to), true),
      deleteBlock: (id) => {
        body((current) => deleteBlock(current, id, id).body, true);
        onSelect('header');
      },

      updateArrayItem: (id, field, index, patch) => body((current) => updateArrayItem(current, id, field, index, patch as never), false),
      addArrayItem: (id, field, row) => body((current) => addArrayItem(current, id, field, row as never), true),
      removeArrayItem: (id, field, index) => body((current) => removeArrayItem(current, id, field, index), true),

      updateRow: (id, rowIndex, cell, value) => body((current) => updateRow(current, id, rowIndex, cell, value), false),
      addRow: (id, row) => body((current) => addRow(current, id, row), true),
      removeRow: (id, rowIndex) => body((current) => removeRow(current, id, rowIndex), true),

      select: onSelect,
    }),
    [actions, body, onSelect],
  );
}
