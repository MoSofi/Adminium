// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The preview: which sides it offers, the one-use ticket it opens each side
 * with, a width change that must not reload (a reload spends a new ticket),
 * a reload and an `app-changed` that must, and the states a turn puts it in.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@adminium/ui';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { DesignerEvent, DesignerEventBody, DesignerSession } from '../api.js';
import { previewState, sideNamed } from './Preview.js';
import { WorkArea } from './WorkArea.js';
import { looksNow, sightFrom } from './sight.js';
import { foldTurns, type TurnView } from './turns.js';

// The diagram is another test's; here the tab only has to open.
vi.mock('../architecture/ArchitectureTab.js', () => ({ default: () => null }));

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(): void {}
  close(): void {}
}

const SESSION: DesignerSession = {
  id: 'ds_000000000000000000000009',
  appKey: 'repairs',
  title: 'Repair Desk',
  target: 'auto',
  connectionId: 'env:ollama',
  model: 'm',
  createdAt: 1,
  updatedAt: 1,
  turns: 1,
  version: 1,
  createdApp: true,
  tokens: { in: 0, out: 0 },
};

let tickets: string[];
let sides: { side: string; prefix: string; navAvailable: boolean }[];
let installed: boolean;
let live: boolean;

beforeEach(() => {
  tickets = [];
  installed = true;
  live = false;
  sides = [
    { side: 'staff', prefix: '/apps/repairs/staff', navAvailable: true },
    { side: 'customer', prefix: '/apps/repairs/customer', navAvailable: true },
  ];
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/system/info') return Promise.resolve(jsonResponse(200, { designer: { mode: live ? 'live' : 'local', link: false } }));
      if (url === '/api/v1/apps') return Promise.resolve(jsonResponse(200, { apps: installed ? [{ key: 'repairs', version: '0.1.0', sides }] : [], staged: [] }));
      if (url.endsWith('/preview-ticket')) {
        const { to } = JSON.parse(String(init?.body)) as { to: string };
        tickets.push(to);
        return Promise.resolve(jsonResponse(200, { url: `http://localhost:4731/designer-preview/enter?ticket=t${String(tickets.length)}&to=${encodeURIComponent(to)}`, origin: 'http://localhost:4731' }));
      }
      return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'nope', requestId: 'r' } }));
    }),
  );
});

let restoreI18n: () => void;
beforeAll(() => {
  restoreI18n = installTestI18n();
});
afterAll(() => {
  restoreI18n();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(turns: TurnView[] = [], onFix = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <div className="flex h-[600px]">
          <WorkArea session={SESSION} turns={turns} onFix={onFix} />
        </div>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onFix };
}

function turn(over: Partial<TurnView>): TurnView {
  return {
    turn: 1,
    text: 'x',
    attachments: [],
    reply: '',
    steps: [],
    stepCount: 0,
    usage: null,
    spend: [],
    cards: [],
    version: null,
    look: null,
    style: null,
    buildFailed: null,
    limit: null,
    error: null,
    notApplied: null,
    outcome: 'done',
    startedAt: 0,
    finishedAt: 1,
    changedFiles: false,
    ...over,
  };
}

const frame = () => document.querySelector('iframe') as HTMLIFrameElement;

describe('the preview', () => {
  it('offers the app’s own sides, opens the first one by a ticket, and frames the others by theirs', async () => {
    mount();
    await waitFor(() => expect(frame()).not.toBeNull());
    expect(within(screen.getByRole('group', { name: 'Side' })).getAllByRole('button').map((button) => button.textContent)).toEqual(['Dashboard', 'Staff', 'Customer']);
    expect(screen.getByRole('button', { name: 'Staff' }).getAttribute('aria-pressed')).toBe('true');
    expect(tickets).toEqual(['/apps/repairs/staff/']);
    expect(frame().src).toContain('ticket=t1');

    // The dashboard is the owner's own, on the Designer's name: no ticket, no preview user.
    await userEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    await waitFor(() => expect(frame().getAttribute('src')).toBe('/'));
    expect(screen.getByText('Seen as: you, the owner')).toBeTruthy();
    expect(tickets).toEqual(['/apps/repairs/staff/']);
    await userEvent.click(screen.getByRole('button', { name: 'Customer' }));
    await waitFor(() => expect(tickets.at(-1)).toBe('/apps/repairs/customer/'));
  });

  it('leaves out a side the app does not have', async () => {
    sides = [];
    mount();
    await waitFor(() => expect(frame()?.getAttribute('src')).toBe('/'));
    expect(tickets).toEqual([]);
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Staff' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Customer' })).toBeNull();
  });

  it('keeps the frame on a width change, and opens it again on Reload and when the app is applied', async () => {
    mount();
    await waitFor(() => expect(frame()).not.toBeNull());
    const first = frame();
    await userEvent.click(screen.getByRole('button', { name: 'Phone' }));
    await userEvent.click(screen.getByRole('button', { name: 'Tablet' }));
    expect(frame()).toBe(first);
    expect(tickets).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(tickets).toHaveLength(2));
    await waitFor(() => expect(frame().src).toContain('ticket=t2'));

    // Another app applied: nothing. This one: a fresh ticket.
    const socket = FakeSocket.all.at(-1);
    act(() => socket?.onmessage?.({ data: JSON.stringify({ channel: 'config-changed', type: 'app-changed', data: { key: 'other' }, ts: '' }) }));
    act(() => socket?.onmessage?.({ data: JSON.stringify({ channel: 'config-changed', type: 'app-changed', data: { key: 'repairs' }, ts: '' }) }));
    await waitFor(() => expect(tickets).toHaveLength(3));
  });

  it('reloads once a file’s rows are loaded: the app is the same, what its pages show is not', async () => {
    const loaded = (state: 'running' | 'done', outcome: TurnView['outcome'] = null) => [turn({ outcome, steps: [{ id: 's1', tool: 'load_rows', label: 'Loaded 40 rows', state, ms: 10, detail: null, folded: 1, ...(state === 'done' ? { outcome: 'added' as const, count: 40 } : {}) }] })];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (turns: TurnView[]) => (
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <div className="flex h-[600px]">
            <WorkArea session={SESSION} turns={turns} onFix={() => undefined} />
          </div>
        </ThemeProvider>
      </QueryClientProvider>
    );
    const shown = render(view(loaded('running')));
    await waitFor(() => expect(tickets).toHaveLength(1));
    shown.rerender(view(loaded('done')));
    await waitFor(() => expect(tickets).toHaveLength(2));
    // The same rows seen again start nothing; nor does the turn ending.
    shown.rerender(view(loaded('done', 'done')));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(tickets).toHaveLength(2);
    // A session opened later: its past loads arrive with the first read of events, and are no reason to spend a ticket.
    cleanup();
    tickets.length = 0;
    const later = render(view([]));
    await waitFor(() => expect(tickets).toHaveLength(1));
    later.rerender(view(loaded('done', 'done')));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(tickets).toHaveLength(1);
  });

  it('says there is nothing yet before the app is applied', async () => {
    installed = false;
    mount();
    expect(await screen.findByText('Nothing to show yet. Once the Designer applies the app, it shows here.')).toBeTruthy();
    expect(tickets).toEqual([]);
  });

  it('says the preview is off on a live server, and asks for no ticket', async () => {
    live = true;
    mount();
    expect(await screen.findByText('The preview is off on a live server. Open the app from the dashboard once it is applied.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Side' })).toBeNull();
    expect(tickets).toEqual([]);
  });

  it('says a side is building while the turn builds it', async () => {
    mount([turn({ outcome: null, finishedAt: null, steps: [{ id: 'b', tool: 'build_sides', label: 'Building', state: 'running', ms: null, detail: null, folded: 1 }] })]);
    expect(await screen.findByText('Building the staff side…')).toBeTruthy();
  });

  it('shows a side that did not build with its first error, and asks the Designer to fix it', async () => {
    const { onFix } = mount([turn({ buildFailed: 'src/Today.tsx: Cannot find name "jobs".\nmore', steps: [{ id: 'b', tool: 'build_sides', label: 'x', state: 'failed', ms: 10, detail: 'src/Today.tsx: Cannot find name "jobs".\nmore', folded: 1 }] })]);
    await screen.findByRole('button', { name: 'Staff' });
    const card = await screen.findByRole('alert');
    expect(card.textContent).toContain('The staff side did not build.');
    expect(card.textContent).toContain('src/Today.tsx: Cannot find name "jobs".');
    expect(card.textContent).not.toContain('more');
    await userEvent.click(screen.getByRole('button', { name: 'Ask the Designer to fix it' }));
    expect(onFix).toHaveBeenCalledWith('The screens did not build: src/Today.tsx: Cannot find name "jobs". Please fix it.');
  });

  it('goes by the turn’s last build: one that failed and was then fixed is not shown, and the error names its own side', () => {
    const broke = 'Could not build the customer side of "cakes":\napps/cakes/customer/src/App.tsx:5:80: Could not resolve "react"\nmore';
    let seq = 0;
    const event = (body: DesignerEventBody): DesignerEvent => ({ ...body, seq: (seq += 1), turn: 1, at: seq }) as DesignerEvent;
    const step = (id: string, state: 'done' | 'failed'): DesignerEvent =>
      event({ kind: 'step', id, tool: 'build_sides', label: 'x', state, ms: 10, ...(state === 'failed' ? { detail: broke, ended: 'error' as const } : {}) });
    const ended = event({ kind: 'turn-finished', outcome: 'done' });
    // Fixed by a later build of the tool's, or by the engine's own build at the end of the turn (or after "Change the look").
    expect(previewState(foldTurns([step('a', 'failed'), step('b', 'done'), ended]))).toEqual({ building: false, failed: null });
    expect(previewState(foldTurns([step('a', 'failed'), event({ kind: 'build', ok: true, problems: [] }), ended]))).toEqual({ building: false, failed: null });
    expect(previewState(foldTurns([step('a', 'done'), event({ kind: 'build', ok: false, problems: ['staff: x is not defined'] }), ended])).failed).toBe('staff: x is not defined');
    const stuck = previewState(foldTurns([step('a', 'done'), step('b', 'failed'), ended]));
    expect(stuck.failed).toBe('Could not build the customer side of "cakes":\napps/cakes/customer/src/App.tsx:5:80: Could not resolve "react"');
    expect(sideNamed(stuck.failed ?? '')).toBe('customer');
    expect(sideNamed('src/Today.tsx: Cannot find name "jobs".')).toBeNull();
  });

  it('sends on what the screen saw of itself while its turn runs, from its own frame only, and not once a person switched the look off', async () => {
    window.localStorage.removeItem('adminium.designer.sees');
    const sent = (): unknown[] =>
      vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).endsWith(`/sessions/${SESSION.id}/sight`))
        .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as unknown);
    const sight = { type: 'adminium:side-sight', app: SESSION.appKey, side: 'customer', width: 1280, faults: [{ kind: 'overlap', first: 'input', second: 'input' }], picture: 'data:image/jpeg;base64,/9j/4AAQ' };
    // The turn is still running: the Designer is waiting to see what it built.
    mount([turn({ outcome: null })]);
    await screen.findByRole('button', { name: 'Staff' });
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    const say = (origin: string, data: unknown, source?: Window): void => {
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { origin, data, source: source ?? document.querySelector('iframe')?.contentWindow ?? null }));
      });
    };
    say('http://evil.test', sight);
    say('http://localhost:4731', { ...sight, app: 'another' });
    say('http://localhost:4731', sight, window);
    say('http://localhost:4731', { ...sight, side: 'dashboard' });
    expect(sent()).toEqual([]);
    say('http://localhost:4731', sight);
    expect(sent()).toEqual([{ side: 'customer', width: 1280, faults: [{ kind: 'overlap', first: 'input', second: 'input' }], picture: 'data:image/jpeg;base64,/9j/4AAQ' }]);
    // A screen that posts again and again sends nothing more for the frame as it is open.
    for (let again = 0; again < 20; again += 1) say('http://localhost:4731', sight);
    expect(sent()).toHaveLength(1);
    // A picture that is not a JPEG's data address is left out, and so is anything of a fault that is not a plain value; the rest still goes.
    expect(sightFrom({ ...sight, picture: 'https://evil.test/x.jpg', faults: [{ kind: 'broken', count: 2, extra: { deep: true } }, 'a sentence', null] }, SESSION.appKey)).toEqual({
      side: 'customer',
      width: 1280,
      faults: [{ kind: 'broken', count: 2 }],
    });
    expect(sightFrom(sight, 'another-app')).toBeNull();
    // It is no error of the screen: nothing is shown for it.
    expect(screen.queryByRole('alert')).toBeNull();

    // Switched off from the preview's own bar: nothing more is sent, and the choice is kept for the next turn.
    const look = screen.getByRole('button', { name: 'The Designer looks at the page after it builds' });
    expect(look.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(look);
    expect(look.getAttribute('aria-pressed')).toBe('false');
    expect(window.localStorage.getItem('adminium.designer.sees')).toBe('off');
    say('http://localhost:4731', sight);
    expect(sent()).toHaveLength(1);
    window.localStorage.removeItem('adminium.designer.sees');

    // No turn runs: nobody is waiting for it, and nothing is sent.
    cleanup();
    mount([turn({})]);
    await screen.findByRole('button', { name: 'Staff' });
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    say('http://localhost:4731', sight);
    expect(sent()).toHaveLength(1);
  });

  it('keeps the frame while another tab shows: the same frame, no new ticket, out of sight and out of reach, and still looked at', async () => {
    window.localStorage.removeItem('adminium.designer.sees');
    const sent = (): unknown[] => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith(`/sessions/${SESSION.id}/sight`));
    mount([turn({ outcome: null })]);
    await waitFor(() => expect(frame()).not.toBeNull());
    const first = frame();
    const panel = first.closest('[role="tabpanel"]') as HTMLElement;
    expect(panel.hasAttribute('inert')).toBe(false);

    await userEvent.click(screen.getByRole('tab', { name: 'Architecture' }));
    expect(screen.getByRole('tab', { name: 'Architecture' }).getAttribute('aria-selected')).toBe('true');
    expect(frame()).toBe(first);
    // Hidden as a thing still laid out at its size, never taken out of the layout: a frame with no width is one the Designer cannot look at.
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(panel.className).toContain('invisible');
    expect(panel.className).not.toMatch(/(^| )hidden( |$)/);
    // Its own bar goes with it.
    expect(screen.queryByRole('group', { name: 'Side' })).toBeNull();
    // A turn sent from here is still shown the page, and what the page says of itself still goes on.
    expect(looksNow()).toBe(true);
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { origin: 'http://localhost:4731', data: { type: 'adminium:side-sight', app: SESSION.appKey, side: 'staff', width: 1280, faults: [] }, source: first.contentWindow }),
      );
    });
    expect(sent()).toHaveLength(1);

    await userEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(frame()).toBe(first);
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(panel.className).not.toContain('invisible');
    expect(tickets).toHaveLength(1);
  });

  it('shows a screen that built and then stopped as it opened, heard from its own frame, and asks for the fix', async () => {
    const { onFix } = mount([turn({})]);
    await screen.findByRole('button', { name: 'Staff' });
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    const say = (origin: string, data: unknown, source?: Window): void => {
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { origin, data, source: source ?? document.querySelector('iframe')?.contentWindow ?? null }));
      });
    };
    // Another page's word, or another app's, is not taken.
    say('http://evil.test', { type: 'adminium:side-error', app: SESSION.appKey, side: 'staff', message: 'x' });
    say('http://localhost:4731', { type: 'adminium:side-error', app: 'another', side: 'staff', message: 'x' });
    // Nor a window that is not this page's frame, whatever address it says it has.
    say('http://localhost:4731', { type: 'adminium:side-error', app: SESSION.appKey, side: 'staff', message: 'x' }, window);
    expect(screen.queryByRole('alert')).toBeNull();
    say('http://localhost:4731', { type: 'adminium:side-error', app: SESSION.appKey, side: 'staff', message: 'Rendered more hooks than during the previous render.' });
    const card = await screen.findByRole('alert');
    expect(card.textContent).toContain('The staff screen stopped with an error.');
    expect(card.textContent).toContain('Rendered more hooks than during the previous render.');
    await userEvent.click(screen.getByRole('button', { name: 'Ask the Designer to fix it' }));
    expect(onFix).toHaveBeenCalledWith('The screen builds, and stops with an error when it opens: the staff screen reported “Rendered more hooks than during the previous render.” Please fix it.');
  });

  it('shows an error a screen went on from, asks for the fix, and lets the page be looked at', async () => {
    const { onFix } = mount([turn({})]);
    await screen.findByRole('button', { name: 'Staff' });
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://localhost:4731',
          data: { type: 'adminium:side-error', went: true, app: SESSION.appKey, side: 'staff', message: "Cannot read properties of undefined (reading 'cakes')" },
          source: document.querySelector('iframe')?.contentWindow ?? null,
        }),
      );
    });
    const card = await screen.findByRole('alert');
    expect(card.textContent).toContain('The staff screen hit an error and went on. A part of it may be empty.');
    expect(card.textContent).toContain("Cannot read properties of undefined (reading 'cakes')");
    await userEvent.click(screen.getByRole('button', { name: 'Ask the Designer to fix it' }));
    expect(onFix).toHaveBeenCalledWith("The staff screen opens, and something in it fails with an error, so a part of it stays empty: Cannot read properties of undefined (reading 'cakes') Please fix the screen.");
    // The page still works: the card can be put away.
    await userEvent.click(screen.getByRole('button', { name: 'Keep looking at the page' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a call the screen made that Adminium refused, asks for the fix, and lets the page be looked at', async () => {
    const { onFix } = mount([turn({})]);
    await screen.findByRole('button', { name: 'Staff' });
    await waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://localhost:4731',
          data: { type: 'adminium:side-error', refused: true, app: SESSION.appKey, side: 'staff', message: 'VALIDATION_FAILED on /api/v1/data/main/orders: `where` does not match the filter grammar.' },
          source: document.querySelector('iframe')?.contentWindow ?? null,
        }),
      );
    });
    const card = await screen.findByRole('alert');
    expect(card.textContent).toContain('The staff screen asked for something Adminium refuses.');
    await userEvent.click(screen.getByRole('button', { name: 'Ask the Designer to fix it' }));
    expect(onFix).toHaveBeenCalledWith(
      'The staff screen asks Adminium for something it refuses, so people see an error there: VALIDATION_FAILED on /api/v1/data/main/orders: `where` does not match the filter grammar. Please fix the screen.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Keep looking at the page' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
