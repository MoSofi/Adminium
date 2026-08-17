// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CLI input/output seam.
 *
 * Every byte the CLI prints and every answer it reads goes through {@link CliIo},
 * so the whole surface — including the init wizard's interactive prompts — is
 * driven by a scripted fake in tests: no TTY, no spawned process, no timers.
 * {@link nodeIo} is the only place that touches `process.stdout`/`stdin`.
 *
 * ── WHY THERE ARE TWO INPUT MECHANISMS ──────────────────────────────────────
 * `ask` keeps `readline`, because a connection string is the longest, most
 * error-prone thing anyone types into this program and readline is what makes
 * paste, ⌘←/→, and mid-line correction work. `select` and masked `ask` use raw
 * mode instead, because neither is expressible in readline at all: readline
 * cannot report an arrow key, and it cannot suppress echo. The two never run at
 * once — {@link closeReadline} tears the interface down before a raw session
 * takes stdin, and the next `ask` lazily builds a fresh one.
 *
 * Raw mode also means SIGINT is no longer delivered by the terminal, so `\u0003`
 * is decoded here and raised as {@link CliCancelled}. Without that, Ctrl-C — which
 * the wizard's own header advertises — would do nothing at a select prompt.
 */

import { createInterface } from 'node:readline/promises';

import { CliError } from './exit.js';

/** Ctrl-C (or Ctrl-D) at a raw-mode prompt. Raised so the terminal is restored
 *  on the way out; the dispatcher prints the message and exits non-zero. */
export class CliCancelled extends CliError {
  constructor() {
    super('Cancelled.');
  }
}

export interface AskOptions {
  /** Returned when the user just presses Enter. */
  default?: string;
  /** Suppress echo (passwords). Falls back to echoing on a non-TTY. */
  mask?: boolean;
  /** A dimmed line printed above the prompt — where to find the value, an example. */
  hint?: string;
  /**
   * Reject an answer without unwinding the wizard: return an error message to
   * re-ask, or `null` to accept. Runs before the value is returned, so callers
   * never have to write their own `for (;;)` retry loop.
   */
  validate?: (answer: string) => string | null;
}

/** How a rail line is emphasised. Anything richer belongs in its own glyph. */
export type Tone = 'dim' | 'bold';

/** One row of a {@link CliIo.select} menu. */
export interface SelectChoice {
  label: string;
  /** An indented, dimmed second line — the trade-off behind the choice. */
  hint?: string;
}

export interface SelectOptions {
  /** Pre-highlighted row, and the answer Enter gives on a non-TTY. */
  defaultIndex?: number;
}

export interface MultiSelectOptions {
  /** Rows ticked when the prompt opens. Defaults to all of them. */
  selected?: readonly number[];
  /** Rows visible at once; the list scrolls inside this window. */
  window?: number;
}

export interface CliIo {
  /** Write a line to stdout. */
  out(line?: string): void;
  /** Write a line to stderr — errors and warnings only, so stdout stays pipeable. */
  err(line?: string): void;

  // ── the rail ───────────────────────────────────────────────────────────────
  // Interactive flows only. The reporting subcommands keep using `out`/`err`,
  // whose output is piped into files and other programs — a decorative bar down
  // the left margin of `migrate --status` would be actively in the way.

  /** Open the rail under a title chip. */
  intro(title: string): void;
  /** A settled step: `◇ text`, in bold. */
  step(text: string): void;
  /**
   * Prose on the rail: `│ text`, or a bare `│` for a blank line. Callers pass
   * PLAIN text and name a tone — styling before the rail sees it would put
   * escape codes inside the width arithmetic (see {@link clipText}).
   */
  note(text?: string, tone?: Tone): void;
  /** Something worth reading that did not stop the run: `▲ text`. */
  warn(text: string): void;
  /** Close the rail: `└ text`. */
  outro(text: string): void;
  /** Prompt for a line of input. */
  ask(question: string, opts?: AskOptions): Promise<string>;
  /** Prompt for a yes/no. */
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  /** Pick one of `choices` with the arrow keys; resolves to the chosen index. */
  select(title: string, choices: readonly SelectChoice[], opts?: SelectOptions): Promise<number>;
  /**
   * Tick any number of `choices`; resolves to the chosen indices, ascending.
   * Never resolves empty — the prompt refuses to close on an empty selection
   * rather than returning one the caller has to second-guess.
   */
  multiselect(
    title: string,
    choices: readonly SelectChoice[],
    opts?: MultiSelectOptions,
  ): Promise<number[]>;
  /** True when stdin is interactive — gates the wizard. */
  isInteractive: boolean;
  /** True when the terminal can host a redrawing menu (raw mode + a TTY stdout). */
  supportsTui: boolean;
  /** Release any underlying readline handle. */
  close(): Promise<void>;
}

/** Bold/dim helpers that no-op when stdout is not a TTY (pipes stay clean). */
export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  ok(text: string): string;
  warn(text: string): string;
  danger(text: string): string;
  /** The selection highlight — cyan, distinct from `ok`'s success green. */
  accent(text: string): string;
  /** Inverse-video chip — the wizard's title, so the rail has a head to hang from. */
  badge(text: string): string;
}

export function createStyle(color: boolean): Style {
  const wrap = (open: string) => (text: string) => (color ? `\u001b[${open}m${text}\u001b[0m` : text);
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    ok: wrap('32'),
    warn: wrap('33'),
    danger: wrap('31'),
    accent: wrap('36'),
    // Cyan ground, black ink — legible on both light and dark terminals, where
    // a bold cyan foreground washes out on light ones.
    badge: wrap('46;30'),
  };
}

/**
 * Whether to emit ANSI at all. `NO_COLOR` is honored (no-color.org) and a
 * `dumb` terminal is taken at its word; everything else follows stdout's TTY-ness.
 */
export function supportsColor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.TERM === 'dumb') return false;
  return process.stdout.isTTY === true;
}

// ── key decoding ─────────────────────────────────────────────────────────────

/** The key events the raw-mode prompts react to. Everything else is dropped. */
export type Key =
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'enter' }
  | { kind: 'abort' }
  | { kind: 'backspace' }
  | { kind: 'clear-line' }
  | { kind: 'char'; value: string };

const CSI_FINAL = /[A-Za-z~]/;

/**
 * Decode one raw-mode stdin chunk into key events.
 *
 * A chunk is not a keystroke: a paste arrives as one chunk of many characters,
 * and an arrow key arrives as the three bytes `ESC [ A`. Both are handled by
 * walking the chunk, which is why this is a pure function over a string rather
 * than a switch on `chunk[0]` — the latter silently drops pasted passwords past
 * the first character.
 *
 * Unrecognized escape sequences (function keys, mouse reports, bracketed-paste
 * markers) are swallowed through their final byte so their payload can never be
 * mistaken for typed text.
 */
export function decodeKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  for (let i = 0; i < chunk.length; i += 1) {
    const ch = chunk[i] as string;

    if (ch === '\u001b') {
      const intro = chunk[i + 1];
      if (intro === '[' || intro === 'O') {
        const code = chunk[i + 2];
        if (code === 'A') {
          keys.push({ kind: 'up' });
          i += 2;
          continue;
        }
        if (code === 'B') {
          keys.push({ kind: 'down' });
          i += 2;
          continue;
        }
        let j = i + 2;
        while (j < chunk.length && !CSI_FINAL.test(chunk[j] as string)) j += 1;
        i = j;
        continue;
      }
      continue; // a bare ESC — ignored rather than treated as cancel
    }

    if (ch === '\r' || ch === '\n') {
      keys.push({ kind: 'enter' });
      continue;
    }
    if (ch === '\u0003' || ch === '\u0004') {
      keys.push({ kind: 'abort' });
      continue;
    }
    if (ch === '\u007f' || ch === '\b') {
      keys.push({ kind: 'backspace' });
      continue;
    }
    if (ch === '\u0015') {
      keys.push({ kind: 'clear-line' });
      continue;
    }
    if (ch < ' ') continue; // remaining control bytes carry no meaning here
    keys.push({ kind: 'char', value: ch });
  }
  return keys;
}

// ── menu rendering ───────────────────────────────────────────────────────────

/** Truncate to `width` visible columns. Called BEFORE styling, so the escape
 *  codes a style adds can never be counted as — or cut in half by — the clip. */
export function clipText(text: string, width: number): string {
  if (width <= 1 || text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

// ── the rail ─────────────────────────────────────────────────────────────────

/**
 * The wizard's visual grammar: one continuous vertical rail down the left
 * margin, with a glyph per step hanging off it.
 *
 * Before this, every line the wizard printed started at column 0 — questions,
 * answers, progress and prose all at the same weight, so a seven-step flow read
 * as an undifferentiated transcript and there was no way to see at a glance
 * which lines were decisions you had made and which were the program talking.
 * The rail supplies that: `◇` is settled, `◆` is where you are, `▲` wants
 * attention, and the bar between them makes the whole run one object rather
 * than N unrelated paragraphs.
 *
 * These are the box-drawing and geometric-shape glyphs, which the same
 * terminals that already render this file's `❯` and `↑↓` handle — there is no
 * ASCII fallback here for the same reason there is none for those.
 */
export const GLYPH = {
  /** Opens the rail. */
  open: '┌',
  /** The rail itself. */
  bar: '│',
  /** Closes it. */
  close: '└',
  /** The step you are being asked about now. */
  active: '◆',
  /** A step that is settled. */
  done: '◇',
  /** Something the run should know about but which did not stop it. */
  warn: '▲',
  /** A step that failed, or a run that was cancelled. */
  fail: '■',
  /** Radio, selected / not. */
  on: '●',
  off: '○',
  /** Checkbox, ticked / not — a multi-select is a different question from a
   *  radio, and looking different is how you know space toggles rather than
   *  enter deciding. */
  checked: '◼',
  unchecked: '◻',
  /** The row the keyboard is on, in a list where selection is not position. */
  cursor: '❯',
  /** More rows above / below the window. */
  up: '↑',
  down: '↓',
} as const;

/**
 * Visible columns a glyph column costs: the glyph plus its two-space gutter.
 * Every clip below subtracts this (or a multiple) so a styled line still
 * measures its true width — see {@link clipText}.
 */
const GUTTER = 3;

/**
 * Styling is applied by `decorate`, AFTER the clip, for the reason
 * {@link clipText} exists: a styled string measures its escape codes as visible
 * columns, so clipping one both mis-counts the width and can sever a code
 * mid-sequence. The glyph is exempt — it is prepended, never clipped, and is
 * one visible column whatever colour it carries.
 */
type Decorate = (text: string) => string;

const PLAIN_DECORATE: Decorate = (text) => text;

/** `│  text` — prose hanging off the rail. A bare bar when there is no text. */
export function railLine(
  text: string,
  style: Style,
  width: number,
  decorate: Decorate = PLAIN_DECORATE,
): string {
  const bar = style.dim(GLYPH.bar);
  return text === '' ? bar : `${bar}  ${decorate(clipText(text, width - GUTTER))}`;
}

/**
 * `<glyph>  text` — the head of a step, where the rail's own bar is replaced by
 * the glyph saying what kind of step it is.
 */
export function railStep(
  glyph: string,
  text: string,
  style: Style,
  width: number,
  decorate: Decorate = PLAIN_DECORATE,
): string {
  return `${glyph}  ${decorate(clipText(text, width - GUTTER))}`;
}

/**
 * Break `text` into rail-width lines on word boundaries.
 *
 * The clipping renderers above serve the frames a prompt rewinds over, where a
 * line that wrapped would throw the cursor arithmetic out and the redraw would
 * eat whatever sat above it. Nothing rewinds over narration, so narration wraps
 * instead of losing its tail to an ellipsis — which matters most for the
 * messages carrying a path or a DSN, the longest and least guessable of them.
 *
 * A word wider than the rail is left whole rather than broken mid-token: a
 * severed path is worse than one that runs on.
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 1 || text === '') return [text];
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

const FOOTER = '↑↓ move · number to jump · enter to select';

/**
 * The menu, as an array of lines.
 *
 * Returning lines rather than writing them is what makes the redraw arithmetic
 * safe: `select` moves the cursor up by exactly `lines.length`, which is only
 * true if nothing wraps — hence every line is clipped to the terminal width
 * here, at the one place that knows the final text.
 */
export function renderSelect(
  title: string,
  choices: readonly SelectChoice[],
  active: number,
  style: Style,
  width: number,
): string[] {
  const bar = style.dim(GLYPH.bar);
  // `│` + two spaces + the radio + one space — the column the labels start in,
  // and what their hints indent to match.
  const rowWidth = width - GUTTER - 2;
  const lines: string[] = [
    railStep(style.accent(GLYPH.active), title, style, width, style.bold),
    bar,
  ];
  choices.forEach((choice, i) => {
    const selected = i === active;
    // The radio is what carries the selection at a glance; the number is kept
    // because jumping by number is a real key here, not decoration.
    const radio = selected ? style.accent(GLYPH.on) : style.dim(GLYPH.off);
    const label = clipText(`${String(i + 1)}. ${choice.label}`, rowWidth);
    lines.push(`${bar}  ${radio} ${selected ? style.accent(label) : label}`);
    if (choice.hint !== undefined) {
      lines.push(`${bar}    ${style.dim(clipText(choice.hint, rowWidth))}`);
    }
  });
  lines.push(bar);
  lines.push(railLine(FOOTER, style, width, style.dim));
  return lines;
}

/**
 * The slice of a long list to show, keeping `cursor` inside it.
 *
 * A picker over a real database is 40+ rows, and a frame taller than the
 * terminal cannot be rewound — the redraw would scroll and the cursor
 * arithmetic would erase the wrong lines. Windowing bounds the frame instead:
 * the list scrolls under a fixed viewport, cursor kept roughly centred so
 * there is always context on both sides.
 */
export function windowSlice(
  total: number,
  cursor: number,
  size: number,
): { start: number; end: number } {
  if (size >= total) return { start: 0, end: total };
  const half = Math.floor(size / 2);
  const start = Math.min(Math.max(cursor - half, 0), total - size);
  return { start, end: start + size };
}

const MULTI_FOOTER = '↑↓ move · space toggle · a all · enter confirm';

/**
 * Lines {@link renderMultiSelect} spends on chrome rather than rows: the
 * question, two bars, the footer, and the two "N more" markers — plus one of
 * slack, because a frame that exactly fills the terminal scrolls the moment
 * anything follows it, and a scrolled frame cannot be rewound.
 */
const CHROME_ROWS = 8;

/**
 * The checkbox picker.
 *
 * Selection is not position here — the cursor and the ticks are independent,
 * which is the whole difference from {@link renderSelect} and why the row
 * carries both a `❯` for where you are and a `◼`/`◻` for what you chose. The
 * counter is not decoration either: with the list windowed, it is the only way
 * to know what is ticked out of sight.
 */
export function renderMultiSelect(
  title: string,
  choices: readonly SelectChoice[],
  cursor: number,
  selected: ReadonlySet<number>,
  style: Style,
  width: number,
  size: number,
): string[] {
  const bar = style.dim(GLYPH.bar);
  const rowWidth = width - GUTTER - 4;
  const { start, end } = windowSlice(choices.length, cursor, size);
  const lines: string[] = [
    railStep(style.accent(GLYPH.active), title, style, width, style.bold),
    bar,
  ];

  if (start > 0) {
    lines.push(`${bar}    ${style.dim(clipText(`${GLYPH.up} ${String(start)} more`, rowWidth))}`);
  }
  for (let i = start; i < end; i += 1) {
    const choice = choices[i] as SelectChoice;
    const here = i === cursor;
    const ticked = selected.has(i);
    const box = ticked ? style.ok(GLYPH.checked) : style.dim(GLYPH.unchecked);
    const label = clipText(choice.label, rowWidth);
    lines.push(
      `${bar}  ${here ? style.accent(GLYPH.cursor) : ' '} ${box} ${here ? style.accent(label) : label}`,
    );
  }
  if (end < choices.length) {
    const rest = choices.length - end;
    lines.push(`${bar}    ${style.dim(clipText(`${GLYPH.down} ${String(rest)} more`, rowWidth))}`);
  }

  lines.push(bar);
  // An empty selection is the one state enter will not accept, so the footer
  // stops advertising a key that does nothing and says why instead.
  lines.push(
    selected.size === 0
      ? railLine('↑↓ move · space toggle · a all · select at least one', style, width, style.warn)
      : railLine(
          `${MULTI_FOOTER}  ·  ${String(selected.size)} of ${String(choices.length)} selected`,
          style,
          width,
          style.dim,
        ),
  );
  return lines;
}

/**
 * The settled form of a menu: the question, the answer, and the rail carrying
 * on. Replaces the live frame on submit so scrollback is a list of decisions
 * rather than every option that was ever on offer.
 */
export function renderSelectAnswer(
  title: string,
  label: string,
  style: Style,
  width: number,
): string[] {
  return [
    railStep(style.ok(GLYPH.done), title, style, width, style.bold),
    railLine(label, style, width, style.dim),
  ];
}

/**
 * The one line under a text prompt: what to type, and what Enter gives if you
 * type nothing. Merged rather than stacked so the prompt is always exactly
 * three lines tall — which is what lets {@link CliIo.ask} rewind over itself.
 */
export function askHint(opts: Pick<AskOptions, 'hint' | 'default'>): string | null {
  if (opts.default === undefined) return opts.hint ?? null;
  const fallback = `enter for ${opts.default}`;
  return opts.hint === undefined ? fallback : `${opts.hint}  ·  ${fallback}`;
}

/** The settled form of a text prompt. See {@link renderSelectAnswer}. */
export function renderAskAnswer(
  question: string,
  answer: string,
  style: Style,
  width: number,
): string[] {
  return [
    railStep(style.ok(GLYPH.done), question, style, width, style.bold),
    railLine(answer === '' ? '—' : answer, style, width, style.dim),
  ];
}

// ── the real IO ──────────────────────────────────────────────────────────────

const CURSOR_HIDE = '\u001b[?25l';
const CURSOR_SHOW = '\u001b[?25h';
/** Move up n lines, then erase from the cursor to the end of the screen. */
const rewind = (n: number): string => (n === 0 ? '' : `\u001b[${String(n)}A\u001b[0J`);

/**
 * The real IO. `readline` is created lazily: `adminium start` never prompts, and
 * opening an interface would keep the event loop alive for no reason.
 */
export function nodeIo(): CliIo {
  let rl: ReturnType<typeof createInterface> | null = null;
  const readline = (): ReturnType<typeof createInterface> => {
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    return rl;
  };
  /** Raw mode and readline cannot both own stdin — drop the interface first. */
  const closeReadline = (): void => {
    rl?.close();
    rl = null;
  };

  const style = createStyle(supportsColor());

  /**
   * The terminal's width, defended.
   *
   * `process.stdout.columns` is `undefined` off a TTY, and on some ptys — the
   * one `script` allocates when its own output is redirected, for instance —
   * it is reported as 0. That zero divided straight through the ask prompt's
   * row arithmetic and wrote a literal `ESC[InfinityA` into the terminal:
   * garbage on screen, and a collapse that erased nothing. Anything
   * non-positive is not a terminal size, so fall back rather than propagate it.
   */
  const columns = (): number => {
    const reported = process.stdout.columns;
    return reported === undefined || reported <= 0 ? 80 : reported;
  };
  /** One short of the true width, so a full-width line cannot trigger a wrap. */
  const width = (): number => columns() - 1;
  /** The terminal's height, defended the same way. Bounds the picker's window. */
  const rows = (): number => {
    const reported = process.stdout.rows;
    return reported === undefined || reported <= 0 ? 24 : reported;
  };

  /** Can stdin be put in raw mode — i.e. can we read a keystroke at all? */
  const rawCapable = (): boolean =>
    process.stdin.isTTY === true && typeof process.stdin.setRawMode === 'function';

  /**
   * Can we host a REDRAWING menu? Raw stdin is necessary but not sufficient: the
   * menu rewinds the cursor over stdout, so a piped stdout (`adminium | tee
   * setup.log`) would receive a transcript of cursor-movement escapes instead of
   * a readable log. `select` and `init` must agree on this exact predicate, or
   * the wizard skips the front-door question for a terminal that then gets an
   * ANSI menu anyway.
   */
  const tuiCapable = (): boolean =>
    rawCapable() && process.stdout.isTTY === true && process.env.TERM !== 'dumb';

  /**
   * Own stdin in raw mode for the life of one prompt. `handler` is called per
   * decoded key and calls `done` to resolve; the terminal is restored on every
   * exit path, including the Ctrl-C rejection.
   */
  const rawSession = <T>(
    handler: (key: Key, done: (value: T) => void) => void,
  ): Promise<T> => {
    closeReadline();
    return new Promise<T>((resolve, reject) => {
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      let settled = false;
      const teardown = (): void => {
        settled = true;
        stdin.off('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
      };
      const onData = (chunk: string): void => {
        for (const key of decodeKeys(chunk)) {
          if (settled) return;
          if (key.kind === 'abort') {
            teardown();
            process.stdout.write(`${CURSOR_SHOW}\n`);
            reject(new CliCancelled());
            return;
          }
          handler(key, (value) => {
            teardown();
            resolve(value);
          });
        }
      };
      stdin.on('data', onData);
    });
  };

  /** The numbered prompt the TUI degrades to — pipes, CI, `TERM=dumb`. */
  const selectByNumber = async (
    title: string,
    choices: readonly SelectChoice[],
    defaultIndex: number,
  ): Promise<number> => {
    process.stdout.write(`\n${title}\n`);
    choices.forEach((choice, i) => {
      process.stdout.write(`  ${String(i + 1)}) ${choice.label}\n`);
      if (choice.hint !== undefined) process.stdout.write(`     ${choice.hint}\n`);
    });
    for (;;) {
      const suffix = ` [${String(defaultIndex + 1)}]`;
      const raw = (await readline().question(`Choose${suffix}: `)).trim();
      const index = (raw === '' ? defaultIndex + 1 : Number(raw)) - 1;
      if (Number.isInteger(index) && index >= 0 && index < choices.length) return index;
      process.stderr.write(`Enter a number between 1 and ${String(choices.length)}.\n`);
    }
  };

  /**
   * The numbered fallback for the checkbox picker — pipes, CI, `TERM=dumb`.
   *
   * No redraw is possible there, so the list is printed once and narrowed by
   * typing numbers. Blank keeps the pre-ticked set, which for the wizard is
   * every table, so the degraded path still has a one-keystroke "all".
   */
  const multiselectByNumber = async (
    title: string,
    choices: readonly SelectChoice[],
    selected: ReadonlySet<number>,
  ): Promise<number[]> => {
    process.stdout.write(`\n${title}\n`);
    choices.forEach((choice, i) => {
      process.stdout.write(`  ${selected.has(i) ? '[x]' : '[ ]'} ${String(i + 1)}) ${choice.label}\n`);
    });
    for (;;) {
      const raw = (
        await readline().question('Numbers to include, comma-separated (blank = keep): ')
      ).trim();
      if (raw === '') return [...selected].sort((a, b) => a - b);
      const picked = raw
        .split(',')
        .map((entry) => Number(entry.trim()) - 1)
        .filter((i) => Number.isInteger(i) && i >= 0 && i < choices.length);
      if (picked.length > 0) return [...new Set(picked)].sort((a, b) => a - b);
      process.stderr.write(`Enter numbers between 1 and ${String(choices.length)}.\n`);
    }
  };

  /** Masked line editor. Passwords are short, so there is no mid-line editing —
   *  only append, backspace and Ctrl-U, which is what readline cannot give us. */
  const askMasked = async (prompt: string): Promise<string> => {
    process.stdout.write(prompt);
    let value = '';
    const answer = await rawSession<string>((key, done) => {
      switch (key.kind) {
        case 'enter':
          process.stdout.write('\n');
          done(value);
          return;
        case 'backspace':
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          return;
        case 'clear-line':
          process.stdout.write('\b \b'.repeat(value.length));
          value = '';
          return;
        case 'char':
          value += key.value;
          process.stdout.write('•');
          return;
        default:
          return; // arrows carry no meaning in a masked field
      }
    });
    return answer;
  };

  /** The rail's bar, written on its own line — the spacer between every step. */
  const writeBar = (): void => {
    process.stdout.write(`${style.dim(GLYPH.bar)}\n`);
  };

  /**
   * Write narration onto the rail, wrapped. `glyph` heads the first line and
   * the rest hang off the bar, so a message too long for the terminal stays
   * readable instead of being clipped to an ellipsis.
   */
  const writeWrapped = (glyph: string | null, text: string, decorate: Decorate): void => {
    const rows = wrapText(text, width() - GUTTER);
    rows.forEach((row, i) => {
      const line =
        i === 0 && glyph !== null
          ? railStep(glyph, row, style, width(), decorate)
          : railLine(row, style, width(), decorate);
      process.stdout.write(`${line}\n`);
    });
  };

  /**
   * Rows a written line actually occupies once the terminal wraps it.
   *
   * Everything this module paints is clipped to fit, so only the line the USER
   * types into can exceed one row — and a connection string in an 80-column
   * terminal routinely does. Wrapping is measured against the true column count
   * (not `width()`, which is one short by design) because getting this wrong
   * rewinds over a step above the prompt and eats it.
   */
  const rowsFor = (visibleLength: number): number => Math.max(1, Math.ceil(visibleLength / columns()));

  /**
   * The plain text prompt — pipes, CI, `TERM=dumb`. Byte-for-byte what this
   * did before the rail existed: no cursor movement, hint above, complaints on
   * stderr. A redrawing prompt cannot be piped into a file and still be read.
   */
  const askPlain = async (question: string, opts: AskOptions): Promise<string> => {
    for (;;) {
      if (opts.hint !== undefined) process.stdout.write(`${style.dim(opts.hint)}\n`);

      let answer: string;
      if (opts.mask === true && rawCapable()) {
        answer = (await askMasked(`${question}: `)).trim();
      } else {
        const suffix = opts.default === undefined ? '' : ` [${opts.default}]`;
        answer = (await readline().question(`${question}${suffix}: `)).trim();
      }
      if (answer === '') answer = opts.default ?? '';

      const problem = opts.validate?.(answer) ?? null;
      if (problem === null) return answer;
      process.stderr.write(`${style.danger(problem)}\n`);
    }
  };

  /**
   * The rail version: question, hint, then your answer typed onto the bar —
   * collapsing on submit to `◇ question / │ answer`, so a finished wizard reads
   * as the list of decisions rather than the questions that produced them.
   *
   * `rows` counts every line painted since the question first appeared,
   * INCLUDING re-asks after a validation complaint, because the collapse has to
   * erase the whole conversation about one field, not just its last turn.
   */
  const askOnRail = async (question: string, opts: AskOptions): Promise<string> => {
    let rows = 0;
    const line = (text: string): void => {
      process.stdout.write(`${text}\n`);
      rows += 1;
    };

    for (;;) {
      line(railStep(style.accent(GLYPH.active), question, style, width(), style.bold));
      const hint = askHint(opts);
      if (hint !== null) line(railLine(hint, style, width(), style.dim));
      line(railLine('', style, width()));

      const prompt = `${style.dim(GLYPH.bar)}  `;
      const masked = opts.mask === true && rawCapable();
      const typed = masked ? await askMasked(prompt) : await readline().question(prompt);
      rows += rowsFor(GUTTER + typed.length);

      let answer = typed.trim();
      if (answer === '') answer = opts.default ?? '';

      const problem = opts.validate?.(answer) ?? null;
      if (problem === null) {
        // A masked field is echoed as bullets and settles as bullets — the
        // whole point of `mask` is that the value never reaches the scrollback.
        const shown = masked ? '•'.repeat(answer.length) : answer;
        const settled = renderAskAnswer(question, shown, style, width());
        process.stdout.write(`${rewind(rows)}${settled.join('\n')}\n`);
        writeBar();
        return answer;
      }
      line(railStep(style.warn(GLYPH.warn), problem, style, width(), style.warn));
    }
  };

  return {
    out(line = '') {
      process.stdout.write(`${line}\n`);
    },
    err(line = '') {
      process.stderr.write(`${line}\n`);
    },

    intro(title) {
      process.stdout.write(`${style.dim(GLYPH.open)}  ${style.badge(` ${title} `)}\n`);
      writeBar();
    },
    step(text) {
      writeWrapped(style.ok(GLYPH.done), text, style.bold);
      writeBar();
    },
    note(text = '', tone) {
      const decorate = tone === 'dim' ? style.dim : tone === 'bold' ? style.bold : PLAIN_DECORATE;
      if (text === '') {
        writeBar();
        return;
      }
      writeWrapped(null, text, decorate);
    },
    warn(text) {
      writeWrapped(style.warn(GLYPH.warn), text, style.warn);
      writeBar();
    },
    outro(text) {
      process.stdout.write(
        `${railStep(style.dim(GLYPH.close), text, style, width(), style.bold)}\n`,
      );
    },

    async ask(question, opts = {}) {
      return tuiCapable() ? askOnRail(question, opts) : askPlain(question, opts);
    },

    async confirm(question, defaultYes = true) {
      const suffix = defaultYes ? '[Y/n]' : '[y/N]';
      const answer = (
        await (tuiCapable()
          ? askOnRail(`${question} ${suffix}`, {})
          : readline().question(`${question} ${suffix}: `))
      )
        .trim()
        .toLowerCase();
      if (answer === '') return defaultYes;
      return answer === 'y' || answer === 'yes';
    },

    async select(title, choices, opts = {}) {
      if (choices.length === 0) throw new CliError('Nothing to choose from.');
      const initial = Math.min(Math.max(opts.defaultIndex ?? 0, 0), choices.length - 1);
      if (!tuiCapable()) return selectByNumber(title, choices, initial);

      closeReadline();
      let active = initial;
      let painted = 0;
      const paint = (): void => {
        const lines = renderSelect(title, choices, active, style, width());
        process.stdout.write(`${rewind(painted)}${lines.join('\n')}\n`);
        painted = lines.length;
      };

      // No leading blank line: the previous step left a trailing bar, and the
      // rail has to run unbroken from it into this prompt.
      process.stdout.write(CURSOR_HIDE);
      try {
        // The first frame is painted BEFORE a key can arrive. Painting only
        // from the key handler left the prompt invisible until the user
        // happened to press an arrow — with the cursor hidden and no menu, the
        // wizard looked hung, and an immediate Enter answered a question that
        // had never been displayed. The footer this paints is also the only
        // place the arrow keys are advertised, so the menu that teaches you to
        // move has to be on screen before you are asked to move.
        paint();
        const chosen = await rawSession<number>((key, done) => {
          switch (key.kind) {
            case 'up':
              active = (active - 1 + choices.length) % choices.length;
              paint();
              return;
            case 'down':
              active = (active + 1) % choices.length;
              paint();
              return;
            case 'char': {
              // `j`/`k` are decoded as text, not motion, because `decodeKeys` is
              // shared with the masked-password editor — a decoder that turned
              // them into arrows would silently swallow every j and k anyone
              // typed into a password. Motion is a property of THIS prompt.
              if (key.value === 'k') {
                active = (active - 1 + choices.length) % choices.length;
                paint();
                return;
              }
              if (key.value === 'j') {
                active = (active + 1) % choices.length;
                paint();
                return;
              }
              // Number keys jump straight to a row — the muscle memory of every
              // numbered menu that came before this one still works.
              const index = Number(key.value) - 1;
              if (Number.isInteger(index) && index >= 0 && index < choices.length) {
                active = index;
                paint();
              }
              return;
            }
            case 'enter':
              done(active);
              return;
            default:
              return;
          }
        });
        // Collapse the menu to the question and its answer: scrollback stays a
        // readable transcript of the decisions rather than a wall of options.
        const label = choices[chosen]?.label ?? '';
        const settled = renderSelectAnswer(title, label, style, width());
        process.stdout.write(`${rewind(painted)}${settled.join('\n')}\n`);
        writeBar();
        return chosen;
      } finally {
        process.stdout.write(CURSOR_SHOW);
      }
    },

    async multiselect(title, choices, opts = {}) {
      if (choices.length === 0) throw new CliError('Nothing to choose from.');
      const selected = new Set<number>(opts.selected ?? choices.map((_, i) => i));
      // A window taller than the terminal cannot be rewound: the frame would
      // scroll and the redraw would erase whatever scrolled up in its place.
      // Six lines of chrome sit around the rows (question, bars, footer, the
      // two "N more" markers), hence the headroom.
      const size = Math.max(3, Math.min(opts.window ?? 10, rows() - CHROME_ROWS));

      if (!tuiCapable()) return multiselectByNumber(title, choices, selected);

      closeReadline();
      let cursor = 0;
      let painted = 0;
      const paint = (): void => {
        const lines = renderMultiSelect(title, choices, cursor, selected, style, width(), size);
        process.stdout.write(`${rewind(painted)}${lines.join('\n')}\n`);
        painted = lines.length;
      };
      const move = (delta: number): void => {
        cursor = (cursor + delta + choices.length) % choices.length;
        paint();
      };

      process.stdout.write(CURSOR_HIDE);
      try {
        // Painted before a key can arrive — the same rule `select` states at
        // length. A picker that renders nothing until you press something is
        // indistinguishable from a hung program, and here it would also hide
        // the fact that every row starts ticked.
        paint();
        await rawSession<void>((key, done) => {
          switch (key.kind) {
            case 'up':
              move(-1);
              return;
            case 'down':
              move(1);
              return;
            case 'char': {
              if (key.value === 'k') return move(-1);
              if (key.value === 'j') return move(1);
              if (key.value === ' ') {
                if (selected.has(cursor)) selected.delete(cursor);
                else selected.add(cursor);
                paint();
                return;
              }
              if (key.value === 'a') {
                // Toggle-all, not select-all: the second press is how you get
                // to an empty list to tick a handful from, which is otherwise
                // N keystrokes of unticking.
                if (selected.size === choices.length) selected.clear();
                else choices.forEach((_, i) => selected.add(i));
                paint();
              }
              return;
            }
            case 'enter':
              // Refused rather than accepted-then-corrected: an empty result
              // would have to mean "all" or "none" downstream, and both are a
              // guess about what the user meant.
              if (selected.size > 0) done(undefined);
              return;
            default:
              return;
          }
        });
        const chosen = [...selected].sort((a, b) => a - b);
        const label =
          chosen.length === choices.length
            ? `all ${String(choices.length)}`
            : chosen.map((i) => choices[i]?.label ?? '').join(', ');
        const settled = renderSelectAnswer(title, label, style, width());
        process.stdout.write(`${rewind(painted)}${settled.join('\n')}\n`);
        writeBar();
        return chosen;
      } finally {
        process.stdout.write(CURSOR_SHOW);
      }
    },

    get isInteractive() {
      return process.stdin.isTTY === true;
    },
    get supportsTui() {
      return tuiCapable();
    },
    async close() {
      closeReadline();
      return Promise.resolve();
    },
  };
}

/**
 * Fixed-width table rendering — the `apply-llm-response` diff table (§10.4) and
 * `migrate --status` both print one, and neither should hand-roll padding.
 * Cells are truncated (never wrapped) so a row is always one line.
 */
export function renderTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  maxWidths: readonly number[] = [],
): string {
  const clip = (text: string, max: number | undefined): string =>
    max !== undefined && text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;

  const clipped = rows.map((row) => row.map((cell, i) => clip(cell, maxWidths[i])));
  const all = [headers.map((h, i) => clip(h, maxWidths[i])), ...clipped];
  const widths = headers.map((_, col) => Math.max(...all.map((row) => (row[col] ?? '').length)));
  const line = (row: readonly string[]): string =>
    row.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join('  ').trimEnd();

  return [
    line(headers.map((h, i) => clip(h, maxWidths[i]))),
    widths.map((w) => '─'.repeat(w)).join('  '),
    ...clipped.map(line),
  ].join('\n');
}
