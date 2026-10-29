// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The picture dialog's "Make one" tab, against the server's replies:
 *
 *  1. With no service chosen it says so, and who to ask: nothing to press that would spend.
 *  2. With one: the service and model, the words filled in from the spot, the cost line before Make
 *     (about $0.11 for two pictures at a known price); Make sends the words, the spot, the shape and the
 *     count; the job is followed; its pictures are tiles; a picture's details say the words it was made
 *     from; "Use for Hero" puts it in what changes, credited "Made with AI", and Apply sends it by its ids.
 *  3. A refusal is said in our own words, never the service's.
 *  4. For a sample row: "Make one for each…" by a group, every line's words listed first; one job; each
 *     picture put on every row of its group.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../../../app/query.js';
import { installTestI18n } from '../../../i18n/testing.js';
import { AppToastProvider } from '../../../pages/toasts.js';
import { jsonResponse } from '../../../test/fixtures.js';
import type { MadePicture, MakeJob, MakersView, PicturesView } from '../../api.js';
import { PictureDialog } from './PictureDialog.js';

const SESSION = 'ds_000000000000000000000001';
const HERO_WORDS = 'fried chicken, for Crispy Bites, wide photo, natural light, no text';

const VIEW: PicturesView = {
  ownBuild: false,
  spots: [{ id: 'hero', label: 'Hero', shape: 'wide', shows: 'the best dish', search: 'fried chicken', words: HERO_WORDS, version: 'a1', thumb: null, alt: '', decorative: false, licence: null }],
  tables: [
    {
      table: 'cakes',
      label: 'Cakes',
      column: 'picture',
      people: false,
      rows: [
        { row: 1, label: 'Lemon drizzle', version: 'r1', thumb: null, words: 'Lemon drizzle (cake), photo' },
        { row: 2, label: 'Carrot cake', version: 'r2', thumb: null, words: 'Carrot cake, photo' },
        { row: 3, label: 'Sourdough', version: 'r3', thumb: null, words: 'Sourdough (cake), photo' },
      ],
      groups: [
        {
          column: 'kind',
          label: 'Kind',
          values: [
            { value: 'Cake', rows: [1, 2], words: 'Cake, photo' },
            { value: 'Bread', rows: [3], words: 'Bread, photo' },
          ],
        },
      ],
    },
  ],
  inApp: [],
  mode: 'placeholders',
  legacy: 0,
  sources: [],
  unsplash: 'ok',
  version: 4,
};

const makersOk: MakersView = {
  makers: [],
  chosen: { id: 'env:openai', label: 'OpenAI', model: 'gpt-image-2', local: false },
  state: 'ok',
  usd: 0.053,
  left: { mine: 20, all: 100 },
  limits: { mine: 20, all: 100 },
  resetsAt: 0,
  chat: true,
  canChoose: false,
};

const made = (id: string, title: string, target: MadePicture['target'], words = HERO_WORDS): MadePicture => ({
  id,
  shelf: 'shelf_0000000000000001',
  title,
  creator: 'OpenAI · gpt-image-2',
  source: 'AI',
  licence: { code: 'made', name: 'Made with AI' },
  page: '',
  made: { label: 'OpenAI', model: 'gpt-image-2', words },
  target,
  pinned: true,
  at: 1,
});

let calls: { method: string; url: string; body?: unknown }[];
let makers: MakersView;
let job: MakeJob;

beforeEach(() => {
  calls = [];
  makers = makersOk;
  job = { job: 'job_0000000000000001', state: 'done', label: 'OpenAI', model: 'gpt-image-2', left: { mine: 18, all: 98 }, lines: [{ target: { spot: 'hero' }, name: 'Hero', asked: 2, made: 2, refused: 0, failed: 0, state: 'done', pictures: [made('pic_000000000001', 'Hero', { spot: 'hero' }), made('pic_000000000002', 'Hero', { spot: 'hero' })] }] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }) });
      if (url.endsWith('/designer/pictures/makers')) return jsonResponse(200, makers);
      if (url.endsWith('/pictures/made')) return jsonResponse(200, { pictures: [], running: null });
      if (url.endsWith('/pictures/make') && method === 'POST') return jsonResponse(200, { state: 'accepted', job: { ...job, state: 'running', lines: job.lines.map((line) => ({ ...line, state: 'waiting', made: 0, pictures: [] })) } });
      if (url.includes('/pictures/make/job_')) return jsonResponse(200, job);
      if (url.endsWith('/pictures/pin')) return jsonResponse(200, { state: 'kept', small: false });
      if (url.endsWith('/pictures/apply')) return jsonResponse(200, { results: [{ target: 'spot:hero', state: 'applied' }], version: { n: 5, name: 'v5' }, applied: true, before: 4 });
      if (url.endsWith('/pictures')) return jsonResponse(200, VIEW);
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

function open(spot: string | null = 'hero') {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AppToastProvider>
        <PictureDialog sessionId={SESSION} open onOpenChange={() => undefined} appName="Crispy Bites" spot={spot} working={false} onApplied={() => undefined} onSwappable={() => undefined} swapping={false} />
      </AppToastProvider>
    </QueryClientProvider>,
  );
}

const makeTab = async (): Promise<void> => {
  fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Make one' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Make one' }));
};

describe('making a picture with AI', () => {
  it('says no service is chosen, and who to ask, with nothing to press that would spend', async () => {
    makers = { ...makersOk, chosen: null, state: 'none', usd: null };
    open();
    await makeTab();
    expect(await screen.findByText('Choose a picture service to make pictures here.')).toBeTruthy();
    expect(screen.getByText('Ask whoever manages AI settings.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make' })).toBeNull();
  });

  it('makes from the spot’s words, follows the job, and puts a made picture in what changes credited as made with AI', async () => {
    open();
    await makeTab();
    const words = (await screen.findByRole('textbox', { name: 'What the picture shows' })) as HTMLTextAreaElement;
    expect(words.value).toBe(HERO_WORDS);
    expect(screen.getByText('Made by')).toBeTruthy();
    expect(screen.getByText(/The words are sent to OpenAI\. This is charged to that account, about \$0\.11\. You can make 20 more today\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make' }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/pictures/make') && call.method === 'POST')).toBe(true));
    const sent = calls.find((call) => call.url.endsWith('/pictures/make'))?.body as { id: string; lines: unknown[]; shape: string; count: number };
    expect(sent.id).toMatch(/^make-/);
    expect(sent).toMatchObject({ lines: [{ words: HERO_WORDS, target: { spot: 'hero' } }], shape: 'wide', count: 2 });
    const grid = await screen.findByRole('listbox', { name: 'Pictures made for Hero' }, { timeout: 3000 });
    await waitFor(() => expect(within(grid).getAllByRole('option')).toHaveLength(2));
    fireEvent.keyDown(grid, { key: 'Enter' });
    const pane = await screen.findByRole('region', { name: 'Hero' });
    expect(within(pane).getByText('Made from these words')).toBeTruthy();
    expect(within(pane).getByText(HERO_WORDS)).toBeTruthy();
    expect(within(pane).getAllByText('Made with AI').length).toBeGreaterThan(0);
    fireEvent.click(within(pane).getByRole('button', { name: 'Use for Hero' }));
    const changes = screen.getByRole('region', { name: 'What changes' });
    // Its words for people who cannot see it: the subject our own code wrote, not the style.
    expect(within(changes).getByRole('textbox', { name: 'Describe the picture for people who cannot see it' })).toHaveProperty('value', 'fried chicken');
    expect(within(changes).getByText('Made with AI')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/pictures/apply'))).toBe(true));
    const fills = (calls.find((call) => call.url.endsWith('/pictures/apply'))?.body as { fills: { from: unknown }[] }).fills;
    expect(fills[0]?.from).toEqual({ shelf: 'shelf_0000000000000001', picture: 'pic_000000000001' });
  });

  it('says a refusal in its own words, never the service’s', async () => {
    job = { ...job, lines: [{ target: { spot: 'hero' }, name: 'Hero', asked: 2, made: 0, refused: 2, failed: 0, state: 'done', code: 'refused', pictures: [] }] };
    open();
    await makeTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Make' }));
    expect(await screen.findByText('OpenAI would not make this picture. Try other words.', undefined, { timeout: 3000 })).toBeTruthy();
  });

  it('makes one for each group of a table, its words listed first, and puts each picture on every row of its group', async () => {
    job = {
      ...job,
      lines: [
        { target: { table: 'cakes', column: 'kind', value: 'Cake' }, name: 'Cake', asked: 1, made: 1, refused: 0, failed: 0, state: 'done', pictures: [made('pic_000000000011', 'Cake', { table: 'cakes', column: 'kind', value: 'Cake' }, 'Cake, photo')] },
        { target: { table: 'cakes', column: 'kind', value: 'Bread' }, name: 'Bread', asked: 1, made: 1, refused: 0, failed: 0, state: 'done', pictures: [made('pic_000000000012', 'Bread', { table: 'cakes', column: 'kind', value: 'Bread' }, 'Bread, photo')] },
      ],
    };
    open(null);
    fireEvent.click(await screen.findByRole('button', { name: /Lemon drizzle/ }));
    await makeTab();
    expect(await screen.findByText(/These are made-up pictures\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make one for each…' }));
    fireEvent.click(screen.getByRole('radio', { name: 'One for each kind (2)' }));
    expect((screen.getByRole('textbox', { name: 'Words for Cake' }) as HTMLInputElement).value).toBe('Cake, photo');
    expect(screen.getByText(/This makes 2 pictures\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make them' }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith('/pictures/make'))).toBe(true));
    expect(calls.find((call) => call.url.endsWith('/pictures/make'))?.body).toMatchObject({
      lines: [
        { words: 'Cake, photo', target: { table: 'cakes', column: 'kind', value: 'Cake' } },
        { words: 'Bread, photo', target: { table: 'cakes', column: 'kind', value: 'Bread' } },
      ],
      count: 1,
    });
    expect(await screen.findByText('2 of 2 made. They are in what changes.', undefined, { timeout: 3000 })).toBeTruthy();
    const changes = screen.getByRole('region', { name: 'What changes' });
    // The cake's picture on both cake rows, the bread's on the bread row.
    await waitFor(() => expect(within(changes).getAllByText('Made with AI')).toHaveLength(3));
  });
});
