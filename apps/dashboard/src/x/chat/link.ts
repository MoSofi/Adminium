// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A chat window drawn in the website loader's frame (`/x/embed.js` with
 * `data-adminium-chat`), talking to it by `postMessage`.
 *
 * THE HANDSHAKE is the forms frame's (`../frame.ts`): the frame says it is
 * ready (`adminium:ready`, nothing in it); the loader answers
 * `adminium:hello`, and that hello is taken only from the frame's own parent
 * and only from one of the websites the owner listed (`frameOrigins`). It
 * carries the host page's viewport, which side of it the launcher sits on
 * (the host page's own direction), and the page the visitor is on (origin
 * and path only, kept for the first message's "came from").
 *
 * AFTER IT, both ways, to that one origin only:
 *  - the frame sends `adminium:size` (the box the window needs, or the whole
 *    viewport for the phone sheet), `adminium:open` and `adminium:close`
 *    (the loader locks the page's scrolling under the sheet, and gives focus
 *    back to the frame on close), and `adminium:unread` (how many replies
 *    came while the window was closed);
 *  - the loader sends `adminium:viewport` when the page is resized, and
 *    `adminium:open` / `adminium:close` when the website opens or closes the
 *    chat itself (`adminium.chat.open()`).
 *
 * Nothing is sent before the hello: until then the loader keeps the frame at
 * no size at all, so a chat that is not available never shows.
 */
import { HELLO, READY } from '../frame.js';

export const SIZE = 'adminium:size';
export const OPEN = 'adminium:open';
export const CLOSE = 'adminium:close';
export const UNREAD = 'adminium:unread';
export const VIEWPORT = 'adminium:viewport';

/** The host page, as the loader describes it. */
export interface HostView {
  /** The page's own viewport, in CSS pixels. */
  width: number;
  height: number;
  /** The side the launcher sits on: the page's own end side. */
  side: 'left' | 'right';
}

export interface ChatLink {
  /** The host page's origin once a listed website said hello; null until then. */
  parentOrigin(): string | null;
  /** Where the visitor is: the host page's origin and path, as the loader said it. */
  page(): string | null;
  /** The box the window needs (`sheet`: the whole viewport). Sent only when it changed. */
  size(width: number, height: number, sheet: boolean): void;
  opened(sheet: boolean): void;
  closed(): void;
  unread(count: number): void;
  stop(): void;
}

export interface ChatLinkEvents {
  /** The loader said hello, or the page was resized. */
  view(view: HostView): void;
  /** The website asked the chat to open or close. */
  open(): void;
  close(): void;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 100_000;

function viewOf(data: Record<string, unknown>): HostView | null {
  if (!isNumber(data['w']) || !isNumber(data['h'])) return null;
  return { width: data['w'], height: data['h'], side: data['side'] === 'left' ? 'left' : 'right' };
}

/** A page address as kept for "came from": an http(s) origin and path, nothing else; null for anything other. */
function pageOf(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

export function linkChatToLoader(win: Window, allowed: readonly string[], on: ChatLinkEvents): ChatLink {
  let origin: string | null = null;
  let page: string | null = null;
  let last = '';
  const listen = (event: MessageEvent): void => {
    if (event.source !== win.parent || win.parent === win) return;
    const data = event.data as Record<string, unknown> | null;
    if (data === null || typeof data !== 'object') return;
    if (origin === null) {
      if (data['type'] !== HELLO || !allowed.includes(event.origin)) return;
      origin = event.origin;
      page = pageOf(data['page']);
      const view = viewOf(data);
      if (view !== null) on.view(view);
      return;
    }
    // Once linked, only the linked website is listened to.
    if (event.origin !== origin) return;
    if (data['type'] === VIEWPORT) {
      const view = viewOf(data);
      if (view !== null) on.view(view);
    } else if (data['type'] === OPEN) on.open();
    else if (data['type'] === CLOSE) on.close();
  };
  win.addEventListener('message', listen);
  // Nothing in it: any page may learn that a frame is ready.
  if (win.parent !== win) win.parent.postMessage({ type: READY }, '*');
  const send = (message: Record<string, unknown>): void => {
    if (origin !== null) win.parent.postMessage(message, origin);
  };
  return {
    parentOrigin: () => origin,
    page: () => page,
    size(width, height, sheet) {
      const key = `${String(Math.ceil(width))}x${String(Math.ceil(height))}${sheet ? 's' : ''}`;
      if (origin === null || key === last) return;
      last = key;
      send({ type: SIZE, w: Math.ceil(width), h: Math.ceil(height), sheet });
    },
    opened: (sheet) => send({ type: OPEN, sheet }),
    closed: () => send({ type: CLOSE }),
    unread: (count) => send({ type: UNREAD, n: count }),
    stop: () => win.removeEventListener('message', listen),
  };
}
