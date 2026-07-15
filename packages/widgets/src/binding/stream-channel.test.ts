import { describe, expect, it } from 'vitest';

import {
  WIDGET_DATA_CHANNEL_PREFIX,
  qualifiedTableName,
  streamChannel,
  streamChannelForSource,
} from './stream-channel.js';

describe('qualifiedTableName', () => {
  it('joins schema.name on Postgres', () => {
    expect(qualifiedTableName({ schema: 'public', name: 'orders' })).toBe('public.orders');
  });

  it('uses the bare name when schema is absent or empty (MySQL/SQLite)', () => {
    expect(qualifiedTableName({ name: 'orders' })).toBe('orders');
    expect(qualifiedTableName({ schema: '', name: 'orders' })).toBe('orders');
  });
});

describe('streamChannel', () => {
  it('builds widget-data:{connectionId}:{qualifiedTable}', () => {
    expect(streamChannel('conn_1', 'public.orders')).toBe('widget-data:conn_1:public.orders');
    expect(WIDGET_DATA_CHANNEL_PREFIX).toBe('widget-data');
  });

  it('derives the same channel from a descriptor source (matches the CRUD publisher id)', () => {
    expect(streamChannelForSource('conn_1', { schema: 'public', name: 'orders' })).toBe(
      'widget-data:conn_1:public.orders',
    );
    expect(streamChannelForSource('conn_2', { name: 'events' })).toBe('widget-data:conn_2:events');
  });
});
