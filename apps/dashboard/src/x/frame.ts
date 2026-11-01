// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A form drawn in a frame on the owner's website, talking to the website
 * loader (`/x/embed.js`) by `postMessage`.
 *
 * THE HANDSHAKE. The frame says it is ready (`adminium:ready`, nothing in
 * it, to its parent); the loader answers `adminium:hello` to this frame, and
 * the origin that hello comes from is the parent's. It is taken only from
 * the frame's own parent window, and only when it is one of the websites the
 * owner listed (the API hands those to a frame alone, `frameOrigins`). Until
 * then, nothing is sent anywhere.
 *
 * THE HEIGHT. Once the parent is known, the page's height goes to it, to
 * that origin only, whenever it changes (an error shown, a question shown by
 * "show if", the ending), so the loader sizes the frame and nothing scrolls
 * inside it.
 */
export const HELLO = 'adminium:hello';
export const READY = 'adminium:ready';
export const HEIGHT = 'adminium:height';

export interface FrameLink {
  /** The parent's origin once a listed website said hello; null until then. */
  parentOrigin(): string | null;
  /** Sends the page's height to the parent, when it is known and it changed. */
  postHeight(height: number): void;
  stop(): void;
}

export function linkToParent(win: Window, allowed: readonly string[], onLinked?: () => void): FrameLink {
  let origin: string | null = null;
  let last = -1;
  const listen = (event: MessageEvent): void => {
    if (origin !== null || event.source !== win.parent || win.parent === win) return;
    const data = event.data as { type?: unknown } | null;
    if (data === null || typeof data !== 'object' || data.type !== HELLO) return;
    if (!allowed.includes(event.origin)) return;
    origin = event.origin;
    onLinked?.();
  };
  win.addEventListener('message', listen);
  // Nothing in it: any page may learn that a frame is ready.
  if (win.parent !== win) win.parent.postMessage({ type: READY }, '*');
  return {
    parentOrigin: () => origin,
    postHeight(height: number) {
      const h = Math.ceil(height);
      if (origin === null || h === last || !Number.isFinite(h) || h <= 0) return;
      last = h;
      win.parent.postMessage({ type: HEIGHT, h }, origin);
    },
    stop: () => win.removeEventListener('message', listen),
  };
}
