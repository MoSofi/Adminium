// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE FRAME'S HALF OF AN APP SCREEN ON THE OWNER'S WEBSITE, talking to the
 * website loader (`/x/embed.js`) by `postMessage`.
 *
 *   const frame = readFrame();                     // null outside a frame
 *   const client = createPublicClient({ ...config, framed: frame !== null });
 *   const link = frame && startFrame({
 *     origins: config.frameOrigins ?? [],          // from surface-config.json?frame=1
 *     screens: ['book', 'booked', 'reviews'],      // the only screens this frame shows
 *     base: '/apps/bookings/customer',
 *   });
 *
 * THE SCREENS. The server's list (`frontends[].embed`) says which addresses a
 * listed website may load. The app changes screens with no new request, so
 * only the app can hold the frame to its screens: ask `link.go(screen, path)`
 * before showing one. Any other screen (a private booking page with its
 * Cancel, sign-in, a person's visits) opens the app's own address in a new tab.
 *
 * WHAT THE WEBSITE MAY BE TOLD. Every script on the host page hears
 * `link.done(code)`, and up to 50 listed sites may frame the screen. So it
 * carries only a value that, alone or with what the host page already knows,
 * OPENS NOTHING. Never a name, an e-mail, a private link, or a code that is
 * half of a claim. Leave the code out if yours is one.
 *
 * THE HANDSHAKE. The frame says it is ready (nothing in it, to its parent).
 * A hello is taken only from the frame's own parent window, and only from an
 * origin on the owner's list; everything after goes to that one origin.
 *
 * IN AN INLINE FRAME the frame is as tall as its content, so a bar fixed to
 * the bottom, a centred dialog and `100vh` all misbehave: lay them out as
 * normal blocks. `<html data-adminium-frame="inline">` is there to key on. In
 * a sheet the frame is the viewport and the normal phone layout applies.
 *
 * PAYING. A tab opened by script after a wait is blocked as a pop-up, so offer
 * a real link (`payLinkProps`), then `watchPayment` while the frame waits: the
 * tab and the frame share no storage, so only the server can say it was paid.
 */

export type FrameMode = 'inline' | 'button' | 'floating';
export type FrameTheme = 'light' | 'dark';

const MODES: readonly string[] = ['inline', 'button', 'floating'];
const LABEL_MAX = 28;
const HEIGHT_MAX = 20_000;
/** At most one height message per this many milliseconds. */
export const HEIGHT_EVERY_MS = 100;
const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
/** A booking's code, or the like: short, plain, and (see above) opening nothing. */
const DONE_CODE = /^[A-Za-z0-9-]{1,32}$/;
/** A path of this app: one leading slash, never `//` or `/\`, which a browser reads as another host. */
const OWN_PATH = /^\/(?![/\\])[^\\\s]*$/;

/** How this page was framed, read from its address. */
export interface FramedPage {
  mode: FrameMode;
  theme: FrameTheme;
  /** The language of the host page: read it before any stored choice. */
  lang: string | null;
}

/**
 * The frame this page is in, or null. An address with `frame=1` opened in a
 * tab of its own (a copied link) is not framed: the app shows its normal
 * header and footer.
 */
export function readFrame(win: Window = window): FramedPage | null {
  if (win.parent === win) return null;
  const query = new URLSearchParams(win.location.search);
  const asked = query.getAll('frame');
  if (asked.length !== 1 || asked[0] !== '1') return null;
  // The loader writes its own words last, after anything a path carried.
  const last = (name: string): string | null => query.getAll(name).slice(-1)[0] ?? null;
  const mode = last('mode') ?? 'inline';
  const lang = last('lang');
  return {
    mode: MODES.includes(mode) ? (mode as FrameMode) : 'inline',
    theme: last('theme') === 'dark' ? 'dark' : 'light',
    lang: lang !== null && LANGUAGE.test(lang) ? lang : null,
  };
}

export interface FrameOptions {
  /** The owner's listed websites: `frameOrigins` of `surface-config.json?frame=1`. */
  origins: readonly string[];
  /** The only screens this frame shows, by the app's own names. */
  screens: readonly string[];
  /** The side's own address on this host, like `/apps/bookings/customer`. */
  base: string;
  /** The element whose height is the page's. Defaults to the body. */
  root?: Element;
  /** A listed website said hello; `label` is the words it chose for the launcher, as text. */
  onLinked?: (hello: { label: string | null }) => void;
  /** The sheet was opened (by the site's own button). */
  onOpen?: () => void;
  /** The sheet was closed (by the site, or by Escape). */
  onClose?: () => void;
}

export interface FrameLink {
  readonly mode: FrameMode;
  /** The website's origin once it said hello; null until then. */
  parentOrigin(): string | null;
  /** Whether this frame shows that screen. */
  allows(screen: string): boolean;
  /** The app's own address for a path, outside any frame. */
  outside(path: string): string;
  /** The attributes of a real link to that address, in a new tab. */
  linkProps(path: string): { href: string; target: '_blank'; rel: string };
  /** True when the screen may show here. Otherwise opens it in a new tab (call it from the click) and answers false. */
  go(screen: string, path: string): boolean;
  /** Says the page's height now (an inline frame). It is also said whenever the page's size changes. */
  postHeight(): void;
  /** The launcher's size, for a floating frame while its sheet is closed. */
  size(width: number, height: number): void;
  /** Open the sheet: the frame fills the page, and the page behind stops scrolling. */
  openSheet(): void;
  /** Close it: the launcher again, or no frame at all, and focus goes back to the site. */
  closeSheet(): void;
  /** A step changed: bring the frame's top into view on the host page. */
  scrollIntoView(): void;
  /** Tell the website the booking was made. See "what the website may be told". */
  done(code?: string): void;
  stop(): void;
}

export function startFrame(options: FrameOptions, win: Window = window): FrameLink | null {
  const page = readFrame(win);
  if (page === null) return null;
  const { mode } = page;
  const base = options.base.replace(/\/+$/, '');
  const root = options.root ?? win.document.body;
  let origin: string | null = null;
  let lastHeight = -1;
  let lastSent = -Infinity;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let launcher: { w: number; h: number } | null = null;
  let sheet = false;
  let observer: ResizeObserver | null = null;

  const send = (message: Record<string, unknown>): void => {
    if (origin !== null) win.parent.postMessage(message, origin);
  };

  const sayHeight = (): void => {
    if (origin === null || mode !== 'inline') return;
    const h = Math.ceil(Math.max(root.getBoundingClientRect().height, root.scrollHeight || 0));
    if (h === lastHeight || h <= 0 || h >= HEIGHT_MAX) return;
    lastHeight = h;
    lastSent = Date.now();
    send({ type: 'adminium:height', h });
  };

  const postHeight = (): void => {
    if (pending !== null) return;
    const wait = lastSent + HEIGHT_EVERY_MS - Date.now();
    if (wait <= 0) {
      sayHeight();
      return;
    }
    pending = setTimeout(() => {
      pending = null;
      sayHeight();
    }, wait);
  };

  const openSheet = (): void => {
    if (sheet || mode === 'inline') return;
    sheet = true;
    send({ type: 'adminium:size', w: 1, h: 1, sheet: true });
    send({ type: 'adminium:open', sheet: true });
  };

  const closeSheet = (): void => {
    if (!sheet) return;
    sheet = false;
    if (launcher !== null) send({ type: 'adminium:size', w: launcher.w, h: launcher.h });
    send({ type: 'adminium:close' });
  };

  const listen = (event: MessageEvent): void => {
    if (event.source !== win.parent) return;
    const data = event.data as { type?: unknown; label?: unknown } | null;
    if (data === null || typeof data !== 'object') return;
    if (origin === null) {
      if (data.type !== 'adminium:hello' || !options.origins.includes(event.origin)) return;
      origin = event.origin;
      const label = typeof data.label === 'string' && data.label.trim() !== '' ? data.label.trim().slice(0, LABEL_MAX) : null;
      const Observer = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
      if (mode === 'inline' && Observer !== undefined) {
        const watching = new Observer(postHeight);
        watching.observe(root);
        observer = watching;
      }
      // Said at once: a frame still at no height may not be given a layout pass to observe.
      sayHeight();
      options.onLinked?.({ label });
      return;
    }
    if (event.origin !== origin) return;
    if (data.type === 'adminium:open') {
      openSheet();
      options.onOpen?.();
    } else if (data.type === 'adminium:close' && sheet) {
      closeSheet();
      options.onClose?.();
    }
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !sheet) return;
    closeSheet();
    options.onClose?.();
  };

  const outside = (path: string): string => `${win.location.origin}${base}${OWN_PATH.test(path) ? path : '/'}`;

  win.document.documentElement.setAttribute('data-adminium-frame', mode);
  if (mode === 'inline') {
    // `height: 100%` or `100vh` here would read the frame's own height back: 0 at the start, and never less after.
    for (const element of [win.document.documentElement, win.document.body]) {
      element.style.height = 'auto';
      element.style.minHeight = '0';
    }
  }
  win.addEventListener('message', listen);
  win.addEventListener('keydown', onKey);
  // Nothing in it: any page may learn that a frame is ready.
  win.parent.postMessage({ type: 'adminium:ready' }, '*');

  return {
    mode,
    parentOrigin: () => origin,
    allows: (screen) => options.screens.includes(screen),
    outside,
    linkProps: (path) => ({ href: outside(path), target: '_blank', rel: 'noopener noreferrer' }),
    go(screen, path) {
      if (options.screens.includes(screen)) return true;
      win.open(outside(path), '_blank', 'noopener');
      return false;
    },
    postHeight,
    size(width, height) {
      launcher = { w: width, h: height };
      if (!sheet) send({ type: 'adminium:size', w: width, h: height });
    },
    openSheet,
    closeSheet,
    scrollIntoView: () => send({ type: 'adminium:scroll' }),
    done(code) {
      send({ type: 'adminium:done', ...(code !== undefined && DONE_CODE.test(code) ? { code } : {}) });
    },
    stop() {
      win.removeEventListener('message', listen);
      win.removeEventListener('keydown', onKey);
      observer?.disconnect();
      if (pending !== null) clearTimeout(pending);
      pending = null;
    },
  };
}

/** The attributes of the real link a guest presses to pay: a script's tab, after a wait, is blocked as a pop-up. */
export function payLinkProps(payUrl: string): { href: string; target: '_blank'; rel: string } {
  return { href: payUrl, target: '_blank', rel: 'noopener noreferrer' };
}

/**
 * Storage that survives its own absence: held in memory first, and copied to
 * the tab's storage when the browser gives one. A third-party frame's storage
 * is partitioned, may be forgotten when the browser quits, and may be refused.
 */
export function frameStore(win: Window = window): { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void } {
  const held = new Map<string, string | null>();
  const quietly = <T>(act: (storage: Storage) => T): T | null => {
    try {
      return act(win.sessionStorage);
    } catch {
      return null;
    }
  };
  return {
    get: (key) => (held.has(key) ? (held.get(key) ?? null) : quietly((storage) => storage.getItem(key))),
    set(key, value) {
      held.set(key, value);
      quietly((storage) => storage.setItem(key, value));
    },
    remove(key) {
      held.set(key, null);
      quietly((storage) => storage.removeItem(key));
    },
  };
}

/** What a frame waiting on a payment can show. */
export type FramePayState = 'paying' | 'confirming' | 'paid' | 'let-go';

export interface WatchPaymentOptions {
  /** How the record stands now, from the server: read the row, never the pay tab. */
  read: () => Promise<FramePayState>;
  onState: (state: FramePayState) => void;
  /**
   * Past the hold's end and its margin, the server could not be asked three
   * times running, so nobody can say whether it was paid. The watch has
   * stopped: say so, and point to the confirmation e-mail. A `read` that knows
   * the record is gone answers `let-go` instead of throwing.
   */
  onLost?: () => void;
  /** When the hold on the record ends (ms since the epoch): past it and a margin, still unpaid is let go. */
  holdEndsAt?: number | null;
  /** How often to ask while the tab is visible. Default 3 seconds. */
  everyMs?: number;
  /** How long past the hold's end to keep asking. Default a minute. */
  marginMs?: number;
  now?: () => number;
}

/**
 * Ask how the payment stands while the page is visible, and at once when it
 * becomes visible again, until it is paid or let go. A failed read is asked
 * again; it never changes what the frame shows. Returns the way to stop.
 */
export function watchPayment(options: WatchPaymentOptions, win: Window = window): () => void {
  const now = options.now ?? Date.now;
  const margin = options.marginMs ?? 60_000;
  let stopped = false;
  let busy = false;
  let last: FramePayState | null = null;
  let failures = 0;

  const stop = (): void => {
    stopped = true;
    win.clearInterval(timer);
    win.document.removeEventListener('visibilitychange', tick);
  };
  const say = (state: FramePayState): void => {
    if (state === last) return;
    last = state;
    options.onState(state);
  };
  async function ask(): Promise<void> {
    busy = true;
    try {
      const state = await options.read();
      if (stopped) return;
      failures = 0;
      const lapsed = state === 'paying' && options.holdEndsAt != null && now() > options.holdEndsAt + margin;
      const shown = lapsed ? 'let-go' : state;
      say(shown);
      if (shown === 'paid' || shown === 'let-go') stop();
    } catch {
      // Asked again on the next turn, until the hold is long over.
      failures += 1;
      if (!stopped && failures >= 3 && options.holdEndsAt != null && now() > options.holdEndsAt + margin) {
        stop();
        options.onLost?.();
      }
    } finally {
      busy = false;
    }
  }
  function tick(): void {
    if (stopped || busy || win.document.visibilityState === 'hidden') return;
    void ask();
  }
  const timer = win.setInterval(tick, options.everyMs ?? 3000);
  win.document.addEventListener('visibilitychange', tick);
  tick();
  return stop;
}

const PAY_RETURN_KEY = 'adminium:pay-return';

/**
 * Remember, in this tab, the app's own screen to go on to after paying. The
 * pay page's way back carries no booking by rule, so a return page finds it
 * here, or says thank you when it finds nothing (a new tab, another device).
 */
export function rememberPayReturn(path: string, win: Window = window): void {
  if (!OWN_PATH.test(path)) return;
  try {
    win.sessionStorage.setItem(PAY_RETURN_KEY, path);
  } catch {
    // No storage: the return page says thank you.
  }
}

/** The screen remembered for the way back, once; null when there is none. Works with no session. */
export function takePayReturn(win: Window = window): string | null {
  try {
    const path = win.sessionStorage.getItem(PAY_RETURN_KEY);
    win.sessionStorage.removeItem(PAY_RETURN_KEY);
    return path !== null && OWN_PATH.test(path) ? path : null;
  } catch {
    return null;
  }
}
