// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `@adminium/widgets/binding` — the `stream` data-binding layer (04-widget-registry.md
 * §5.3): the transport contract + provider, the bounded newest-first buffer,
 * the deterministic demo stream, channel naming, and the `useWidgetStream`
 * hook. The host app injects a concrete WS/SSE transport; widgets consume the
 * hook. Kept out of the React-free `@adminium/widgets/page-config` leaf.
 */

export type {
  StreamRealtimeEvent,
  StreamListener,
  StreamStatusListener,
  StreamTransport,
  StreamShape,
  StreamEventPayload,
} from './stream-types.js';

export {
  WIDGET_DATA_CHANNEL_PREFIX,
  qualifiedTableName,
  streamChannel,
  streamChannelForSource,
  type StreamSource,
} from './stream-channel.js';

export {
  DEFAULT_STREAM_MAX,
  seedStreamBuffer,
  upsertStreamItem,
  upsertStreamItems,
  removeStreamItem,
  markStreamRead,
  type StreamBufferState,
  type StreamUpsertOptions,
} from './stream-buffer.js';

export {
  DEMO_STREAM_BASE_MS,
  DEMO_STREAM_STEP_MS,
  DEMO_STREAM_CHANNEL,
  demoStreamRecord,
  demoStreamRecords,
  demoStreamEvent,
  createDemoStreamTransport,
  type DemoStreamRecord,
  type DemoStreamTransportOptions,
} from './demo-stream.js';

export {
  StreamTransportProvider,
  useStreamTransport,
  type StreamTransportProviderProps,
} from './StreamTransportContext.js';

export {
  useWidgetStream,
  type UseWidgetStreamOptions,
  type WidgetStream,
} from './useWidgetStream.js';
