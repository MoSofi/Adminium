// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The website loader (`x/embed.js`), run in a page as an owner's website
 * runs it: it draws a frame for each form box, in the page's language, says
 * hello to a frame that is ready, and sizes a frame only from a message of
 * the form's own origin and of that very frame. With `data-adminium-chat` it
 * draws one chat frame on the page's own side, sized by the chat, a sheet
 * that holds the page still on a phone. It adds no name to the page but
 * `adminium`, and stays small as it is served.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { websiteLoaderOf } from '../../vite.x.config.js';

const SOURCE = readFileSync(join(process.cwd(), 'x', 'embed.js'), 'utf8');
const ORIGIN = 'https://forms.meridian.example';

interface FakeWindow {
  sent: { message: unknown; origin: string }[];
  postMessage: (message: unknown, origin: string) => void;
}

function fakeWindow(): FakeWindow {
  const win: FakeWindow = { sent: [], postMessage: (message, origin) => win.sent.push({ message, origin }) };
  return win;
}

function run(attributes: Record<string, string> = {}, source = SOURCE): void {
  const script = { src: `${ORIGIN}/x/embed.js`, getAttribute: (name: string) => attributes[name] ?? null };
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
  // The loader as a page's <script> runs it: one file, no module.
  new Function(source)();
}

function frames(): HTMLIFrameElement[] {
  return [...document.querySelectorAll('iframe')];
}

/** Gives each drawn frame a window of its own to talk to, as a browser would once it loads. */
function windowsOf(list: HTMLIFrameElement[]): FakeWindow[] {
  return list.map((frame) => {
    const win = fakeWindow();
    Object.defineProperty(frame, 'contentWindow', { value: win, configurable: true });
    return win;
  });
}

function message(data: unknown, origin: string, source: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }));
}

let globalsBefore: Set<string>;

beforeEach(() => {
  // The test page loads no frame's page (the DOM here says so, loudly): the frames' windows are the test's own.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  globalsBefore = new Set(Object.keys(window));
  document.documentElement.lang = 'de-DE';
  // Built with DOM calls, not raw HTML: no file a render layer ships beside may hold an HTML sink.
  const spots: [string, string | null][] = [
    ['showroom-visit', 'Book a visit'],
    ['newsletter', null],
    ['../../etc', null],
    ['Bad_Slug', null],
  ];
  for (const [slug, title] of spots) {
    const spot = document.createElement('div');
    spot.setAttribute('data-adminium-form', slug);
    if (title !== null) spot.setAttribute('data-title', title);
    document.body.append(spot);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  delete (window as { adminium?: unknown }).adminium;
  document.documentElement.removeAttribute('lang');
});

describe('the website loader', () => {
  it('draws a frame of the form for each box, in the page’s language, and never one for a slug that is not one', () => {
    run();
    const drawn = frames();
    expect(drawn.map((frame) => frame.getAttribute('src'))).toEqual([`${ORIGIN}/x/forms/showroom-visit?frame=1&lang=de-DE`, `${ORIGIN}/x/forms/newsletter?frame=1&lang=de-DE`]);
    expect(drawn.map((frame) => frame.title)).toEqual(['Book a visit', 'newsletter']);
    expect(drawn[0]!.getAttribute('referrerpolicy')).toBe('no-referrer');
    // Asked to look again, it draws nothing twice.
    (window as unknown as { adminium: { forms: { scan: () => void } } }).adminium.forms.scan();
    expect(frames()).toHaveLength(2);
  });

  it('says hello to a frame that is ready, only to the form’s own origin', () => {
    run();
    const [first, second] = windowsOf(frames());
    message({ type: 'adminium:ready' }, ORIGIN, first);
    expect(first!.sent).toEqual([{ message: { type: 'adminium:hello' }, origin: ORIGIN }]);
    expect(second!.sent).toEqual([]);
    // "Ready" from another origin, or from a window it did not draw, is not answered.
    message({ type: 'adminium:ready' }, 'https://evil.example', second);
    message({ type: 'adminium:ready' }, ORIGIN, fakeWindow());
    expect(second!.sent).toEqual([]);
  });

  it('sizes a frame from its own height message, and ignores every other origin, frame or shape', () => {
    run();
    const drawn = frames();
    const [first, second] = windowsOf(drawn);
    message({ type: 'adminium:height', h: 812.4 }, ORIGIN, first);
    expect(drawn[0]!.style.height).toBe('813px');
    expect(drawn[1]!.style.height).toBe('480px');
    // Another origin, even naming this frame.
    message({ type: 'adminium:height', h: 50 }, 'https://evil.example', first);
    // A window it did not draw, from the right origin.
    message({ type: 'adminium:height', h: 60 }, ORIGIN, fakeWindow());
    // The page itself.
    message({ type: 'adminium:height', h: 70 }, ORIGIN, window);
    // Shapes that are not a height.
    message({ type: 'adminium:height', h: '90' }, ORIGIN, first);
    message({ type: 'adminium:height', h: -5 }, ORIGIN, first);
    message({ type: 'adminium:height', h: 1e9 }, ORIGIN, first);
    message('adminium:height', ORIGIN, first);
    expect(drawn[0]!.style.height).toBe('813px');
    // The other frame's own message sizes the other frame alone.
    message({ type: 'adminium:height', h: 300 }, ORIGIN, second);
    expect(drawn.map((frame) => frame.style.height)).toEqual(['813px', '300px']);
  });

  it('adds no name to the page but adminium, whose consent is kept and does nothing yet; loaded twice, it runs once', () => {
    run();
    const first = (window as unknown as { adminium: { forms: unknown } }).adminium.forms;
    run();
    expect((window as unknown as { adminium: { forms: unknown } }).adminium.forms).toBe(first);
    expect(frames()).toHaveLength(2);
    const added = Object.keys(window).filter((name) => !globalsBefore.has(name));
    expect(added).toEqual(['adminium']);
    const api = (window as unknown as { adminium: { consent: (...args: unknown[]) => unknown } }).adminium;
    expect(api.consent('analytics', true)).toBeUndefined();
  });

  it('is one small file as it is served, no framework, no import', async () => {
    const served = await websiteLoaderOf(SOURCE);
    expect(Buffer.byteLength(served)).toBeLessThan(4096);
    expect(served.startsWith('/* SPDX-License-Identifier: AGPL-3.0-only */')).toBe(true);
    expect(SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\bimport\b|\brequire\(/);
    expect(SOURCE).not.toMatch(/document\.cookie|localStorage|sessionStorage/);
    // The served file is the same loader: it draws the same frames.
    run({}, served);
    expect(frames()).toHaveLength(2);
  });
});

describe('the website loader: a chat', () => {
  const CHAT = { 'data-adminium-chat': 'live-chat' };
  const chatFrame = (): HTMLIFrameElement => frames().find((frame) => frame.src.includes('/x/chat/'))!;

  afterEach(() => {
    document.documentElement.removeAttribute('dir');
    document.documentElement.style.overflow = '';
  });

  it('draws one frame of the chat, at no size until the chat sizes it, and one only for two tags', () => {
    run(CHAT);
    run(CHAT);
    const chat = frames().filter((frame) => frame.src.includes('/x/chat/'));
    expect(chat).toHaveLength(1);
    expect(chat[0]!.getAttribute('src')).toBe(`${ORIGIN}/x/chat/live-chat?frame=1&lang=de-DE`);
    expect(chat[0]!.style.position).toBe('fixed');
    expect(chat[0]!.style.width).toBe('0px');
    expect(chat[0]!.style.height).toBe('0px');
    expect(chat[0]!.getAttribute('referrerpolicy')).toBe('no-referrer');
    // A forms tag beside it still draws the forms, and a chat key that is not one draws nothing.
    expect(frames().filter((frame) => frame.src.includes('/x/forms/'))).toHaveLength(2);
    delete (window as { adminium?: unknown }).adminium;
    document.body.replaceChildren();
    run({ 'data-adminium-chat': '../../x' });
    expect(frames()).toHaveLength(0);
  });

  it('sits on the page’s own end side: right, or left on a right-to-left page', () => {
    run(CHAT);
    expect(chatFrame().style.right).toBe('0px');
    expect(chatFrame().style.left).toBe('');
    delete (window as { adminium?: unknown }).adminium;
    document.body.replaceChildren();
    document.documentElement.dir = 'rtl';
    run(CHAT);
    expect(chatFrame().style.left).toBe('0px');
    expect(chatFrame().style.right).toBe('');
  });

  it('answers ready with the page’s size, side and address (origin and path only), to the chat’s origin only', () => {
    window.history.replaceState(null, '', '/seating?utm_source=mail#top');
    run(CHAT);
    const [win] = windowsOf([chatFrame()]);
    message({ type: 'adminium:ready' }, 'https://evil.example', win);
    message({ type: 'adminium:ready' }, ORIGIN, fakeWindow());
    expect(win!.sent).toEqual([]);
    message({ type: 'adminium:ready' }, ORIGIN, win);
    expect(win!.sent).toEqual([{ message: { type: 'adminium:hello', w: window.innerWidth, h: window.innerHeight, side: 'right', page: `${window.location.origin}/seating` }, origin: ORIGIN }]);
    window.dispatchEvent(new Event('resize'));
    expect(win!.sent[1]).toEqual({ message: { type: 'adminium:viewport', w: window.innerWidth, h: window.innerHeight, side: 'right' }, origin: ORIGIN });
  });

  it('takes its size from its own frame and origin only; a sheet fills the page and holds it still until it closes', () => {
    run(CHAT);
    const frame = chatFrame();
    const [win] = windowsOf([frame]);
    message({ type: 'adminium:size', w: 300, h: 120 }, 'https://evil.example', win);
    message({ type: 'adminium:size', w: 300, h: 120 }, ORIGIN, fakeWindow());
    message({ type: 'adminium:size', w: '300', h: 120 }, ORIGIN, win);
    expect(frame.style.width).toBe('0px');
    message({ type: 'adminium:size', w: 436.2, h: 686 }, ORIGIN, win);
    expect([frame.style.width, frame.style.height]).toEqual(['437px', '686px']);
    message({ type: 'adminium:size', w: 390, h: 780, sheet: true }, ORIGIN, win);
    expect([frame.style.width, frame.style.height, frame.style.top]).toEqual(['100%', '100%', '0px']);
    document.documentElement.style.overflow = 'auto';
    message({ type: 'adminium:open', sheet: true }, 'https://evil.example', win);
    expect(document.documentElement.style.overflow).toBe('auto');
    message({ type: 'adminium:open', sheet: true }, ORIGIN, win);
    expect(document.documentElement.style.overflow).toBe('hidden');
    message({ type: 'adminium:close' }, ORIGIN, win);
    expect(document.documentElement.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(frame);
    // Focus already in the frame stays where the chat put it: the frame is not focused again.
    const focus = vi.spyOn(frame, 'focus');
    message({ type: 'adminium:close' }, ORIGIN, win);
    expect(focus).not.toHaveBeenCalled();
  });

  it('lets the site open and close its chat, and keeps how many replies came while it was closed', () => {
    run(CHAT);
    const [win] = windowsOf([chatFrame()]);
    const api = (window as unknown as { adminium: { chat: { open: () => void; close: () => void; unread: number } } }).adminium.chat;
    api.open();
    api.close();
    expect(win!.sent.map((sent) => sent.message)).toEqual([{ type: 'adminium:open' }, { type: 'adminium:close' }]);
    expect(win!.sent.every((sent) => sent.origin === ORIGIN)).toBe(true);
    message({ type: 'adminium:unread', n: 2 }, ORIGIN, win);
    expect(api.unread).toBe(2);
    message({ type: 'adminium:unread', n: 5 }, 'https://evil.example', win);
    expect(api.unread).toBe(2);
  });
});
