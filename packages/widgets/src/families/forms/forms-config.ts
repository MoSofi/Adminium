// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `forms` family config schemas + deterministic demo generators (annex §10) —
 * PURE module (zod + forms-lib only; no React, no @adminium/ui, no lucide).
 *
 * WHY THIS EXISTS: the registry metadata graph reaches this family through
 * `forms-track.definitions.ts`, which imports these schemas and `demoData`
 * generators. Those must NOT drag the @adminium/ui-heavy components into the
 * eager registry chunk — components load only through
 * `lazy(() => import('./forms-track-components.js'))` (one lazy chunk per family,
 * 04 §2.3; the media/system/chrome `*-config` convention).
 *
 * LABELS: widgets are locale-agnostic (04 §2) — user-visible copy arrives as
 * already-translated strings through config, with English developer fallbacks.
 * The dashboard fills them from `t('…')`; en-US entries live at `widgets.forms.*`.
 *
 * DETERMINISM (04 §7.7): every `demoData(seed)` is a pure function of `seed`.
 */

import { z } from 'zod';
import { mulberry32 } from '@adminium/charts';

import {
  EXPORT_FORMATS,
  FLOW_NODE_KINDS,
  QUESTION_KINDS,
  RULE_FIELD_TYPES,
  RULE_MATCH_MODES,
  RULE_OPERATORS,
} from './forms-builders.js';
import { DSN_ENGINES } from './forms-dsn.js';
import { FORM_TONES, ISSUE_SEVERITIES, STEP_STATES } from './forms-lib.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

const toneSchema = z.enum(FORM_TONES);

/**
 * A generated form field (annex §10 auto-instantiation: "column type → control").
 * Shared by `modal-wizard` and `drawer-form`; the control vocabulary is CLOSED so
 * a stored manifest can never name a renderer that does not exist.
 */
export const FIELD_KINDS = ['text', 'textarea', 'number', 'email', 'url', 'select', 'switch', 'date'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const formFieldSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  kind: z.enum(FIELD_KINDS).default('text'),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  /** `select` options; ignored by other kinds. */
  options: z.array(z.object({ value: z.string(), label: z.string().optional() })).optional(),
  /** Unit suffix for `number` (annex §10: "numeric→number input with unit"). */
  unit: z.string().optional(),
  helpText: z.string().optional(),
});
export type FormFieldConfig = z.infer<typeof formFieldSchema>;

const DEMO_FIELDS: readonly FormFieldConfig[] = [
  { name: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Acme Corp' },
  { name: 'email', label: 'Email', kind: 'email', required: true, placeholder: 'ana@acme.com' },
  { name: 'plan', label: 'Plan', kind: 'select', required: false, options: [{ value: 'free', label: 'Free' }, { value: 'pro', label: 'Pro' }] },
  { name: 'seats', label: 'Seats', kind: 'number', required: false, unit: 'seats' },
  { name: 'notes', label: 'Notes', kind: 'textarea', required: false },
  { name: 'active', label: 'Active', kind: 'switch', required: false },
];

/** `form-state` demo payload: the generated field defs + their current values. */
function formStateDemo(seed: number, maxFields: number): { fields: FormFieldConfig[]; values: Record<string, unknown> } {
  const random = mulberry32(seed);
  const count = 2 + Math.floor(random() * Math.min(maxFields - 1, DEMO_FIELDS.length - 1));
  const fields = DEMO_FIELDS.slice(0, count);
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.kind === 'switch') values[field.name] = random() > 0.5;
    else if (field.kind === 'number') values[field.name] = Math.round(1 + random() * 40);
    else values[field.name] = '';
  }
  return { fields: [...fields], values };
}

// ── modal-wizard (annex §10) ────────────────────────────────────────────────

export const modalWizardConfigSchema = widgetSharedConfigSchema.extend({
  /** Generated from column types (annex §10 auto-instantiation). */
  fields: z.array(formFieldSchema).optional(),
  size: z.enum(['sm', 'md', 'lg']).default('md'),
  triggerLabel: z.string().optional(),
  submitLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
  /** The success-step confirmation copy (annex §10 `successCopy`). */
  successTitle: z.string().optional(),
  successBody: z.string().optional(),
  doneLabel: z.string().optional(),
  subtitleText: z.string().optional(),
});
export type ModalWizardConfig = z.infer<typeof modalWizardConfigSchema>;

export function modalWizardDemoData(seed: number): { fields: FormFieldConfig[]; values: Record<string, unknown> } {
  // annex §10: "≤5 fields → modal-wizard, more → drawer-form or full page".
  return formStateDemo(seed, 5);
}

// ── drawer-form (annex §10) ─────────────────────────────────────────────────

export const drawerFormConfigSchema = widgetSharedConfigSchema.extend({
  fields: z.array(formFieldSchema).optional(),
  width: z.enum(['sm', 'md', 'lg']).default('md'),
  triggerLabel: z.string().optional(),
  submitLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
  subtitleText: z.string().optional(),
});
export type DrawerFormConfig = z.infer<typeof drawerFormConfigSchema>;

export function drawerFormDemoData(seed: number): { fields: FormFieldConfig[]; values: Record<string, unknown> } {
  // The >5-field counterpart of modal-wizard (annex §10).
  return formStateDemo(seed, DEMO_FIELDS.length);
}

// ── stepper (annex §10) ─────────────────────────────────────────────────────

export const stepperConfigSchema = widgetSharedConfigSchema.extend({
  keyField: z.string().default('key'),
  labelField: z.string().default('label'),
  descField: z.string().default('description'),
  stateField: z.string().default('state'),
  orientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
  /** Allow jumping to a step (annex §10 `clickable`). */
  clickable: z.boolean().default(false),
  /** Index of the active step; `state` on a row overrides it per step. */
  activeIndex: z.number().int().min(0).default(0),
  /** Show the per-step sub copy (annex §10 `labels`). */
  showDescriptions: z.boolean().default(true),
  a11yLabel: z.string().optional(),
});
export type StepperConfig = z.infer<typeof stepperConfigSchema>;

const DEMO_STEPS: readonly { key: string; label: string; description: string }[] = [
  { key: 'connect', label: 'Connect', description: 'Point Adminium at your database' },
  { key: 'tables', label: 'Choose tables', description: 'Pick what to include' },
  { key: 'enrich', label: 'Enrich', description: 'Let the LLM label your schema' },
  { key: 'generate', label: 'Generate', description: 'Build pages and dashboards' },
];

export function stepperDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const active = Math.floor(random() * DEMO_STEPS.length);
  const rows = DEMO_STEPS.map((step, index) => ({
    ...step,
    state: index < active ? 'done' : index === active ? 'active' : 'pending',
  }));
  return { rows, columns: [{ name: 'label', label: 'Step' }], total: rows.length };
}

// ── progress-bar (annex §10) ────────────────────────────────────────────────

export const progressBarConfigSchema = widgetSharedConfigSchema.extend({
  height: z.enum(['sm', 'md', 'lg']).default('md'),
  /** Mono % caption after the track (annex §10 `showPercent`). */
  showPercent: z.boolean().default(true),
  /**
   * Flip the fill to `pos` at 100% (annex §10 `completeColor`: "color flips pos
   * at 100%" — the import-progress variant).
   */
  completeColor: z.boolean().default(true),
  label: z.string().optional(),
});
export type ProgressBarConfig = z.infer<typeof progressBarConfigSchema>;

export function progressBarDemoData(seed: number): { value: number } {
  const random = mulberry32(seed);
  return { value: Math.round(random() * 100) };
}

// ── otp-input (annex §10) ───────────────────────────────────────────────────

export const otpInputConfigSchema = widgetSharedConfigSchema.extend({
  length: z.number().int().min(4).max(8).default(6),
  label: z.string().optional(),
  helpText: z.string().optional(),
});
export type OtpInputConfig = z.infer<typeof otpInputConfigSchema>;

export function otpInputDemoData(seed: number): { fields: never[]; values: { code: string } } {
  const random = mulberry32(seed);
  // A partial code so the demo shows both filled and cursor cells.
  const filled = Math.floor(random() * 5);
  let code = '';
  for (let index = 0; index < filled; index += 1) code += String(Math.floor(random() * 10));
  return { fields: [], values: { code } };
}

// ── chip-input (annex §10) ──────────────────────────────────────────────────

export const chipInputConfigSchema = widgetSharedConfigSchema.extend({
  /**
   * Closed validator vocabulary (annex §10 `validator`) — a stored config names
   * a RULE, never a predicate: a manifest must not be able to smuggle executable
   * code into the input.
   */
  validator: z.enum(['none', 'email', 'domain']).default('none'),
  placeholder: z.string().optional(),
  /** Render chips + input in JetBrains Mono (the domain-chip editor variant). */
  mono: z.boolean().default(false),
  label: z.string().optional(),
  removeLabel: z.string().optional(),
  helpText: z.string().optional(),
});
export type ChipInputConfig = z.infer<typeof chipInputConfigSchema>;

const DEMO_EMAILS = ['ana@acme.com', 'bo@acme.com', 'carlos@acme.com', 'dana@acme.com'] as const;

export function chipInputDemoData(seed: number): { fields: never[]; values: { chips: string[] } } {
  const random = mulberry32(seed);
  const count = 1 + Math.floor(random() * DEMO_EMAILS.length);
  return { fields: [], values: { chips: [...DEMO_EMAILS.slice(0, count)] } };
}

// ── segmented-control (annex §10) ───────────────────────────────────────────

export const segmentedControlConfigSchema = widgetSharedConfigSchema.extend({
  /** Option defs (annex §10 `options` {key, label, icon?, dot?}). */
  options: z
    .array(z.object({ key: z.string(), label: z.string().optional(), dot: toneSchema.optional() }))
    .optional(),
  /** Annex §10 `style` (track|chips). */
  style: z.enum(['track', 'chips']).default('track'),
  value: z.string().optional(),
  a11yLabel: z.string().optional(),
});
export type SegmentedControlConfig = z.infer<typeof segmentedControlConfigSchema>;

const DEMO_SEGMENTS = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: '12m', label: '12 months' },
] as const;

export function segmentedControlDemoData(seed: number): { fields: never[]; values: { value: string } } {
  const random = mulberry32(seed);
  const pick = DEMO_SEGMENTS[Math.floor(random() * DEMO_SEGMENTS.length)] ?? DEMO_SEGMENTS[0];
  return { fields: [], values: { value: pick.key } };
}

/** The default period segments rendered when config supplies no options. */
export const DEFAULT_SEGMENTS: readonly { key: string; label: string }[] = DEMO_SEGMENTS;

// ── filter-chip-bar (annex §10) ─────────────────────────────────────────────

export const filterChipBarConfigSchema = widgetSharedConfigSchema.extend({
  /** Which field of the sibling list the facets aggregate (annex §10 `facetField`). */
  facetField: z.string().default('status'),
  /** Explicit chip order + labels; facets absent here render after, in payload order. */
  order: z.array(z.object({ key: z.string(), label: z.string().optional(), tone: toneSchema.optional() })).optional(),
  /** Live mono count pills (annex §10 `showCounts`). */
  showCounts: z.boolean().default(true),
  /** The "All" chip's label; it always leads the bar. */
  allLabel: z.string().optional(),
  /** Selected facet; `null`/absent ⇒ All. */
  value: z.string().optional(),
  /** End-aligned "N of M" meta (annex §10 "optional right-aligned"). */
  showMeta: z.boolean().default(false),
  metaTemplate: z.string().optional(),
  a11yLabel: z.string().optional(),
});
export type FilterChipBarConfig = z.infer<typeof filterChipBarConfigSchema>;

const DEMO_STATUSES = ['running', 'completed', 'completed', 'failed', 'completed', 'running', 'queued'] as const;

export function filterChipBarDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const count = 3 + Math.floor(random() * (DEMO_STATUSES.length - 2));
  const rows = DEMO_STATUSES.slice(0, count).map((status, index) => ({ id: `r${index}`, status }));
  return { rows, columns: [{ name: 'status', label: 'Status' }], total: rows.length };
}

// ── toggle-switch-list (annex §10) ──────────────────────────────────────────

/**
 * One settings row's metadata, keyed by the same id as the bound `boolean-map`
 * entry (annex §10: "boolean-map keyed by setting id + row metadata").
 */
export const toggleRowSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  tone: toneSchema.optional(),
});
export type ToggleRowConfig = z.infer<typeof toggleRowSchema>;

export const toggleSwitchListConfigSchema = widgetSharedConfigSchema.extend({
  rows: z.array(toggleRowSchema).optional(),
  /** Annex §10 `persistMode`. `optimistic` writes on toggle; `save-bar` batches. */
  persistMode: z.enum(['optimistic', 'save-bar']).default('optimistic'),
  /** Tone-tinted icon tiles per row (annex §10 `iconTiles`). */
  iconTiles: z.boolean().default(false),
  saveLabel: z.string().optional(),
  dirtyLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ToggleSwitchListConfig = z.infer<typeof toggleSwitchListConfigSchema>;

/**
 * The default settings rows rendered when config supplies none. Typed as the
 * schema's own row type so the component sees ONE shape — a narrower literal
 * type here would make `row.tone` vanish from the union at the use site.
 */
export const DEFAULT_TOGGLE_ROWS: readonly ToggleRowConfig[] = [
  { key: 'emailDigest', label: 'Weekly digest', description: 'A Monday summary of last week’s activity.', icon: 'mail' },
  { key: 'mentions', label: 'Mentions', description: 'Notify me when someone @-mentions me.', icon: 'bell' },
  { key: 'deploys', label: 'Deploy alerts', description: 'Ping me when a generation run finishes.', icon: 'zap' },
  { key: 'security', label: 'Security alerts', description: 'New sign-ins and permission changes.', icon: 'shield' },
];

export function toggleSwitchListDemoData(seed: number): { entries: Record<string, boolean> } {
  const random = mulberry32(seed);
  const entries: Record<string, boolean> = {};
  for (const row of DEFAULT_TOGGLE_ROWS) entries[row.key] = random() > 0.4;
  return { entries };
}

// ── option-cards (annex §10) ────────────────────────────────────────────────

export const optionCardsConfigSchema = widgetSharedConfigSchema.extend({
  keyField: z.string().default('key'),
  labelField: z.string().default('label'),
  descField: z.string().default('description'),
  iconField: z.string().default('icon'),
  /** Cards per row (annex §10 `columns`). */
  columns: z.number().int().min(1).max(4).default(2),
  /** Annex §10 `iconStyle` — a tone-soft tile or a bare glyph. */
  iconStyle: z.enum(['tile', 'plain']).default('tile'),
  value: z.string().optional(),
  a11yLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
});
export type OptionCardsConfig = z.infer<typeof optionCardsConfigSchema>;

const DEMO_OPTIONS: readonly { key: string; label: string; description: string; icon: string }[] = [
  { key: 'postgres', label: 'PostgreSQL', description: 'Connect a Postgres 12+ database.', icon: 'database' },
  { key: 'mysql', label: 'MySQL', description: 'MySQL 8 or MariaDB 10.5+.', icon: 'database' },
  { key: 'sqlite', label: 'SQLite', description: 'Point at a local .db file.', icon: 'file' },
  { key: 'csv', label: 'CSV import', description: 'Upload a file and map its columns.', icon: 'upload' },
];

export function optionCardsDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const count = 2 + Math.floor(random() * (DEMO_OPTIONS.length - 1));
  const rows = DEMO_OPTIONS.slice(0, count).map((option) => ({ ...option }));
  return { rows, columns: [{ name: 'label', label: 'Option' }], total: rows.length };
}

// ── password-strength-meter (annex §10) ─────────────────────────────────────

export const passwordStrengthMeterConfigSchema = widgetSharedConfigSchema.extend({
  /** The 5 score labels, weakest → strongest (index 0 shows no label). */
  labels: z.array(z.string()).length(4).optional(),
  label: z.string().optional(),
});
export type PasswordStrengthMeterConfig = z.infer<typeof passwordStrengthMeterConfigSchema>;

const DEMO_PASSWORDS = ['abc', 'password1', 'Tr0ub4dor', 'Tr0ub4dor&3xx', 'correct horse battery staple 9!'] as const;

export function passwordStrengthMeterDemoData(seed: number): { fields: never[]; values: { password: string } } {
  const random = mulberry32(seed);
  const pick = DEMO_PASSWORDS[Math.floor(random() * DEMO_PASSWORDS.length)] ?? DEMO_PASSWORDS[0];
  return { fields: [], values: { password: pick } };
}

// ── validation-issues-list (annex §10) ──────────────────────────────────────

export const validationIssuesListConfigSchema = widgetSharedConfigSchema.extend({
  severityField: z.string().default('severity'),
  titleField: z.string().default('title'),
  descField: z.string().default('desc'),
  countField: z.string().default('count'),
  /** Severity value → tone override (annex §10 `severityMap`). */
  severityMap: z.record(z.string(), toneSchema).optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ValidationIssuesListConfig = z.infer<typeof validationIssuesListConfigSchema>;

const DEMO_ISSUES: readonly { severity: string; title: string; desc: string; count: number }[] = [
  { severity: 'error', title: 'Invalid email format', desc: 'These rows will be skipped on import.', count: 12 },
  { severity: 'warn', title: 'Duplicate order ids', desc: 'Later rows overwrite earlier ones.', count: 4 },
  { severity: 'warn', title: 'Missing country codes', desc: 'Defaulted to the workspace region.', count: 31 },
  { severity: 'info', title: 'Dates normalised to ISO', desc: 'Parsed from 3 different formats.', count: 248 },
];

export function validationIssuesListDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const count = 1 + Math.floor(random() * DEMO_ISSUES.length);
  const rows = DEMO_ISSUES.slice(0, count).map((issue) => ({ ...issue }));
  return { rows, columns: [{ name: 'title', label: 'Issue' }], total: rows.length };
}

// ── rule-builder (annex §10) ────────────────────────────────────────────────

/**
 * One entry of the field catalog the Engine generates from the bound table's
 * columns (annex §10 `fieldCatalog` — "from schema").
 */
export const ruleFieldSchema = z.object({
  name: z.string(),
  label: z.string().optional(),
  type: z.enum(RULE_FIELD_TYPES).default('string'),
  /** `enum` fields only — the values the value picker offers. */
  options: z.array(z.object({ value: z.string(), label: z.string().optional() })).optional(),
});
export type RuleFieldConfig = z.infer<typeof ruleFieldSchema>;

export const ruleBuilderConfigSchema = widgetSharedConfigSchema.extend({
  fieldCatalog: z.array(ruleFieldSchema).optional(),
  /** Annex §10 `operatorsByType` — overrides `DEFAULT_OPERATORS_BY_TYPE`. */
  operatorsByType: z.record(z.string(), z.array(z.enum(RULE_OPERATORS))).optional(),
  maxConditions: z.number().int().min(1).max(50).default(10),
  /** ALL/ANY — the pill divider between condition chips. */
  matchMode: z.enum(RULE_MATCH_MODES).default('all'),
  /** Operator id → display copy; unnamed operators fall back to English. */
  operatorLabels: z.record(z.string(), z.string()).optional(),
  addLabel: z.string().optional(),
  removeLabel: z.string().optional(),
  allLabel: z.string().optional(),
  anyLabel: z.string().optional(),
  fieldLabel: z.string().optional(),
  operatorLabel: z.string().optional(),
  valueLabel: z.string().optional(),
  valuePlaceholder: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type RuleBuilderConfig = z.infer<typeof ruleBuilderConfigSchema>;

/**
 * The English operator copy every rule-builder falls back to. A map (not a
 * switch in the component) so `operatorLabels` can override one entry without
 * restating the rest.
 */
export const DEFAULT_OPERATOR_LABELS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
  'not-contains': 'does not contain',
  'starts-with': 'starts with',
  in: 'is one of',
  before: 'is before',
  after: 'is after',
  'is-null': 'is empty',
  'is-not-null': 'is not empty',
};

/** The demo segment catalog — a plausible `customers` table. */
const DEMO_RULE_FIELDS: readonly RuleFieldConfig[] = [
  { name: 'plan', label: 'Plan', type: 'enum', options: [{ value: 'free' }, { value: 'pro' }, { value: 'enterprise' }] },
  { name: 'mrr', label: 'MRR', type: 'number' },
  { name: 'country', label: 'Country', type: 'string' },
  { name: 'signed_up_at', label: 'Signed up', type: 'date' },
  { name: 'is_trial', label: 'On trial', type: 'boolean' },
];

const DEMO_CONDITIONS: readonly { field: string; op: string; value: string }[] = [
  { field: 'plan', op: 'eq', value: 'pro' },
  { field: 'mrr', op: 'gte', value: '500' },
  { field: 'country', op: 'contains', value: 'DE' },
  { field: 'is_trial', op: 'eq', value: 'false' },
];

export function ruleBuilderDemoData(seed: number): {
  fields: never[];
  values: { conditions: { field: string; op: string; value: string }[]; match: string };
} {
  const random = mulberry32(seed);
  const count = 1 + Math.floor(random() * DEMO_CONDITIONS.length);
  return {
    fields: [],
    values: {
      conditions: DEMO_CONDITIONS.slice(0, count).map((condition) => ({ ...condition })),
      match: random() > 0.5 ? 'all' : 'any',
    },
  };
}

/** The default field catalog rendered when config supplies none. */
export const DEFAULT_RULE_FIELDS: readonly RuleFieldConfig[] = DEMO_RULE_FIELDS;

// ── flow-builder (annex §10) ────────────────────────────────────────────────

export const flowNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(FLOW_NODE_KINDS).default('action'),
  icon: z.string().optional(),
  title: z.string().optional(),
  sub: z.string().optional(),
});
export type FlowNodeConfig = z.infer<typeof flowNodeSchema>;

export const flowBuilderConfigSchema = widgetSharedConfigSchema.extend({
  /** Which node kinds this flow may contain (annex §10 `nodeKinds`). */
  nodeKinds: z.array(z.enum(FLOW_NODE_KINDS)).optional(),
  /** The addable node types shown in the palette popover (annex §10 `palette`). */
  palette: z.array(flowNodeSchema).optional(),
  maxNodes: z.number().int().min(1).max(50).default(12),
  addLabel: z.string().optional(),
  removeLabel: z.string().optional(),
  paletteTitle: z.string().optional(),
  /** Header run stats copy (annex §10) — `{runs}` / `{rate}` placeholders. */
  statsTemplate: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type FlowBuilderConfig = z.infer<typeof flowBuilderConfigSchema>;

/** The addable node types a generated automation flow starts with. */
export const DEFAULT_FLOW_PALETTE: readonly FlowNodeConfig[] = [
  { id: 'p-row-created', kind: 'trigger', icon: 'zap', title: 'Row created', sub: 'When a record is inserted' },
  { id: 'p-schedule', kind: 'trigger', icon: 'bell', title: 'On a schedule', sub: 'Every day at 09:00' },
  { id: 'p-if-field', kind: 'condition', icon: 'info', title: 'If field matches', sub: 'Branch on a column value' },
  { id: 'p-if-threshold', kind: 'condition', icon: 'warning', title: 'If over threshold', sub: 'Branch on a number' },
  { id: 'p-send-email', kind: 'action', icon: 'mail', title: 'Send email', sub: 'Notify a recipient' },
  { id: 'p-webhook', kind: 'action', icon: 'zap', title: 'Call webhook', sub: 'POST to an endpoint' },
  { id: 'p-update-row', kind: 'action', icon: 'table', title: 'Update row', sub: 'Write back to the table' },
  { id: 'p-notify', kind: 'action', icon: 'bell', title: 'Notify team', sub: 'Post to the activity feed' },
];

const DEMO_FLOW_NODES: readonly FlowNodeConfig[] = [
  { id: 'n1', kind: 'trigger', icon: 'zap', title: 'Order created', sub: 'When a row lands in orders' },
  { id: 'n2', kind: 'condition', icon: 'info', title: 'If total > 500', sub: 'High-value orders only' },
  { id: 'n3', kind: 'action', icon: 'mail', title: 'Email the account owner', sub: 'Template: big-order' },
  { id: 'n4', kind: 'action', icon: 'bell', title: 'Notify #sales', sub: 'Post to the activity feed' },
];

export function flowBuilderDemoData(seed: number): {
  fields: never[];
  values: { nodes: FlowNodeConfig[]; runs: number; successRate: number };
} {
  const random = mulberry32(seed);
  const count = 1 + Math.floor(random() * DEMO_FLOW_NODES.length);
  return {
    fields: [],
    values: {
      nodes: DEMO_FLOW_NODES.slice(0, count).map((node) => ({ ...node })),
      runs: Math.round(20 + random() * 4000),
      successRate: Math.round(90 + random() * 10),
    },
  };
}

// ── connection-string-field (annex §10) ─────────────────────────────────────

export const connectionStringFieldConfigSchema = widgetSharedConfigSchema.extend({
  /**
   * Annex §10 `protocols`. The DSN grammar accepts every engine it can NAME;
   * this narrows it to the ones the host can actually connect to, so an
   * out-of-scope scheme reads as unrecognised rather than as a DSN that is
   * accepted here and refused two steps later (see `forms-dsn.ts`).
   */
  protocols: z.array(z.enum(DSN_ENGINES)).optional(),
  /** Which engine's example DSN to show before the input determines one. */
  placeholderEngine: z.enum(DSN_ENGINES).default('postgres'),
  /** Annex §10 `statusLine` — e.g. "14 tables detected". */
  statusLine: z.string().optional(),
  statusTone: toneSchema.optional(),
  /** Keyboard-shortcut badge rendered in the field (annex §10). */
  shortcut: z.string().optional(),
  label: z.string().optional(),
  helpText: z.string().optional(),
  required: z.boolean().default(false),
  /** Provider quick-fill chips under the input. */
  showQuickFill: z.boolean().default(true),
  quickFillLabel: z.string().optional(),
  hostLabel: z.string().optional(),
  /** Copy for the two `DsnValidationCode`s (widgets never translate — 04 §2). */
  invalidSchemeText: z.string().optional(),
  incompleteText: z.string().optional(),
});
export type ConnectionStringFieldConfig = z.infer<typeof connectionStringFieldConfigSchema>;

const DEMO_DSNS: readonly string[] = [
  'postgres://app:hunter2@db.acme.internal:5432/production',
  'mysql://root@localhost:3306/shop_dev',
  'sqlite:/var/data/app.db',
  'postgres://postgres@localhost:5432/app_dev',
];

export function connectionStringFieldDemoData(seed: number): { fields: never[]; values: { dsn: string } } {
  const random = mulberry32(seed);
  const pick = DEMO_DSNS[Math.floor(random() * DEMO_DSNS.length)] ?? DEMO_DSNS[0];
  return { fields: [], values: { dsn: pick as string } };
}

// ── table-inclusion-checklist (annex §10) ───────────────────────────────────

export const tableInclusionChecklistConfigSchema = widgetSharedConfigSchema.extend({
  nameField: z.string().default('name'),
  rowCountField: z.string().default('rowCount'),
  piiField: z.string().default('pii'),
  tagField: z.string().default('tag'),
  includedField: z.string().default('included'),
  /** Rows flagged here are join/system tables — pre-hidden, never includable. */
  hiddenField: z.string().default('hidden'),
  /** Annex §10 `piiDetection` — surface the PII warning badges. */
  piiDetection: z.boolean().default(true),
  /** Annex §10 `maxHeight` — the scroll viewport, in px. */
  maxHeight: z.number().int().min(80).max(1200).optional(),
  piiLabel: z.string().optional(),
  highVolumeLabel: z.string().optional(),
  a11yLabel: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type TableInclusionChecklistConfig = z.infer<typeof tableInclusionChecklistConfigSchema>;

const DEMO_TABLES: readonly { name: string; rowCount: number; pii: number; tag?: string; hidden?: boolean }[] = [
  { name: 'public.customers', rowCount: 18_402, pii: 3, tag: 'Customers' },
  { name: 'public.orders', rowCount: 240_118, pii: 0, tag: 'Sales' },
  { name: 'public.order_items', rowCount: 981_224, pii: 0 },
  { name: 'public.products', rowCount: 1_284, pii: 0, tag: 'Catalog' },
  { name: 'public.users', rowCount: 512, pii: 4, tag: 'Team' },
  { name: 'public.audit_log', rowCount: 4_119_882, pii: 1 },
  { name: 'public.customers_products', rowCount: 44_010, pii: 0, hidden: true },
];

export function tableInclusionChecklistDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const count = 3 + Math.floor(random() * (DEMO_TABLES.length - 2));
  const rows = DEMO_TABLES.slice(0, count).map((table) => ({ ...table }));
  return { rows, columns: [{ name: 'name', label: 'Table' }], total: rows.length };
}

// ── column-mapping-table (annex §10) ────────────────────────────────────────

export const columnMappingTableConfigSchema = widgetSharedConfigSchema.extend({
  columnField: z.string().default('column'),
  sampleField: z.string().default('sample'),
  targetField: z.string().default('target'),
  /** Annex §10 `targets` — the destination field catalog. */
  targets: z.array(z.object({ key: z.string(), label: z.string().optional() })).optional(),
  /** Annex §10 `autoMatch` — pre-fill unmapped columns by name similarity. */
  autoMatch: z.boolean().default(true),
  skipLabel: z.string().optional(),
  sourceHeader: z.string().optional(),
  sampleHeader: z.string().optional(),
  targetHeader: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type ColumnMappingTableConfig = z.infer<typeof columnMappingTableConfigSchema>;

/** The destination catalog the demo maps onto (a `customers` table). */
export const DEFAULT_MAPPING_TARGETS: readonly { key: string; label?: string }[] = [
  { key: 'full_name', label: 'Full name' },
  { key: 'email', label: 'Email' },
  { key: 'company', label: 'Company' },
  { key: 'country', label: 'Country' },
  { key: 'created_at', label: 'Created at' },
];

const DEMO_MAPPING_ROWS: readonly { column: string; sample: string }[] = [
  { column: 'Full Name', sample: 'Ana Ferreira' },
  { column: 'email_address', sample: 'ana@acme.com' },
  { column: 'Company', sample: 'Acme Corp' },
  { column: 'country_code', sample: 'PT' },
  { column: 'signup_date', sample: '2026-02-14' },
  { column: 'internal_ref', sample: 'X-99201' },
];

export function columnMappingTableDemoData(seed: number): {
  rows: Record<string, unknown>[];
  columns: { name: string; label: string }[];
  total: number;
} {
  const random = mulberry32(seed);
  const count = 2 + Math.floor(random() * (DEMO_MAPPING_ROWS.length - 1));
  const rows = DEMO_MAPPING_ROWS.slice(0, count).map((row) => ({ ...row }));
  return { rows, columns: [{ name: 'column', label: 'Source column' }], total: rows.length };
}

// ── export-builder (annex §10) ──────────────────────────────────────────────

export const exportBuilderConfigSchema = widgetSharedConfigSchema.extend({
  /** Annex §10 `formats` — the segmented PDF/CSV/XLSX picker. */
  formats: z.array(z.enum(EXPORT_FORMATS)).optional(),
  /** Annex §10 `groupBy` — omit to hide the grouping picker. */
  groupBy: z.array(z.object({ key: z.string(), label: z.string().optional() })).optional(),
  /** Annex §10 `emailOption` — offer to email the finished export. */
  emailOption: z.boolean().default(false),
  includeChartsOption: z.boolean().default(true),
  formatLabel: z.string().optional(),
  fromLabel: z.string().optional(),
  toLabel: z.string().optional(),
  groupByLabel: z.string().optional(),
  includeChartsLabel: z.string().optional(),
  emailLabel: z.string().optional(),
  submitLabel: z.string().optional(),
  runningLabel: z.string().optional(),
  doneLabel: z.string().optional(),
  failedLabel: z.string().optional(),
  downloadLabel: z.string().optional(),
});
export type ExportBuilderConfig = z.infer<typeof exportBuilderConfigSchema>;

/**
 * A FIXED range, not "the last 30 days": `demoData` must be a pure function of
 * its seed (04 §7.7), and a wall-clock range would make every VRT capture and
 * determinism snapshot differ from the one before it.
 */
const DEMO_EXPORT_RANGE = { from: '2026-06-01', to: '2026-06-30' } as const;

export function exportBuilderDemoData(seed: number): {
  fields: never[];
  values: { format: string; from: string; to: string; includeCharts: boolean; status: string; progress: number };
} {
  const random = mulberry32(seed);
  const format = EXPORT_FORMATS[Math.floor(random() * EXPORT_FORMATS.length)] ?? 'csv';
  const roll = random();
  // Seeded across all three phases so the demo/palette preview is not always an
  // idle form — the running and done states are most of this widget's design.
  const status = roll < 0.5 ? 'idle' : roll < 0.8 ? 'running' : 'done';
  return {
    fields: [],
    values: {
      format,
      from: DEMO_EXPORT_RANGE.from,
      to: DEMO_EXPORT_RANGE.to,
      includeCharts: random() > 0.4,
      status,
      progress: status === 'running' ? Math.round(random() * 100) : status === 'done' ? 100 : 0,
    },
  };
}

// ── question-builder (annex §10) ────────────────────────────────────────────

export const surveyQuestionSchema = z.object({
  id: z.string(),
  kind: z.enum(QUESTION_KINDS).default('short-text'),
  q: z.string().optional(),
  required: z.boolean().default(false),
  opts: z.array(z.string()).optional(),
});
export type SurveyQuestionConfig = z.infer<typeof surveyQuestionSchema>;

export const questionBuilderConfigSchema = widgetSharedConfigSchema.extend({
  /** Annex §10 `kinds` — which of the 8 palette types are enabled. */
  kinds: z.array(z.enum(QUESTION_KINDS)).optional(),
  maxQuestions: z.number().int().min(1).max(100).default(20),
  /** Question-kind id → palette copy; unnamed kinds fall back to English. */
  kindLabels: z.record(z.string(), z.string()).optional(),
  paletteTitle: z.string().optional(),
  addLabel: z.string().optional(),
  removeLabel: z.string().optional(),
  moveUpLabel: z.string().optional(),
  moveDownLabel: z.string().optional(),
  requiredLabel: z.string().optional(),
  questionPlaceholder: z.string().optional(),
  emptyTitle: z.string().optional(),
  emptyBody: z.string().optional(),
});
export type QuestionBuilderConfig = z.infer<typeof questionBuilderConfigSchema>;

/** The English palette copy every question-builder falls back to. */
export const DEFAULT_QUESTION_KIND_LABELS: Record<string, string> = {
  'single-choice': 'Single choice',
  'multi-choice': 'Multiple choice',
  dropdown: 'Dropdown',
  'short-text': 'Short text',
  'long-text': 'Long text',
  rating: 'Star rating',
  nps: 'NPS 0–10',
  date: 'Date',
};

const DEMO_QUESTIONS: readonly SurveyQuestionConfig[] = [
  { id: 'q1', kind: 'nps', q: 'How likely are you to recommend Adminium?', required: true },
  { id: 'q2', kind: 'single-choice', q: 'Which plan are you on?', required: false, opts: ['Free', 'Pro', 'Enterprise'] },
  { id: 'q3', kind: 'rating', q: 'How would you rate setup?', required: false },
  { id: 'q4', kind: 'long-text', q: 'What should we build next?', required: false },
];

export function questionBuilderDemoData(seed: number): { fields: never[]; values: { questions: SurveyQuestionConfig[] } } {
  const random = mulberry32(seed);
  const count = 1 + Math.floor(random() * DEMO_QUESTIONS.length);
  return { fields: [], values: { questions: DEMO_QUESTIONS.slice(0, count).map((question) => ({ ...question })) } };
}

// ── inline-editable-field (annex §10) ───────────────────────────────────────

export const inlineEditableFieldConfigSchema = widgetSharedConfigSchema.extend({
  /** The bound field path on the doc object (annex §10). */
  field: z.string().default('name'),
  /** Which column identifies the row a `mutate` intent targets. */
  idField: z.string().default('id'),
  /** Annex §10 `format`. */
  format: z.enum(['text', 'number', 'select']).default('text'),
  /** Annex §10 `multiline` — `text` only. */
  multiline: z.boolean().default(false),
  /** `select` options; ignored by other formats. */
  options: z.array(z.object({ value: z.string(), label: z.string().optional() })).optional(),
  placeholder: z.string().optional(),
  label: z.string().optional(),
  editLabel: z.string().optional(),
  saveLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
  /** Shown in place of an empty value — a zero-width target is unclickable. */
  emptyValueLabel: z.string().optional(),
});
export type InlineEditableFieldConfig = z.infer<typeof inlineEditableFieldConfigSchema>;

const DEMO_DOC_NAMES: readonly string[] = [
  'Invoice INV-2026-0142',
  'Q3 revenue report',
  'Welcome email template',
  'Acme Corp — renewal quote',
];

export function inlineEditableFieldDemoData(seed: number): { row: Record<string, unknown> } {
  const random = mulberry32(seed);
  const pick = DEMO_DOC_NAMES[Math.floor(random() * DEMO_DOC_NAMES.length)] ?? DEMO_DOC_NAMES[0];
  return { row: { id: `doc-${Math.floor(random() * 900) + 100}`, name: pick } };
}

/** Re-exported vocabularies so the component files import one module. */
export { FORM_TONES, ISSUE_SEVERITIES, STEP_STATES };
