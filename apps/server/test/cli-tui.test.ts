// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The TUI primitives (`src/cli/io.ts`).
 *
 * Everything decision-shaped in the raw-mode prompts is a pure function —
 * `decodeKeys` turns a stdin chunk into key events, `renderSelect` turns state
 * into lines — precisely so the menu can be tested without a pty. What is left
 * inside `nodeIo` is the plumbing those two describe: write the lines, move the
 * cursor back up by `lines.length`.
 *
 * That plumbing gets its own suite at the bottom, because it is where a menu
 * whose every pure part was green still reached the user as a blank screen:
 * `paint` was only ever called from the key handler, so the first frame did not
 * exist until the user guessed that arrow keys did something. Pure-function
 * coverage cannot see WHEN a line is written, only what it says.
 */
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  askHint,
  clipText,
  createStyle,
  decodeKeys,
  GLYPH,
  nodeIo,
  railLine,
  railStep,
  renderAskAnswer,
  renderSelect,
  renderMultiSelect,
  renderSelectAnswer,
  supportsColor,
  windowSlice,
  wrapText,
} from '../src/cli/io.js';

const PLAIN = createStyle(false);

describe('decodeKeys — one stdin chunk, many keys', () => {
  it('reads the arrow-key escape sequences', () => {
    expect(decodeKeys('\u001b[A')).toEqual([{ kind: 'up' }]);
    expect(decodeKeys('\u001b[B')).toEqual([{ kind: 'down' }]);
  });

  it('reads the application-cursor variants some terminals send instead', () => {
    expect(decodeKeys('\u001bOA')).toEqual([{ kind: 'up' }]);
    expect(decodeKeys('\u001bOB')).toEqual([{ kind: 'down' }]);
  });

  it('decodes a whole paste, not just its first character', () => {
    // The bug this guards: a decoder that switched on chunk[0] would return one
    // key here, silently truncating every pasted connection string to `p`.
    const keys = decodeKeys('postgres://a@b/c');
    expect(keys).toHaveLength(16);
    expect(keys.map((key) => (key.kind === 'char' ? key.value : '')).join('')).toBe(
      'postgres://a@b/c',
    );
  });

  it('treats Ctrl-C and Ctrl-D as abort', () => {
    expect(decodeKeys('\u0003')).toEqual([{ kind: 'abort' }]);
    expect(decodeKeys('\u0004')).toEqual([{ kind: 'abort' }]);
  });

  it('maps both backspace encodings, and Ctrl-U to clear-line', () => {
    expect(decodeKeys('\u007f')).toEqual([{ kind: 'backspace' }]);
    expect(decodeKeys('\b')).toEqual([{ kind: 'backspace' }]);
    expect(decodeKeys('\u0015')).toEqual([{ kind: 'clear-line' }]);
  });

  it('accepts either newline as enter', () => {
    expect(decodeKeys('\r')).toEqual([{ kind: 'enter' }]);
    expect(decodeKeys('\n')).toEqual([{ kind: 'enter' }]);
  });

  it('keeps j and k as text, so they survive being typed into a password', () => {
    // Vim motion is a property of the MENU, not the decoder — which is shared
    // with the masked-password editor. A decoder that mapped them to arrows
    // would drop every j and k from a pasted password without a trace.
    expect(decodeKeys('jk')).toEqual([
      { kind: 'char', value: 'j' },
      { kind: 'char', value: 'k' },
    ]);
  });

  it('swallows unrecognised escape sequences whole', () => {
    // F5 is ESC[15~. Leaking its payload would type "15~" into the field.
    expect(decodeKeys('\u001b[15~')).toEqual([]);
    // …but text following the sequence still lands.
    expect(decodeKeys('\u001b[15~ok')).toEqual([
      { kind: 'char', value: 'o' },
      { kind: 'char', value: 'k' },
    ]);
  });

  it('drops control bytes that carry no meaning here', () => {
    expect(decodeKeys('\u0001\u0002')).toEqual([]);
  });

  it('handles an arrow key arriving in the same chunk as typing', () => {
    expect(decodeKeys('a\u001b[Bb')).toEqual([
      { kind: 'char', value: 'a' },
      { kind: 'down' },
      { kind: 'char', value: 'b' },
    ]);
  });
});

describe('clipText', () => {
  it('leaves text that fits alone', () => {
    expect(clipText('short', 40)).toBe('short');
  });

  it('truncates with an ellipsis, never exceeding the width', () => {
    const clipped = clipText('a'.repeat(50), 10);
    expect(clipped).toHaveLength(10);
    expect(clipped.endsWith('…')).toBe(true);
  });

  it('gives up rather than mangle an unusably narrow terminal', () => {
    expect(clipText('anything', 1)).toBe('anything');
  });
});

describe('renderSelect', () => {
  const choices = [
    { label: 'In your browser', hint: 'Recommended.' },
    { label: 'Here in the terminal' },
  ];

  it('marks the active row and only the active row', () => {
    const lines = renderSelect('How?', choices, 0, PLAIN, 80);
    expect(lines.filter((line) => line.includes(GLYPH.on))).toHaveLength(1);
    expect(lines.some((line) => line.includes(`${GLYPH.on} 1. In your browser`))).toBe(true);
    expect(lines.some((line) => line.includes(`${GLYPH.off} 2. Here in the terminal`))).toBe(true);

    const moved = renderSelect('How?', choices, 1, PLAIN, 80);
    expect(moved.filter((line) => line.includes(GLYPH.on))).toHaveLength(1);
    expect(moved.some((line) => line.includes(`${GLYPH.on} 2. Here in the terminal`))).toBe(true);
  });

  it('hangs every line off the rail, under an active-step glyph', () => {
    const lines = renderSelect('How?', choices, 0, PLAIN, 80);
    expect(lines[0]).toBe(`${GLYPH.active}  How?`);
    // Everything below the question is rail — nothing floats at column 0.
    for (const line of lines.slice(1)) expect(line.startsWith(GLYPH.bar)).toBe(true);
  });

  it('numbers every row, so the jump keys are discoverable', () => {
    const lines = renderSelect('How?', choices, 0, PLAIN, 80).join('\n');
    expect(lines).toContain('1. In your browser');
    expect(lines).toContain('2. Here in the terminal');
  });

  it('renders a hint under the choice it belongs to, and omits it when absent', () => {
    const lines = renderSelect('How?', choices, 0, PLAIN, 80);
    const browserRow = lines.findIndex((line) => line.includes('In your browser'));
    expect(lines[browserRow + 1]).toContain('Recommended.');
    // The second choice has no hint, so the next line is the rail's own spacer.
    const terminalRow = lines.findIndex((line) => line.includes('Here in the terminal'));
    expect(lines[terminalRow + 1]).toBe(GLYPH.bar);
  });

  it('advertises the keys that work', () => {
    const footer = renderSelect('How?', choices, 0, PLAIN, 80).at(-1) ?? '';
    expect(footer).toContain('↑↓');
    expect(footer).toContain('enter');
  });
});

describe('windowSlice — a picker longer than the terminal', () => {
  // A frame taller than the screen cannot be rewound: the redraw scrolls and
  // the cursor arithmetic then erases whatever took its place.
  it('shows everything when it fits', () => {
    expect(windowSlice(4, 0, 10)).toEqual({ start: 0, end: 4 });
  });

  it('keeps the cursor inside the window as it moves', () => {
    for (let cursor = 0; cursor < 40; cursor += 1) {
      const { start, end } = windowSlice(40, cursor, 6);
      expect(cursor).toBeGreaterThanOrEqual(start);
      expect(cursor).toBeLessThan(end);
      expect(end - start).toBe(6);
    }
  });

  it('clamps at both ends rather than scrolling past them', () => {
    expect(windowSlice(40, 0, 6)).toEqual({ start: 0, end: 6 });
    expect(windowSlice(40, 39, 6)).toEqual({ start: 34, end: 40 });
  });
});

describe('renderMultiSelect', () => {
  const TABLES = ['customers', 'orders', 'products', 'invoices'].map((label) => ({ label }));
  const all = new Set([0, 1, 2, 3]);

  it('separates where you are from what you picked', () => {
    // The difference from a radio menu: the cursor and the ticks move
    // independently, so a row needs both marks.
    const lines = renderMultiSelect('Which tables?', TABLES, 1, new Set([0, 2]), PLAIN, 80, 10);
    expect(lines.some((l) => l.includes(`${GLYPH.checked} customers`))).toBe(true);
    expect(lines.some((l) => l.includes(`${GLYPH.cursor} ${GLYPH.unchecked} orders`))).toBe(true);
    expect(lines.some((l) => l.includes(`${GLYPH.checked} products`))).toBe(true);
    expect(lines.filter((l) => l.includes(GLYPH.cursor))).toHaveLength(1);
  });

  it('counts the selection, because the window hides part of it', () => {
    const lines = renderMultiSelect('Which tables?', TABLES, 0, new Set([0, 2]), PLAIN, 80, 10);
    expect(lines.at(-1)).toContain('2 of 4 selected');
  });

  it('marks how many rows are out of sight, above and below', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ label: `table_${String(i)}` }));
    const lines = renderMultiSelect('Which?', many, 20, new Set([0]), PLAIN, 80, 6).join('\n');
    // Cursor 20 of 40 in a 6-row window: rows 17–22 visible, 17 either side.
    expect(lines).toContain(`${GLYPH.up} 17 more`);
    expect(lines).toContain(`${GLYPH.down} 17 more`);
  });

  it('stops advertising enter when enter would not work', () => {
    const empty = renderMultiSelect('Which tables?', TABLES, 0, new Set(), PLAIN, 80, 10);
    expect(empty.at(-1)).toContain('select at least one');
    expect(empty.at(-1)).not.toContain('enter confirm');
  });

  it('never exceeds the terminal width, rail and marks included', () => {
    const wide = [{ label: 'x'.repeat(200) }];
    for (const line of renderMultiSelect('t'.repeat(200), wide, 0, all, PLAIN, 40, 10)) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });
});

describe('the rail', () => {
  const LOUD = createStyle(true);

  it('hangs prose off a bar, and renders a bare bar for a blank line', () => {
    expect(railLine('hello', PLAIN, 80)).toBe(`${GLYPH.bar}  hello`);
    expect(railLine('', PLAIN, 80)).toBe(GLYPH.bar);
  });

  it('replaces the bar with the glyph that says what kind of step it is', () => {
    expect(railStep(GLYPH.done, 'Meta store ready.', PLAIN, 80)).toBe(
      `${GLYPH.done}  Meta store ready.`,
    );
  });

  it('clips to the terminal BEFORE styling, so escapes are never measured', () => {
    // The invariant `clipText` exists for. Styling first would count the escape
    // codes as visible columns — the line would be clipped far too short, and a
    // cut could land mid-sequence and leak `[36` into the terminal.
    const long = 'x'.repeat(200);
    const plain = railLine(long, PLAIN, 40);
    const styled = railLine(long, LOUD, 40, LOUD.accent);

    expect(plain).toHaveLength(40);
    // Same visible payload under both styles: colour changes bytes, not columns.
    expect(styled).toContain(plain.slice(GLYPH.bar.length + 2));
  });

  it('never lets a menu line exceed the terminal, rail included', () => {
    // renderSelect composes a styled bar with clipped text by hand, so its
    // arithmetic is its own — and it is what the redraw rewinds against.
    const wide = [{ label: 'x'.repeat(200), hint: 'y'.repeat(200) }];
    for (const line of renderSelect('t'.repeat(200), wide, 0, PLAIN, 40)) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it('settles a menu into the question and the answer', () => {
    expect(renderSelectAnswer('How?', 'In your browser', PLAIN, 80)).toEqual([
      `${GLYPH.done}  How?`,
      `${GLYPH.bar}  In your browser`,
    ]);
  });

  it('settles a text prompt the same way, and marks an empty answer', () => {
    expect(renderAskAnswer('Name', 'primary', PLAIN, 80)).toEqual([
      `${GLYPH.done}  Name`,
      `${GLYPH.bar}  primary`,
    ]);
    expect(renderAskAnswer('Name', '', PLAIN, 80)[1]).toBe(`${GLYPH.bar}  —`);
  });
});

describe('wrapText — narration is wrapped, not clipped', () => {
  // The frames a prompt rewinds over are clipped, because a wrapped line would
  // throw the cursor arithmetic out. Narration is never rewound over, so it
  // wraps — the messages carrying a path or a DSN are the longest and the least
  // guessable, and an ellipsis eats exactly the part you needed.
  it('breaks on word boundaries, never exceeding the width', () => {
    const lines = wrapText('the quick brown fox jumps over the lazy dog', 12);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(12);
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog');
  });

  it('leaves a word wider than the rail whole rather than severing it', () => {
    // A cut path or DSN is worse than one that runs on: it looks like a
    // shorter path that does not exist.
    const long = 'sqlite:/var/folders/5x/2n922rc50rd871g82mz038hm0000gn/T/meta.db';
    expect(wrapText(`store at ${long} here`, 20)).toContain(long);
  });

  it('keeps a blank line blank', () => {
    expect(wrapText('', 40)).toEqual(['']);
  });
});

describe('askHint — one line under a text prompt', () => {
  // The prompt is a fixed three lines tall, which is what lets `ask` rewind
  // over itself. Stacking a hint AND a default would make it four and the
  // collapse would leave a stray line behind.
  it('merges the hint and the default into a single line', () => {
    expect(askHint({ hint: 'For example: postgres://…', default: 'primary' })).toBe(
      'For example: postgres://…  ·  enter for primary',
    );
  });

  it('falls back to whichever one is present', () => {
    expect(askHint({ hint: 'For example: x' })).toBe('For example: x');
    expect(askHint({ default: 'primary' })).toBe('enter for primary');
  });

  it('is null when there is nothing to say', () => {
    expect(askHint({})).toBeNull();
  });
});

describe('supportsColor', () => {
  it('honours NO_COLOR regardless of the terminal', () => {
    expect(supportsColor({ NO_COLOR: '1', TERM: 'xterm-256color' })).toBe(false);
  });

  it('takes a dumb terminal at its word', () => {
    expect(supportsColor({ TERM: 'dumb' })).toBe(false);
  });

  it('ignores an empty NO_COLOR, which is how shells spell "unset"', () => {
    // Falls through to the stdout TTY check, which is false under vitest.
    expect(supportsColor({ NO_COLOR: '' })).toBe(process.stdout.isTTY === true);
  });
});

describe('createStyle', () => {
  it('emits nothing when colour is off, so piped output stays clean', () => {
    expect(PLAIN.bold('x')).toBe('x');
    expect(PLAIN.accent('x')).toBe('x');
  });

  it('wraps and resets when colour is on', () => {
    expect(createStyle(true).bold('x')).toBe('\u001b[1mx\u001b[0m');
  });
});

// ── the plumbing ─────────────────────────────────────────────────────────────

/** Written as a code point so no literal ESC byte lands in this file's source. */
const ESC = String.fromCharCode(0x1b);

let restoreTty: (() => void) | null = null;
afterEach(() => {
  restoreTty?.();
  restoreTty = null;
  // `stubEnv` is not undone between tests unless asked. Leaving NO_COLOR set
  // would quietly hand a plain `Style` to whatever suite is appended below.
  vi.unstubAllEnvs();
});

/**
 * Swap `process.stdin`/`process.stdout` for a fake TTY pair.
 *
 * Both are configurable getters, which is the only way to reach `nodeIo`'s raw
 * mode without a pty. The fake stdin is an EventEmitter wearing the four methods
 * `rawSession` calls; the fake stdout just records what it is handed, in order,
 * so a test can ask what was on screen at the instant a key arrived. `NO_COLOR`
 * keeps the frames plain — with styling on, every row carries escape codes and
 * the rewind assertion below would be measuring those too.
 */
function fakeTty(cols = 80): { keys: (chunk: string) => void; screen: () => string } {
  vi.stubEnv('NO_COLOR', '1');
  const real = {
    stdin: Object.getOwnPropertyDescriptor(process, 'stdin') as PropertyDescriptor,
    stdout: Object.getOwnPropertyDescriptor(process, 'stdout') as PropertyDescriptor,
  };
  restoreTty = () => {
    Object.defineProperty(process, 'stdin', real.stdin);
    Object.defineProperty(process, 'stdout', real.stdout);
  };

  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode: () => stdin,
    resume: () => stdin,
    pause: () => stdin,
    setEncoding: () => stdin,
  });
  const written: string[] = [];
  const stdout = { isTTY: true, columns: cols, write: (chunk: string) => written.push(chunk) > 0 };

  Object.defineProperty(process, 'stdin', { configurable: true, value: stdin });
  Object.defineProperty(process, 'stdout', { configurable: true, value: stdout });
  return { keys: (chunk: string) => void stdin.emit('data', chunk), screen: () => written.join('') };
}

describe('nodeIo() rail writers', () => {
  it('wraps a long warning onto the rail instead of clipping it', () => {
    // The embedded-meta-store warning carries an absolute path and is the
    // longest line the wizard prints. Clipped, the ellipsis lands exactly on
    // the path — the one part of the sentence nobody can reconstruct.
    const tty = fakeTty();
    const path = '/var/folders/5x/2n922rc50rd871g82mz038hm0000gn/T/meta.db';
    nodeIo().warn(`Using embedded SQLite meta store at ${path} — set ADMINIUM_META_URL.`);

    const lines = tty.screen().split('\n').filter((line) => line !== '');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
    // Wrapped, not truncated: the path survives intact and nothing is elided.
    expect(tty.screen().replace(/\n[│▲]\s+/g, ' ')).toContain(path);
    expect(tty.screen()).not.toContain('…');
  });

  it('opens, narrates and closes an unbroken rail', () => {
    const tty = fakeTty();
    const io = nodeIo();
    io.intro('Adminium setup');
    io.step('Meta store ready.');
    io.note('Open that URL to continue.');
    io.outro('Ctrl-C to stop.');

    const lines = tty.screen().split('\n').slice(0, -1);
    expect(lines[0]?.startsWith(GLYPH.open)).toBe(true);
    expect(lines.at(-1)?.startsWith(GLYPH.close)).toBe(true);
    // No line floats at column 0 — every one hangs off the rail or a glyph.
    for (const line of lines) {
      expect([GLYPH.open, GLYPH.bar, GLYPH.close, GLYPH.done, GLYPH.warn]).toContain(line[0]);
    }
  });
});

describe('nodeIo().multiselect', () => {
  const TABLES = ['customers', 'orders', 'products'].map((label) => ({ label }));

  it('opens with everything ticked, so nothing is dropped by inaction', async () => {
    const tty = fakeTty();
    const chosen = nodeIo().multiselect('Which tables?', TABLES);

    expect(tty.screen()).toContain(`${GLYPH.checked} customers`);
    tty.keys('\r');
    await expect(chosen).resolves.toEqual([0, 1, 2]);
  });

  it('toggles the row under the cursor with space', async () => {
    const tty = fakeTty();
    const chosen = nodeIo().multiselect('Which tables?', TABLES);

    tty.keys(' ');           // untick customers
    tty.keys(`${ESC}[B`);    // down to orders
    tty.keys(' ');           // untick orders
    tty.keys('\r');
    await expect(chosen).resolves.toEqual([2]);
  });

  it('refuses to close on an empty selection', async () => {
    // An empty result would have to mean "all" or "none" downstream, and both
    // are a guess about what the user meant.
    const tty = fakeTty();
    const chosen = nodeIo().multiselect('Which tables?', TABLES);

    tty.keys('a');           // toggle-all → none ticked
    tty.keys('\r');          // ignored
    expect(tty.screen()).toContain('select at least one');

    tty.keys(' ');           // tick customers
    tty.keys('\r');
    await expect(chosen).resolves.toEqual([0]);
  });

  it('a toggles the whole list both ways', async () => {
    const tty = fakeTty();
    const chosen = nodeIo().multiselect('Which tables?', TABLES);

    tty.keys('a');           // all → none
    tty.keys('a');           // none → all
    tty.keys('\r');
    await expect(chosen).resolves.toEqual([0, 1, 2]);
  });

  it('settles to the answer, not the list', async () => {
    const tty = fakeTty();
    const chosen = nodeIo().multiselect('Which tables?', TABLES);
    tty.keys(' ');
    tty.keys('\r');
    await chosen;
    expect(tty.screen()).toContain(`${GLYPH.done}  Which tables?`);
    expect(tty.screen()).toContain('orders, products');
  });
});

describe('nodeIo() on a terminal that misreports its width', () => {
  // `process.stdout.columns` is 0 on some ptys — notably the one `script`
  // allocates when its own stdout is redirected. Dividing by it made the ask
  // prompt rewind `Infinity` rows, which reached the terminal as a literal
  // `ESC[InfinityA` and left `nfinityA` sitting in the transcript.
  //
  // Driven through a MASKED prompt because that is the one `ask` path that
  // never touches readline — same `rowsFor` arithmetic, no real stream needed.
  it('does not divide by a zero column count', async () => {
    const tty = fakeTty(0);
    const answer = nodeIo().ask('Database password', { mask: true });

    tty.keys('hunter2\r');
    await expect(answer).resolves.toBe('hunter2');

    expect(tty.screen()).not.toContain('Infinity');
    expect(tty.screen()).not.toContain('NaN');
  });

  it('still rewinds by a finite, whole number of rows', async () => {
    const tty = fakeTty(0);
    const answer = nodeIo().ask('Database password', { mask: true });

    tty.keys('hunter2\r');
    await answer;

    // Built rather than written as a literal: an ESC byte inside a regex trips
    // `no-control-regex`, and it is the same escape `ESC` already spells out.
    const rewinds = tty.screen().match(new RegExp(`${ESC}\\[(\\d+)A`, 'g')) ?? [];
    expect(rewinds.length).toBeGreaterThan(0);
  });

  it('never echoes a masked answer into the scrollback', async () => {
    // The whole point of `mask`: the value must not survive the collapse.
    const tty = fakeTty();
    const answer = nodeIo().ask('Database password', { mask: true });

    tty.keys('hunter2\r');
    await expect(answer).resolves.toBe('hunter2');
    expect(tty.screen()).not.toContain('hunter2');
    expect(tty.screen()).toContain('•');
  });
});

describe('nodeIo().select — when the menu reaches the terminal', () => {
  const CHOICES = [
    { label: 'In your browser', hint: 'Recommended.' },
    { label: 'Here in the terminal', hint: 'Good over SSH.' },
  ];

  it('paints the menu before any key is pressed', async () => {
    // THE REGRESSION. `select` used to hide the cursor and then write nothing
    // at all until a key arrived, so `npx @adminiumjs/adminium` sat on a blank
    // screen: no question, no options, no cursor, nothing to suggest it wanted
    // input. Painting is synchronous up to the first await, so the frame is
    // already on screen the moment `select` hands back its promise.
    const tty = fakeTty();
    const answer = nodeIo().select('How would you like to set this up?', CHOICES);

    expect(tty.screen()).toContain('How would you like to set this up?');
    expect(tty.screen()).toContain('1. In your browser');
    expect(tty.screen()).toContain('2. Here in the terminal');

    tty.keys('\r');
    await expect(answer).resolves.toBe(0);
  });

  it('shows the keys that work before asking anyone to press one', async () => {
    // The other half of the same bug: the footer is the ONLY place the arrow
    // keys are advertised, so painting it in response to an arrow key taught
    // nobody anything they had not already worked out.
    const tty = fakeTty();
    const answer = nodeIo().select('How?', CHOICES);

    expect(tty.screen()).toContain('↑↓ move · number to jump · enter to select');

    tty.keys('\r');
    await answer;
  });

  it('has the highlighted row on screen before Enter can accept it', async () => {
    // An unpainted menu still answered: Enter as the first keystroke picked a
    // row the user had never been shown. Same answer now, but visibly.
    const tty = fakeTty();
    const answer = nodeIo().select('How?', CHOICES, { defaultIndex: 1 });

    expect(tty.screen()).toContain(`${GLYPH.on} 2. Here in the terminal`);

    tty.keys('\r');
    await expect(answer).resolves.toBe(1);
  });

  it('rewinds the first frame rather than stacking a second one under it', async () => {
    // The missing paint also left `painted` at 0, so the first arrow key
    // appended a second menu below the first instead of redrawing in place.
    const tty = fakeTty();
    const height = renderSelect('How?', CHOICES, 0, PLAIN, 79).length;
    const answer = nodeIo().select('How?', CHOICES);

    tty.keys(`${ESC}[B`);
    expect(tty.screen()).toContain(`${ESC}[${String(height)}A`);
    expect(tty.screen().split('↑↓ move').length - 1).toBe(2); // painted, then repainted

    tty.keys('\r');
    await expect(answer).resolves.toBe(1);
  });
});
