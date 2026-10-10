// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE RULE FORMAT, SAID SHORT.
 *
 * The assistant drafts a rule in the page's own format, so it must be told
 * that format. Told as JSON Schema it is about 25,000 characters, most of it
 * brackets and the same condition written five times; on a local model that
 * is a third of the room a conversation has. Here it is said in the notation
 * a person would write on a whiteboard: one line a kind, a field with its
 * type and its bound.
 *
 * MADE FROM THE SCHEMA, never written beside it. Every field name, bound and
 * choice below is read from the two zod schemas the page's own save runs
 * (`automationTriggerSchema`, `automationGraphSchema`), so a field added there
 * is a field the model is told of, and one taken away is gone. What a field is
 * FOR cannot be read from a schema: that is one hand-written line per kind of
 * step ({@link ACTION_NOTES}), and a test fails when a kind has none.
 */
import { automationGraphSchema, automationTriggerSchema } from '@adminium/meta';
import { z } from 'zod';

type Json = Record<string, unknown>;

const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isJson) : []);

/** The alternatives of a schema: itself, or what its `anyOf` / `oneOf` hold, flattened. */
function alternatives(schema: Json): Json[] {
  const parts = [...list(schema['anyOf']), ...list(schema['oneOf'])];
  return parts.length === 0 ? [schema] : parts.flatMap(alternatives);
}

/** The `kind` a variant of a union is told apart by: its one value, or its several. */
function kindsOf(schema: Json): string[] {
  const kind = isJson(schema['properties']) && isJson(schema['properties']['kind']) ? schema['properties']['kind'] : null;
  if (kind === null) return [];
  if (typeof kind['const'] === 'string') return [kind['const']];
  return Array.isArray(kind['enum']) ? kind['enum'].filter((one): one is string => typeof one === 'string') : [];
}

/** A condition, wherever it is written: said once under its name. */
const isCondition = (schema: Json): boolean => isJson(schema['properties']) && 'left' in schema['properties'] && 'op' in schema['properties'];

interface Printer {
  /** The first condition met, printed once under "Condition". */
  condition: Json | null;
}

/** A type, on one line. */
function type(schema: Json, printer: Printer, inCondition = false): string {
  const options = alternatives(schema);
  if (options.length > 1) {
    const kinds = options.flatMap(kindsOf);
    // A union told apart by `kind`: each variant with its kind first.
    if (kinds.length > 0 && options.every((option) => kindsOf(option).length > 0)) {
      return options.map((option) => `{ kind: ${kindsOf(option).map((kind) => JSON.stringify(kind)).join('|')}${fields(option, printer, ['kind'], inCondition)} }`).join(' | ');
    }
    return [...new Set(options.map((option) => type(option, printer, inCondition)))].join(' | ');
  }
  if (schema['const'] !== undefined) return JSON.stringify(schema['const']);
  if (Array.isArray(schema['enum'])) return schema['enum'].map((one) => JSON.stringify(one)).join('|');
  switch (schema['type']) {
    case 'null':
      return 'null';
    case 'boolean':
      return 'bool';
    case 'integer':
    case 'number': {
      const bounds = schema['minimum'] !== undefined || schema['maximum'] !== undefined ? ` ${String(schema['minimum'] ?? '')}..${String(schema['maximum'] ?? '')}` : '';
      return `${schema['type'] === 'integer' ? 'int' : 'number'}${bounds}`;
    }
    case 'string':
      return `${typeof schema['pattern'] === 'string' && /\\d/.test(schema['pattern']) && schema['maxLength'] === undefined ? 'text like HH:MM' : 'text'}${schema['maxLength'] === undefined ? '' : `≤${String(schema['maxLength'])}`}`;
    case 'array': {
      // A list of a fixed length, each place with its own type (a branch's two sides).
      const places = list(schema['prefixItems']);
      if (places.length > 0) return `[${places.map((place) => type(place, printer, inCondition)).join(', ')}]`;
      const items = isJson(schema['items']) ? schema['items'] : {};
      const of = alternatives(items).every((option) => kindsOf(option).length > 0 && isJson(option['properties']) && 'id' in option['properties'])
        ? `Node(${alternatives(items).flatMap(kindsOf).join('|')})`
        : type(items, printer, inCondition);
      const bounds = schema['minItems'] !== undefined && schema['minItems'] === schema['maxItems'] ? ` ×${String(schema['maxItems'])}` : schema['maxItems'] === undefined ? '' : ` ≤${String(schema['maxItems'])}`;
      return `[${of}]${bounds}`;
    }
    case 'object': {
      if (!inCondition && isCondition(schema)) {
        printer.condition ??= schema;
        return 'Condition';
      }
      if (isJson(schema['additionalProperties'])) return `{ <name>: ${type(schema['additionalProperties'], printer, inCondition)} }`;
      return `{${fields(schema, printer, [], inCondition).replace(/^,/, '')} }`;
    }
    default:
      return 'any';
  }
}

/**
 * The fields of the schema a DRAFT never writes, each with why. They are left
 * out of what the model is told, and the test that compares the format with
 * the schema reads this list, so a field is hidden on purpose or not at all.
 */
export const NOT_FOR_A_DRAFT: Readonly<Record<string, string>> = {
  headerValueEncrypted: 'a webhook\'s sealed header is the server\'s to write',
  headerValueSet: 'read-only: whether the server holds a header value',
  addOnName: 'the add-on\'s name is written by the server from what is installed',
};

/** `, a: T, b?: T` — a field that may be left out, or that has a default, carries the `?`. */
function fields(schema: Json, printer: Printer, skip: readonly string[] = [], inCondition = false): string {
  const properties = isJson(schema['properties']) ? schema['properties'] : {};
  const required = new Set(Array.isArray(schema['required']) ? (schema['required'] as string[]) : []);
  return Object.entries(properties)
    .filter(([name]) => !skip.includes(name) && !(name in NOT_FOR_A_DRAFT))
    .map(([name, value]) => `, ${name}${required.has(name) && !(isJson(value) && 'default' in value) ? '' : '?'}: ${isJson(value) ? type(value, printer, inCondition) : 'any'}`)
    .join('');
}

/**
 * What each kind of step is FOR, and the one rule a draft most often breaks.
 * A schema cannot say these. A kind of the schema with no line here fails a test.
 */
export const ACTION_NOTES: Readonly<Record<string, string>> = {
  email: 'sends a LIVE template (its key from rule_parts; no subject or body of its own). `to` names a column that HOLDS ADDRESSES (rule_parts lists them, a linked row\'s too: `customer_id.email`), or fixed addresses. `vars` fills a placeholder the record does not: its name → a text.',
  notification: 'an in-app notice to roles or people of the workspace.',
  'record.create': 'adds a row to `table`; `values` is column → text, or { "now": true } for the moment it runs.',
  'record.update': 'writes columns of the record the run is about.',
  webhook: 'calls a URL the person gives. Never invent one; leave `headerValue` out.',
  'document.render': 'draws a document from a mapping that already exists. Never draft one: it is made on the mappings page.',
  'add-on.step': 'a step an installed add-on gives. `addOn`, `step` and the input keys are EXACTLY those rule_parts lists; `inputs` is input key → text. With none listed that does what was asked, leave the step out and say so in "leftOut".',
};

/** Every kind of step the schema knows, in its own order. */
export function actionKinds(): string[] {
  return actionVariants().flatMap(kindsOf);
}

function schemas(): { trigger: Json; graph: Json } {
  const options = { io: 'input', unrepresentable: 'any' } as const;
  return { trigger: z.toJSONSchema(automationTriggerSchema, options) as Json, graph: z.toJSONSchema(automationGraphSchema, options) as Json };
}

function nodeVariants(graph: Json): Json[] {
  const nodes = isJson(graph['properties']) && isJson(graph['properties']['nodes']) ? graph['properties']['nodes'] : {};
  const seen = new Map<string, Json>();
  for (const variant of alternatives(isJson(nodes['items']) ? nodes['items'] : {})) for (const kind of kindsOf(variant)) if (!seen.has(kind)) seen.set(kind, variant);
  return [...seen.values()];
}

function actionVariants(): Json[] {
  const action = nodeVariants(schemas().graph).find((variant) => kindsOf(variant).includes('action'));
  const of = action !== undefined && isJson(action['properties']) && isJson(action['properties']['action']) ? action['properties']['action'] : {};
  return alternatives(of);
}

/** The rule format, rendered for the prompt. */
export function ruleFormat(): string {
  const { trigger, graph } = schemas();
  const printer: Printer = { condition: null };
  const lines: string[] = ['A rule is `{ name, description, trigger, graph }`. Notation: `a?:` may be left out; `text≤N` is at most N characters; `[T] ≤N` is a list of at most N.', '', 'trigger, one of (`connectionId` and `table` are ids from describe_schema, never names you make up):'];
  for (const variant of alternatives(trigger)) lines.push(`- { kind: ${kindsOf(variant).map((kind) => JSON.stringify(kind)).join('|')}${fields(variant, printer, ['kind'])} }`);
  const nodes = isJson(graph['properties']) && isJson(graph['properties']['nodes']) ? graph['properties']['nodes'] : {};
  lines.push('', `graph is { version: 1, nodes: [Node] ${String(nodes['minItems'] ?? 1)}..${String(nodes['maxItems'] ?? '')} }. A Node, one of:`);
  for (const variant of nodeVariants(graph)) {
    const shown = { ...variant, properties: Object.fromEntries(Object.entries(isJson(variant['properties']) ? variant['properties'] : {}).map(([name, value]) => [name, name === 'action' ? { const: 'Action' } : value])) };
    lines.push(`- { kind: ${kindsOf(variant).map((kind) => JSON.stringify(kind)).join('|')}${fields(shown, printer, ['kind']).replaceAll('"Action"', 'Action')} }`);
  }
  lines.push('', 'An Action, one of:');
  for (const variant of actionVariants()) {
    const kind = kindsOf(variant)[0] ?? '';
    lines.push(`- { kind: ${JSON.stringify(kind)}${fields(variant, printer, ['kind'])} }: ${ACTION_NOTES[kind] ?? ''}`);
  }
  if (printer.condition !== null) lines.push('', `A Condition is {${fields(printer.condition, printer, [], true).replace(/^,/, '')} }: \`left\` is a column of the record, or a count of related rows.`);
  return lines.join('\n');
}

/** Every field name the two schemas hold, however deep: what the format must not lack. */
export function schemaFieldNames(): string[] {
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!isJson(value)) return;
    if (isJson(value['properties'])) for (const name of Object.keys(value['properties'])) out.add(name);
    for (const child of Object.values(value)) walk(child);
  };
  const { trigger, graph } = schemas();
  walk(trigger);
  walk(graph);
  return [...out];
}
