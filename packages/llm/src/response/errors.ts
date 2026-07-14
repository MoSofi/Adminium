/**
 * Validation error model shared by the whole response pipeline
 * (06-llm-assist.md §7.2). Every stage — extract, parse, version, Zod, locale,
 * referential, run-binding — reports through the ONE {@link LlmValidationError}
 * shape so the paste UI and the CLI `--dry-run` can render a single precise
 * per-path list (§7.2).
 *
 * Two axes matter downstream:
 *  - `code` — the machine code (§7.2/§7.3 tables), rendered verbatim.
 *  - `severity` — how the pipeline reacts:
 *      • `fatal`   → rejects the whole run (stays `awaiting_response` / `failed`).
 *      • `item`    → drops only the offending suggestion; the rest applies
 *                    (acceptance criterion 4 — a hallucinated table must not
 *                    discard 200 good labels).
 *      • `warning` → nothing dropped; surfaced as information (icon fallback,
 *                    run-id mismatch).
 *
 * This module is pure data + string formatting: no Zod, no engine, no I/O — so
 * it is safe for `@adminium/dashboard` (browser) to pull transitively.
 */

/** Every code the pipeline can emit (§7.2 stages + §7.3 referential list). */
export const LLM_VALIDATION_CODES = [
  // Stage 1–4 — fatal (reject the run)
  'LLM_JSON_PARSE',
  'LLM_TRUNCATED',
  'LLM_VERSION_MISMATCH',
  'LLM_MODEL_DECLINED',
  'LLM_SCHEMA_INVALID',
  // Stage 5 — per-item
  'LLM_LOCALE_KEYS',
  // Stage 6 — referential, per-item (§7.3)
  'LLM_UNKNOWN_TABLE',
  'LLM_UNKNOWN_COLUMN',
  'LLM_BAD_DISPLAY_COLUMN',
  'LLM_NOT_AN_ENUM',
  'LLM_ENUM_VALUES',
  'LLM_UNKNOWN_RELATION',
  'LLM_RELATION_INVALID',
  'LLM_UNKNOWN_TEMPLATE',
  'LLM_UNKNOWN_WIDGET',
  'LLM_WIDGET_BINDING',
  'LLM_GROUP_INVALID',
  // Warnings — nothing dropped
  'LLM_UNKNOWN_ICON',
  'LLM_RUN_MISMATCH',
] as const;

export type LlmValidationCode = (typeof LLM_VALIDATION_CODES)[number];

export type LlmValidationSeverity = 'fatal' | 'item' | 'warning';

/**
 * One validation failure. `path` is a JSON path into the response
 * (`tables[3].table`, `dashboards[0].widgets[5].metricColumn`, `schema_version`,
 * or `''` for the whole document) so the UI can point at the exact field.
 * `message` is a human sentence rendered verbatim (§7.2).
 */
export interface LlmValidationError {
  code: LlmValidationCode;
  severity: LlmValidationSeverity;
  /** JSON path into the response; `''` = the whole document. */
  path: string;
  message: string;
  /** Extra remediation line (e.g. the §4.3 regeneration hint). */
  hint?: string;
  /** Stable §8.1 suggestion id of the dropped suggestion, when one applies. */
  suggestionId?: string;
}

const FATAL_CODES = new Set<LlmValidationCode>([
  'LLM_JSON_PARSE',
  'LLM_TRUNCATED',
  'LLM_VERSION_MISMATCH',
  'LLM_MODEL_DECLINED',
  'LLM_SCHEMA_INVALID',
]);

const WARNING_CODES = new Set<LlmValidationCode>(['LLM_UNKNOWN_ICON', 'LLM_RUN_MISMATCH']);

/** The fixed severity of a code (§7.2 "Failure class" column). */
export function severityOf(code: LlmValidationCode): LlmValidationSeverity {
  if (FATAL_CODES.has(code)) return 'fatal';
  if (WARNING_CODES.has(code)) return 'warning';
  return 'item';
}

export function isFatal(error: LlmValidationError): boolean {
  return error.severity === 'fatal';
}

/**
 * Render a Zod (or hand-built) path array as the pipeline's JSON-path string.
 * Numeric segments become `[n]`; string segments join with `.`; the first
 * segment carries no leading dot (`tables[3].table`, not `.tables[3].table`).
 */
export function formatJsonPath(segments: ReadonlyArray<string | number | symbol>): string {
  let out = '';
  for (const seg of segments) {
    if (typeof seg === 'number') {
      out += `[${seg}]`;
      continue;
    }
    const key = typeof seg === 'symbol' ? (seg.description ?? seg.toString()) : seg;
    out += out === '' ? key : `.${key}`;
  }
  return out;
}

/**
 * Build a validation error, stamping the code's fixed severity. `hint` /
 * `suggestionId` are set only when provided (respects
 * `exactOptionalPropertyTypes`).
 */
export function makeError(
  code: LlmValidationCode,
  path: string,
  message: string,
  extra?: { hint?: string; suggestionId?: string },
): LlmValidationError {
  const error: LlmValidationError = {
    code,
    severity: severityOf(code),
    path,
    message,
  };
  if (extra?.hint !== undefined) error.hint = extra.hint;
  if (extra?.suggestionId !== undefined) error.suggestionId = extra.suggestionId;
  return error;
}
