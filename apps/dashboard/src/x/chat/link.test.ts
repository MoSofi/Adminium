// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The chat frame's side of the website loader: a hello taken only from its
 * own parent and a listed website, everything after it sent only to that
 * website, and nothing sent before it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { linkChatToLoader } from './link.js';

const SITE = 'https://www.meridian.example';

interface Sent {
  message: unknown;
  origin: string;
}

/** A frame's window whose parent records what it is sent. */
function frameWindow(): { win: Window; parent: { sent: Sent[]; postMessage: (message: unknown, origin: string) => void }; hear: (data: unknown, origin: string, source?: unknown) => void } {
  const target = new EventTarget();
  const parent = { sent: [] as Sent[], postMessage: (message: unknown, origin: string) => parent.sent.push({ message, origin }) };
  const win = Object.assign(target, { parent }) as unknown as Window;
  const hear = (data: unknown, origin: string, source: unknown = parent): void => {
    target.dispatchEvent(new MessageEvent('message', { data, origin, source: source as Window }));
  };
  return { win, parent, hear };
}

afterEach(() => vi.restoreAllMocks());

describe('the chat frame’s link to the loader', () => {
  it('says it is ready with nothing in it, and sends nothing more until a listed website says hello', () => {
    const { win, parent, hear } = frameWindow();
    const view = vi.fn();
    const link = linkChatToLoader(win, [SITE], { view, open: vi.fn(), close: vi.fn() });
    expect(parent.sent).toEqual([{ message: { type: 'adminium:ready' }, origin: '*' }]);
    link.size(436, 686, false);
    link.opened(false);
    link.unread(1);
    expect(parent.sent).toHaveLength(1);
    // A website nobody listed, or a window that is not the parent, is not answered.
    hear({ type: 'adminium:hello', w: 1280, h: 800, side: 'right' }, 'https://evil.example');
    hear({ type: 'adminium:hello', w: 1280, h: 800, side: 'right' }, SITE, {});
    expect(link.parentOrigin()).toBeNull();
    expect(view).not.toHaveBeenCalled();
  });

  it('after a listed website’s hello, takes its size, side and page, and sends only to it', () => {
    const { win, parent, hear } = frameWindow();
    const view = vi.fn();
    const open = vi.fn();
    const link = linkChatToLoader(win, [SITE], { view, open, close: vi.fn() });
    hear({ type: 'adminium:hello', w: 390, h: 780, side: 'left', page: 'https://www.meridian.example/seating?utm=1#top' }, SITE);
    expect(link.parentOrigin()).toBe(SITE);
    expect(link.page()).toBe('https://www.meridian.example/seating');
    expect(view).toHaveBeenCalledWith({ width: 390, height: 780, side: 'left' });
    link.size(436.4, 686, false);
    link.size(436.4, 686, false);
    link.opened(true);
    link.closed();
    link.unread(2);
    expect(parent.sent.slice(1)).toEqual([
      { message: { type: 'adminium:size', w: 437, h: 686, sheet: false }, origin: SITE },
      { message: { type: 'adminium:open', sheet: true }, origin: SITE },
      { message: { type: 'adminium:close' }, origin: SITE },
      { message: { type: 'adminium:unread', n: 2 }, origin: SITE },
    ]);
    // Later messages from any other origin are ignored; the website's own are heard.
    hear({ type: 'adminium:open' }, 'https://evil.example');
    hear({ type: 'adminium:viewport', w: 1024, h: 700, side: 'right' }, 'https://evil.example');
    expect(open).not.toHaveBeenCalled();
    hear({ type: 'adminium:open' }, SITE);
    hear({ type: 'adminium:viewport', w: 1024, h: 700, side: 'right' }, SITE);
    expect(open).toHaveBeenCalledTimes(1);
    expect(view).toHaveBeenLastCalledWith({ width: 1024, height: 700, side: 'right' });
  });

  it('keeps no page that is not a web page', () => {
    const { win, hear } = frameWindow();
    const link = linkChatToLoader(win, [SITE], { view: vi.fn(), open: vi.fn(), close: vi.fn() });
    hear({ type: 'adminium:hello', w: 390, h: 780, side: 'right', page: 'javascript:alert(1)' }, SITE);
    expect(link.page()).toBeNull();
  });
});
