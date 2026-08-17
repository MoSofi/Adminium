// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `form-state` payload readers + the write target (annex §10; 04 §3) — PURE
 * module. Split from `forms-lib.ts` because these two concerns are what every
 * INPUT widget in the family shares, and keeping them together makes the write
 * model reviewable in one place.
 *
 * THE WRITE MODEL (04 §2.1): forms widgets are controlled by local state and
 * report changes as `mutate` INTENTS — they never persist. The host runs the
 * intent through the CRUD API (with undo + audit). An UNBOUND instance (demo
 * data, a story, the widget palette) has no target, so `bindingTargetOf` returns
 * `null` and callers skip the intent rather than emitting one into the void.
 */

import type { FormFieldConfig } from './forms-config.js';

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}

/** The `connectionId` + qualified table a `mutate` event carries. */
export interface BindingTarget {
  connectionId: string;
  table: string;
}

/**
 * The write target for a bound widget, or `null` when the widget is running on
 * `demoData`. An unbound widget must not offer a write affordance — there is
 * nowhere to send the intent (04 §5).
 */
export function bindingTargetOf(
  binding: { connectionId: string; source: { schema?: string | undefined; name: string } } | undefined,
): BindingTarget | null {
  if (binding === undefined) return null;
  const { schema, name } = binding.source;
  return { connectionId: binding.connectionId, table: schema === undefined ? name : `${schema}.${name}` };
}

/**
 * Read the `values` map out of a §3 `form-state` envelope
 * (`{ fields: FieldDef[]; values: Record<string, unknown> }`). Also accepts a
 * bare values object so template/story composition can hand values directly.
 */
export function formValuesOf(data: unknown): Rec {
  const envelope = rec(data);
  if (envelope === null) return {};
  const values = rec(envelope['values']);
  if (values !== null) return values;
  // Bare object that is not an envelope — treat it as the values map itself.
  return 'values' in envelope || 'fields' in envelope ? {} : envelope;
}

/**
 * Read the `fields` defs out of a §3 `form-state` envelope. Entries without a
 * `name` are dropped: a field with no name has nothing to write to, and
 * rendering it would produce an input whose value goes nowhere.
 */
export function formFieldsOf(data: unknown): FormFieldConfig[] {
  const envelope = rec(data);
  const fields = envelope?.['fields'];
  if (!Array.isArray(fields)) return [];
  const out: FormFieldConfig[] = [];
  for (const entry of fields) {
    const field = rec(entry);
    if (field === null || typeof field['name'] !== 'string') continue;
    out.push(field as unknown as FormFieldConfig);
  }
  return out;
}

/**
 * The field defs a form widget should render: config wins over the payload.
 *
 * Config is the GENERATED contract (the Engine derived it from column types at
 * generation time, annex §10) and is what the manifest stores; a payload's
 * `fields` is only the server echoing the same shape back. Preferring config
 * keeps the rendered form stable even if a query returns an empty envelope.
 */
export function resolveFields(configFields: readonly FormFieldConfig[] | undefined, data: unknown): FormFieldConfig[] {
  if (configFields !== undefined && configFields.length > 0) return [...configFields];
  return formFieldsOf(data);
}

/** Seed the controlled value map from the payload, defaulting per field kind. */
export function initialValues(fields: readonly FormFieldConfig[], data: unknown): Rec {
  const bound = formValuesOf(data);
  const out: Rec = {};
  for (const field of fields) {
    if (field.name in bound) {
      out[field.name] = bound[field.name];
      continue;
    }
    out[field.name] = field.kind === 'switch' ? false : '';
  }
  return out;
}

/**
 * Which required fields are still empty. `false` is a LEGITIMATE value for a
 * switch, so emptiness is checked as "absent or empty string", never falsiness —
 * treating `false` as missing would make a required opt-out toggle unsubmittable.
 */
export function missingRequired(fields: readonly FormFieldConfig[], values: Rec): string[] {
  const out: string[] = [];
  for (const field of fields) {
    if (!field.required) continue;
    const value = values[field.name];
    if (value === undefined || value === null || value === '') out.push(field.name);
  }
  return out;
}
