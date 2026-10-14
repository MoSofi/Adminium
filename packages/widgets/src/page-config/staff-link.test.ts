// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@staff/<path>`: a page link to one screen of its app's staff side names a
 * path inside the side, and nothing that could leave it.
 */
import { describe, expect, it } from 'vitest';

import { staffLinkPath } from './staff-link.js';

describe('a link to the app\'s staff side', () => {
  it('names the side itself, or a path inside it', () => {
    expect(staffLinkPath('@staff')).toBe('');
    expect(staffLinkPath('@staff/approvals')).toBe('approvals');
    expect(staffLinkPath('@staff/settings/team')).toBe('settings/team');
    expect(staffLinkPath('@staff/quotes.v2/~mine_x-y')).toBe('quotes.v2/~mine_x-y');
  });

  it('names nothing that could leave the side, nor another address', () => {
    const bad = [
      '@staff/',
      '@staff//evil.example',
      '@staff/../other',
      '@staff/approvals/..',
      '@staff/./approvals',
      '@staff/.hidden',
      '@staff/%2e%2e/x',
      '@staff/approvals?next=//evil.example',
      '@staff/approvals#x',
      '@staff/https://evil.example',
      '@staff/javascript:alert(1)',
      '@staff/a\\b',
      '@staff/a b',
      '@staff/approvals/',
      '@staff/a\n',
      `@staff/${'a'.repeat(201)}`,
      '@staffing',
      '@desk',
      '/p/crm-deals',
      'https://evil.example',
    ];
    for (const href of bad) expect(staffLinkPath(href), href).toBeNull();
  });
});
