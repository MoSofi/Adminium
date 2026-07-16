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

/** Re-exported vocabularies so the component files import one module. */
export { FORM_TONES, ISSUE_SEVERITIES, STEP_STATES };
