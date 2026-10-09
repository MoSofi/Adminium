// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where each side of the preview is: what the page believes of a side that
 * says so, the page every opening carries, going to a typed page on each of
 * the three sides, and the list of opened pages.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@adminium/ui';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { DesignerSession } from '../api.js';
import { Preview } from './Preview.js';
import { usePreview, type PreviewModel } from './usePreview.js';

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const SESSION: DesignerSession = {
  id: 'ds_000000000000000000000011',
  appKey: 'shop',
  title: 'Crispy Bites',
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
const SITE = 'http://localhost:4731';

let tickets: string[];
let refuse: (to: string) => boolean;
let model: PreviewModel;

function Harness(): null | React.ReactElement {
  model = usePreview(SESSION, []);
  return <Preview preview={model} session={SESSION} turns={[]} onFix={() => undefined} compact={false} />;
}

beforeEach(() => {
  tickets = [];
  refuse = () => false;
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/system/info') return Promise.resolve(jsonResponse(200, { designer: { mode: 'local', link: false } }));
      if (url === '/api/v1/apps') {
        return Promise.resolve(
          jsonResponse(200, {
            apps: [
              {
                key: 'shop',
                version: '0.1.0',
                sides: [
                  { side: 'staff', prefix: '/apps/shop/staff', navAvailable: true },
                  { side: 'customer', prefix: '/apps/shop/customer', navAvailable: true },
                ],
              },
            ],
            staged: [],
          }),
        );
      }
      if (url.endsWith('/preview-ticket')) {
        const { to } = JSON.parse(String(init?.body)) as { to: string };
        tickets.push(to);
        if (refuse(to)) return Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'That is not a page of this app.', requestId: 'r', details: { to } } }));
        return Promise.resolve(jsonResponse(200, { url: `${SITE}/designer-preview/enter?ticket=t${String(tickets.length)}&to=${encodeURIComponent(to)}`, origin: SITE }));
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

function mount(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <div className="flex h-[600px]">
          <Harness />
        </div>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const frame = () => document.querySelector('iframe') as HTMLIFrameElement;

/** The frame's own window, as far as this page uses one: what was posted to it, and (the dashboard) its address. */
function inside(pathname = '/') {
  const win = {
    posted: [] as { message: unknown; origin: string }[],
    postMessage(message: unknown, origin: string) {
      win.posted.push({ message, origin });
    },
    location: { pathname },
    history: {
      state: { key: 'k' } as unknown,
      replaced: [] as string[],
      replaceState(_state: unknown, _unused: string, url: string) {
        win.history.replaced.push(url);
        win.location.pathname = url;
      },
    },
    events: [] as string[],
    dispatchEvent(event: Event) {
      win.events.push(event.type);
      return true;
    },
  };
  Object.defineProperty(frame(), 'contentWindow', { configurable: true, value: win });
  return win;
}

function say(data: unknown, from: { origin?: string; source?: unknown } = {}): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { origin: from.origin ?? SITE, data, source: ('source' in from ? from.source : frame().contentWindow) as MessageEventSource | null }));
  });
}
const here = (side: string, path: string, title = '') => ({ type: 'adminium:side-location', app: 'shop', side, path, title });

async function onSide(side: 'dashboard' | 'staff' | 'customer'): Promise<void> {
  act(() => model.setSide(side));
  if (side === 'dashboard') await waitFor(() => expect(frame()?.getAttribute('src')).toBe(model.dashboardSrc));
  else await waitFor(() => expect(frame()?.src ?? '').toContain(encodeURIComponent(`/apps/shop/${side}`)));
}

describe('where the preview is', () => {
  it('believes a side that says where it is only from the preview’s own site, one of this page’s frames, this app and the side shown', async () => {
    mount();
    await onSide('customer');
    const win = inside();
    expect(model.path).toBe('/');
    expect(model.spoken).toBe(false);

    say(here('customer', '/menu'), { origin: 'http://evil.test' });
    say(here('customer', '/menu'), { source: window });
    say({ ...here('customer', '/menu'), app: 'another' });
    say(here('staff', '/menu'));
    say(here('customer', '/a b'));
    say(here('customer', '/a\\b'));
    expect(model.path).toBe('/');
    expect(model.spoken).toBe(false);

    say(here('customer', '/menu/7/', 'Spicy wings'));
    expect(model.path).toBe('/menu/7');
    expect(model.to).toBe('/apps/shop/customer/menu/7');
    expect(model.spoken).toBe(true);
    // Hearing where the frame is opens nothing again.
    expect(tickets).toEqual(['/apps/shop/customer/']);
    expect(frame().contentWindow).toBe(win);
  });

  it('opens a side again on the page it was on: after a reload, and after another side was looked at', async () => {
    mount();
    await onSide('customer');
    inside();
    say(here('customer', '/menu', 'Menu'));
    act(() => model.reload());
    await waitFor(() => expect(tickets).toEqual(['/apps/shop/customer/', '/apps/shop/customer/menu']));
    // A new opening has said nothing yet.
    expect(model.spoken).toBe(false);

    await onSide('staff');
    expect(model.path).toBe('/');
    expect(tickets.at(-1)).toBe('/apps/shop/staff/');
    act(() => model.setSide('customer'));
    await waitFor(() => expect(tickets.at(-1)).toBe('/apps/shop/customer/menu'));
    expect(model.path).toBe('/menu');
    await waitFor(() => expect(frame()?.src ?? '').toContain(encodeURIComponent('/apps/shop/customer/menu')));

    // A size is how the frame is drawn, not where it is: nothing is asked for.
    const count = tickets.length;
    const same = frame();
    act(() => model.setWidth('phone'));
    act(() => model.setWidth('tablet'));
    expect(frame()).toBe(same);
    expect(tickets).toHaveLength(count);
  });

  it('opens the first page when the server will not send the frame to the page it was on', async () => {
    mount();
    await onSide('customer');
    inside();
    say(here('customer', '/menu/a..b'));
    refuse = (to) => to.includes('..');
    act(() => model.reload());
    await waitFor(() => expect(tickets.slice(-2)).toEqual(['/apps/shop/customer/menu/a..b', '/apps/shop/customer/']));
    await waitFor(() => expect(model.path).toBe('/'));
    expect(model.ticketError).toBeNull();
    // The first page refused is refused: there is nowhere else to go.
    refuse = () => true;
    act(() => model.reload());
    await waitFor(() => expect(model.ticketError).toBe('That is not a page of this app.'));
  });

  it('sends a customer side to a page by a word to its frame once it has spoken, and by a new opening before', async () => {
    mount();
    await onSide('customer');
    const quiet = inside();
    // A side that has said nothing (built before pages had addresses): opened again on the page.
    act(() => model.go('/menu'));
    await waitFor(() => expect(tickets.at(-1)).toBe('/apps/shop/customer/menu'));
    expect(quiet.posted).toEqual([]);

    await waitFor(() => expect(frame().src).toContain(encodeURIComponent('/apps/shop/customer/menu')));
    const win = inside();
    say(here('customer', '/menu', 'Menu'));
    const count = tickets.length;
    act(() => model.go('/specials/of%20the%20day'));
    expect(win.posted).toEqual([{ message: { type: 'adminium:host:set', path: '/specials/of%20the%20day' }, origin: SITE }]);
    expect(tickets).toHaveLength(count);
    // The path shown is the one the side says it went to, not the one it was sent.
    expect(model.path).toBe('/menu');
    say(here('customer', '/specials/of%20the%20day', 'Not found'));
    expect(model.path).toBe('/specials/of%20the%20day');
  });

  it('keeps the customer pages opened, newest first with their titles, the first page always there', async () => {
    mount();
    await onSide('customer');
    inside();
    expect(model.visited).toEqual([{ path: '/', title: '' }]);
    say(here('customer', '/', 'Crispy Bites'));
    say(here('customer', '/menu', 'Menu'));
    say(here('customer', '/menu/7', 'Spicy wings'));
    say(here('customer', '/menu', 'Our menu'));
    expect(model.visited).toEqual([
      { path: '/menu', title: 'Our menu' },
      { path: '/menu/7', title: 'Spicy wings' },
      { path: '/', title: 'Crispy Bites' },
    ]);
  });

  it('hands the staff side its page, follows the side’s own moves, and opens it again where it was', async () => {
    mount();
    await waitFor(() => expect(tickets).toEqual(['/apps/shop/staff/']));
    await waitFor(() => expect(frame()).not.toBeNull());
    const win = inside();
    say({ type: 'adminium:surface:hello', v: 1, appKey: 'shop', side: 'staff', path: '' });
    expect(win.posted.map((entry) => (entry.message as { type: string; path?: string }).type)).toContain('adminium:host:init');
    say(here('staff', '/', 'Today'));
    expect(model.spoken).toBe(true);

    // The side moved itself: the page follows, and says nothing back.
    const before = win.posted.length;
    say({ type: 'adminium:surface:navigate', v: 1, path: 'requests' });
    expect(model.path).toBe('/requests');
    expect(win.posted.slice(before).filter((entry) => (entry.message as { path?: string }).path !== undefined)).toEqual([]);

    // A typed page: the app frame tells the side.
    act(() => model.go('/done'));
    expect(model.path).toBe('/done');
    expect(win.posted.at(-1)).toEqual({ message: { type: 'adminium:host:set', path: 'done' }, origin: SITE });
    expect(tickets).toHaveLength(1);

    act(() => model.reload());
    await waitFor(() => expect(tickets).toEqual(['/apps/shop/staff/', '/apps/shop/staff/done']));
  });

  it('reads where the dashboard’s frame is, moves it in place, opens it again there, and never on the Designer itself', async () => {
    mount();
    await onSide('dashboard');
    const win = inside('/p/shop-items');
    await waitFor(() => expect(model.path).toBe('/p/shop-items'));
    expect(model.spoken).toBe(true);
    // The dashboard is the person's own: no ticket.
    expect(tickets).toEqual([]);

    act(() => model.go('/p/shop-requests'));
    expect(win.history.replaced).toEqual(['/p/shop-requests']);
    expect(win.events).toEqual(['popstate']);
    expect(model.path).toBe('/p/shop-requests');

    act(() => model.go('/design/ds_000000000000000000000011'));
    expect(win.history.replaced).toHaveLength(1);
    expect(model.path).toBe('/p/shop-requests');

    // The frame wandered into the Designer: that is not kept as the side's page.
    win.location.pathname = '/design';
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(model.path).toBe('/p/shop-requests');

    const first = frame();
    act(() => model.reload());
    await waitFor(() => expect(frame()).not.toBe(first));
    expect(frame().getAttribute('src')).toBe('/p/shop-requests');
  });
});
