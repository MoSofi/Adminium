// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit's `MapView`, as code of its own: the dashboard's map, with a pin
 * for each point and a list beside it (under it, on a narrow screen), areas,
 * and a route through the points. While maps are switched off, in the
 * desktop app, or when the map server cannot be reached, the list stands in
 * with a notice saying which: where maps come from is the session's answer
 * (the widget runtime the router provides), not this file's.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useCallback, useMemo, type ReactNode } from 'react';
import { MapBubble, type GeoPoint } from '@adminium/widgets/kit-map';
import type { MapPoint, MapViewProps } from '@adminium/server/ui';

import { bootstrapQuery, holdsSystemAction } from '../../app/bootstrap.js';
import { t } from '../../i18n/t.js';

const VALUE = 'value';
/** The list shows the points it was given, in their order, up to this many; then "and n more". Every point has its pin. */
const LIST_MAX = 200;

export default function MapPart({
  points,
  center,
  zoom,
  onSelect,
  onPlace,
  areas,
  onAreaChange,
  route,
  units,
  valueLabel,
  emptyTitle,
  emptyDescription,
}: MapViewProps): ReactNode {
  const placed = useMemo(() => points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)), [points]);
  // A point with no figure counts one, so every pin is drawn and the same size.
  const geo = useMemo<GeoPoint[]>(
    () => placed.map((point) => ({ name: point.name, lat: point.lat, lng: point.lng, ...(point.by === undefined ? {} : { by: point.by }), values: { [VALUE]: point.value ?? 1 } })),
    [placed],
  );
  // Somebody who may change it gets the way to Settings → Maps beside "switched off".
  const boot = useQuery({ ...bootstrapQuery(), enabled: false }).data;
  const maySetMaps = boot !== undefined && holdsSystemAction(boot, 'settings.manage');
  // The way there goes through the app's router, so the app is not loaded again. A map drawn
  // outside a router (a test, a preview) keeps the plain link.
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | undefined;
  const openSettings = useCallback((href: string) => void router?.history.push(href), [router]);
  const counted = useMemo(() => placed.some((point) => point.value !== undefined), [placed]);
  const found = (picked: GeoPoint): MapPoint | undefined => placed[geo.indexOf(picked)] ?? placed.find((point) => point.name === picked.name);
  return (
    <div className="min-w-0 max-w-full" data-part="kit-map">
      <MapBubble
        points={geo}
        metrics={[VALUE]}
        metricLabels={{ [VALUE]: valueLabel ?? t('project:kit.mapPlaces', 'Places') }}
        // A page's map lists what it was given, in its order; a figure is shown only where one was given.
        listOrder="given"
        listMax={LIST_MAX}
        showValues={counted}
        {...(maySetMaps ? { settingsHref: '/settings/maps' } : {})}
        {...(maySetMaps && router !== undefined ? { onSettingsOpen: openSettings } : {})}
        {...(valueLabel === undefined ? {} : { regionsLabel: valueLabel })}
        {...(center === undefined ? {} : { center })}
        {...(zoom === undefined ? {} : { zoom })}
        {...(onSelect === undefined ? {} : { onSelect: (picked: GeoPoint) => { const point = found(picked); if (point !== undefined) onSelect(point); } })}
        {...(onPlace === undefined ? {} : { onPlace: (picked: GeoPoint, at: { lat: number; lng: number }) => { const point = found(picked); if (point !== undefined) onPlace(point, at); } })}
        {...(areas === undefined ? {} : { areas })}
        {...(onAreaChange === undefined ? {} : { onAreaChange })}
        {...(route === undefined ? {} : { route })}
        {...(units === undefined ? {} : { units })}
        {...(emptyTitle === undefined ? {} : { emptyTitle })}
        {...(emptyDescription === undefined ? {} : { emptyBody: emptyDescription })}
      />
    </div>
  );
}
