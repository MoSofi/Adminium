import { lazy } from 'react';

import {
  chipInputConfigSchema,
  chipInputDemoData,
  columnMappingTableConfigSchema,
  columnMappingTableDemoData,
  connectionStringFieldConfigSchema,
  connectionStringFieldDemoData,
  drawerFormConfigSchema,
  drawerFormDemoData,
  exportBuilderConfigSchema,
  exportBuilderDemoData,
  filterChipBarConfigSchema,
  filterChipBarDemoData,
  flowBuilderConfigSchema,
  flowBuilderDemoData,
  inlineEditableFieldConfigSchema,
  inlineEditableFieldDemoData,
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
  questionBuilderConfigSchema,
  questionBuilderDemoData,
  ruleBuilderConfigSchema,
  ruleBuilderDemoData,
  segmentedControlConfigSchema,
  segmentedControlDemoData,
  stepperConfigSchema,
  stepperDemoData,
  tableInclusionChecklistConfigSchema,
  tableInclusionChecklistDemoData,
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

/**
 * THE BUILDERS (`rule-builder`, `flow-builder`, `question-builder`) all take
 * `form-state`, not `record-list` — even though each carries a list. §3's
 * `record-list` is EMPTY when `total === 0`, which would hand a brand-new
 * builder the frame's "no data" state; a builder with no rows yet is not empty,
 * it is waiting for its first one and must show its add affordance.
 * `form-state` is never empty by §3, which is exactly right for a canvas.
 */
export const ruleBuilderDefinition: WidgetDefinition = defineWidget({
  id: 'rule-builder',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.RuleBuilderWidget }))),
  configSchema: ruleBuilderConfigSchema,
  dataContract: 'form-state',
  sizing: { minW: 6, minH: 4, defaultW: 8, defaultH: 6 }, // annex "min 6×2, default 8×3"
  placement: 'grid',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: ruleBuilderDemoData,
  descriptionKey: 'widgets.forms.ruleBuilder.description',
});

export const flowBuilderDefinition: WidgetDefinition = defineWidget({
  id: 'flow-builder',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.FlowBuilderWidget }))),
  configSchema: flowBuilderConfigSchema,
  dataContract: 'form-state',
  sizing: { minW: 6, minH: 10, defaultW: 8, defaultH: 12 }, // annex "main pane min 6×5"
  placement: 'grid',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: flowBuilderDemoData,
  descriptionKey: 'widgets.forms.flowBuilder.description',
});

export const connectionStringFieldDefinition: WidgetDefinition = defineWidget({
  id: 'connection-string-field',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.ConnectionStringFieldWidget }))),
  configSchema: connectionStringFieldConfigSchema,
  dataContract: 'form-state',
  sizing: { minW: 6, minH: 2, defaultW: 8, defaultH: 3 }, // annex "min 6×1"
  placement: 'inline',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: connectionStringFieldDemoData,
  descriptionKey: 'widgets.forms.connectionStringField.description',
});

export const tableInclusionChecklistDefinition: WidgetDefinition = defineWidget({
  id: 'table-inclusion-checklist',
  family: 'forms',
  component: lazy(() =>
    import('./forms-track-components.js').then((m) => ({ default: m.TableInclusionChecklistWidget })),
  ),
  configSchema: tableInclusionChecklistConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 4, minH: 6, defaultW: 6, defaultH: 8 }, // annex "min 4×3"
  placement: 'grid',
  skeleton: 'list',
  capabilities: { editsData: true },
  demoData: tableInclusionChecklistDemoData,
  descriptionKey: 'widgets.forms.tableInclusionChecklist.description',
});

export const columnMappingTableDefinition: WidgetDefinition = defineWidget({
  id: 'column-mapping-table',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.ColumnMappingTableWidget }))),
  configSchema: columnMappingTableConfigSchema,
  dataContract: 'record-list',
  sizing: { minW: 6, minH: 8, defaultW: 8, defaultH: 10 }, // annex "min 6×4"
  placement: 'grid',
  skeleton: 'table',
  capabilities: { editsData: true },
  demoData: columnMappingTableDemoData,
  descriptionKey: 'widgets.forms.columnMappingTable.description',
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

export const exportBuilderDefinition: WidgetDefinition = defineWidget({
  id: 'export-builder',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.ExportBuilderWidget }))),
  configSchema: exportBuilderConfigSchema,
  dataContract: 'form-state',
  sizing: { minW: 3, minH: 6, defaultW: 4, defaultH: 8 }, // annex "min 3×3 / modal"
  placement: 'grid',
  skeleton: 'block',
  // `insert`: submitting queues an export JOB — a new record in the host's
  // export queue, not an edit to the data being exported.
  capabilities: { editsData: true },
  demoData: exportBuilderDemoData,
  descriptionKey: 'widgets.forms.exportBuilder.description',
});

export const questionBuilderDefinition: WidgetDefinition = defineWidget({
  id: 'question-builder',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.QuestionBuilderWidget }))),
  configSchema: questionBuilderConfigSchema,
  dataContract: 'form-state',
  // annex "palette rail 3×5 + canvas 6×6" — the pair is ONE widget, so the
  // default is their sum (9 wide); the rail collapses below `sm`, which is what
  // lets minW stay at the canvas's own 6.
  sizing: { minW: 6, minH: 10, defaultW: 9, defaultH: 12 },
  placement: 'grid',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: questionBuilderDemoData,
  descriptionKey: 'widgets.forms.questionBuilder.description',
});

export const inlineEditableFieldDefinition: WidgetDefinition = defineWidget({
  id: 'inline-editable-field',
  family: 'forms',
  component: lazy(() => import('./forms-track-components.js').then((m) => ({ default: m.InlineEditableFieldWidget }))),
  configSchema: inlineEditableFieldConfigSchema,
  // annex "bound field path on a doc object" — one row + one column name.
  dataContract: 'record',
  sizing: { minW: 2, minH: 1, defaultW: 3, defaultH: 2 }, // annex "inline"
  placement: 'inline',
  skeleton: 'block',
  capabilities: { editsData: true },
  demoData: inlineEditableFieldDemoData,
  descriptionKey: 'widgets.forms.inlineEditableField.description',
});

/**
 * Every `forms` widget, in annex §10 order — the TRACK FCS slice (M7 Wave 3)
 * plus the M7 Wave-4 TAIL that completes the family (TRACK FORMS): the two
 * builder canvases, the two Studio-wizard widgets lifted out of
 * `apps/dashboard` (see `ConnectionStringField.tsx` / `TableInclusionChecklist.tsx`),
 * the import wizard's column mapper, the export builder, the survey editor and
 * the document-canvas inline field.
 */
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
  ruleBuilderDefinition,
  flowBuilderDefinition,
  connectionStringFieldDefinition,
  tableInclusionChecklistDefinition,
  columnMappingTableDefinition,
  validationIssuesListDefinition,
  exportBuilderDefinition,
  questionBuilderDefinition,
  inlineEditableFieldDefinition,
  passwordStrengthMeterDefinition,
];
