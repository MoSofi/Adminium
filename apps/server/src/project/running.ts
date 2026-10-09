// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `.adminium/running.json` — who is serving this project right now.
 *
 * One folder, one server: two of them would write the same database files and
 * the same `apps/` folder. The terminal's commands and the desktop app both
 * read this file before they start and write it once they listen, so the
 * second one says where the first is instead of starting.
 *
 * A file whose process is gone is simply replaced: a server that was killed
 * never got to remove it.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { CliError, EXIT_CONFIG } from '../cli/exit.js';

export interface RunningMark {
  pid: number;
  port: number;
  mode: 'design' | 'dev' | 'start';
  startedAt: string;
  by: 'desktop' | 'cli';
}

export function runningFile(root: string): string {
  return join(root, '.adminium', 'running.json');
}

/** Whether a process with that id exists. `EPERM` means it does, under another user. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The mark of a server that is still there, or `null`. Never this process's own. */
export function readRunning(root: string, isAlive: (pid: number) => boolean = alive): RunningMark | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(runningFile(root), 'utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const mark = parsed as Partial<RunningMark>;
  if (typeof mark.pid !== 'number' || !Number.isInteger(mark.pid) || mark.pid <= 0 || typeof mark.port !== 'number') return null;
  if (mark.pid === process.pid || !isAlive(mark.pid)) return null;
  return {
    pid: mark.pid,
    port: mark.port,
    mode: mark.mode === 'design' || mark.mode === 'dev' ? mark.mode : 'start',
    startedAt: typeof mark.startedAt === 'string' ? mark.startedAt : '',
    by: mark.by === 'desktop' ? 'desktop' : 'cli',
  };
}

/** The words for a project that is already being served. */
export function runningMessage(mark: RunningMark): string {
  return `This project is already running (${mark.by === 'desktop' ? 'in the Adminium app' : 'in a terminal'}), on port ${String(mark.port)}.`;
}

export function refuseIfRunning(root: string, isAlive?: (pid: number) => boolean): void {
  const mark = readRunning(root, isAlive);
  if (mark !== null) throw new CliError(runningMessage(mark), { code: EXIT_CONFIG, hint: 'Stop it there first, or use it where it is.' });
}

/**
 * Write the mark for this process; the returned function removes it (only
 * while it is still this process's). It is also removed when the process
 * exits on its own, which is how a terminal's server ends.
 */
export function markRunning(root: string, what: Pick<RunningMark, 'port' | 'mode' | 'by'>, now: () => Date = () => new Date()): () => void {
  const file = runningFile(root);
  const mark: RunningMark = { pid: process.pid, port: what.port, mode: what.mode, startedAt: now().toISOString(), by: what.by };
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(mark, null, 2)}\n`);
  } catch {
    // A folder that cannot be written to still serves; the mark is a courtesy to a second start.
    return () => undefined;
  }
  let done = false;
  const forget = (): void => {
    if (done) return;
    done = true;
    process.removeListener('exit', forget);
    try {
      const held = JSON.parse(readFileSync(file, 'utf8')) as Partial<RunningMark>;
      if (held.pid === process.pid) rmSync(file, { force: true });
    } catch {
      // Already gone.
    }
  };
  process.once('exit', forget);
  return forget;
}
