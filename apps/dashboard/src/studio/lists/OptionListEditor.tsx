// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OptionListEditor — one option list, in a dialog (plan 50 F3, D20).
 *
 * The rows are the anatomy F3 names: `[value] [label] [↑] [↓] [−]` and an "Add
 * value" button under them, the same shape the Report Builder and Invoice
 * Builder list editors already use, so a third list editor does not read as a
 * third idea.
 *
 * ─── Why `Modal` and not `FormDialog` ──────────────────────────────────────
 *
 * `FormDialog` is the comp's shell for the forms that write a ROW — the
 * create and edit dialogs this plan is named after. This is a Studio settings
 * dialog beside Storage's and Pages': it configures the product rather than
 * entering data, and it belongs to that family on screen.
 *
 * ─── A built-in opens read-only, with the two ways out ─────────────────────
 *
 * Countries cannot be edited: it is code, its labels come from the reader's own
 * runtime, and 249 rows are not a thing to scroll through in a dialog. Wanting
 * to change it is ordinary, so the dialog offers what it can actually do —
 * "Make a copy I can edit", and "Store the label instead", which is the same
 * copy with the labels as the values (Appendix D). Both land in a normal
 * editable list, opened right here, which is the point: the answer to "I cannot
 * edit this" is a thing that is already editing.
 */
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Tags, Trash2 } from 'lucide-react';
import {
  Alert,
  Button,
  FormField,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  MonoText,
} from '@adminium/ui';

import { t } from '../../i18n/t.js';
import {
  copyOfList,
  draftIssue,
  type OptionListItemView,
  type OptionListView,
} from './optionListsApi.js';

export interface OptionListDraft {
  /** Absent for a list that does not exist yet. */
  key: string | null;
  /** The key a new list will be created under. */
  newKey: string;
  name: string;
  items: OptionListItemView[];
  origin: string;
}

export function draftFromList(list: OptionListView): OptionListDraft {
  return { key: list.key, newKey: list.key, name: list.name, items: list.items.map((item) => ({ ...item })), origin: list.origin };
}

export function emptyDraft(): OptionListDraft {
  return { key: null, newKey: '', name: '', items: [{ value: '' }], origin: 'custom' };
}

/** The draft a copy of `list` starts as, ready to save. */
export function draftFromCopy(list: OptionListView, taken: readonly string[], storeLabels: boolean): OptionListDraft {
  const body = copyOfList(list, { storeLabels, taken });
  return { key: null, newKey: body.key, name: body.name, items: body.items, origin: body.origin ?? 'custom' };
}

export interface OptionListEditorProps {
  /** The list being looked at; null closes the dialog. */
  list: OptionListView | null;
  /** Every key in use, so a copy does not collide with one. */
  taken: readonly string[];
  saving?: boolean;
  /** Set when the save was refused, in the operator's words. */
  error?: string | null;
  onClose: () => void;
  onSave: (draft: OptionListDraft) => void;
  /** Stories render the dialog inline. */
  modal?: boolean | undefined;
}

export function OptionListEditor({
  list,
  taken,
  saving = false,
  error = null,
  onClose,
  onSave,
  modal,
}: OptionListEditorProps) {
  const [draft, setDraft] = useState<OptionListDraft | null>(null);

  /*
   * A dialog opens clean: the draft is seeded from the list each time one is
   * opened, and never carries the previous list's rows into the next one.
   *
   * A list with no KEY is the page asking for a NEW one — the key is what a
   * list is called everywhere, so "no key yet" and "this is new" are the same
   * statement, and the draft has to start empty rather than from a row.
   */
  useEffect(() => {
    setDraft(
      list === null ? null : list.key === '' ? emptyDraft() : list.editable ? draftFromList(list) : null,
    );
  }, [list]);

  if (list === null) return null;
  const copying = draft !== null && draft.key === null && list.editable === false;
  const issue = draft === null ? null : draftIssue(draft);

  const patch = (next: Partial<OptionListDraft>): void =>
    setDraft((current) => (current === null ? current : { ...current, ...next }));

  const setItem = (index: number, change: (row: OptionListItemView) => OptionListItemView): void =>
    setDraft((current) =>
      current === null
        ? current
        : { ...current, items: current.items.map((row, i) => (i === index ? change(row) : row)) },
    );

  /** An empty label is the ABSENCE of one: an item labelled with its own value
   * is one thing said twice, and it would travel into the project file. */
  const setLabel = (index: number, text: string): void =>
    setItem(index, ({ label: _dropped, ...rest }) => (text === '' ? rest : { ...rest, label: text }));

  const removeAt = (index: number): void =>
    setDraft((current) =>
      current === null ? current : { ...current, items: current.items.filter((_, i) => i !== index) },
    );

  const move = (index: number, by: -1 | 1): void =>
    setDraft((current) => {
      if (current === null) return current;
      const to = index + by;
      if (to < 0 || to >= current.items.length) return current;
      const items = [...current.items];
      const [moved] = items.splice(index, 1);
      items.splice(to, 0, moved as OptionListItemView);
      return { ...current, items };
    });

  return (
    <Modal
      open
      size="lg"
      {...(modal === undefined ? {} : { modal })}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalHeader
        title={
          draft === null
            ? list.name
            : copying
              ? t('studio:lists.copyTitle', 'A copy of {name}', { name: list.name })
              : t('studio:lists.editTitle', 'Edit {name}', { name: list.name })
        }
        subtitle={
          draft === null
            ? t(
                'studio:lists.builtinSubtitle',
                'A list Adminium ships. It is the same in every workspace, and its names are written in each person’s own language.',
              )
            : t('studio:lists.editSubtitle', 'The answers a column with this list accepts, in the order a form offers them.')
        }
        closeLabel={t('studio:lists.close', 'Close')}
      />
      <ModalBody className="flex flex-col gap-4">
        {error === null ? null : <Alert tone="danger" title={error} />}

        {draft === null ? (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-caption text-fg-muted">
                {t('studio:lists.builtinCount', '{count} values', { count: list.items.length })}
              </p>
              <ul className="flex flex-wrap gap-1" data-testid="option-list-preview">
                {list.items.slice(0, 12).map((item) => (
                  <li
                    key={item.value}
                    className="rounded-full border border-border px-2 py-0.5 text-caption text-fg-muted"
                  >
                    {item.label ?? item.value}
                  </li>
                ))}
                {list.items.length > 12 ? (
                  <li className="px-2 py-0.5 text-caption text-fg-subtle">
                    {t('studio:lists.andMore', 'and {count} more', { count: list.items.length - 12 })}
                  </li>
                ) : null}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                iconLeft={<Copy className="size-4" />}
                onClick={() => setDraft(draftFromCopy(list, taken, false))}
                data-testid="option-list-copy"
              >
                {t('studio:lists.makeCopy', 'Make a copy I can edit')}
              </Button>
              <Button
                variant="secondary"
                iconLeft={<Tags className="size-4" />}
                onClick={() => setDraft(draftFromCopy(list, taken, true))}
                data-testid="option-list-copy-labels"
              >
                {t('studio:lists.storeLabel', 'Store the label instead')}
              </Button>
            </div>
            <p className="text-caption text-fg-subtle">
              {t(
                'studio:lists.storeLabelHelp',
                'A copy stores the code, e.g. DE. "Store the label instead" stores what it is called here, e.g. Germany — in this workspace’s language, from now on.',
              )}
            </p>
          </>
        ) : (
          <>
            <FormField label={t('studio:lists.name', 'Name')}>
              <Input
                value={draft.name}
                placeholder={t('studio:lists.namePlaceholder', 'Departments')}
                onChange={(event) => patch({ name: event.target.value })}
                data-testid="option-list-name"
              />
            </FormField>
            {draft.key === null ? (
              <FormField
                label={t('studio:lists.key', 'Key')}
                helper={t(
                  'studio:lists.keyHelper',
                  'What rules and project files call this list. It cannot be changed later.',
                )}
              >
                <Input
                  mono
                  value={draft.newKey}
                  placeholder="departments"
                  onChange={(event) => patch({ newKey: event.target.value })}
                  data-testid="option-list-key"
                />
              </FormField>
            ) : (
              <p className="text-caption text-fg-subtle">
                {t('studio:lists.keyFixed', 'Rules name this list as')} <MonoText>{draft.key}</MonoText>
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <p className="text-caption text-fg-muted">{t('studio:lists.values', 'Values')}</p>
              <ul className="flex flex-col gap-1">
                {draft.items.map((item, index) => (
                  <li key={index} className="flex items-center gap-1">
                    <Input
                      mono
                      className="w-40"
                      value={item.value}
                      aria-label={t('studio:lists.valueAt', 'Value {n}', { n: index + 1 })}
                      placeholder="new"
                      error={item.value.trim() === ''}
                      onChange={(event) => setItem(index, (row) => ({ ...row, value: event.target.value }))}
                    />
                    <Input
                      className="flex-1"
                      value={item.label ?? ''}
                      aria-label={t('studio:lists.labelAt', 'Label {n}', { n: index + 1 })}
                      placeholder={t('studio:lists.labelPlaceholder', 'What people read')}
                      onChange={(event) => setLabel(index, event.target.value)}
                    />
                    <IconButton
                      label={t('studio:lists.moveUp', 'Move {value} up', { value: item.value })}
                      size="sm"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={t('studio:lists.moveDown', 'Move {value} down', { value: item.value })}
                      size="sm"
                      variant="ghost"
                      disabled={index === draft.items.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={t('studio:lists.removeValue', 'Remove {value}', { value: item.value })}
                      size="sm"
                      variant="ghost"
                      onClick={() => removeAt(index)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </IconButton>
                  </li>
                ))}
              </ul>
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => patch({ items: [...draft.items, { value: '' }] })}
                  data-testid="option-list-add-value"
                >
                  {t('studio:lists.addValue', 'Add value')}
                </Button>
              </div>
            </div>
            {issue === null ? null : <p className="text-caption text-danger">{issue}</p>}
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          {t('studio:lists.cancel', 'Cancel')}
        </Button>
        {draft === null ? null : (
          <Button
            disabled={issue !== null || saving || (draft.key === null && draft.newKey.trim() === '')}
            onClick={() => onSave(draft)}
            data-testid="option-list-save"
          >
            {draft.key === null
              ? t('studio:lists.create', 'Create list')
              : t('studio:lists.save', 'Save changes')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
