// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `DocumentEdits` implementation (model/edits.ts) over `model/ops.ts`,
 * bound to the editor's draft actions. The twenty-seven canvas blocks and
 * the inspector's panels speak only to this object.
 *
 * THE COMP'S TWO TEMPOS, BY LINE (1343-1345, 1355-1366): a keystroke
 * `mutate`s (`updItem` 1355, `updCustom` 1311, `updList` 1363, `updObjList`
 * 1364); a discrete choice or a structural edit `histMutate`s (`addItem`
 * 1356, `delItem` 1357, `reorderItem`/`reorderBlk` 1358-1359, `enableSec`/
 * `hideSec` 1360-1361, `addList`/`delList` 1365-1366, `histCustom` 1312,
 * `updCustomImg` 1313, `addCustomRow`/`delCustomRow` 1315-1316, `delCustom`
 * 1317, `addCustom`/`addBuiltin` 1284-1310); focus `beginEdit`s (1343).
 * `setImage` is always a step (`setImgField` → `histMutate`, 1329).
 */
import { useCallback, useMemo } from 'react';

import type { DocumentEdits } from '../model/edits.js';
import type { EditorDraft } from '../model/doc.js';
import type { InvoiceBody } from '../model/envelope.js';
import {
  addBuiltin,
  addCustom,
  addCustomRow,
  addItem,
  addLine,
  addRow,
  enableSection,
  hideSection,
  newCustomSection,
  removeCustom,
  removeCustomRow,
  removeItem,
  removeLine,
  removeRow,
  reorderBlocks,
  reorderItems,
  setImage,
  updateCustom,
  updateCustomImage,
  updateCustomRow,
  updateItem,
  updateLine,
  updateRow,
} from '../model/ops.js';
import { customRowSeed, customSeed, newItemDescription } from './sectionText.js';
import type { EditorActions } from './useEditorDraft.js';

export function useDocumentEdits(actions: EditorActions): DocumentEdits {
  const body = useCallback(
    (change: (body: InvoiceBody) => InvoiceBody, history: boolean) => {
      const apply = (draft: EditorDraft): EditorDraft => ({ ...draft, body: change(draft.body) });
      if (history) actions.histMutate(apply);
      else actions.mutate(apply);
    },
    [actions],
  );

  return useMemo<DocumentEdits>(
    () => ({
      beginEdit: actions.beginEdit,

      set: (key, value) => body((b) => ({ ...b, [key]: value }), false),
      histSet: (key, value) => body((b) => ({ ...b, [key]: value }), true),
      setName: (name) => actions.mutate({ name }),
      histSetStatus: (status) => actions.histMutate({ status }),
      histSetTopic: (topic) => actions.histMutate({ topic }),
      histSetLang: (lang) => actions.histMutate({ lang }),

      updateLine: (field, index, value) => body((b) => updateLine(b, field, index, value), false),
      addLine: (field) => body((b) => addLine(b, field), true),
      removeLine: (field, index) => body((b) => removeLine(b, field, index), true),

      updateRow: (field, index, patch) => body((b) => updateRow(b, field, index, patch), false),
      addRow: (field, row) => body((b) => addRow(b, field, row), true),
      removeRow: (field, index) => body((b) => removeRow(b, field, index), true),

      updateItem: (id, patch) => body((b) => updateItem(b, id, patch), false),
      addItem: () => body((b) => addItem(b, newItemDescription()), true),
      removeItem: (id) => body((b) => removeItem(b, id), true),
      reorderItems: (from, to) => body((b) => reorderItems(b, from, to), true),

      enableSection: (flag) => body((b) => enableSection(b, flag), true),
      hideSection: (flag) => body((b) => hideSection(b, flag), true),
      addBuiltin: (block, flag, at) => body((b) => addBuiltin(b, block, flag, at), true),
      addCustom: (type, at) => {
        const section = newCustomSection(type, customSeed());
        body((b) => addCustom(b, section, at), true);
        return section;
      },
      removeCustom: (id) => body((b) => removeCustom(b, id), true),
      reorderBlocks: (from, to) => body((b) => reorderBlocks(b, from, to), true),
      updateCustom: (id, patch) => body((b) => updateCustom(b, id, patch), false),
      histUpdateCustom: (id, patch) => body((b) => updateCustom(b, id, patch), true),
      updateCustomImage: (id, imageId, url) => body((b) => updateCustomImage(b, id, imageId, url), true),
      updateCustomRow: (id, index, key, value) => body((b) => updateCustomRow(b, id, index, key, value), false),
      addCustomRow: (id) => body((b) => addCustomRow(b, id, customRowSeed()), true),
      removeCustomRow: (id, index) => body((b) => removeCustomRow(b, id, index), true),

      setImage: (field, dataUrl) => body((b) => setImage(b, field, dataUrl), true),
    }),
    [actions, body],
  );
}
