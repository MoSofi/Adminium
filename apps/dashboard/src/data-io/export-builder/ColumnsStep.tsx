// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Step 2 — Columns (comp 209-452): "What goes in the file.", the two panes
 * (the file's ordered list at the start, the column browser at the end), and
 * under 900px the browser as a bottom sheet behind an "Add columns" button
 * (41-export-builder.md D13). The add outcomes — already in the file, over a
 * budget, refused by the parser, added — are the comp's toasts (731-737).
 */
import { useEffect, useState } from 'react';
import { Drawer, DrawerBody } from '@adminium/ui';
import { Plus } from 'lucide-react';
import type { Measure } from '@adminium/engine/config';

import type { SchemaReply, SchemaTable } from '../../studio/api.js';
import { ColumnBrowser } from './ColumnBrowser.js';
import { FileColumnList } from './FileColumnList.js';
import { copy } from './copy.js';
import {
  addColumn,
  defaultDraft,
  dropColumn,
  moveColumn,
  removeColumn,
  setHeader,
  type CalcAuthored,
  type Draft,
  type DraftColumn,
} from './model.js';

const SHEET_QUERY = '(max-width: 900px)';

/** True below the comp's 900px breakpoint; false wherever `matchMedia` is absent. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(SHEET_QUERY).matches : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(SHEET_QUERY);
    const listener = (event: MediaQueryListEvent) => setNarrow(event.matches);
    media.addEventListener?.('change', listener);
    return () => media.removeEventListener?.('change', listener);
  }, []);
  return narrow;
}

export interface ColumnsStepProps {
  schema: SchemaReply;
  table: SchemaTable;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  onToast: (message: string) => void;
  schemaChanged?: boolean | undefined;
}

export function ColumnsStep({ schema, table, draft, onDraft, onToast, schemaChanged }: ColumnsStepProps) {
  const narrow = useNarrow();
  const [sheetOpen, setSheetOpen] = useState(false);
  const baseNames = table.columns.map((column) => column.name);

  function add(column: DraftColumn, extra?: { measure?: Measure | undefined }): void {
    const outcome = addColumn(draft, column, { measure: extra?.measure }, baseNames);
    if (outcome.ok) {
      onDraft(outcome.draft);
      onToast(copy.added(column.header));
      return;
    }
    if (outcome.reason === 'already') onToast(copy.already(column.header));
    else if (outcome.reason === 'limit') onToast(copy.limit());
    else onToast(outcome.message ?? copy.limit());
  }

  function addCalc(authored: CalcAuthored): void {
    const outcome = addColumn(draft, authored.column, { field: authored.field }, baseNames);
    if (outcome.ok) {
      onDraft(outcome.draft);
      onToast(copy.added(authored.column.header));
      return;
    }
    if (outcome.reason === 'already') onToast(copy.already(authored.column.header));
    else if (outcome.reason === 'limit') onToast(copy.limit());
    else onToast(outcome.message ?? copy.limit());
  }

  const browser = (
    <ColumnBrowser
      schema={schema}
      table={table}
      draft={draft}
      onAdd={(column, extra) => add(column, extra)}
      onAddCalc={addCalc}
      onToast={onToast}
      onClose={narrow ? () => setSheetOpen(false) : undefined}
      schemaChanged={schemaChanged}
    />
  );

  return (
    <div className="flex flex-col gap-3.5" data-testid="export-builder-columns">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[16px] font-extrabold tracking-[-0.015em] text-fg">{copy.columnsTitle()}</span>
        {narrow ? (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="nb-ib ms-auto inline-flex items-center gap-[7px] rounded-[10px] bg-accent px-3.5 py-[9px] text-[13px] font-bold text-accent-fg"
            data-testid="export-builder-open-sheet"
          >
            <Plus className="size-[15px]" aria-hidden="true" />
            {copy.addColumns()}
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,392px)] items-start gap-3.5 max-[1080px]:grid-cols-1">
        <FileColumnList
          draft={draft}
          onHeader={(id, header) => onDraft(setHeader(draft, id, header))}
          onRemove={(id) => onDraft(removeColumn(draft, id))}
          onMove={(id, direction) => onDraft(moveColumn(draft, id, direction))}
          onDrop={(id, overId, before) => onDraft(dropColumn(draft, id, overId, before))}
          onReset={() => onDraft(defaultDraft(table))}
          onRemoveAll={() => onDraft({ columns: [], measures: [], fields: [] })}
        />
        {narrow ? null : browser}
      </div>

      {narrow ? (
        <Drawer side="bottom" open={sheetOpen} onOpenChange={setSheetOpen}>
          <DrawerBody className="p-0">{browser}</DrawerBody>
        </Drawer>
      ) : null}
    </div>
  );
}
