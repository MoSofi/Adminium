// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The inspector's writes, over the editor's draft (39-email-templates-and-
 * campaigns.md Appendix A §E3; the comp's `setBlkField` / `setBlkRow` /
 * `addBlkRow` / `dupBlkRow` / `delBlkRow` / `moveBlkRow` / `setBlkStyle`,
 * 1300-1316, and `insertVar`, 1040-1046).
 *
 * Keystrokes `mutate`; structural row edits and style choices `histMutate`
 * (one undo step each, as in the comp). Nothing here reaches the server.
 */
import { useCallback } from 'react';

import type { EmailAttachment, EmailBlockRecord, EmailBlockStyle, EmailBrand } from '../api.js';
import { EMAIL_BLOCKS, isEmailBlockKind } from '../model/blocks.js';
import type { EditorDraft } from '../model/doc.js';
import { newBlockId } from '../model/ops.js';
import type { EffectiveBrand } from './canvas/MailShell.js';
import type { EditorActions } from './useEditorDraft.js';

/** Which field the variable chips append to (D18): the last one focused. */
export type ActiveField =
  | { kind: 'subject' }
  | { kind: 'preheader' }
  | { kind: 'heading'; id: string }
  | { kind: 'field'; id: string; key: string }
  | { kind: 'cell'; id: string; field: string; index: number; key: string };

type RowValue = string | Record<string, unknown>;

function rowsOf(block: EmailBlockRecord, field: string): RowValue[] {
  const value = block.data[field];
  return Array.isArray(value) ? (value as RowValue[]) : [];
}

function withRows(block: EmailBlockRecord, field: string, rows: RowValue[]): EmailBlockRecord {
  return { ...block, data: { ...block.data, [field]: rows } };
}

/** A fresh row for a schema: `''` for plain rows, else every cell blank (`status: 'todo'` for a cycle cell). */
function emptyRow(kind: string): RowValue {
  const def = isEmailBlockKind(kind) ? EMAIL_BLOCKS[kind] : undefined;
  if (def?.rows === undefined || def.rows.plain === true) return '';
  const row: Record<string, unknown> = {};
  for (const cell of def.rows.cells) row[cell.key] = cell.kind === 'cycle' ? 'todo' : '';
  return row;
}

export function useDocumentEdits(actions: EditorActions, activeField: ActiveField | null) {
  const patchBlock = useCallback(
    (id: string, patch: (block: EmailBlockRecord) => EmailBlockRecord, history = false) => {
      const apply = (draft: EditorDraft): EditorDraft => ({
        ...draft,
        document: { ...draft.document, blocks: draft.document.blocks.map((block) => (block.id === id ? patch(block) : block)) },
      });
      if (history) actions.histMutate(apply);
      else actions.mutate(apply);
    },
    [actions],
  );

  const setBlockField = useCallback(
    (id: string, key: string, value: string) => patchBlock(id, (block) => ({ ...block, data: { ...block.data, [key]: value } })),
    [patchBlock],
  );

  const setBlockRow = useCallback(
    (id: string, field: string, index: number, key: string, value: string) =>
      patchBlock(id, (block) => {
        const rows = [...rowsOf(block, field)];
        const current = rows[index];
        rows[index] = key === '' ? value : { ...(typeof current === 'object' ? current : {}), [key]: value };
        return withRows(block, field, rows);
      }),
    [patchBlock],
  );

  const addBlockRow = useCallback(
    (id: string, field: string) => patchBlock(id, (block) => withRows(block, field, [...rowsOf(block, field), emptyRow(block.block)]), true),
    [patchBlock],
  );

  const dupBlockRow = useCallback(
    (id: string, field: string, index: number) =>
      patchBlock(
        id,
        (block) => {
          const rows = [...rowsOf(block, field)];
          const row = rows[index];
          if (row !== undefined) rows.splice(index + 1, 0, typeof row === 'object' ? { ...row } : row);
          return withRows(block, field, rows);
        },
        true,
      ),
    [patchBlock],
  );

  const delBlockRow = useCallback(
    (id: string, field: string, index: number) =>
      patchBlock(
        id,
        (block) =>
          withRows(
            block,
            field,
            rowsOf(block, field).filter((_, i) => i !== index),
          ),
        true,
      ),
    [patchBlock],
  );

  const moveBlockRow = useCallback(
    (id: string, field: string, from: number, to: number) =>
      patchBlock(
        id,
        (block) => {
          const rows = [...rowsOf(block, field)];
          if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return block;
          const [moved] = rows.splice(from, 1);
          if (moved !== undefined) rows.splice(to, 0, moved);
          return withRows(block, field, rows);
        },
        true,
      ),
    [patchBlock],
  );

  const setBlockStyle = useCallback(
    (id: string, patch: Partial<EmailBlockStyle>) => patchBlock(id, (block) => ({ ...block, style: { ...block.style, ...patch } }), true),
    [patchBlock],
  );

  const setSubject = useCallback((subject: string) => actions.mutate((draft) => ({ ...draft, document: { ...draft.document, subject } })), [actions]);
  const setPreheader = useCallback((preheader: string) => actions.mutate((draft) => ({ ...draft, document: { ...draft.document, preheader } })), [actions]);
  const setFooter = useCallback((footer: string) => actions.mutate((draft) => ({ ...draft, document: { ...draft.document, footer } })), [actions]);

  /** Brand edits materialise the document's own brand from the effective one the first time (D6). */
  const setBrand = useCallback(
    (effective: EffectiveBrand, patch: Partial<EffectiveBrand>, history: boolean) => {
      const apply = (draft: EditorDraft): EditorDraft => {
        const base: EmailBrand = draft.document.brand ?? {
          name: effective.name,
          mark: effective.mark,
          accent: /^#[0-9a-fA-F]{6}$/.test(effective.accent) ? effective.accent : '#4f46e5',
          fromName: effective.fromName,
          fromEmail: effective.fromEmail,
        };
        return { ...draft, document: { ...draft.document, brand: { ...base, ...patch } } };
      };
      if (history) actions.histMutate(apply);
      else actions.mutate(apply);
    },
    [actions],
  );

  const setAttachments = useCallback(
    (update: (attachments: readonly EmailAttachment[]) => EmailAttachment[], history: boolean) => {
      const apply = (draft: EditorDraft): EditorDraft => ({ ...draft, document: { ...draft.document, attachments: update(draft.document.attachments) } });
      if (history) actions.histMutate(apply);
      else actions.mutate(apply);
    },
    [actions],
  );

  const addGeneratedAttachment = useCallback(
    () => setAttachments((list) => [...list, { id: `a_${newBlockId().slice(2)}`, kind: 'generated', label: '', token: '' }], true),
    [setAttachments],
  );
  const addFileAttachment = useCallback(
    (fileId: string) => setAttachments((list) => (list.some((a) => a.kind === 'file' && a.fileId === fileId) ? [...list] : [...list, { id: `a_${newBlockId().slice(2)}`, kind: 'file', fileId }]), true),
    [setAttachments],
  );
  const updateGeneratedAttachment = useCallback(
    (id: string, patch: { label?: string; token?: string }) =>
      setAttachments((list) => list.map((a) => (a.id === id && a.kind === 'generated' ? { ...a, ...patch } : a)), false),
    [setAttachments],
  );
  const removeAttachment = useCallback((id: string) => setAttachments((list) => list.filter((a) => a.id !== id), true), [setAttachments]);

  /** The comp's `insertVar` (1040): append to the last-focused field; with none, to the subject. */
  const insertVar = useCallback(
    (token: string) => {
      actions.beginEdit();
      if (activeField === null) {
        actions.mutate((draft) => ({ ...draft, document: { ...draft.document, subject: `${draft.document.subject} ${token}` } }));
        return;
      }
      switch (activeField.kind) {
        case 'subject':
          actions.mutate((draft) => ({ ...draft, document: { ...draft.document, subject: draft.document.subject + token } }));
          return;
        case 'preheader':
          actions.mutate((draft) => ({ ...draft, document: { ...draft.document, preheader: draft.document.preheader + token } }));
          return;
        case 'heading':
          patchBlock(activeField.id, (block) => ({ ...block, data: { ...block.data, text: `${typeof block.data['text'] === 'string' ? block.data['text'] : ''}${token}` } }));
          return;
        case 'field':
          patchBlock(activeField.id, (block) => {
            const current = block.data[activeField.key];
            return { ...block, data: { ...block.data, [activeField.key]: `${typeof current === 'string' ? current : ''}${token}` } };
          });
          return;
        case 'cell':
          patchBlock(activeField.id, (block) => {
            const rows = [...rowsOf(block, activeField.field)];
            const row = rows[activeField.index];
            if (activeField.key === '') rows[activeField.index] = `${typeof row === 'string' ? row : ''}${token}`;
            else {
              const record = typeof row === 'object' ? row : {};
              const current = record[activeField.key];
              rows[activeField.index] = { ...record, [activeField.key]: `${typeof current === 'string' ? current : ''}${token}` };
            }
            return withRows(block, activeField.field, rows);
          });
          return;
      }
    },
    [actions, activeField, patchBlock],
  );

  return {
    patchBlock,
    setBlockField,
    setBlockRow,
    addBlockRow,
    dupBlockRow,
    delBlockRow,
    moveBlockRow,
    setBlockStyle,
    setSubject,
    setPreheader,
    setFooter,
    setBrand,
    addGeneratedAttachment,
    addFileAttachment,
    updateGeneratedAttachment,
    removeAttachment,
    insertVar,
  };
}
