// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Making a new project from the app: the engine's own `new`, run as the
 * terminal runs it.
 *
 * WHY THE ENGINE'S COMMAND AND NOT A COPY OF ITS STEPS. `adminium new` lays the
 * template, writes the secret and the database's address into `.env`, and,
 * told it is inside the app (`ADMINIUM_DESKTOP_PROGRAMS`), lists what the
 * Designer's screens need, lays in the lockfile this release was tried with and
 * installs with the npm the app carries. Every one of those steps has its own
 * tests there. Main starts it with its own program asked to be Node, which is
 * the one Node the app has, and reads how it ended.
 *
 * ELECTRON-FREE: the program, the entry and the runner are handed in.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { MakeProjectResult } from './start.js';

/**
 * The database a project made for the Designer starts with: a file of its own,
 * in the project. FROZEN to the engine's `DESIGN_DATABASE`
 * (`make-project.test.ts` holds the two together): main may not import the
 * engine at run time.
 */
export const NEW_PROJECT_DATABASE = 'sqlite:./data/app.sqlite';

/** A first install on a slow connection; past this something is wrong. */
export const MAKE_PROJECT_TIMEOUT_MS = 15 * 60_000;

export interface RanProgram {
  code: number | null;
  /** The end of what it printed, both streams. */
  output: string;
  timedOut: boolean;
}

export interface MakeProjectDeps {
  /** Main's own `process.execPath`. */
  binary: string;
  /** The engine's command-line entry (`@adminium/server`'s `dist/cli/index.js`). */
  cliEntry: string;
  /** Where the app's own programs are, as the JSON the engine reads; `undefined` when this build has none. */
  programs: () => Promise<string | undefined>;
  env: Readonly<Record<string, string | undefined>>;
  run: (command: string, args: readonly string[], opts: { cwd: string; env: Record<string, string>; timeoutMs: number }) => Promise<RanProgram>;
  log?: ((line: string) => void) | undefined;
}

/** The last lines of a program's output: what a person can act on, without the wall above it. */
export function lastLines(output: string, count = 6): string {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-count)
    .join('\n');
}

export function createMakeProject(deps: MakeProjectDeps): (input: { parent: string; folder: string; root: string }) => Promise<MakeProjectResult> {
  return async ({ parent, folder, root }) => {
    try {
      mkdirSync(parent, { recursive: true });
    } catch (error) {
      return { ok: false, detail: `Could not make ${parent}: ${error instanceof Error ? error.message : String(error)}` };
    }
    // A folder this call makes and cannot finish is taken away again: left behind it is a project with no packages,
    // which "Create" then refuses as a folder with files in it. One that was there before (empty) is the person's.
    const madeHere = !existsSync(root);
    const failed = (detail: string): MakeProjectResult => {
      if (madeHere) {
        try {
          rmSync(root, { recursive: true, force: true });
        } catch {
          // Still there (a file held open): the detail below is what matters.
        }
      }
      return { ok: false, detail };
    };
    const programs = await deps.programs();
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(deps.env)) if (value !== undefined) env[key] = value;
    env.ELECTRON_RUN_AS_NODE = '1';
    if (programs !== undefined) env.ADMINIUM_DESKTOP_PROGRAMS = programs;
    // A secret of the classic workspace, or of whatever started the app, is never a new project's.
    delete env.ADMINIUM_SECRET;

    const ran = await deps.run(deps.binary, [deps.cliEntry, 'new', folder, '--yes', '--database', NEW_PROJECT_DATABASE], { cwd: parent, env, timeoutMs: MAKE_PROJECT_TIMEOUT_MS });
    deps.log?.(`[new project] ${root}: exit ${String(ran.code)}${ran.timedOut ? ' (timed out)' : ''}\n${lastLines(ran.output, 20)}`);
    if (ran.timedOut) return failed('Getting the packages took too long and was stopped.');
    if (ran.code !== 0) return failed(lastLines(ran.output));

    // A SQLite connection opens only a file that exists; an empty file is an empty database.
    const database = resolve(root, NEW_PROJECT_DATABASE.slice('sqlite:'.length));
    if (!existsSync(database)) {
      mkdirSync(dirname(database), { recursive: true });
      writeFileSync(database, '');
    }
    return { ok: true };
  };
}

/** {@link MakeProjectDeps.run} on a real machine. */
export async function runToEnd(command: string, args: readonly string[], opts: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<RanProgram> {
  const { spawn } = await import('node:child_process');
  return new Promise((done) => {
    let output = '';
    let timedOut = false;
    const keep = (chunk: Buffer): void => {
      // The end is what is read; the start of a long install is not kept.
      output = (output + chunk.toString('utf8')).slice(-64 * 1024);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, [...args], { cwd: opts.cwd, env: opts.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      done({ code: null, output: error instanceof Error ? error.message : String(error), timedOut: false });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    child.once('error', (error) => {
      clearTimeout(timer);
      done({ code: null, output: `${output}\n${error.message}`, timedOut });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      done({ code, output, timedOut });
    });
  });
}
