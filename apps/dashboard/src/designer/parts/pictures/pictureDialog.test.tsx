// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The picture dialog, against the server's replies:
 *
 *  1. It opens on the spot it was asked for and searches with that spot's words; a tile says its
 *     title, creator and licence; Enter opens the details (its licence first), "Use for {spot}" puts it
 *     in "what changes" with its words for people who cannot see it, and focus goes back to the tile.
 *  2. Apply sends each fill with the spot's version, the words (none for a decorative one) and the
 *     choice of the footer, with one id; what was applied leaves, and the dialog closes.
 *  3. Escape closes the details first; leaving with changes asks, and "Keep choosing" stays.
 *  4. "Credit + same licence" is hidden at first, and says so when it hides everything found.
 *  5. While a turn runs, Apply waits and says why; search off says where else to look; an app
 *     made before spots offers "Make them swappable".
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../../app/query.js';
import { installTestI18n } from '../../../i18n/testing.js';
import { AppToastProvider } from '../../../pages/toasts.js';
import { jsonResponse } from '../../../test/fixtures.js';
import type { FoundPicture, PicturesApplied, PicturesView } from '../../api.js';
import { PictureDialog } from './PictureDialog.js';

const SESSION = 'ds_000000000000000000000001';

const VIEW: PicturesView = {
  ownBuild: false,
  spots: [
    { id: 'hero', label: 'Hero', shape: 'wide', shows: 'the shop’s best dish', search: 'fried chicken', version: 'a1', thumb: null, alt: '', decorative: false, licence: null },
    { id: 'kitchen', label: 'Kitchen', shape: 'square', shows: 'the kitchen at work', search: 'restaurant kitchen', version: 'b2', thumb: null, alt: '', decorative: false, licence: null },
  ],
  tables: [],
  inApp: [],
  mode: 'placeholders',
  legacy: 0,
  sources: [{ name: 'Openverse', busy: null }],
  unsplash: 'ok',
  version: 4,
};

const found = (id: string, code: FoundPicture['licence']['code'], title: string): FoundPicture => ({ id, title, creator: 'Maya Lind', source: 'Openverse', licence: { code, name: code === 'by' ? 'CC BY 2.0' : 'CC BY-SA 4.0' }, page: `https://example.org/${id}` });

let calls: { method: string; url: string; body?: unknown }[];
let view: PicturesView;
let results: FoundPicture[];
let applied: PicturesApplied;
/** The fewer words the server says found the pictures; none when the words asked for did. */
let fewer: string | undefined;

beforeEach(() => {
  calls = [];
  view = VIEW;
  results = [found('p1', 'by', 'Fried chicken on a board'), found('p2', 'by', 'Chicken and fries')];
  fewer = undefined;
  applied = { results: [{ target: 'spot:hero', state: 'applied' }], version: { n: 5, name: 'v5 · Pictures: Hero' }, applied: true, before: 4 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }) });
      if (url.includes('/pictures/search')) return jsonResponse(200, { state: 'ok', shelf: 'sh1', pictures: results, more: true, page: Number(new URL(url, 'http://x').searchParams.get('page') ?? '1'), ...(fewer === undefined ? {} : { q: fewer }) });
      if (url.endsWith('/pictures/pin')) return jsonResponse(200, { state: 'kept', small: false });
      if (url.endsWith('/pictures/apply')) return jsonResponse(200, applied);
      if (url.endsWith('/pictures')) return jsonResponse(200, view);
      return jsonResponse(404, { error: { code: 'NOT_FOUND', message: url } });
    }),
  );
});

let restore: () => void;
beforeAll(() => {
  restore = installTestI18n();
});
afterAll(() => restore());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(over: Partial<Parameters<typeof PictureDialog>[0]> = {}) {
  const changed: boolean[] = [];
  const done: PicturesApplied[] = [];
  const swapped: number[] = [];
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AppToastProvider>
        <PictureDialog
          sessionId={SESSION}
          open
          onOpenChange={(next) => changed.push(next)}
          appName="Crispy Bites"
          spot="hero"
          working={false}
          onApplied={(reply) => done.push(reply)}
          onSwappable={() => swapped.push(1)}
          swapping={false}
          {...over}
        />
      </AppToastProvider>
    </QueryClientProvider>,
  );
  return { changed, done, swapped };
}

const dialog = () => screen.getByRole('dialog', { name: 'Pictures' });

describe('the picture dialog', () => {
  it('searches with the spot’s own words, opens a picture’s details, and puts it in what changes with its words', async () => {
    open();
    const grid = await screen.findByRole('listbox', { name: 'Pictures for Hero' });
    expect(calls.find((call) => call.url.includes('/pictures/search'))?.url).toContain('q=fried+chicken');
    const tiles = within(grid).getAllByRole('option');
    expect(tiles[0]?.getAttribute('aria-label')).toBe('Fried chicken on a board by Maya Lind, Credit needed');
    fireEvent.keyDown(grid, { key: 'Enter' });
    const pane = await screen.findByRole('region', { name: 'Fried chicken on a board' });
    expect(within(pane).getByText('Credit needed')).toBeTruthy();
    expect(within(pane).getByText(/Credit the creator\./)).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Fried chicken on a board'));
    fireEvent.click(within(pane).getByRole('button', { name: 'Use for Hero' }));
    const changes = screen.getByRole('region', { name: 'What changes' });
    expect(within(changes).getByRole('textbox', { name: 'Describe the picture for people who cannot see it' })).toHaveProperty('value', 'Fried chicken on a board');
    await waitFor(() => expect(document.activeElement).toBe(within(grid).getAllByRole('option')[0]));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/pictures/pin'))).toBe(true));
  });

  it('shows the fewer words the server found pictures with, and goes on with them for more', async () => {
    fewer = 'fried';
    open();
    await screen.findByRole('listbox', { name: 'Pictures for Hero' });
    expect(calls.find((call) => call.url.includes('/pictures/search'))?.url).toContain('q=fried+chicken');
    await waitFor(() => expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('fried'));
    fewer = undefined;
    results = [found('p3', 'by', 'Fried rice')];
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await waitFor(() => expect(calls.filter((call) => call.url.includes('/pictures/search')).at(-1)?.url).toMatch(/q=fried&.*page=2/));
  });

  it('applies each fill with its spot’s version, its words and the footer’s choice, once, and closes', async () => {
    const { changed, done } = open();
    const grid = await screen.findByRole('listbox', { name: 'Pictures for Hero' });
    fireEvent.click(within(grid).getAllByRole('option')[1] as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Use for Hero' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe the picture for people who cannot see it' }), { target: { value: 'Chicken and fries on a tray' } });
    fireEvent.click(screen.getByRole('radio', { name: 'ask me to choose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(done).toHaveLength(1));
    const sent = calls.find((call) => call.url.endsWith('/pictures/apply'))?.body as { id: string; fills: unknown[]; mode?: string };
    expect(sent.id).toMatch(/^apply-/);
    expect(sent.fills).toEqual([{ spot: 'hero', version: 'a1', from: { shelf: 'sh1', picture: 'p2' }, alt: 'Chicken and fries on a tray', decorative: false }]);
    expect(sent.mode).toBe('choose');
    expect(changed).toEqual([false]);
  });

  it('closes the details first on Escape, then asks before changes are lost', async () => {
    const { changed } = open();
    const grid = await screen.findByRole('listbox', { name: 'Pictures for Hero' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Use for Hero' }));
    fireEvent.keyDown(grid, { key: 'Enter' });
    await screen.findByRole('region', { name: 'Fried chicken on a board' });
    fireEvent.keyDown(document.activeElement ?? dialog(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Fried chicken on a board' })).toBeNull());
    expect(changed).toEqual([]);
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    const ask = await screen.findByRole('alertdialog', { name: 'Leave without applying 1 change?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep choosing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }));
    expect(changed).toEqual([false]);
  });

  it('hides Credit + same licence at first, and says so when that hides everything found', async () => {
    results = [found('p3', 'by-sa', 'Kitchen at night')];
    open();
    const ask = await screen.findByText('No pictures without conditions match. Show pictures with Credit + same licence too?');
    expect(ask).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Credit + same licence' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
    expect(within(await screen.findByRole('listbox', { name: 'Pictures for Hero' })).getAllByRole('option')).toHaveLength(1);
  });

  it('waits while a turn runs, says where else to look with search off, and offers to make an old app’s pictures swappable', async () => {
    view = { ...VIEW, sources: [], legacy: 3 };
    const { swapped } = open({ working: true });
    await screen.findByText('Picture search is off on this server.');
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();
    expect(screen.getByText('3 pictures are not in spots yet.')).toBeTruthy();
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(apply.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Wait for the Designer to finish, then apply.');
    const swap = screen.getByRole('button', { name: 'Make them swappable' });
    fireEvent.click(swap);
    expect(swapped).toEqual([]);
    cleanup();
    const idle = open({ working: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Make them swappable' }));
    await act(async () => undefined);
    expect(idle.swapped).toEqual([1]);
  });
});
