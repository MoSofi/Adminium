// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `nav.hidden` → row projection (30-record-pages.md follow-up): a generated
 * cascade-owned child's envelope carries `nav.hidden: true`, and the page ROW
 * it persists to must carry `nav_group = null` — the exact state Studio's
 * "Hide from sidebar" writes, so nav-building, bootstrap and un-hiding all
 * run on one predicate. The envelope keeps its `group` (what "Show in
 * sidebar" restores), which is why the projection, not the envelope, is where
 * null appears.
 */
import { describe, expect, it } from 'vitest';
import { pageEnvelopeSchema } from '@adminium/engine/config';

import { toGeneratedPageInput } from '../src/generate/run.js';

function envelope(nav: Record<string, unknown>) {
  return pageEnvelopeSchema.parse({
    v: 1,
    kind: 'page',
    id: 'page_x_invoice-items',
    template: 'page-crud',
    title: { key: 'nav.invoice-items', fallback: 'Invoice Items' },
    source: { connectionId: 'conn_x', table: 'public.invoice_items' },
    nav: { group: 'library', icon: 'table', order: 30, slug: 'invoice-items', ...nav },
    access: { minRole: 'viewer', permissions: [] },
    config: {},
  });
}

describe('toGeneratedPageInput and nav.hidden', () => {
  it('projects hidden to a null row group while the envelope keeps its group', () => {
    const hidden = envelope({ hidden: true });
    const input = toGeneratedPageInput(hidden);
    expect(input.navGroup).toBeNull();
    expect((input.config as { nav: { group: string; hidden?: boolean } }).nav).toMatchObject({
      group: 'library',
      hidden: true,
    });
  });

  it('leaves visible pages exactly as before', () => {
    expect(toGeneratedPageInput(envelope({})).navGroup).toBe('library');
  });
});
