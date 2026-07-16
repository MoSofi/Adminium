/**
 * `drawer-form` (annex §10) — side-drawer create/edit flow with the full field
 * set; appends the record on submit. The >5-field counterpart of `modal-wizard`
 * (annex §10 auto-instantiation: "≤5 fields → modal-wizard, more → drawer-form
 * or full page"). Evidence: Scheduled Reports.
 *
 * Wraps @adminium/ui's `Drawer` (Radix — focus trap, Esc/overlay close, the
 * inline-end slide) and shares `FormFields` with `modal-wizard`.
 *
 * WRITE MODEL (04 §2.1): submit emits an `insert` INTENT and awaits the host's
 * commit before closing, so a rejected write leaves the drawer open with the
 * user's input intact rather than silently discarding it.
 */

import { Button, Drawer, DrawerBody, DrawerFooter, DrawerHeader } from '@adminium/ui';
import { useState } from 'react';

import { FormFields } from './FormFields.js';
import { bindingTargetOf, initialValues, missingRequired, resolveFields } from './forms-state.js';
import { drawerFormConfigSchema, drawerFormDemoData } from './forms-config.js';
import type { DrawerFormConfig } from './forms-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { drawerFormConfigSchema, drawerFormDemoData };
export type { DrawerFormConfig };

export function DrawerFormWidget({ config, data, instanceId, onEvent }: WidgetProps<DrawerFormConfig>) {
  const fields = resolveFields(config.fields, data);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(fields, data));
  const [invalid, setInvalid] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const target = bindingTargetOf(config.binding);

  const submit = async () => {
    const missing = missingRequired(fields, values);
    setInvalid(missing);
    if (missing.length > 0) return;

    if (target === null) {
      setOpen(false);
      return;
    }

    setSubmitting(true);
    try {
      await onEvent({
        type: 'mutate',
        intent: 'insert',
        connectionId: target.connectionId,
        table: target.table,
        values,
      });
      setOpen(false);
    } catch {
      // Host owns error surfacing; the drawer stays open with the input intact.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center px-4 pb-4" data-widget="drawer-form" data-testid={config.testId}>
      <Button size="sm" data-part="drawer-trigger" onClick={() => setOpen(true)}>
        {config.triggerLabel ?? config.title ?? 'New'}
      </Button>

      <Drawer open={open} onOpenChange={setOpen} size={config.width}>
        <DrawerHeader
          title={config.title ?? 'New record'}
          {...(config.subtitleText === undefined ? {} : { subtitle: config.subtitleText })}
          closeLabel={config.cancelLabel ?? 'Close'}
        />
        <DrawerBody>
          <FormFields
            fields={fields}
            values={values}
            invalid={invalid}
            idPrefix={instanceId}
            onChange={(name, value) => {
              setValues((previous) => ({ ...previous, [name]: value }));
              setInvalid((previous) => previous.filter((entry) => entry !== name));
            }}
          />
        </DrawerBody>
        <DrawerFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {config.cancelLabel ?? 'Cancel'}
          </Button>
          <Button size="sm" data-part="drawer-submit" disabled={submitting} onClick={() => void submit()}>
            {config.submitLabel ?? 'Save'}
          </Button>
        </DrawerFooter>
      </Drawer>
    </div>
  );
}
