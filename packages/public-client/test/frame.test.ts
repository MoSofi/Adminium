// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The frame's half of an app screen on the owner's website: who it believes,
 * what it tells them, which screens it shows, and how it waits on a payment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPublicClient } from '../src/index.js';
import { frameStore, payLinkProps, readFrame, rememberPayReturn, startFrame, takePayReturn, watchPayment, HEIGHT_EVERY_MS, type FramePayState } from '../src/frame.js';

const SITE = 'https://lumenstudio.example';

type Listener = (event: never) => void;

function listeners() {
  const all = new Map<string, Set<Listener>>();
  return {
    add: (type: string, fn: Listener) => void (all.get(type) ?? all.set(type, new Set()).get(type)!).add(fn),
    remove: (type: string, fn: Listener) => void all.get(type)?.delete(fn),
    fire: (type: string, event: unknown) => [...(all.get(type) ?? [])].forEach((fn) => fn(event as never)),
    count: (type: string) => all.get(type)?.size ?? 0,
  };
}

function fakeStorage(): Storage {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  } as unknown as Storage;
}

function fakeWindow(search = '?frame=1', opts: { top?: boolean } = {}) {
  const on = listeners();
  const onDoc = listeners();
  const attributes: Record<string, string> = {};
  const posted: { message: Record<string, unknown>; origin: string }[] = [];
  const parent = { postMessage: (message: Record<string, unknown>, origin: string) => posted.push({ message, origin }) };
  let height = 400;
  const body = { style: {} as Record<string, string>, getBoundingClientRect: () => ({ height }) };
  const html = { style: {} as Record<string, string>, setAttribute: (name: string, value: string) => void (attributes[name] = value) };
  const opened: unknown[][] = [];
  const win = {
    location: { search, origin: 'https://admin.example' },
    document: {
      body,
      visibilityState: 'visible',
      documentElement: html,
      addEventListener: onDoc.add,
      removeEventListener: onDoc.remove,
    },
    addEventListener: on.add,
    removeEventListener: on.remove,
    open: (...args: unknown[]) => void opened.push(args),
    sessionStorage: fakeStorage(),
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    parent: parent as unknown,
  } as Record<string, unknown>;
  if (opts.top === true) win['parent'] = win;
  return {
    win: win as unknown as Window,
    raw: win,
    parent,
    posted,
    on,
    onDoc,
    attributes,
    body,
    html,
    opened,
    setHeight: (next: number) => void (height = next),
    hello: (extra: Record<string, unknown> = {}, origin = SITE, source: unknown = parent) => on.fire('message', { source, origin, data: { type: 'adminium:hello', ...extra } }),
    say: (type: string, origin = SITE, source: unknown = parent) => on.fire('message', { source, origin, data: { type } }),
  };
}

const options = { origins: [SITE], screens: ['book', 'booked', 'reviews'], base: '/apps/bookings/customer/' };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('readFrame', () => {
  it('is a frame only with one frame=1 and a parent: a copied link in its own tab is the normal app', () => {
    expect(readFrame(fakeWindow('?frame=1', { top: true }).win)).toBeNull();
    expect(readFrame(fakeWindow('').win)).toBeNull();
    expect(readFrame(fakeWindow('?frame=0').win)).toBeNull();
    expect(readFrame(fakeWindow('?frame=1&frame=1').win)).toBeNull();
    expect(readFrame(fakeWindow('?frame=1').win)).toEqual({ mode: 'inline', theme: 'light', lang: null });
  });

  it('believes the loader’s words, written last, over a path that carried its own', () => {
    expect(readFrame(fakeWindow('?mode=inline&theme=dark&lang=fr&frame=1&lang=de-DE&mode=button&theme=light').win)).toEqual({ mode: 'button', theme: 'light', lang: 'de-DE' });
  });

  it('reads the mode, the theme and the host page’s language, and nothing it does not know', () => {
    expect(readFrame(fakeWindow('?frame=1&mode=floating&theme=dark&lang=de-DE').win)).toEqual({ mode: 'floating', theme: 'dark', lang: 'de-DE' });
    expect(readFrame(fakeWindow('?frame=1&mode=popup&theme=neon&lang=%3Cx%3E').win)).toEqual({ mode: 'inline', theme: 'light', lang: null });
  });
});

describe('the handshake', () => {
  it('does nothing outside a frame', () => {
    expect(startFrame(options, fakeWindow('').win)).toBeNull();
  });

  it('says it is ready with nothing in it, and marks the page with its mode', () => {
    const f = fakeWindow('?frame=1&mode=button');
    startFrame(options, f.win);
    expect(f.posted).toEqual([{ message: { type: 'adminium:ready' }, origin: '*' }]);
    expect(f.attributes['data-adminium-frame']).toBe('button');
  });

  it('takes a hello only from its own parent and a listed origin, and then speaks to that origin alone', () => {
    const f = fakeWindow();
    const onLinked = vi.fn();
    const link = startFrame({ ...options, onLinked }, f.win)!;
    f.hello({}, 'https://evil.example');
    f.hello({}, SITE, {});
    f.on.fire('message', { source: f.parent, origin: SITE, data: null });
    f.on.fire('message', { source: f.parent, origin: SITE, data: 'adminium:hello' });
    f.say('adminium:open');
    expect(link.parentOrigin()).toBeNull();
    link.done('LS-1042');
    expect(f.posted).toHaveLength(1);
    f.hello({ label: '  Book now  ' });
    expect(link.parentOrigin()).toBe(SITE);
    expect(onLinked).toHaveBeenCalledWith({ label: 'Book now' });
    expect(f.posted.slice(1).every((one) => one.origin === SITE)).toBe(true);
  });

  it('takes the launcher’s words as text, at most 28 letters', () => {
    const f = fakeWindow();
    const onLinked = vi.fn();
    startFrame({ ...options, onLinked }, f.win);
    f.hello({ label: 'x'.repeat(40) });
    expect(onLinked).toHaveBeenCalledWith({ label: 'x'.repeat(28) });
    const g = fakeWindow();
    const quiet = vi.fn();
    startFrame({ ...options, onLinked: quiet }, g.win);
    g.hello({ label: 7 });
    expect(quiet).toHaveBeenCalledWith({ label: null });
  });
});

describe('the height of an inline frame', () => {
  it('is said at once on hello, to the site, then at most every 100 ms, and only when it changed', () => {
    let observed: (() => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const f = fakeWindow();
    f.raw['ResizeObserver'] = class {
      constructor(fn: () => void) {
        observed = fn;
      }
      observe = observe;
      disconnect = disconnect;
    };
    const link = startFrame(options, f.win)!;
    f.hello();
    expect(observe).toHaveBeenCalledTimes(1);
    const heights = () => f.posted.filter((one) => one.message['type'] === 'adminium:height').map((one) => one.message['h']);
    expect(heights()).toEqual([400]);
    f.setHeight(500.2);
    observed!();
    f.setHeight(600);
    observed!();
    expect(heights()).toEqual([400]);
    vi.advanceTimersByTime(HEIGHT_EVERY_MS);
    expect(heights()).toEqual([400, 600]);
    vi.advanceTimersByTime(HEIGHT_EVERY_MS);
    // Past the wait, it goes at once; the same height is not said twice.
    link.postHeight();
    expect(heights()).toEqual([400, 600]);
    f.setHeight(0);
    link.postHeight();
    f.setHeight(30_000);
    link.postHeight();
    expect(heights()).toEqual([400, 600]);
    f.setHeight(650);
    observed!();
    link.stop();
    expect(disconnect).toHaveBeenCalled();
    expect(f.on.count('message')).toBe(0);
    expect(f.on.count('keydown')).toBe(0);
  });

  it('stops a height that was waiting when the frame stops', () => {
    const f = fakeWindow();
    const link = startFrame(options, f.win)!;
    f.hello();
    f.setHeight(450);
    link.postHeight();
    link.stop();
    vi.advanceTimersByTime(HEIGHT_EVERY_MS * 2);
    expect(f.posted.filter((one) => one.message['type'] === 'adminium:height')).toHaveLength(1);
  });

  it('says no height from a frame over the page, or before a hello', () => {
    const over = fakeWindow('?frame=1&mode=floating');
    startFrame(options, over.win)!.postHeight();
    over.hello();
    expect(over.posted.some((one) => one.message['type'] === 'adminium:height')).toBe(false);
    const early = fakeWindow();
    startFrame(options, early.win)!.postHeight();
    expect(early.posted).toHaveLength(1);
  });

  it('takes the page’s height off the frame’s own: a 100% or 100vh page can start at no height, and shrink', () => {
    const f = fakeWindow();
    startFrame(options, f.win);
    expect(f.body.style).toEqual({ height: 'auto', minHeight: '0' });
    expect(f.html.style).toEqual({ height: 'auto', minHeight: '0' });
    const over = fakeWindow('?frame=1&mode=button');
    startFrame(options, over.win);
    expect(over.body.style).toEqual({});
  });

  it('counts content that overflows the element', () => {
    const f = fakeWindow();
    const root = { getBoundingClientRect: () => ({ height: 0 }), scrollHeight: 512 } as unknown as Element;
    startFrame({ ...options, root }, f.win);
    f.hello();
    expect(f.posted.at(-1)).toEqual({ message: { type: 'adminium:height', h: 512 }, origin: SITE });
  });

  it('measures the element it is given', () => {
    const f = fakeWindow();
    const root = { getBoundingClientRect: () => ({ height: 222 }) } as unknown as Element;
    startFrame({ ...options, root }, f.win);
    f.hello();
    expect(f.posted.at(-1)).toEqual({ message: { type: 'adminium:height', h: 222 }, origin: SITE });
  });
});

describe('the screens it shows', () => {
  it('shows its own and opens any other in a new tab, with no handle back', () => {
    const f = fakeWindow();
    const link = startFrame(options, f.win)!;
    expect(link.allows('book')).toBe(true);
    expect(link.allows('visits')).toBe(false);
    expect(link.go('book', '/book')).toBe(true);
    expect(f.opened).toEqual([]);
    expect(link.go('visits', '/visits')).toBe(false);
    expect(f.opened).toEqual([['https://admin.example/apps/bookings/customer/visits', '_blank', 'noopener']]);
  });

  it('builds an outside address on its own host, whatever the path says', () => {
    const link = startFrame(options, fakeWindow().win)!;
    expect(link.outside('/help')).toBe('https://admin.example/apps/bookings/customer/help');
    for (const hostile of ['//evil.example/x', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/a b']) {
      expect(link.outside(hostile)).toBe('https://admin.example/apps/bookings/customer/');
    }
    expect(link.linkProps('/packs')).toEqual({ href: 'https://admin.example/apps/bookings/customer/packs', target: '_blank', rel: 'noopener noreferrer' });
  });
});

describe('the sheet', () => {
  const types = (f: ReturnType<typeof fakeWindow>) => f.posted.slice(1).map((one) => one.message);

  it('opens when the site asks, fills the page, and closes back to the launcher', () => {
    const f = fakeWindow('?frame=1&mode=floating');
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const link = startFrame({ ...options, onOpen, onClose }, f.win)!;
    f.hello();
    link.size(180, 56);
    f.say('adminium:open', 'https://evil.example');
    expect(onOpen).not.toHaveBeenCalled();
    f.say('adminium:open');
    expect(onOpen).toHaveBeenCalledTimes(1);
    // While open, a new launcher size is kept for later.
    link.size(200, 60);
    f.say('adminium:close');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(types(f)).toEqual([
      { type: 'adminium:size', w: 180, h: 56 },
      { type: 'adminium:size', w: 1, h: 1, sheet: true },
      { type: 'adminium:open', sheet: true },
      { type: 'adminium:size', w: 200, h: 60 },
      { type: 'adminium:close' },
    ]);
    // Closed already: nothing more is said.
    f.say('adminium:close');
    link.closeSheet();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape, and only while it is open', () => {
    const f = fakeWindow('?frame=1&mode=button');
    const onClose = vi.fn();
    const link = startFrame({ ...options, onClose }, f.win)!;
    f.hello();
    f.on.fire('keydown', { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    link.openSheet();
    link.openSheet();
    f.on.fire('keydown', { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
    f.on.fire('keydown', { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(types(f).filter((one) => one['type'] === 'adminium:open')).toHaveLength(1);
    expect(types(f).at(-1)).toEqual({ type: 'adminium:close' });
  });

  it('has none in an inline frame', () => {
    const f = fakeWindow();
    const link = startFrame(options, f.win)!;
    f.hello();
    link.openSheet();
    expect(f.posted.some((one) => one.message['type'] === 'adminium:open')).toBe(false);
  });

  it('works with no callbacks, by the site and by Escape', () => {
    const f = fakeWindow('?frame=1&mode=button');
    const link = startFrame(options, f.win)!;
    f.hello();
    f.say('adminium:open');
    f.say('adminium:close');
    link.openSheet();
    f.on.fire('keydown', { key: 'Escape' });
    expect(types(f).filter((one) => one['type'] === 'adminium:close')).toHaveLength(2);
  });
});

describe('what the website is told', () => {
  it('hears a short code, or that it happened, and never anything longer or odd', () => {
    const f = fakeWindow();
    const link = startFrame(options, f.win)!;
    f.hello();
    f.posted.length = 0;
    link.done('LS-1042');
    link.done();
    link.done('jo@example.com');
    link.done('x'.repeat(33));
    link.scrollIntoView();
    expect(f.posted.map((one) => one.message)).toEqual([{ type: 'adminium:done', code: 'LS-1042' }, { type: 'adminium:done' }, { type: 'adminium:done' }, { type: 'adminium:done' }, { type: 'adminium:scroll' }]);
    expect(f.posted.every((one) => one.origin === SITE)).toBe(true);
  });
});

describe('storage that may not be there', () => {
  it('keeps a value in memory and copies it to the tab', () => {
    const f = fakeWindow();
    const store = frameStore(f.win);
    store.set('k', 'v');
    expect(store.get('k')).toBe('v');
    expect((f.raw['sessionStorage'] as Storage).getItem('k')).toBe('v');
    store.remove('k');
    expect(store.get('k')).toBeNull();
    expect((f.raw['sessionStorage'] as Storage).getItem('k')).toBeNull();
  });

  it('reads what an earlier load left in the tab', () => {
    const f = fakeWindow();
    (f.raw['sessionStorage'] as Storage).setItem('old', 'kept');
    expect(frameStore(f.win).get('old')).toBe('kept');
  });

  it('still works when the browser refuses storage', () => {
    const f = fakeWindow();
    Object.defineProperty(f.raw, 'sessionStorage', {
      get() {
        throw new Error('SecurityError');
      },
    });
    const store = frameStore(f.win);
    expect(store.get('k')).toBeNull();
    store.set('k', 'v');
    expect(store.get('k')).toBe('v');
    store.remove('k');
    expect(store.get('k')).toBeNull();
    rememberPayReturn('/b', f.win);
    expect(takePayReturn(f.win)).toBeNull();
  });
});

describe('paying from a frame', () => {
  it('offers a real link, in a new tab', () => {
    expect(payLinkProps('https://admin.example/pay/abc')).toEqual({ href: 'https://admin.example/pay/abc', target: '_blank', rel: 'noopener noreferrer' });
  });

  const flush = async () => {
    await vi.advanceTimersByTimeAsync(0);
  };

  it('asks while visible, at once on coming back, and stops when paid', async () => {
    const f = fakeWindow();
    const answers: FramePayState[] = ['paying', 'confirming', 'paid'];
    const read = vi.fn(async () => answers.shift()!);
    const seen: FramePayState[] = [];
    watchPayment({ read, onState: (state) => seen.push(state) }, f.win);
    await flush();
    expect(seen).toEqual(['paying']);
    (f.raw['document'] as { visibilityState: string }).visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(9000);
    expect(read).toHaveBeenCalledTimes(1);
    (f.raw['document'] as { visibilityState: string }).visibilityState = 'visible';
    f.onDoc.fire('visibilitychange', {});
    await flush();
    expect(seen).toEqual(['paying', 'confirming']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen).toEqual(['paying', 'confirming', 'paid']);
    await vi.advanceTimersByTimeAsync(9000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(f.onDoc.count('visibilitychange')).toBe(0);
  });

  it('says a state once, and a failed read changes nothing', async () => {
    const f = fakeWindow();
    const read = vi.fn<() => Promise<FramePayState>>().mockResolvedValueOnce('paying').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('paying').mockResolvedValueOnce('let-go');
    const seen: FramePayState[] = [];
    watchPayment({ read, onState: (state) => seen.push(state), everyMs: 1000 }, f.win);
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen).toEqual(['paying', 'let-go']);
  });

  it('lets an unpaid hold go past its end and a margin, but keeps waiting on a bank', async () => {
    const f = fakeWindow();
    let at = 1000;
    const seen: FramePayState[] = [];
    let answer: FramePayState = 'confirming';
    watchPayment({ read: async () => answer, onState: (state) => seen.push(state), holdEndsAt: 2000, marginMs: 500, now: () => at, everyMs: 100 }, f.win);
    await flush();
    at = 5000;
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(['confirming']);
    answer = 'paying';
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(['confirming', 'let-go']);
  });

  it('does not ask twice at once, and says nothing after it was stopped', async () => {
    const f = fakeWindow();
    let finish: (state: FramePayState) => void = () => undefined;
    const read = vi.fn(() => new Promise<FramePayState>((resolve) => (finish = resolve)));
    const seen: FramePayState[] = [];
    const stop = watchPayment({ read, onState: (state) => seen.push(state), everyMs: 100 }, f.win);
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(1);
    stop();
    finish('paid');
    await flush();
    expect(seen).toEqual([]);
  });

  it('past the hold, says it cannot tell after three failed reads, and stops', async () => {
    const f = fakeWindow();
    const onLost = vi.fn();
    const read = vi.fn(async (): Promise<FramePayState> => {
      throw new Error('gone');
    });
    const seen: FramePayState[] = [];
    watchPayment({ read, onState: (state) => seen.push(state), onLost, holdEndsAt: 0, marginMs: 0, now: () => 10, everyMs: 100 }, f.win);
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(onLost).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(3);
    // It never claims the time was let go: nobody knows.
    expect(seen).toEqual([]);
  });

  it('keeps asking through failures while the hold runs, and a good read starts the count again', async () => {
    const f = fakeWindow();
    const onLost = vi.fn();
    let at = 0;
    const read = vi.fn<() => Promise<FramePayState>>().mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('confirming').mockRejectedValue(new Error('x'));
    watchPayment({ read, onState: () => undefined, onLost, holdEndsAt: 1000, marginMs: 0, now: () => at, everyMs: 100 }, f.win);
    await flush();
    await vi.advanceTimersByTimeAsync(200);
    at = 5000;
    await vi.advanceTimersByTimeAsync(200);
    expect(onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('stops quietly with no one to tell', async () => {
    const f = fakeWindow();
    const read = vi.fn(async (): Promise<FramePayState> => {
      throw new Error('gone');
    });
    watchPayment({ read, onState: () => undefined, holdEndsAt: 0, marginMs: 0, now: () => 10, everyMs: 100 }, f.win);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('uses the real clock when given none', async () => {
    const f = fakeWindow();
    const seen: FramePayState[] = [];
    watchPayment({ read: async () => 'paying', onState: (state) => seen.push(state), holdEndsAt: Date.now() - 120_000 }, f.win);
    await flush();
    expect(seen).toEqual(['let-go']);
  });
});

describe('the way back from the pay page', () => {
  it('remembers the app’s own screen, once', () => {
    const f = fakeWindow();
    rememberPayReturn('/b#token', f.win);
    expect(takePayReturn(f.win)).toBe('/b#token');
    expect(takePayReturn(f.win)).toBeNull();
  });

  it('never remembers or follows a way to another site', () => {
    const f = fakeWindow();
    rememberPayReturn('//evil.example', f.win);
    expect(takePayReturn(f.win)).toBeNull();
    (f.raw['sessionStorage'] as Storage).setItem('adminium:pay-return', 'https://evil.example');
    expect(takePayReturn(f.win)).toBeNull();
  });
});

describe('a client in a frame', () => {
  it('says so on its calls, so a payment it starts ends with "you can close this tab"', async () => {
    vi.useRealTimers();
    const seen: Record<string, string>[] = [];
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({ data: { online: false } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetcher);
    await createPublicClient({ baseUrl: 'https://admin.example', publishableKey: 'pk_test', framed: true })!.payments.available();
    await createPublicClient({ baseUrl: 'https://admin.example', publishableKey: 'pk_test' })!.payments.available();
    expect(seen[0]!['x-adminium-framed']).toBe('1');
    expect(seen[1]!['x-adminium-framed']).toBeUndefined();
  });
});

describe('the default window', () => {
  it('reads the global one when none is given', () => {
    const f = fakeWindow();
    vi.stubGlobal('window', f.win);
    expect(readFrame()).toEqual({ mode: 'inline', theme: 'light', lang: null });
    expect(startFrame(options)).not.toBeNull();
    const store = frameStore();
    store.set('a', 'b');
    expect(store.get('a')).toBe('b');
    rememberPayReturn('/x');
    expect(takePayReturn()).toBe('/x');
    const stop = watchPayment({ read: async () => 'paying', onState: () => undefined });
    stop();
  });
});
