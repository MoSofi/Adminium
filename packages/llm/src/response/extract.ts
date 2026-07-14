/**
 * Stage 1 — tolerant JSON extraction (06-llm-assist.md §7.2).
 *
 * Models wrap the single JSON object the prompt demands (§5 output rule 1) in
 * things it did not ask for: a ```` ```json ```` fence, a "Here's the JSON:"
 * preamble, a "Hope this helps!" epilogue. This recovers the object without a
 * JSON parser: find the first `{`, then walk to the brace that closes it while
 * ignoring braces inside strings. Everything before the first `{` and after its
 * matching `}` — fences, prose — is discarded.
 *
 * The walk doubles as a truncation detector: if the opening brace never closes
 * (or a string never terminates), the response was cut off mid-object, which is
 * a distinct `LLM_TRUNCATED` failure (the direct-path runner retries it with a
 * raised token ceiling before counting a repair attempt — §7.5).
 *
 * Pure string scanning: no `JSON.parse` here (that is stage 2), so a
 * brace-balanced but otherwise malformed object (trailing comma, single quotes)
 * is returned for stage 2 to reject as `LLM_JSON_PARSE`.
 */
import { type LlmValidationError, makeError } from './errors.js';

export interface ExtractSuccess {
  ok: true;
  /** The recovered `{ … }` substring; hand this to `JSON.parse` (stage 2). */
  json: string;
}

export interface ExtractFailure {
  ok: false;
  error: LlmValidationError;
}

export type ExtractResult = ExtractSuccess | ExtractFailure;

/**
 * Recover the single top-level JSON object from a raw model reply. Strips a
 * wrapping code fence and any leading/trailing prose; reports `LLM_JSON_PARSE`
 * when there is no object at all and `LLM_TRUNCATED` when one starts but never
 * closes.
 */
export function extractJsonObject(raw: string): ExtractResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fail('LLM_JSON_PARSE', 'The response was empty; expected a single JSON object.');
  }

  const start = trimmed.indexOf('{');
  if (start === -1) {
    return fail(
      'LLM_JSON_PARSE',
      'No JSON object was found in the response (no opening "{"). Expected a single JSON object.',
    );
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) {
    return fail(
      'LLM_TRUNCATED',
      'The JSON object is unbalanced — an opening brace is never closed, so the response was likely truncated. Regenerate with a higher output-token limit.',
    );
  }

  return { ok: true, json: trimmed.slice(start, end + 1) };
}

function fail(code: 'LLM_JSON_PARSE' | 'LLM_TRUNCATED', message: string): ExtractFailure {
  return { ok: false, error: makeError(code, '', message) };
}
