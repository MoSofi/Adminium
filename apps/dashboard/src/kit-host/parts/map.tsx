// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The map, mounted on an app's own screen.
 *
 * It is the dashboard's own map (`MapBubble`, what the project kit's
 * `MapView` draws): a pin for each place and a list of the same places beside
 * it, a pin dragged to the exact spot by a pointer or the keyboard, areas
 * drawn and changed, a route through the pins. And its three states, none of
 * them a blank frame: the map; the list under "the map could not be reached";
 * the list under "maps are switched off", when nothing is asked of the map
 * server and no map code is fetched.
 *
 * What the dashboard gives its map from the session, the app gives here as
 * props: where maps come from (`maps`, the side's config as it came), the
 * link to the page that switches them on (`settingsHref`), light or dark.
 *
 * The app owns the rows. It gives pins and areas as plain data and saves a
 * dragged pin in `onMovePin`. A save that is refused (`{ refused }`, or a
 * rejection) puts the pin back, and the map says why above itself and aloud.
 * A move that held is kept: the pin stays on its new spot whether or not the
 * app hands new pins back.
 *
 * `update` never builds the map again: the view is the person's once they
 * have moved it, the picked pin stays picked, and a pin in the middle of a
 * drag keeps its button.
 */
import { useMaybeT } from '@adminium/i18n/react';
import { MapBubble, WidgetRuntimeProvider, type GeoPoint, type MapArea, type MapRoute, type WidgetRuntimeEnv } from '@adminium/widgets/kit-map';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { KitMounted, MapAreaGeometry, MapProps, MapStop, MapWay } from '../contract.js';
import { mountReact } from '../root.js';
import { followed, reasonOf } from '../saves.js';

import './map.css';
// The map library's own sheet, every rule of it under the kit's wrapper (`?kit-scoped`, vite.config.ts).
// By its place on disk: the library is the widgets package's, and this package cannot name it bare.
import '../../../node_modules/@adminium/widgets/node_modules/maplibre-gl/dist/maplibre-gl.css?kit-scoped';

type Scheme = 'light' | 'dark';

/**
 * Light or dark, as the page has it where the part stands: a probe takes
 * `light-dark()` as its colour and the browser says which it chose. An app
 * that names `theme` is taken at its word and this is not asked.
 */
function schemeAt(element: Element): Scheme {
  try {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    probe.style.color = 'light-dark(rgb(1, 1, 1), rgb(2, 2, 2))';
    element.append(probe);
    const dark = getComputedStyle(probe).color === 'rgb(2, 2, 2)';
    probe.remove();
    return dark ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** What was not saved, and why when the app said. */
interface Refusal {
  what: 'pin' | 'area';
  reason: string | undefined;
}

function KitMap({ props, patch, first }: { props: MapProps; patch: (change: Partial<MapProps>) => void; first: Scheme }): ReactNode {
  const t = useMaybeT();
  // What the app last gave, for the answers that arrive later.
  const latest = useRef(props);
  latest.current = props;
  const box = useRef<HTMLDivElement | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  // Where maps come from: the app's word, in the place of the dashboard's session.
  const { enabled, server, routing } = props.maps;
  const env = useMemo<WidgetRuntimeEnv>(() => ({ runtime: 'browser', offlineAssets: false, maps: { server: enabled ? server : null, routing: routing === true } }), [enabled, server, routing]);

  // The page's own light or dark, read again whenever the app says anything and when the device changes its mind.
  const [scheme, setScheme] = useState<Scheme>(first);
  useEffect(() => {
    if (box.current !== null) setScheme(schemeAt(box.current));
  }, [props]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const read = (): void => {
      if (box.current !== null) setScheme(schemeAt(box.current));
    };
    query.addEventListener?.('change', read);
    return () => query.removeEventListener?.('change', read);
  }, []);

  const placed = useMemo(() => props.pins.filter((pin) => Number.isFinite(pin.lat) && Number.isFinite(pin.lng)), [props.pins]);
  // A pin's id travels as the point's code: it is how a pick or a drag is told back to the app.
  const points = useMemo<GeoPoint[]>(
    () =>
      placed.map((pin) => ({
        name: pin.label,
        code: pin.id,
        lat: pin.lat,
        lng: pin.lng,
        values: {},
        ...(pin.by === undefined ? {} : { by: pin.by }),
        ...(pin.tone === undefined ? {} : { tone: pin.tone }),
      })),
    [placed],
  );
  const areas = useMemo<MapArea[] | undefined>(
    () => props.areas?.map((area) => ({ id: area.id, geometry: area.geometry, ...(area.name === undefined ? {} : { name: area.name }), ...(area.tone === undefined ? {} : { tone: area.tone }) })),
    [props.areas],
  );
  const picked = props.selected === undefined || props.selected === null ? -1 : placed.findIndex((pin) => pin.id === props.selected);

  // ── the route: asked of the app when the stops' positions change, and only then ──
  const routed = props.route !== undefined;
  const stops = useMemo<MapStop[]>(() => placed.map((pin) => ({ lat: pin.lat, lng: pin.lng, ...(pin.by === undefined ? {} : { by: pin.by }) })), [placed]);
  // The positions as text: a new list that says the same places asks nothing again, nor does a new function.
  const stopsKey = routed ? JSON.stringify(stops) : null;
  const [way, setWay] = useState<{ key: string; way: MapWay } | null>(null);
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  useEffect(() => {
    const ask = latest.current.route;
    if (stopsKey === null || ask === undefined || stopsRef.current.length < 2) return undefined;
    let stale = false;
    const asked = stopsRef.current;
    Promise.resolve()
      .then(() => ask(asked))
      .then(
        (answer) => {
          if (!stale && Array.isArray(answer?.legs)) setWay({ key: stopsKey, way: answer });
        },
        // No answer: the straight dashed legs stay, their lengths unknown.
        () => undefined,
      );
    return () => {
      stale = true;
    };
  }, [stopsKey]);
  const route = useMemo<MapRoute | undefined>(() => {
    if (stopsKey === null) return undefined;
    if (way === null || way.key !== stopsKey) return { legs: [] };
    return { legs: way.way.legs, ...(way.way.line === undefined ? {} : { line: way.way.line }) };
  }, [stopsKey, way]);

  const select = (point: GeoPoint): void => {
    const id = point.code;
    if (id === undefined) return;
    if (latest.current.selected !== id) patch({ selected: id });
    latest.current.onSelect?.(id);
  };

  const place = (point: GeoPoint, at: { lat: number; lng: number }): Promise<void> | undefined => {
    const save = latest.current.onMovePin;
    const id = point.code;
    if (save === undefined || id === undefined) return undefined;
    setRefusal(null);
    // The move held: the pin is kept on its new spot, unless the app has said where it is since.
    const keep = (): void => {
      const now = latest.current.pins;
      const pin = now.find((candidate) => candidate.id === id);
      if (pin === undefined || pin.lat !== point.lat || pin.lng !== point.lng) return;
      patch({ pins: now.map((candidate) => (candidate.id === id ? { ...candidate, lat: at.lat, lng: at.lng, ...(candidate.by === undefined ? {} : { by: 'exact' as const }) } : candidate)) });
    };
    const answer = followed(() => save(id, at));
    if (answer === undefined) {
      keep();
      return undefined;
    }
    return answer.then(keep, (error: unknown) => {
      // Said above the map; the rejection goes on to the map, which puts the pin back.
      setRefusal({ what: 'pin', reason: reasonOf(error) });
      throw error;
    });
  };

  const changeArea = (id: string | null, geometry: MapAreaGeometry): Promise<void> | undefined => {
    const save = latest.current.onAreaChange;
    if (save === undefined) return undefined;
    setRefusal(null);
    // A changed area keeps its new outline; a new one has no id until the app hands the areas back.
    const keep = (): void => {
      const now = latest.current.areas;
      if (id === null || now === undefined || !now.some((area) => area.id === id)) return;
      patch({ areas: now.map((area) => (area.id === id ? { ...area, geometry } : area)) });
    };
    const answer = followed(() => save(id, geometry));
    if (answer === undefined) {
      keep();
      return undefined;
    }
    return answer.then(keep, (error: unknown) => {
      const reason = reasonOf(error);
      // The shape stays as it was drawn; the app's own sentence says what became of the save.
      if (reason !== undefined) setRefusal({ what: 'area', reason });
    });
  };

  return (
    <div ref={box} className="adm-kit-map" data-part="kit-map" {...(props.ariaLabel === undefined ? {} : { role: 'group', 'aria-label': props.ariaLabel })}>
      {refusal === null ? null : (
        <div className="adm-kit-map-refused" data-part="map-refused">
          <p>
            {refusal.what === 'pin' ? t('ui:widgets.geo.mapBubble.saidPinRefused', 'The new spot was not kept. The pin is back where it was.') : null}
            {refusal.reason === undefined ? null : (
              // The map itself says "not kept" to a screen reader; the reason is the new thing, so it alone is an alert.
              <span data-part="map-refused-reason" role="alert">
                {refusal.what === 'pin' ? ' ' : ''}
                {refusal.reason}
              </span>
            )}
          </p>
          <button type="button" className="adm-kit-map-dismiss" data-part="map-refused-dismiss" onClick={() => setRefusal(null)}>
            {t('ui:widgets.boards.dismissNotice', 'Dismiss')}
          </button>
        </div>
      )}
      <WidgetRuntimeProvider env={env}>
        <MapBubble
          points={points}
          metrics={[]}
          listOrder="given"
          showValues={false}
          theme={props.theme ?? scheme}
          // The view is the person's once they have moved it: an `update` draws new places where they are.
          holdView
          // MapLibre's own sheet came with this part, held under the kit's wrapper.
          librarySheet={false}
          onSelect={select}
          {...(picked === -1 ? {} : { selected: picked })}
          {...(props.onMovePin === undefined ? {} : { onPlace: place })}
          {...(areas === undefined ? {} : { areas })}
          {...(props.onAreaChange === undefined ? {} : { onAreaChange: changeArea })}
          {...(route === undefined ? {} : { route })}
          {...(props.units === undefined ? {} : { units: props.units })}
          {...(props.center === undefined ? {} : { center: props.center })}
          {...(props.zoom === undefined ? {} : { zoom: props.zoom })}
          {...(props.settingsHref === undefined ? {} : { settingsHref: props.settingsHref })}
          {...(props.listLabel === undefined ? {} : { regionsLabel: props.listLabel })}
          {...(props.emptyLabel === undefined ? {} : { emptyTitle: props.emptyLabel, emptyBody: '' })}
        />
      </WidgetRuntimeProvider>
    </div>
  );
}

export default function mountMap(element: Element, props: MapProps): Promise<KitMounted<MapProps>> {
  const first = schemeAt(element);
  return mountReact<MapProps>('map', element, props, (now, patch) => <KitMap props={now} patch={patch} first={first} />);
}
