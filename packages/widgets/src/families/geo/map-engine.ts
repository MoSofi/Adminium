// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The drawing half of the map: given the map library (handed over by the one
 * file that may load it, `MapBubble.tsx`) and a scene, it keeps a live map in
 * step — pins, areas, a route, and the corners of an area being drawn.
 *
 * NO IMPORT OF THE MAP LIBRARY HERE, only its types through the owner. This
 * module is itself reached by the owner's dynamic `import()`, so none of it
 * is fetched while maps are switched off.
 *
 * Pins and corners are real buttons (the library's DOM markers), so they take
 * focus, a finger and the keyboard, and their colours are the page's own CSS
 * variables: they follow the theme with no redraw. Areas and lines are drawn
 * by the library on its canvas, which cannot read a CSS variable, so their
 * colours are read off the page and re-read when the theme changes.
 */
import type { MapLibreModule } from './maplibre-module.js';
import { SETTLE_MS } from './map-shapes.js';
import type { AreaGeometry, AreaTone, Bounds, Corner } from './map-shapes.js';

type LibMap = InstanceType<MapLibreModule['Map']>;
type LibMarker = InstanceType<MapLibreModule['Marker']>;
type GeoJSONSource = InstanceType<MapLibreModule['GeoJSONSource']>;
type SourceData = Parameters<GeoJSONSource['setData']>[0];

export interface ScenePin {
  key: string;
  lat: number;
  lng: number;
  /** Pixels away from the position (pins that share one). */
  dx: number;
  dy: number;
  /** The pin's size on screen, as a radius in pixels. */
  radius: number;
  /** Said by a screen reader and shown on hover. */
  label: string;
  /** Placed by its town only: drawn hollow, with a dashed edge. */
  hollow: boolean;
  /** A stop's number on a route; drawn inside the pin. */
  number?: number | undefined;
  /** The pin can be dragged, or picked up and moved with the keyboard, to the exact spot. */
  movable: boolean;
  /** The colour the pin is drawn in. Default `accent`. */
  tone?: AreaTone | undefined;
  /** The one that is picked: drawn filled, with a ring round it. */
  selected?: boolean | undefined;
}

export interface SceneArea {
  id: string;
  geometry: AreaGeometry;
  tone: AreaTone;
}

export interface SceneEditor {
  corners: readonly Corner[];
  closed: boolean;
  selected: number | null;
  /**
   * The whole shape while a closed one is changed: the corners are its one
   * editable ring, and its holes and further polygons are drawn with it.
   * Absent ⇒ the corners alone are the shape.
   */
  shape?: AreaGeometry | null | undefined;
  /** The label of a corner, by its number from 1. */
  cornerLabel: (number: number) => string;
}

export interface Scene {
  pins: readonly ScenePin[];
  areas: readonly SceneArea[];
  line: { coordinates: number[][]; dashed: boolean } | null;
  editor: SceneEditor | null;
}

export interface EngineHandlers {
  /** The style arrived (`ready`), or the map server could not be reached. */
  onStatus: (status: 'ready' | 'unavailable') => void;
  onPinPick: (key: string) => void;
  /**
   * A pin was dropped on a new spot, or kept there with the keyboard. What
   * comes back may be the promise of the save: once it settles, a pin the
   * scene has not moved (the save was refused, or changed nothing) goes back
   * to where it was.
   */
  onPinPlace: (key: string, at: { lat: number; lng: number }) => unknown;
  /**
   * What became of a pin: `picked` up with the keyboard, put `back` by the
   * person, or sent back because its new spot was not kept (`refused`).
   */
  onPinMove?: ((key: string, what: 'picked' | 'back' | 'refused') => void) | undefined;
  /** A placing has settled, kept or not: the view may follow the places again. */
  onPinSettled?: (() => void) | undefined;
  /** A click on the map itself, while an area is being drawn. */
  onMapPick: (corner: Corner) => void;
  onAreaPick: (id: string) => void;
  onCornerPick: (index: number) => void;
  onCornerMove: (index: number, corner: Corner) => void;
  onCornerRemove: (index: number) => void;
}

export interface EngineOptions {
  style: string;
  center: readonly [number, number] | undefined;
  zoom: number | undefined;
  /** The words of the map's own buttons, in the reader's language. */
  words: Record<string, string>;
  handlers: EngineHandlers;
}

export interface MapEngine {
  draw(scene: Scene): void;
  setStyle(style: string): void;
  /** Read the page's colours again (the accent changed). */
  repaint(): void;
  /** Bring everything into view. A single position is shown at town scale. */
  fit(bounds: Bounds, animate?: boolean): void;
  flyTo(at: { lat: number; lng: number }): void;
  /** Where the middle of the view is: where the keyboard adds a corner. */
  center(): Corner;
  /** The person has moved or zoomed the map themselves (a drag, a pinch, the +/− buttons, a double click). */
  movedByPerson(): boolean;
  destroy(): void;
}

/** How long the style may take before the map server counts as unreachable. */
export const STYLE_TIMEOUT_MS = 12_000;
/** How many map pictures may fail, with none arrived, before it does. */
const TILE_FAILURES = 2;
/** One press of an arrow key, in pixels (with Shift, ten times as far). */
const KEY_STEP = 4;

/** The whole world, roughly framed: where a map with a centre and no zoom starts. */
const DEFAULT_START_ZOOM = 1;

const AREA_SOURCE = 'adminium-areas';
const LINE_SOURCE = 'adminium-route';
const DRAFT_SOURCE = 'adminium-draft';

const TONE_VAR: Record<AreaTone, string> = {
  neutral: '--fg-muted',
  accent: '--accent',
  pos: '--pos',
  warn: '--warn',
  danger: '--danger',
  info: '--info',
};

/**
 * A token's value as the page computes it. A token may hold what only an
 * element can work out (`light-dark(…)`, another `var(…)`), which a canvas
 * cannot read: a probe inside the container takes it as its colour, and the
 * browser's own answer is what is drawn. Where that says nothing (no layout),
 * the token's text stands.
 */
function computedColour(container: HTMLElement, variable: string, value: string): string {
  if (!/light-dark\(|var\(/.test(value)) return value;
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = `var(${variable})`;
  container.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed === '' ? value : computed;
}

/** A CSS colour as the canvas draws it, whatever notation the token uses. */
function paintOf(container: HTMLElement, variable: string): string {
  const fallback = '#4f46e5';
  try {
    const raw = getComputedStyle(container).getPropertyValue(variable).trim();
    if (raw === '') return fallback;
    const value = computedColour(container, variable, raw);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return fallback;
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return fallback;
  }
}

function styleButton(element: HTMLElement): void {
  const style = element.style;
  style.appearance = 'none';
  style.padding = '0';
  style.margin = '0';
  style.boxSizing = 'border-box';
  style.display = 'flex';
  style.alignItems = 'center';
  style.justifyContent = 'center';
  style.borderRadius = '9999px';
  style.cursor = 'pointer';
  style.touchAction = 'none';
  style.outlineOffset = '2px';
  element.addEventListener('focus', () => {
    if (element.matches(':focus-visible')) style.outline = '2px solid var(--accent)';
  });
  element.addEventListener('blur', () => {
    style.outline = 'none';
  });
}

function pinElement(pin: ScenePin): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  // One pin at a time is in the tab order (`applyRoving`).
  element.tabIndex = -1;
  element.dataset['part'] = 'map-pin';
  element.dataset['pin'] = pin.key;
  if (pin.hollow) element.dataset['by'] = 'town';
  element.title = pin.label;
  element.setAttribute('aria-label', pin.label);
  styleButton(element);
  const numbered = pin.number !== undefined;
  const size = Math.max(numbered ? 24 : 12, Math.round(pin.radius * 2));
  const style = element.style;
  style.width = `${size}px`;
  style.height = `${size}px`;
  style.font = '600 12px/1 var(--font-sans, system-ui, sans-serif)';
  paintPin(element, pin);
  if (numbered) element.textContent = String(pin.number);
  return element;
}

/**
 * A pin's colours, and whether it is the one picked. Apart from the button's
 * making, so that picking a pin repaints the button it has: a new button
 * would drop a drag in the middle and lose the focus.
 */
function paintPin(element: HTMLElement, pin: ScenePin): void {
  const tone = pin.tone ?? 'accent';
  const colour = `var(${TONE_VAR[tone]})`;
  const picked = pin.selected === true;
  const style = element.style;
  if (pin.hollow) {
    // By town: the position is the town's, not the place's own. Hollow and
    // dashed, so nobody reads it as "this is the door".
    style.border = `2px dashed ${colour}`;
    style.background = 'color-mix(in srgb, var(--surface) 80%, transparent)';
    style.color = colour;
  } else if (pin.number !== undefined) {
    style.border = '2px solid var(--surface)';
    style.background = colour;
    style.color = tone === 'accent' ? 'var(--accent-fg)' : 'var(--surface)';
  } else {
    style.border = `1.5px solid ${colour}`;
    style.background = picked ? colour : `color-mix(in srgb, ${colour} 35%, transparent)`;
    style.color = colour;
  }
  style.boxShadow = picked ? `0 0 0 3px color-mix(in srgb, ${colour} 40%, transparent)` : '';
  if (picked) {
    element.dataset['selected'] = '';
    element.setAttribute('aria-current', 'true');
  } else {
    delete element.dataset['selected'];
    element.removeAttribute('aria-current');
  }
}

/** A pin as it is drawn, but for whether it is the one picked. */
function lookOf(pin: ScenePin): string {
  return JSON.stringify({ ...pin, selected: false });
}

function cornerElement(label: string, selected: boolean, first: boolean): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.dataset['part'] = 'map-corner';
  element.title = label;
  element.setAttribute('aria-label', label);
  element.setAttribute('aria-pressed', String(selected));
  styleButton(element);
  // A finger-sized target around a small visible dot.
  element.style.width = '32px';
  element.style.height = '32px';
  element.style.background = 'transparent';
  element.style.border = '0';
  const dot = document.createElement('span');
  dot.style.display = 'block';
  dot.style.width = selected ? '16px' : '12px';
  dot.style.height = selected ? '16px' : '12px';
  dot.style.borderRadius = first ? '3px' : '9999px';
  dot.style.border = '2px solid var(--accent)';
  dot.style.background = selected ? 'var(--accent)' : 'var(--surface)';
  element.append(dot);
  return element;
}

/** The arrow keys as a step in pixels; null for any other key. */
function arrowStep(event: KeyboardEvent): [number, number] | null {
  const step = event.shiftKey ? KEY_STEP * 10 : KEY_STEP;
  switch (event.key) {
    case 'ArrowLeft':
      return [-step, 0];
    case 'ArrowRight':
      return [step, 0];
    case 'ArrowUp':
      return [0, -step];
    case 'ArrowDown':
      return [0, step];
    default:
      return null;
  }
}

export function createMapEngine(lib: MapLibreModule, container: HTMLElement, options: EngineOptions): MapEngine {
  const { handlers } = options;
  // With no start given the view fits what is drawn; with a zoom alone it
  // centres on it at that zoom; with a centre it stays where it was put.
  const fitMode: 'fit' | 'center' | 'none' = options.center !== undefined ? 'none' : options.zoom === undefined ? 'fit' : 'center';
  // The library's zoom 0 is the zoom 1 of the 256-pixel tiles this prop was written for.
  const startZoom = options.zoom === undefined ? (options.center === undefined ? 1 : DEFAULT_START_ZOOM) : Math.max(0, options.zoom - 1);
  const map: LibMap = new lib.Map({
    container,
    style: options.style,
    center: options.center === undefined ? [0, 20] : [options.center[1], options.center[0]],
    zoom: startZoom,
    // The map lives in a scrolling page: taking the wheel to zoom a map the
    // reader only scrolled PAST is hostile, so zoom is on the +/− buttons,
    // a pinch, and a double click.
    scrollZoom: false,
    // Flat, north up: a tilted or turned map of customers helps nobody here.
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    // The credit to OpenStreetMap and the map server stays in sight.
    attributionControl: { compact: false },
    locale: options.words,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');

  let alive = true;
  let styleReady = false;
  let readySaid = false;
  let failed = false;
  let tilesIn = 0;
  let tilesFailed = 0;
  let scene: Scene = { pins: [], areas: [], line: null, editor: null };
  let pinMarkers = new Map<string, { marker: LibMarker; pin: ScenePin }>();
  let cornerMarkers: LibMarker[] = [];
  let cornersDrawn = '';
  /** The pin the Tab key lands on: the one last focused, else the first. */
  let roving: string | null = null;

  const fail = (): void => {
    if (!alive || failed) return;
    failed = true;
    handlers.onStatus('unavailable');
  };
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(fail, STYLE_TIMEOUT_MS);
  const stopTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  // ── the canvas half: areas, the route, the shape being drawn ─────────────

  function feature(geometry: unknown, properties: Record<string, unknown>): Record<string, unknown> {
    return { type: 'Feature', geometry, properties };
  }
  function collection(features: Record<string, unknown>[]): SourceData {
    return { type: 'FeatureCollection', features } as unknown as SourceData;
  }

  function source(id: string, data: SourceData): boolean {
    const existing = map.getSource(id) as GeoJSONSource | undefined;
    if (existing !== undefined) {
      existing.setData(data);
      return false;
    }
    map.addSource(id, { type: 'geojson', data });
    return true;
  }

  function drawCanvas(): void {
    if (!alive || !styleReady) return;
    const accent = paintOf(container, '--accent');
    const surface = paintOf(container, '--surface');

    const areas = collection(scene.areas.map((area) => feature(area.geometry, { id: area.id, color: paintOf(container, TONE_VAR[area.tone]) })));
    if (source(AREA_SOURCE, areas)) {
      map.addLayer({ id: `${AREA_SOURCE}-fill`, type: 'fill', source: AREA_SOURCE, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.18 } });
      map.addLayer({ id: `${AREA_SOURCE}-line`, type: 'line', source: AREA_SOURCE, paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
    }

    const line = scene.line;
    const route = collection(line === null || line.coordinates.length < 2 ? [] : [feature({ type: 'LineString', coordinates: line.coordinates }, { dashed: line.dashed })]);
    if (source(LINE_SOURCE, route)) {
      const base = { type: 'line' as const, source: LINE_SOURCE, layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const } };
      map.addLayer({ ...base, id: `${LINE_SOURCE}-casing`, paint: { 'line-color': surface, 'line-width': 6, 'line-opacity': 0.8 } });
      map.addLayer({ ...base, id: `${LINE_SOURCE}-road`, filter: ['!', ['get', 'dashed']], paint: { 'line-color': accent, 'line-width': 3 } });
      // A straight leg is a guess at the way: dashed, never a solid road.
      map.addLayer({ ...base, id: `${LINE_SOURCE}-straight`, filter: ['get', 'dashed'], paint: { 'line-color': accent, 'line-width': 3, 'line-dasharray': [1, 2] } });
    } else {
      map.setPaintProperty(`${LINE_SOURCE}-casing`, 'line-color', surface);
      map.setPaintProperty(`${LINE_SOURCE}-road`, 'line-color', accent);
      map.setPaintProperty(`${LINE_SOURCE}-straight`, 'line-color', accent);
    }

    const editor = scene.editor;
    const corners = editor === null ? [] : editor.corners.map((corner) => [corner[0], corner[1]]);
    const draft: Record<string, unknown>[] = [];
    // A closed shape is drawn whole: its holes and its further polygons with the ring being changed.
    if (editor !== null && editor.closed && corners.length >= 3) draft.push(feature(editor.shape ?? { type: 'Polygon', coordinates: [[...corners, corners[0]]] }, {}));
    else if (corners.length >= 2) draft.push(feature({ type: 'LineString', coordinates: corners }, {}));
    if (source(DRAFT_SOURCE, collection(draft))) {
      map.addLayer({ id: `${DRAFT_SOURCE}-fill`, type: 'fill', source: DRAFT_SOURCE, filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]], paint: { 'fill-color': accent, 'fill-opacity': 0.22 } });
      map.addLayer({ id: `${DRAFT_SOURCE}-line`, type: 'line', source: DRAFT_SOURCE, paint: { 'line-color': accent, 'line-width': 2.5 } });
    } else {
      map.setPaintProperty(`${DRAFT_SOURCE}-fill`, 'fill-color', accent);
      map.setPaintProperty(`${DRAFT_SOURCE}-line`, 'line-color', accent);
    }
    map.getCanvas().style.cursor = editor !== null && !editor.closed ? 'crosshair' : '';
  }

  // ── the DOM half: pins and corners ───────────────────────────────────────

  /** Where a marker's button is drawn, its pixel offset included. */
  function shown(marker: LibMarker, dx: number, dy: number): { lat: number; lng: number } {
    const at = map.project(marker.getLngLat());
    const moved = map.unproject([at.x + dx, at.y + dy]);
    return { lat: moved.lat, lng: moved.lng };
  }

  /** One tab stop for all the pins: the one last focused, else the first. */
  function applyRoving(): void {
    if (roving === null || !pinMarkers.has(roving)) roving = pinMarkers.keys().next().value ?? null;
    for (const [key, { marker }] of pinMarkers) marker.getElement().tabIndex = key === roving ? 0 : -1;
  }

  /** The pin a key goes to from this one, in the scene's order (the list's); null for any other key. */
  function neighbourOf(key: string, event: KeyboardEvent): HTMLElement | null {
    const keys = [...pinMarkers.keys()];
    const at = keys.indexOf(key);
    if (at === -1 || keys.length < 2) return null;
    let to: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        to = (at + 1) % keys.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        to = (at + keys.length - 1) % keys.length;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = keys.length - 1;
        break;
      default:
        return null;
    }
    return pinMarkers.get(keys[to] as string)?.marker.getElement() ?? null;
  }

  /**
   * Hand a pin's new spot over, and look again once the save has settled: a
   * marker that is still the scene's own was not moved by it (the save was
   * refused, or the caller changed nothing), so it goes back.
   */
  function place(marker: LibMarker, pin: ScenePin): void {
    let result: unknown;
    try {
      result = handlers.onPinPlace(pin.key, shown(marker, pin.dx, pin.dy));
    } catch {
      result = undefined;
    }
    const settled = (): void => {
      setTimeout(() => {
        if (!alive) return;
        if (pinMarkers.get(pin.key)?.marker === marker) {
          marker.setLngLat([pin.lng, pin.lat]);
          handlers.onPinMove?.(pin.key, 'refused');
        }
        handlers.onPinSettled?.();
      }, SETTLE_MS);
    };
    Promise.resolve(result).then(settled, settled);
  }

  function drawPins(): void {
    const next = new Map<string, { marker: LibMarker; pin: ScenePin }>();
    let refocus: HTMLElement | null = null;
    for (const pin of scene.pins) {
      const previous = pinMarkers.get(pin.key);
      // A pin whose look is unchanged keeps its button, and with it the focus
      // and a drag in the middle. Being picked, or no longer, repaints that button.
      if (previous !== undefined && lookOf(previous.pin) === lookOf(pin)) {
        if ((previous.pin.selected === true) !== (pin.selected === true)) paintPin(previous.marker.getElement(), pin);
        next.set(pin.key, { marker: previous.marker, pin });
        pinMarkers.delete(pin.key);
        continue;
      }
      const element = pinElement(pin);
      const marker = new lib.Marker({ element, offset: [pin.dx, pin.dy], draggable: pin.movable }).setLngLat([pin.lng, pin.lat]).addTo(map);
      let dragged = false;
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        if (dragged) {
          dragged = false;
          return;
        }
        handlers.onPinPick(pin.key);
      });
      element.addEventListener('focus', () => {
        roving = pin.key;
        applyRoving();
      });
      // The keyboard's drag has a mode of its own, because the arrow keys also
      // go from pin to pin: Enter or Space picks the pin up, the arrows then
      // move it, Enter keeps the new spot and Escape puts it back.
      let held = false;
      const putBack = (): void => {
        held = false;
        marker.setLngLat([pin.lng, pin.lat]);
        handlers.onPinMove?.(pin.key, 'back');
      };
      element.addEventListener('keydown', (event) => {
        const pressed = event.key === 'Enter' || event.key === ' ';
        if (held) {
          const step = arrowStep(event);
          if (step !== null) {
            event.preventDefault();
            event.stopPropagation();
            const at = map.project(marker.getLngLat());
            marker.setLngLat(map.unproject([at.x + step[0], at.y + step[1]]));
          } else if (pressed) {
            event.preventDefault();
            event.stopPropagation();
            held = false;
            place(marker, pin);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            putBack();
          }
          return;
        }
        const neighbour = neighbourOf(pin.key, event);
        if (neighbour !== null) {
          event.preventDefault();
          event.stopPropagation();
          neighbour.focus();
        } else if (arrowStep(event) !== null) {
          // The only pin: nowhere to go, and the map must not pan under the focus.
          event.preventDefault();
          event.stopPropagation();
        } else if (pin.movable && pressed) {
          // Not a click: on a pin that can be moved, the key picks it up.
          event.preventDefault();
          event.stopPropagation();
          held = true;
          handlers.onPinMove?.(pin.key, 'picked');
        }
      });
      if (pin.movable) {
        // Space clicks a button when it is let go: that click is not a pick.
        element.addEventListener('keyup', (event) => {
          if (event.key === ' ') event.preventDefault();
        });
        marker.on('dragstart', () => {
          dragged = true;
        });
        marker.on('dragend', () => place(marker, pin));
        element.addEventListener('blur', () => {
          if (held) putBack();
        });
      }
      if (previous !== undefined && document.activeElement === previous.marker.getElement()) refocus = element;
      next.set(pin.key, { marker, pin });
    }
    for (const { marker } of pinMarkers.values()) marker.remove();
    pinMarkers = next;
    // A redrawn pin that had the focus keeps it, on its new button.
    refocus?.focus();
    applyRoving();
  }

  function drawCorners(): void {
    const editor = scene.editor;
    // Unchanged corners keep their buttons: a redraw in the middle of a drag would drop it.
    const drawn = editor === null ? '' : JSON.stringify([editor.corners, editor.closed, editor.selected]);
    if (drawn === cornersDrawn) return;
    cornersDrawn = drawn;
    const focusedAt = cornerMarkers.findIndex((marker) => marker.getElement() === document.activeElement);
    for (const marker of cornerMarkers) marker.remove();
    cornerMarkers = [];
    if (editor === null) return;
    editor.corners.forEach((corner, index) => {
      const element = cornerElement(editor.cornerLabel(index + 1), editor.selected === index, index === 0 && !editor.closed);
      const marker = new lib.Marker({ element, draggable: true }).setLngLat([corner[0], corner[1]]).addTo(map);
      let dragged = false;
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        if (dragged) {
          dragged = false;
          return;
        }
        handlers.onCornerPick(index);
      });
      marker.on('dragstart', () => {
        dragged = true;
      });
      marker.on('dragend', () => {
        const at = marker.getLngLat();
        handlers.onCornerMove(index, [at.lng, at.lat]);
      });
      element.addEventListener('keydown', (event) => {
        const step = arrowStep(event);
        if (step !== null) {
          event.preventDefault();
          event.stopPropagation();
          const at = map.project(marker.getLngLat());
          const moved = map.unproject([at.x + step[0], at.y + step[1]]);
          handlers.onCornerMove(index, [moved.lng, moved.lat]);
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          event.stopPropagation();
          handlers.onCornerRemove(index);
        }
      });
      cornerMarkers.push(marker);
    });
    // A corner moved by the keyboard is redrawn: the focus goes to its new button.
    cornerMarkers[focusedAt]?.getElement().focus();
  }

  // ── what the map itself tells us ─────────────────────────────────────────

  map.on('style.load', () => {
    if (!alive) return;
    stopTimer();
    styleReady = true;
    drawCanvas();
    if (!readySaid && !failed) {
      readySaid = true;
      handlers.onStatus('ready');
    }
  });
  map.on('data', (event) => {
    if ((event as { tile?: unknown }).tile !== undefined) tilesIn += 1;
  });
  map.on('error', (event) => {
    if (!alive) return;
    // Before the style is in, any failure is "the map server cannot be
    // reached". After it, only map pictures failing with none ever arrived.
    if (!styleReady) {
      stopTimer();
      fail();
      return;
    }
    if ((event as { tile?: unknown; sourceId?: unknown }).tile === undefined) return;
    tilesFailed += 1;
    if (tilesIn === 0 && tilesFailed >= TILE_FAILURES) fail();
  });
  // A move the person made carries the event of their hand; one this code made (a fit) carries none.
  let personMoved = false;
  map.on('movestart', (event) => {
    if ((event as { originalEvent?: unknown }).originalEvent !== undefined) personMoved = true;
  });
  map.on('click', (event) => {
    const editor = scene.editor;
    if (editor !== null && !editor.closed) {
      handlers.onMapPick([event.lngLat.lng, event.lngLat.lat]);
      return;
    }
    if (!styleReady || map.getLayer(`${AREA_SOURCE}-fill`) === undefined) return;
    const hit = map.queryRenderedFeatures(event.point, { layers: [`${AREA_SOURCE}-fill`] })[0];
    const id = hit?.properties?.['id'];
    if (typeof id === 'string') handlers.onAreaPick(id);
  });

  return {
    draw(next) {
      if (!alive) return;
      scene = next;
      drawPins();
      drawCorners();
      drawCanvas();
    },
    setStyle(style) {
      if (!alive) return;
      // The custom layers go with the old style; `style.load` draws them again.
      styleReady = false;
      stopTimer();
      timer = setTimeout(fail, STYLE_TIMEOUT_MS);
      map.setStyle(style, { diff: false });
    },
    repaint() {
      drawCanvas();
    },
    fit(bounds, animate = false) {
      if (!alive || fitMode === 'none') return;
      const [[west, south], [east, north]] = bounds;
      if (fitMode === 'center') {
        map.jumpTo({ center: [(west + east) / 2, (south + north) / 2], zoom: startZoom });
        return;
      }
      if (west === east && south === north) {
        map.jumpTo({ center: [west, south], zoom: Math.max(map.getZoom(), 10) });
        return;
      }
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, animate });
    },
    flyTo(at) {
      if (alive) map.flyTo({ center: [at.lng, at.lat], zoom: Math.max(map.getZoom(), 5) });
    },
    center() {
      const at = map.getCenter();
      return [at.lng, at.lat];
    },
    movedByPerson() {
      return personMoved;
    },
    destroy() {
      alive = false;
      stopTimer();
      for (const { marker } of pinMarkers.values()) marker.remove();
      for (const marker of cornerMarkers) marker.remove();
      pinMarkers = new Map();
      cornerMarkers = [];
      try {
        map.remove();
      } catch {
        /* Already torn down. */
      }
    },
  };
}
