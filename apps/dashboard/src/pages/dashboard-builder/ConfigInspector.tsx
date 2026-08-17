/**
 * Config inspector (04-widget-registry.md task 04-T14): a side drawer whose
 * fields are auto-generated from the selected widget's Zod config schema
 * (`deriveInspectorFields`). Each edit updates the item's config live. Locked
 * config paths (Tier A derived / LLM-locked, 04 §9) render disabled with a lock
 * affordance. Keyboard-navigable — it is a stack of standard form controls in a
 * Radix dialog.
 *
 * The DATA SOURCE row at the top is not auto-generated: `binding` is a nested
 * query document, so `deriveInspectorFields` skips it and `BindingEditor` (a
 * dedicated surface, lazily loaded) authors it. The row is also the only place
 * in edit mode that tells the truth about whether a widget is bound — the
 * builder canvas renders `demoData(seed)` for BOTH bound and unbound widgets by
 * design, so on screen they are indistinguishable.
 */

import { Database, Lock } from 'lucide-react';
import { Suspense, lazy, useMemo, useState, type ReactElement } from 'react';
import { validateConfigAgainst, type WidgetDefinition } from '@adminium/widgets';
import { queryDescriptorSchema, type QueryDescriptor } from '@adminium/engine/config';
import {
  Alert,
  Button,
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
import { summarizeBinding } from './bindingDraft.js';
import { deriveInspectorFields, type InspectorField } from './inspectorFields.js';
import { humanize } from './text.js';

/* The binding editor pulls in the schema-snapshot client and a form the size of
   this whole drawer, and it cannot be on screen until the user opens it — same
   reasoning (and the same ratchet, apps/dashboard/scripts/check-entry-budget.mjs)
   that keeps this inspector itself out of the entry chunk. */
const BindingEditor = lazy(async () => ({
  default: (await import('./BindingEditor.js')).BindingEditor,
}));

export interface ConfigInspectorProps {
  open: boolean;
  definition: WidgetDefinition | undefined;
  config: Record<string, unknown>;
  lockedPaths: readonly string[];
  widgetName: string;
  /** The page's connection (`page.source.connectionId`) — the binding's scope. */
  connectionId?: string | null | undefined;
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

/**
 * What the item's stored `config.binding` is.
 *
 * READ FROM THE SPARSE STORED CONFIG. The controls below display the EFFECTIVE
 * config (defaults materialized); a binding is never a default, and reading it
 * from the effective object would make "bound" and "unbound" the same state on
 * a widget whose schema happens to declare one.
 *
 * `invalid` is its own case rather than folded into `none`: a stored binding
 * that no longer parses is what `extractBindings` turns into a per-widget error
 * on the live page, so the inspector has to offer to fix it, not report the
 * widget as merely unbound.
 */
type BindingState =
  | { kind: 'none' }
  | { kind: 'bound'; descriptor: QueryDescriptor }
  | { kind: 'invalid' };

function readBinding(config: Record<string, unknown>): BindingState {
  const raw = config['binding'];
  if (raw === undefined) return { kind: 'none' };
  const parsed = queryDescriptorSchema.safeParse(raw);
  return parsed.success ? { kind: 'bound', descriptor: parsed.data } : { kind: 'invalid' };
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
  connectionId,
  onChange,
  onClose,
}: ConfigInspectorProps) {
  const fields = definition === undefined ? [] : deriveInspectorFields(definition.configSchema, lockedPaths);
  const [editorOpen, setEditorOpen] = useState(false);
  const binding = useMemo(() => readBinding(config), [config]);

  /**
   * WHAT THE CONTROLS DISPLAY — the widget's EFFECTIVE config, not the raw
   * stored object.
   *
   * The two had drifted apart, and that gap was the whole "I change a field and
   * nothing happens" report. Generated pages store a minimal config (often just
   * `{ title }`); the widget renders `validateConfigAgainst(...)`, which fills in
   * every `.default()`. So a `kpi-stat-card` stored as `{title:'Total Orders'}`
   * showed `showSparkline` OFF in the drawer while the sparkline was visibly on
   * screen — and toggling it ON wrote the value it already effectively had, so
   * nothing changed. Same for metricFormat, deltaMode, iconName and iconTone.
   *
   * Writes still go through the SPARSE stored `config` below, so opening a
   * drawer and nudging one field does not silently materialize every default
   * into `adminium_pages.config`.
   */
  const effective = useMemo<Record<string, unknown>>(
    () => (definition === undefined ? config : validateConfigAgainst(definition, config).config),
    [definition, config],
  );

  const setField = (key: string, next: unknown): void => {
    const nextConfig = { ...config };
    if (next === undefined) delete nextConfig[key];
    else nextConfig[key] = next;
    onChange(nextConfig);
  };

  // Same sparse-write discipline as `setField`: a shallow copy, and CLEARING
  // deletes the key rather than storing `undefined` — `extractBindings` skips a
  // missing key, but a present-and-undefined one round-trips through JSON as
  // nothing at all only by accident.
  const setBinding = (descriptor: QueryDescriptor): void => {
    onChange({ ...config, binding: descriptor });
  };
  const clearBinding = (): void => {
    const nextConfig = { ...config };
    delete nextConfig['binding'];
    onChange(nextConfig);
  };

  const summary = binding.kind === 'bound' ? summarizeBinding(binding.descriptor) : null;

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
        {/*
          DATA SOURCE — the affordance that stops a user shipping a dashboard
          that lies. The builder canvas feeds every widget `demoData(seed)`
          (BuilderGrid), by design, so a bound widget and an unbound one look
          identical while editing; without this row the only way to discover
          that a widget was never wired to the database is to publish it and
          watch it keep showing invented numbers.
        */}
        {definition === undefined ? null : (
          <section className="mb-5 flex flex-col gap-2 border-b border-border pb-5">
            <h3 className="text-caption font-bold uppercase tracking-wide text-fg-subtle">
              {t('builder.binding.title', 'Data source')}
            </h3>
            {summary === null ? (
              <Alert
                tone={binding.kind === 'invalid' ? 'danger' : 'warn'}
                title={
                  binding.kind === 'invalid'
                    ? t('builder.binding.brokenTitle', 'This widget’s query is broken')
                    : t('builder.binding.unboundTitle', 'Not connected to your data')
                }
                body={
                  binding.kind === 'invalid'
                    ? t(
                        'builder.binding.brokenBody',
                        'It no longer matches a query this version understands, so the widget shows an error on the live page.',
                      )
                    : t(
                        'builder.binding.unboundBody',
                        'It shows sample numbers here AND on the live page. Connect it to a table to show real data.',
                      )
                }
              />
            ) : (
              <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-surface-2 p-3">
                <span className="font-mono text-body-sm text-fg">{summary.source}</span>
                <span className="text-caption text-fg-muted">
                  {summary.measure === null
                    ? t('builder.binding.summaryColumns', '{count} columns', {
                        count: summary.columns ?? 0,
                      })
                    : summary.measure}
                </span>
                {summary.filterCount > 0 ? (
                  <span className="text-caption text-fg-muted">
                    {t('builder.binding.summaryFilters', '{count} filters', {
                      count: summary.filterCount,
                    })}
                  </span>
                ) : null}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Database className="size-4" aria-hidden="true" />}
                onClick={() => setEditorOpen(true)}
              >
                {summary === null
                  ? t('builder.binding.connect', 'Connect to data')
                  : t('builder.binding.edit', 'Edit query')}
              </Button>
              {binding.kind === 'none' ? null : (
                <Button variant="ghost" size="sm" onClick={clearBinding}>
                  {t('builder.binding.remove', 'Remove data source')}
                </Button>
              )}
            </div>
          </section>
        )}

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
                {renderControl(field, effective[field.key], (next) => setField(field.key, next))}
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

      {editorOpen && definition !== undefined ? (
        <Suspense fallback={null}>
          <BindingEditor
            connectionId={connectionId}
            definition={definition}
            widgetName={widgetName}
            // An `invalid` binding opens a BLANK form on purpose: there is no
            // draft to load out of a document that no longer parses, and
            // pretending otherwise would half-fill the controls from whichever
            // fields happened to survive. Removing it stays in the row above.
            binding={binding.kind === 'bound' ? binding.descriptor : undefined}
            onSave={setBinding}
            onClear={clearBinding}
            onClose={() => setEditorOpen(false)}
          />
        </Suspense>
      ) : null}
    </Drawer>
  );
}
