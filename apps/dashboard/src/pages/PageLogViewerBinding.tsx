// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-log-viewer` binding: projects the page envelope onto the real
 * `PageLogViewer` template from `@adminium/widgets`.
 *
 * Data: `usePageWidgetStates` runs the ONE deduped
 * `POST /api/v1/widget-data/batch` per page mount under the shared
 * `['widget-data', pageId, …]` key, so WS `widget-data:*`/`table:*`
 * invalidations refetch automatically; the materialized per-instance states
 * feed the template's `states` prop (unbound instances keep the deterministic
 * demo path).
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
import { LinkFilterBar, LinkNarrowingGate, useLinkNarrowing, useNarrowedPage } from './linkNarrowing.js';
import type { PageTemplateProps } from './template-types.js';

export function PageLogViewerBinding({ page, adapters, currency, formColumns, columnFacts }: PageTemplateProps) {
  // A link may open this list narrowed (`?f.<column>=<op>:<value>`): see linkNarrowing.tsx.
  const narrowing = useLinkNarrowing(page, adapters.crud?.table);
  const view = useNarrowedPage(page, narrowing);
  const { states } = usePageWidgetStates(view.page, {}, view.key);

  const liveChannel = useMemo(() => {
    const log = findItemDescriptor(page, ['log-table', 'realtime-feed'], 'log');
    if (log === null) return undefined;
    return streamChannelForSource(log.descriptor.connectionId, log.descriptor.source);
  }, [page]);

  if (view.blocked) return <LinkNarrowingGate narrowing={narrowing} cannotCarry={view.cannotCarry} />;

  return (
    <StreamTransportProvider transport={appStreamTransport()}>
      <LinkFilterBar narrowing={narrowing} columns={formColumns} facts={columnFacts} />
      <PageLogViewer
        // The connection's currency: a money card that names none reads in it.
        {...(currency === undefined ? {} : { currency })}
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
