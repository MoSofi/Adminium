// SPDX-License-Identifier: AGPL-3.0-only
import {
  Button,
  FormDialog,
  FormDialogBody,
  FormDialogFooter,
  FormDialogHeader,
  Spinner,
} from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { ArrowRight, Check, Pencil, Plus } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { RecordForm, type RecordFormProps } from './RecordForm.js';
import type { CrudFormConfig } from '../../page-config/index.js';

/**
 * The dialog every create and edit form opens in.
 *
 * ─── What this replaces, and why ───────────────────────────────────────────
 *
 * Four call sites drew four different containers over the same form: create was
 * a `TwoPhaseModal` with a second "added — Done" panel, and the three edits were
 * 480px drawers. A row is the same thing wherever you meet it, and the comp
 * draws one dialog for all of them (D3). The success panel goes with them (D4):
 * the toast already says the row was added and carries the Undo, so the panel
 * was a second confirmation of something the person had just watched happen.
 *
 * ─── The words are generated, and can be typed over (D27) ──────────────────
 *
 * Title, subtitle, button and footnote are derived from what is actually true
 * about this form — the entity's singular noun, the document's section labels,
 * whether anything is required. A stored `dialog.*` overrides any of them, and
 * the host's `labels` prop still wins over both, because that is the precedence
 * every other string in this template already follows.
 */

export interface RecordFormDialogProps
  extends Omit<RecordFormProps, 'footer' | 'formId' | 'mode' | 'document'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** The singular noun for this table, preferred over a de-pluralized name. */
  entity: string;
  /** Named in the fallback subtitle, as the old modal did. */
  tableName: string;
  /** The form document: designed, or derived. */
  document?: CrudFormConfig | null | undefined;
  /** Host overrides, which beat the generated words. */
  labels?: { title?: string | undefined; submit?: string | undefined; close?: string | undefined } | undefined;
  /** A save in flight: the CTA shows a spinner in place of its icon (F10). */
  saving?: boolean | undefined;
  /** The header tile's icon; the page's own nav icon by default. */
  icon?: ReactNode | undefined;
  /** One id per open dialog, so the footer's button can submit the form. */
  formId?: string | undefined;
  /**
   * Radix's modality. `false` renders the dialog inline with the page behind it
   * live — what a VRT story and the axe sweep need, and nothing else should
   * pass.
   */
  modal?: boolean | undefined;
}

/** The comp's widths, per preset (119, 728). */
const PRESET_WIDTH: Readonly<Record<string, number>> = {
  'quick-create': 440,
  'multi-entry': 560,
  'segmented-files': 580,
  sectioned: 640,
  wizard: 640,
  'choice-cards': 660,
  'upload-chips': 680,
};

export function RecordFormDialog({
  open,
  onOpenChange,
  mode,
  entity,
  tableName,
  document: formDocument,
  labels,
  saving = false,
  icon,
  formId = 'record-form-dialog',
  modal,
  ...formProps
}: RecordFormDialogProps) {
  const t = useMaybeT();
  const dialog = formDocument?.dialog;
  const preset = formDocument?.preset ?? 'sectioned';
  /**
   * The wizard's state, as the form reports it.
   *
   * The footer belongs to the dialog and the steps belong to the form, so one
   * of them has to tell the other. It is this way round because Continue has to
   * CHECK the step before it advances, and only the form has the values.
   */
  const [wizard, setWizard] = useState<{
    step: number;
    steps: number;
    back: () => void;
    next: () => void;
  } | null>(null);
  const onWizard = useCallback(
    (state: { step: number; steps: number; back: () => void; next: () => void }) => {
      setWizard((current) =>
        current !== null && current.step === state.step && current.steps === state.steps
          ? // Same step: keep the object but take the NEW callbacks, which close
            // over the values as they are now.
            { ...state }
          : { ...state },
      );
    },
    [],
  );
  const isWizard = preset === 'wizard' && wizard !== null && wizard.steps > 1;
  const lastStep = wizard === null || wizard.step >= wizard.steps - 1;

  const sectionLabels = (formDocument?.sections ?? [])
    .map((section) => section.label)
    .filter((label): label is string => label !== undefined && label !== '');

  const title =
    labels?.title ??
    dialog?.title ??
    (mode === 'create'
      ? t('ui:formDialog.title.create', 'New {entity}', { entity })
      : t('ui:formDialog.title.edit', 'Edit {entity}', { entity }));

  /*
   * The subtitle says what the form IS, and only what is true of it: the
   * sections it has, else the one sentence the old modal showed. A spelled-out
   * number would not localize (DP4), so a list is a list.
   */
  const subtitle =
    dialog?.subtitle ??
    (sectionLabels.length > 0
      ? t('ui:formDialog.subtitle.sections', '{list} details', { list: sectionLabels.join(' · ') })
      : mode === 'create'
        ? t('ui:templates.crud.createSubtitle', 'Creates one row in {table}.', { table: tableName })
        : undefined);

  const submitLabel =
    labels?.submit ??
    dialog?.cta?.label ??
    (mode === 'create'
      ? t('ui:formDialog.cta.create', 'Create {entity}', { entity })
      : t('ui:templates.crud.saveSubmit', 'Save changes'));

  /*
   * A generated footnote is only ever a TRUE one (DP7). "Required fields marked
   * *" is true exactly when a field carries the mark, so it is derived from the
   * document rather than always shown; `false` is an admin saying "none".
   */
  const anyRequired = (formDocument?.sections ?? []).some((section) =>
    section.fields.some((field) => 'column' in field && field.required === true),
  );
  const footnote =
    dialog?.footnote === false
      ? undefined
      : (dialog?.footnote ??
        (anyRequired ? t('ui:formDialog.footnote.required', 'Required fields marked *') : undefined));

  const ctaIcon = dialog?.cta?.icon ?? (mode === 'create' ? 'check' : 'check');

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      width={PRESET_WIDTH[preset] ?? 640}
      {...(modal === undefined ? {} : { modal })}
    >
      <FormDialogHeader
        icon={icon ?? (mode === 'create' ? <Plus /> : <Pencil />)}
        title={title}
        {...(subtitle === undefined ? {} : { subtitle })}
        closeLabel={labels?.close ?? t('ui:action.close', 'Close')}
      />
      <FormDialogBody>
        <RecordForm
          {...formProps}
          formId={formId}
          mode={mode}
          onWizard={onWizard}
          {...(formDocument === undefined || formDocument === null ? {} : { document: formDocument })}
        />
      </FormDialogBody>
      <FormDialogFooter {...(footnote === undefined ? {} : { footnote })}>
        {isWizard ? (
          /*
           * DISABLED on step one, not hidden and not a no-op (DP13): the comp
           * dims it, and a control that does nothing has to say so to
           * assistive tech as well as to the eye.
           */
          <Button
            type="button"
            variant="secondary"
            disabled={wizard.step === 0}
            onClick={() => wizard.back()}
            data-testid="record-form-back"
          >
            {t('ui:formDialog.wizard.back', 'Back')}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          {t('ui:action.cancel', 'Cancel')}
        </Button>
        {isWizard && !lastStep ? (
          <Button type="button" variant="primary" onClick={() => wizard.next()} data-testid="record-form-next">
            {t('ui:formDialog.wizard.next', 'Continue')}
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : (
          <Button type="submit" form={formId} variant="primary" disabled={saving}>
            {saving ? (
              <Spinner size="sm" />
            ) : ctaIcon === 'plus' ? (
              <Plus aria-hidden="true" />
            ) : (
              <Check aria-hidden="true" />
            )}
            {submitLabel}
          </Button>
        )}
      </FormDialogFooter>
    </FormDialog>
  );
}
