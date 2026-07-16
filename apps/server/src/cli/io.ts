/**
 * CLI input/output seam.
 *
 * Every byte the CLI prints and every answer it reads goes through {@link CliIo},
 * so the whole surface — including the init wizard's interactive prompts — is
 * driven by a scripted fake in tests: no TTY, no spawned process, no timers.
 * {@link nodeIo} is the only place that touches `process.stdout`/`stdin`.
 */

import { createInterface } from 'node:readline/promises';

export interface AskOptions {
  /** Returned when the user just presses Enter. */
  default?: string;
  /** Suppress echo (passwords). Best-effort: falls back to echoing on a non-TTY. */
  mask?: boolean;
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
  /** True when stdin is interactive — gates the wizard. */
  isInteractive: boolean;
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
}

export function createStyle(color: boolean): Style {
  const wrap = (open: string) => (text: string) => (color ? `\u001b[${open}m${text}\u001b[0m` : text);
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    ok: wrap('32'),
    warn: wrap('33'),
    danger: wrap('31'),
  };
}

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

  return {
    out(line = '') {
      process.stdout.write(`${line}\n`);
    },
    err(line = '') {
      process.stderr.write(`${line}\n`);
    },
    async ask(question, opts = {}) {
      const suffix = opts.default === undefined ? '' : ` [${opts.default}]`;
      const answer = (await readline().question(`${question}${suffix}: `)).trim();
      return answer === '' ? (opts.default ?? '') : answer;
    },
    async confirm(question, defaultYes = true) {
      const answer = (await readline().question(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'}: `))
        .trim()
        .toLowerCase();
      if (answer === '') return defaultYes;
      return answer === 'y' || answer === 'yes';
    },
    get isInteractive() {
      return process.stdin.isTTY === true;
    },
    async close() {
      rl?.close();
      rl = null;
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
