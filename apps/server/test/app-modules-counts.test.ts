// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the install check counts beside an app's parts (`planWholeOf`,
 * `planModulesOf`): each role with the parts it is of, and the rules of no
 * part; each part with its own rules. The check works out "N tables, N roles,
 * N rules" and the roles left with nothing from these, so a rule or a role
 * counted twice, or one lost, is a wrong figure on the screen.
 */
import type { Manifest } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { planModulesOf, planWholeOf } from '../src/apps/app-modules.js';

const rule = (key: string, module?: string) => ({ key, ...(module === undefined ? {} : { module }) });

const crm = {
  kind: 'app',
  modules: [
    { id: 'selling', label: { 'en-US': 'Selling' }, default: 'always' },
    { id: 'jobs', label: { 'en-US': 'Jobs on site' }, default: 'off' },
    { id: 'supply', label: { 'en-US': 'Supply' }, default: 'on', feature: 'supply' },
  ],
  addOns: { features: [{ id: 'supply', label: { 'en-US': 'Supply' }, requires: ['inventory'] }] },
  roles: [
    { key: 'admin', name: 'CRM admin' },
    { key: 'rep', name: 'Sales rep', modules: ['selling'] },
    { key: 'ops', name: 'Operations manager', modules: ['jobs', 'supply', 'gone'] },
  ],
  automations: [rule('a', 'selling'), rule('b', 'selling'), rule('c', 'jobs'), rule('d'), rule('e', 'gone')],
  requiredSchema: { tables: [] },
} as unknown as Manifest;

describe('what the install check counts beside the parts', () => {
  it('gives each role its parts (none: of the whole app), and counts the rules of no part', () => {
    expect(planWholeOf(crm)).toEqual({
      roles: [
        { name: 'CRM admin', parts: [] },
        { name: 'Sales rep', parts: ['selling'] },
        // A part the manifest has not is no part of the role's.
        { name: 'Operations manager', parts: ['jobs', 'supply'] },
      ],
      // `d` names no part, `e` a part the app does not have: both run whatever is on.
      rules: 2,
    });
  });

  it('gives each part its own rules', () => {
    expect(planModulesOf(crm, ['supply'], null).map((module) => [module.id, module.rules, module.leftOut, module.needs])).toEqual([
      ['selling', 2, false, []],
      ['jobs', 1, false, []],
      ['supply', 0, true, ['inventory']],
    ]);
  });

  it('says nothing for an app with no parts', () => {
    expect(planWholeOf({ kind: 'app', requiredSchema: { tables: [] } } as unknown as Manifest)).toBeUndefined();
  });
});
