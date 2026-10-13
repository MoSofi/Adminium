// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment happy-dom
/**
 * A place and an area in a record: the two fields, and their cells.
 *
 * Worth proving: a typed name asks the server's list after a pause and ONCE
 * (the search budget is per minute, not per key); a town that is picked is
 * stored as a town; coordinates and a link go as the text they are and ask
 * the list nothing; the field always says which kind it holds; clearing
 * stores nothing; and with maps off neither field draws a map or shows a box
 * of JSON.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CellValue } from '../../../families/tables/cells.js';
import { gridColumnSpecSchema } from '../../../families/tables/column-spec.js';
import { looksLikePosition, placeValueOf, areaValueOf, coordinateText, type PlaceSuggestion } from '../../../families/geo/place-value.js';
import { AREA_ENTRY, PLACE_ENTRY, type ControlProps } from './index.js';
import { PLACE_SEARCH_DELAY_MS } from './place.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const column = gridColumnSpecSchema.parse({ name: 'where_at', label: 'Where', logicalType: 'json' });

const CAMPINAS: PlaceSuggestion = { id: 3467865, name: 'Campinas', region: 'São Paulo', countryName: 'Brazil', country: 'BR', lat: -22.90556, lng: -47.06083 };

function renderPlace(props: Partial<ControlProps> = {}) {
  const onChange = vi.fn();
  const places = vi.fn(async () => [CAMPINAS]);
  const Control = PLACE_ENTRY.component;
  render(<Control column={column} value={null} onChange={onChange} options={[]} mode="create" places={places} aria-label="Where" {...props} />);
  return { onChange, places, box: screen.getByRole('combobox') as HTMLInputElement };
}

describe('the place field', () => {
  beforeEach(() => vi.useFakeTimers());

  it('asks the list once after a pause, however many keys were typed', async () => {
    const { places, box } = renderPlace();
    for (const text of ['c', 'ca', 'cam', 'camp']) fireEvent.change(box, { target: { value: text } });
    expect(places).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DELAY_MS);
    });
    expect(places).toHaveBeenCalledTimes(1);
    expect(places).toHaveBeenCalledWith('camp');
  });

  it('stores a picked town as a town, by its id in the list', async () => {
    const { onChange, box } = renderPlace();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'campi' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DELAY_MS);
    });
    const option = screen.getByRole('option');
    expect(option.textContent).toBe('CampinasSão Paulo, Brazil');
    fireEvent.mouseDown(option);
    expect(onChange).toHaveBeenCalledWith({ placeId: 3467865, lat: -22.90556, lng: -47.06083, by: 'town', name: 'Campinas', country: 'BR' });
    expect(box.value).toBe('');
  });

  it('picks with the keyboard: Enter takes the town the arrows are on', async () => {
    const places = vi.fn(async () => [CAMPINAS, { ...CAMPINAS, id: 2, name: 'Campina Grande' }]);
    const { onChange, box } = renderPlace({ places });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'campi' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DELAY_MS);
    });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ placeId: 2, by: 'town', name: 'Campina Grande' }));
  });

  it('a name that is typed and not picked stores nothing', async () => {
    const { onChange, box } = renderPlace();
    fireEvent.change(box, { target: { value: 'campinas' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DELAY_MS);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sends coordinates and a map link as the text they are, and asks the list nothing', async () => {
    const { onChange, places, box } = renderPlace();
    fireEvent.change(box, { target: { value: '30.0444, 31.2357' } });
    expect(onChange).toHaveBeenLastCalledWith('30.0444, 31.2357');
    fireEvent.change(box, { target: { value: 'https://www.openstreetmap.org/#map=15/30.0444/31.2357' } });
    expect(onChange).toHaveBeenLastCalledWith('https://www.openstreetmap.org/#map=15/30.0444/31.2357');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DELAY_MS * 2);
    });
    expect(places).not.toHaveBeenCalled();
  });

  it('says which kind it holds: by town, an exact spot, or text still to be read', () => {
    renderPlace({ value: { lat: -22.90556, lng: -47.06083, by: 'town', placeId: 3467865, name: 'Campinas' } });
    expect(document.querySelector('[data-part="place-kind"]')?.textContent).toContain('By town: Campinas');
    cleanup();
    renderPlace({ value: { lat: 30.0444, lng: 31.2357, by: 'exact' } });
    expect(document.querySelector('[data-part="place-kind"]')?.textContent).toContain('Exact spot: 30.04440, 31.23570');
    cleanup();
    renderPlace({ value: '30.0444, 31.2357' });
    expect(document.querySelector('[data-part="place-kind"]')?.textContent).toContain('Read when you save: 30.0444, 31.2357');
    cleanup();
    renderPlace();
    expect(document.querySelector('[data-part="place-kind"]')?.textContent).toContain('No place yet');
    expect(document.querySelector('[data-part="place-clear"]')).toBeNull();
  });

  it('clearing stores nothing', () => {
    const { onChange } = renderPlace({ value: { lat: 30.0444, lng: 31.2357, by: 'exact' } });
    fireEvent.click(document.querySelector('[data-part="place-clear"]') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('"Where I am" stores what the device says as an exact spot; without a device that can say, there is no button', () => {
    const getCurrentPosition = vi.fn((done: (position: { coords: { latitude: number; longitude: number } }) => void) => done({ coords: { latitude: 30.1, longitude: 31.3 } }));
    vi.stubGlobal('navigator', { ...navigator, geolocation: { getCurrentPosition } });
    const { onChange } = renderPlace();
    fireEvent.click(document.querySelector('[data-part="place-where-i-am"]') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith({ lat: 30.1, lng: 31.3, by: 'exact' });
    vi.unstubAllGlobals();
  });

  it('with maps off, shows no map — the words still say where', () => {
    renderPlace({ value: { lat: 30.0444, lng: 31.2357, by: 'exact' } });
    expect(document.querySelector('[data-part="place-map"]')).toBeNull();
    expect(document.querySelector('[data-part="map-off"]')).toBeNull();
  });
});

describe('the area field', () => {
  const SQUARE = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

  function renderArea(value: unknown) {
    const onChange = vi.fn();
    const Control = AREA_ENTRY.component;
    render(<Control column={column} value={value} onChange={onChange} options={[]} mode="edit" />);
    return { onChange };
  }

  it('with maps off, says areas are drawn on the map and how many points the stored one has — never raw JSON', () => {
    renderArea(SQUARE);
    expect(document.querySelector('[data-part="area-kind"]')?.textContent).toContain('Area · 4 points');
    expect(document.querySelector('[data-part="area-maps-off"]')?.textContent).toContain('An area is drawn on the map, and maps are switched off.');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.body.textContent).not.toContain('Polygon');
  });

  it('reads a shape an engine handed back as text', () => {
    renderArea(JSON.stringify(SQUARE));
    expect(document.querySelector('[data-part="area-kind"]')?.textContent).toContain('Area · 4 points');
  });

  it('clearing stores nothing; with nothing stored there is nothing to clear', () => {
    const { onChange } = renderArea(SQUARE);
    fireEvent.click(document.querySelector('[data-part="area-clear"]') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(null);
    cleanup();
    renderArea(null);
    expect(document.querySelector('[data-part="area-kind"]')?.textContent).toContain('No area yet');
    expect(document.querySelector('[data-part="area-clear"]')).toBeNull();
  });
});

describe('a place and an area in a list', () => {
  const cell = (value: unknown) => render(<CellValue column={column} row={{ where_at: value }} />);

  it('shows a town by its name with a "by town" mark', () => {
    cell({ lat: -22.9, lng: -47.06, by: 'town', placeId: 1, name: 'Campinas' });
    expect(document.querySelector('[data-part="cell-place"]')?.textContent).toBe('Campinasby town');
  });

  it('shows an exact spot by its coordinates, with no mark', () => {
    cell({ lat: 30.0444, lng: 31.2357, by: 'exact' });
    expect(document.querySelector('[data-part="cell-place"]')?.textContent).toBe('30.04440, 31.23570');
    expect(document.querySelector('[data-part="cell-place-by-town"]')).toBeNull();
  });

  it('shows an area as its point count', () => {
    cell({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
    expect(document.querySelector('[data-part="cell-area"]')?.textContent).toBe('Area · 3 points');
  });

  it('leaves any other JSON as it was', () => {
    cell({ theme: 'dark' });
    expect(document.querySelector('[data-part="cell-place"]')).toBeNull();
    expect(document.body.textContent).toContain('{"theme":"dark"}');
  });
});

describe('reading a stored place', () => {
  it('takes the object, or the JSON text one engine hands back', () => {
    expect(placeValueOf({ lat: 1, lng: 2, by: 'town', placeId: 9, name: 'X' })).toEqual({ lat: 1, lng: 2, by: 'town', placeId: 9, name: 'X' });
    expect(placeValueOf('{"lat":1,"lng":2,"by":"exact"}')).toEqual({ lat: 1, lng: 2, by: 'exact' });
    // A bare pair is a spot somebody gave.
    expect(placeValueOf({ lat: 1, lng: 2 })).toEqual({ lat: 1, lng: 2, by: 'exact' });
  });

  it('is null for text on its way to the server, junk, and positions off the map', () => {
    expect(placeValueOf('30.0444, 31.2357')).toBeNull();
    expect(placeValueOf(null)).toBeNull();
    expect(placeValueOf({ lat: 'x', lng: 2 })).toBeNull();
    expect(placeValueOf({ lat: 91, lng: 2 })).toBeNull();
    expect(areaValueOf({ lat: 1, lng: 2 })).toBeNull();
  });

  it('tells a position from a town\'s name', () => {
    for (const text of ['30.0444, 31.2357', '-22.9 -47.06', 'geo:30.0444,31.2357', 'https://maps.app.goo.gl/abc', 'maps.google.com/?q=1,2']) expect(looksLikePosition(text), text).toBe(true);
    for (const text of ['Campinas', 'São João', 'القاهرة', '10 Downing', '']) expect(looksLikePosition(text), text).toBe(false);
    expect(coordinateText({ lat: 30.0444, lng: 31.2357 })).toBe('30.04440, 31.23570');
  });
});

// ── the place field, after its review ───────────────────────────────────────

import { renderHook } from '@testing-library/react';
import * as placeValue from '../../../families/geo/place-value.js';
import { useBoundPlaces } from './use-bound-places.js';

describe('the place field — one question per text, and only its own answer', () => {
  beforeEach(() => vi.useFakeTimers());

  const Control = PLACE_ENTRY.component;
  const wait = async (ms: number): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it('asks once for a text, however often the page around it is drawn again with a new search function', async () => {
    const asked = vi.fn(async (query: string) => (query === '' ? [] : [CAMPINAS]));
    // A new function every time, as a page that binds it on each render hands it over.
    const node = () => <Control column={column} value={null} onChange={() => undefined} options={[]} mode="create" places={(query) => asked(query)} aria-label="Where" />;
    const { rerender } = render(node());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'camp' } });
    await wait(PLACE_SEARCH_DELAY_MS);
    expect(asked).toHaveBeenCalledTimes(1);
    for (let turn = 0; turn < 4; turn += 1) {
      rerender(node());
      await wait(PLACE_SEARCH_DELAY_MS);
    }
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('still asks while the page around it is drawn again faster than the pause', async () => {
    const asked = vi.fn(async (query: string) => (query === '' ? [] : [CAMPINAS]));
    const node = () => <Control column={column} value={null} onChange={() => undefined} options={[]} mode="create" places={(query) => asked(query)} aria-label="Where" />;
    const { rerender } = render(node());
    const box = screen.getByRole('combobox');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'camp' } });
    for (let turn = 0; turn < 6; turn += 1) {
      await wait(100);
      rerender(node());
    }
    expect(asked).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('option').textContent).toContain('Campinas');
  });

  it('the page hands the form one search function for as long as its table is the same', () => {
    const api = { places: vi.fn(async function (this: unknown) { return this === api ? [CAMPINAS] : []; }) };
    const { result, rerender } = renderHook(() => useBoundPlaces(api));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(renderHook(() => useBoundPlaces({})).result.current).toBeUndefined();
    return expect(first?.('x')).resolves.toEqual([CAMPINAS]);
  });

  it('offers nothing under a text the answer was not for, and Enter stores nothing', async () => {
    const { onChange, box } = renderPlace();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'campi' } });
    await wait(PLACE_SEARCH_DELAY_MS);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    // One more letter: the list on screen was the answer to another question.
    fireEvent.change(box, { target: { value: 'campix' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('drops an answer that comes back after the text was cut too short to ask', async () => {
    let answer: (list: PlaceSuggestion[]) => void = () => undefined;
    const places = vi.fn(() => new Promise<PlaceSuggestion[]>((resolve) => void (answer = resolve)));
    const { onChange, box } = renderPlace({ places });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'campi' } });
    await wait(PLACE_SEARCH_DELAY_MS);
    expect(places).toHaveBeenCalledTimes(1);
    fireEvent.change(box, { target: { value: 'c' } });
    await act(async () => answer([CAMPINAS]));
    fireEvent.change(box, { target: { value: 'ri' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says the list could not be asked when the search is refused — not that there is no such town', async () => {
    const places = vi.fn(async () => {
      throw new Error('429');
    });
    const { box } = renderPlace({ places });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'campi' } });
    await wait(PLACE_SEARCH_DELAY_MS);
    const list = document.querySelector('[data-part="place-suggestions"]');
    expect(list?.textContent).toBe('The town list could not be asked just now. Try again, or paste coordinates.');
    expect(list?.textContent).not.toContain('No town by that name');
  });

  it('reads coordinates typed in Arabic digits as coordinates, and sends them in Latin digits', async () => {
    const { onChange, places, box } = renderPlace();
    fireEvent.change(box, { target: { value: '٣٠٫٠٤٤٤، ٣١٫٢٣٥٧' } });
    expect(onChange).toHaveBeenLastCalledWith('30.0444, 31.2357');
    // Persian and Urdu digits too.
    fireEvent.change(box, { target: { value: '۳۰٫۰۴۴۴، ۳۱٫۲۳۵۷' } });
    expect(onChange).toHaveBeenLastCalledWith('30.0444, 31.2357');
    await wait(PLACE_SEARCH_DELAY_MS * 2);
    expect(places).not.toHaveBeenCalled();
    expect(placeValue.looksLikePosition('٣٠٫٠٤٤٤، ٣١٫٢٣٥٧')).toBe(true);
    expect(placeValue.looksLikePosition('-٢٢٫٩ -٤٧٫٠٦')).toBe(true);
    expect(placeValue.latinDigits('۳۰٫۵، ٣١')).toBe('30.5, 31');
  });

  it('a town typed with an Arabic comma is still a town, asked as it was typed', async () => {
    const { onChange, places, box } = renderPlace();
    fireEvent.change(box, { target: { value: 'القاهرة، مصر' } });
    await wait(PLACE_SEARCH_DELAY_MS);
    expect(onChange).not.toHaveBeenCalled();
    expect(places).toHaveBeenCalledWith('القاهرة، مصر');
  });

  it('names its list only while the list is there', async () => {
    const { box } = renderPlace();
    expect(box.hasAttribute('aria-controls')).toBe(false);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'campi' } });
    await wait(PLACE_SEARCH_DELAY_MS);
    const list = document.querySelector('[data-part="place-suggestions"]');
    expect(list).not.toBeNull();
    expect(box.getAttribute('aria-controls')).toBe(list?.id);
    fireEvent.blur(box);
    expect(box.hasAttribute('aria-controls')).toBe(false);
  });
});

describe('the area field — what is read aloud', () => {
  it('puts the "maps are off" notice in the page before its words', async () => {
    const { renderToString } = await import('react-dom/server');
    const Control = AREA_ENTRY.component;
    const first = document.createElement('div');
    first.append(document.createRange().createContextualFragment(renderToString(<Control column={column} value={null} onChange={() => undefined} options={[]} mode="edit" />)));
    expect(first.querySelector('[data-part="area-maps-off"]')?.getAttribute('role')).toBe('status');
    expect(first.querySelector('[data-part="area-maps-off"]')?.textContent).toBe('');
    render(<Control column={column} value={null} onChange={() => undefined} options={[]} mode="edit" />);
    expect(document.querySelector('[data-part="area-maps-off"]')?.textContent).toContain('An area is drawn on the map, and maps are switched off.');
  });
});
