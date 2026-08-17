// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `buildPrompt(input, opts)` — the ONLY producer of prompt text (06-llm-assist.md
 * §1 invariant 1, §4, §5).
 *
 * It renders the verbatim {@link PROMPT_V1} templates into a
 * {@link PromptArtifact}: the direct path sends `system`/`user` as separate
 * messages; the BYO path copies `byo`, the two flattened between
 * `=== SYSTEM ===` / `=== USER ===` dividers. The content between the dividers is
 * byte-identical to `system` + `user` (acceptance criterion 1).
 *
 * Responsibilities:
 *  - section toggles (§4.4): drop deselected numbered decision blocks, keeping
 *    the original numbering so the template's "decision N" cross-references stay
 *    valid;
 *  - locale injection (§5.2): the requested OUTPUT locales are injected as data;
 *    the prompt TEXT itself is always English (Open decision 3);
 *  - allow-list bounds (§5 builder notes): the injected page-template / widget
 *    vocabularies come from `opts.allowed`;
 *  - sample-free serialization by default (§4.2), delegated to `serializer.ts`.
 *
 * Determinism: pure string assembly, no `Date.now`/`Math.random`; string-literal
 * token replacement uses function replacers so a `$` in injected JSON is never
 * interpreted as a replacement pattern.
 */
import { serializeSampling, serializeSchemaIr, serializeStats, toPromptJson } from './serializer.js';
import { PROMPT_V1_SYSTEM, PROMPT_V1_USER } from './templates/v1.js';
import { estimateTokens } from './token-estimate.js';
import {
  ALL_SECTIONS,
  DEFAULT_TOKEN_BUDGET,
  REQUESTED_SECTIONS,
  SECTION_DECISION_NUMBER,
  type BuildPromptOptions,
  type PromptArtifact,
  type PromptChunk,
  type PromptChunkInfo,
  type PromptInput,
  type RequestedSection,
} from './types.js';

/** BYO flattening dividers (§1 invariant 1, §5). */
export const BYO_SYSTEM_MARKER = '=== SYSTEM ===';
export const BYO_USER_MARKER = '=== USER ===';

/**
 * Flatten a system/user pair into the single copyable BYO document. The bytes
 * between the markers equal `system` and `user` exactly, so a response produced
 * from this document is indistinguishable from a direct-path response.
 */
export function flattenByo(system: string, user: string): string {
  return `${BYO_SYSTEM_MARKER}\n${system}\n\n${BYO_USER_MARKER}\n${user}`;
}

/** Build the enrichment prompt for one (possibly chunked) input. */
export function buildPrompt(input: PromptInput, options: BuildPromptOptions): PromptArtifact {
  requireEnUs(input.locales);

  const sections = normalizeSections(input.sections);
  const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

  const system = PROMPT_V1_SYSTEM;
  const user = renderUserSection(input, options, sections);

  const byo = flattenByo(system, user);
  const tokenEstimate = estimateTokens(byo);
  const overBudget = estimateTokens(user) > tokenBudget;

  const chunk: PromptChunk = {
    index: input.chunk?.index ?? 1,
    total: input.chunk?.total ?? 1,
    system,
    user,
    byo,
    tokenEstimate,
  };

  return { system, user, byo, chunks: [chunk], tokenEstimate, overBudget, sections };
}

// ─── Section normalization + block removal (§4.4) ────────────────────────────

/** Dedupe + canonically order the requested sections; empty ⇒ all (§4.4). */
export function normalizeSections(
  requested: readonly RequestedSection[],
): readonly RequestedSection[] {
  const set = new Set(requested);
  const ordered = REQUESTED_SECTIONS.filter((section) => set.has(section));
  return ordered.length > 0 ? ordered : ALL_SECTIONS;
}

const DECISIONS_START = '{{REQUESTED_SECTIONS_LIST}}\n\n';
const DECISIONS_END = '\n\n=== TRIGGER TAXONOMY (for decision 6) ===';

interface DecisionBlock {
  num: number;
  text: string;
}

/**
 * Apply the section toggles to the user template (§4.4): remove BOTH the numbered
 * decision blocks AND the embedded response-schema keys of deselected sections
 * (per the §5 builder note "the builder deletes the numbered instruction blocks
 * (and schema keys) of deselected sections"). Kept decision blocks retain their
 * original numbers (gaps are fine) so the template's "for decision 6" / "Skip
 * decisions 2 and 7" references stay valid. With all sections active the template
 * is returned unchanged (verbatim — acceptance criterion 2).
 */
export function applySectionToggles(
  template: string,
  sections: readonly RequestedSection[],
): string {
  if (sections.length === REQUESTED_SECTIONS.length) return template;

  const startIndex = template.indexOf(DECISIONS_START);
  const endIndex = template.indexOf(DECISIONS_END);
  if (startIndex < 0 || endIndex < 0) return template;

  const bodyStart = startIndex + DECISIONS_START.length;
  const body = template.slice(bodyStart, endIndex);

  const activeNumbers = new Set(sections.map((section) => SECTION_DECISION_NUMBER[section]));
  const kept = splitDecisionBlocks(body)
    .filter((block) => activeNumbers.has(block.num))
    .map((block) => block.text)
    .join('\n\n');

  const withDecisions = template.slice(0, bodyStart) + kept + template.slice(endIndex);
  return pruneResponseSchema(withDecisions, new Set(sections));
}

// ─── Response-schema key removal (§4.4, §5 builder note) ──────────────────────

/** Anchors bounding the embedded `=== RESPONSE SCHEMA … ===` object notation. */
const SCHEMA_OBJECT_START = '{\n  schema_version: "adminium.llm/v1",';
const SCHEMA_OBJECT_END = '\n\n=== INPUT: DATABASE SCHEMA ===';

/**
 * Whole-line splice: drop every line from the one containing `startAnchor`
 * through the one containing `endAnchor` (searched AFTER the start), replacing the
 * span with `replacement`. Anchor-based (not whitespace-hardcoded) so it tracks
 * the verbatim template even if its indentation is later re-flowed. A missing
 * anchor is a no-op — the schema stays intact rather than being corrupted.
 */
function spliceLines(block: string, startAnchor: string, endAnchor: string, replacement: string): string {
  const s = block.indexOf(startAnchor);
  if (s < 0) return block;
  const e = block.indexOf(endAnchor, s);
  if (e < 0) return block;
  const lineStart = block.lastIndexOf('\n', s) + 1;
  const afterEnd = block.indexOf('\n', e + endAnchor.length);
  const lineEnd = afterEnd < 0 ? block.length : afterEnd + 1;
  return block.slice(0, lineStart) + replacement + block.slice(lineEnd);
}

function cutLines(block: string, startAnchor: string, endAnchor: string): string {
  return spliceLines(block, startAnchor, endAnchor, '');
}

/** Leading whitespace of the line containing `anchor` (for indent-preserving splices). */
function indentOf(block: string, anchor: string): string {
  const i = block.indexOf(anchor);
  if (i < 0) return '';
  return block.slice(block.lastIndexOf('\n', i) + 1, i);
}

/**
 * Single-section schema-key removals keyed by the section deselected. Each entry
 * is a `[startAnchor, endAnchor]` pair identifying the line span to delete.
 * `groups`, `widgets` and the nav-group icon are handled separately below because
 * they share the `navGroups` / `dashboards` structures.
 */
const SCHEMA_KEY_CUTS: Partial<Record<RequestedSection, ReadonlyArray<readonly [string, string]>>> = {
  labels: [
    ['label: L10n, description: L10n,', 'label: L10n, description: L10n,'],
    ['label: L10n, description?: L10n,', 'label: L10n, description?: L10n,'],
  ],
  keys: [
    ['displayColumn: string | null,', 'displayColumn: string | null,'],
    ['naturalKey: string[] | null,', 'naturalKey: string[] | null,'],
  ],
  templates: [['pageTemplates: [{', 'confidence: number }],']],
  microcopy: [['microcopy: {', 'pageSubtitle: L10n }']],
  pii: [['pii: null | {', 'confidence: number }']],
  enums: [['enums: [{', 'confidence: number }],']],
  relations: [['relations: {', '  },']],
  icons: [['// lucide kebab-case', '// lucide kebab-case']],
};

/**
 * Remove the response-schema keys of deselected sections from the embedded
 * RESPONSE SCHEMA block (§4.4: deselected keys are "omitted from … the embedded
 * response schema"), so a scoped run's schema reflects only the requested
 * decisions and the model does not emit — and pay output tokens for — keys the
 * run neither asked for nor validates.
 */
function pruneResponseSchema(template: string, active: ReadonlySet<RequestedSection>): string {
  const startIdx = template.indexOf(SCHEMA_OBJECT_START);
  const endIdx = template.indexOf(SCHEMA_OBJECT_END);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) return template;

  let block = template.slice(startIdx, endIdx);

  // Single-section, self-contained key spans.
  for (const [section, cuts] of Object.entries(SCHEMA_KEY_CUTS) as [
    RequestedSection,
    ReadonlyArray<readonly [string, string]>,
  ][]) {
    if (active.has(section)) continue;
    for (const [start, end] of cuts) block = cutLines(block, start, end);
  }

  // navGroups (owned by `groups`) + dashboards (`groups` → domain, `widgets` →
  // widgets) share structure, so resolve them together — BEFORE the nav-group
  // icon strip, which expects the navGroups line to still exist.
  const groupsOff = !active.has('groups');
  const widgetsOff = !active.has('widgets');
  if (groupsOff) {
    block = cutLines(block, 'navGroups: [{', 'tables: string[], confidence: number }],');
  }
  if (groupsOff && widgetsOff) {
    block = cutLines(block, 'dashboards: [{', 'confidence: number }] }],');
  } else if (groupsOff) {
    block = block.split('domain: string, ').join(''); // dashboards kept for its widgets
  } else if (widgetsOff) {
    // The dashboards `tables: string[],` is the only one directly followed by a
    // newline (the navGroups one is `tables: string[], confidence …`), so the
    // trailing `\n` disambiguates it. Remove the widgets sub-block and drop the
    // now-dangling comma so the dashboards object still closes.
    const anchor = 'tables: string[],\n';
    const indent = indentOf(block, anchor);
    block = spliceLines(block, anchor, 'confidence: number }] }],', `${indent}tables: string[] }],\n`);
  }

  // navGroups icon (owned by `icons`) — only when navGroups is still present.
  if (!active.has('icons') && !groupsOff) {
    block = block
      .split('label: L10n, icon: string, order: number,')
      .join('label: L10n, order: number,');
  }

  return template.slice(0, startIdx) + block + template.slice(endIdx);
}

/**
 * Split the decisions body into numbered blocks. A segment beginning `N.` starts
 * a new block; any following non-numbered segment (defensive — the verbatim
 * template has none) reattaches to the current block so an internal blank line
 * would survive intact.
 */
function splitDecisionBlocks(body: string): DecisionBlock[] {
  const blocks: DecisionBlock[] = [];
  for (const segment of body.split('\n\n')) {
    const match = /^(\d+)\./.exec(segment);
    if (match?.[1] !== undefined) {
      blocks.push({ num: Number(match[1]), text: segment });
      continue;
    }
    const last = blocks.at(-1);
    if (last !== undefined) last.text = `${last.text}\n\n${segment}`;
  }
  return blocks;
}

// ─── User-section rendering ──────────────────────────────────────────────────

function renderUserSection(
  input: PromptInput,
  options: BuildPromptOptions,
  sections: readonly RequestedSection[],
): string {
  const stubTables = new Set(input.chunk?.stubTables ?? []);
  const schemaIr = serializeSchemaIr(input.schemaIr, { stubTables, stats: input.stats });
  const statsJson = serializeStats(input.stats, { defaultSchema: input.schemaIr.defaultSchema });
  const samplingBlock = serializeSampling(input.schemaIr, input.stats, input.sampling);
  const chunkInfo = renderChunkInfo(input.chunk);

  let user = applySectionToggles(PROMPT_V1_USER, sections);

  user = replaceOnce(user, '{{RUN_ID}}', input.runId);
  user = chunkInfo === '' ? user.replace('{{CHUNK_INFO}}\n', '') : replaceOnce(user, '{{CHUNK_INFO}}', chunkInfo);
  user = replaceOnce(user, '{{REQUESTED_SECTIONS_LIST}}', `Requested: ${sections.join(', ')}`);
  user = replaceOnce(user, '{{ALLOWED_PAGE_TEMPLATE_IDS_JSON}}', toPromptJson(options.allowed.templates));
  user = replaceOnce(user, '{{ALLOWED_WIDGET_IDS_JSON}}', toPromptJson(options.allowed.widgets));
  user = replaceOnce(user, '{{LOCALES_JSON}}', toPromptJson(input.locales));
  user = replaceOnce(user, '{{SCHEMA_IR_JSON}}', toPromptJson(schemaIr));
  user = replaceOnce(user, '{{STATS_JSON}}', toPromptJson(statsJson));
  user = replaceOnce(user, '{{SAMPLING_BLOCK}}', samplingBlock);

  return user;
}

/**
 * Replace the first (and only) occurrence of `token` with a literal value. A
 * function replacer is used so `$`-sequences inside injected JSON (`$&`, `$1`, …)
 * are never interpreted as replacement patterns.
 */
function replaceOnce(text: string, token: string, value: string): string {
  return text.replace(token, () => value);
}

/** The `{{CHUNK_INFO}}` sentence for a chunked run; empty otherwise (§4.5, §5.2). */
export function renderChunkInfo(chunk: PromptChunkInfo | undefined): string {
  if (chunk === undefined) return '';
  return (
    `This is chunk ${chunk.index} of ${chunk.total} of a larger schema. ` +
    `Tables marked "stub": true belong to other chunks — use them as relation ` +
    `context only. Skip decisions 2 and 7 unless this is chunk 1; a separate ` +
    `merge step consolidates them.`
  );
}

// ─── Guards ──────────────────────────────────────────────────────────────────

function requireEnUs(locales: readonly string[]): void {
  if (!locales.includes('en_US')) {
    throw new Error('buildPrompt: locales must include "en_US" (06-llm-assist.md §4.1).');
  }
}
