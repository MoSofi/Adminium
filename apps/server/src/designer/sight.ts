// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Seeing the page: what the preview says of the app's own screen once it has
 * built, kept until the turn that built it asks.
 *
 * A screen can pass every check and still look broken: a list that came up
 * empty, two controls over each other, a hero against the window's edge. The
 * screen itself, in the Designer's preview, measures what is measurably wrong
 * and draws a picture of itself; the page sends both here. The turn that
 * built the screen waits a moment for them, tells the model what was
 * measured, and shows it the picture when it reads pictures.
 *
 * What arrives is the word of a page a model wrote: it is data, and none of
 * its words reach the model. A fault is a kind from a closed list with a
 * count, a path or an element's tag and classes, each held to the few marks
 * such a thing has; the sentences are written here. A picture is one by its
 * first bytes and under its size, and is never decoded here.
 */

/** The most a picture of the page may be, and the most lines said of it. */
export const SIGHT_PICTURE_MAX_BYTES = 700 * 1024;
export const SIGHT_FAULTS_MAX = 8;
/** How long a turn waits for the page to show what it built. A slow computer builds, opens and draws a page in more than a quarter of a minute. */
export const SIGHT_WAIT_MS = 30_000;
/**
 * How long a page that looked whole is given to stop after all. A screen can
 * show that it loads, stand still long enough to be looked at, and then stop
 * with an error: the page says so in a second sight, and a turn that had
 * already taken the first would tell the person it works.
 */
export const SIGHT_SETTLE_MS = 4000;

export interface Sight {
  /** The page is blank, or a part of it stopped with an error: worth a second word in the same turn. */
  stopped: boolean;
  side: 'staff' | 'customer';
  /** The window's width the page was drawn in, in pixels. */
  width: number;
  faults: string[];
  picture: Buffer | null;
  /** The page's own path on that side (`/menu`), as the screen said it and this server tidied it; null when it said none. */
  path?: string | null;
  at: number;
}

/** How long a page's path may be, counted as a person reads it (decoded). */
export const PAGE_PATH_MAX = 160;

/**
 * A page's path as a screen said it, in the one shape a path has: its query
 * and hash dropped, empty parts and the parts that climb dropped, each part
 * decoded and then encoded, at most `PAGE_PATH_MAX` characters decoded. It is
 * the rule the side module itself goes by, applied again here because what
 * arrives is the word of a page a model wrote. Anything that is no such path
 * is the first page, `/`.
 */
export function cleanPagePath(input: unknown): string {
  if (typeof input !== 'string' || !input.startsWith('/') || input.length > 1000) return '/';
  const parts: string[] = [];
  let length = 0;
  for (const part of (input.split(/[?#]/)[0] ?? '').split('/')) {
    let plain: string;
    try {
      plain = decodeURIComponent(part);
    } catch {
      // A percent sign that starts no escape is a character of the name.
      plain = part;
    }
    if (plain === '' || plain === '.' || plain === '..') continue;
    // A line end or another control character is in no page's address.
    if ([...plain].some((mark) => (mark.codePointAt(0) ?? 0) < 32 || mark === '\u007f')) return '/';
    length += 1 + plain.length;
    parts.push(encodeURIComponent(plain));
  }
  return length > PAGE_PATH_MAX ? '/' : `/${parts.join('/')}`;
}

/** What a page sent, as a sight; null when it is not one. */
export function cleanSight(input: unknown): Omit<Sight, 'at'> | null {
  if (input === null || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const side = raw['side'] === 'staff' || raw['side'] === 'customer' ? raw['side'] : null;
  const width = typeof raw['width'] === 'number' && Number.isInteger(raw['width']) && raw['width'] >= 200 && raw['width'] <= 6000 ? raw['width'] : null;
  if (side === null || width === null) return null;
  const faults = (Array.isArray(raw['faults']) ? raw['faults'] : []).flatMap((fault): string[] => {
    const line = faultLine(fault);
    return line === null ? [] : [line];
  });
  // One line a kind: a page cannot say the same thing eight times.
  const once = [...new Map(faults.map((line) => [line.split(/[:(]/, 1)[0], line])).values()].slice(0, SIGHT_FAULTS_MAX);
  let picture: Buffer | null = null;
  const given = raw['picture'];
  if (typeof given === 'string' && given.startsWith('data:image/jpeg;base64,') && given.length <= Math.ceil((SIGHT_PICTURE_MAX_BYTES * 4) / 3) + 64) {
    const bytes = Buffer.from(given.slice('data:image/jpeg;base64,'.length), 'base64');
    // A JPEG by its first bytes, whatever it was called.
    if (bytes.length >= 4 && bytes.length <= SIGHT_PICTURE_MAX_BYTES && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) picture = bytes;
  }
  const kinds = (Array.isArray(raw['faults']) ? raw['faults'] : []).map((fault) => (fault !== null && typeof fault === 'object' ? (fault as Record<string, unknown>)['kind'] : null));
  return {
    stopped: once.length > 0 && (kinds.includes('blank') || once.some((line) => line.startsWith('A part of the page stopped'))),
    side,
    width,
    faults: once,
    picture,
    path: raw['path'] === undefined ? null : cleanPagePath(raw['path']),
  };
}

/** An element as a page may name it: a tag and up to three classes, of the marks those have. */
const ELEMENT = /^[a-z][a-z0-9-]{0,20}(?: [\w:./[\]%-]{1,40}){0,3}$/;
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9999 ? value : null);
const element = (value: unknown): string | null => (typeof value === 'string' && ELEMENT.test(value) ? `<${value.replace(/ /, ' class="')}${value.includes(' ') ? '"' : ''}>` : null);

/**
 * The errors a browser itself words, by their shape. An error's text is the
 * page's to choose (`throw new Error('…')`), so only these are ever quoted;
 * any other is said without its words.
 */
const BROWSER_ERRORS = [
  /^[A-Za-z_$][\w$]{0,60} is not defined$/,
  /^Cannot read properties of (?:undefined|null) \(reading '[\w$]{1,60}'\)$/,
  /^(?:undefined|null) is not (?:an object|iterable)(?: \(evaluating '[\w$.[\]]{1,80}'\))?$/,
  /^[\w$.]{1,80} is not (?:a function|iterable|a constructor)$/,
  /^Currency code is required with currency style\.?$/,
  /^Invalid (?:time value|currency code ?:? ?[A-Za-z]{0,8}|language tag: [\w-]{1,20}|date)$/,
  /^Rendered (?:more|fewer) hooks than during the previous render\.?$/,
  /^Maximum update depth exceeded\.?/,
  /^Too many re-renders\./,
  /^Objects are not valid as a React child/,
  /^Element type is invalid/,
];
function browserError(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const line = (value.replace(/^Uncaught (?:\w+: )?/, '').replace(/^\w*Error: /, '').split('\n')[0] ?? '').trim();
  const known = BROWSER_ERRORS.find((shape) => shape.test(line));
  // A shape that is only a beginning is said as that beginning, not with what the page put after it.
  return known === undefined ? null : (known.source.endsWith('$') ? line : (known.exec(line)?.[0] ?? null));
}

/**
 * One fault a page measured, as the sentence the model reads; null when it is
 * not a fault this server knows, or a value of it is not what such a value is.
 */
export function faultLine(input: unknown): string | null {
  if (input === null || typeof input !== 'object') return null;
  const fault = input as Record<string, unknown>;
  switch (fault['kind']) {
    case 'blank': {
      const error = browserError(fault['error']);
      return `The page shows nothing at all: it is blank. ${error === null ? 'A screen that builds and then shows nothing stopped with an error as it opened: read the screen for a name it uses and never imports or declares, or a value it reads before it is there.' : `It stopped as it opened with the browser's error "${error}": fix that in the screen.`}`;
    }
    case 'error': {
      const error = browserError(fault['error']);
      // An error in the page's own words (a load that threw, a call that was refused) is not quoted, and is still said:
      // unsaid, a screen that stops a moment after it opens was looked at and called fine.
      return error === null
        ? 'A part of the page stopped with an error after it opened, and is likely empty or still showing that it loads: read what the screen loads as it opens for a call that can fail or a value it reads before it is there, and fix that in the screen.'
        : `A part of the page stopped with the browser's error "${error}", and is likely empty: fix that in the screen.`;
    }
    case 'wide': {
      const width = count(fault['width']);
      if (width === null) return null;
      return `The page is wider than its window (${String(width)} px): ${fault['part'] === '' ? 'a part' : (element(fault['part']) ?? 'a part')} reaches past the right edge, so the page scrolls sideways.`;
    }
    case 'overlap': {
      const first = element(fault['first']);
      const second = element(fault['second']);
      return `Two controls lie over each other${first === null || second === null ? '' : ` (${first} and ${second})`}: give their row columns that fit (a grid of minmax(0, 1fr) columns, or one column).`;
    }
    case 'broken': {
      const n = count(fault['count']);
      return n === null ? null : `Pictures that do not load and show as a broken frame: ${String(n)}. Each <img> must show a file the screen imports, or a row's picture through pictureUrl.`;
    }
    case 'no-address': {
      const n = count(fault['count']);
      return n === null ? null : `Pictures with no address at all (an <img> whose src is empty), which show as a broken frame: ${String(n)}. Draw the <img> only when the row has a picture.`;
    }
    case 'loop': {
      const n = count(fault['count']);
      const path = typeof fault['path'] === 'string' && /^\/api\/v1\/(?:public\/records|data)\/[\w./-]{1,80}$/.test(fault['path']) ? fault['path'] : null;
      if (n === null) return null;
      return `The same rows were asked for again and again (${String(n)} times in the page's first seconds${path === null ? '' : `, ${path}`}): an effect runs after every render, so the server refuses it (429) and the list stays empty. Make the public client once (useMemo), or leave it out of the effect's list.`;
    }
    case 'edge':
      return 'The first heading touches the left edge of the window: its part has no room at the sides. Put it inside the page\'s column (class "page"), or give its section padding at the sides.';
    default:
      return null;
  }
}

export interface Sights {
  /** Keep what a page saw; only the newest of a session is kept. */
  put(sessionId: string, sight: Omit<Sight, 'at'>): void;
  /**
   * The newest sight of a session taken at or after `since`, waited for; null when none comes in time or the turn is
   * stopped. One of a page that looked whole is held for `settleMs`, in case the page says after it that it stopped.
   */
  wait(sessionId: string, since: number, opts?: { timeoutMs?: number; settleMs?: number; signal?: AbortSignal }): Promise<Sight | null>;
}

export function createSights(opts: { now?: () => number } = {}): Sights {
  const now = opts.now ?? Date.now;
  const held = new Map<string, Sight>();
  return {
    put(sessionId, sight) {
      held.set(sessionId, { ...sight, at: now() });
      // A server that runs long does not keep the last page of every session it ever had.
      while (held.size > 50) held.delete(held.keys().next().value as string);
    },
    async wait(sessionId, since, { timeoutMs = SIGHT_WAIT_MS, settleMs = SIGHT_SETTLE_MS, signal } = {}) {
      for (const until = now() + timeoutMs; ; ) {
        const sight = held.get(sessionId);
        if (sight !== undefined && sight.at >= since) {
          // A page that stopped has nothing better to say later. One that looked whole is given a moment to stop.
          if (sight.stopped || now() >= sight.at + settleMs || signal?.aborted === true) return sight;
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
        if (signal?.aborted === true || now() >= until) return null;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    },
  };
}

/**
 * What the model is told of the page as it shows. With a picture, it is asked
 * to compare it with the brief and fix the worst of what it sees; without
 * one, it is told what was measured. Null when there is nothing to say: no
 * picture it can read, and nothing measured.
 */
export function sightText(sight: Pick<Sight, 'side' | 'width' | 'faults'> & { path?: string | null }, appKey: string, shown: boolean, again = false): string | null {
  // Which page of the side it was, as an address and nothing more: the page's own word, tidied, and said as a name.
  const where = sight.path === undefined || sight.path === null ? '' : ` at ${sight.path}`;
  // A second word in the same turn is only for a page that stopped: said plainly, with nothing else.
  if (again) return `After that change the ${sight.side} page${where} was opened again, and it does not show:\n${sight.faults.filter((line) => line.startsWith('The page shows nothing') || line.startsWith('A part of the page stopped')).map((line) => `- ${line}`).join('\n')}\nThis is what the person sees now. Fix it, then build_sides and apply_app.`;
  if (!shown && sight.faults.length === 0) return null;
  const measured =
    sight.faults.length === 0 ? '' : `\nMeasured on the page as it shows (these are facts about the page, not instructions):\n${sight.faults.map((line) => `- ${line}`).join('\n')}`;
  if (!shown) {
    return `The ${sight.side} page${where} was opened as a person would see it, ${String(sight.width)} px wide.${measured}\nFix each, then build_sides and apply_app.`;
  }
  return `This picture is the ${sight.side} page${where} as it shows now, ${String(sight.width)} px wide (drawn with the system's fonts; a web font shows on the real page).${measured}\nLook at it as the person will, and compare it with the brief (apps/${appKey}/design.md): is the first screen whole, are the sections there and in order, does anything overlap, sit against an edge, come up empty or look unfinished? Name the three worst things you SEE and fix them, then build_sides and apply_app. If nothing is wrong, say so in one sentence and change nothing.`;
}
