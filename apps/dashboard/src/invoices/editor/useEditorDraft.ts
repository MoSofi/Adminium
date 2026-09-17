// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's state (model): the draft, its history, the last saved draft,
 * and the one way anything reaches the server — `save()`.
 *
 * NOTHING HERE WRITES ON INPUT. The comp autosaves 900 ms after a keystroke
 * (1346-1350); that choreography is NOT built — the chip is driven by an
 * explicit Save (the header's primary, `Ctrl/⌘+S`), undo/redo is the comp's
 * own (1341-1352, `model/history.ts`), and a discard guard covers leaving.
 * `mutate` changes the draft in memory; `beginEdit` records a history step
 * (the comp's `beginEdit` on focus, 1343, so a run of keystrokes in one
 * field is one undo); `histMutate` does both for a discrete choice. `save()`
 * PUTs the whole draft and adopts the reply as the saved baseline. The chip's
 * four states fall out of `dirty` (derived), `saving` and the last error.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import { invoicesApi, type InvoiceDetail } from '../api.js';
import { draftFromDetail, putBodyOf, sameDraft, type EditorDraft } from '../model/doc.js';
import { EMPTY_HISTORY, pushHistory, redoHistory, undoHistory, type History } from '../model/history.js';
import { INVOICES_KEY, invalidateInvoices } from '../queries.js';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export type DraftPatch = Partial<EditorDraft> | ((draft: EditorDraft) => EditorDraft);

export interface EditorState {
  draft: EditorDraft;
  saved: EditorDraft;
  dirty: boolean;
  status: SaveStatus;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

export interface EditorActions {
  /** Records the current draft as an undo step — call on focus, before a run of keystrokes. */
  beginEdit: () => void;
  /** Changes the draft without a history step (a keystroke). */
  mutate: (patch: DraftPatch) => void;
  /** A history step plus the change (a discrete choice or a structural edit). */
  histMutate: (patch: DraftPatch) => void;
  undo: () => void;
  redo: () => void;
  /** PUTs the draft; resolves with the reply, rejects with the API error (the chip shows *Couldn't save*). */
  save: () => Promise<InvoiceDetail>;
}

function applyPatch(draft: EditorDraft, patch: DraftPatch): EditorDraft {
  return typeof patch === 'function' ? patch(draft) : { ...draft, ...patch };
}

export function useEditorDraft(detail: InvoiceDetail): [EditorState, EditorActions] {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EditorDraft>(() => draftFromDetail(detail));
  const [saved, setSaved] = useState<EditorDraft>(() => draftFromDetail(detail));
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  // The latest draft for `save()`, which may run from a keyboard shortcut
  // bound before the last render.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const dirty = useMemo(() => !sameDraft(draft, saved), [draft, saved]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const sent = draftRef.current;
      const reply = await invoicesApi.save(detail.id, putBodyOf(sent));
      return { reply, sent };
    },
    onSuccess: ({ reply, sent }) => {
      setSaved(sent);
      queryClient.setQueryData([...INVOICES_KEY, 'detail', detail.id], reply);
      void invalidateInvoices(queryClient);
    },
  });

  const beginEdit = useCallback(() => {
    setHistory((h) => pushHistory(h, draftRef.current));
  }, []);
  const mutate = useCallback((patch: DraftPatch) => {
    setDraft((current) => applyPatch(current, patch));
  }, []);
  const histMutate = useCallback(
    (patch: DraftPatch) => {
      beginEdit();
      mutate(patch);
    },
    [beginEdit, mutate],
  );
  const undo = useCallback(() => {
    const result = undoHistory(history, draftRef.current);
    if (result === null) return;
    setHistory(result[0]);
    setDraft(result[1]);
  }, [history]);
  const redo = useCallback(() => {
    const result = redoHistory(history, draftRef.current);
    if (result === null) return;
    setHistory(result[0]);
    setDraft(result[1]);
  }, [history]);
  const { mutateAsync } = saveMutation;
  const save = useCallback(async (): Promise<InvoiceDetail> => {
    const { reply } = await mutateAsync();
    return reply;
  }, [mutateAsync]);

  const status: SaveStatus = saveMutation.isPending ? 'saving' : saveMutation.isError ? 'error' : dirty ? 'dirty' : 'saved';
  const error = saveMutation.isError ? (saveMutation.error instanceof Error ? saveMutation.error.message : String(saveMutation.error)) : null;

  const actions = useMemo<EditorActions>(() => ({ beginEdit, mutate, histMutate, undo, redo, save }), [beginEdit, mutate, histMutate, undo, redo, save]);

  return [
    {
      draft,
      saved,
      dirty,
      status,
      error,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
    },
    actions,
  ];
}
