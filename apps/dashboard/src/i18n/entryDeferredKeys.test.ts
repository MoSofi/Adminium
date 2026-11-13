// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The entry gate (`scripts/check-entry-budget.mjs`) refuses an entry chunk
 * that names a key of a deferred group of `common`: every such group, as
 * `COMMON_DEFERRED_GROUPS` lists it, bar the two whose names are also
 * permission names the first paint carries (`reports.manage`, `audit.read`).
 */
import { COMMON_DEFERRED_GROUPS } from '@adminium/i18n/resources';
import { describe, expect, it } from 'vitest';

// @ts-expect-error -- a plain build script, no types of its own.
import { DEFERRED_COMMON_KEY } from '../../scripts/entry-deferred-keys.mjs';

const pattern = DEFERRED_COMMON_KEY as RegExp;
const PERMISSION_NAMES = new Set(['reports', 'audit']);

describe('the entry gate’s deferred groups of common', () => {
  it.each(COMMON_DEFERRED_GROUPS.filter((group) => !PERMISSION_NAMES.has(group)))('catches a key of %s, bare or named', (group) => {
    expect(pattern.test(`t('${group}.someKey', 'Words')`)).toBe(true);
    expect(pattern.test(`t("common:${group}.someKey")`)).toBe(true);
  });

  it('lets the permission names through', () => {
    expect(pattern.test(`can('reports.manage')`)).toBe(false);
    expect(pattern.test(`"audit.read"`)).toBe(false);
  });
});
