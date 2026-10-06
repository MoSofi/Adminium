// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A refused value as a sentence: every code the server or the form can give
 * has one, and the two that say something a person can act on — text that
 * may hold no address, a link to a row that is gone — are not folded into
 * the general "not valid here".
 */
import { describe, expect, it } from 'vitest';

import { FIELD_ISSUE_CODES, fieldIssueMessage, isFieldIssueCode } from './field-issues.js';

const t = (_key: string, fallback: string, args?: Record<string, unknown>) => fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(args?.[name] ?? ''));

describe('a refused value, as a sentence', () => {
  it('every code has a sentence, and a code this build does not know reads as the general one', () => {
    for (const code of FIELD_ISSUE_CODES) expect(fieldIssueMessage(t, { code, n: 3 }).length, code).toBeGreaterThan(0);
    expect(fieldIssueMessage(t, { code: 'too_wibbly' })).toBe(fieldIssueMessage(t, { code: 'invalid' }));
    expect(isFieldIssueCode('plain-text')).toBe(true);
    expect(isFieldIssueCode('not-found')).toBe(true);
    expect(isFieldIssueCode('too_wibbly')).toBe(false);
  });

  it('text held to a name or a note, and a link to a row that is gone, say what to do', () => {
    const general = fieldIssueMessage(t, { code: 'invalid' });
    expect(fieldIssueMessage(t, { code: 'plain-text' })).toBe('Use letters, spaces and ordinary punctuation only: no web or email address.');
    expect(fieldIssueMessage(t, { code: 'not-found' })).toBe('This is no longer there. Choose another.');
    expect(fieldIssueMessage(t, { code: 'plain-text' })).not.toBe(general);
    expect(fieldIssueMessage(t, { code: 'not-found' })).not.toBe(general);
  });
});
