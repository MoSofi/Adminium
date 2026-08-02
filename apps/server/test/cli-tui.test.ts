/**
 * The TUI primitives (`src/cli/io.ts`).
 *
 * Everything decision-shaped in the raw-mode prompts is a pure function —
 * `decodeKeys` turns a stdin chunk into key events, `renderSelect` turns state
 * into lines — precisely so the menu can be tested without a pty. What is left
 * inside `nodeIo` is the plumbing those two describe: write the lines, move the
 * cursor back up by `lines.length`.
 */
import { describe, expect, it } from 'vitest';

import { clipText, createStyle, decodeKeys, renderSelect, supportsColor } from '../src/cli/io.js';

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
    expect(lines.filter((line) => line.startsWith('❯'))).toHaveLength(1);
    expect(lines.some((line) => line.startsWith('❯ 1. In your browser'))).toBe(true);

    const moved = renderSelect('How?', choices, 1, PLAIN, 80);
    expect(moved.some((line) => line.startsWith('❯ 2. Here in the terminal'))).toBe(true);
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
    // The second choice has no hint, so the next line is the blank spacer.
    const terminalRow = lines.findIndex((line) => line.includes('Here in the terminal'));
    expect(lines[terminalRow + 1]).toBe('');
  });

  it('never emits a line wider than the terminal', () => {
    // This is what makes the redraw safe: `select` rewinds by exactly
    // lines.length, which is only the painted height if nothing wrapped.
    const wide = [{ label: 'x'.repeat(200), hint: 'y'.repeat(200) }];
    for (const line of renderSelect('t'.repeat(200), wide, 0, PLAIN, 40)) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it('advertises the keys that work', () => {
    const footer = renderSelect('How?', choices, 0, PLAIN, 80).at(-1) ?? '';
    expect(footer).toContain('↑↓');
    expect(footer).toContain('enter');
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
