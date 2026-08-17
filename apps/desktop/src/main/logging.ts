// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Desktop logging (11-electron.md §9 "Logs"): "server stdout/stderr piped to
 * `<userData>/logs/adminium-server.log`, main-process log alongside; 5 MB × 5
 * rotation. Help → 'Show logs' reveals the folder."
 *
 * ─── Why this is synchronous ─────────────────────────────────────────────────
 *
 * Every write is `appendFileSync`. That is a deliberate trade, not an oversight.
 * The single most valuable line this file will ever carry is the last one a
 * crashing server printed, and a buffered/async writer loses exactly that line:
 * the child dies, its stream never flushes, and the crash screen (§2.2 step 9)
 * offers the user a log path pointing at a file that stops one line short of the
 * reason. The volume is a few lines per second from a local pino, on the main
 * process of a desktop app that is otherwise idle — the cost of `fsync`-less
 * appends here is not measurable, and the failure it prevents is the one thing
 * "Show logs" exists for.
 *
 * ─── No Electron ─────────────────────────────────────────────────────────────
 *
 * `app.getPath('logs')` belongs to `main/index.ts`; this module takes a
 * directory. That keeps the rotation logic — the part with off-by-one bugs in it
 * — unit-testable against a real temp directory with no Electron in the process.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

/** §9: "5 MB × 5 rotation". */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
/** Total files kept: the live one plus `DEFAULT_MAX_FILES - 1` archives. */
export const DEFAULT_MAX_FILES = 5;
/** Lines kept in memory for the crash screen's log excerpt (§2.2 step 7). */
export const DEFAULT_TAIL_LINES = 200;

/**
 * What `ServerManager` needs from a log. Narrow on purpose: the manager must be
 * injectable with a fake, and it has no business knowing about rotation.
 */
export interface LogSink {
  /** Appends one line (a trailing newline is added if absent). */
  write(line: string): void;
  /** The most recent lines, oldest first — the crash screen's excerpt. */
  recentLines(count?: number): string[];
  /** Absolute path, for "Show logs" and the give-up state's message. */
  readonly path: string;
}

export interface RotatingFileLogOptions {
  /** Absolute path of the live file, e.g. `<logs>/adminium-server.log`. */
  file: string;
  /** Rotate once the live file would exceed this. Default 5 MB. */
  maxBytes?: number | undefined;
  /** Total files kept including the live one. Default 5. */
  maxFiles?: number | undefined;
  /** Ring-buffer depth for {@link RotatingFileLog.recentLines}. Default 200. */
  tailLines?: number | undefined;
  /** Test seam. */
  now?: (() => Date) | undefined;
}

/**
 * `adminium-server.log` → `adminium-server.1.log` → … → `adminium-server.4.log`.
 *
 * Numbered rather than timestamped so the set is bounded and the newest archive
 * always has the same name — "Show logs" opens a folder a human has to read.
 */
export class RotatingFileLog implements LogSink {
  readonly path: string;
  readonly #maxBytes: number;
  readonly #maxFiles: number;
  readonly #tailLines: number;
  readonly #now: () => Date;
  readonly #tail: string[] = [];
  #size: number;

  constructor(opts: RotatingFileLogOptions) {
    this.path = opts.file;
    this.#maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.#maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
    this.#tailLines = opts.tailLines ?? DEFAULT_TAIL_LINES;
    this.#now = opts.now ?? (() => new Date());
    mkdirSync(dirname(this.path), { recursive: true });
    // Resume the existing file's size rather than truncating: a relaunch after a
    // crash must not destroy the log that explains the crash.
    this.#size = existsSync(this.path) ? statSync(this.path).size : 0;
  }

  /** Current live-file size in bytes. Exposed for the rotation test. */
  get size(): number {
    return this.#size;
  }

  write(line: string): void {
    const stamped = `${this.#now().toISOString()} ${stripTrailingNewline(line)}\n`;
    const bytes = Buffer.byteLength(stamped);

    // Rotate BEFORE writing, so the live file never exceeds maxBytes. A single
    // line larger than the budget still gets written whole — a truncated stack
    // trace is worse than an oversized file.
    if (this.#size > 0 && this.#size + bytes > this.#maxBytes) this.#rotate();

    appendFileSync(this.path, stamped);
    this.#size += bytes;

    this.#tail.push(stamped.trimEnd());
    if (this.#tail.length > this.#tailLines) this.#tail.splice(0, this.#tail.length - this.#tailLines);
  }

  recentLines(count = this.#tailLines): string[] {
    if (count >= this.#tail.length) return [...this.#tail];
    return this.#tail.slice(this.#tail.length - count);
  }

  /** `.4.log` is dropped, `.3.log`→`.4.log`, …, live→`.1.log`. */
  #rotate(): void {
    const archives = this.#maxFiles - 1;
    if (archives < 1) {
      // maxFiles = 1 ⇒ keep only the live file; start it over.
      rmSync(this.path, { force: true });
      this.#size = 0;
      return;
    }
    const oldest = archivePath(this.path, archives);
    rmSync(oldest, { force: true });
    for (let index = archives - 1; index >= 1; index -= 1) {
      const from = archivePath(this.path, index);
      if (existsSync(from)) renameSync(from, archivePath(this.path, index + 1));
    }
    if (existsSync(this.path)) renameSync(this.path, archivePath(this.path, 1));
    this.#size = 0;
  }
}

/** `/logs/adminium-server.log` + 2 → `/logs/adminium-server.2.log`. */
export function archivePath(file: string, index: number): string {
  const dot = file.lastIndexOf('.');
  if (dot <= file.lastIndexOf('/') || dot <= file.lastIndexOf('\\')) {
    return `${file}.${String(index)}`;
  }
  return `${file.slice(0, dot)}.${String(index)}${file.slice(dot)}`;
}

function stripTrailingNewline(line: string): string {
  return line.replace(/\r?\n$/, '');
}

/**
 * A {@link LogSink} that keeps the tail in memory and writes nothing.
 *
 * The fallback for a `ServerManager` constructed without a `logsDir` — and the
 * reason `ServerManager`'s log is optional at all. A manager that hard-required
 * a file would force every suite to touch a real directory to test the restart
 * arithmetic, and would make the first main-process wiring mistake a crash
 * rather than a degraded log. The crash-screen excerpt still works; only "Show
 * logs" has nothing to reveal, which `path` says out loud.
 */
export function createMemoryLogSink(tailLines = DEFAULT_TAIL_LINES): LogSink {
  const tail: string[] = [];
  return {
    path: '(no log file configured)',
    write(line: string): void {
      tail.push(stripTrailingNewline(line));
      if (tail.length > tailLines) tail.splice(0, tail.length - tailLines);
    },
    recentLines(count = tailLines): string[] {
      if (count >= tail.length) return [...tail];
      return tail.slice(tail.length - count);
    },
  };
}

// ─── Piping the child's stdio ────────────────────────────────────────────────

/** The half of `stream.Readable` this module uses — keeps fakes trivial. */
export interface ReadableLike {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
}

/**
 * Split a byte stream into lines and hand each to `sink`.
 *
 * The buffering matters: pino writes one JSON object per line, but a pipe hands
 * you arbitrary chunks — a 4 KB read can end mid-object. Naively writing each
 * chunk as a "line" shreds long stack traces across log records exactly when
 * they are being read to explain a crash. The remainder is held and flushed on
 * `end`, so a final unterminated line (a process that died mid-write — again,
 * the crash case) still lands.
 */
export function pipeStreamToLog(
  stream: ReadableLike,
  sink: LogSink,
  prefix: string,
): void {
  let remainder = '';
  stream.on('data', (chunk: Buffer | string) => {
    remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = remainder.split(/\r?\n/);
    // The last element is either '' (chunk ended on a newline) or a partial line.
    remainder = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > 0) sink.write(`${prefix} ${line}`);
    }
  });
  stream.on('end', () => {
    if (remainder.length > 0) {
      sink.write(`${prefix} ${remainder}`);
      remainder = '';
    }
  });
}

// ─── The app's two logs ──────────────────────────────────────────────────────

export const SERVER_LOG_FILENAME = 'adminium-server.log';
export const MAIN_LOG_FILENAME = 'adminium-main.log';

export interface DesktopLogging {
  /** Main-process events: boot, restarts, update checks. */
  main: RotatingFileLog;
  /** §9: the child's stdout/stderr, verbatim. */
  server: RotatingFileLog;
  /** What "Show logs" reveals. */
  logsDir: string;
}

/**
 * Both logs, in `logsDir` (the caller passes `app.getPath('logs')` — §9's
 * `<userData>/logs`). Split in two because the server's pino output and the
 * main process's own narration have different formats and different volumes;
 * interleaving them makes both harder to read.
 */
export function createDesktopLogging(opts: {
  logsDir: string;
  maxBytes?: number | undefined;
  maxFiles?: number | undefined;
}): DesktopLogging {
  const shared = {
    ...(opts.maxBytes === undefined ? {} : { maxBytes: opts.maxBytes }),
    ...(opts.maxFiles === undefined ? {} : { maxFiles: opts.maxFiles }),
  };
  return {
    main: new RotatingFileLog({ file: join(opts.logsDir, MAIN_LOG_FILENAME), ...shared }),
    server: new RotatingFileLog({ file: join(opts.logsDir, SERVER_LOG_FILENAME), ...shared }),
    logsDir: opts.logsDir,
  };
}
