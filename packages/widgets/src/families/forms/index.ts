/**
 * `forms` family public surface (annex §10) — the form/wizard/input components
 * (modal-wizard, drawer-form, stepper, progress-bar, otp-input, chip-input,
 * segmented-control, filter-chip-bar, toggle-switch-list, option-cards,
 * password-strength-meter, validation-issues-list) plus the TRACK FCS registry
 * metadata. Component code is also reachable through each definition's `lazy()`
 * ref, so the registry still emits one chunk per family (04 §2.3); this barrel is
 * for direct template/story composition and tests. Registry metadata lives in
 * `forms-track.definitions.ts`; schemas + demo generators in `forms-config.ts`.
 */
export { DrawerFormWidget, drawerFormConfigSchema, drawerFormDemoData, type DrawerFormConfig } from './DrawerForm.js';
export {
  ALL_KEY,
  FilterChipBarWidget,
  facetsOf,
  filterChipBarConfigSchema,
  filterChipBarDemoData,
  type Facet,
  type FilterChipBarConfig,
} from './FilterChipBar.js';
export { FormFields, type FormFieldsProps } from './FormFields.js';
export {
  ChipInputWidget,
  OtpInputWidget,
  PasswordStrengthMeterWidget,
  SegmentedControlWidget,
  chipInputConfigSchema,
  chipInputDemoData,
  otpInputConfigSchema,
  otpInputDemoData,
  passwordStrengthMeterConfigSchema,
  passwordStrengthMeterDemoData,
  segmentedControlConfigSchema,
  segmentedControlDemoData,
  type ChipInputConfig,
  type OtpInputConfig,
  type PasswordStrengthMeterConfig,
  type SegmentedControlConfig,
} from './InputWidgets.js';
export { ModalWizardWidget, modalWizardConfigSchema, modalWizardDemoData, type ModalWizardConfig } from './ModalWizard.js';
export {
  OptionCardsWidget,
  optionCardsConfigSchema,
  optionCardsDemoData,
  optionsOf,
  type OptionCard,
  type OptionCardsConfig,
} from './OptionCards.js';
export { ProgressBarWidget, progressBarConfigSchema, progressBarDemoData, type ProgressBarConfig } from './ProgressBarWidget.js';
export { StepperWidget, stepperConfigSchema, stepperDemoData, stepsOf, type StepDef, type StepperConfig } from './StepperWidget.js';
export {
  DEFAULT_TOGGLE_ROWS,
  ToggleSwitchListWidget,
  toggleSwitchListConfigSchema,
  toggleSwitchListDemoData,
  type ToggleSwitchListConfig,
} from './ToggleSwitchList.js';
export {
  ValidationIssuesListWidget,
  issuesOf,
  sortIssues,
  validationIssuesListConfigSchema,
  validationIssuesListDemoData,
  type ValidationIssue,
  type ValidationIssuesListConfig,
} from './ValidationIssuesList.js';
export {
  DEFAULT_SEVERITY_TONE,
  FORM_TONES,
  ISSUE_SEVERITIES,
  PASSWORD_SCORE_MAX,
  STEP_STATES,
  booleanEntriesOf,
  booleanField,
  clampPct,
  facetCountsOf,
  formatCount,
  formatRows,
  numberField,
  oneOf,
  recordRowsOf,
  resolveLocale,
  stringField,
  uiToneOf,
  type FormTone,
  type IssueSeverity,
  type StepState,
} from './forms-lib.js';
export {
  bindingTargetOf,
  formFieldsOf,
  formValuesOf,
  initialValues,
  missingRequired,
  resolveFields,
  type BindingTarget,
} from './forms-state.js';
export { FORM_ICON_NAMES, formIcon, severityIcon } from './forms-icons.js';
export {
  DEFAULT_SEGMENTS,
  FIELD_KINDS,
  formFieldSchema,
  toggleRowSchema,
  type FieldKind,
  type FormFieldConfig,
  type ToggleRowConfig,
} from './forms-config.js';
export {
  chipInputDefinition,
  drawerFormDefinition,
  filterChipBarDefinition,
  formsTrackDefinitions,
  modalWizardDefinition,
  optionCardsDefinition,
  otpInputDefinition,
  passwordStrengthMeterDefinition,
  progressBarDefinition,
  segmentedControlDefinition,
  stepperDefinition,
  toggleSwitchListDefinition,
  validationIssuesListDefinition,
} from './forms-track.definitions.js';
