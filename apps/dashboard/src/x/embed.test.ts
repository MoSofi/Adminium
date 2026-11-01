// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The website loader (`x/embed.js`), run in a page as an owner's website
 * runs it: it draws a frame for each form box, in the page's language, says
 * hello to a frame that is ready, and sizes a frame only from a message of
 * the form's own origin and of that very frame. It adds no name to the page
 * but `adminium`, and stays small.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function run(): void {
  Object.defineProperty(document, 'currentScript', { value: { src: `${ORIGIN}/x/embed.js` }, configurable: true });
  // The loader as a page's <script> runs it: one file, no module.
  new Function(SOURCE)();
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
  document.body.innerHTML = [
    '<div data-adminium-form="showroom-visit" data-title="Book a visit"></div>',
    '<div data-adminium-form="newsletter"></div>',
    '<div data-adminium-form="../../etc"></div>',
    '<div data-adminium-form="Bad_Slug"></div>',
  ].join('');
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
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

  it('is one small file, no framework, no import', () => {
    expect(Buffer.byteLength(SOURCE)).toBeLessThan(4096);
    expect(SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\bimport\b|\brequire\(/);
    expect(SOURCE).not.toMatch(/document\.cookie|localStorage|sessionStorage/);
  });
});
