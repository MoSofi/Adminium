// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit's `MapView`, as code of its own: the dashboard's map, with a pin
 * for each point and a list beside it (under it, on a narrow screen). When
 * the map's pictures cannot be fetched, the list still shows.
 */

import { useMemo, type ReactNode } from 'react';
import { MapBubble, type GeoPoint } from '@adminium/widgets/kit-map';
import type { MapPoint, MapViewProps } from '@adminium/server/ui';

import { t } from '../../i18n/t.js';

const VALUE = 'value';

export default function MapPart({ points, center, zoom, onSelect, valueLabel, emptyTitle, emptyDescription }: MapViewProps): ReactNode {
  // A point with no figure counts one, so every pin is drawn and the same size.
  const placed = useMemo(() => points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)), [points]);
  const geo = useMemo<GeoPoint[]>(() => placed.map((point) => ({ name: point.name, lat: point.lat, lng: point.lng, values: { [VALUE]: point.value ?? 1 } })), [placed]);
  const pick = onSelect === undefined ? undefined : (picked: GeoPoint): void => {
        const found: MapPoint | undefined = placed[geo.indexOf(picked)] ?? placed.find((point) => point.name === picked.name);
        if (found !== undefined) onSelect(found);
      };
  return (
    <div className="min-w-0 max-w-full" data-part="kit-map">
      <MapBubble
        points={geo}
        metrics={[VALUE]}
        metricLabels={{ [VALUE]: valueLabel ?? t('project:kit.mapPlaces', 'Places') }}
        {...(center === undefined ? {} : { center })}
        {...(zoom === undefined ? {} : { zoom })}
        {...(pick === undefined ? {} : { onSelect: pick })}
        {...(emptyTitle === undefined ? {} : { emptyTitle })}
        {...(emptyDescription === undefined ? {} : { emptyBody: emptyDescription })}
      />
    </div>
  );
}
