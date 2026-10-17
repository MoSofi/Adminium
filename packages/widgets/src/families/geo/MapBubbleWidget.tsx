// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `map-bubble` as the registry places it: the widget's config and data turned
 * into the map's props, and a picked place turned into the page's event.
 *
 * Apart from `MapBubble.tsx` on purpose. This half formats figures, and the
 * formatters come with the whole of `@adminium/i18n`; the map itself is also
 * drawn on an app's own screen (the kit's map part), where nothing of the
 * dashboard's translator may be fetched. So the map names no formatter, and
 * only a placed widget does.
 */
import { geoPointsOf, sourceOf } from './geo-lib.js';
import type { MapBubbleConfig } from './geo-config.js';
import { MapBubble } from './MapBubble.js';
import { formatMetricValue, formatOptionsOf } from '../../lib/format.js';
import type { WidgetProps } from '../../registry/types.js';

export function MapBubbleWidget({ config, data, onEvent }: WidgetProps<MapBubbleConfig>) {
  const points = geoPointsOf(data, {
    nameField: config.nameField,
    codeField: config.codeField,
    latField: config.latColumn,
    lngField: config.lngColumn,
    placeField: config.placeColumn,
    metricFields: config.metrics,
  });
  const opts = formatOptionsOf(config);
  const source = sourceOf(config.binding);

  return (
    <MapBubble
      points={points}
      metrics={config.metrics}
      metricLabels={config.metricLabels}
      flyToOnClick={config.flyToOnClick}
      topN={config.topN}
      format={(value) => formatMetricValue(value, config.valueFormat, opts)}
      {...(config.initialZoom === undefined ? {} : { zoom: config.initialZoom })}
      {...(config.initialCenter === undefined ? {} : { center: config.initialCenter })}
      {...(config.emptyTitle === undefined ? {} : { emptyTitle: config.emptyTitle })}
      {...(config.emptyBody === undefined ? {} : { emptyBody: config.emptyBody })}
      {...(config.mapUnavailableLabel === undefined ? {} : { mapUnavailableLabel: config.mapUnavailableLabel })}
      {...(config.regionsLabel === undefined ? {} : { regionsLabel: config.regionsLabel })}
      {...(config.format?.locale === undefined ? {} : { locale: config.format.locale })}
      {...(config.testId === undefined ? {} : { testId: config.testId })}
      onSelect={(point) => {
        // Selecting a place is a drill-through when config names a route, else a
        // record-open the page host routes (annex `linkedList`: the host
        // focuses the paired ranked-entity-list — widgets never talk to each
        // other directly).
        if (config.href !== undefined) {
          onEvent({ type: 'drill-through', href: config.href });
          return;
        }
        onEvent({
          type: 'record-open',
          ...(source.connectionId === undefined ? {} : { connectionId: source.connectionId }),
          table: source.table,
          recordId: point.code ?? point.name,
          // annex `linkedList` — carried on the event so the host can focus
          // the paired list. Omitted when unset, so the event stays exactly what
          // it was for an unpaired map.
          ...(config.linkedList === undefined ? {} : { linkedInstanceId: config.linkedList }),
        });
      }}
    />
  );
}
