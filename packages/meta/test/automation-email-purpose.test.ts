// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A rule's e-mail to the record's own address says its kind of mail and, for
 * marketing mail, why it writes ("Why you're writing"): the purpose is one of
 * the consent log's own, and is said of marketing mail only.
 */
import { describe, expect, it } from 'vitest';

import { automationActionSchema, CONSENT_PURPOSES } from '../src/index.js';

const step = (more: Record<string, unknown>) => ({ kind: 'email', templateKey: 'news', to: { kind: 'field', column: 'email' }, ...more });

describe('an e-mail step\'s kind of mail and its purpose', () => {
  it('takes exactly the consent log\'s purposes', () => {
    for (const purpose of CONSENT_PURPOSES) expect(automationActionSchema.safeParse(step({ class: 'marketing', purpose })).success).toBe(true);
    expect(automationActionSchema.safeParse(step({ class: 'marketing', purpose: 'offers' })).success).toBe(false);
  });

  it('refuses a purpose on service mail, or on a mail that says no kind', () => {
    expect(automationActionSchema.safeParse(step({ class: 'service', purpose: 'newsletter' })).success).toBe(false);
    expect(automationActionSchema.safeParse(step({ purpose: 'surveys' })).success).toBe(false);
  });

  it('keeps a step written before either could be said as it was', () => {
    const parsed = automationActionSchema.parse(step({}));
    expect(parsed).not.toHaveProperty('class');
    expect(parsed).not.toHaveProperty('purpose');
    expect(automationActionSchema.parse(step({ class: 'marketing', purpose: 'surveys' }))).toMatchObject({ class: 'marketing', purpose: 'surveys' });
  });
});
