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
    getCanvas(): { style: Record<string, string> } {
      return { style: {} };
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
    flyTo(): void {}
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
