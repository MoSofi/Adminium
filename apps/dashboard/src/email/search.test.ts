// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/email-templates` search contract: a link a new campaign starts with
 * is an `https://` address of at most 2048 characters, and anything else
 * falls away rather than failing the route.
 */
import { describe, expect, it } from 'vitest';

import { CAMPAIGN_LINK_MAX, campaignLinkOf, validateEmailTemplatesSearch } from './search.js';

describe('the email templates search', () => {
  it('keeps an https link beside the campaigns tray', () => {
    const link = 'https://forms.meridian.example/x/forms/showroom-visit';
    expect(validateEmailTemplatesSearch({ kind: 'campaign', link })).toEqual({ kind: 'campaign', link });
  });

  it('drops a link that is not an https address, or is too long', () => {
    for (const link of ['http://forms.meridian.example/x/forms/a', 'javascript:alert(1)', 'https://', 'https://exa mple.com/ x', 'forms.meridian.example', '', 42, null, ['https://a.example']]) {
      expect(validateEmailTemplatesSearch({ kind: 'campaign', link }), String(link)).toEqual({ kind: 'campaign' });
    }
    const longest = `https://a.example/${'a'.repeat(CAMPAIGN_LINK_MAX - 'https://a.example/'.length)}`;
    expect(longest).toHaveLength(CAMPAIGN_LINK_MAX);
    expect(campaignLinkOf(longest)).toBe(longest);
    expect(campaignLinkOf(`${longest}a`)).toBeNull();
  });
});
