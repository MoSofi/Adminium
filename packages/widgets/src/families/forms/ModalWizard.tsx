/**
 * `modal-wizard` (annex §10) — the two-state modal (form → success
 * confirmation): backdrop/Escape close, submit harvests values and persists, the
 * success step confirms with a summary. THE standard "create record" affordance
 * across the product (annex §10 lists ~20 evidence comps), and the
 * auto-instantiation target for any table with ≤5 generated fields.
 *
 * Wraps @adminium/ui's `TwoPhaseModal` + `useModalFlow`, which own the phase
 * machine, the focus-preserving body swap, and the deferred reset that stops the
 * success step flashing back to the form while closing. This file adds the
 * `form-state` binding, the generated field set, required-field validation, and
 * the `insert` intent.
 *
 * WRITE MODEL (04 §2.1): submit emits a `mutate` INTENT — the widget never
 * writes. The host runs it through the CRUD API (with undo + audit) and only
 * then does the modal advance to its success phase, so a rejected insert cannot
 * show a "Created!" confirmation.
 */

import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TwoPhaseModal,
  useModalFlow,
} from '@adminium/ui';
import { useMaybeT } from '@adminium/i18n/react';
import { useState } from 'react';

import { FormFields } from './FormFields.js';
import { bindingTargetOf, initialValues, missingRequired, resolveFields } from './forms-state.js';
import { modalWizardConfigSchema, modalWizardDemoData } from './forms-config.js';
import type { ModalWizardConfig } from './forms-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { modalWizardConfigSchema, modalWizardDemoData };
export type { ModalWizardConfig };

export function ModalWizardWidget({ config, data, instanceId, onEvent }: WidgetProps<ModalWizardConfig>) {
  const t = useMaybeT();
  const fields = resolveFields(config.fields, data);
  const flow = useModalFlow<Record<string, unknown>>();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(fields, data));
  const [invalid, setInvalid] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const target = bindingTargetOf(config.binding);

  const submit = async () => {
    const missing = missingRequired(fields, values);
    setInvalid(missing);
    if (missing.length > 0) return;

    // Unbound (demo/story/palette) instance: no host to persist through, so go
    // straight to the success phase rather than emitting an intent into the void.
    if (target === null) {
      flow.toSuccess(values);
      return;
    }

    setSubmitting(true);
    try {
      // The host MAY return a promise that rejects on a failed commit
      // (WidgetProps.onEvent) — awaiting it is what keeps a rejected insert from
      // rendering a "Created!" confirmation. A host that returns void resolves
      // immediately, which is the same behaviour as before.
      await onEvent({
        type: 'mutate',
        intent: 'insert',
        connectionId: target.connectionId,
        table: target.table,
        values,
      });
      flow.toSuccess(values);
    } catch {
      // The host owns error surfacing (a toast, an inline banner); the modal
      // simply stays on its form so the user's input is not lost.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center px-4 pb-4" data-widget="modal-wizard" data-testid={config.testId}>
      <Button size="sm" data-part="wizard-trigger" onClick={() => setOpen(true)}>
        {config.triggerLabel ?? config.title ?? t('ui:widgets.forms.modalWizard.trigger', 'Create')}
      </Button>

      <TwoPhaseModal
        flow={flow}
        open={open}
        onOpenChange={setOpen}
        size={config.size}
        successTitle={config.successTitle ?? t('ui:widgets.forms.modalWizard.successTitle', 'Created')}
        successBody={config.successBody ?? t('ui:widgets.forms.modalWizard.successBody', 'The record was saved.')}
        doneLabel={config.doneLabel ?? t('ui:widgets.forms.modalWizard.done', 'Done')}
      >
        <ModalHeader
          title={config.title ?? t('ui:widgets.forms.modalWizard.titleLabel', 'Create record')}
          {...(config.subtitleText === undefined ? {} : { subtitle: config.subtitleText })}
          closeLabel={config.cancelLabel ?? t('ui:widgets.forms.modalWizard.closeLabel', 'Close')}
        />
        <ModalBody>
          <FormFields
            fields={fields}
            values={values}
            invalid={invalid}
            idPrefix={instanceId}
            onChange={(name, value) => {
              setValues((previous) => ({ ...previous, [name]: value }));
              // Clear the field's error as soon as it is touched — leaving it
              // red while the user fixes it reads as "still wrong".
              setInvalid((previous) => previous.filter((entry) => entry !== name));
            }}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {config.cancelLabel ?? t('ui:widgets.forms.modalWizard.cancel', 'Cancel')}
          </Button>
          <Button size="sm" data-part="wizard-submit" disabled={submitting} onClick={() => void submit()}>
            {config.submitLabel ?? t('ui:widgets.forms.modalWizard.submit', 'Create')}
          </Button>
        </ModalFooter>
      </TwoPhaseModal>
    </div>
  );
}

/** Re-exported for template composition + stories. */
export { Modal };
