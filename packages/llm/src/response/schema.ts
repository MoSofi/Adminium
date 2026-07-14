/**
 * `LlmResponseV1` — the one response contract shared by the direct-API and BYO
 * paths (06-llm-assist.md §1, §6.1). Shipped verbatim from §6.1: field names
 * and shapes are load-bearing — the golden fixtures in §6.3 and every
 * downstream consumer (validate.ts, normalize.ts, diff.ts) depend on them.
 *
 * ONE intentional adaptation to Zod 4 is marked below (`L10n`): the doc's
 * `z.record(LocaleCode, …)` cannot be used literally — in Zod 3 an enum-keyed
 * record was partial, but in Zod 4 it is exhaustive (every enum key required),
 * which would reject a 2-locale response (§6.3). Nor may the key be a strict
 * enum: §7.2 stage 5 (`LLM_LOCALE_KEYS`) is the SOLE owner of locale-key
 * validation, and it must be per-item — a single stray/non-canonical key (a
 * BCP-47 'en-US', an unrequested 'pt_BR') must drop only that one suggestion,
 * not fail the whole run at Zod (stage 4, fatal). So the key is typed
 * `z.string()`: any string key parses here, and validate.ts checks the exact
 * requested-locale set contextually (Zod alone can't know the run's locale list).
 *
 * Version negotiation (§4.3) is appended after the verbatim schema.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 'adminium.llm/v1' as const;
export const SUPPORTED_SCHEMA_VERSIONS = [SCHEMA_VERSION] as const;

export const LOCALES = ['en_US','de_DE','ar_EG','zh_CN','zh_TW','cs_CZ','da_DK','fr_FR'] as const;
export const LocaleCode = z.enum(LOCALES);

/** Localized text: keys must be exactly the run's requested locales — enforced
 *  contextually in validate.ts stage 5 (Zod alone can't know the run's locale
 *  list). The key schema is `z.string()`, NOT `LocaleCode`: a stray or
 *  non-canonical locale key must be a per-item `LLM_LOCALE_KEYS` drop (stage 5),
 *  never a fatal `LLM_SCHEMA_INVALID` at Zod (stage 4) that discards the whole
 *  run. The value still enforces a non-empty string. */
export const L10n = z.record(z.string(), z.string().min(1));

export const Confidence = z.number().min(0).max(1);
export const Tone = z.enum(['pos', 'warn', 'danger', 'accent', 'muted']);
export const PiiKind = z.enum(['email','phone','name','address','gov-id','dob',
  'financial','credentials','health','ip','location','other']);
export const Masking = z.enum(['mask-email','mask-partial','last4','redact','hash','none']);
export const Agg = z.enum(['count','sum','avg','min','max']);
export const RelationKind = z.enum(['many-to-one','one-to-one','many-to-many-via']);
const LucideIcon = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case lucide icon name');
const Slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const Reason = z.string().min(1).max(200);

export const PiiSuggestion = z.object({
  kind: PiiKind, masking: Masking, reason: Reason, confidence: Confidence,
});

export const ColumnSuggestion = z.object({
  column: z.string().min(1),
  label: L10n,
  description: L10n.optional(),
  pii: PiiSuggestion.nullable().default(null),
});

export const PageTemplateSuggestion = z.object({
  template: z.string().min(1),          // membership in LLM_ALLOWED_TEMPLATES checked referentially
  rank: z.number().int().min(1),
  triggers: z.array(z.string()).min(1),
  reason: Reason,
  confidence: Confidence,
});

export const Microcopy = z.object({
  emptyState: z.object({ headline: L10n, guidance: L10n }),
  pageSubtitle: L10n,
});

export const TableSuggestion = z.object({
  table: z.string().min(1),             // qualified "schema.table"
  confidence: Confidence,
  label: L10n,
  description: L10n,
  icon: LucideIcon,
  displayColumn: z.string().nullable(),
  naturalKey: z.array(z.string().min(1)).min(1).nullable(),
  pageTemplates: z.array(PageTemplateSuggestion).max(3).default([]),
  microcopy: Microcopy.optional(),
  columns: z.array(ColumnSuggestion).default([]),
});

export const EnumSuggestion = z.object({
  table: z.string().min(1),
  column: z.string().min(1),
  kind: z.enum(['workflow', 'category']),
  order: z.array(z.string()).nullable(),          // permutation-checked referentially
  terminal: z.array(z.string()).optional(),
  tones: z.record(z.string(), Tone),
  reason: Reason,
  confidence: Confidence,
});

export const ConfirmedRelation = z.object({
  fromTable: z.string(), fromColumns: z.array(z.string()).min(1),
  toTable: z.string(),   toColumns: z.array(z.string()).min(1),
  semantics: z.string().max(120),
  correct: z.boolean(),
  confidence: Confidence,
});

export const InferredRelation = z.object({
  fromTable: z.string(), fromColumns: z.array(z.string()).min(1),
  toTable: z.string(),   toColumns: z.array(z.string()).min(1),
  kind: RelationKind,
  viaTable: z.string().optional(),
  evidence: Reason,
  confidence: Confidence,
});

export const NavGroupSuggestion = z.object({
  id: Slug,
  label: L10n,
  icon: LucideIcon,
  order: z.number().int().min(0),
  tables: z.array(z.string()).min(1),
  confidence: Confidence,
});

export const WidgetSuggestion = z.object({
  widget: z.string().min(1),            // membership in LLM_ALLOWED_WIDGETS checked referentially
  rank: z.number().int().min(1),
  span: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]),
  table: z.string().min(1),
  metricColumn: z.string().optional(),
  dimensionColumn: z.string().optional(),
  timeColumn: z.string().optional(),
  agg: Agg.optional(),
  titleEn: z.string().max(60),
  reason: Reason,
  confidence: Confidence,
});

export const DashboardSuggestion = z.object({
  id: Slug,
  domain: z.string().max(40),
  label: L10n,
  order: z.number().int().min(0),
  tables: z.array(z.string()).min(1),
  widgets: z.array(WidgetSuggestion).max(8),
});

export const LlmResponseV1 = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  run_id: z.string().optional(),
  error: z.string().optional(),         // model-declared inability; if set, all else ignored
  tables: z.array(TableSuggestion).default([]),
  enums: z.array(EnumSuggestion).default([]),
  relations: z.object({
    confirmed: z.array(ConfirmedRelation).default([]),
    inferred: z.array(InferredRelation).default([]),
  }).default({ confirmed: [], inferred: [] }),
  navGroups: z.array(NavGroupSuggestion).max(7).default([]),
  dashboards: z.array(DashboardSuggestion).max(6).default([]),
  notes: z.array(z.string().max(300)).max(5).optional(),
}).strict();

export type LlmResponseV1 = z.infer<typeof LlmResponseV1>;

// ─────────────────────────────────────────────────────────────────────────────
// Inferred TS types for the sub-schemas above. These are additive to the §6.1
// verbatim block (they only surface `z.infer<>` of already-declared schemas) so
// downstream modules — notably the EnrichmentSet normalized shape in types.ts —
// can name the same shapes without re-deriving them.
// ─────────────────────────────────────────────────────────────────────────────

export type LocaleCode = z.infer<typeof LocaleCode>;
export type L10n = z.infer<typeof L10n>;
export type Tone = z.infer<typeof Tone>;
export type PiiKind = z.infer<typeof PiiKind>;
export type Masking = z.infer<typeof Masking>;
export type Agg = z.infer<typeof Agg>;
export type RelationKind = z.infer<typeof RelationKind>;
export type PiiSuggestion = z.infer<typeof PiiSuggestion>;
export type ColumnSuggestion = z.infer<typeof ColumnSuggestion>;
export type PageTemplateSuggestion = z.infer<typeof PageTemplateSuggestion>;
export type Microcopy = z.infer<typeof Microcopy>;
export type TableSuggestion = z.infer<typeof TableSuggestion>;
export type EnumSuggestion = z.infer<typeof EnumSuggestion>;
export type ConfirmedRelation = z.infer<typeof ConfirmedRelation>;
export type InferredRelation = z.infer<typeof InferredRelation>;
export type NavGroupSuggestion = z.infer<typeof NavGroupSuggestion>;
export type WidgetSuggestion = z.infer<typeof WidgetSuggestion>;
export type DashboardSuggestion = z.infer<typeof DashboardSuggestion>;

// ─── Version negotiation (§4.3) ──────────────────────────────────────────────

/**
 * Prompt-contract version. §4.3 colocates the authoritative constant in
 * prompt/templates/v1.ts (06-T03); it is mirrored here so the response contract
 * and its version negotiation are self-contained and need no cross-subdir
 * import. Both must stay equal to `'adminium.prompt/v1'`.
 */
export const PROMPT_VERSION = 'adminium.prompt/v1' as const;

export type SupportedSchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

/** Fatal code raised by stage 3 of the pipeline (§7.2) on an unknown contract. */
export const VERSION_MISMATCH_CODE = 'LLM_VERSION_MISMATCH' as const;

/** Rendered verbatim in the paste UI when a response targets an unknown contract (§4.3). */
export const VERSION_MISMATCH_HINT =
  'Regenerate the prompt in Studio (Settings → AI) — this response was produced for an unsupported contract version.';

export interface VersionSupported {
  ok: true;
  version: SupportedSchemaVersion;
}

export interface VersionRejected {
  ok: false;
  code: typeof VERSION_MISMATCH_CODE;
  /** The offending value, echoed back for the error message / support. */
  found: unknown;
  message: string;
  hint: string;
}

export type VersionNegotiation = VersionSupported | VersionRejected;

/**
 * Predicate: is `version` a contract version this build still validates?
 *
 * When v2 ships, v1 stays in {@link SUPPORTED_SCHEMA_VERSIONS} and keeps
 * validating against the frozen v1 schema (§4.3) — a user may paste a response
 * generated from a prompt downloaded weeks earlier. `supported` is injectable so
 * that forward-compatibility (a supported-but-older version) is testable today.
 */
export function isSupportedSchemaVersion(
  version: unknown,
  supported: readonly string[] = SUPPORTED_SCHEMA_VERSIONS,
): version is SupportedSchemaVersion {
  return typeof version === 'string' && supported.includes(version);
}

/**
 * Negotiate a response's declared `schema_version` (§4.3): a supported version
 * (including a supported-but-older one) resolves `ok`; anything else is a fatal
 * rejection carrying `LLM_VERSION_MISMATCH` and the regeneration hint.
 */
export function negotiateSchemaVersion(
  version: unknown,
  supported: readonly string[] = SUPPORTED_SCHEMA_VERSIONS,
): VersionNegotiation {
  if (isSupportedSchemaVersion(version, supported)) {
    return { ok: true, version };
  }
  const found =
    typeof version === 'string'
      ? `"${version}"`
      : 'a missing or non-string schema_version';
  return {
    ok: false,
    code: VERSION_MISMATCH_CODE,
    found: version,
    message: `Unsupported schema_version (${found}). ${VERSION_MISMATCH_HINT}`,
    hint: VERSION_MISMATCH_HINT,
  };
}
