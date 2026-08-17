// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Stage 1 — tolerant JSON extraction (06-llm-assist.md §7.2).
 *
 * Locks: fences and prose are stripped; braces inside strings never close the
 * object early; an unclosed object is `LLM_TRUNCATED`; no object at all is
 * `LLM_JSON_PARSE`. Extraction does NOT parse — a brace-balanced but malformed
 * object is returned for stage 2 to reject.
 */
import { describe, expect, it } from 'vitest';

import { extractJsonObject } from './extract.js';

describe('extractJsonObject', () => {
  it('returns a bare object unchanged', () => {
    const result = extractJsonObject('{"schema_version":"adminium.llm/v1"}');
    expect(result).toEqual({ ok: true, json: '{"schema_version":"adminium.llm/v1"}' });
  });

  it('strips a ```json code fence', () => {
    const raw = '```json\n{"a": 1}\n```';
    const result = extractJsonObject(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.json)).toEqual({ a: 1 });
  });

  it('strips a bare ``` fence with no language tag', () => {
    const result = extractJsonObject('```\n{"a": 1}\n```');
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.json)).toEqual({ a: 1 });
  });

  it('strips leading and trailing prose around the object', () => {
    const raw = 'Sure, here you go:\n{"a": 1, "b": 2}\nHope that helps!';
    const result = extractJsonObject(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.json)).toEqual({ a: 1, b: 2 });
  });

  it('ignores braces that appear inside string values', () => {
    const raw = '{"note": "a } inside a string", "nested": {"c": 1}}';
    const result = extractJsonObject(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.json).toBe(raw);
      expect(JSON.parse(result.json)).toEqual({ note: 'a } inside a string', nested: { c: 1 } });
    }
  });

  it('ignores an escaped quote inside a string', () => {
    const raw = '{"quote": "she said \\"hi\\" }", "ok": true}';
    const result = extractJsonObject(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(JSON.parse(result.json)).toEqual({ quote: 'she said "hi" }', ok: true });
  });

  it('fails LLM_JSON_PARSE on an empty response', () => {
    const result = extractJsonObject('   \n  ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LLM_JSON_PARSE');
  });

  it('fails LLM_JSON_PARSE when there is no object at all', () => {
    const result = extractJsonObject('I could not produce JSON, sorry.');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_JSON_PARSE');
      expect(result.error.severity).toBe('fatal');
    }
  });

  it('fails LLM_TRUNCATED when the object is never closed', () => {
    const result = extractJsonObject('{"schema_version":"adminium.llm/v1","tables":[{"table":');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LLM_TRUNCATED');
  });

  it('fails LLM_TRUNCATED when a string is never terminated', () => {
    const result = extractJsonObject('{"description": "an unterminated value');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LLM_TRUNCATED');
  });

  it('returns a brace-balanced but malformed object for stage 2 to reject', () => {
    // Trailing comma is invalid JSON but the braces balance — extraction succeeds,
    // JSON.parse (stage 2) is what rejects it.
    const result = extractJsonObject('{"tables": [ , ]}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(() => JSON.parse(result.json)).toThrow();
  });
});
