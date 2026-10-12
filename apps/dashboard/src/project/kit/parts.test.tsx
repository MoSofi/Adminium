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
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardCard, MapPoint } from '@adminium/server/ui';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse, makeBootstrap } from '../../test/fixtures.js';
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

  it('lists its points beside the map and hands back the one that is picked', async () => {
    const user = userEvent.setup();
    const picked: MapPoint[] = [];
    render(<MapView points={POINTS} valueLabel="Open deals" onSelect={(point) => void picked.push(point)} />);
    await user.click(await screen.findByText('Nordwind, Leeds'));
    expect(picked).toEqual([POINTS[0]]);
    expect(screen.getByText('Halden, York')).toBeTruthy();
    expect(document.querySelector('[data-part="kit-map"]')?.className).toContain('max-w-full');
  });

  it('says so when there is no point to place', async () => {
    render(<MapView points={[]} emptyTitle="Nothing on the map" emptyDescription="Give a company a town." />);
    expect(await screen.findByText('Nothing on the map')).toBeTruthy();
  });
});
