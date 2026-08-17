// SPDX-License-Identifier: AGPL-3.0-only
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
export {
  ColumnMappingTableWidget,
  columnMappingTableConfigSchema,
  columnMappingTableDemoData,
  mappingRowsOf,
  type ColumnMappingTableConfig,
  type MappingRow,
} from './ColumnMappingTable.js';
export {
  ConnectionStringField,
  ConnectionStringFieldWidget,
  connectionStringFieldConfigSchema,
  connectionStringFieldDemoData,
  type ConnectionStringFieldConfig,
  type ConnectionStringFieldProps,
} from './ConnectionStringField.js';
export { DrawerFormWidget, drawerFormConfigSchema, drawerFormDemoData, type DrawerFormConfig } from './DrawerForm.js';
export {
  ExportBuilderWidget,
  exportBuilderConfigSchema,
  exportBuilderDemoData,
  exportStateOf,
  type ExportBuilderConfig,
  type ExportState,
} from './ExportBuilder.js';
export {
  FlowBuilderWidget,
  flowBuilderConfigSchema,
  flowBuilderDemoData,
  flowNodesOf,
  flowStatsOf,
  type FlowBuilderConfig,
  type FlowNode,
} from './FlowBuilder.js';
export {
  InlineEditableFieldWidget,
  boundRecordIdOf,
  boundValueOf,
  inlineEditableFieldConfigSchema,
  inlineEditableFieldDemoData,
  type InlineEditableFieldConfig,
} from './InlineEditableField.js';
export {
  QuestionBuilderWidget,
  questionBuilderConfigSchema,
  questionBuilderDemoData,
  questionsOf,
  type QuestionBuilderConfig,
  type SurveyQuestion,
} from './QuestionBuilder.js';
export {
  RuleBuilderWidget,
  conditionsOf,
  matchModeOf,
  ruleBuilderConfigSchema,
  ruleBuilderDemoData,
  type RuleBuilderConfig,
  type RuleCondition,
} from './RuleBuilder.js';
export {
  TableInclusionChecklist,
  TableInclusionChecklistWidget,
  inclusionTablesOf,
  initialInclusion,
  tableInclusionChecklistConfigSchema,
  tableInclusionChecklistDemoData,
  type TableInclusionChecklistConfig,
  type TableInclusionChecklistProps,
} from './TableInclusionChecklist.js';
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
  recordRowOf,
  recordRowsOf,
  resolveLocale,
  stringField,
  uiToneOf,
  type FormTone,
  type IssueSeverity,
  type StepState,
} from './forms-lib.js';
// The DSN grammar + the table-inclusion rules — LIFTED out of the Studio connect
// wizard, which now consumes them from here (see each module's header).
export {
  DSN_ENGINES,
  DSN_PROVIDER_CHIPS,
  dsnHost,
  dsnPlaceholder,
  dsnValidationCode,
  dsnWithEngine,
  engineForDsn,
  providerChipsFor,
  type DsnEngine,
  type DsnProviderChip,
  type DsnValidationCode,
} from './forms-dsn.js';
export {
  HIGH_VOLUME_ROWS,
  defaultIncludedIds,
  inclusionCounts,
  isHighVolume,
  type InclusionTable,
} from './forms-tables.js';
export {
  AUTO_MATCH_THRESHOLD,
  DEFAULT_OPERATORS_BY_TYPE,
  EXPORT_FORMATS,
  EXPORT_PHASES,
  FLOW_NODE_KINDS,
  FLOW_NODE_TONE,
  NPS_SCORES,
  QUESTION_KINDS,
  RATING_STARS,
  RULE_FIELD_TYPES,
  RULE_MATCH_MODES,
  RULE_OPERATORS,
  SKIP_TARGET,
  autoMatchTarget,
  canAppendNode,
  exportPhaseOf,
  moveItem,
  nameSimilarity,
  operatorTakesValue,
  operatorsForType,
  questionTakesOptions,
  repairOperator,
  type ExportFormat,
  type ExportPhase,
  type FlowNodeKind,
  type QuestionKind,
  type RuleFieldType,
  type RuleMatchMode,
  type RuleOperator,
} from './forms-builders.js';
export {
  bindingTargetOf,
  formFieldsOf,
  formValuesOf,
  initialValues,
  missingRequired,
  resolveFields,
  type BindingTarget,
} from './forms-state.js';
export { FORM_ICON_NAMES, formIcon, questionKindIcon, severityIcon } from './forms-icons.js';
export {
  DEFAULT_FLOW_PALETTE,
  DEFAULT_MAPPING_TARGETS,
  DEFAULT_OPERATOR_LABELS,
  DEFAULT_QUESTION_KIND_LABELS,
  DEFAULT_RULE_FIELDS,
  DEFAULT_SEGMENTS,
  FIELD_KINDS,
  flowNodeSchema,
  formFieldSchema,
  ruleFieldSchema,
  surveyQuestionSchema,
  toggleRowSchema,
  type FieldKind,
  type FlowNodeConfig,
  type FormFieldConfig,
  type RuleFieldConfig,
  type SurveyQuestionConfig,
  type ToggleRowConfig,
} from './forms-config.js';
export {
  chipInputDefinition,
  columnMappingTableDefinition,
  connectionStringFieldDefinition,
  drawerFormDefinition,
  exportBuilderDefinition,
  filterChipBarDefinition,
  flowBuilderDefinition,
  formsTrackDefinitions,
  inlineEditableFieldDefinition,
  modalWizardDefinition,
  optionCardsDefinition,
  otpInputDefinition,
  passwordStrengthMeterDefinition,
  progressBarDefinition,
  questionBuilderDefinition,
  ruleBuilderDefinition,
  segmentedControlDefinition,
  stepperDefinition,
  tableInclusionChecklistDefinition,
  toggleSwitchListDefinition,
  validationIssuesListDefinition,
} from './forms-track.definitions.js';
