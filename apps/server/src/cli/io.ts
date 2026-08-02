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

export interface CliIo {
  /** Write a line to stdout. */
  out(line?: string): void;
  /** Write a line to stderr — errors and warnings only, so stdout stays pipeable. */
  err(line?: string): void;
  /** Prompt for a line of input. */
  ask(question: string, opts?: AskOptions): Promise<string>;
  /** Prompt for a yes/no. */
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  /** Pick one of `choices` with the arrow keys; resolves to the chosen index. */
  select(title: string, choices: readonly SelectChoice[], opts?: SelectOptions): Promise<number>;
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
  const lines: string[] = [style.bold(clipText(title, width)), ''];
  choices.forEach((choice, i) => {
    const selected = i === active;
    const row = clipText(`${selected ? '❯' : ' '} ${String(i + 1)}. ${choice.label}`, width);
    lines.push(selected ? style.accent(row) : row);
    if (choice.hint !== undefined) {
      lines.push(style.dim(clipText(`     ${choice.hint}`, width)));
    }
  });
  lines.push('');
  lines.push(style.dim(clipText(FOOTER, width)));
  return lines;
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
  const width = (): number => (process.stdout.columns ?? 80) - 1;

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

  /** Masked line editor. Passwords are short, so there is no mid-line editing —
   *  only append, backspace and Ctrl-U, which is what readline cannot give us. */
  const askMasked = async (question: string): Promise<string> => {
    process.stdout.write(`${question}: `);
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

  return {
    out(line = '') {
      process.stdout.write(`${line}\n`);
    },
    err(line = '') {
      process.stderr.write(`${line}\n`);
    },

    async ask(question, opts = {}) {
      for (;;) {
        if (opts.hint !== undefined) process.stdout.write(`${style.dim(opts.hint)}\n`);

        let answer: string;
        if (opts.mask === true && rawCapable()) {
          answer = (await askMasked(question)).trim();
        } else {
          const suffix = opts.default === undefined ? '' : ` [${opts.default}]`;
          answer = (await readline().question(`${question}${suffix}: `)).trim();
        }
        if (answer === '') answer = opts.default ?? '';

        const problem = opts.validate?.(answer) ?? null;
        if (problem === null) return answer;
        process.stderr.write(`${style.danger(problem)}\n`);
      }
    },

    async confirm(question, defaultYes = true) {
      const answer = (await readline().question(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'}: `))
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

      process.stdout.write(`\n${CURSOR_HIDE}`);
      try {
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
        // Collapse the menu to a single answered line: scrollback stays a
        // readable transcript of the decisions rather than a wall of options.
        // Deliberately unclipped — this is the last write of the prompt, so a
        // wrap costs nothing, whereas clipping a styled string would count its
        // escape codes as visible columns and cut the answer short.
        const label = choices[chosen]?.label ?? '';
        process.stdout.write(`${rewind(painted)}${style.ok('✓')} ${title} ${style.bold(label)}\n`);
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
