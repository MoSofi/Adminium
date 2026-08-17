// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The staged validation pipeline (06-llm-assist.md §7.2).
 *
 *   1 extract   → recover the JSON object (fences/prose stripped, truncation
 *                 detected)                                     — fatal
 *   2 parse     → `JSON.parse`                                  — fatal
 *   3 version   → `schema_version` supported; model-declared `error` key
 *                                                               — fatal
 *   4 zod       → `LlmResponseV1.safeParse`, issues mapped to paths — fatal
 *   5 locale    → every localized object has exactly the run's locales — per-item
 *   6 referential → §7.3 cross-checks vs the snapshot + registries — per-item
 *   7 run-bind  → `run_id` present and ≠ ctx.runId                — warning
 *
 * Fatal errors reject the whole run (`response` is absent). Per-item errors drop
 * only the offending suggestion (and its dependents) and let the rest through —
 * `response` is the cleaned result. Warnings drop nothing.
 *
 * Browser-safe: only Zod + type-only engine imports flow through here.
 */
import { extractJsonObject } from './extract.js';
import { formatJsonPath, type LlmValidationError, makeError } from './errors.js';
import {
  applyPrunes,
  createPrunes,
  mergePrunes,
  type ReferentialContext,
  type ResponsePrunes,
  runReferentialChecks,
} from './referential.js';
import { LlmResponseV1, negotiateSchemaVersion } from './schema.js';

/**
 * Everything {@link validateResponse} needs: the referential context (snapshot,
 * locales, registry allow-lists) plus the stage-3 supported-version list and the
 * stage-7 expected run id.
 */
export interface ValidationContext extends ReferentialContext {
  /** Expected run id (the ULID embedded in the prompt). Enables the §7.2 stage-7 warning. */
  runId?: string;
  /** Override for `SUPPORTED_SCHEMA_VERSIONS` (testable forward-compat, §4.3). */
  supportedVersions?: readonly string[];
}

export interface ValidationResult {
  /** The cleaned, validated response — absent iff a fatal error stopped the run. */
  response?: LlmResponseV1;
  /** Fatal + per-item errors, most-actionable first within each stage. */
  errors: LlmValidationError[];
  /** Non-blocking notices (icon fallback, run-id mismatch). */
  warnings: LlmValidationError[];
}

/**
 * Validate a raw model reply against the run's snapshot and registries. Runs the
 * full §7.2 pipeline; returns the cleaned response plus every error/warning with
 * a precise JSON path. Never throws.
 */
export function validateResponse(rawText: string, ctx: ValidationContext): ValidationResult {
  const warnings: LlmValidationError[] = [];

  // ── Stage 1 — extract ──────────────────────────────────────────────────────
  const extracted = extractJsonObject(rawText);
  if (!extracted.ok) return { errors: [extracted.error], warnings };

  // ── Stage 2 — parse ────────────────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.json);
  } catch (error) {
    return {
      errors: [makeError('LLM_JSON_PARSE', '', `The response is not valid JSON: ${messageOf(error)}`)],
      warnings,
    };
  }

  const record =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};

  // ── Stage 3 — version + model-declared error ───────────────────────────────
  const negotiation = negotiateSchemaVersion(record.schema_version, ctx.supportedVersions);
  if (!negotiation.ok) {
    return {
      errors: [
        makeError('LLM_VERSION_MISMATCH', 'schema_version', negotiation.message, {
          hint: negotiation.hint,
        }),
      ],
      warnings,
    };
  }
  if (typeof record.error === 'string' && record.error.length > 0) {
    return {
      errors: [
        makeError(
          'LLM_MODEL_DECLINED',
          'error',
          `The model declined to produce enrichment: ${record.error}`,
        ),
      ],
      warnings,
    };
  }

  // ── Stage 4 — Zod ──────────────────────────────────────────────────────────
  const zod = LlmResponseV1.safeParse(parsed);
  if (!zod.success) {
    const errors = zod.error.issues.map((issue) =>
      makeError('LLM_SCHEMA_INVALID', formatJsonPath(issue.path), issue.message),
    );
    return { errors, warnings };
  }
  const response = zod.data;

  // ── Stage 5 — locale keys (per-item) ───────────────────────────────────────
  const locale = checkLocales(response, ctx.locales);

  // ── Stage 6 — referential (per-item) ───────────────────────────────────────
  const referential = runReferentialChecks(response, ctx);
  warnings.push(...referential.warnings);

  const errors = [...locale.errors, ...referential.errors];
  const cleaned = applyPrunes(response, mergePrunes(locale.prunes, referential.prunes));

  // ── Stage 7 — run binding (warning) ────────────────────────────────────────
  if (
    ctx.runId !== undefined &&
    typeof cleaned.run_id === 'string' &&
    cleaned.run_id !== ctx.runId
  ) {
    warnings.push(
      makeError(
        'LLM_RUN_MISMATCH',
        'run_id',
        'This response looks like it was generated from a different prompt export.',
      ),
    );
  }

  return { response: cleaned, errors, warnings };
}

/* ------------------------------------------------------ stage 5: locale keys */

interface LocaleResult {
  errors: LlmValidationError[];
  prunes: ResponsePrunes;
}

function localeKeysMatch(
  obj: Readonly<Record<string, string | undefined>> | undefined,
  expected: ReadonlySet<string>,
): boolean {
  if (obj === undefined) return true;
  const keys = Object.keys(obj);
  if (keys.length !== expected.size) return false;
  return keys.every((key) => expected.has(key));
}

function checkLocales(response: LlmResponseV1, locales: readonly string[]): LocaleResult {
  const expected = new Set(locales);
  const errors: LlmValidationError[] = [];
  const prunes = createPrunes();

  const localeMessage = (
    obj: Readonly<Record<string, string | undefined>>,
  ): string => {
    const found = Object.keys(obj);
    return `Localized text must use exactly the requested locales [${[...expected].join(', ')}]; found [${found.join(', ')}]. The suggestion was discarded.`;
  };

  response.tables.forEach((table, i) => {
    if (!localeKeysMatch(table.label, expected)) {
      errors.push(makeError('LLM_LOCALE_KEYS', `tables[${i}].label`, localeMessage(table.label)));
      prunes.tables.add(i);
      return;
    }
    if (!localeKeysMatch(table.description, expected)) {
      errors.push(
        makeError('LLM_LOCALE_KEYS', `tables[${i}].description`, localeMessage(table.description)),
      );
      prunes.tables.add(i);
      return;
    }

    table.columns.forEach((column, j) => {
      if (!localeKeysMatch(column.label, expected)) {
        errors.push(
          makeError(
            'LLM_LOCALE_KEYS',
            `tables[${i}].columns[${j}].label`,
            localeMessage(column.label),
          ),
        );
        addColumnDrop(prunes, i, j);
        return;
      }
      if (column.description !== undefined && !localeKeysMatch(column.description, expected)) {
        errors.push(
          makeError(
            'LLM_LOCALE_KEYS',
            `tables[${i}].columns[${j}].description`,
            localeMessage(column.description),
          ),
        );
        addColumnDrop(prunes, i, j);
      }
    });

    const microcopy = table.microcopy;
    if (microcopy) {
      const micro: ReadonlyArray<[Readonly<Record<string, string | undefined>>, string]> = [
        [microcopy.emptyState.headline, `tables[${i}].microcopy.emptyState.headline`],
        [microcopy.emptyState.guidance, `tables[${i}].microcopy.emptyState.guidance`],
        [microcopy.pageSubtitle, `tables[${i}].microcopy.pageSubtitle`],
      ];
      for (const [obj, path] of micro) {
        if (!localeKeysMatch(obj, expected)) {
          errors.push(makeError('LLM_LOCALE_KEYS', path, localeMessage(obj)));
          prunes.dropMicrocopy.add(i);
          break;
        }
      }
    }
  });

  response.navGroups.forEach((group, i) => {
    if (!localeKeysMatch(group.label, expected)) {
      errors.push(makeError('LLM_LOCALE_KEYS', `navGroups[${i}].label`, localeMessage(group.label)));
      prunes.navGroups.add(i);
    }
  });

  response.dashboards.forEach((dashboard, i) => {
    if (!localeKeysMatch(dashboard.label, expected)) {
      errors.push(
        makeError('LLM_LOCALE_KEYS', `dashboards[${i}].label`, localeMessage(dashboard.label)),
      );
      prunes.dashboards.add(i);
    }
  });

  return { errors, prunes };
}

function addColumnDrop(prunes: ResponsePrunes, tableIndex: number, columnIndex: number): void {
  const set = prunes.columns.get(tableIndex);
  if (set) set.add(columnIndex);
  else prunes.columns.set(tableIndex, new Set([columnIndex]));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
