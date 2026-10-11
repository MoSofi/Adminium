// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where each side of the preview is: what the page believes of a side that
 * says so, the page every opening carries, going to a typed page on each of
 * the three sides, and the list of opened pages. Then the phone side: when
 * it is among the sides, when its frame is asked for, and what a person's
 * yes, the door and a crash inside it do.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@adminium/ui';

import { installTestI18n } from '../../i18n/testing.js';
import { jsonResponse } from '../../test/fixtures.js';
import type { DesignerSession, PhoneStatus } from '../api.js';
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
/** The session the page is on: one that asked for a phone app says so in its `target`. */
let session: DesignerSession;
/** What the server says of the phone side; null is a server that builds none (the route is not there). */
let phoneStatus: PhoneStatus | null;
/** What was asked of the phone side: `GET`, or `add`, `open`, `stop` with what was sent. */
let phoneCalls: { what: string; body?: unknown }[];
/** What the server answers a yes, an opening or a stop with; by default, how the phone side stands. */
let phoneAnswer: ((what: string) => Response | null) | null;
let mode: 'local' | 'live';
/** Whether the session's app is installed yet (it is not before its first turn). */
let appThere: boolean;
let fixes: string[];

function Harness(): null | React.ReactElement {
  model = usePreview(session, []);
  return <Preview preview={model} session={session} turns={[]} onFix={(message) => fixes.push(message)} compact={false} />;
}

beforeEach(() => {
  tickets = [];
  refuse = () => false;
  session = SESSION;
  phoneStatus = null;
  phoneCalls = [];
  phoneAnswer = null;
  appThere = true;
  mode = 'local';
  fixes = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/v1/system/info') return Promise.resolve(jsonResponse(200, { designer: { mode, link: false } }));
      const phoneBase = `/api/v1/designer/sessions/${SESSION.id}/phone`;
      // A server that builds no phone app has no such route: the 404 below.
      if (url.startsWith(phoneBase) && phoneStatus !== null) {
        const what = url === phoneBase ? 'GET' : url.slice(phoneBase.length + 1);
        phoneCalls.push({ what, ...(what === 'GET' ? {} : { body: JSON.parse(String(init?.body)) as unknown }) });
        return Promise.resolve(phoneAnswer?.(what) ?? jsonResponse(200, phoneStatus));
      }
      if (url === '/api/v1/apps') {
        return Promise.resolve(
          jsonResponse(200, {
            apps: !appThere ? [] : [
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

describe('the phone side of the preview', () => {
  const ADDRESSES = [{ address: '192.168.1.20', name: 'en0' }];
  const stands = (phone: PhoneStatus['phone'], door: PhoneStatus['door'] = { state: 'off' }): PhoneStatus => ({ phone, door, addresses: ADDRESSES });
  const built = (build = 'b1'): PhoneStatus => stands({ state: 'built', build });
  const MOBILE = '/apps/shop/mobile/';
  const asked = (): string[] => phoneCalls.map((call) => call.what);
  const refused = (message: string): Response => jsonResponse(409, { error: { code: 'CONFLICT', message, requestId: 'r' } });

  /** The page, once the phone side has been asked about and the first side is open. */
  async function ready(): Promise<void> {
    mount();
    await waitFor(() => expect(tickets).toEqual(['/apps/shop/staff/']));
    if (phoneStatus !== null) await waitFor(() => expect(model.phone).not.toBeNull());
  }
  async function onPhone(): Promise<void> {
    await ready();
    await waitFor(() => expect(model.sides).toContain('mobile'));
    act(() => model.setSide('mobile'));
    expect(model.side).toBe('mobile');
  }

  it('has no Phone side before the session has made its app, even in a session that asked for a phone app', async () => {
    session = { ...SESSION, target: 'mobile' };
    phoneStatus = stands({ state: 'none' });
    appThere = false;
    mount();
    await waitFor(() => expect(model.phone).not.toBeNull());
    expect(model.sides).toEqual(['dashboard']);
  });

  it('has no Phone side on a server that builds no phone app (it answers 404), even in a session that asked for one', async () => {
    session = { ...SESSION, target: 'mobile' };
    await ready();
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toContain(`/api/v1/designer/sessions/${SESSION.id}/phone`));
    // The answer has come and gone: nothing of a phone, and no error to show for it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(model.phone).toBeNull();
    expect(model.phoneError).toBeNull();
    expect(model.sides).toEqual(['dashboard', 'staff', 'customer']);
    expect(model.side).toBe('staff');
  });

  it('has no Phone side for an app with no phone app, in a session that did not ask for one', async () => {
    phoneStatus = stands({ state: 'none' });
    await ready();
    expect(model.phone).toEqual(phoneStatus);
    expect(model.sides).toEqual(['dashboard', 'staff', 'customer']);
    expect(asked()).toEqual(['GET']);
  });

  it.each([
    ['is built', { state: 'built', build: 'b1' }],
    ['waits for a yes', { state: 'unapproved', words: 'w', packages: [] as string[] }],
    ['has no packages', { state: 'no-packages', words: 'w' }],
    ['did not build', { state: 'failed', words: 'w' }],
    ['cannot be built', { state: 'shape', words: 'w' }],
    ['is being built', { state: 'working', step: 'building' }],
  ] as const)('puts the Phone side last among the sides once the app has a phone app that %s, and does not open on it', async (_name, phone) => {
    // (A door that is not starting, so nothing is asked again while this looks.)
    phoneStatus = stands(phone);
    await ready();
    expect(model.sides).toEqual(['dashboard', 'staff', 'customer', 'mobile']);
    expect(model.side).toBe('staff');
    expect(tickets).toEqual(['/apps/shop/staff/']);
  });

  it('has the Phone side from the start in a session that asked for a phone app, with the question standing there and no frame asked for', async () => {
    session = { ...SESSION, target: 'mobile' };
    phoneStatus = stands({ state: 'none' });
    await onPhone();
    expect(model.sides).toEqual(['dashboard', 'staff', 'customer', 'mobile']);
    expect(screen.getByText('Add a phone app?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add the phone app' })).toBeTruthy();
    // Nothing is opening: there is no frame, no ticket for one, and no spinner over the question.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tickets).toEqual(['/apps/shop/staff/']);
    expect(model.ticket).toBeNull();
    expect(frame()).toBeNull();
    expect(screen.queryByLabelText('Opening the preview')).toBeNull();
    expect(model.prefix).toBe('/apps/shop/mobile');
  });

  it('asks for the phone app on a yes, watches it being built, and asks for its frame only once it is built', async () => {
    session = { ...SESSION, target: 'mobile' };
    phoneStatus = stands({ state: 'none' });
    await onPhone();
    // The server answers at once with what it started; how it stands is then watched.
    phoneAnswer = (what) => {
      if (what !== 'add') return null;
      phoneStatus = stands({ state: 'working', step: 'installing' });
      return null;
    };
    await userEvent.click(screen.getByRole('button', { name: 'Add the phone app' }));
    expect(await screen.findByText('Installing Expo’s packages (about 350 MB)…')).toBeTruthy();
    expect(phoneCalls.at(-1)).toEqual({ what: 'add', body: {} });
    expect(tickets).toEqual(['/apps/shop/staff/']);
    expect(screen.queryByLabelText('Opening the preview')).toBeNull();

    phoneStatus = built();
    await waitFor(() => expect(tickets).toEqual(['/apps/shop/staff/', MOBILE]), { timeout: 4000 });
    await waitFor(() => expect(frame()?.src ?? '').toContain(encodeURIComponent(MOBILE)));
    expect(frame().title).toBe('Phone app');
    // The frame is the phone's own, with the way to a real phone under it; it is opening until its page loads.
    expect(screen.getByRole('button', { name: 'Open on a phone' })).toBeTruthy();
    expect(screen.getByLabelText('Opening the preview')).toBeTruthy();
    // Watched while it was built (more than the one read), and left alone once it stands.
    const reads = asked().filter((what) => what === 'GET').length;
    expect(reads).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(asked().filter((what) => what === 'GET')).toHaveLength(reads);
  });

  it('opens a built phone app by a ticket when its side is picked, and again when it is built again', async () => {
    phoneStatus = built('b1');
    await onPhone();
    await waitFor(() => expect(tickets).toEqual(['/apps/shop/staff/', MOBILE]));
    await waitFor(() => expect(frame()?.src ?? '').toContain('ticket=t2'));
    // A phone app built again is another page to open: the stamp it is answered with is new.
    phoneAnswer = () => jsonResponse(200, built('b2'));
    act(() => model.stopPhoneDoor());
    await waitFor(() => expect(tickets).toEqual(['/apps/shop/staff/', MOBILE, MOBILE]));
    await waitFor(() => expect(frame()?.src ?? '').toContain('ticket=t3'));
    // The same stamp again asks for nothing.
    act(() => model.stopPhoneDoor());
    await waitFor(() => expect(asked().filter((what) => what === 'stop')).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tickets).toHaveLength(3);
  });

  it('opens the door on the address given and stops it, and holds what the server answers each with', async () => {
    phoneStatus = built();
    await onPhone();
    const open: PhoneStatus = stands({ state: 'built', build: 'b1' }, { state: 'closed', app: 'shop', why: 'stopped', words: '' });
    phoneAnswer = (what) => (what === 'open' ? jsonResponse(200, stands({ state: 'built', build: 'b1' }, { state: 'closed', app: 'shop', why: 'failed', words: 'Expo could not start.' })) : what === 'stop' ? jsonResponse(200, open) : null);
    act(() => model.openPhoneDoor('192.168.1.20'));
    await waitFor(() => expect(model.phone?.door).toEqual({ state: 'closed', app: 'shop', why: 'failed', words: 'Expo could not start.' }));
    expect(phoneCalls.at(-1)).toEqual({ what: 'open', body: { address: '192.168.1.20' } });
    act(() => model.stopPhoneDoor());
    await waitFor(() => expect(model.phone?.door).toEqual(open.door));
    expect(phoneCalls.at(-1)).toEqual({ what: 'stop', body: {} });
    expect(model.phoneError).toBeNull();
  });

  it('says what the server refused a yes with, in its words, until the next one is asked', async () => {
    session = { ...SESSION, target: 'mobile' };
    phoneStatus = stands({ state: 'none' });
    await onPhone();
    phoneAnswer = (what) => (what === 'add' ? refused('The Designer is working. Try again when it is done.') : null);
    await userEvent.click(screen.getByRole('button', { name: 'Add the phone app' }));
    await waitFor(() => expect(model.phoneError).toBe('The Designer is working. Try again when it is done.'));
    expect(screen.getByRole('alert').textContent).toBe('The Designer is working. Try again when it is done.');
    // What stood before still stands.
    expect(model.phone?.phone).toEqual({ state: 'none' });
    phoneAnswer = (what) => (what === 'add' ? jsonResponse(200, stands({ state: 'unapproved', words: 'w', packages: [] })) : null);
    await userEvent.click(screen.getByRole('button', { name: 'Add the phone app' }));
    await waitFor(() => expect(model.phone?.phone.state).toBe('unapproved'));
    expect(model.phoneError).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks nothing of a phone side on a live server, which has no preview', async () => {
    mode = 'live';
    phoneStatus = built();
    mount();
    await waitFor(() => expect(model.noPreview).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked()).toEqual([]);
    expect(model.phone).toBeNull();
    expect(model.sides).not.toContain('mobile');
  });

  it('shows a phone app that stopped with an error, heard from its own frame, and asks for the fix', async () => {
    phoneStatus = built();
    await onPhone();
    await waitFor(() => expect(frame()?.src ?? '').toContain(encodeURIComponent(MOBILE)));
    inside();
    const stopped = { type: 'adminium:side-error', app: 'shop', side: 'mobile', message: 'Text strings must be rendered within a <Text> component.' };
    say(stopped, { origin: 'http://evil.test' });
    say(stopped, { source: window });
    say({ ...stopped, app: 'another' });
    expect(screen.queryByRole('alert')).toBeNull();

    say(stopped);
    const card = screen.getByRole('alert');
    expect(card.textContent).toContain('The phone app stopped with an error.');
    expect(card.querySelector('code')?.textContent).toBe(stopped.message);
    await userEvent.click(within(card).getByRole('button', { name: 'Ask the Designer to fix it' }));
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toContain(stopped.message);
    // A phone app has no addresses: what its frame says of where it is changes nothing.
    say(here('mobile', '/menu'));
    expect(model.path).toBe('/');
    expect(model.spoken).toBe(false);
    // The card is of that opening: a reload opens the phone app again, and it is gone.
    act(() => model.reload());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('does not lay a phone app’s error over another side', async () => {
    phoneStatus = built();
    await ready();
    await waitFor(() => expect(frame()).not.toBeNull());
    inside();
    say({ type: 'adminium:side-error', app: 'shop', side: 'mobile', message: 'boom' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
