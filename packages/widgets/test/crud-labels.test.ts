// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { CRUD_LABEL_MAX_LENGTH, parseCrudLabels } from '../src/page-config/index.js';

/**
 * `config.labels` — the per-page chrome overrides the Studio editor writes.
 * The rules that matter are the degradations: a page without the block, and a
 * page whose block this build cannot read, must both render the template's own
 * translated defaults rather than a blank button or a crash.
 */
describe('parseCrudLabels', () => {
  it('reads a stored newRow override', () => {
    expect(parseCrudLabels({ labels: { newRow: 'Add invoice' } })).toEqual({
      newRow: 'Add invoice',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseCrudLabels({ labels: { newRow: '  Add invoice  ' } })).toEqual({
      newRow: 'Add invoice',
    });
  });

  it('answers null when the page carries no labels block', () => {
    expect(parseCrudLabels({})).toBeNull();
    expect(parseCrudLabels({ labels: undefined })).toBeNull();
    expect(parseCrudLabels({ labels: null })).toBeNull();
  });

  it('answers null for an empty block, so the prop stays undefined', () => {
    // `{}` would be truthy at the call site and set `labels={{}}`, which is
    // harmless but makes "has an override" untestable by presence.
    expect(parseCrudLabels({ labels: {} })).toBeNull();
  });

  it('degrades to null rather than surfacing an unusable label', () => {
    // A blank override would defeat the template's `labels?.newRow ?? t(…)`
    // fallback and render a button with no name.
    expect(parseCrudLabels({ labels: { newRow: '' } })).toBeNull();
    expect(parseCrudLabels({ labels: { newRow: '   ' } })).toBeNull();
    expect(parseCrudLabels({ labels: { newRow: 42 } })).toBeNull();
    expect(parseCrudLabels({ labels: ['Add invoice'] })).toBeNull();
    expect(parseCrudLabels({ labels: 'Add invoice' })).toBeNull();
  });

  it('rejects a label longer than the toolbar can carry', () => {
    const at = 'x'.repeat(CRUD_LABEL_MAX_LENGTH);
    expect(parseCrudLabels({ labels: { newRow: at } })).toEqual({ newRow: at });
    expect(parseCrudLabels({ labels: { newRow: `${at}x` } })).toBeNull();
  });

  it('ignores keys it has no schema for (forward compat)', () => {
    expect(parseCrudLabels({ labels: { newRow: 'Add invoice', fromANewerBuild: 'x' } })).toEqual({
      newRow: 'Add invoice',
    });
  });
});
