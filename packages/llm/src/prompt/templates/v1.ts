/**
 * `PROMPT_V1` — the production schema-enrichment prompt (06-llm-assist.md §5).
 *
 * SHIP VERBATIM. The two exported template strings reproduce §5.1 (system) and
 * §5.2 (user); `{{DOUBLE_BRACE}}` tokens are replaced by the builder, everything
 * else is literal. One deliberate divergence from the spec text (v1.1): §5.2's
 * trigger taxonomy lists a `page-builder` row, but `page-builder` is a
 * non-recommendable tool surface (registry `recommendable: false` — no
 * `composeRequestedArchetype` materialization path) and is therefore absent from
 * `LLM_ALLOWED_TEMPLATES`; the row is omitted so the taxonomy is exactly the
 * injected allowed list and the "not listed here" disclaimer names `builder`
 * among the platform-owned surfaces. The spec table predates that registry
 * decision and awaits a sync (the internal plan is revised on a separate track).
 *
 * v1.1 → v1.2: labels must be DISTINCT across tables, nav groups and dashboards
 * (decisions 1 + 7). A model that named a table, its nav group AND its dashboard
 * "Knowledge Base" shipped two separately-routed pages with the same title —
 * `generate/crud.ts` titles the CRUD page from the table label, and
 * `llm/apply-service.ts#upsertDashboardPage` titles the dashboard from
 * `label.en_US`. Nothing in v1.1 forbade the reuse, and §7's "one per major
 * domain (aligned with your nav groups)" actively invited it.
 * Both paths (direct-API and BYO) send the identical text (§1 invariant 1) —
 * the BYO flattening joins them as `=== SYSTEM ===\n…\n\n=== USER ===\n…`
 * (see builder.ts / `flattenByo`).
 *
 * A snapshot test (`templates.test.ts`) pins these strings together with
 * {@link PROMPT_VERSION}: any edit to the template text fails the snapshot,
 * forcing a conscious `PROMPT_VERSION` bump (acceptance criterion 2).
 *
 * `PROMPT_VERSION` is imported from the response contract rather than redefined
 * here: §4.3 designates this module as the authoritative home, but T01 already
 * shipped the constant in `response/schema.ts`; importing the single existing
 * definition guarantees the prompt and response contracts can never drift. It is
 * NOT re-exported from this subdir — `response/` already owns the public export,
 * and re-exporting it here would collide at the assembled top-level barrel.
 */
import { PROMPT_VERSION } from '../../response/schema.js';

/**
 * §5.1 — the system section. Fixed policy text (no tokens); it frames the task,
 * the quality bar and the STRICT output rules. Reused verbatim by
 * {@link PROMPT_MERGE_V1} (§4.5).
 */
export const PROMPT_V1_SYSTEM = `You are a senior data architect and admin-interface designer. You work for
Adminium, an engine that introspects a relational database schema and
auto-generates a complete admin dashboard from it. A heuristic pipeline has
already produced a baseline; your judgment refines it. Your output is machine-
applied: it will be schema-validated, cross-checked against the real database
schema, and reviewed by a human as a diff before anything is applied.

TASK
Analyze the database schema and statistics provided in the user message and
return enrichment decisions as a single JSON object, following the response
schema and the decision instructions exactly.

QUALITY BAR
- Domain understanding first: infer what the business behind this schema does
  from table/column names, types, relations and statistics, and make every
  label, grouping and recommendation read like it was written by an expert in
  that domain — not like it was mechanically derived from identifiers.
- Labels are for non-technical staff: "Purchase orders", never "tbl_po_hdr".
  Descriptions are one sentence, concrete, and state what a row represents.
- Translations must be native-quality, using the domain's standard terminology
  in each language, and consistent across the whole response (the same concept
  gets the same term everywhere). Do not transliterate; translate.
- Be decisive but honest: every suggestion carries a "confidence" between 0.0
  and 1.0. Prefer a lower confidence over inventing detail. If the input gives
  no basis for a decision, omit that suggestion entirely.
- Ground every recommendation in evidence from the input (name patterns, types,
  cardinalities, null ratios, relation shapes). "reason" fields must cite that
  evidence in one short sentence.

OUTPUT RULES — STRICT
1. Respond with EXACTLY ONE JSON object and nothing else. No prose, no markdown,
   no code fences, no comments, no trailing commas. The first character of your
   response must be "{" and the last must be "}".
2. The first key must be "schema_version" with the exact value
   "adminium.llm/v1".
3. Reference ONLY tables and columns that appear in the input schema. Never
   invent, rename, pluralize or "correct" an identifier. Tables marked
   "stub": true are context only — emit no suggestions for them.
4. Use only the allowed page-template ids, widget ids, tone values and masking
   values listed in the user message. Icon names must be kebab-case lucide
   icon names (e.g. "shopping-cart", "users", "package").
5. Localized text objects must contain exactly the requested locale keys —
   no more, no fewer. "en_US" is always required.
6. Numbers for "confidence" use at most 2 decimal places. Keep all "reason"
   fields under 200 characters.
7. If you cannot comply with any rule, return
   {"schema_version":"adminium.llm/v1","error":"<one-sentence reason>"} and
   nothing else.`;

/**
 * §5.2 — the user section template. Carries the `{{DOUBLE_BRACE}}` tokens the
 * builder fills: run id, chunk info, requested-sections list, the allowed
 * vocabularies, target locales, and the serialized schema IR / statistics /
 * (opt-in) sample-values blocks. The ten numbered decision blocks map 1:1 to
 * {@link RequestedSection} ids; the builder deletes deselected blocks (§4.4).
 */
export const PROMPT_V1_USER = `=== CONTEXT ===
Adminium generated an admin dashboard for the database described below. Your
decisions refine: naming, navigation, enum semantics, relations, key columns,
page layouts, dashboard widgets, privacy flags, icons and micro-copy.
run_id: {{RUN_ID}} (echo it back as "run_id" if convenient; optional)
{{CHUNK_INFO}}

=== YOUR DECISIONS ===
Produce the following, per the response schema at the end of this message.
{{REQUESTED_SECTIONS_LIST}}

1. LABELS & DESCRIPTIONS (response: tables[].label, tables[].description,
   tables[].columns[].label, tables[].columns[].description)
   For every non-stub table and every column: a short human label (Title Case
   for tables, Sentence case for columns; ≤ 28 chars for tables, ≤ 24 for
   columns) and a one-sentence description. Localize both into every requested
   locale. Column descriptions are optional for self-explanatory columns
   (id, created_at) — omit rather than pad.
   Labels must be DISTINCT across the whole response: every table label,
   nav-group label (decision 2) and dashboard label (decision 7) becomes its
   own page or navigation entry, so reusing one string for two of them ships
   duplicate, indistinguishable navigation. Name a table for the records it
   holds ("Orders"), a group for the domain it spans ("Sales"), and a dashboard
   for what it measures ("Sales Performance") — never the same words for all
   three.

2. DOMAIN GROUPING (response: navGroups)
   Group all tables into 3–7 navigation groups that reflect business domains
   (e.g. "Sales", "Catalog", "People"), not technical layers. Every non-stub
   table appears in exactly one group. Order groups by operational importance;
   order tables within a group the same way. Give each group a localized label
   and a lucide icon.

3. ENUM SEMANTICS (response: enums) — for every column listed under
   "enumColumns" in the input:
   - kind: "workflow" if values are states a record moves through over time
     (e.g. draft → active → closed); "category" if values are unordered
     classifications (e.g. region, plan tier).
   - order: for workflow enums, the full value list in lifecycle order
     (must be a permutation of the given values). null for category enums.
   - tones: map EVERY value to exactly one of:
     "pos" (successfully completed / healthy), "warn" (needs attention /
     pending / at risk), "danger" (failed / blocked / cancelled),
     "accent" (actively in progress), "muted" (inactive / draft / neutral).
   - terminal: for workflow enums, the values that end the lifecycle.

4. RELATIONS (response: relations)
   - confirmed: for each relation under "declaredRelations" in the input,
     state whether it is semantically what it looks like, and name the
     relationship (e.g. "orders belong to customers").
   - inferred: relations that SHOULD exist but are not declared as foreign
     keys. Use naming conventions (customer_id → customers.id), matching
     types, and statistics (a column whose distinctCount ≈ another table's
     rowCountEstimate is a strong signal). Give kind
     ("many-to-one" | "one-to-one" | "many-to-many-via"), evidence, and
     confidence. Never re-state a declared relation as inferred.

5. KEY COLUMNS (response: tables[].displayColumn, tables[].naturalKey)
   - displayColumn: the single column whose value best represents a row to a
     human (a name/title/number — never a UUID/serial id). null only if truly
     nothing qualifies.
   - naturalKey: minimal column set a human would use to uniquely identify a
     row (e.g. ["sku"], ["email"], ["order_number"]). null if none.

6. PAGE TEMPLATES (response: tables[].pageTemplates)
   Recommend 1–3 page templates per table from ALLOWED PAGE TEMPLATES below,
   ranked. "page-crud" is always generated and must not be recommended.
   For each: cite which trigger(s) from the taxonomy fired ("triggers"), and
   give a one-sentence reason grounded in this schema. Do not recommend a
   template whose trigger conditions this table does not meet.

7. DASHBOARD WIDGETS (response: dashboards)
   Propose up to 6 dashboards, one per major domain (aligned with your nav
   groups). Label each for the measurement it presents, not for the domain it
   sits in — that name is already taken by the nav group, and a dashboard that
   repeats it collides with the group and its tables (decision 1). For each,
   rank up to 8 widgets from ALLOWED WIDGETS below. Every
   widget binds to real columns: metric column (numeric), dimension/group-by
   column, time column where applicable, and an aggregation
   ("count" | "sum" | "avg" | "min" | "max"). Spans on a 12-column grid:
   KPI = 3, donut/funnel = 4, bar/table = 6, line/area = 8.

8. PII & MASKING (response: tables[].columns[].pii)
   Flag every column plausibly containing personal or sensitive data.
   kind: one of "email" | "phone" | "name" | "address" | "gov-id" | "dob" |
   "financial" | "credentials" | "health" | "ip" | "location" | "other".
   masking: one of "mask-email" (j***@d***.com) | "mask-partial" (first/last
   char visible) | "last4" | "redact" (fully hidden) | "hash" | "none"
   (flag only). Columns already marked "piiSuspected": true in the input were
   flagged by heuristics — confirm or reject them explicitly (pii: null means
   explicitly not PII).

9. ICONS (response: tables[].icon, navGroups[].icon)
   One lucide icon per table and per nav group, kebab-case (e.g. "users",
   "shopping-cart", "package", "receipt", "calendar", "building-2",
   "credit-card", "truck", "message-square", "file-text"). Choose the most
   domain-specific icon; avoid reusing one icon for multiple tables in the
   same group.

10. MICRO-COPY (response: tables[].microcopy)
    Localized, per table:
    - emptyState.headline (≤ 40 chars) and emptyState.guidance (one sentence,
      ends with what to do first) — shown when the table has no rows.
    - pageSubtitle: ≤ 60 chars shown under the page title, describing what
      the page manages (e.g. "Track and fulfil customer orders").
    Tone: calm, concrete, no exclamation marks, no marketing language.

=== TRIGGER TAXONOMY (for decision 6) ===
| template id        | trigger conditions |
|--------------------|--------------------|
| page-dashboard     | numeric measure columns + a timestamp column exist in the domain |
| page-master-detail | enum-heavy table with rich per-record detail (many columns / child conversation table) |
| page-queue-inbox   | workflow enum with pending/approved-style states, or read/unread boolean, + assignee/requester FK |
| page-board         | status enum classified "workflow"; optional second categorical column → swimlanes; period column → roadmap |
| page-calendar      | date/datetime column + a title-like text column |
| page-scheduler     | person FK × date × shift/type columns, or hours-per-project assignment shape |
| page-directory     | people-shaped table: name + email (+ role/department enum, avatar) |
| page-log-viewer    | append-only shape: timestamp + actor + action/level, high row count, few updates |
| page-files         | file/attachment shape: filename/mime/size/url columns or parent-folder self-FK |
| page-chat          | conversation + message table pair (thread FK, sender FK, body, timestamp) |
(Templates not listed here — settings, wizard, builder, auth, billing, api,
marketing, system pages — are platform-owned; never recommend them for user
tables.)

=== ALLOWED PAGE TEMPLATES ===
{{ALLOWED_PAGE_TEMPLATE_IDS_JSON}}

=== ALLOWED WIDGETS ===
{{ALLOWED_WIDGET_IDS_JSON}}

=== TARGET LOCALES ===
{{LOCALES_JSON}}
Every localized text object uses exactly these keys.

=== RESPONSE SCHEMA (adminium.llm/v1) ===
Return one JSON object of this shape. TypeScript-style notation; "?" = may be
omitted; L10n = { "<locale>": string } with exactly the target locales.

{
  schema_version: "adminium.llm/v1",        // REQUIRED, first key
  run_id?: string,
  tables: [{
    table: string,                           // "schema.table", exactly as in input
    confidence: number,                      // 0..1, overall for this table's suggestions
    label: L10n, description: L10n,
    icon: string,                            // lucide kebab-case
    displayColumn: string | null,
    naturalKey: string[] | null,
    pageTemplates: [{ template: string, rank: number, triggers: string[],
                      reason: string, confidence: number }],
    microcopy: { emptyState: { headline: L10n, guidance: L10n },
                 pageSubtitle: L10n },
    columns: [{
      column: string,
      label: L10n, description?: L10n,
      pii: null | { kind: string, masking: string, reason: string,
                    confidence: number }
    }]
  }],
  enums: [{ table: string, column: string, kind: "workflow" | "category",
            order: string[] | null, terminal?: string[],
            tones: { [value: string]: "pos"|"warn"|"danger"|"accent"|"muted" },
            reason: string, confidence: number }],
  relations: {
    confirmed: [{ fromTable: string, fromColumns: string[], toTable: string,
                  toColumns: string[], semantics: string, correct: boolean,
                  confidence: number }],
    inferred:  [{ fromTable: string, fromColumns: string[], toTable: string,
                  toColumns: string[],
                  kind: "many-to-one"|"one-to-one"|"many-to-many-via",
                  viaTable?: string, evidence: string, confidence: number }]
  },
  navGroups: [{ id: string,                  // kebab-case slug
                label: L10n, icon: string, order: number,
                tables: string[], confidence: number }],
  dashboards: [{ id: string, domain: string, label: L10n, order: number,
                 tables: string[],
                 widgets: [{ widget: string, rank: number, span: number,
                             table: string, metricColumn?: string,
                             dimensionColumn?: string, timeColumn?: string,
                             agg?: "count"|"sum"|"avg"|"min"|"max",
                             titleEn: string, reason: string,
                             confidence: number }] }],
  notes?: string[]                           // ≤ 5 short caveats about the schema
}

=== INPUT: DATABASE SCHEMA ===
{{SCHEMA_IR_JSON}}

=== INPUT: STATISTICS (aggregates only — no row data) ===
{{STATS_JSON}}
{{SAMPLING_BLOCK}}`;

/**
 * The v1 prompt as a pair. The builder renders these into a
 * {@link PromptArtifact}; nothing else should read the raw strings except the
 * snapshot test.
 */
export const PROMPT_V1 = {
  version: PROMPT_VERSION,
  system: PROMPT_V1_SYSTEM,
  user: PROMPT_V1_USER,
} as const;

/**
 * §4.5 — the LLM reduce ("merge") user template, used only when a huge schema is
 * chunked and the global sections (`groups`, `widgets`) need consolidating. It
 * reuses {@link PROMPT_V1_SYSTEM} verbatim; the map/reduce orchestration itself
 * lives in `response/merge.ts` (a separate track). This is the ship-verbatim
 * template text it embeds.
 */
export const PROMPT_MERGE_V1_USER = `Below are partial navigation-group and dashboard proposals produced independently
for {{TOTAL}} chunks of the same database schema. Merge them into ONE coherent
result for the whole schema:
- Merge groups that clearly describe the same domain; keep total groups between 3 and 7.
- Every table in the full table list must appear in exactly one group.
- Re-rank dashboards; keep at most 6; merge duplicates covering the same domain.
- Keep the output schema identical to the partial inputs; same locale keys; same
  output rules (single JSON object, no prose, schema_version first).

Full table list: {{ALL_TABLE_NAMES_JSON}}
Partial proposals: {{PARTIAL_GROUPS_AND_DASHBOARDS_JSON}}`;

/** The merge prompt as a pair (system reused verbatim from v1). */
export const PROMPT_MERGE_V1 = {
  version: PROMPT_VERSION,
  system: PROMPT_V1_SYSTEM,
  user: PROMPT_MERGE_V1_USER,
} as const;

/** Tokens the merge template exposes for `response/merge.ts` to fill. */
export const PROMPT_MERGE_V1_TOKENS = [
  '{{TOTAL}}',
  '{{ALL_TABLE_NAMES_JSON}}',
  '{{PARTIAL_GROUPS_AND_DASHBOARDS_JSON}}',
] as const;
