/**
 * extractTemplateBindings (M7 archetype pages): resource envelopes are
 * `kind: 'page'` — unlike api/widgetData.ts#extractBindings this extractor
 * must NOT gate on the dashboard kind, must collect every layout item's
 * descriptor, and must map invalid descriptors to per-instance messages
 * instead of throwing.
 */
import { describe, expect, it } from 'vitest';
import type { PageEnvelope } from '@adminium/engine/config';

import { extractTemplateBindings } from './usePageTemplateData.js';

const descriptor = {
  kind: 'table-query',
  connectionId: 'conn_1',
  source: { name: 'approvals', schema: 'public', type: 'table' },
  shape: 'record-list',
  limit: 50,
};

function envelope(items: unknown[]): PageEnvelope {
  return {
    v: 1,
    kind: 'page',
    id: 'page_test_queue',
    template: 'page-queue-inbox',
    title: { key: 'nav.queue', fallback: 'Queue' },
    source: { connectionId: 'conn_1', table: 'public.approvals' },
    nav: { group: 'workspace', icon: 'inbox', order: 10, slug: 'queue' },
    access: { minRole: 'viewer', permissions: [] },
    config: { templateVersion: 1, layout: { version: 1, items } },
  } as unknown as PageEnvelope;
}

describe('extractTemplateBindings', () => {
  it('collects descriptors from a kind:page envelope (no dashboard gate)', () => {
    const page = envelope([
      { i: 'queue', widget: 'master-list', x: 0, y: 3, w: 8, h: 12, config: { binding: descriptor } },
      { i: 'kpi-row-1', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: {} }, // unbound → demo
    ]);
    const { requests, invalid } = extractTemplateBindings(page);
    expect(requests.map((request) => request.instanceId)).toEqual(['queue']);
    expect(requests[0]?.descriptor.source.name).toBe('approvals');
    expect(invalid.size).toBe(0);
  });

  it('maps an invalid binding to a per-instance message, never a throw', () => {
    const page = envelope([
      { i: 'queue', widget: 'master-list', x: 0, y: 3, w: 8, h: 12, config: { binding: { kind: 'nope' } } },
    ]);
    const { requests, invalid } = extractTemplateBindings(page);
    expect(requests).toHaveLength(0);
    expect(invalid.has('queue')).toBe(true);
  });

  it('returns empty on a missing/corrupt layout', () => {
    const page = envelope([]);
    (page.config as Record<string, unknown>)['layout'] = 'nope';
    const { requests, invalid } = extractTemplateBindings(page);
    expect(requests).toHaveLength(0);
    expect(invalid.size).toBe(0);
  });
});
