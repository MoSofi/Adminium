import { lazy } from 'react';

import {
  chipInputConfigSchema,
  chipInputDemoData,
  drawerFormConfigSchema,
  drawerFormDemoData,
  filterChipBarConfigSchema,
  filterChipBarDemoData,
  modalWizardConfigSchema,
  modalWizardDemoData,
  optionCardsConfigSchema,
  optionCardsDemoData,
  otpInputConfigSchema,
  otpInputDemoData,
  passwordStrengthMeterConfigSchema,
  passwordStrengthMeterDemoData,
  progressBarConfigSchema,
  progressBarDemoData,
  segmentedControlConfigSchema,
  segmentedControlDemoData,
  stepperConfigSchema,
  stepperDemoData,
  toggleSwitchListConfigSchema,
  toggleSwitchListDemoData,
  validationIssuesListConfigSchema,
  validationIssuesListDemoData,
} from './forms-config.js';
import { defineWidget } from '../../registry/types.js';
import type { WidgetDefinition } from '../../registry/types.js';

/**
 * TRACK FCS — `forms` family registry metadata (annex §10; 04-T10). Metadata
 * only: components load through the `forms-track-components` barrel via
 * `lazy(() => import(...))`, so the family stays in ONE lazy chunk and the
 * registry metadata never eagerly pulls component code — or Radix's
 * dialog/radio/switch — into a sibling family's bundle (04 §2.3; the
 * chunk-budget gate). Schemas + `demoData` come from the PURE `forms-config.ts`
 * for the same reason. The GREEN LOOP spreads `formsTrackDefinitions` into the
 * registry map. Widget ids match the annex catalog exactly (acceptance #1).
 *
 * Sizing is the annex's grid note converted to 40px half-units
 * (04 §6.1: `h = round(annexRows × 2)`); widths map 1:1.
 *
 * SHAPE CHOICES (04 §3): the input widgets take `form-state` — the §3 envelope
 * for "field defs + values", which is exactly what a generated create/edit form
 * is. `stepper`, `option-cards`, `filter-chip-bar` and `validation-issues-list`
 * take `record-list` (step defs, option defs, the sibling list they count, the
 * issue list). `toggle-switch-list` takes `boolean-map` — the shape the annex
 * names for it. `progress-bar` takes `single-metric` (one 0–100 value).
 *
 * `capabilities.editsData` marks every widget that emits a `mutate` intent —
 * the host runs them through the CRUD API with undo + audit; widgets never write.
 * `password-strength-meter` is the one input that does NOT: the password never
 * leaves it.
 */

export const modalWizardDefinition: WidgetDefinition = defineWidget({
  id: 'modal-wizard',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.ModalWizardWidget }))),
  configSchema: modalWizardConfigSchema,
  dataContract: 'form-state',
  sizing: { minW: 2, minH: 2, defaultW: 3, defaultH: 2 }, // annex "overlay" (the trigger is inline)
  placement: 'overlay',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: modalWizardDemoData,
  descriptionKey: 'widgets.forms.modalWizard.description',
});

export const drawerFormDefinition: WidgetDefinition = defineWidget({
  id: 'drawer-form',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.DrawerFormWidget }))),
  configSchema: drawerFormConfigSchema,
  dataContract: 'form-state',
  sizing: { minW: 2, minH: 2, defaultW: 3, defaultH: 2 }, // annex "overlay drawer"
  placement: 'overlay',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: drawerFormDemoData,
  descriptionKey: 'widgets.forms.drawerForm.description',
});

export const stepperDefinition: WidgetDefinition = defineWidget({
  id: 'stepper',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.StepperWidget }))),
  configSchema: stepperConfigSchema,
  dataContract: 'record-list',
  // annex "min 6×1 horizontal / 3×4 vertical" — the horizontal default.
  sizing: { minW: 6, minH: 2, defaultW: 12, defaultH: 3 },
  placement: 'grid',
  skeleton: 'block',
  demoData: stepperDemoData,
  descriptionKey: 'widgets.forms.stepper.description',
});

export const progressBarDefinition: WidgetDefinition = defineWidget({
  id: 'progress-bar',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.ProgressBarWidget }))),
  configSchema: progressBarConfigSchema,
  dataContract: 'single-metric',
  sizing: { minW: 3, minH: 1, defaultW: 6, defaultH: 2 }, // annex "inline"
  placement: 'inline',
  skeleton: 'block',
  demoData: progressBarDemoData,
  descriptionKey: 'widgets.forms.progressBar.description',
});

export const otpInputDefinition: WidgetDefinition = defineWidget({
  id: 'otp-input',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.OtpInputWidget }))),
  configSchema: otpInputConfigSchema,
  dataContract: 'form-state',
  sizing: { minW: 3, minH: 2, defaultW: 4, defaultH: 3 }, // annex "inline"
  placement: 'inline',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: otpInputDemoData,
  descriptionKey: 'widgets.forms.otpInput.description',
});

export const chipInputDefinition: WidgetDefinition = defineWidget({
  id: 'chip-input',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.ChipInputWidget }))),
  configSchema: chipInputConfigSchema,
  dataContract: 'form-state',
  sizing: { minW: 4, minH: 2, defaultW: 6, defaultH: 3 }, // annex "inline"
  placement: 'inline',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: chipInputDemoData,
  descriptionKey: 'widgets.forms.chipInput.description',
});

export const segmentedControlDefinition: WidgetDefinition = defineWidget({
  id: 'segmented-control',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.SegmentedControlWidget }))),
  configSchema: segmentedControlConfigSchema,
  dataContract: 'form-state',
  sizing: { minW: 3, minH: 1, defaultW: 4, defaultH: 2 }, // annex "inline"
  placement: 'inline',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: segmentedControlDemoData,
  descriptionKey: 'widgets.forms.segmentedControl.description',
});

export const filterChipBarDefinition: WidgetDefinition = defineWidget({
  id: 'filter-chip-bar',
  family: 'forms',
  // The counts are aggregated from the SIBLING list, so this binds the list
  // itself rather than a pre-computed facet payload (annex §10).
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.FilterChipBarWidget }))),
  configSchema: filterChipBarConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 6, minH: 1, defaultW: 12, defaultH: 2 }, // annex "inline toolbar"
  placement: 'inline',
  skeleton: 'block',
  demoData: filterChipBarDemoData,
  descriptionKey: 'widgets.forms.filterChipBar.description',
});

export const toggleSwitchListDefinition: WidgetDefinition = defineWidget({
  id: 'toggle-switch-list',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.ToggleSwitchListWidget }))),
  configSchema: toggleSwitchListConfigSchema,
  dataContract: 'boolean-map',
  sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 8 }, // annex "min 4×3"
  placement: 'grid',
  skeleton: 'list',
  capabilities: { editsData: true },
  demoData: toggleSwitchListDemoData,
  descriptionKey: 'widgets.forms.toggleSwitchList.description',
});

export const optionCardsDefinition: WidgetDefinition = defineWidget({
  id: 'option-cards',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.OptionCardsWidget }))),
  configSchema: optionCardsConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 4, defaultW: 8, defaultH: 6 }, // annex "min 4×2"
  placement: 'grid',
  skeleton: 'card',
  capabilities: { editsData: true },
  demoData: optionCardsDemoData,
  descriptionKey: 'widgets.forms.optionCards.description',
});

export const passwordStrengthMeterDefinition: WidgetDefinition = defineWidget({
  id: 'password-strength-meter',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.PasswordStrengthMeterWidget }))),
  configSchema: passwordStrengthMeterConfigSchema,
  dataContract: 'form-state',
  sizing: { minW: 3, minH: 1, defaultW: 4, defaultH: 2 }, // annex "inline"
  placement: 'inline',
  skeleton: 'block',
  // No `editsData`: the password never leaves the widget — it is a pure
  // projection of a value the host's form owns.
  demoData: passwordStrengthMeterDemoData,
  descriptionKey: 'widgets.forms.passwordStrengthMeter.description',
});

export const validationIssuesListDefinition: WidgetDefinition = defineWidget({
  id: 'validation-issues-list',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.ValidationIssuesListWidget }))),
  configSchema: validationIssuesListConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 4, defaultW: 6, defaultH: 6 }, // annex "min 4×2"
  placement: 'grid',
  skeleton: 'list',
  demoData: validationIssuesListDemoData,
  descriptionKey: 'widgets.forms.validationIssuesList.description',
});

/** Every `forms` widget delivered by TRACK FCS, in annex §10 order. */
export const formsTrackDefinitions: readonly WidgetDefinition[] = [
  modalWizardDefinition,
  drawerFormDefinition,
  stepperDefinition,
  progressBarDefinition,
  otpInputDefinition,
  chipInputDefinition,
  segmentedControlDefinition,
  filterChipBarDefinition,
  toggleSwitchListDefinition,
  optionCardsDefinition,
  passwordStrengthMeterDefinition,
  validationIssuesListDefinition,
];
