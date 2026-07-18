/**
 * `page-log-viewer` binding (09-generated-app.md §4.1, §7.8): projects the
 * page envelope onto the real `PageLogViewer` template from
 * `@adminium/widgets`.
 *
 * Data: `usePageWidgetStates` runs the ONE deduped
 * `POST /api/v1/widget-data/batch` per page mount under the shared
 * `['widget-data', pageId, …]` key, so WS `widget-data:*`/`table:*`
 * invalidations refetch automatically; the materialized per-instance states
 * feed the template's `states` prop (unbound instances keep the deterministic
 * demo path, 04 §5.3).
 *
 * Live tail: the log slot's stored descriptor names the source table, so the
 * binding derives the `widget-data:{connectionId}:{table}` channel
 * (M7 W1 stream contract) and mounts the app's shared multiplexed transport
 * around the template — the template folds record events into the tail.
 */
import { useMemo } from 'react';
import { PageLogViewer } from '@adminium/widgets';
import { StreamTransportProvider, streamChannelForSource } from '@adminium/widgets/binding';

import { appStreamTransport } from './lmc/stream.js';
import { findItemDescriptor, usePageWidgetStates } from './lmc/widgetStates.js';
import type { PageTemplateProps } from './template-types.js';

export function PageLogViewerBinding({ page, adapters }: PageTemplateProps) {
  const { states } = usePageWidgetStates(page);

  const liveChannel = useMemo(() => {
    const log = findItemDescriptor(page, ['log-table', 'realtime-feed'], 'log');
    if (log === null) return undefined;
    return streamChannelForSource(log.descriptor.connectionId, log.descriptor.source);
  }, [page]);

  return (
    <StreamTransportProvider transport={appStreamTransport()}>
      <PageLogViewer
        layout={page.config['layout']}
        states={states}
        {...(liveChannel === undefined ? {} : { liveChannel })}
        onEvent={(instanceId, event) => {
          void instanceId;
          void adapters.onEvent(event);
        }}
      />
    </StreamTransportProvider>
  );
}
