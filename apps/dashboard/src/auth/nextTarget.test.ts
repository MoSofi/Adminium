// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where sign-in hands a person back: a path of this origin, and for the
 * staff gate's `next` only into an app's own screens.
 */
import { describe, expect, it } from 'vitest';

import { validateAutomationsSearch } from '../automations/search.js';
import { validateEmailTemplatesSearch } from '../email/search.js';
import { isLocalPath, nextTarget } from './nextTarget.js';

describe('the address sign-in hands back to', () => {
  it('is a path of this origin and nothing else', () => {
    for (const good of ['/', '/p/orders', '/apps/crm/staff/deals/12', '/a/crm/deals/12?tab=notes#top']) expect(isLocalPath(good), good).toBe(true);
    for (const bad of ['//evil.example', '/\\evil.example', '\\/evil.example', 'https://evil.example', 'javascript:alert(1)', 'p/orders', '', '/a\\b', '/a\nb', '/a\tb', null, undefined, 7]) expect(isLocalPath(bad), String(bad)).toBe(false);
  });

  it('on the dashboard\'s own address, the gate\'s target is followed only into an app\'s screens', () => {
    expect(nextTarget('/apps/crm/staff/deals/12', false)).toBe('/apps/crm/staff/deals/12');
    expect(nextTarget('/apps/crm/berlin/staff/', false)).toBe('/apps/crm/berlin/staff/');
    // Any other path of the origin is not the gate's: an API route, the dashboard's own screens.
    for (const other of ['/', '/api/v1/auth/logout', '/api/v1/exports/1/download', '/settings/roles', '/apps', '/apps/', '/apps//evil.example', '/appsx/crm']) expect(nextTarget(other, false), other).toBeNull();
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example/apps/crm/staff/', '/apps/crm/staff/\\..', null, undefined]) expect(nextTarget(bad, false), String(bad)).toBeNull();
  });

  it('on an address mapped to an app\'s staff side, any path of that address is the app\'s', () => {
    expect(nextTarget('/', true)).toBe('/');
    expect(nextTarget('/deals/12', true)).toBe('/deals/12');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)']) expect(nextTarget(bad, true), bad).toBeNull();
  });
});

describe('the screens narrowed to one app', () => {
  it('read an app\'s key off the address, and nothing that is not a key', () => {
    expect(validateAutomationsSearch({ app: 'crm', rule: 'r1' })).toEqual({ app: 'crm', rule: 'r1' });
    expect(validateEmailTemplatesSearch({ app: 'sales-crm', kind: 'campaign' })).toEqual({ app: 'sales-crm', kind: 'campaign' });
    for (const bad of ['', 'CRM', '../x', 'a b', '%', 7, null, ['crm'], 'crm\' or 1=1']) {
      expect(validateAutomationsSearch({ app: bad }), String(bad)).toEqual({});
      expect(validateEmailTemplatesSearch({ app: bad }), String(bad)).toEqual({});
    }
  });
});
