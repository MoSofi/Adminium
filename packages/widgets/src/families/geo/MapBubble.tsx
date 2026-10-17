// SPDX-License-Identifier: AGPL-3.0-only
import { useMaybeI18n, useMaybeT } from '../../lib/i18n.js';
import { Button, EmptyState, SegmentedControl, subscribeTheme } from '@adminium/ui';
import { MapPin } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  bubbleRadius,
  localeOf,
  mapStyleUrl,
  maxMetric,
  metricKeysOf,
  metricValue,
  plottablePoints,
} from './geo-lib.js';
import type { GeoPoint } from './geo-lib.js';
import type { MapBubbleConfig } from './geo-config.js';
import type { MapEngine, Scene, ScenePin } from './map-engine.js';
import type { MapLibreModule } from './maplibre-module.js';
import {
  addCorner,
  boundsOf,
  canClose,
  cornersOf,
  formatDistance,
  formatDuration,
  hasOtherPieces,
  insertCorner,
  isAppleDevice,
  legDistance,
  legDuration,
  mapsAppHref,
  mapsSiteHref,
  moveCorner,
  paletteIndex,
  pointCount,
  removeCorner,
  routeTotal,
  spreadPins,
  straightLine,
  withOuterRing,
  MIN_CORNERS,
  PALETTE_SHAPES,
  SETTLE_MS,
} from './map-shapes.js';
import type { AreaGeometry, Corner, DistanceUnits, MapArea, MapRoute, RouteLeg } from './map-shapes.js';
import { coordinateText } from './place-value.js';
import { StatusNote } from './StatusNote.js';
import { useWidgetRuntimeEnv } from '../../frame/WidgetRuntimeContext.js';
import { mapServerOf } from '../../registry/map-server.js';

// Config schema + deterministic demo payload live in the pure `geo-config`
// module so the registry metadata graph never eagerly pulls this component (or
// the map engine) into the eager chunk (acceptance #3); re-exported here so the
// family barrel, stories, and tests keep one import point per widget.
export { mapBubbleConfigSchema, mapBubbleDemoData } from './geo-config.js';
export type { MapBubbleConfig };

/**
 * `map-bubble` (annex) — a MapLibre map drawn from the install's map server in
 * its light or dark style, pins sized by the active metric, and a list of the
 * same places beside it. It also draws what the kit's `MapView` asks for:
 * pins known only by their town, a pin dragged to the exact spot, areas (and
 * the drawing of one), and a route through the points.
 *
 * ── THREE STATES, NEVER A BLANK FRAME ──────────────────────────────────────
 *  a. Maps are on and the map server answers: the map, with the list.
 *  b. Maps are on and the server cannot be reached (offline, blocked, down):
 *     the list, under "The map could not be reached. Here is the list."
 *  c. Maps are off (the session names no server: switched off in Settings →
 *     Maps, by the operator, or this is the desktop app): the list, under
 *     "Maps are switched off". NOTHING outside is asked and no map code is
 *     fetched — the effect below returns before its `import()`.
 * The list is drawn from the same data in all three, so the widget is still
 * useful, and still readable by a screen reader, with no map at all.
 *
 * ── THIS FILE IS THE ONLY PLACE MAPLIBRE EXISTS (acceptance #3) ─────────────
 * Two boundaries enforce it, and `qa/chunk-budget.test.ts` asserts both:
 *
 *   1. This module is reachable ONLY through `geo-track-components.ts` (by
 *      `lazy(() => import(...))` from the definitions, by way of the widget's
 *      wrapper, `MapBubbleWidget.tsx`) and `kit-map.ts` (by the kit's own
 *      dynamic import). No static-import path runs from the registry metadata
 *      to here.
 *   2. MapLibre, its stylesheet, its worker and `map-engine.ts` (the code that
 *      drives it) are loaded by a dynamic `import()` INSIDE the mount effect.
 *      So they are in chunks of their own, fetched when a map is actually
 *      drawn — never by a page that placed only `map-choropleth-grid`, and
 *      never while maps are off.
 *
 * That same dynamic import is what makes the widget SSR-safe: effects never run
 * on the server, so MapLibre is never evaluated there.
 *
 * ── THE MAP SERVER'S ADDRESS IS NOT IN THE BUNDLE ──────────────────────────
 * It comes with the session (`bootstrap.maps.server`), through the widget
 * runtime (`registry/offline.ts`). The server's content policy allows that
 * one origin only while maps are on, so the bundle and the policy can never
 * disagree about where a browser may go.
 *
 * ── RTL ────────────────────────────────────────────────────────────────────
 * The map canvas is a fixed-LTR island (the same policy as the gantt timeline
 * and the choropleth tilegram): geography does not mirror — flipping it would
 * put Japan west of Portugal. The chrome around it (metric tabs, the list, the
 * drawing buttons) is logical-property flow and mirrors normally. Arabic and
 * Hebrew names on the map itself are joined and ordered by MapLibre.
 */


export interface MapBubbleProps {
  points: readonly GeoPoint[];
  /** Metric keys for the tabs; the first is the initial selection. */
  metrics?: readonly string[] | undefined;
  /** Already-translated tab labels, keyed by metric name. */
  metricLabels?: Readonly<Record<string, string>> | undefined;
  /** Where the map starts, as `[lat, lng]`. Without one, it fits what it draws. */
  center?: readonly [number, number] | undefined;
  zoom?: number | undefined;
  flyToOnClick?: boolean | undefined;
  topN?: number | undefined;
  /** `given` lists the points in their given order (a route's stops), up to `listMax`; `ranked` the top N by the metric. */
  listOrder?: 'ranked' | 'given' | undefined;
  /** How many rows a list in its given order shows before "and n more". Every point still has its pin. Default 200. */
  listMax?: number | undefined;
  /** False hides the figure beside each name (pins that count nothing). */
  showValues?: boolean | undefined;
  format?: ((value: number) => string) | undefined;
  onSelect?: ((point: GeoPoint) => void) | undefined;
  /**
   * Which of `points` is the one picked, by its place among them: its pin and
   * its row are drawn as chosen, and when the host changes it the map goes to
   * that pin. Null is the host saying none is picked.
   */
  selected?: number | null | undefined;
  /**
   * A pin was dragged (or picked up, moved with the arrow keys and kept) to an
   * exact spot. Turns dragging on. Return the promise of the save: when it is
   * refused, or when the point has not moved once it settles, the pin goes
   * back to where it was.
   */
  onPlace?: ((point: GeoPoint, at: { lat: number; lng: number }) => unknown) | undefined;
  /** Areas drawn as filled outlines. */
  areas?: readonly MapArea[] | undefined;
  /**
   * An area was drawn (`id` null) or changed. Turns drawing on. A new shape is
   * a `Polygon`; a changed one keeps the kind it had, with its holes and its
   * further polygons as they were (only the outer ring of the first is changed here).
   */
  onAreaChange?: ((id: string | null, geometry: AreaGeometry) => unknown) | undefined;
  /** The way through the points, in their order: stops are numbered and joined. */
  route?: MapRoute | undefined;
  units?: DistanceUnits | undefined;
  /**
   * Which of `areas` is the one picked, by its id: drawn stronger, its name
   * marked, its row marked. When the host changes it the map brings that
   * area into view (and, where areas can be changed, it is the one changed).
   */
  selectedArea?: string | undefined;
  /** An area was picked on the map, or in the list. */
  onAreaSelect?: ((id: string) => void) | undefined;
  /**
   * False leaves the map's own list out: the host draws one itself. THE LIST
   * IS THE MAP'S ACCESSIBLE EQUIVALENT, and its stand-in while there is no
   * map; a host that says false has taken both on. See `guides/apps/kit-parts`.
   */
  list?: boolean | undefined;
  /**
   * A place with no position yet is being put on the map: the next click on
   * the map (or Enter with the map focused, or the button, for the cross at
   * its middle) is told to `onPlaceNew`. `name` is said in the line above.
   */
  placing?: { name: string } | undefined;
  /**
   * Where the place was put. Return the promise of the save: a pin stands on
   * the spot until it settles, and goes away if it is rejected.
   */
  onPlaceNew?: ((at: { lat: number; lng: number }) => unknown) | undefined;
  /** The person stopped placing (the button, or Escape with the map focused). */
  onPlacingStop?: (() => void) | undefined;
  /** The route's legs were asked for and did not come: said above the map, with "Try again" when `onRouteRetry` is given. */
  routeUnavailable?: boolean | undefined;
  onRouteRetry?: (() => void) | undefined;
  /**
   * Whether a place has a link out to a map of its position on a desk too.
   * On a phone every placed row has "Open in my maps app" (the device's
   * own), as before. With this, on a desk the PICKED place has a link to
   * OpenStreetMap's site in a new tab, while maps are on: a plain link,
   * followed only when pressed, carrying the position and nothing else.
   */
  siteLink?: boolean | undefined;
  /** What the map is doing: `loading`, `ready`, `unavailable` (the map server could not be reached) or `off`. */
  onStatus?: ((status: 'loading' | 'ready' | 'unavailable' | 'off') => void) | undefined;
  /**
   * Where Settings → Maps is, for a reader who may change it: the "switched
   * off" notice then links there. The host knows who may; the map does not.
   */
  settingsHref?: string | undefined;
  /** The host's own way to open that page (its router). Without one the notice is a plain link. */
  onSettingsOpen?: ((href: string) => void) | undefined;
  /**
   * Light or dark, said by a host that is not the dashboard (a page with no
   * `ThemeProvider`): the map's style follows this and not `<html data-theme>`.
   */
  theme?: 'light' | 'dark' | undefined;
  /**
   * Once the person has moved or zoomed the map themselves, the view is
   * theirs: new places are drawn where they are and the map does not go to
   * fit them. Without it the view follows the places whenever they change.
   */
  holdView?: boolean | undefined;
  /**
   * False where the host brings the map library's stylesheet itself (held
   * under a wrapper of its own): the library's sheet is then not fetched.
   */
  librarySheet?: boolean | undefined;
  emptyTitle?: string | undefined;
  emptyBody?: string | undefined;
  mapUnavailableLabel?: string | undefined;
  regionsLabel?: string | undefined;
  locale?: string | undefined;
  testId?: string | undefined;
}

/** The resolved theme right now, read off the attribute ThemeProvider stamps. */
function currentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** A finger is the pointer: the list offers the device's own maps app. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(pointer: coarse)');
    const read = (): void => setCoarse(query.matches);
    read();
    query.addEventListener?.('change', read);
    return () => query.removeEventListener?.('change', read);
  }, []);
  return coarse;
}

/** The area being drawn or changed. */
interface AreaDraft {
  /** The area's id; null for one that is new. */
  id: string | null;
  corners: Corner[];
  closed: boolean;
  selected: number | null;
  /**
   * The shape the corners were taken from. Its holes and its further polygons
   * are kept, and drawn, while its outer ring is changed. Null for a shape
   * that is new, or started again.
   */
  source: AreaGeometry | null;
}

/** The size of a pin that stands for a place and counts nothing. */
const PLAIN_PIN_RADIUS = 9;

/** The key of the pin that stands where a place was just put. */
const PENDING_PIN = 'placing';

/** How long the host's saying a pick back counts as the same pick. */
const ECHO_MS = 1500;

const NEW_DRAFT: AreaDraft = { id: null, corners: [], closed: false, selected: null, source: null };

/** How many rows a list in its given order shows. */
export const LIST_MAX = 200;

function draftOf(area: MapArea): AreaDraft {
  const corners = cornersOf(area.geometry);
  return { id: area.id, corners, closed: corners.length >= MIN_CORNERS, selected: null, source: area.geometry };
}

/** `idle` until the style arrives; `unavailable` once the map server counts as unreachable. */
type MapStatus = 'idle' | 'ready' | 'unavailable';

export function MapBubble({
  points,
  metrics,
  metricLabels,
  center,
  zoom,
  flyToOnClick = true,
  topN = 5,
  listOrder,
  listMax = LIST_MAX,
  showValues = true,
  format = String,
  onSelect,
  selected,
  onPlace,
  areas,
  onAreaChange,
  route,
  units = 'km',
  selectedArea,
  onAreaSelect,
  list = true,
  placing,
  onPlaceNew,
  onPlacingStop,
  routeUnavailable = false,
  onRouteRetry,
  siteLink = false,
  onStatus,
  settingsHref: settingsHrefProp,
  onSettingsOpen,
  theme: themeProp,
  holdView = false,
  librarySheet = true,
  emptyTitle,
  emptyBody,
  mapUnavailableLabel,
  regionsLabel,
  locale: localeProp,
  testId,
}: MapBubbleProps) {
  const t = useMaybeT();
  // Distances are written as the reader's language writes them, unless the caller names another.
  const language = useMaybeI18n()?.locale;
  const locale = localeOf(localeProp ?? language?.replace('_', '-'));
  const env = useWidgetRuntimeEnv();
  const server = mapServerOf(env);
  const settingsHref = settingsHrefProp ?? env.maps?.settingsHref;
  const coarse = useCoarsePointer();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MapEngine | null>(null);
  const [status, setStatus] = useState<MapStatus>('idle');
  /** How many times the person asked for the map again: each one builds it anew. */
  const [attempt, setAttempt] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** Where a place was just put, while its save is on its way. */
  const [pending, setPending] = useState<{ lat: number; lng: number } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // Where the host does not say which place is picked, and a picked place has a link out, the map keeps the pick itself.
  const [ownPicked, setOwnPicked] = useState<number | undefined>(undefined);
  const picked = selected === null ? undefined : (selected ?? (siteLink && ownPicked !== undefined && ownPicked < points.length ? ownPicked : undefined));

  const keys = metrics !== undefined && metrics.length > 0 ? metrics : metricKeysOf(points);
  const [metric, setMetric] = useState<string | undefined>(undefined);
  const activeMetric = metric !== undefined && keys.includes(metric) ? metric : keys[0];

  const shownAreas = useMemo(() => areas ?? [], [areas]);
  const editable = onAreaChange !== undefined;
  // One area (a record's own) is ready to change at once; with none, drawing
  // starts on the first click; among several, the person picks one.
  const [draft, setDraft] = useState<AreaDraft | null>(() =>
    !editable ? null : shownAreas.length === 0 ? NEW_DRAFT : shownAreas.length === 1 ? draftOf(shownAreas[0]!) : null,
  );
  const activeDraft = editable ? draft : null;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // What a screen reader is told as the map is worked: the region is in the
  // page from the start, empty, and each thing that happens is put into it.
  const [said, setSaid] = useState('');
  const tRef = useRef(t);
  tRef.current = t;
  // What the caller did with the shape it was handed: a new area comes back
  // with an id (the next change is to THAT area, not one more new one), and an
  // area taken away (the field was cleared) takes its drawing with it.
  const knownAreas = useRef(shownAreas.map((area) => area.id));
  useEffect(() => {
    const before = knownAreas.current;
    const now = shownAreas.map((area) => area.id);
    knownAreas.current = now;
    const current = draftRef.current;
    if (!editable || current === null) return;
    if (current.id === null) {
      const born = now.filter((id) => !before.includes(id));
      if (current.closed && born.length === 1) setDraft({ ...current, id: born[0]! });
      // Nothing drawn yet and the one area has arrived (a record that loaded
      // after the map did): that area is the one to change, not a second.
      else if (current.corners.length === 0 && shownAreas.length === 1) setDraft(draftOf(shownAreas[0]!));
    } else if (!now.includes(current.id)) {
      setDraft(now.length === 0 ? NEW_DRAFT : null);
    }
  }, [shownAreas, editable]);
  const movable = onPlace !== undefined;
  const formatRef = useRef(format);
  formatRef.current = format;

  const order = listOrder ?? (route === undefined ? 'ranked' : 'given');
  const plottable = useMemo(() => plottablePoints(points), [points]);
  const spread = useMemo(() => spreadPins(plottable.map((point) => ({ lat: point.lat as number, lng: point.lng as number }))), [plottable]);
  // A stop's number is its place among the points it was given: the list
  // numbers every row, so a pin after a stop with no position keeps its own.
  const stopOf = useMemo(() => plottable.map((point) => points.indexOf(point)), [plottable, points]);

  /** A drive time in words ("1 hr 12 min drive"); null where the routing server gave none (a straight line has no time). */
  const driveText = (leg: RouteLeg | undefined): string | null => {
    const seconds = legDuration(leg);
    return seconds === null ? null : t('ui:widgets.geo.mapBubble.legDrive', '{duration} drive', { duration: formatDuration(seconds, locale) });
  };

  /** A leg's length in words, with its drive time where one is known; null where there is no leg to speak of. */
  const legText = (stop: number): string | null => {
    if (route === undefined || stop === 0) return null;
    const leg = route.legs[stop - 1];
    const distance = legDistance(leg, units);
    if (distance.kind === 'unknown') return t('ui:widgets.geo.mapBubble.legUnknown', 'distance from the stop before unknown');
    const figure = formatDistance(distance, locale);
    const length =
      distance.kind === 'about'
        ? t('ui:widgets.geo.mapBubble.legAbout', 'about {distance} from the stop before', { distance: figure })
        : t('ui:widgets.geo.mapBubble.legExact', '{distance} from the stop before', { distance: figure });
    const drive = driveText(leg);
    return drive === null ? length : `${length} · ${drive}`;
  };

  /** The whole way in words, where every leg has a length; null where one does not (a sum that leaves a leg out is not the whole way). */
  const totalText = (): string | null => {
    if (route === undefined) return null;
    // Every stop must have its pin: a leg to a stop with no position is not in the answer.
    const whole = plottable.length === points.length ? routeTotal(route.legs, points.length) : null;
    if (whole === null) return null;
    const distance = legDistance(whole, units);
    if (distance.kind === 'unknown') return null;
    const figure = formatDistance(distance, locale);
    const length =
      distance.kind === 'about'
        ? t('ui:widgets.geo.mapBubble.totalAbout', 'The whole way: about {distance}', { distance: figure })
        : t('ui:widgets.geo.mapBubble.totalExact', 'The whole way: {distance}', { distance: figure });
    const drive = driveText(whole);
    return drive === null ? length : `${length} · ${drive}`;
  };

  const byTownLabel = t('ui:widgets.geo.mapBubble.byTown', 'by town');

  // ── the scene the engine draws ─────────────────────────────────────────────
  const scene = useMemo<Scene>(() => {
    const max = activeMetric === undefined ? 0 : maxMetric(plottable, activeMetric);
    const pins: ScenePin[] = plottable.map((point, index) => {
      const value = activeMetric === undefined ? 0 : metricValue(point, activeMetric);
      const town = point.by === 'town';
      const stop = (stopOf[index] ?? index) + 1;
      const parts = [route === undefined ? point.name : `${stop}. ${point.name}`];
      if (showValues && route === undefined && activeMetric !== undefined) parts[0] = `${parts[0]}: ${formatRef.current(value)}`;
      if (point.group !== undefined && point.group.trim() !== '') parts.push(point.group.trim());
      if (town) parts.push(byTownLabel);
      if (movable) parts.push(t('ui:widgets.geo.mapBubble.pinMoveHint', 'Drag to the exact spot. With the keyboard: Enter picks the pin up, the arrow keys move it, Enter keeps the spot and Escape puts it back.'));
      return {
        key: String(index),
        lat: point.lat as number,
        lng: point.lng as number,
        dx: spread[index]?.dx ?? 0,
        dy: spread[index]?.dy ?? 0,
        // Pins that count nothing are all one modest size; a figure sizes a bubble.
        radius: showValues ? bubbleRadius(value, max) : PLAIN_PIN_RADIUS,
        label: parts.join(' · '),
        hollow: town,
        ...(route === undefined ? {} : { number: stop }),
        movable,
        ...(point.tone === undefined ? {} : { tone: point.tone }),
        ...(paletteIndex(point.colour) === null ? {} : { colour: paletteIndex(point.colour) as number }),
        ...(picked !== undefined && stopOf[index] === picked ? { selected: true } : {}),
      };
    });
    // A place just put on the map stands there, marked, until its save has settled.
    if (pending !== null && placing !== undefined) {
      pins.push({ key: PENDING_PIN, lat: pending.lat, lng: pending.lng, dx: 0, dy: 0, radius: PLAIN_PIN_RADIUS, label: placing.name, hollow: false, movable: false, selected: true });
    }
    const line =
      route === undefined
        ? null
        : route.line !== undefined && route.line.coordinates.length >= 2
          ? { coordinates: route.line.coordinates, dashed: false }
          : { coordinates: straightLine(plottable.map((point) => ({ lat: point.lat as number, lng: point.lng as number }))).coordinates, dashed: true };
    return {
      pins,
      areas: shownAreas
        .filter((area) => activeDraft === null || area.id !== activeDraft.id)
        .map((area) => ({
          id: area.id,
          geometry: area.geometry,
          tone: area.tone ?? 'accent',
          ...(paletteIndex(area.colour) === null ? {} : { colour: paletteIndex(area.colour) as number }),
          ...(area.name === undefined ? {} : { name: area.name }),
          ...(area.id === selectedArea ? { selected: true } : {}),
        })),
      line,
      placing: placing !== undefined,
      editor:
        activeDraft === null
          ? null
          : {
              corners: activeDraft.corners,
              closed: activeDraft.closed,
              selected: activeDraft.selected,
              shape: activeDraft.closed ? withOuterRing(activeDraft.source, activeDraft.corners) : null,
              cornerLabel: (number) => t('ui:widgets.geo.mapBubble.cornerLabel', 'Corner {number}', { number: String(number) }),
            },
    };
    // `format` is read through a ref: a new function identity alone is not a new scene.
  }, [plottable, spread, stopOf, activeMetric, route, showValues, movable, picked, selectedArea, placing, pending, shownAreas, activeDraft, byTownLabel, t]);

  // Latest inputs, readable from the engine's callbacks without making them a
  // dependency of the mount effect (which must not rebuild a live map: a
  // re-created map loses the view and fetches every picture again).
  const live = useRef({ points, plottable, scene, flyToOnClick, onSelect, onPlace, onAreaChange, onAreaSelect, placing, onPlaceNew, onPlacingStop, center, zoom, shownAreas, route, themeProp, librarySheet });
  live.current = { points, plottable, scene, flyToOnClick, onSelect, onPlace, onAreaChange, onAreaSelect, placing, onPlaceNew, onPlacingStop, center, zoom, shownAreas, route, themeProp, librarySheet };
  /** What the person picked on the map a moment ago: the host saying the same back is not a reason to move the view. */
  const pickedHere = useRef<{ pin?: number; area?: string; at: number }>({ at: 0 });
  /** Set while a drag is being saved: the view must not jump to re-fit it. */
  const keepView = useRef(false);
  /**
   * Let the view follow the places again once a save has settled. A save that
   * changed the places used the hold up already; one that was refused, or
   * changed nothing that is fitted (a corner moved), would keep it for ever
   * and the next real change would not be fitted.
   */
  const releaseView = useCallback((saved: unknown) => {
    const settled = (): void => {
      setTimeout(() => {
        keepView.current = false;
      }, SETTLE_MS);
    };
    Promise.resolve(saved).then(settled, settled);
  }, []);

  /** A change to the shape being drawn; a closed shape is handed to the caller. */
  const changeDraft = useCallback((change: (draft: AreaDraft) => AreaDraft) => {
    const current = draftRef.current;
    if (current === null) return;
    const next = change(current);
    if (next === current) return;
    draftRef.current = next;
    setDraft(next);
    if (next.closed && !current.closed) setSaid(tRef.current('ui:widgets.geo.mapBubble.saidShapeClosed', 'Shape closed.'));
    else if (!next.closed && next.corners.length > current.corners.length) {
      setSaid(tRef.current('ui:widgets.geo.mapBubble.saidCornerAdded', 'Corner added. {count, plural, one {# corner} other {# corners}}.', { count: next.corners.length }));
    }
    if (!next.closed || next.corners === current.corners) return;
    // The ring that was changed goes back into the shape it came from: its holes and its other polygons stay.
    const shape = withOuterRing(next.source, next.corners);
    if (shape === null) return;
    keepView.current = true;
    let saved: unknown;
    try {
      saved = live.current.onAreaChange?.(next.id, shape);
    } finally {
      releaseView(saved);
    }
  }, [releaseView]);

  /** A place put on the map: a pin stands there while the host saves it, and goes if the save is refused. */
  const placeNew = useCallback(
    (corner: Corner) => {
      const now = live.current;
      if (now.placing === undefined || now.onPlaceNew === undefined || pendingRef.current !== null) return;
      const { name } = now.placing;
      const at = { lat: corner[1], lng: corner[0] };
      pendingRef.current = at;
      setPending(at);
      keepView.current = true;
      let saved: unknown;
      try {
        saved = now.onPlaceNew(at);
      } catch (error) {
        saved = Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      const done = (kept: boolean) => (): void => {
        pendingRef.current = null;
        setPending(null);
        setSaid(
          kept
            ? tRef.current('ui:widgets.geo.mapBubble.saidPlaced', '{name} placed at {position}.', { name, position: coordinateText(at) })
            : tRef.current('ui:widgets.geo.mapBubble.saidPlaceRefused', '{name} was not placed.', { name }),
        );
      };
      Promise.resolve(saved).then(done(true), done(false));
      releaseView(saved);
    },
    [releaseView],
  );

  const words = useMemo(
    () => ({
      'NavigationControl.ZoomIn': t('ui:widgets.geo.mapBubble.zoomIn', 'Zoom in'),
      'NavigationControl.ZoomOut': t('ui:widgets.geo.mapBubble.zoomOut', 'Zoom out'),
      'Map.Title': t('ui:widgets.geo.mapBubble.mapLabel', 'Map'),
    }),
    [t],
  );
  const wordsRef = useRef(words);
  wordsRef.current = words;

  // The canvas is in the tree only while there is something to draw on it and
  // a server to draw it from; the effect below follows both.
  const hasCanvas = points.length > 0 || shownAreas.length > 0 || editable || placing !== undefined;
  const drawsMap = server !== null && hasCanvas && status !== 'unavailable';

  useEffect(() => {
    const container = containerRef.current;
    // Maps off: no import, no request, no map. See the file header, state (c).
    if (server === null || !hasCanvas || container === null || typeof window === 'undefined') return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setStatus('idle');

    const giveUp = (): void => {
      if (cancelled) return;
      engineRef.current?.destroy();
      engineRef.current = null;
      setStatus('unavailable');
    };

    void (async () => {
      let lib: MapLibreModule;
      let engines: typeof import('./map-engine.js');
      try {
        // THE MapLibre boundary — see the file header. Nothing else in this
        // package may name 'maplibre-gl'.
        [lib, engines] = await Promise.all([import('maplibre-gl'), import('./map-engine.js')]);
        // MapLibre's worker, built into this app and served from its own
        // origin. Separately guarded, like the stylesheet: a runner with no
        // bundler must not take the map down with it.
        try {
          const worker = await import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url');
          lib.setWorkerUrl(worker.default);
        } catch {
          /* No bundler (vitest): MapLibre looks beside its own module. */
        }
        if (live.current.librarySheet) {
          try {
            await import('maplibre-gl/dist/maplibre-gl.css');
          } catch {
            /* CSS stubbed (vitest) or inlined by the host — the map still works. */
          }
        }
      } catch {
        giveUp();
        return;
      }
      if (cancelled) return;

      try {
        const now = live.current;
        const engine = engines.createMapEngine(lib, container, {
          style: mapStyleUrl(server, now.themeProp ?? currentTheme()),
          center: now.center,
          zoom: now.zoom,
          words: wordsRef.current,
          handlers: {
            onStatus: (next) => {
              if (cancelled) return;
              if (next === 'unavailable') giveUp();
              else setStatus('ready');
            },
            onPinPick: (key) => {
              const point = live.current.plottable[Number(key)];
              if (point === undefined) return;
              pickedHere.current = { pin: live.current.points.indexOf(point), at: Date.now() };
              setOwnPicked(pickedHere.current.pin);
              if (live.current.flyToOnClick) engine.flyTo({ lat: point.lat as number, lng: point.lng as number });
              live.current.onSelect?.(point);
            },
            onPinPlace: (key, at) => {
              const point = live.current.plottable[Number(key)];
              if (point === undefined) return;
              keepView.current = true;
              setSaid(tRef.current('ui:widgets.geo.mapBubble.saidPinKept', 'Pin kept at {position}.', { position: coordinateText(at) }));
              return live.current.onPlace?.(point, at);
            },
            onPinMove: (_key, what) =>
              setSaid(
                what === 'picked'
                  ? tRef.current('ui:widgets.geo.mapBubble.saidPinPicked', 'Pin picked up. Move it with the arrow keys, then press Enter to keep the spot or Escape to put it back.')
                  : what === 'back'
                    ? tRef.current('ui:widgets.geo.mapBubble.saidPinBack', 'The pin is back where it was.')
                    : tRef.current('ui:widgets.geo.mapBubble.saidPinRefused', 'The new spot was not kept. The pin is back where it was.'),
              ),
            onPinSettled: () => {
              keepView.current = false;
            },
            onMapPick: (corner) => {
              // Placing comes first: while a place is being put on the map, a click is never a corner.
              if (live.current.placing !== undefined) placeNew(corner);
              else changeDraft((current) => (current.closed ? current : { ...current, corners: addCorner(current.corners, corner) }));
            },
            onPlacingStop: () => live.current.onPlacingStop?.(),
            onAreaPick: (id) => {
              if (live.current.onAreaSelect !== undefined) {
                pickedHere.current = { area: id, at: Date.now() };
                live.current.onAreaSelect(id);
              }
              if (live.current.onAreaChange === undefined) return;
              const area = live.current.shownAreas.find((candidate) => candidate.id === id);
              if (area !== undefined) setDraft((current) => (current !== null && !current.closed && current.corners.length > 0 ? current : draftOf(area)));
            },
            onCornerPick: (index) =>
              changeDraft((current) =>
                // The first corner, picked while drawing, closes the shape.
                !current.closed && index === 0 && canClose(current.corners) ? { ...current, corners: [...current.corners], closed: true, selected: null } : { ...current, selected: current.selected === index ? null : index },
              ),
            onCornerMove: (index, corner) => changeDraft((current) => ({ ...current, corners: moveCorner(current.corners, index, corner), selected: index })),
            onCornerRemove: (index) =>
              changeDraft((current) => {
                const corners = removeCorner(current.corners, index, current.closed);
                return corners.length === current.corners.length ? current : { ...current, corners, selected: null };
              }),
          },
        });
        engineRef.current = engine;
        engine.draw(now.scene);
        const bounds = boundsOf(
          now.plottable.map((point) => ({ lat: point.lat as number, lng: point.lng as number })),
          now.shownAreas,
          now.route?.line,
        );
        if (bounds !== null) engine.fit(bounds);

        // The style follows the theme. `subscribeTheme` fires AFTER
        // ThemeProvider stamps <html>, so `currentTheme()` above and this
        // agree; an accent change alone repaints the areas and the route.
        let theme = currentTheme();
        unsubscribe = subscribeTheme((resolved) => {
          // A host that says the theme itself is followed by the effect below, not by the dashboard's.
          if (live.current.themeProp !== undefined) return;
          const next = resolved.theme === 'dark' ? 'dark' : 'light';
          if (next === theme) {
            engine.repaint();
            return;
          }
          theme = next;
          engine.setStyle(mapStyleUrl(server, next));
        });
      } catch {
        // No WebGL, no layout (a jsdom-class environment): the list stands in.
        giveUp();
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      engineRef.current?.destroy();
      engineRef.current = null;
    };
    // ONLY THE SERVER AND WHETHER THERE IS A CANVAS, ON PURPOSE. `center`/`zoom`
    // are the INITIAL view: re-running this on a config change would tear the
    // map down and rebuild it under a user who has panned. Live inputs reach
    // the engine through `live` + the redraw effect below instead.
    // `attempt` is the person's "Try again": the same map, built anew.
  }, [server, hasCanvas, changeDraft, placeNew, attempt]);

  // The host hears what the map is doing: a row's "Place it" needs a map that is there.
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const told = server === null ? 'off' : !hasCanvas || status === 'idle' ? 'loading' : status;
  useEffect(() => {
    onStatusRef.current?.(told);
  }, [told]);

  // ── select-and-frame from outside ──────────────────────────────────────────
  // The host said which pin is picked (a row of its own list was pressed): the
  // map goes to it, as it does for a pin pressed on the map itself. Not at the
  // start (the map fits everything), and not when the host only says back what
  // the person just picked here.
  const framedPin = useRef(selected);
  useEffect(() => {
    if (framedPin.current === selected) return;
    framedPin.current = selected;
    if (selected === undefined || selected === null) return;
    const mine = pickedHere.current;
    if (mine.pin === selected && Date.now() - mine.at < ECHO_MS) return;
    const point = points[selected];
    if (point?.lat === undefined || point.lng === undefined) return;
    engineRef.current?.flyTo({ lat: point.lat, lng: point.lng });
  }, [selected, points]);
  const framedArea = useRef(selectedArea);
  useEffect(() => {
    if (framedArea.current === selectedArea) return;
    framedArea.current = selectedArea;
    const area = shownAreas.find((candidate) => candidate.id === selectedArea);
    if (area === undefined) return;
    // Where areas can be changed, the picked one is the one to change: what the list's "Change" did, for a host with a list of its own.
    if (editable) setDraft((current) => (current !== null && !current.closed && current.corners.length > 0 ? current : current?.id === area.id ? current : draftOf(area)));
    const mine = pickedHere.current;
    if (mine.area === selectedArea && Date.now() - mine.at < ECHO_MS) return;
    const bounds = boundsOf([], [area]);
    if (bounds !== null) engineRef.current?.frame(bounds);
  }, [selectedArea, shownAreas, editable]);

  // Redraw when the scene changes. No-ops until the map is there.
  useEffect(() => {
    engineRef.current?.draw(scene);
  }, [scene, status]);

  // The host's own theme changed: the other style, on the map that is there.
  const styledFor = useRef(themeProp);
  useEffect(() => {
    if (styledFor.current === themeProp) return;
    styledFor.current = themeProp;
    if (server !== null && themeProp !== undefined) engineRef.current?.setStyle(mapStyleUrl(server, themeProp));
  }, [themeProp, server]);

  // Fit again when the places themselves change (a town was typed, rows
  // arrived) — and not when the change is the person's own drag.
  const fitKey = useMemo(
    () => `${plottable.map((point) => `${point.lat},${point.lng}`).join(';')}|${shownAreas.map((area) => `${area.id}:${pointCount(area.geometry)}`).join(';')}`,
    [plottable, shownAreas],
  );
  const fittedKey = useRef(fitKey);
  useEffect(() => {
    if (fittedKey.current === fitKey) return;
    fittedKey.current = fitKey;
    if (keepView.current) {
      keepView.current = false;
      return;
    }
    // The person's own view is kept, where the host asked for that.
    if (holdView && engineRef.current?.movedByPerson() === true) return;
    const bounds = boundsOf(
      plottable.map((point) => ({ lat: point.lat as number, lng: point.lng as number })),
      shownAreas,
      route?.line,
    );
    if (bounds !== null) engineRef.current?.fit(bounds);
  }, [fitKey, plottable, shownAreas, route, holdView]);

  if (!hasCanvas) {
    return (
      <EmptyState
        compact
        preset="no-data"
        title={emptyTitle ?? t('ui:widgets.geo.mapBubble.emptyTitle', 'No locations')}
        body={emptyBody ?? t('ui:widgets.geo.mapBubble.emptyBody', 'Rows with latitude and longitude values appear here as map markers.')}
      />
    );
  }

  const given = order === 'given';
  // A list in its given order stops at `listMax` rows and says how many more there are; every point still has its pin.
  const shownMax = Math.max(0, Math.floor(listMax));
  const more = given ? Math.max(0, points.length - shownMax) : 0;
  const listed =
    given
      ? points.slice(0, shownMax).map((point, index) => ({ point, value: activeMetric === undefined ? 0 : metricValue(point, activeMetric), stop: index }))
      : topN > 0 && activeMetric !== undefined
        ? [...points]
            .map((point, index) => ({ point, value: metricValue(point, activeMetric), stop: index }))
            .sort((a, b) => b.value - a.value || a.point.name.localeCompare(b.point.name, locale))
            .slice(0, topN)
        : [];
  const sharedOf = (point: GeoPoint): number => {
    const at = plottable.indexOf(point);
    return at === -1 ? 1 : (spread[at]?.shared ?? 1);
  };
  const apple = typeof navigator !== 'undefined' && isAppleDevice(navigator.userAgent, navigator.maxTouchPoints);
  /** The person asked for the map again: it is built anew, and the focus stays in the map's own box. */
  const retry = (): void => {
    setSaid(t('ui:widgets.geo.mapBubble.saidTrying', 'Trying the map again.'));
    setStatus('idle');
    setAttempt((count) => count + 1);
    rootRef.current?.focus();
  };
  const total = totalText();
  /** The way out to a map of one position: the device's own app on a phone, OpenStreetMap's site on a desk while maps are on. */
  const linkOut = (point: GeoPoint, className: string): ReactNode => {
    if (point.lat === undefined || point.lng === undefined) return null;
    if (coarse) {
      return (
        <a data-part="geo-maps-app" href={mapsAppHref({ lat: point.lat, lng: point.lng, name: point.name }, apple)} className={className}>
          {t('ui:widgets.geo.mapBubble.openInMaps', 'Open in my maps app')}
        </a>
      );
    }
    if (!siteLink || server === null) return null;
    return (
      // A new tab, told nothing of where it was opened from: the address holds the position and no more.
      <a data-part="geo-maps-site" href={mapsSiteHref({ lat: point.lat, lng: point.lng })} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={className}>
        {t('ui:widgets.geo.mapBubble.openOnMapsSite', 'Open on OpenStreetMap (new tab)')}
      </a>
    );
  };
  const pickedPoint = picked === undefined ? undefined : points[picked];
  const pickedLink = !list && pickedPoint !== undefined ? linkOut(pickedPoint, 'font-medium text-accent underline underline-offset-2') : null;
  const listLabel =
    regionsLabel ??
    (route !== undefined
      ? t('ui:widgets.geo.mapBubble.stopsLabel', 'Stops')
      : given
        ? t('ui:widgets.geo.mapBubble.placesLabel', 'Places')
        : t('ui:widgets.geo.mapBubble.regionsLabel', 'Top regions'));

  return (
    <div
      ref={rootRef}
      // Takes the focus when "Try again" goes away with its notice, so the keyboard is not sent back to the top of the page.
      tabIndex={-1}
      data-widget="map-bubble"
      data-testid={testId}
      data-map-status={server === null ? 'off' : status}
      className="flex h-full min-w-0 flex-col gap-3 px-[var(--widget-pad)] pb-[var(--widget-pad)] outline-none"
    >
      {keys.length > 1 && (
        <SegmentedControl
          data-part="metric-tabs"
          aria-label={t('ui:widgets.geo.mapBubble.metricLabel', 'Metric')}
          options={keys.map((key) => ({ value: key, label: metricLabels?.[key] ?? key }))}
          value={activeMetric}
          onValueChange={setMetric}
        />
      )}

      {/* What happens on the map, for a screen reader: in the page from the start, filled as things happen. */}
      <p data-part="map-said" role="status" className="sr-only">
        {said}
      </p>

      {server === null ? (
        <StatusNote data-part="map-off" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-body-sm text-fg-muted">
          {t('ui:widgets.geo.mapBubble.mapsOffLabel', 'Maps are switched off. Here is the list.')}
          {settingsHref !== undefined && (
            <>
              {' '}
              <a
                href={settingsHref}
                data-part="map-off-link"
                className="font-medium text-accent underline underline-offset-2"
                onClick={(event) => {
                  // The host's router, when it gave one: a plain link loads the whole app again.
                  // A click meant for a new tab or window is left to the browser.
                  if (onSettingsOpen === undefined || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onSettingsOpen(settingsHref);
                }}
              >
                {t('ui:widgets.geo.mapBubble.mapsOffLink', 'Open Settings → Maps')}
              </a>
            </>
          )}
        </StatusNote>
      ) : status === 'unavailable' ? (
        <div data-part="map-unavailable-box" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <StatusNote data-part="map-unavailable" className="min-w-0 flex-1 basis-48 text-body-sm text-fg-muted">
            {mapUnavailableLabel ?? t('ui:widgets.geo.mapBubble.mapUnavailableLabel', 'The map could not be reached. Here is the list.')}
          </StatusNote>
          <Button type="button" size="sm" variant="secondary" data-part="map-retry" onClick={retry}>
            {t('ui:widgets.geo.mapBubble.tryAgain', 'Try again')}
          </Button>
        </div>
      ) : null}

      {route !== undefined && routeUnavailable && (
        <div data-part="route-unavailable-box" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <StatusNote data-part="route-unavailable" className="min-w-0 flex-1 basis-48 text-body-sm text-fg-muted">
            {t('ui:widgets.geo.mapBubble.routeUnavailable', 'The way between the stops could not be worked out, so the distances are unknown.')}
          </StatusNote>
          {onRouteRetry !== undefined && (
            <Button type="button" size="sm" variant="secondary" data-part="route-retry" onClick={onRouteRetry}>
              {t('ui:widgets.geo.mapBubble.tryAgain', 'Try again')}
            </Button>
          )}
        </div>
      )}

      {drawsMap && placing !== undefined && (
        <div data-part="map-placing" className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 basis-48 text-caption text-fg-muted">
            {t(
              'ui:widgets.geo.mapBubble.placingHint',
              'Click the map where {name} is. With the keyboard: focus the map, move it with the arrow keys, and press Enter to put {name} under the cross.',
              { name: placing.name },
            )}
          </p>
          <Button
            type="button"
            size="sm"
            variant="primary"
            data-part="map-place-middle"
            disabled={pending !== null}
            onClick={() => {
              const at = engineRef.current?.center();
              if (at !== undefined) placeNew(at);
            }}
          >
            {t('ui:widgets.geo.mapBubble.placeAtMiddle', 'Place it at the middle of the map')}
          </Button>
          {onPlacingStop !== undefined && (
            <Button type="button" size="sm" variant="ghost" data-part="map-placing-stop" onClick={onPlacingStop}>
              {t('ui:widgets.geo.mapBubble.placingStop', 'Stop placing')}
            </Button>
          )}
        </div>
      )}

      {drawsMap && placing === undefined && activeDraft !== null && (
        <div data-part="area-tools" className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 basis-48 text-caption text-fg-muted">
            {activeDraft.closed
              ? t('ui:widgets.geo.mapBubble.areaChangeHint', 'Drag a corner to move it. Pick a corner to remove it or to add one after it.')
              : t('ui:widgets.geo.mapBubble.areaDrawHint', 'Click the map to add the corners of the area, then close the shape.')}
            {activeDraft.closed && hasOtherPieces(activeDraft.source) && (
              <span data-part="area-pieces-hint">
                {' '}
                {t(
                  'ui:widgets.geo.mapBubble.areaPiecesHint',
                  'This area has a hole or more than one piece. Those stay as they are while you change this outline. “Start again” replaces the whole area with one new shape.',
                )}
              </span>
            )}
          </p>
          {!activeDraft.closed && (
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-part="area-add-corner"
                onClick={() => {
                  const at = engineRef.current?.center();
                  if (at !== undefined) changeDraft((current) => ({ ...current, corners: addCorner(current.corners, at) }));
                }}
              >
                {t('ui:widgets.geo.mapBubble.areaAddCornerHere', 'Add a corner at the middle of the map')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="primary"
                data-part="area-close"
                disabled={!canClose(activeDraft.corners)}
                onClick={() => changeDraft((current) => ({ ...current, corners: [...current.corners], closed: true, selected: null }))}
              >
                {t('ui:widgets.geo.mapBubble.areaClose', 'Close the shape')}
              </Button>
            </>
          )}
          {activeDraft.closed && (
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-part="area-insert-corner"
                disabled={activeDraft.selected === null}
                onClick={() =>
                  changeDraft((current) => (current.selected === null ? current : { ...current, corners: insertCorner(current.corners, current.selected), selected: current.selected + 1 }))
                }
              >
                {t('ui:widgets.geo.mapBubble.areaInsertCorner', 'Add a corner after this one')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-part="area-remove-corner"
                disabled={activeDraft.selected === null || activeDraft.corners.length <= MIN_CORNERS}
                onClick={() =>
                  changeDraft((current) => (current.selected === null ? current : { ...current, corners: removeCorner(current.corners, current.selected, true), selected: null }))
                }
              >
                {t('ui:widgets.geo.mapBubble.areaRemoveCorner', 'Remove this corner')}
              </Button>
            </>
          )}
          {activeDraft.corners.length > 0 && (
            <Button type="button" size="sm" variant="ghost" data-part="area-restart" onClick={() => setDraft({ ...NEW_DRAFT, id: activeDraft.id })}>
              {t('ui:widgets.geo.mapBubble.areaRestart', 'Start again')}
            </Button>
          )}
          {shownAreas.length > 1 && (
            <Button type="button" size="sm" variant="ghost" data-part="area-done" onClick={() => setDraft(null)}>
              {t('ui:widgets.geo.mapBubble.areaDone', 'Done')}
            </Button>
          )}
        </div>
      )}
      {drawsMap && placing === undefined && editable && activeDraft === null && (
        <div data-part="area-tools" className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 basis-48 text-caption text-fg-muted">{t('ui:widgets.geo.mapBubble.areaPickHint', 'Pick an area on the map or in the list to change it.')}</p>
          <Button type="button" size="sm" variant="secondary" data-part="area-new" onClick={() => setDraft(NEW_DRAFT)}>
            {t('ui:widgets.geo.mapBubble.areaNew', 'Draw a new area')}
          </Button>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-wrap items-stretch gap-3">
        {/* THE LTR ISLAND. Geography never mirrors — a flipped world
            map is a wrong map, not a localized one. */}
        {drawsMap && (
          <div dir="ltr" className="relative min-h-[20rem] min-w-0 flex-[2] basis-64 overflow-hidden rounded-lg border border-border">
            {/* The map's own stylesheet makes its container `position: relative`,
                so the box that fills the frame is this one and the map fills it. */}
            <div className="absolute inset-0">
              <div ref={containerRef} data-part="map-canvas" className="size-full" />
            </div>
          </div>
        )}

        {/* The host draws the list itself: the picked place still has its way out to a maps app. */}
        {pickedLink !== null && (
          <p data-part="geo-picked-link" className="basis-full text-caption text-fg-muted">
            <span className="text-fg">{pickedPoint?.name}</span>
            {' · '}
            {pickedLink}
          </p>
        )}

        {list && (listed.length > 0 || more > 0 || shownAreas.length > 0) && (
        <div className="flex min-w-0 flex-1 basis-40 flex-col gap-3">
          {/* The list: the map's companion, its stand-in when there is no map,
              and its accessible equivalent — a canvas of pins is unreadable to a
              screen reader, so the same places are real, focusable text. */}
          {listed.length > 0 && (
            <ol data-part="geo-ranking" aria-label={listLabel} className="min-w-0 space-y-1.5">
              {listed.map(({ point, value, stop }, index) => {
                const shared = point.by === 'town' ? sharedOf(point) : 1;
                const leg = legText(stop);
                const placed = point.lat !== undefined && point.lng !== undefined;
                return (
                  <li key={`${stop}:${point.name}`} className="min-w-0">
                    <button
                      type="button"
                      data-part="geo-ranking-row"
                      aria-current={stop === picked ? 'true' : undefined}
                      onClick={() => {
                        setOwnPicked(stop);
                        onSelect?.(point);
                      }}
                      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1 text-start text-body-sm hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent aria-[current=true]:bg-surface-2"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {paletteIndex(point.colour) === null ? (
                          <MapPin aria-hidden="true" className="size-3 shrink-0 text-fg-subtle" />
                        ) : (
                          // The pin's own colour and outline, so the row and its pin are matched by eye.
                          <span
                            aria-hidden="true"
                            data-part="geo-swatch"
                            className="size-3 shrink-0 rounded-[var(--swatch-shape,9999px)] bg-[var(--swatch,transparent)]"
                            style={{ '--swatch': `var(--viz-${(paletteIndex(point.colour) as number) + 1})`, '--swatch-shape': PALETTE_SHAPES[paletteIndex(point.colour) as number] ?? '9999px' }}
                          />
                        )}
                        <span className="text-fg-subtle tabular-nums">{index + 1}.</span>
                        <span className="truncate text-fg-muted">{point.name}</span>
                        {point.group !== undefined && point.group.trim() !== '' && (
                          <span data-part="geo-group" className="shrink-0 text-caption text-fg-subtle">
                            {point.group.trim()}
                          </span>
                        )}
                        {point.by === 'town' && (
                          <span data-part="geo-by-town" className="shrink-0 rounded-sm border border-dashed border-border px-1 text-caption text-fg-subtle">
                            {byTownLabel}
                          </span>
                        )}
                      </span>
                      {showValues && route === undefined && <span className="shrink-0 font-medium tabular-nums text-fg">{format(value)}</span>}
                    </button>
                    {(shared > 1 || leg !== null) && (
                      <p data-part="geo-row-note" className="px-2 ps-7 text-caption text-fg-subtle">
                        {[
                          leg,
                          shared > 1
                            ? t('ui:widgets.geo.mapBubble.sharedTown', '{count, plural, one {# place is} other {# places are}} known only by this town', { count: shared })
                            : null,
                        ]
                          .filter((part) => part !== null)
                          .join(' · ')}
                      </p>
                    )}
                    {/* On a phone every placed row has its way out; on a desk the picked row alone, so a long list is not a list of links. */}
                    {placed && (coarse || stop === picked) && linkOut(point, 'ms-7 inline-block px-2 py-1 text-caption font-medium text-accent underline underline-offset-2')}
                  </li>
                );
              })}
            </ol>
          )}
          {total !== null && (
            <p data-part="geo-route-total" className="px-2 text-body-sm font-medium text-fg">
              {total}
            </p>
          )}
          {more > 0 && (
            <p data-part="geo-list-more" className="px-2 text-caption text-fg-subtle">
              {t('ui:widgets.geo.mapBubble.listMore', 'and {count, plural, one {# more} other {# more}}', { count: more })}
            </p>
          )}

          {shownAreas.length > 0 && (
            <ul data-part="geo-areas" aria-label={t('ui:widgets.geo.mapBubble.areasLabel', 'Areas')} className="min-w-0 space-y-1.5">
              {shownAreas.map((area, index) => {
                const name = area.name ?? t('ui:widgets.geo.mapBubble.areaUnnamed', 'Area {number}', { number: String(index + 1) });
                const count = t('ui:widgets.geo.mapBubble.areaPoints', '{count, plural, one {# point} other {# points}}', { count: pointCount(area.geometry) });
                return (
                  <li key={area.id} data-part="geo-area-row" aria-current={area.id === selectedArea ? 'true' : undefined} className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1 text-body-sm aria-[current=true]:bg-surface-2">
                    {onAreaSelect === undefined ? (
                      <span className="min-w-0 truncate text-fg-muted">{name}</span>
                    ) : (
                      <button
                        type="button"
                        data-part="geo-area-pick"
                        aria-pressed={area.id === selectedArea}
                        onClick={() => onAreaSelect(area.id)}
                        className="min-w-0 truncate rounded-sm text-start text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        {name}
                      </button>
                    )}
                    <span className="flex shrink-0 items-center gap-2 text-caption text-fg-subtle">
                      {count}
                      {drawsMap && editable && activeDraft?.id !== area.id && (
                        <Button type="button" size="sm" variant="ghost" data-part="area-change" aria-label={`${t('ui:widgets.geo.mapBubble.areaChange', 'Change')}: ${name}`} onClick={() => setDraft(draftOf(area))}>
                          {t('ui:widgets.geo.mapBubble.areaChange', 'Change')}
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
