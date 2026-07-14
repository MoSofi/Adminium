/**
 * Realtime → cache invalidation map (09 §2.1 step 5, §4.1): `config-changed`
 * refreshes bootstrap + every page document; table / widget-data publications
 * refresh the matching data lists and the widget-data prefix.
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { invalidateForRealtimeEvent } from './realtime.js';

function makeEvent(channel: string, type = 'changed') {
  return { channel, type, data: null, ts: '2026-07-13T00:00:00Z' };
}

function spyClient() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  return { queryClient, invalidate };
}

describe('invalidateForRealtimeEvent', () => {
  it('config-changed → bootstrap + page documents (live regeneration, §2.1)', () => {
    const { queryClient, invalidate } = spyClient();
    invalidateForRealtimeEvent(queryClient, makeEvent('config-changed', 'config-changed'));
    expect(invalidate.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      ['bootstrap'],
      ['page'],
    ]);
  });

  it('table:{conn}:{table} → matching data lists + widget-data prefix', () => {
    const { queryClient, invalidate } = spyClient();
    invalidateForRealtimeEvent(queryClient, makeEvent('table:conn_1:public.orders', 'record.update'));
    expect(invalidate.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      ['data', 'conn_1', 'public.orders'],
      ['widget-data'],
    ]);
  });

  it('widget-data:{conn}:{table} publications behave like table events', () => {
    const { queryClient, invalidate } = spyClient();
    invalidateForRealtimeEvent(queryClient, makeEvent('widget-data:conn_1:public.orders', 'invalidate'));
    expect(invalidate.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      ['data', 'conn_1', 'public.orders'],
      ['widget-data'],
    ]);
  });

  it('ignores unrelated channels', () => {
    const { queryClient, invalidate } = spyClient();
    invalidateForRealtimeEvent(queryClient, makeEvent('notifications:usr_1'));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
