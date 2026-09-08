// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's state (39-email-templates-and-campaigns.md D1): the draft,
 * its history, the last saved draft, and the one way anything reaches the
 * server — `save()`.
 *
 * NOTHING HERE WRITES ON INPUT. `mutate` changes the draft in memory;
 * `beginEdit` records a history step (the comp's `beginEdit` on focus, so a
 * run of keystrokes in one field is one undo); `histMutate` does both for a
 * structural change. `save()` PUTs the whole draft plus the session's mirror
 * ops, then adopts the reply as the saved baseline. The chip's four states
 * fall out of `dirty` (derived), `saving` and the last error.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import { emailApi, type EmailDocumentDetail, type EmailMirrorOp } from '../api.js';
import { EMAIL_DOCUMENTS_KEY, invalidateEmailDocuments } from '../queries.js';
import { draftFromDetail, putBodyOf, sameDraft, type EditorDraft } from '../model/doc.js';
import { EMPTY_HISTORY, pushHistory, redoHistory, undoHistory, type History } from '../model/history.js';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface EditorState {
  draft: EditorDraft;
  saved: EditorDraft;
  dirty: boolean;
  status: SaveStatus;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Structural edits queued for the siblings; they ride the next save (D1). */
  mirrorOps: readonly EmailMirrorOp[];
}

export interface EditorActions {
  /** Records the current draft as an undo step — call on focus, before a run of keystrokes. */
  beginEdit: () => void;
  /** Changes the draft without a history step (a keystroke). */
  mutate: (patch: Partial<EditorDraft> | ((draft: EditorDraft) => EditorDraft)) => void;
  /** A history step plus the change (a structural edit). */
  histMutate: (patch: Partial<EditorDraft> | ((draft: EditorDraft) => EditorDraft)) => void;
  undo: () => void;
  redo: () => void;
  queueMirrorOp: (op: EmailMirrorOp) => void;
  /** PUTs the draft; resolves with the reply, rejects with the API error (the chip shows *Couldn't save*). */
  save: () => Promise<EmailDocumentDetail>;
}

function applyPatch(draft: EditorDraft, patch: Partial<EditorDraft> | ((draft: EditorDraft) => EditorDraft)): EditorDraft {
  return typeof patch === 'function' ? patch(draft) : { ...draft, ...patch };
}

export function useEditorDraft(detail: EmailDocumentDetail): [EditorState, EditorActions] {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EditorDraft>(() => draftFromDetail(detail));
  const [saved, setSaved] = useState<EditorDraft>(() => draftFromDetail(detail));
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [mirrorOps, setMirrorOps] = useState<readonly EmailMirrorOp[]>([]);
  // The latest draft for `save()`, which may run from a keyboard shortcut
  // bound before the last render.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const mirrorRef = useRef(mirrorOps);
  mirrorRef.current = mirrorOps;

  const dirty = useMemo(() => !sameDraft(draft, saved), [draft, saved]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = putBodyOf(draftRef.current, mirrorRef.current);
      const reply = await emailApi.save(detail.id, body);
      return { reply, sent: draftRef.current };
    },
    onSuccess: ({ reply, sent }) => {
      setSaved(sent);
      setMirrorOps([]);
      queryClient.setQueryData([...EMAIL_DOCUMENTS_KEY, 'detail', detail.id], reply);
      void invalidateEmailDocuments(queryClient);
    },
  });

  const beginEdit = useCallback(() => {
    setHistory((h) => pushHistory(h, draftRef.current));
  }, []);
  const mutate = useCallback((patch: Partial<EditorDraft> | ((draft: EditorDraft) => EditorDraft)) => {
    setDraft((current) => applyPatch(current, patch));
  }, []);
  const histMutate = useCallback(
    (patch: Partial<EditorDraft> | ((draft: EditorDraft) => EditorDraft)) => {
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
  const queueMirrorOp = useCallback((op: EmailMirrorOp) => {
    setMirrorOps((ops) => [...ops, op]);
  }, []);
  const save = useCallback(async (): Promise<EmailDocumentDetail> => {
    const { reply } = await saveMutation.mutateAsync();
    return reply;
  }, [saveMutation]);

  const status: SaveStatus = saveMutation.isPending ? 'saving' : saveMutation.isError && !dirty ? 'error' : dirty ? 'dirty' : 'saved';
  const error = saveMutation.isError ? (saveMutation.error instanceof Error ? saveMutation.error.message : String(saveMutation.error)) : null;

  return [
    {
      draft,
      saved,
      dirty,
      status: saveMutation.isError && dirty ? 'error' : status,
      error,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      mirrorOps,
    },
    { beginEdit, mutate, histMutate, undo, redo, queueMirrorOp, save },
  ];
}
