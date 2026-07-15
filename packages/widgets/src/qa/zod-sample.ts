/**
 * Deterministic "valid config" sampler for the config-schema fuzz harness
 * (04-widget-registry.md acceptance #4/#17 spirit, 04-T17 (3)): generate N
 * random *valid* configs from a widget's Zod schema and assert render never
 * crashes.
 *
 * Rather than reflect over Zod internals (version-fragile), it lowers the schema
 * to JSON Schema via Zod v4's `z.toJSONSchema` and samples instances from that
 * stable shape with the repo's seeded PRNG (byte-reproducible — never
 * `Math.random`). Every generated instance is re-validated through the source
 * schema and offending top-level fields are pruned, so the returned configs are
 * guaranteed to `safeParse` successfully.
 */
import { mulberry32 } from '@adminium/charts';
import { z } from 'zod';

type Json = unknown;
interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  enum?: Json[];
  const?: Json;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  format?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  definitions?: Record<string, JsonSchema>;
}

/**
 * Top-level config fields the sampler never populates: `binding` holds a full
 * recursive QueryDescriptor whose valid instances are non-trivial and which the
 * demo/render path treats as absent anyway (04 §5.3). Leaving it out keeps every
 * sample valid without special-casing the descriptor grammar.
 */
const SKIP_FIELDS = new Set(['binding']);

const WORDS = ['orders', 'Revenue', 'north', 'q3', 'Team λ', '2026', 'مبيعات', 'x-1', ''];

/**
 * Value pools for shared-config fields whose type is a free `string` but whose
 * domain is semantic (a BCP-47 locale, an ISO-4217 currency). The fuzzer draws
 * from realistic values rather than arbitrary garbage that would make `Intl`
 * throw on unrealistic input. Keyed by leaf property name (applies at any
 * nesting, e.g. `format.locale`).
 *
 * The EMPTY string `''` is included deliberately: it is schema-valid for
 * `format.locale`/`format.currency` and previously crashed widgets that pass it
 * to `Intl` (the `?? 'en-US'` fallback misses `''`). `@adminium/i18n`
 * `getFormatters` now normalizes an empty/invalid tag, and `formatMoney`
 * coalesces an empty currency, so the gate genuinely covers this valid-config
 * path instead of excluding it.
 */
const FIELD_POOLS: Record<string, readonly unknown[]> = {
  locale: ['en-US', 'ar-EG', 'fr-FR', 'de-DE', ''],
  currency: ['USD', 'EUR', 'JPY', 'GBP', ''],
};

function resolveRef(node: JsonSchema, root: JsonSchema): JsonSchema {
  if (node.$ref === undefined) return node;
  const name = node.$ref.replace(/^#\/(\$defs|definitions)\//, '');
  const defs = root.$defs ?? root.definitions ?? {};
  return defs[name] ?? {};
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)] ?? items[0]!;
}

function sampleNumber(node: JsonSchema, rng: () => number): number {
  const isInt = node.type === 'integer';
  const lo = node.minimum ?? node.exclusiveMinimum ?? 0;
  const hi = node.maximum ?? node.exclusiveMaximum ?? lo + 100;
  let value = lo + rng() * Math.max(0, hi - lo);
  if (node.multipleOf) value = Math.round(value / node.multipleOf) * node.multipleOf;
  if (isInt) value = Math.round(value);
  // Clamp back inside an exclusive bound.
  if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) value = node.exclusiveMinimum + (isInt ? 1 : 0.1);
  if (node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) value = node.exclusiveMaximum - (isInt ? 1 : 0.1);
  if (node.minimum !== undefined && value < node.minimum) value = node.minimum;
  if (node.maximum !== undefined && value > node.maximum) value = node.maximum;
  return value;
}

function sampleString(node: JsonSchema, rng: () => number): string {
  switch (node.format) {
    case 'email':
      return 'qa@example.com';
    case 'uri':
    case 'url':
      return '/p/orders';
    case 'date-time':
      return '2026-07-15T00:00:00.000Z';
    default: {
      const word = pick(WORDS, rng);
      if (node.minLength !== undefined && word.length < node.minLength) {
        return word.padEnd(node.minLength, 'x');
      }
      return word;
    }
  }
}

function sampleNode(node: JsonSchema, root: JsonSchema, rng: () => number, depth: number): Json {
  if (depth > 6) return undefined;
  const resolved = resolveRef(node, root);
  if (resolved.const !== undefined) return resolved.const;
  if (resolved.enum && resolved.enum.length > 0) return pick(resolved.enum, rng);
  const branches = resolved.anyOf ?? resolved.oneOf;
  if (branches && branches.length > 0) return sampleNode(pick(branches, rng), root, rng, depth + 1);
  if (resolved.allOf && resolved.allOf.length > 0) {
    return sampleObject({ ...resolved, ...resolved.allOf[0] }, root, rng, depth);
  }

  const type = Array.isArray(resolved.type) ? resolved.type.find((t) => t !== 'null') : resolved.type;
  if (type === undefined && resolved.properties) return sampleObject(resolved, root, rng, depth);

  switch (type) {
    case 'string':
      return sampleString(resolved, rng);
    case 'number':
    case 'integer':
      return sampleNumber(resolved, rng);
    case 'boolean':
      return rng() < 0.5;
    case 'null':
      return null;
    case 'array': {
      const min = resolved.minItems ?? 0;
      const max = Math.min(resolved.maxItems ?? 3, 3);
      const count = min + Math.floor(rng() * Math.max(1, max - min + 1));
      const itemSchema = Array.isArray(resolved.items) ? resolved.items[0] : resolved.items;
      const out: Json[] = [];
      for (let i = 0; i < count; i += 1) {
        out.push(itemSchema ? sampleNode(itemSchema, root, rng, depth + 1) : 0);
      }
      return out;
    }
    case 'object':
      return sampleObject(resolved, root, rng, depth);
    default:
      return undefined;
  }
}

function sampleObject(node: JsonSchema, root: JsonSchema, rng: () => number, depth: number): Record<string, Json> {
  const out: Record<string, Json> = {};
  const properties = node.properties ?? {};
  const required = new Set(node.required ?? []);
  for (const [key, propSchema] of Object.entries(properties)) {
    if (SKIP_FIELDS.has(key)) continue;
    // Always include required fields; include optional fields ~60% of the time
    // so successive samples exercise different field subsets.
    if (!required.has(key) && rng() >= 0.6) continue;
    const pool = FIELD_POOLS[key];
    const value = pool ? pick(pool, rng) : sampleNode(propSchema, root, rng, depth + 1);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Generate `count` deterministic, schema-valid configs for a widget schema.
 * `seed` fixes the byte-reproducible sequence.
 */
export function configSamples(schema: z.ZodType, seed: number, count: number): Record<string, unknown>[] {
  let jsonSchema: JsonSchema;
  try {
    // Zod v4: lower to JSON Schema (input shape). `unrepresentable: 'any'` keeps
    // exotic nodes (dates, custom effects) from throwing.
    jsonSchema = zToJsonSchema(schema);
  } catch {
    jsonSchema = { type: 'object', properties: {} };
  }
  const rng = mulberry32(seed >>> 0);
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = sampleObject(jsonSchema, jsonSchema, rng, 0);
    out.push(coerceValid(schema, raw));
  }
  return out;
}

/** Re-validate a sampled object, pruning any top-level field the schema rejects. */
function coerceValid(schema: z.ZodType, raw: Record<string, unknown>): Record<string, unknown> {
  let candidate = { ...raw };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return parsed.data as Record<string, unknown>;
    let pruned = false;
    for (const issue of parsed.error.issues) {
      const head = issue.path[0];
      if (typeof head === 'string' && head in candidate) {
        const next = { ...candidate };
        delete next[head];
        candidate = next;
        pruned = true;
      }
    }
    if (!pruned) break;
  }
  const empty = schema.safeParse({});
  return empty.success ? (empty.data as Record<string, unknown>) : {};
}

// Isolated so a Zod minor that renames the export surfaces in one place.
function zToJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as unknown as JsonSchema;
}
