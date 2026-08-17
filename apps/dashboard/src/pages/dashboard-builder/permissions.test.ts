// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Edit-target gating (04-T14, 04 §6.3): the layer a caller's edits persist to is
 * driven by the server's per-page `page:<id>:edit` capability (`canEditLayout`),
 * NOT role slugs — a granted `editor` edits the shared default, a grantless
 * `admin` falls back to a personal override, matching the server exactly.
 */
import { describe, expect, it } from 'vitest';

import { canEditSharedLayout, editTargetForCapability } from './permissions.js';

describe('canEditSharedLayout', () => {
  it('mirrors the per-page edit capability', () => {
    expect(canEditSharedLayout(true)).toBe(true);
    expect(canEditSharedLayout(false)).toBe(false);
  });
});

describe('editTargetForCapability', () => {
  it('routes granted callers to the shared default and everyone else to personal', () => {
    // A page-edit grantee (built-in `editor` blessed on this page, or an admin
    // with the grant) → shared; a grantless caller (default admin, viewer) →
    // personal. The heuristic never looks at role slugs.
    expect(editTargetForCapability(true)).toBe('shared');
    expect(editTargetForCapability(false)).toBe('personal');
  });
});
