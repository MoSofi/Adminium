// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The built-in nav groups have ONE canonical list (51a), and this holds this
 * end's copy equal to it.
 *
 * Why a test and not an import: 51b rewires `NAV_GROUP_KEYS` to import
 * `BUILTIN_NAV_GROUP_KEYS`, and doing that here, now, would mean touching the
 * `z.enum` this file's own schema is built from in the same wave that adds the
 * manifest fields — two risks in one change for no gain. Until then the copies
 * cannot drift silently: an add-on manifest is validated against the contracts
 * list and the rail is rendered from this one, so a key in one and not the
 * other is a page that validates at install and is invisible afterwards.
 */
import { BUILTIN_NAV_GROUP_KEYS } from '@adminium/add-on-contracts';
import { describe, expect, it } from 'vitest';

import { NAV_GROUP_KEYS } from '../src/routes/bootstrap/schema.js';

describe('built-in nav groups', () => {
  it('match the canonical list in @adminium/add-on-contracts, in order', () => {
    expect([...NAV_GROUP_KEYS]).toEqual([...BUILTIN_NAV_GROUP_KEYS]);
  });

  it('contain the group an add-on page falls back to', () => {
    expect([...NAV_GROUP_KEYS]).toContain('library');
  });
});
