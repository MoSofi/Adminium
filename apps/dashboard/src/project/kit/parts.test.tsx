// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit's larger parts, as a page written in a project would use them: a
 * text area, a board, the import wizard for one table, and a map.
 *
 * Worth proving: the three that are code of their own are not in the kit's
 * own module graph (each arrives through a dynamic import, and the page shows
 * a place for it meanwhile); a board's drop reaches the page with the card
 * and both columns, and a save that fails puts the card back; the wizard
 * opens on the table the page named; a map lists its points and hands back
 * the point that was picked; and a part that cannot be loaded says so in its
 * place and leaves the rest of the page standing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardCard, MapPoint } from '@adminium/server/ui';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
import { WidgetRuntimeProvider, type WidgetRuntimeEnv } from '@adminium/widgets';

import { bootstrapQuery, type BootstrapData } from '../../app/bootstrap.js';
import { Board, ImportWizard, MapView, TextArea } from './parts.js';

const source = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

beforeEach(async () => {
  await installTestI18n();
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: [] })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const COLUMNS = [
  { id: 'new', label: 'New' },
  { id: 'won', label: 'Won', tone: 'pos' as const },
];
const CARDS: BoardCard[] = [
  { id: 'd1', title: 'Atrium fit-out', column: 'new', detail: 'Nordwind', figure: '52,800', owner: 'Dana Whitlock' },
  { id: 'd2', title: 'Loft desks', column: 'won' },
];

describe('how the parts are loaded', () => {
  it('reaches the board, the wizard and the map only through a dynamic import', () => {
    const parts = source('./parts.tsx');
    for (const name of ['board-part', 'import-part', 'map-part']) {
      expect(parts, name).toContain(`lazy(() => import('./${name}.js'))`);
      expect(parts.split('\n').filter((line) => line.startsWith('import ') && line.includes(name)), name).toEqual([]);
    }
    // The kit's own module names none of them, nor what they are made of.
    const index = source('./index.tsx');
    for (const heavy of ['board-part', 'import-part', 'map-part', '@adminium/widgets/kit-board', '@adminium/widgets/kit-map', 'data-io/ImportWizardPage']) {
      expect(index, heavy).not.toContain(heavy);
      expect(parts.split('\n').filter((line) => line.startsWith('import ') && line.includes(heavy)), heavy).toEqual([]);
    }
  });
});

describe('TextArea', () => {
  it('is a labelled box that takes what is typed, and says when it is wrong', async () => {
    const user = userEvent.setup();
    function Note() {
      const [text, setText] = useState('');
      return <TextArea label="Notes" hint="Seen by the team" error={text.length > 5 ? 'Too long' : undefined} value={text} onChange={(event) => setText(event.target.value)} />;
    }
    render(<Note />);
    const box = screen.getByLabelText('Notes');
    expect(box.tagName).toBe('TEXTAREA');
    expect(screen.getByText('Seen by the team')).toBeTruthy();
    await user.type(box, 'call back');
    expect((box as HTMLTextAreaElement).value).toBe('call back');
    expect(screen.getByText('Too long')).toBeTruthy();
    expect(box.getAttribute('aria-invalid')).toBe('true');
  });

  it('is a bare box when it is given no label', () => {
    render(<TextArea aria-label="Reason" rows={2} />);
    expect(screen.getByRole('textbox', { name: 'Reason' }).getAttribute('rows')).toBe('2');
  });
});

describe('Board', () => {
  it('draws the columns and their cards once its code is there', async () => {
    render(<Board columns={COLUMNS} cards={CARDS} />);
    expect(await screen.findByText('Atrium fit-out')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText('Won')).toBeTruthy();
    expect(screen.getByText('Loft desks')).toBeTruthy();
    // Wide content scrolls inside the board's own box, never the page: what a phone needs.
    expect(document.querySelector('[data-part="kit-board"]')?.className).toContain('overflow-x-auto');
  });

  it('hands a card moved with the keyboard to the page, with the column it left and the one it reached', async () => {
    const user = userEvent.setup();
    const moves: [string, string, string][] = [];
    render(<Board columns={COLUMNS} cards={CARDS} onMove={(card, from, to) => void moves.push([card, from, to])} />);
    const grip = (await screen.findAllByRole('button')).find((button) => /Atrium fit-out/.test(button.getAttribute('aria-label') ?? button.textContent ?? ''))!;
    expect(grip, 'the card can be picked up from the keyboard').toBeDefined();
    grip.focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(moves).toEqual([['d1', 'new', 'won']]));
  });

  it('a save that fails puts the card back, and says why above the columns and aloud', async () => {
    const user = userEvent.setup();
    render(<Board columns={COLUMNS} cards={CARDS} onMove={() => Promise.reject(new Error('A deal that is won cannot be moved.'))} />);
    const grip = (await screen.findAllByRole('button')).find((button) => /Atrium fit-out/.test(button.getAttribute('aria-label') ?? button.textContent ?? ''))!;
    grip.focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(document.querySelector('[data-part="board-move-refused"]')).not.toBeNull());
    expect(document.querySelector('[data-part="board-move-refused"]')!.textContent).toContain('A deal that is won cannot be moved.');
    expect(document.querySelector('[data-board-liveregion]')!.textContent).toContain('A deal that is won cannot be moved.');
    // Back in the column it left.
    expect(within(document.querySelector('[data-board-column="new"]') as HTMLElement).getByText('Atrium fit-out')).toBeTruthy();
    expect(within(document.querySelector('[data-board-column="won"]') as HTMLElement).queryByText('Atrium fit-out')).toBeNull();
  });

  it('heads a column with the count and the total the page gives it, in place of the cards listed', async () => {
    render(<Board columns={[{ ...COLUMNS[0]!, count: 340, total: '€12,400' }, COLUMNS[1]!]} cards={CARDS} />);
    await screen.findByText('Atrium fit-out');
    const part = (column: string, name: string) => document.querySelector(`[data-board-column="${column}"] [data-part="${name}"]`)?.textContent;
    expect(part('new', 'column-count')).toBe('340');
    expect(part('new', 'column-total')).toBe('€12,400');
    expect(part('won', 'column-count')).toBe('1');
    expect(part('won', 'column-total')).toBeUndefined();
  });

  it('opens a card', async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    render(<Board columns={COLUMNS} cards={CARDS} onOpen={(id) => void opened.push(id)} />);
    await user.click(await screen.findByText('Loft desks'));
    expect(opened).toEqual(['d2']);
  });

  it('says so, in the page’s own words, when there is no column', async () => {
    render(<Board columns={[]} cards={[]} emptyTitle="No stages yet" emptyDescription="Add one in Setup." />);
    expect(await screen.findByText('No stages yet')).toBeTruthy();
    expect(screen.getByText('Add one in Setup.')).toBeTruthy();
  });
});

describe('ImportWizard', () => {
  it('opens on the table the page named, in the database the project calls by name', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['bootstrap'], makeBootstrap({ project: { databases: { main: 'conn_main' }, client: { digest: 'd', pages: [], widgets: [] } } }));
    render(
      <QueryClientProvider client={queryClient}>
        <ImportWizard database="main" table="public.companies" columns={[{ key: 'name', label: 'Name' }, { key: 'town' }]} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(document.querySelector('[data-part="kit-import"]')).not.toBeNull());
    // The wizard's first step is its file, not a table to choose: the page already said which.
    expect(within(document.querySelector('[data-part="kit-import"]') as HTMLElement).queryByText(/pick a table page/i)).toBeNull();
  });

  it('hands the wizard the column a page says lines are matched on', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['bootstrap'], makeBootstrap({ project: { databases: { main: 'conn_main' }, client: { digest: 'd', pages: [], widgets: [] } } }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: { fileId: 'file_1', filename: 'c.csv', sizeBytes: 1, sha256: 'x', columns: ['name', 'town'], sampleRows: [['Acme', 'Leeds']], totalRows: 1 } }), { status: 201, headers: { 'content-type': 'application/json' } })),
    );
    try {
      // Awaited: the part waits for the wizard's words (a deferred namespace) before it draws.
      await act(async () => {
        render(
          <QueryClientProvider client={queryClient}>
            <ImportWizard database="main" table="public.companies" columns={[{ key: 'name', label: 'Name' }, { key: 'town' }]} matchOn="name" />
          </QueryClientProvider>,
        );
      });
      await waitFor(() => expect(document.querySelector('[data-part="kit-import"] input[type="file"]')).not.toBeNull());
      await userEvent.setup().upload(document.querySelector('[data-part="kit-import"] input[type="file"]') as HTMLInputElement, new File(['name,town\n'], 'c.csv', { type: 'text/csv' }));
      // On the Map step the column is chosen already, and the lines that are here are left as they are.
      expect(((await screen.findByTestId('import-match-on')) as HTMLSelectElement).value).toBe('name');
      expect((screen.getByTestId('import-when-here') as HTMLSelectElement).value).toBe('skip');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('says in its place that it cannot be drawn for a database the project does not have', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['bootstrap'], makeBootstrap({ project: { databases: { main: 'conn_main' }, client: { digest: 'd', pages: [], widgets: [] } } }));
    render(
      <QueryClientProvider client={queryClient}>
        <p>The rest of the page</p>
        <ImportWizard database="archive" table="t" columns={[]} />
      </QueryClientProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('This part of the page could not be loaded.');
    expect(screen.getByText('The rest of the page')).toBeTruthy();
    quiet.mockRestore();
  });
});

describe('MapView', () => {
  const POINTS: MapPoint[] = [
    { id: 'c1', name: 'Nordwind, Leeds', lat: 53.8, lng: -1.55, value: 3 },
    { id: 'c2', name: 'Halden, York', lat: 53.96, lng: -1.08 },
  ];
  const MAPS_ON = { runtime: 'browser' as const, offlineAssets: false, maps: { server: 'https://maps.example.test', routing: false } };

  /** The page around a map: the app's query cache (with who is signed in), and what the session said of maps. */
  function page(node: ReactNode, options: { bootstrap?: BootstrapData; env?: WidgetRuntimeEnv } = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (options.bootstrap !== undefined) queryClient.setQueryData(bootstrapQuery().queryKey, options.bootstrap);
    const inner = options.env === undefined ? node : <WidgetRuntimeProvider env={options.env}>{node}</WidgetRuntimeProvider>;
    return render(<QueryClientProvider client={queryClient}>{inner}</QueryClientProvider>);
  }

  it('lists its points beside the map and hands back the one that is picked', async () => {
    const user = userEvent.setup();
    const picked: MapPoint[] = [];
    page(<MapView points={POINTS} valueLabel="Open deals" onSelect={(point) => void picked.push(point)} />);
    await user.click(await screen.findByText('Nordwind, Leeds'));
    expect(picked).toEqual([POINTS[0]]);
    expect(screen.getByText('Halden, York')).toBeTruthy();
    expect(document.querySelector('[data-part="kit-map"]')?.className).toContain('max-w-full');
  });

  it('says so when there is no point to place', async () => {
    page(<MapView points={[]} emptyTitle="Nothing on the map" emptyDescription="Give a company a town." />);
    expect(await screen.findByText('Nothing on the map')).toBeTruthy();
  });

  it('maps off: the list, "switched off", and no canvas — with no way to Settings for somebody who may not change it', async () => {
    page(<MapView points={POINTS} />, { bootstrap: makeBootstrap({ roles: ['viewer'], systemActions: [] }) });
    expect((await screen.findByText('Maps are switched off. Here is the list.')).closest('[data-part="map-off"]')).not.toBeNull();
    expect(document.querySelector('[data-widget="map-bubble"]')?.getAttribute('data-map-status')).toBe('off');
    expect(document.querySelector('[data-part="map-canvas"]')).toBeNull();
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual(['1.Nordwind, Leeds3', '2.Halden, York1']);
    expect(document.querySelector('[data-part="map-off-link"]')).toBeNull();
  });

  it('maps off: somebody who holds the settings gets the way to Settings → Maps', async () => {
    page(<MapView points={POINTS} />, { bootstrap: makeBootstrap({ systemActions: ['settings.manage'] }) });
    const link = await waitFor(() => {
      const found = document.querySelector('[data-part="map-off-link"]');
      expect(found).not.toBeNull();
      return found;
    });
    expect(link?.getAttribute('href')).toBe('/settings/maps');
  });

  it('the desktop app draws no map, whatever the session says', async () => {
    page(<MapView points={POINTS} />, { env: { ...MAPS_ON, runtime: 'desktop' } });
    await screen.findByText('Maps are switched off. Here is the list.');
    expect(document.querySelector('[data-part="map-canvas"]')).toBeNull();
  });

  it('maps on and no map to be had: the list and "could not be reached", never a blank frame', async () => {
    // This runner has no WebGL, as a browser with it switched off has none: the map cannot be built.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    page(<MapView points={POINTS} />, { env: MAPS_ON });
    expect(await screen.findByText('The map could not be reached. Here is the list.', undefined, { timeout: 15_000 })).toBeTruthy();
    expect(document.querySelector('[data-widget="map-bubble"]')?.getAttribute('data-map-status')).toBe('unavailable');
    expect(document.querySelector('[data-part="map-canvas"]')).toBeNull();
    expect(screen.getByText('Halden, York')).toBeTruthy();
    quiet.mockRestore();
  }, 20_000);

  it('says how each position is known, and how many share a town', async () => {
    const points: MapPoint[] = [
      { name: 'Ana', lat: -22.9, lng: -47.06, by: 'town' },
      { name: 'Bia', lat: -22.9, lng: -47.06, by: 'town' },
      { name: 'Caio', lat: -23.5, lng: -46.6, by: 'exact' },
    ];
    page(<MapView points={points} />);
    await screen.findByText('Ana');
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('[data-part="geo-by-town"]')?.textContent)).toEqual(['by town', 'by town', undefined]);
    expect(rows[0]?.querySelector('[data-part="geo-row-note"]')?.textContent).toBe('2 places are known only by this town');
    // No figure was given, so none is shown: not a column of ones.
    expect(rows[2]?.textContent).toBe('3.Caio');
  });

  it('lists a route\'s stops in order with each leg: "about" for a straight line, "unknown" and never 0', async () => {
    const stops: MapPoint[] = [
      { name: 'Depot', lat: -23.5, lng: -46.6 },
      { name: 'Ana', lat: -22.9, lng: -47.06, by: 'town' },
      { name: 'Bia', lat: -22.9, lng: -47.06, by: 'town' },
    ];
    page(
      <MapView
        points={stops}
        units="mi"
        route={{
          legs: [
            { distanceM: 81_240, durationS: null, estimate: true },
            { distanceM: null, durationS: null, estimate: true, unknown: true },
          ],
        }}
      />,
    );
    await screen.findByText('Depot');
    const notes = screen.getAllByRole('listitem').map((row) => row.querySelector('[data-part="geo-row-note"]')?.textContent ?? null);
    expect(notes[0]).toBeNull();
    expect(notes[1]).toContain('about 50.5 mi from the stop before');
    expect(notes[2]).toContain('distance from the stop before unknown');
    expect(notes.join(' ')).not.toMatch(/\b0 (mi|km|m|ft)\b/);
  });

  it('names the areas when there is no map to draw them on', async () => {
    const square = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    page(<MapView points={[]} areas={[{ id: 'north', name: 'North round', geometry: square }]} onAreaChange={() => undefined} />);
    expect(await screen.findByText('North round')).toBeTruthy();
    expect(screen.getByText('4 points')).toBeTruthy();
    // Drawing needs the map: no drawing buttons without one.
    expect(document.querySelector('[data-part="area-tools"]')).toBeNull();
  });
});

describe('MapView — a long list, and the way to Settings', () => {
  function page(node: ReactNode, bootstrap?: BootstrapData) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (bootstrap !== undefined) queryClient.setQueryData(bootstrapQuery().queryKey, bootstrap);
    return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  }

  it('lists the first 200 points and says how many more there are', async () => {
    const points: MapPoint[] = Array.from({ length: 203 }, (_, index) => ({ name: `Place ${String(index + 1)}`, lat: index / 10, lng: index / 10 }));
    page(<MapView points={points} />);
    await screen.findByText('Place 1');
    expect(document.querySelectorAll('[data-part="geo-ranking-row"]')).toHaveLength(200);
    expect(document.querySelector('[data-part="geo-list-more"]')?.textContent).toBe('and 3 more');
  });

  it('opens Settings → Maps through the app’s router, not by loading the app again', async () => {
    const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } = await import('@tanstack/react-router');
    const root = createRootRoute();
    const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <MapView points={[{ name: 'Leeds', lat: 53.8, lng: -1.55 }]} /> });
    const settings = createRoute({ getParentRoute: () => root, path: '/settings/maps', component: () => <p>The maps settings</p> });
    const router = createRouter({ routeTree: root.addChildren([home, settings]), history: createMemoryHistory({ initialEntries: ['/'] }) });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(bootstrapQuery().queryKey, makeBootstrap({ systemActions: ['settings.manage'], maps: { enabled: false, server: null, routing: false } }));
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const link = await waitFor(() => {
      const found = document.querySelector<HTMLAnchorElement>('[data-part="map-off-link"]');
      expect(found).not.toBeNull();
      return found as HTMLAnchorElement;
    });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    // The browser was not left to follow the link, and the page changed in place.
    expect(click.defaultPrevented).toBe(true);
    expect(await screen.findByText('The maps settings')).toBeTruthy();
  });
});
