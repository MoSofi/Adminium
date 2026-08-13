/**
 * Config inspector (04-widget-registry.md task 04-T14): a side drawer whose
 * fields are auto-generated from the selected widget's Zod config schema
 * (`deriveInspectorFields`). Each edit updates the item's config live. Locked
 * config paths (Tier A derived / LLM-locked, 04 §9) render disabled with a lock
 * affordance. Keyboard-navigable — it is a stack of standard form controls in a
 * Radix dialog.
 */

import { Lock } from 'lucide-react';
import type { ReactElement } from 'react';
import type { WidgetDefinition } from '@adminium/widgets';
import {
  Drawer,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  FormField,
  Input,
  NumberStepper,
  Select,
  Switch,
} from '@adminium/ui';

import { t } from '../../i18n/t.js';
import { deriveInspectorFields, type InspectorField } from './inspectorFields.js';
import { humanize } from './text.js';

export interface ConfigInspectorProps {
  open: boolean;
  definition: WidgetDefinition | undefined;
  config: Record<string, unknown>;
  lockedPaths: readonly string[];
  widgetName: string;
  onChange: (config: Record<string, unknown>) => void;
  onClose: () => void;
}

function fieldLabel(field: InspectorField): string {
  /* i18n-dynamic-key: `field.key` is a top-level property name read off an arbitrary widget's
     Zod config schema at runtime (`deriveInspectorFields`), including widgets supplied by a
     manifest-host registry. It is typed `string` with no union to enumerate, so no map of
     literal keys is possible; `humanize(field.key)` is what renders. */
  return t(`builder.fields.${field.key}`, humanize(field.key));
}

function optionLabel(value: string): string {
  /* i18n-dynamic-key: `value` is a member of an arbitrary widget's Zod enum, harvested from
     that schema at runtime, so the set is open-ended for the same reason as `fieldLabel`. */
  return t(`builder.enums.${value}`, humanize(value));
}

function LockTag() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-caption font-medium text-fg-muted"
      title={t('builder.inspector.lockedHint', 'This field is set by the source and can’t be edited here.')}
    >
      <Lock className="size-3" aria-hidden="true" />
      {t('builder.inspector.locked', 'Locked')}
    </span>
  );
}

/**
 * Render the control element for a field. Returned as `FormField`'s direct
 * child so its Radix `Slot` injects `id` / `aria-*` straight onto the control
 * (label association, `getByLabelText`).
 */
function renderControl(
  field: InspectorField,
  value: unknown,
  onChange: (next: unknown) => void,
): ReactElement {
  if (field.kind === 'boolean') {
    return (
      <Switch checked={value === true} disabled={field.locked} onCheckedChange={(next) => onChange(next)} />
    );
  }
  if (field.kind === 'number') {
    return (
      <NumberStepper
        value={typeof value === 'number' ? value : null}
        disabled={field.locked}
        {...(field.min !== undefined ? { min: field.min } : {})}
        {...(field.max !== undefined ? { max: field.max } : {})}
        step={field.step}
        incrementLabel={t('builder.inspector.increment', 'Increase')}
        decrementLabel={t('builder.inspector.decrement', 'Decrease')}
        onValueChange={(next) => onChange(next ?? undefined)}
      />
    );
  }
  if (field.kind === 'enum') {
    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        disabled={field.locked}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      >
        <option value="">{t('builder.inspector.selectPlaceholder', 'Select…')}</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <Input
      value={typeof value === 'string' ? value : ''}
      disabled={field.locked}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
    />
  );
}

export function ConfigInspector({
  open,
  definition,
  config,
  lockedPaths,
  widgetName,
  onChange,
  onClose,
}: ConfigInspectorProps) {
  const fields = definition === undefined ? [] : deriveInspectorFields(definition.configSchema, lockedPaths);

  const setField = (key: string, next: unknown): void => {
    const nextConfig = { ...config };
    if (next === undefined) delete nextConfig[key];
    else nextConfig[key] = next;
    onChange(nextConfig);
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="sm"
    >
      <DrawerHeader
        title={t('builder.inspector.title', 'Configure widget')}
        subtitle={widgetName}
        closeLabel={t('common.close', 'Close')}
      />
      <DrawerBody>
        {fields.length === 0 ? (
          <p className="text-body-sm text-fg-muted">
            {t('builder.inspector.empty', 'This widget has no options to configure.')}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {fields.map((field) => (
              <FormField
                key={field.key}
                label={fieldLabel(field)}
                {...(field.locked ? { tag: <LockTag /> } : {})}
                {...(field.locked
                  ? {
                      helper: t(
                        'builder.inspector.lockedHint',
                        'This field is set by the source and can’t be edited here.',
                      ),
                    }
                  : {})}
              >
                {renderControl(field, config[field.key], (next) => setField(field.key, next))}
              </FormField>
            ))}
          </div>
        )}
      </DrawerBody>
      <DrawerFooter>
        <button
          type="button"
          className="text-body-sm font-bold text-accent hover:underline"
          onClick={onClose}
        >
          {t('builder.inspector.done', 'Done')}
        </button>
      </DrawerFooter>
    </Drawer>
  );
}
