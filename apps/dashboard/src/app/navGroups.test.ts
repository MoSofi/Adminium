// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard's copy of the built-in nav groups, held equal to the canonical
 * list in `@adminium/add-on-contracts` (51a).
 *
 * The rail is the end that shows the consequence of drift. `SidebarNav` renders
 * a heading per group and a `satisfies` made a sixth group a compile error
 * here; once an add-on may declare one, that guard has to become a refusal at
 * install (the manifest schema) plus this equality — otherwise a group the
 * server accepts renders as a raw key, or not at all.
 */
import { BUILTIN_NAV_GROUP_KEYS, DEFAULT_NAV_GROUP } from '@adminium/add-on-contracts';
import { describe, expect, it } from 'vitest';

import { NAV_GROUP_KEYS } from './bootstrap.js';

describe('built-in nav groups', () => {
  it('match the canonical list in @adminium/add-on-contracts, in order', () => {
    expect([...NAV_GROUP_KEYS]).toEqual([...BUILTIN_NAV_GROUP_KEYS]);
  });

  it('include the default an add-on page falls back to', () => {
    expect([...NAV_GROUP_KEYS]).toContain(DEFAULT_NAV_GROUP);
  });
});
