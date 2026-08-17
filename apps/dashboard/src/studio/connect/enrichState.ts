// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Enrich-with-AI step — pure state + rules (06-llm-assist.md §10.2, §4.4, §7.5,
 * §9). Kept out of the components so the three-intent state machine, the
 * shared-options toggles (sections/locales/sampling), the per-chunk BYO
 * validation gate, and the §7.5 repair-message formatter are unit-testable
 * without a DOM.
 *
 * The dashboard cannot import `@adminium/llm` (01 §2.3, dependency-cruiser), so
 * the section/locale/sampling vocabularies are the structural mirror already
 * declared in `studio/ai/api.ts`; this module only reshapes them into request
 * inputs and UI-facing option lists.
 */
import { LOCALES as I18N_LOCALES, localeEntry } from '@adminium/i18n';

import { t } from '../../i18n/t.js';
import type { CreateRunInput, LlmLocale, LlmRunMode, LlmSection } from '../ai/api.js';

// --- intents (the three option cards, §10.2 step 1) --------------------------

/**
 * `provider` = run against the configured AI provider (direct path);
 * `byo` = copy a prompt into the user's own tool and paste the JSON back;
 * `skip` = heuristics only (never penalized).
 */
export type EnrichIntent = 'provider' | 'byo' | 'skip';

/** Map an enrichment intent to the run-creation path (§10.5 `POST /runs`). */
export function runModeForIntent(intent: 'provider' | 'byo'): LlmRunMode {
  return intent;
}

// --- sections (§4.4 — ten decision groups, all on by default) ----------------

/** The ten requestable decision groups, in the §4.4 table order. */
export const ENRICH_SECTIONS: readonly LlmSection[] = [
  'labels',
  'groups',
  'enums',
  'relations',
  'keys',
  'templates',
  'widgets',
  'pii',
  'icons',
  'microcopy',
] as const;

export function sectionLabel(section: LlmSection): string {
  switch (section) {
    case 'labels':
      return t('studio.enrich.section.labels', 'Labels & descriptions');
    case 'groups':
      return t('studio.enrich.section.groups', 'Navigation groups');
    case 'enums':
      return t('studio.enrich.section.enums', 'Enum semantics');
    case 'relations':
      return t('studio.enrich.section.relations', 'Relations');
    case 'keys':
      return t('studio.enrich.section.keys', 'Key columns');
    case 'templates':
      return t('studio.enrich.section.templates', 'Page templates');
    case 'widgets':
      return t('studio.enrich.section.widgets', 'Dashboard widgets');
    case 'pii':
      return t('studio.enrich.section.pii', 'PII & masking');
    case 'icons':
      return t('studio.enrich.section.icons', 'Icons');
    case 'microcopy':
      return t('studio.enrich.section.microcopy', 'Micro-copy');
  }
}

/** Toggle a section, preserving the canonical {@link ENRICH_SECTIONS} order. */
export function toggleSection(current: readonly LlmSection[], section: LlmSection): LlmSection[] {
  const set = new Set(current);
  if (set.has(section)) set.delete(section);
  else set.add(section);
  return ENRICH_SECTIONS.filter((candidate) => set.has(candidate));
}

// --- locales (instance-enabled multi-select; en_US locked on, §10.2 step 2) --

/** en_US is always requested — the prompt requires it (§5.1 rule 5). */
export const LOCKED_LOCALE: LlmLocale = 'en_US';

/**
 * Selectable locales, in registry order. The 8 canonical locales the instance
 * supports (`@adminium/i18n`); `en_US` sorts first and is never removable.
 */
export const ENRICH_LOCALES: readonly LlmLocale[] = I18N_LOCALES.map(
  (locale) => locale.id as LlmLocale,
);

/** Native endonym for the locale chip (locale pickers always show native). */
export function localeLabel(locale: LlmLocale): string {
  return localeEntry(locale).native;
}

/**
 * Toggle a locale. `en_US` is locked on (a request without it is invalid), so
 * attempts to remove it are ignored. Output keeps the registry order.
 */
export function toggleLocale(current: readonly LlmLocale[], locale: LlmLocale): LlmLocale[] {
  if (locale === LOCKED_LOCALE) return dedupeInOrder(current);
  const set = new Set(current);
  set.add(LOCKED_LOCALE);
  if (set.has(locale)) set.delete(locale);
  else set.add(locale);
  return ENRICH_LOCALES.filter((candidate) => set.has(candidate));
}

function dedupeInOrder(current: readonly LlmLocale[]): LlmLocale[] {
  const set = new Set(current);
  set.add(LOCKED_LOCALE);
  return ENRICH_LOCALES.filter((candidate) => set.has(candidate));
}

// --- sampling (§4.2 opt-in; PII columns never sampled) -----------------------

/** Default per-column sample cap when the user opts into sampling (§4.2). */
export const SAMPLING_MAX_VALUES = 20;

// --- shared choices ----------------------------------------------------------

export interface EnrichChoices {
  sections: LlmSection[];
  /** Always contains {@link LOCKED_LOCALE}. */
  locales: LlmLocale[];
  sampling: boolean;
}

/** All sections on, en_US only, sample-free — the §4 defaults. */
export function defaultEnrichChoices(): EnrichChoices {
  return { sections: [...ENRICH_SECTIONS], locales: [LOCKED_LOCALE], sampling: false };
}

/**
 * Whether the "Use my AI provider" card can be picked: a provider must be
 * configured (bootstrap `llm.enabled`), there must be a live connection to
 * snapshot — schema-file sources have none (§10.2, GenerateStep parity) — and
 * the deployment must be allowed to make the outbound call at all
 * (11-electron.md §8.2's LLM row, via `/system/info`'s `networkFeaturesAllowed`).
 *
 * `networkAllowed` DEFAULTS TRUE, which is the one default in this file that is
 * not merely convenience: it is the answer for every deployment that has not
 * said otherwise, and it keeps a caller that has not yet heard back from
 * `/system/info` from briefly greying out a card that works.
 */
export function providerCardEnabled(input: {
  providerConfigured: boolean;
  connectionId: string | null;
  sourceIsFile: boolean;
  networkAllowed?: boolean;
}): boolean {
  return (
    input.providerConfigured &&
    input.connectionId !== null &&
    !input.sourceIsFile &&
    (input.networkAllowed ?? true)
  );
}

/** Reshape the shared choices into a `POST /runs` body (§10.5). */
export function toCreateRunInput(
  connectionId: string,
  path: LlmRunMode,
  choices: EnrichChoices,
): CreateRunInput {
  return {
    connectionId,
    path,
    sections: choices.sections,
    locales: choices.locales,
    sampling: choices.sampling ? { maxValuesPerColumn: SAMPLING_MAX_VALUES } : null,
  };
}

// --- BYO per-chunk validation gate (§10.2 step 4) ----------------------------

export type ChunkStatus = 'empty' | 'validating' | 'valid' | 'error';

/** All chunks must validate before the merge step unlocks (§10.2 step 4). */
export function allChunksValid(statuses: readonly ChunkStatus[]): boolean {
  return statuses.length > 0 && statuses.every((status) => status === 'valid');
}

// --- §7.5 repair message ("Copy errors for your AI tool") --------------------

/** One validation failure, projected to what the repair message needs. */
export interface RepairError {
  code: string;
  /** JSON path into the response; `''` = the whole document. */
  path: string;
  message: string;
}

/** Cap on listed errors, matching the direct-path repair turn (§7.5). */
export const REPAIR_ERROR_LIMIT = 20;

/**
 * The verbatim §7.5 repair turn the BYO user pastes back into their own AI
 * tool — the copy-paste analogue of the direct path's automated repair loop.
 */
export function formatRepairMessage(errors: readonly RepairError[]): string {
  const lines = errors.slice(0, REPAIR_ERROR_LIMIT).map((error) => {
    const location = error.path.length > 0 ? error.path : '(root)';
    return `- ${error.code} at ${location}: ${error.message}`;
  });
  return [
    'Your previous response failed machine validation:',
    ...lines,
    'Return the corrected COMPLETE JSON object now. Output rules still apply:',
    'single JSON object, no prose, no fences, schema_version first.',
  ].join('\n');
}

// --- BYO prompt download filename (§10.2 step 4) -----------------------------

/**
 * `adminium-prompt-{runId}.md` unchunked; `…-chunk-1of3.md` when the schema was
 * split (§4.5). `total <= 1` ⇒ unchunked.
 */
export function promptFileName(runId: string, index: number, total: number): string {
  if (total <= 1) return `adminium-prompt-${runId}.md`;
  return `adminium-prompt-${runId}-chunk-${index}of${total}.md`;
}
