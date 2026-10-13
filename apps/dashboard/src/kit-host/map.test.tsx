// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The map, as an app's own screen mounts it: plain data in, a handle out.
 *
 * Worth proving: the pins and the list stand under the kit's wrapper and the
 * map is drawn from the server the app named; with maps switched off nothing
 * of the map library is touched and no request is made; a map server that
 * does not answer leaves the list under its notice; a pick reaches the app by
 * the pin's id and is kept; `update` never builds the map again, leaves the
 * person's view alone and keeps a pin's own button; a pin moved by keyboard
 * reaches the app as (id, spot) and stays when the save holds; a save the
 * app answers `{ refused }` (or rejects) puts the pin back with the reason
 * above the map; a route is asked of the app once per set of stops; and the
 * map asks for no word outside its set, in any language, plurals included.
 *
 * MapLibre is a fake here, as in the widgets' own tests: happy-dom has no
 * WebGL. A pointer drag, the real styles and the real map server's policy are
 * a browser's to prove (apps/e2e/tests/kit-parts.spec.ts).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KitMounted, KitRefused, MapAreaGeometry, MapPin, MapProps, MapStop, MapWay } from './contract.js';
import { mount } from './index.js';
import { clearOutsideWords, KIT_LOCALES, outsideWords } from './words.js';

/* A library just big enough to drive; `imports` and `maps` count every touch. */
const fake = vi.hoisted(() => {
  type Handler = (event: Record<string, unknown>) => void;
  class FakeMap {
    handlers = new Map<string, Handler[]>();
    sources = new Map<string, { data: unknown; setData: (data: unknown) => void }>();
    layers: string[] = [];
    removed = false;
    fitted: unknown[] = [];
    styles: string[] = [];
    touchZoomRotate = { disableRotation: (): void => undefined };
    constructor(public options: { container: HTMLElement; style: string }) {
      state.maps.push(this);
      this.styles.push(options.style);
    }
    on(type: string, handler: Handler): this {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
      return this;
    }
    fire(type: string, event: Record<string, unknown> = {}): void {
      for (const handler of this.handlers.get(type) ?? []) handler(event);
    }
    addControl(): this {
      return this;
    }
    getSource(id: string): unknown {
      return this.sources.get(id);
    }
    addSource(id: string, source: { data: unknown }): void {
      const held = { data: source.data, setData: (data: unknown): void => void (held.data = data) };
      this.sources.set(id, held);
    }
    addLayer(layer: { id: string }): void {
      this.layers.push(layer.id);
    }
    getLayer(id: string): unknown {
      return this.layers.includes(id) ? { id } : undefined;
    }
    setPaintProperty(): void {}
    canvas: HTMLElement | undefined;
    getCanvas(): HTMLElement {
      return (this.canvas ??= document.createElement('canvas'));
    }
    // One pixel is a hundredth of a degree, y growing south.
    project(at: { lng: number; lat: number }): { x: number; y: number } {
      return { x: at.lng * 100, y: -at.lat * 100 };
    }
    unproject(point: [number, number]): { lng: number; lat: number } {
      return { lng: point[0] / 100 || 0, lat: -point[1] / 100 || 0 };
    }
    fitBounds(bounds: unknown): void {
      this.fitted.push(bounds);
    }
    jumpTo(view: unknown): void {
      this.fitted.push(view);
    }
    flown: unknown[] = [];
    flyTo(view: unknown): void {
      this.flown.push(view);
    }
    getZoom(): number {
      return 3;
    }
    getCenter(): { lng: number; lat: number } {
      return { lng: 10, lat: 20 };
    }
    setStyle(style: string): void {
      this.styles.push(style);
    }
    queryRenderedFeatures(): unknown[] {
      return [];
    }
    remove(): void {
      this.removed = true;
    }
  }
  class FakeMarker {
    at = { lng: 0, lat: 0 };
    element: HTMLElement;
    constructor(public options: { element: HTMLElement; draggable?: boolean }) {
      this.element = options.element;
    }
    setLngLat(at: [number, number] | { lng: number; lat: number }): this {
      this.at = Array.isArray(at) ? { lng: at[0], lat: at[1] } : at;
      return this;
    }
    getLngLat(): { lng: number; lat: number } {
      return this.at;
    }
    addTo(map: FakeMap): this {
      map.options.container.append(this.element);
      (this.element as HTMLElement & { marker?: FakeMarker }).marker = this;
      return this;
    }
    getElement(): HTMLElement {
      return this.element;
    }
    on(): this {
      return this;
    }
    remove(): void {
      this.element.remove();
    }
  }
  const state = {
    imports: 0,
    maps: [] as FakeMap[],
    library: { Map: FakeMap, Marker: FakeMarker, NavigationControl: class {}, setWorkerUrl: (): void => undefined },
  };
  return state;
});

// The library as the widgets package itself resolves it: this package does not depend on it and cannot name it bare.
vi.mock('../../node_modules/@adminium/widgets/node_modules/maplibre-gl', () => {
  fake.imports += 1;
  return fake.library;
});

const SERVER = 'https://maps.example.test';
const ON = { enabled: true, server: SERVER, routing: false };
const OFF = { enabled: false, server: null, routing: false };
const PINS: MapPin[] = [
  { id: 'c1', label: 'Harbour Cafe', lat: 52.52, lng: 13.4 },
  { id: 'c2', label: 'Second Wind', lat: 48.85, lng: 2.35, tone: 'pos' },
  { id: 'c3', label: 'Third Coast', lat: 41.9, lng: 12.5 },
];

let host: HTMLElement;
let mounted: KitMounted<MapProps> | null = null;
let fetched: { mock: { calls: unknown[][] }; mockRestore(): void };

beforeEach(() => {
  clearOutsideWords();
  fake.imports = 0;
  fake.maps.length = 0;
  fetched = vi.spyOn(globalThis, 'fetch');
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  act(() => mounted?.unmount());
  mounted = null;
  host.remove();
  fetched.mockRestore();
  // The gate: nothing drawn in this file asked for a word the map does not carry.
  expect(outsideWords()).toEqual([]);
});

async function map(props: Partial<MapProps> = {}): Promise<void> {
  await act(async () => {
    mounted = await mount('map', host, { maps: ON, pins: PINS, locale: 'en-US', dir: 'ltr', ...props });
  });
}

/** The map built and its style arrived: the state a person sees a map in. */
async function ready(props: Partial<MapProps> = {}): Promise<(typeof fake.maps)[number]> {
  await map(props);
  await waitFor(() => expect(fake.maps).toHaveLength(1));
  const built = fake.maps[0]!;
  act(() => built.fire('style.load'));
  await waitFor(() => expect(statusOf()).toBe('ready'));
  return built;
}

async function update(change: Partial<MapProps>): Promise<void> {
  await act(async () => {
    mounted!.update(change);
  });
}

const statusOf = (): string | null | undefined => host.querySelector('[data-widget="map-bubble"]')?.getAttribute('data-map-status');
const pin = (label: string): HTMLElement => host.querySelector<HTMLElement>(`[data-part="map-pin"][aria-label^="${label}"]`)!;
const spotOf = (label: string): { lng: number; lat: number } => (pin(label) as HTMLElement & { marker: { at: { lng: number; lat: number } } }).marker.at;
const rows = (): string[] => [...host.querySelectorAll('[data-part="geo-ranking-row"]')].map((row) => row.textContent ?? '');
const row = (label: string): HTMLElement => [...host.querySelectorAll<HTMLElement>('[data-part="geo-ranking-row"]')].find((el) => el.textContent?.includes(label))!;
const said = (): string => host.querySelector('[data-part="map-said"]')?.textContent ?? '';
const refused = (): HTMLElement | null => host.querySelector('[data-part="map-refused"]');

/** Picks a pin up, steps it east and keeps the spot; back once the save's answer has been heard. */
async function moveByKeys(label: string, steps = 1): Promise<void> {
  const el = pin(label);
  act(() => el.focus());
  fireEvent.keyDown(el, { key: 'Enter' });
  for (let step = 0; step < steps; step += 1) fireEvent.keyDown(el, { key: 'ArrowRight' });
  await act(async () => {
    fireEvent.keyDown(el, { key: 'Enter' });
  });
}

describe('the map, mounted', () => {
  it('stands under the kit’s wrapper, drawn from the server the app named, with a pin and a row for each place', async () => {
    const built = await ready({ ariaLabel: 'Customers' });
    const wrapper = host.querySelector('.adm-kit');
    expect(wrapper?.getAttribute('data-kit-part')).toBe('map');
    expect(wrapper?.getAttribute('dir')).toBe('ltr');
    expect(screen.getByRole('group', { name: 'Customers' })).toBeTruthy();
    expect(built.options.style).toBe(`${SERVER}/styles/positron`);
    expect(host.querySelectorAll('[data-part="map-pin"]')).toHaveLength(3);
    expect(pin('Second Wind')).toBeTruthy();
    expect(rows()).toEqual(['1.Harbour Cafe', '2.Second Wind', '3.Third Coast']);
    expect(screen.getByRole('list', { name: 'Places' })).toBeTruthy();
    // A pin's own colour is the tone the app named, as the kit's sheet fills it inside the map's box.
    expect(pin('Second Wind').style.color).toBe('var(--pos)');
    expect(pin('Harbour Cafe').style.color).toBe('var(--accent)');
    // The geography is an island that never mirrors, and nothing was asked of this Adminium.
    expect(host.querySelector('[data-part="map-canvas"]')?.closest('[dir]')?.getAttribute('dir')).toBe('ltr');
    expect(fetched).not.toHaveBeenCalled();
  });

  it('leaves out a pin with no position and says so in place of the map while there is none at all', async () => {
    await map({ pins: [{ id: 'x', label: 'Nowhere', lat: Number.NaN, lng: 13 }], emptyLabel: 'No customers on the map yet.' });
    expect(screen.getByText('No customers on the map yet.')).toBeTruthy();
    expect(host.querySelector('[data-part="map-canvas"]')).toBeNull();
    expect(fake.maps).toHaveLength(0);
  });

  it('switched off: the list under its notice, and nothing of the map is touched or asked', async () => {
    await map({ maps: OFF });
    await waitFor(() => expect(host.querySelector('[data-part="map-off"]')?.textContent).toBe('Maps are switched off. Here is the list.'));
    expect(statusOf()).toBe('off');
    expect(rows()).toHaveLength(3);
    expect(host.querySelector('[data-part="map-canvas"]')).toBeNull();
    expect(host.querySelector('[data-part="map-off-link"]')).toBeNull();
    // No map code was fetched, no map was built, and no request left the page.
    expect(fake.imports).toBe(0);
    expect(fake.maps).toHaveLength(0);
    expect(fetched).not.toHaveBeenCalled();
    // A row is still a pick.
    const onSelect = vi.fn();
    await update({ onSelect });
    fireEvent.click(row('Third Coast'));
    expect(onSelect).toHaveBeenCalledWith('c3');
  });

  it('switched off with an address still written: the switch is what counts', async () => {
    await map({ maps: { enabled: false, server: SERVER } });
    await waitFor(() => expect(statusOf()).toBe('off'));
    expect(fake.imports).toBe(0);
  });

  it('gives the person who may switch maps on a plain link to where that is done', async () => {
    await map({ maps: OFF, settingsHref: '/settings/maps' });
    const link = await waitFor(() => host.querySelector<HTMLAnchorElement>('[data-part="map-off-link"]')!);
    expect(link.getAttribute('href')).toBe('/settings/maps');
    expect(link.textContent).toBe('Open Settings → Maps');
  });

  it('a map server that does not answer leaves the list under its notice', async () => {
    await map();
    await waitFor(() => expect(fake.maps).toHaveLength(1));
    act(() => fake.maps[0]!.fire('error', {}));
    await waitFor(() => expect(host.querySelector('[data-part="map-unavailable"]')?.textContent).toBe('The map could not be reached. Here is the list.'));
    expect(statusOf()).toBe('unavailable');
    expect(rows()).toHaveLength(3);
    expect(host.querySelector('[data-part="map-canvas"]')).toBeNull();
    expect(fake.maps[0]!.removed).toBe(true);
  });

  it('maps switched on from the app’s side builds the map then, and off again takes it away', async () => {
    await map({ maps: OFF });
    expect(fake.maps).toHaveLength(0);
    await update({ maps: ON });
    await waitFor(() => expect(fake.maps).toHaveLength(1));
    await update({ maps: OFF });
    await waitFor(() => expect(statusOf()).toBe('off'));
    expect(fake.maps[0]!.removed).toBe(true);
  });

  it('a pick reaches the app by the pin’s id, is kept, and the app can change it', async () => {
    const onSelect = vi.fn();
    await ready({ onSelect });
    fireEvent.click(pin('Second Wind'));
    expect(onSelect).toHaveBeenCalledWith('c2');
    expect(pin('Second Wind').getAttribute('aria-current')).toBe('true');
    expect(pin('Second Wind').dataset['selected']).toBe('');
    expect(pin('Harbour Cafe').hasAttribute('aria-current')).toBe(false);
    expect(host.querySelector('[data-part="geo-ranking-row"][aria-current="true"]')?.textContent).toContain('Second Wind');
    // From the list, the same.
    fireEvent.click(row('Third Coast'));
    expect(onSelect).toHaveBeenLastCalledWith('c3');
    expect(pin('Third Coast').getAttribute('aria-current')).toBe('true');
    expect(pin('Second Wind').hasAttribute('aria-current')).toBe(false);
    // The app's own word, and none.
    await update({ selected: 'c1' });
    expect(pin('Harbour Cafe').getAttribute('aria-current')).toBe('true');
    await update({ selected: null });
    expect(host.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
  });

  it('update never builds the map again: the pick, a pin’s own button and the person’s view are kept', async () => {
    const built = await ready({ selected: 'c2' });
    const fits = built.fitted.length;
    const button = pin('Second Wind');
    act(() => button.focus());

    // The same places in a new list, a label of the map, a new function: nothing is drawn again.
    await update({ pins: PINS.map((one) => ({ ...one })), ariaLabel: 'Customers', onSelect: () => undefined });
    expect(fake.maps).toHaveLength(1);
    expect(built.removed).toBe(false);
    expect(built.fitted).toHaveLength(fits);
    expect(pin('Second Wind')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-current')).toBe('true');

    // Picking another pin repaints the buttons there are: one in the middle of a drag is not replaced.
    await update({ selected: 'c3' });
    expect(pin('Second Wind')).toBe(button);
    expect(button.hasAttribute('aria-current')).toBe(false);
    expect(document.activeElement).toBe(button);

    // The person moves the map: from then on a new place is drawn where it is and the view stays theirs.
    act(() => built.fire('movestart', { originalEvent: new Event('mousedown') }));
    await update({ pins: [...PINS, { id: 'c4', label: 'Fourth Wall', lat: 40.4, lng: -3.7 }] });
    expect(pin('Fourth Wall')).toBeTruthy();
    expect(built.fitted).toHaveLength(fits);
    expect(pin('Second Wind')).toBe(button);
    expect(pin('Third Coast').getAttribute('aria-current')).toBe('true');
    expect(fake.maps).toHaveLength(1);
  });

  it('until the person has moved the map, new places are brought into view', async () => {
    const built = await ready();
    const fits = built.fitted.length;
    // A move the map made itself (a fit) carries no event of a hand.
    act(() => built.fire('movestart', {}));
    await update({ pins: [...PINS, { id: 'c4', label: 'Fourth Wall', lat: 40.4, lng: -3.7 }] });
    expect(built.fitted.length).toBe(fits + 1);
  });

  it('follows the app’s light or dark with the map’s own style, on the map that is there', async () => {
    const built = await ready({ theme: 'dark' });
    expect(built.options.style).toBe(`${SERVER}/styles/dark`);
    expect(host.querySelector('.adm-kit')?.getAttribute('data-kit-theme')).toBe('dark');
    await update({ theme: 'light' });
    expect(built.styles.at(-1)).toBe(`${SERVER}/styles/positron`);
    expect(fake.maps).toHaveLength(1);
  });

  it('a pin moved by keyboard reaches the app as (id, spot), is said aloud, and stays when the save holds', async () => {
    const onMovePin = vi.fn<(id: string, at: { lat: number; lng: number }) => Promise<void>>(() => Promise.resolve());
    await ready({ onMovePin });
    expect(pin('Harbour Cafe').getAttribute('aria-label')).toContain('Drag to the exact spot');
    await moveByKeys('Harbour Cafe', 2);
    expect(onMovePin).toHaveBeenCalledTimes(1);
    const [id, at] = onMovePin.mock.calls[0]!;
    expect(id).toBe('c1');
    // Two steps of four pixels east; a pixel is a hundredth of a degree in the fake.
    expect(at.lat).toBeCloseTo(52.52, 5);
    expect(at.lng).toBeCloseTo(13.48, 5);
    expect(said()).toMatch(/^Pin kept at /);
    // The app handed no pins back: the pin is on its new spot all the same, once the save has settled.
    await waitFor(() => expect(spotOf('Harbour Cafe').lng).toBeCloseTo(13.48, 5));
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(spotOf('Harbour Cafe').lng).toBeCloseTo(13.48, 5);
    expect(said()).not.toMatch(/not kept/);
    expect(refused()).toBeNull();
    expect(fake.maps).toHaveLength(1);
  });

  it.each([
    ['answers { refused }', (): Promise<KitRefused> => Promise.resolve({ refused: 'Outside the delivery area.' })],
    ['rejects', (): Promise<void> => Promise.reject(new Error('Outside the delivery area.'))],
    [
      'throws',
      (): void => {
        throw new Error('Outside the delivery area.');
      },
    ],
  ])('a save the app %s puts the pin back and says why above the map', async (_how, save) => {
    await ready({ onMovePin: save });
    await moveByKeys('Harbour Cafe', 3);
    await waitFor(() => expect(refused()).not.toBeNull());
    expect(refused()!.textContent).toContain('The new spot was not kept. The pin is back where it was.');
    expect(refused()!.querySelector('[data-part="map-refused-reason"]')?.textContent?.trim()).toBe('Outside the delivery area.');
    expect(refused()!.querySelector('[role="alert"]')).not.toBeNull();
    // The pin itself goes back once the answer has settled, and a screen reader hears it.
    await waitFor(() => expect(said()).toBe('The new spot was not kept. The pin is back where it was.'));
    expect(spotOf('Harbour Cafe')).toEqual({ lng: 13.4, lat: 52.52 });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(refused()).toBeNull();
    // The next move that holds clears nothing it should not, and is kept.
    await update({ onMovePin: () => undefined });
    await moveByKeys('Harbour Cafe', 1);
    await waitFor(() => expect(spotOf('Harbour Cafe').lng).toBeCloseTo(13.44, 5));
    expect(refused()).toBeNull();
  });

  it('without onMovePin no pin can be picked up', async () => {
    await ready();
    const el = pin('Harbour Cafe');
    expect(el.getAttribute('aria-label')).toBe('Harbour Cafe');
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(said()).toBe('');
  });

  it('a route is asked of the app once per set of stops, and its legs are listed', async () => {
    const way: MapWay = { legs: [{ distanceM: 12_400, durationS: 900, estimate: false }, { distanceM: 3_000, durationS: 300, estimate: true }], line: { type: 'LineString', coordinates: [[13.4, 52.52], [2.35, 48.85], [12.5, 41.9]] } };
    const route = vi.fn<(stops: readonly MapStop[]) => Promise<MapWay>>(() => Promise.resolve(way));
    await ready({ route });
    await waitFor(() => expect(host.textContent).toContain('12.4 km from the stop before'));
    expect(host.textContent).toContain('about 3 km from the stop before');
    expect(route).toHaveBeenCalledTimes(1);
    expect(route.mock.calls[0]![0]).toEqual([{ lat: 52.52, lng: 13.4 }, { lat: 48.85, lng: 2.35 }, { lat: 41.9, lng: 12.5 }]);
    expect(screen.getByRole('list', { name: 'Stops' })).toBeTruthy();
    expect(pin('2. Second Wind').textContent).toBe('2');

    // The same stops in a new list, and a new function that would answer the same: nothing is asked again.
    const again = vi.fn<(stops: readonly MapStop[]) => Promise<MapWay>>(() => Promise.resolve(way));
    await update({ pins: PINS.map((one) => ({ ...one })), route: again });
    await update({ ariaLabel: 'Round' });
    expect(route).toHaveBeenCalledTimes(1);
    expect(again).not.toHaveBeenCalled();

    // A stop that moved asks again, and until the answer is in its legs are of unknown length.
    let answer: (value: MapWay) => void = () => undefined;
    again.mockImplementationOnce(() => new Promise<MapWay>((resolve) => (answer = resolve)));
    await update({ pins: PINS.map((one) => (one.id === 'c3' ? { ...one, lat: 45.46, lng: 9.19 } : one)) });
    await waitFor(() => expect(again).toHaveBeenCalledTimes(1));
    expect(host.textContent).toContain('distance from the stop before unknown');
    expect(host.textContent).not.toContain('12.4 km');
    await act(async () => answer({ legs: [{ distanceM: 800_000, durationS: 1, estimate: false }, { distanceM: null, durationS: null, estimate: true, unknown: true }] }));
    await waitFor(() => expect(host.textContent).toContain('800 km from the stop before'));
  });

  it('a route the app cannot give leaves straight legs of unknown length, and the map stands', async () => {
    await ready({ route: () => Promise.reject(new Error('offline')) });
    await waitFor(() => expect(host.textContent).toContain('distance from the stop before unknown'));
    expect(host.querySelectorAll('[data-part="map-pin"]')).toHaveLength(3);
  });

  it('lists the areas, and a change of one that the app refuses is said above the map', async () => {
    const square = { type: 'Polygon' as const, coordinates: [[[13, 52], [14, 52], [14, 53], [13, 53], [13, 52]]] };
    const onAreaChange = vi.fn<(id: string | null, geometry: MapAreaGeometry) => Promise<KitRefused>>(() => Promise.resolve({ refused: 'Areas are locked this month.' }));
    await ready({ areas: [{ id: 'a1', name: 'North round', geometry: square, tone: 'warn' }, { id: 'a2', geometry: square }], onAreaChange });
    const list = screen.getByRole('list', { name: 'Areas' });
    expect(list.textContent).toContain('North round');
    expect(list.textContent).toContain('Area 2');
    expect(list.textContent).toContain('4 points');
    // Changed by the list's own button, then one corner dropped: the app is handed the whole shape.
    fireEvent.click(screen.getByRole('button', { name: 'Change: North round' }));
    const corner = host.querySelector<HTMLElement>('[data-part="map-corner"]')!;
    await act(async () => {
      fireEvent.keyDown(corner, { key: 'Delete' });
    });
    expect(onAreaChange).toHaveBeenCalledTimes(1);
    expect(onAreaChange.mock.calls[0]![0]).toBe('a1');
    expect(onAreaChange.mock.calls[0]![1].type).toBe('Polygon');
    await waitFor(() => expect(refused()?.textContent).toContain('Areas are locked this month.'));
  });

  it.each(KIT_LOCALES)('in %s every word is the catalogue’s, a plural reads as a sentence, and none is outside the set', async (locale) => {
    const square = { type: 'Polygon' as const, coordinates: [[[13, 52], [14, 52], [14, 53], [13, 53], [13, 52]]] };
    const town = { lat: 50, lng: 8, by: 'town' as const };
    await ready({
      locale,
      dir: locale.startsWith('ar') ? 'rtl' : 'ltr',
      pins: [...PINS, { id: 't1', label: 'Town one', ...town }, { id: 't2', label: 'Town two', ...town }],
      areas: [{ id: 'a1', geometry: square }],
      onMovePin: () => undefined,
      onAreaChange: () => undefined,
      route: () => Promise.resolve({ legs: [{ distanceM: 1200, durationS: 60, estimate: true }] }),
    });
    await waitFor(() => expect(host.querySelector('[data-part="geo-row-note"]')).not.toBeNull());
    expect(host.querySelector('.adm-kit')?.getAttribute('lang')).toBe(locale);
    // No text on the part still shows a brace: every argument and every plural was filled.
    expect(host.textContent).not.toMatch(/[{}]/);
    for (const label of [...host.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label') ?? '')) expect(label).not.toMatch(/[{}]/);
    // Still the map in every language: geography never mirrors.
    expect(host.querySelector('[data-part="map-canvas"]')?.closest('[dir]')?.getAttribute('dir')).toBe('ltr');
  });

  it('speaks Arabic with Arabic’s own plural forms', async () => {
    const town = { lat: 50, lng: 8, by: 'town' as const };
    await map({ maps: OFF, locale: 'ar-EG', dir: 'rtl', pins: [{ id: 't1', label: 'أ', ...town }, { id: 't2', label: 'ب', ...town }] });
    // Two places known by one town: the dual, not the form for many.
    await waitFor(() => expect(host.querySelector('[data-part="geo-row-note"]')?.textContent).toBe('مكانان معروفان بهذه البلدة فقط'));
    expect(host.querySelector('.adm-kit')?.getAttribute('dir')).toBe('rtl');
  });

  it('unmount takes the map away and frees it', async () => {
    const built = await ready();
    act(() => mounted!.unmount());
    expect(built.removed).toBe(true);
    expect(host.childElementCount).toBe(0);
  });
});

// ── what the two map screens draw (T25) ─────────────────────────────────────

describe('the map, mounted: names, colours, a list of the app’s own, click-to-place, "Try again"', () => {
  const NORTH = { type: 'Polygon' as const, coordinates: [[[13, 52], [14, 52], [14, 53], [13, 53], [13, 52]]] };
  const SOUTH = { type: 'Polygon' as const, coordinates: [[[2, 48], [4, 48], [4, 49], [2, 49], [2, 48]]] };
  const AREAS = [
    { id: 'a1', name: 'North', geometry: NORTH, colour: 0 },
    { id: 'a2', name: 'South', geometry: SOUTH, colour: 1 },
  ];
  const click = (built: (typeof fake.maps)[number], lng: number, lat: number): void => built.fire('click', { lngLat: { lng, lat }, point: { x: 0, y: 0 } });
  const placingLine = (): string | undefined => host.querySelector('[data-part="map-placing"] p')?.textContent ?? undefined;

  it('a pin’s colour, its outline and what it stands for reach the map; an area’s name is written on it', async () => {
    await ready({ pins: [{ ...PINS[0]!, colour: 1, group: 'Dana Whitlock' }, PINS[1]!], areas: AREAS });
    expect(pin('Harbour Cafe').style.color).toBe('var(--viz-2)');
    expect(pin('Harbour Cafe').style.borderRadius).toBe('3px');
    expect(pin('Harbour Cafe').getAttribute('aria-label')).toBe('Harbour Cafe · Dana Whitlock');
    expect(row('Harbour Cafe').textContent).toBe('1.Harbour CafeDana Whitlock');
    expect(pin('Second Wind').style.color).toBe('var(--pos)');
    expect([...host.querySelectorAll('[data-part="map-area-name"]')].map((name) => name.textContent)).toEqual(['North', 'South']);
    // What a script could not have typed its way into: a colour that is not a number is no colour.
    await update({ pins: [{ ...PINS[0]!, colour: 'red; background: url(//evil.test)' as unknown as number }] });
    expect(pin('Harbour Cafe').getAttribute('style')).not.toContain('evil');
    expect(pin('Harbour Cafe').style.color).toBe('var(--accent)');
  });

  it('a pin the app picks is gone to; one the person picks on the map is told to the app and not gone to twice', async () => {
    const onSelect = vi.fn();
    const built = await ready({ onSelect });
    expect(built.flown).toEqual([]);
    // A row of the app's own list.
    await update({ selected: 'c3' });
    expect(built.flown).toEqual([{ center: [12.5, 41.9], zoom: 5 }]);
    expect(pin('Third Coast').getAttribute('aria-current')).toBe('true');
    expect(onSelect).not.toHaveBeenCalled();
    // On the map.
    fireEvent.click(pin('Second Wind'));
    expect(onSelect).toHaveBeenCalledWith('c2');
    expect(built.flown).toHaveLength(2);
    // The app says the same back, as a list of its own would.
    await update({ selected: 'c2' });
    expect(built.flown).toHaveLength(2);
    // A pin that is not there, and none: nothing happens, nothing breaks.
    await update({ selected: 'nobody' });
    await update({ selected: null });
    expect(built.flown).toHaveLength(2);
    expect(host.querySelector('[data-part="map-pin"][aria-current]')).toBeNull();
  });

  it('an area the app picks is marked and brought into view; one picked on the map or in the list is told to the app', async () => {
    const onSelectArea = vi.fn();
    const built = await ready({ areas: AREAS, onSelectArea });
    const fits = built.fitted.length;
    await update({ selectedArea: 'a2' });
    expect(built.fitted.slice(fits)).toEqual([[[2, 48], [4, 49]]]);
    expect(host.querySelector('[data-part="map-area-name"][data-selected]')?.textContent).toBe('South');
    expect(screen.getByRole('button', { name: 'South', pressed: true })).toBeTruthy();
    // In the list.
    fireEvent.click(screen.getByRole('button', { name: 'North' }));
    expect(onSelectArea).toHaveBeenLastCalledWith('a1');
    expect(screen.getByRole('button', { name: 'North', pressed: true })).toBeTruthy();
    // On the map: the pick is the person's own, so the view stays theirs.
    const before = built.fitted.length;
    built.queryRenderedFeatures = () => [{ properties: { id: 'a2' } }];
    act(() => click(built, 3, 48.5));
    expect(onSelectArea).toHaveBeenLastCalledWith('a2');
    expect(built.fitted).toHaveLength(before);
    await update({ selectedArea: null });
    expect(host.querySelector('[data-part="map-area-name"][data-selected]')).toBeNull();
  });

  it('hostList is a promise that is checked: the map’s own list goes only while the app’s list is in the page', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // Promised, and not there: the map keeps its list and says so to the developer.
      await ready({ hostList: 'territory-list', areas: AREAS });
      expect(rows()).toHaveLength(3);
      expect(screen.getByRole('list', { name: 'Areas' })).toBeTruthy();
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('territory-list'));
      // There: the map's own list is left out. The pins are still named buttons.
      const own = document.createElement('ul');
      own.id = 'territory-list';
      document.body.append(own);
      await update({});
      expect(rows()).toHaveLength(0);
      expect(host.querySelector('[data-part="geo-areas"]')).toBeNull();
      expect(pin('Harbour Cafe').tagName).toBe('BUTTON');
      // The app's row picks: the pin is marked and gone to, and its way out is under the map.
      await update({ selected: 'c1' });
      expect(pin('Harbour Cafe').getAttribute('aria-current')).toBe('true');
      expect(host.querySelector('[data-part="geo-picked-link"]')?.textContent).toBe('Harbour Cafe · Open on OpenStreetMap (new tab)');
      await update({ mapsSiteLink: false });
      expect(host.querySelector('[data-part="geo-picked-link"]')).toBeNull();
      // Taken out of the page again: the map's list is back at the next word from the app.
      own.remove();
      await update({});
      expect(rows()).toHaveLength(3);
      // Not an id at all: no list is hidden for it.
      await update({ hostList: '' });
      expect(rows()).toHaveLength(3);
      await update({ hostList: 7 as unknown as string });
      expect(rows()).toHaveLength(3);
    } finally {
      warned.mockRestore();
      document.getElementById('territory-list')?.remove();
    }
  });

  it('with the app’s own list and no map, the notice still stands and says which', async () => {
    const own = document.createElement('ul');
    own.id = 'own-list';
    document.body.append(own);
    try {
      const onStatus = vi.fn();
      await map({ maps: OFF, hostList: 'own-list', onStatus });
      await waitFor(() => expect(host.querySelector('[data-part="map-off"]')?.textContent).toBe('Maps are switched off. Here is the list.'));
      expect(rows()).toHaveLength(0);
      expect(onStatus).toHaveBeenLastCalledWith('off');
      expect(fake.imports).toBe(0);
    } finally {
      own.remove();
    }
  });

  it('click-to-place: the spot reaches the app with the row’s id; held, the pin is kept and the state ends', async () => {
    const onPlacePin = vi.fn<(id: string, at: { lat: number; lng: number }) => Promise<void>>(() => Promise.resolve());
    const built = await ready({ onPlacePin });
    expect(placingLine()).toBeUndefined();
    await update({ placing: { id: 'c9', label: 'Kestrel Print' } });
    expect(placingLine()).toContain('Click the map where Kestrel Print is.');
    await act(async () => click(built, 9.19, 45.46));
    expect(onPlacePin).toHaveBeenCalledWith('c9', { lat: 45.46, lng: 9.19 });
    await waitFor(() => expect(pin('Kestrel Print')).toBeTruthy());
    expect(spotOf('Kestrel Print')).toEqual({ lng: 9.19, lat: 45.46 });
    expect(rows()).toEqual(['1.Harbour Cafe', '2.Second Wind', '3.Third Coast', '4.Kestrel Print']);
    await waitFor(() => expect(placingLine()).toBeUndefined());
    expect(host.querySelector('[data-pin="placing"]')).toBeNull();
    expect(said()).toMatch(/^Kestrel Print placed at /);
    // The state is over: a click on the map places nothing more.
    act(() => click(built, 1, 1));
    expect(onPlacePin).toHaveBeenCalledTimes(1);
  });

  it('click-to-place: a pin the app listed with no position takes the spot, and is exact', async () => {
    const built = await ready({ pins: [...PINS, { id: 'c9', label: 'Kestrel Print', lat: Number.NaN, lng: Number.NaN, by: 'town' }], onPlacePin: () => undefined, placing: { id: 'c9', label: 'Kestrel Print' } });
    expect(rows()).toHaveLength(3);
    await act(async () => click(built, 9, 45));
    await waitFor(() => expect(rows()).toEqual(['1.Harbour Cafe', '2.Second Wind', '3.Third Coast', '4.Kestrel Print']));
    expect(pin('Kestrel Print').dataset['by']).toBeUndefined();
  });

  it('click-to-place: a save the app refuses takes the pin away, says why above the map, and leaves the state for another try', async () => {
    const onPlacePin = vi.fn<(id: string, at: { lat: number; lng: number }) => Promise<KitRefused | void>>(() => Promise.resolve({ refused: 'Otley is outside your territory.' }));
    const built = await ready({ onPlacePin, placing: { id: 'c9', label: 'Kestrel Print' } });
    await act(async () => click(built, 9, 45));
    await waitFor(() => expect(refused()?.textContent).toContain('Kestrel Print was not placed. Otley is outside your territory.'));
    expect(host.querySelector('[data-part="map-refused-reason"]')?.getAttribute('role')).toBe('alert');
    await waitFor(() => expect(host.querySelector('[data-pin="placing"]')).toBeNull());
    expect(host.querySelectorAll('[data-part="map-pin"]')).toHaveLength(3);
    expect(placingLine()).toContain('Kestrel Print');
    // A rejection is a refusal too, and the next try that holds clears the notice.
    onPlacePin.mockImplementationOnce(() => Promise.reject(new Error('The server said no.')));
    await act(async () => click(built, 9, 45));
    await waitFor(() => expect(refused()?.textContent).toContain('The server said no.'));
    onPlacePin.mockImplementationOnce(() => Promise.resolve());
    await act(async () => fireEvent.keyDown(built.getCanvas(), { key: 'Enter' }));
    await waitFor(() => expect(pin('Kestrel Print')).toBeTruthy());
    // By keyboard: under the cross, at the fake map's middle.
    expect(onPlacePin).toHaveBeenLastCalledWith('c9', { lat: 20, lng: 10 });
    expect(refused()).toBeNull();
  });

  it('click-to-place: "Stop placing" and Escape leave the state and tell the app; without onPlacePin there is no such state', async () => {
    const onPlacingStop = vi.fn();
    const onPlacePin = vi.fn();
    const built = await ready({ onPlacePin, onPlacingStop, placing: { id: 'c9', label: 'Kestrel Print' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop placing' }));
    expect(onPlacingStop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(placingLine()).toBeUndefined());
    await update({ placing: { id: 'c9', label: 'Kestrel Print' } });
    await act(async () => fireEvent.keyDown(built.getCanvas(), { key: 'Escape' }));
    expect(onPlacingStop).toHaveBeenCalledTimes(2);
    expect(placingLine()).toBeUndefined();
    act(() => click(built, 1, 1));
    expect(onPlacePin).not.toHaveBeenCalled();
    await update({ onPlacePin: undefined, placing: { id: 'c9', label: 'Kestrel Print' } });
    expect(placingLine()).toBeUndefined();
    expect(host.querySelector('[data-part="map-cross"]')).toBeNull();
  });

  it('"Try again" after "could not be reached" builds the map anew, and the app hears each state by the contract’s names', async () => {
    const onStatus = vi.fn();
    await map({ onStatus });
    await waitFor(() => expect(fake.maps).toHaveLength(1));
    act(() => fake.maps[0]!.fire('error', {}));
    await waitFor(() => expect(statusOf()).toBe('unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fake.maps).toHaveLength(2));
    expect(said()).toBe('Trying the map again.');
    act(() => fake.maps[1]!.fire('style.load'));
    await waitFor(() => expect(statusOf()).toBe('ready'));
    expect(host.querySelectorAll('[data-part="map-pin"]')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(onStatus.mock.calls.map(([status]) => status)).toEqual(['loading', 'unreachable', 'loading', 'ready']);
  });

  it('a route that did not come is said above the map with "Try again", which asks the app once more', async () => {
    const way: MapWay = { legs: [{ distanceM: 98_400, durationS: 4_320, estimate: false }, { distanceM: 97_100, durationS: 4_200, estimate: false }] };
    const route = vi.fn<(stops: readonly MapStop[]) => Promise<MapWay>>(() => Promise.reject(new Error('offline')));
    await ready({ route });
    await waitFor(() => expect(host.querySelector('[data-part="route-unavailable"]')?.textContent).toBe('The way between the stops could not be worked out, so the distances are unknown.'));
    expect(route).toHaveBeenCalledTimes(1);
    route.mockImplementation(() => Promise.resolve(way));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    await waitFor(() => expect(host.textContent).toContain('98.4 km from the stop before · 1 hr 12 min drive'));
    expect(route).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-part="route-unavailable-box"]')).toBeNull();
    // Every leg is known: the whole way, with its drive time.
    expect(host.querySelector('[data-part="geo-route-total"]')?.textContent).toBe('The whole way: 196 km · 2 hr 22 min drive');
    // An answer that is not a route is no answer.
    route.mockImplementation(() => Promise.resolve({ nonsense: true } as unknown as MapWay));
    await update({ pins: PINS.map((one) => (one.id === 'c3' ? { ...one, lat: 45.46 } : one)) });
    await waitFor(() => expect(host.querySelector('[data-part="route-unavailable"]')).not.toBeNull());
  });

  it.each(KIT_LOCALES)('in %s the new words are the catalogue’s: placing, a refusal, a route that did not come, a drive time and the whole way', async (locale) => {
    const built = await ready({
      locale,
      dir: locale.startsWith('ar') ? 'rtl' : 'ltr',
      areas: AREAS,
      selected: 'c1',
      placing: { id: 'c9', label: 'Kestrel Print' },
      onPlacePin: () => Promise.resolve({ refused: 'No.' }),
      onPlacingStop: () => undefined,
      route: () => Promise.resolve({ legs: [{ distanceM: 98_400, durationS: 4_320, estimate: false }, { distanceM: 3_000, durationS: null, estimate: true }] }),
    });
    await waitFor(() => expect(host.querySelector('[data-part="geo-route-total"]')).not.toBeNull());
    expect(host.querySelector('[data-part="geo-maps-site"]')).not.toBeNull();
    await act(async () => click(built, 9, 45));
    await waitFor(() => expect(refused()).not.toBeNull());
    expect(host.textContent).not.toMatch(/[{}]/);
    if (locale !== 'en-US') {
      expect(placingLine()).not.toContain('Click the map');
      expect(host.querySelector('[data-part="geo-route-total"]')?.textContent).not.toContain('whole way');
      expect(host.querySelector('[data-part="geo-maps-site"]')?.textContent).not.toContain('new tab');
    }
    // The name the app gave is in the sentence, in every language.
    expect(placingLine()).toContain('Kestrel Print');
    expect(refused()?.textContent).toContain('Kestrel Print');
  });

  it('in Arabic the route that did not come and "Try again" are Arabic', async () => {
    await map({ locale: 'ar-EG', dir: 'rtl', route: () => Promise.reject(new Error('offline')) });
    await waitFor(() => expect(fake.maps).toHaveLength(1));
    act(() => fake.maps[0]!.fire('error', {}));
    await waitFor(() => expect(host.querySelector('[data-part="route-unavailable"]')?.textContent).toBe('تعذّر حساب الطريق بين المحطات، لذا المسافات غير معروفة.'));
    expect([...host.querySelectorAll('[data-part="map-retry"], [data-part="route-retry"]')].map((button) => button.textContent)).toEqual(['حاول مرة أخرى', 'حاول مرة أخرى']);
  });
});
