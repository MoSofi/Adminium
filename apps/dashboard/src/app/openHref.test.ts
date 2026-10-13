// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Following an address the server wrote: the dashboard's own in place, an
 * app's own address as a document, and nothing else at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isDashboardPath, isDocumentHref, openHref } from './openHref.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('an address the server wrote', () => {
  it('the dashboard\'s own is followed in place', () => {
    const push = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    for (const own of ['/exports', '/p/crm-deals/r/12', '/automations?app=crm', '/a/crm/deals/12', '/studio/apps/crm']) {
      expect(isDashboardPath(own), own).toBe(true);
      openHref(own, push);
    }
    expect(push.mock.calls.map((call) => call[0])).toEqual(['/exports', '/p/crm-deals/r/12', '/automations?app=crm', '/a/crm/deals/12', '/studio/apps/crm']);
    expect(open).not.toHaveBeenCalled();
  });

  it('an app\'s own address opens as a document, never in this bundle', () => {
    const push = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    for (const outside of ['/apps/crm/staff/deals/12', '/apps/crm/berlin/staff/', 'https://desk.example.test/deals/12']) {
      expect(isDashboardPath(outside), outside).toBe(false);
      expect(isDocumentHref(outside), outside).toBe(true);
      openHref(outside, push);
    }
    expect(push).not.toHaveBeenCalled();
    expect(open.mock.calls.map((call) => call[0])).toEqual(['/apps/crm/staff/deals/12', '/apps/crm/berlin/staff/', 'https://desk.example.test/deals/12']);
    expect(open.mock.calls.every((call) => call[1] === '_blank' && call[2] === 'noopener')).toBe(true);
  });

  it('anything else is not followed', () => {
    const push = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    for (const bad of ['//evil.example/x', '/\\evil.example', 'javascript:alert(1)', 'data:text/html,x', 'exports', '', 'ftp://evil.example', '/apps/\\evil', 'https:/\\evil.example', '/ok\npath', 'mailto:a@b.c']) {
      expect(isDashboardPath(bad), bad).toBe(false);
      expect(isDocumentHref(bad), bad).toBe(false);
      openHref(bad, push);
    }
    expect(push).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
