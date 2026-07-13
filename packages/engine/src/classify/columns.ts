/**
 * Column semantic classification — 05-introspection-engine.md §7.
 *
 * Deterministic ordered rule pipeline: each column receives exactly ONE
 * primary semantic (first matching rule wins, in the §7.1 precedence order)
 * plus independent flags (`secret`, `pii`, `maskedByDefault`) from the §7.2
 * layer (./pii.ts). Rule ids (`r01-secret` … `r30-plain`) mirror the §7.1
 * row numbers — later docs and the LLM prompt reference them.
 *
 * The pipeline is pure and heuristic-only (`source: 'heuristic'`); LLM
 * enrichment (06-llm-assist.md) and Studio overrides land on top with
 * `source: 'llm' | 'override'` and always win downstream.
 */
import type {
  ColumnModel,
  ColumnSemantics,
  DatabaseModel,
  EnumDef,
  SemanticTag,
  TableModel,
} from '../schema-model.js';
import { normalizeName } from './names.js';
import { detectPii } from './pii.js';

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

/** One classified column: the persisted semantics plus audit trail. */
export interface ClassifiedColumn {
  tableId: string;
  column: string;
  /** §7.1 row id that decided `semantics.primary`, e.g. 'r04-money'. */
  ruleId: string;
  /** Human-readable evidence for the Studio remap editor / golden tests. */
  reasons: string[];
  /** Exactly the shape persisted into `ColumnModel.semantics`. */
  semantics: ColumnSemantics;
}

// ---------------------------------------------------------------------------
// Table-level context the column rules need
// ---------------------------------------------------------------------------

export interface PairAssignment {
  semantic: Extract<SemanticTag, 'date-range' | 'geo-point'>;
  role: 'start' | 'end' | 'lat' | 'lng';
  partner: string;
}

export interface ColumnClassifyContext {
  table: TableModel;
  enumsById: ReadonlyMap<string, EnumDef>;
  /** Columns resolved as FKs: declared mirror or accepted (≥ 0.8) relation. */
  fkColumns: ReadonlySet<string>;
  /** People-shaped table (§8 directory trigger) — gates rule 16 + PII. */
  peopleish: boolean;
  /** Start/end and lat/lng pair assignments (§7.1 rows 11 and 14). */
  pairs: ReadonlyMap<string, PairAssignment>;
}

// ---------------------------------------------------------------------------
// Shared vocab (verbatim from §7.1 unless commented)
// ---------------------------------------------------------------------------

const TEXTISH = new Set(['text', 'varchar']);
const NUMERIC = new Set(['integer', 'bigint', 'decimal', 'float']);
const TIMESTAMP_FAMILY = new Set(['date', 'timestamp', 'timestamptz']);

const SECRET_RE = /(password|passwd|secret|token|api_key|apikey|private_key|credential|salt|hash(ed)?_)/;
const PK_ID_NAME_RE = /^(id|uuid|guid)$/;
const MONEY_RE =
  /(^|_)(amount|price|cost|total|subtotal|balance|fee|mrr|arr|revenue|budget|salary|payout|refund|paid|owed)(_|$)/;
const PERCENT_RE = /(^|_)(percent|pct|rate|ratio|progress|completion|discount|utilization)(_|$)/;
const SCORE_RE = /(^|_)(score|rating|stars|nps|health)(_|$)/;
/** §7.1 row 7 — workflow value vocabulary (verbs/states → kanban trigger). */
export const WORKFLOW_VALUE_RE =
  /^(todo|to_do|backlog|open|new|pending|draft|queued|in_progress|inprogress|doing|review|in_review|approved|rejected|blocked|on_hold|done|completed?|closed|cancell?ed|archived|active|paused|failed|error|shipped|delivered|paid|overdue|refunded|trial|churned|q[1-4])$/i;
const CREATED_AT_RE = /^(created_at|created_on|created|creation_date|date_created|inserted_at)$/;
const UPDATED_AT_RE = /^(updated_at|updated_on|modified_at|last_modified|updatedat)$/;
const START_RE = /(^|_)(start|begin|from|opens?)(_date|_at|_time)?$/;
const END_RE = /(^|_)(end|finish|until|to|due|closes?)(_date|_at|_time)?$/;
const EVENT_TS_RE = /(_at|_date|_on|_time|_ts)$/;
/**
 * §7.1 row 13 lists `_seconds|_secs|_ms|_minutes|_mins|_hours` inside the
 * `(^|_)…(_|$)` envelope, which would require a double underscore; we read
 * the intent as suffix alternatives and split the regex accordingly.
 */
const DURATION_WORD_RE = /(^|_)(duration|elapsed|time_spent)(_|$)/;
const DURATION_SUFFIX_RE = /_(seconds|secs|ms|minutes|mins|hours)$/;
const LAT_RE = /^(lat|latitude)$/;
const LNG_RE = /^(lng|lon|long|longitude)$/;
const GEO_REGION_RE = /(^|_)(country|country_code|state|province|region|region_code|county)(_|$)/;
const PERSON_NAME_RE = /^(first_name|last_name|full_name|display_name|name|username)$/;
const EMAIL_RE = /(^|_)e?mail(_address)?(_|$)/;
const PHONE_RE = /(^|_)(phone|mobile|tele?phone|fax)(_number)?(_|$)/;
const IMAGE_RE =
  /(^|_)(avatar|image|img|photo|picture|logo|icon|thumbnail|cover)(_url|_path|_key)?(_|$)/;
const FILE_RE = /(^|_)(file|attachment|document|upload)(_url|_path|_key|_name)?(_|$)/;
const URL_RE = /(^|_)(url|link|website|href|homepage)(_|$)/;
const BOOL_PREFIX_RE = /^(is_|has_|can_|should_|allow_)/;
const BOOL_SUFFIX_RE =
  /(enabled|active|archived|deleted|read|seen|starred|verified|billable|public|featured|default)$/;
const COLOR_RE = /(^|_)(color|colour|hex)(_|$)/;
const TAGS_RE = /^(tags|labels|keywords)$/;
const SLUG_RE = /^(slug|handle|permalink)$/;
const IP_RE = /(^|_)ip(_address)?$/;
const EXTERNAL_ID_RE = /_(id|uuid|ref|number|no)$/;
const CENTS_RE = /_cents$/;
const CURRENCY_SIBLING_RE = /(^|_)(currency|curr(ency)?_code)(_|$)/;

/** §8 directory trigger vocabulary for "people-ish" tables (see tables.ts). */
export const PEOPLE_TABLE_RE =
  /(^|_)(users?|people|persons?|employees?|staff|members?|contacts?|customers?|profiles?|teachers?|students?|drivers?|agents?|authors?|patients?)(_|$)/;

// ---------------------------------------------------------------------------
// CHECK-constraint bounds (rules 5/6/22 use numeric bounds when present)
// ---------------------------------------------------------------------------

/** Min/max numeric literal in CHECK expressions mentioning the column. */
export function checkBounds(
  table: TableModel,
  columnName: string,
): { min: number; max: number } | null {
  const columnRe = new RegExp(`(^|[^a-zA-Z0-9_"])"?${escapeRe(columnName)}"?([^a-zA-Z0-9_"]|$)`);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const check of table.checks) {
    if (!columnRe.test(check.expression)) continue;
    for (const literal of check.expression.match(/\d+(\.\d+)?/g) ?? []) {
      const value = Number(literal);
      if (!Number.isFinite(value)) continue;
      found = true;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return found ? { min, max } : null;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Context builder (pair detection, FK set, people-ish flag)
// ---------------------------------------------------------------------------

/** Accepted-relation threshold (§6): ≥ 0.8 behaves like a declared FK. */
const ACCEPTED_RELATION_CONFIDENCE = 0.8;

export function buildColumnClassifyContext(
  model: DatabaseModel,
  table: TableModel,
): ColumnClassifyContext {
  const enumsById = new Map(model.enums.map((e) => [e.id, e]));

  const fkColumns = new Set<string>();
  for (const column of table.columns) {
    if (column.references !== null) fkColumns.add(column.name);
  }
  for (const relation of model.relations) {
    if (relation.from.tableId !== table.id) continue;
    if (relation.confidence < ACCEPTED_RELATION_CONFIDENCE) continue;
    for (const column of relation.from.columns) fkColumns.add(column);
  }

  const names = table.columns.map((c) => normalizeName(c.name));
  const hasEmail = table.columns.some(
    (c, i) => TEXTISH.has(c.logicalType) && EMAIL_RE.test(names[i]!),
  );
  const hasPersonName = names.some((n) => PERSON_NAME_RE.test(n));
  const peopleish =
    PEOPLE_TABLE_RE.test(normalizeName(table.name)) || (hasEmail && hasPersonName);

  return {
    table,
    enumsById,
    fkColumns,
    peopleish,
    pairs: detectPairs(table),
  };
}

/** §7.1 rows 11 (start/end) and 14 (lat/lng) are table-scoped pair rules. */
function detectPairs(table: TableModel): Map<string, PairAssignment> {
  const pairs = new Map<string, PairAssignment>();

  // -- geo lat/lng (row 14): both present, float/decimal ------------------
  const geoType = (c: ColumnModel) => c.logicalType === 'float' || c.logicalType === 'decimal';
  const lat = table.columns.find((c) => geoType(c) && LAT_RE.test(normalizeName(c.name)));
  const lng = table.columns.find((c) => geoType(c) && LNG_RE.test(normalizeName(c.name)));
  if (lat && lng) {
    pairs.set(lat.name, { semantic: 'geo-point', role: 'lat', partner: lng.name });
    pairs.set(lng.name, { semantic: 'geo-point', role: 'lng', partner: lat.name });
  }

  // -- start/end (row 11): same date/timestamp type both ------------------
  interface Candidate {
    column: ColumnModel;
    /** Name with the start/end keyword removed — used to match prefixes. */
    stem: string;
  }
  const stemOf = (name: string, re: RegExp) => name.replace(re, '$1').replace(/^_|_$/g, '');
  const starts: Candidate[] = [];
  const ends: Candidate[] = [];
  for (const column of table.columns) {
    if (!TIMESTAMP_FAMILY.has(column.logicalType)) continue;
    const name = normalizeName(column.name);
    if (CREATED_AT_RE.test(name) || UPDATED_AT_RE.test(name)) continue;
    if (START_RE.test(name)) starts.push({ column, stem: stemOf(name, START_RE) });
    else if (END_RE.test(name)) ends.push({ column, stem: stemOf(name, END_RE) });
  }
  const taken = new Set<string>();
  const pairUp = (start: Candidate, end: Candidate) => {
    taken.add(end.column.name);
    pairs.set(start.column.name, {
      semantic: 'date-range',
      role: 'start',
      partner: end.column.name,
    });
    pairs.set(end.column.name, {
      semantic: 'date-range',
      role: 'end',
      partner: start.column.name,
    });
  };
  for (const start of starts) {
    const sameType = (e: Candidate) =>
      !taken.has(e.column.name) && e.column.logicalType === start.column.logicalType;
    const byStem = ends.find((e) => sameType(e) && e.stem === start.stem);
    if (byStem) {
      pairUp(start, byStem);
      continue;
    }
    // A single unambiguous start/end pair matches even without a shared stem.
    if (starts.length === 1 && ends.filter(sameType).length === 1) {
      pairUp(start, ends.find(sameType)!);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// The rule pipeline
// ---------------------------------------------------------------------------

interface RuleHit {
  tag: SemanticTag;
  confidence: number;
  format: string | null;
  pair?: ColumnSemantics['pair'];
  secret?: boolean;
  reasons: string[];
}

type Rule = (column: ColumnModel, name: string, ctx: ColumnClassifyContext) => RuleHit | null;

const hit = (
  tag: SemanticTag,
  confidence: number,
  format: string | null,
  reasons: string[],
  extra?: Partial<RuleHit>,
): RuleHit => ({ tag, confidence, format, reasons, ...extra });

function enumValues(column: ColumnModel, ctx: ColumnClassifyContext): string[] | null {
  if (column.enumRef === null) return null;
  return ctx.enumsById.get(column.enumRef)?.values ?? null;
}

/** Ordered §7.1 pipeline; array index+1 = doc row number. */
const RULES: { id: string; rule: Rule }[] = [
  {
    id: 'r01-secret',
    rule: (_c, name) =>
      SECRET_RE.test(name)
        ? hit('secret', 0.95, null, ['name matches secret/credential vocabulary'], {
            secret: true,
          })
        : null,
  },
  {
    id: 'r02-pk-id',
    rule: (c, name) => {
      const typeOk = ['integer', 'bigint', 'uuid', 'varchar'].includes(c.logicalType);
      if (!typeOk) return null;
      if (c.isPrimaryKey) return hit('pk-id', 0.95, 'mono', ['column is a primary key']);
      if (PK_ID_NAME_RE.test(name)) {
        return hit('pk-id', 0.9, 'mono', ['name is a bare id/uuid/guid']);
      }
      return null;
    },
  },
  {
    id: 'r03-fk',
    rule: (c, _name, ctx) => {
      if (c.references !== null) {
        return hit('fk', 1, null, [`declared FK → ${c.references.tableId}.${c.references.column}`]);
      }
      if (ctx.fkColumns.has(c.name)) {
        return hit('fk', 0.85, null, ['accepted (≥ 0.8) inferred relation covers this column']);
      }
      return null;
    },
  },
  {
    id: 'r04-money',
    rule: (c, name, ctx) => {
      if (!NUMERIC.has(c.logicalType) || !MONEY_RE.test(name)) return null;
      const reasons = ['name matches money vocabulary + numeric type'];
      let format = 'currency';
      if (c.logicalType === 'integer' || c.logicalType === 'bigint') {
        if (CENTS_RE.test(name)) {
          format = 'currency-cents';
          reasons.push('integer with _cents suffix → divide-by-100 hint');
        }
      }
      const sibling = ctx.table.columns.find((s) =>
        CURRENCY_SIBLING_RE.test(normalizeName(s.name)),
      );
      if (sibling) reasons.push(`sibling currency column "${sibling.name}" is the currency source`);
      return hit('money', 0.85, format, reasons);
    },
  },
  {
    id: 'r05-percent',
    rule: (c, name, ctx) => {
      if (!NUMERIC.has(c.logicalType) || !PERCENT_RE.test(name)) return null;
      const bounds = checkBounds(ctx.table, c.name);
      const fraction = bounds !== null && bounds.max <= 1;
      const reasons = ['name matches percent vocabulary + numeric type'];
      if (bounds) reasons.push(`CHECK bounds ${bounds.min}..${bounds.max} decide the scale`);
      else reasons.push('no CHECK bounds — assuming 0–100 scale');
      return hit('percent', 0.8, fraction ? 'percent-fraction' : 'percent', reasons);
    },
  },
  {
    id: 'r06-score',
    rule: (c, name, ctx) => {
      if (!NUMERIC.has(c.logicalType) || !SCORE_RE.test(name)) return null;
      const bounds = checkBounds(ctx.table, c.name);
      const reasons = ['name matches score/rating vocabulary + numeric type'];
      if (bounds) reasons.push(`bounded by CHECK ${bounds.min}..${bounds.max}`);
      return hit('score', 0.8, null, reasons);
    },
  },
  {
    id: 'r07-status-workflow',
    rule: (c, _name, ctx) => {
      const values = enumValues(c, ctx);
      if (values === null || values.length > 8) return null;
      if (c.logicalType !== 'enum' && !(TEXTISH.has(c.logicalType) && (c.maxLength ?? 33) <= 32)) {
        return null;
      }
      const workflowValues = values.filter((v) => WORKFLOW_VALUE_RE.test(v.trim()));
      if (workflowValues.length < 2) return null;
      return hit('status-workflow', 0.85, 'status-pill', [
        `${values.length} enum values, ${workflowValues.length} in workflow vocabulary (${workflowValues.join(', ')})`,
      ]);
    },
  },
  {
    id: 'r08-category-enum',
    rule: (c, _name, ctx) => {
      const values = enumValues(c, ctx);
      if (values === null || values.length > 24) return null;
      return hit('category-enum', 0.8, null, [
        `enum with ${values.length} values, not a workflow vocabulary`,
      ]);
    },
  },
  {
    id: 'r09-created-at',
    rule: (c, name) => {
      if (!TIMESTAMP_FAMILY.has(c.logicalType)) return null;
      if (CREATED_AT_RE.test(name)) {
        return hit('created-at', 0.95, 'relative-time', ['canonical created-at name']);
      }
      if (c.default?.kind === 'now' && !UPDATED_AT_RE.test(name)) {
        return hit('created-at', 0.7, 'relative-time', [
          'non-canonical name but DEFAULT now() and no updated-at claim',
        ]);
      }
      return null;
    },
  },
  {
    id: 'r10-updated-at',
    rule: (c, name) =>
      TIMESTAMP_FAMILY.has(c.logicalType) && UPDATED_AT_RE.test(name)
        ? hit('updated-at', 0.95, 'relative-time', ['canonical updated-at name'])
        : null,
  },
  {
    id: 'r11-date-range',
    rule: (c, _name, ctx) => {
      const pair = ctx.pairs.get(c.name);
      if (pair === undefined || pair.semantic !== 'date-range') return null;
      return hit('date-range', 0.75, null, [`${pair.role} of a start/end pair with "${pair.partner}"`], {
        pair: { role: pair.role, partner: pair.partner },
      });
    },
  },
  {
    id: 'r12-event-timestamp',
    rule: (c, name) =>
      TIMESTAMP_FAMILY.has(c.logicalType) && EVENT_TS_RE.test(name)
        ? hit('event-timestamp', 0.7, null, ['timestamp-suffixed name outside created/updated/range'])
        : null,
  },
  {
    id: 'r13-duration',
    rule: (c, name) => {
      if (!NUMERIC.has(c.logicalType)) return null;
      if (DURATION_WORD_RE.test(name)) {
        const suffix = DURATION_SUFFIX_RE.exec(name)?.[1];
        return hit('duration', 0.75, 'duration', [
          `duration vocabulary; unit ${suffix ?? 'seconds (default)'}`,
        ]);
      }
      const suffix = DURATION_SUFFIX_RE.exec(name)?.[1];
      if (suffix !== undefined) {
        return hit('duration', 0.75, 'duration', [`numeric with time-unit suffix _${suffix}`]);
      }
      return null;
    },
  },
  {
    id: 'r14-geo-point',
    rule: (c, _name, ctx) => {
      const pair = ctx.pairs.get(c.name);
      if (pair === undefined || pair.semantic !== 'geo-point') return null;
      return hit('geo-point', 0.85, null, [`${pair.role} of a lat/lng pair with "${pair.partner}"`], {
        pair: { role: pair.role, partner: pair.partner },
      });
    },
  },
  {
    id: 'r15-geo-region',
    rule: (c, name) => {
      if (!TEXTISH.has(c.logicalType) || !GEO_REGION_RE.test(name)) return null;
      if (c.maxLength !== null && c.maxLength > 64) return null;
      const short = c.maxLength !== null && c.maxLength <= 3;
      const reasons = ['name matches region/country vocabulary'];
      if (short) reasons.push(`char(${c.maxLength}) strongly suggests a region code`);
      return hit('geo-region', short ? 0.8 : 0.7, null, reasons);
    },
  },
  {
    id: 'r16-person-name',
    rule: (c, name, ctx) =>
      TEXTISH.has(c.logicalType) && PERSON_NAME_RE.test(name) && ctx.peopleish
        ? hit('person-name', 0.8, null, ['name column on a people-shaped table'])
        : null,
  },
  {
    id: 'r17-email',
    rule: (c, name) =>
      TEXTISH.has(c.logicalType) && EMAIL_RE.test(name)
        ? hit('email', 0.9, 'mono', ['name matches email pattern'])
        : null,
  },
  {
    id: 'r18-phone',
    rule: (c, name) =>
      TEXTISH.has(c.logicalType) && PHONE_RE.test(name)
        ? hit('phone', 0.85, 'tel', ['name matches phone/fax pattern'])
        : null,
  },
  {
    id: 'r19-image-url',
    rule: (c, name) =>
      (TEXTISH.has(c.logicalType) || c.logicalType === 'binary') && IMAGE_RE.test(name)
        ? hit('image-url', 0.8, null, ['name matches image/avatar vocabulary'])
        : null,
  },
  {
    id: 'r20-file-ref',
    rule: (c, name) => {
      if (TEXTISH.has(c.logicalType) && FILE_RE.test(name)) {
        return hit('file-ref', 0.75, null, ['name matches file/attachment vocabulary']);
      }
      if (c.logicalType === 'binary') {
        return hit('file-ref', 0.7, null, ['binary column without a more specific match']);
      }
      return null;
    },
  },
  {
    id: 'r21-url',
    rule: (c, name) =>
      TEXTISH.has(c.logicalType) && URL_RE.test(name)
        ? hit('url', 0.8, null, ['name matches url/link vocabulary'])
        : null,
  },
  {
    id: 'r22-boolean-flag',
    rule: (c, name, ctx) => {
      const nameOk = BOOL_PREFIX_RE.test(name) || BOOL_SUFFIX_RE.test(name);
      if (!nameOk) return null;
      if (c.logicalType === 'boolean') {
        return hit('boolean-flag', 0.85, null, ['boolean type + flag vocabulary']);
      }
      if (/^tinyint\(1\)/i.test(c.dbType)) {
        return hit('boolean-flag', 0.85, null, ['tinyint(1) + flag vocabulary']);
      }
      if (c.logicalType === 'integer') {
        const bounds = checkBounds(ctx.table, c.name);
        if (bounds !== null && bounds.min >= 0 && bounds.max <= 1) {
          return hit('boolean-flag', 0.8, null, ['integer with 0–1 CHECK + flag vocabulary']);
        }
      }
      return null;
    },
  },
  {
    id: 'r23-color',
    rule: (c, name) =>
      TEXTISH.has(c.logicalType) &&
      COLOR_RE.test(name) &&
      (c.maxLength === null || c.maxLength <= 9)
        ? hit('color', 0.75, 'color-swatch', ['name matches color vocabulary (trusted at setup)'])
        : null,
  },
  {
    id: 'r24-tags',
    rule: (c, name) =>
      (c.isArray || TEXTISH.has(c.logicalType) || c.logicalType === 'json') && TAGS_RE.test(name)
        ? hit('tags', 0.8, null, ['name matches tags/labels vocabulary'])
        : null,
  },
  {
    id: 'r25-slug',
    rule: (c, name) => {
      if (!TEXTISH.has(c.logicalType) || !SLUG_RE.test(name)) return null;
      const reasons = ['name matches slug vocabulary'];
      if (c.isUnique) reasons.push('unique constraint confirms natural key');
      return hit('slug', c.isUnique ? 0.85 : 0.7, 'mono', reasons);
    },
  },
  {
    id: 'r26-ip-address',
    rule: (c, name) => {
      if (c.logicalType === 'inet') {
        return hit('ip-address', 0.95, 'mono', ['inet column type']);
      }
      if (TEXTISH.has(c.logicalType) && IP_RE.test(name)) {
        return hit('ip-address', 0.85, 'mono', ['name matches ip pattern']);
      }
      return null;
    },
  },
  {
    id: 'r27-json-config',
    rule: (c) =>
      c.logicalType === 'json' ? hit('json-config', 0.9, null, ['json/jsonb column type']) : null,
  },
  {
    id: 'r28-external-id',
    rule: (c, name) => {
      const typeOk = TEXTISH.has(c.logicalType) || NUMERIC.has(c.logicalType) || c.logicalType === 'uuid';
      if (!typeOk || !EXTERNAL_ID_RE.test(name)) return null;
      return hit('external-id', 0.6, 'mono', ['id-suffixed name unresolved by relation inference (§6)']);
    },
  },
  {
    id: 'r29-free-text',
    rule: (c) => {
      if (c.logicalType === 'text') {
        return hit('free-text', 0.6, null, ['unbounded text type']);
      }
      if (c.logicalType === 'varchar' && c.maxLength !== null && c.maxLength >= 280) {
        return hit('free-text', 0.6, null, [`varchar(${c.maxLength}) ≥ 280 treated as long text`]);
      }
      return null;
    },
  },
  {
    id: 'r30-plain',
    rule: () => hit('plain', 0.5, null, ['no §7.1 rule matched — type-default rendering']),
  },
];

/** Every §7.1 rule id, in precedence order (exported for tests/docs). */
export const COLUMN_RULE_IDS: readonly string[] = RULES.map((r) => r.id);

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Classify one column within its table context. Pure and deterministic. */
export function classifyColumn(
  column: ColumnModel,
  ctx: ColumnClassifyContext,
): ClassifiedColumn {
  const name = normalizeName(column.name);

  let ruleId = 'r30-plain';
  let matched: RuleHit = RULES[RULES.length - 1]!.rule(column, name, ctx)!;
  for (const { id, rule } of RULES) {
    const result = rule(column, name, ctx);
    if (result !== null) {
      ruleId = id;
      matched = result;
      break;
    }
  }

  const piiResult = detectPii(column, matched.tag, {
    peopleish: ctx.peopleish,
    isGeoPointPair: ctx.pairs.get(column.name)?.semantic === 'geo-point',
  });

  const secret = matched.secret === true;
  const semantics: ColumnSemantics = {
    primary: matched.tag,
    flags: {
      secret,
      pii: piiResult.pii,
      maskedByDefault: secret || piiResult.maskedByDefault,
    },
    format: matched.format,
    pair: matched.pair ?? null,
    confidence: matched.confidence,
    source: 'heuristic',
  };

  return {
    tableId: ctx.table.id,
    column: column.name,
    ruleId,
    reasons: [...matched.reasons, ...piiResult.reasons],
    semantics,
  };
}

/** Classify every column of a table (ordinal order preserved). */
export function classifyTableColumns(
  model: DatabaseModel,
  table: TableModel,
): ClassifiedColumn[] {
  const ctx = buildColumnClassifyContext(model, table);
  return table.columns.map((column) => classifyColumn(column, ctx));
}
