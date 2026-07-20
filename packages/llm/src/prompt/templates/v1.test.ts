/**
 * PROMPT_V1 verbatim pin (06-llm-assist.md §5, acceptance criterion 2).
 *
 * The system + user templates are a SHIP-VERBATIM artifact. This test pins them
 * with a SHA-256 that also folds in {@link PROMPT_VERSION}: editing the template
 * text OR bumping the version changes the digest and fails this test, forcing a
 * conscious update here — and, by the criterion, a `PROMPT_VERSION` bump whenever
 * the wording changes.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { PROMPT_VERSION } from '../../response/schema.js';
import {
  PROMPT_MERGE_V1_USER,
  PROMPT_V1,
  PROMPT_V1_SYSTEM,
  PROMPT_V1_USER,
} from './v1.js';

/** Fold version + both sections into one digest so any change to either fails. */
function promptDigest(): string {
  return createHash('sha256')
    .update(PROMPT_VERSION)
    .update('\x00')
    .update(PROMPT_V1_SYSTEM)
    .update('\x00')
    .update(PROMPT_V1_USER)
    .digest('hex');
}

describe('PROMPT_V1 — verbatim pin (§5)', () => {
  it('pins the exact system + user template text against PROMPT_VERSION', () => {
    // If this fails, the ship-verbatim prompt text (or PROMPT_VERSION) changed.
    // Update the digest ONLY together with a PROMPT_VERSION bump (criterion 2).
    expect(promptDigest()).toBe(
      '2fd2306fdb72654e7324d1e6ac566fa0480484ef6d7f92d6448f20c1ad41b211',
    );
  });

  it('the version pinned into the digest is the prompt-contract v1.1 id', () => {
    // v1 → v1.1: page-builder taxonomy row removed (not in LLM_ALLOWED_TEMPLATES).
    expect(PROMPT_VERSION).toBe('adminium.prompt/v1.1');
  });

  it('system section is fixed policy text with no tokens', () => {
    expect(PROMPT_V1_SYSTEM.startsWith('You are a senior data architect')).toBe(true);
    expect(PROMPT_V1_SYSTEM).not.toContain('{{');
    expect(PROMPT_V1_SYSTEM).toContain('OUTPUT RULES — STRICT');
  });

  it('user section opens with CONTEXT and carries the fill tokens', () => {
    expect(PROMPT_V1_USER.startsWith('=== CONTEXT ===')).toBe(true);
    for (const token of [
      '{{RUN_ID}}',
      '{{CHUNK_INFO}}',
      '{{REQUESTED_SECTIONS_LIST}}',
      '{{ALLOWED_PAGE_TEMPLATE_IDS_JSON}}',
      '{{ALLOWED_WIDGET_IDS_JSON}}',
      '{{LOCALES_JSON}}',
      '{{SCHEMA_IR_JSON}}',
      '{{STATS_JSON}}',
      '{{SAMPLING_BLOCK}}',
    ]) {
      expect(PROMPT_V1_USER).toContain(token);
    }
  });

  it('user section keeps all ten numbered decision blocks', () => {
    for (const header of [
      '1. LABELS & DESCRIPTIONS',
      '2. DOMAIN GROUPING',
      '3. ENUM SEMANTICS',
      '4. RELATIONS',
      '5. KEY COLUMNS',
      '6. PAGE TEMPLATES',
      '7. DASHBOARD WIDGETS',
      '8. PII & MASKING',
      '9. ICONS',
      '10. MICRO-COPY',
    ]) {
      expect(PROMPT_V1_USER).toContain(header);
    }
  });

  it('trigger taxonomy only describes recommendable templates (no page-builder row)', () => {
    // page-builder is a non-recommendable tool surface: it is absent from
    // LLM_ALLOWED_TEMPLATES and referential validation drops any suggestion for
    // it (LLM_UNKNOWN_TEMPLATE). The taxonomy must not invite it; instead the
    // platform-owned disclaimer names it. (v1 → v1.1.)
    expect(PROMPT_V1_USER).not.toContain('| page-builder');
    expect(PROMPT_V1_USER).toContain('settings, wizard, builder, auth');
    // Every taxonomy row is one of the ten recommendable ids the builder injects.
    const rows = [...PROMPT_V1_USER.matchAll(/^\| (page-[a-z-]+?) +\|/gm)].map((m) => m[1]);
    expect(rows.sort()).toEqual([
      'page-board',
      'page-calendar',
      'page-chat',
      'page-dashboard',
      'page-directory',
      'page-files',
      'page-log-viewer',
      'page-master-detail',
      'page-queue-inbox',
      'page-scheduler',
    ]);
  });

  it('PROMPT_V1 bundles the version and both sections', () => {
    expect(PROMPT_V1).toEqual({
      version: PROMPT_VERSION,
      system: PROMPT_V1_SYSTEM,
      user: PROMPT_V1_USER,
    });
  });

  it('the merge template (§4.5) exposes its three tokens', () => {
    for (const token of [
      '{{TOTAL}}',
      '{{ALL_TABLE_NAMES_JSON}}',
      '{{PARTIAL_GROUPS_AND_DASHBOARDS_JSON}}',
    ]) {
      expect(PROMPT_MERGE_V1_USER).toContain(token);
    }
  });
});
