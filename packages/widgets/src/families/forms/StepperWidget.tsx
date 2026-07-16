/**
 * `stepper` (annex §10) — progress stepper, horizontal or vertical: numbered /
 * spinner / check circles, connector lines filling accent on completion,
 * clickable navigation, label + sub per step. Evidence: Auth & Onboarding,
 * Connect Database, Import Wizard, Onboarding (vertical), Project Overview.
 *
 * Wraps @adminium/ui's `Stepper`, which owns the circles, connectors and the
 * `ol` semantics; this file adds the `record-list` binding, the per-step state
 * derivation, and routes step clicks through `onEvent`.
 */

import { Stepper } from '@adminium/ui';

import { oneOf, recordRowsOf, stringField } from './forms-lib.js';
import type { StepState } from './forms-lib.js';
import { STEP_STATES, stepperConfigSchema, stepperDemoData } from './forms-config.js';
import type { StepperConfig } from './forms-config.js';
import type { WidgetProps } from '../../registry/types.js';

export { stepperConfigSchema, stepperDemoData };
export type { StepperConfig };

export interface StepDef {
  key: string;
  label: string;
  description?: string | undefined;
  state?: StepState | undefined;
}

/**
 * Project the §3 `record-list` payload onto step defs.
 *
 * A row's explicit `state` wins; where the payload carries none, the state is
 * DERIVED from the row's position relative to `activeIndex` — so a plain
 * `{label}` list still renders a correct done/active/pending run rather than an
 * all-pending one.
 */
export function stepsOf(data: unknown, config: StepperConfig): StepDef[] {
  const rows = recordRowsOf(data);
  const out: StepDef[] = [];
  for (const [index, row] of rows.entries()) {
    const label = stringField(row, config.labelField);
    if (label === undefined) continue;
    const raw = row[config.stateField];
    const state =
      raw === undefined
        ? index < config.activeIndex
          ? 'done'
          : index === config.activeIndex
            ? 'active'
            : 'pending'
        : oneOf(raw, STEP_STATES, 'pending');
    out.push({
      key: stringField(row, config.keyField) ?? `step-${index}`,
      label,
      description: config.showDescriptions ? stringField(row, config.descField) : undefined,
      state,
    });
  }
  return out;
}

export function StepperWidget({ config, data, onEvent }: WidgetProps<StepperConfig>) {
  const steps = stepsOf(data, config);
  if (steps.length === 0) return null;

  // The active index the UI component highlights: an explicitly-`active` row
  // wins over the config index, so a payload-driven run stays authoritative.
  const activeFromRows = steps.findIndex((step) => step.state === 'active');
  const activeIndex = activeFromRows === -1 ? config.activeIndex : activeFromRows;

  return (
    <div className="flex h-full items-center px-4 pb-4" data-widget="stepper" data-testid={config.testId}>
      <Stepper
        className="w-full"
        label={config.a11yLabel ?? config.title ?? 'Progress'}
        orientation={config.orientation}
        activeIndex={activeIndex}
        steps={steps.map((step) => ({
          id: step.key,
          label: step.label,
          ...(step.description === undefined ? {} : { description: step.description }),
          ...(step.state === undefined ? {} : { state: step.state }),
        }))}
        {...(config.clickable && config.href !== undefined
          ? {
              // Step navigation is a host concern: the widget reports the intent
              // and the host routes it (04 §2.1). Without an href there is
              // nowhere to go, so the stepper stays read-only.
              onStepClick: (index: number) =>
                onEvent({ type: 'drill-through', href: `${config.href as string}?step=${steps[index]?.key ?? index}` }),
            }
          : {})}
      />
    </div>
  );
}
