// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ASSISTANT'S BUTTON ON AN APP'S OWN STAFF ADDRESS.
 *
 * The server adds this script to a staff side's page for a signed-in person
 * who may use the assistant (`plugins/surface-index.ts` on the server). It is
 * small on purpose: it runs on every load of a page that is not ours, so it
 * imports nothing, touches nothing of the app's, and asks the server one
 * question before it draws anything.
 *
 * WHAT IT DRAWS. One host element with an open shadow root, so the app's
 * styles and the button's never meet. In it: the button, and on the first
 * press a frame holding the dashboard's own panel (`/assets/milo/panel.html`,
 * same origin). A frame, because the panel is the dashboard's code with the
 * dashboard's stylesheet, and a document of its own keeps both whole.
 *
 * WHERE IT STAYS OUT. Inside a frame (the dashboard shows an app's staff side
 * in one, and its own button serves there); when the server says the
 * assistant is not available to this person; twice on one page.
 */

declare const __MILO_OPEN_LABELS__: Record<string, string>;

const PANEL = '/assets/milo/panel.html';
const AVAILABILITY = '/api/v1/assistant/availability';

type Signal = 'idle' | 'working' | 'unread' | 'proposal';

/** `Ask {name}` in the person's language: the page's own, else the browser's, else English. */
export function openLabel(labels: Readonly<Record<string, string>>, name: string, languages: readonly string[]): string {
  const keys = Object.keys(labels);
  let text = labels['en-US'] ?? 'Ask {name}';
  for (const language of languages) {
    const wanted = language.replace('_', '-').toLowerCase();
    const exact = keys.find((key) => key.toLowerCase() === wanted);
    const close = exact ?? keys.find((key) => key.toLowerCase().split('-')[0] === wanted.split('-')[0]);
    if (close !== undefined) {
      text = labels[close] as string;
      break;
    }
  }
  return text.replace('{name}', name);
}

/** Where the side's own configuration is read: under the side's path on the dashboard's host, at the root on a host of its own. */
export function configAddress(pathname: string): string {
  const mounted = /^(\/apps\/[^/]+\/(?:[^/]+\/)?staff)(?:\/|$)/.exec(pathname);
  return mounted === null ? '/surface-config.json' : `${mounted[1] as string}/surface-config.json`;
}

const STYLE = `
:host { all: initial; }
button {
  position: fixed; inset-block-end: 16px; inset-inline-end: 16px; z-index: 2147483000;
  inline-size: 48px; block-size: 48px; border: 0; border-radius: 9999px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  background: #4f46e5; color: #fff; box-shadow: 0 8px 22px rgba(79, 70, 229, .36);
}
button:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
button[hidden] { display: none; }
button svg { inline-size: 20px; block-size: 20px; }
.dot { position: absolute; inset-block-start: -1px; inset-inline-end: -1px; inline-size: 14px; block-size: 14px;
  border-radius: 9999px; border: 2.5px solid #fff; background: #dc2626; box-sizing: border-box; }
.dot[data-signal="proposal"] { background: #d97706; }
.dot[hidden] { display: none; }
@keyframes milo-turn { to { transform: rotate(360deg); } }
.ring { position: absolute; inset: -5px; border-radius: 9999px; border: 2px solid transparent; border-block-start-color: #4f46e5;
  animation: milo-turn 2.4s linear infinite; }
.ring[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
iframe {
  position: fixed; inset-block: 0; inset-inline-end: 0; z-index: 2147483001;
  inline-size: min(420px, 100vw); block-size: 100dvh; border: 0; background: transparent;
  box-shadow: 0 0 40px rgba(15, 23, 42, .18);
}
iframe[hidden] { display: none; }
`;

/** The sparkles of the dashboard's own button, drawn by hand: nothing here is ever parsed from a string of markup. */
const SPARKLES: readonly string[] = [
  'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
  'M20 3v4',
  'M22 5h-4',
  'M4 17v2',
  'M5 18H3',
];

function sparkles(): SVGSVGElement {
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG, 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) {
    svg.setAttribute(name, value);
  }
  for (const d of SPARKLES) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function hiddenSpan(className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  span.hidden = true;
  return span;
}

async function start(): Promise<void> {
  // The dashboard's own frame of this side has the dashboard's button; and never twice.
  if (window.parent !== window) return;
  if (document.querySelector('[data-milo-host]') !== null || document.documentElement.hasAttribute('data-milo-started')) return;
  // Marked before anything is waited for: a second run of this script finds it and stops.
  document.documentElement.setAttribute('data-milo-started', '');
  const tag = document.querySelector<HTMLScriptElement>('script[data-milo-loader]');
  const app = tag?.dataset['app'] ?? '';

  let name: string;
  try {
    const answer = await fetch(AVAILABILITY, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (!answer.ok) return;
    const body = (await answer.json()) as { name?: unknown };
    name = typeof body.name === 'string' && body.name !== '' ? body.name : 'Milo';
  } catch {
    return;
  }

  const host = document.createElement('div');
  host.setAttribute('data-milo-host', '');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const button = document.createElement('button');
  button.type = 'button';
  const label = openLabel(__MILO_OPEN_LABELS__, name, [document.documentElement.lang, ...navigator.languages].filter((language) => language !== ''));
  button.setAttribute('aria-label', label);
  button.title = label;
  const ring = hiddenSpan('ring');
  const dot = hiddenSpan('dot');
  button.append(ring, sparkles(), dot);
  root.append(style, button);
  document.body.append(host);

  let frame: HTMLIFrameElement | null = null;

  const show = (open: boolean): void => {
    if (frame !== null) frame.hidden = !open;
    button.hidden = open;
    if (!open) button.focus();
  };
  const signal = (next: Signal): void => {
    ring.hidden = next !== 'working';
    dot.hidden = next !== 'unread' && next !== 'proposal';
    dot.dataset['signal'] = next;
  };

  window.addEventListener('message', (event) => {
    // Only the panel, in the frame this script made, on this origin.
    if (frame === null || event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
    const data = event.data as { milo?: unknown; signal?: unknown } | null;
    if (data === null || typeof data !== 'object') return;
    if (data.milo === 'close') show(false);
    if (data.milo === 'signal' && typeof data.signal === 'string') signal(data.signal as Signal);
  });

  button.addEventListener('click', () => {
    if (frame === null) {
      frame = document.createElement('iframe');
      frame.title = name;
      const query = new URLSearchParams({
        app,
        config: configAddress(window.location.pathname),
        dir: document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr',
        theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      });
      frame.src = `${PANEL}?${query.toString()}`;
      root.append(frame);
    } else {
      frame.contentWindow?.postMessage({ milo: 'open' }, window.location.origin);
    }
    show(true);
  });
}

// Under a test the functions above are read, and nothing is drawn.
if (typeof document !== 'undefined' && document.querySelector('script[data-milo-loader]') !== null) void start();
