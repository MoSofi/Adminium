// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Config-inspector field derivation (04-widget-registry.md §6.2 / task 04-T14):
 * a widget's config inspector is auto-generated from its Zod config schema.
 * This module walks the schema's top-level shape and classifies each field into
 * one of the primitive editor kinds the inspector renders — text / number /
 * boolean / enum — unwrapping `.optional()` / `.default()` / `.nullable()`
 * wrappers to reach the base type (Zod 4 `.def` introspection).
 *
 * Composite fields (`binding`, `format`, `emptyState`, `permissions`) and
 * builder-internal meta keys are skipped. For `binding` that dedicated surface
 * now EXISTS — `./BindingEditor.tsx`, opened from the inspector's data-source
 * row — so the skip is a hand-off rather than the gap it used to describe.
 *
 * The skip stays explicit even though `fieldFor` would also return `null` for a
 * nested object today: it is the schema-shape guard. If `binding` ever became,
 * say, a saved-query id string, this list is what keeps a raw text box for it
 * out of the auto-form, where editing it would corrupt the query silently.
 *
 * Fields named in `lockedPaths` (Tier A derived / LLM-locked config, 04 §9)
 * render read-only with a lock affordance.
 */

import type { WidgetDefinition } from '@adminium/widgets';

import { LOCKED_CONFIG_KEY } from './placement.js';

/** A widget's Zod config schema, referenced without a direct `zod` dependency. */
type ConfigSchema = WidgetDefinition['configSchema'];

export type InspectorFieldKind = 'text' | 'number' | 'boolean' | 'enum';

interface InspectorFieldCommon {
  /** Top-level config key this control writes. */
  key: string;
  locked: boolean;
  optional: boolean;
}

export type InspectorField =
  | (InspectorFieldCommon & { kind: 'text' })
  | (InspectorFieldCommon & { kind: 'boolean' })
  | (InspectorFieldCommon & { kind: 'number'; min?: number; max?: number; step: number })
  | (InspectorFieldCommon & { kind: 'enum'; options: string[] });

/** Composite / internal keys never rendered as a primitive control. */
const SKIP_KEYS: ReadonlySet<string> = new Set([
  'binding',
  'format',
  'emptyState',
  'permissions',
  'testId',
  LOCKED_CONFIG_KEY,
]);

interface ZodDefLike {
  type: string;
  innerType?: unknown;
  entries?: Record<string, unknown>;
}

interface ZodNodeLike {
  def?: ZodDefLike;
  minValue?: number | null;
  maxValue?: number | null;
}

function nodeOf(schema: unknown): ZodNodeLike | null {
  return typeof schema === 'object' && schema !== null ? (schema as ZodNodeLike) : null;
}

/** Peel `optional` / `default` / `nullable` wrappers; report if any was seen. */
function unwrap(schema: unknown): { inner: ZodNodeLike | null; optional: boolean } {
  let current = nodeOf(schema);
  let optional = false;
  const wrappers = new Set(['optional', 'default', 'nullable']);
  while (current?.def !== undefined && wrappers.has(current.def.type)) {
    if (current.def.type !== 'default') optional = true;
    current = nodeOf(current.def.innerType);
  }
  return { inner: current, optional };
}

function finiteOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function fieldFor(key: string, schema: unknown, locked: boolean): InspectorField | null {
  const { inner, optional } = unwrap(schema);
  const type = inner?.def?.type;
  const common: InspectorFieldCommon = { key, locked, optional };
  if (type === 'string') return { ...common, kind: 'text' };
  if (type === 'boolean') return { ...common, kind: 'boolean' };
  if (type === 'number') {
    const min = finiteOrUndefined(inner?.minValue);
    const max = finiteOrUndefined(inner?.maxValue);
    return {
      ...common,
      kind: 'number',
      step: 1,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    };
  }
  if (type === 'enum') {
    const entries = inner?.def?.entries ?? {};
    const options = Object.values(entries).map((value) => String(value));
    return options.length > 0 ? { ...common, kind: 'enum', options } : null;
  }
  return null;
}

/**
 * Derive the inspector's field list from a widget config schema. Field order
 * follows the schema's declaration order; unsupported/composite fields are
 * dropped, keeping the form to editable primitives.
 */
export function deriveInspectorFields(
  configSchema: ConfigSchema,
  lockedPaths: readonly string[] = [],
): InspectorField[] {
  const shape = (configSchema as unknown as { shape?: Record<string, unknown> }).shape;
  if (shape === undefined || shape === null) return [];
  const locked = new Set(lockedPaths);
  const fields: InspectorField[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (SKIP_KEYS.has(key)) continue;
    const field = fieldFor(key, fieldSchema, locked.has(key));
    if (field !== null) fields.push(field);
  }
  return fields;
}
