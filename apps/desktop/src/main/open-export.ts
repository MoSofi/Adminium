// SPDX-License-Identifier: AGPL-3.0-only
/**
 * File → "Open a project…" with an "Export everything" file: a NEW project
 * made from it, never anything merged into the one that is open.
 *
 * WHY THE ENGINE'S COMMAND AND NOT A SECOND IMPORTER. The file is untrusted
 * input (it came from another server, by mail or a download). The engine's
 * `import-zip` already checks everything about it (the zip's directory, the
 * manifest, every member's size and digest, every path it names, the
 * connection, storage and domain guards) and restores with the export's rules
 * into a fresh instance. Main runs that command, as it runs `new` and
 * `folder-facts`, and reads its one line of JSON (`--json`). It opens no
 * database and unpacks no member itself.
 *
 * THE ORDER, each step undone when a later one fails:
 *  1. `import-zip --dry-run --json` into a scratch folder: what the file holds,
 *     and its Super Admins. A full signed archive is refused here, by the
 *     engine, with the command that does restore one.
 *  2. The new folder, with a `.env` holding a key made now, written FIRST, so
 *     a file of that name inside the export can never land in its place (the
 *     restore never overwrites).
 *  3. `import-zip --json --owner <email> --password-stdin`: the people, pages,
 *     files and project folder come back, and the person's chosen Super Admin
 *     gets the password they typed in the app. The password crosses on
 *     standard input, never on a command line or in a log.
 *  4. An export of a server that ran without a project folder brings none:
 *     the engine's own `new` makes this folder a project around the instance
 *     now in `data/` (its connections become the project's databases, its
 *     pages its files) and fetches its packages, exactly as "Create" does. A
 *     project folder the file brought is left as it came: the opening that
 *     follows asks about its code and fetches its packages, as for any folder.
 *
 * ELECTRON-FREE: the runner, the file system's few calls and the clock come in.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import type { DesktopMakeStep } from '../preload/api.js';
import { INSTALLING_LINE, MAKE_PROJECT_TIMEOUT_MS, engineEnv, lastLines, type MakeProjectDeps } from './make-project.js';
import { isProjectFolder } from './projects.js';

/** Reading the file and checking it: a large export is read through once. */
export const DESCRIBE_EXPORT_TIMEOUT_MS = 5 * 60_000;
/** The restore itself, and `new` around it. */
export const IMPORT_EXPORT_TIMEOUT_MS = 15 * 60_000;

const ownerSchema = z.object({ id: z.string().min(1), email: z.string().min(1).max(320), name: z.string().max(400) });

/** What `import-zip --json` says when it went through. Extra fields are the engine's to add. */
const okSchema = z.object({
  ok: z.literal(true),
  dryRun: z.boolean(),
  kind: z.literal('export'),
  appVersion: z.string(),
  createdAt: z.number(),
  people: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  connections: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  databases: z.number().int().nonnegative(),
  projectFiles: z.number().int().nonnegative(),
  owners: z.array(ownerSchema).max(1000),
  passwordMinLength: z.number().int().positive(),
  owner: z.string().nullable(),
  warnings: z.array(z.string()).max(1000),
});

const refusedSchema = z.object({ ok: z.literal(false), refused: z.string(), message: z.string(), hint: z.string().optional() });

export type ExportAnswer = z.infer<typeof okSchema>;

/** Why a file is not opened. `full-archive`: the other kind, restored on a server with `adminium archive restore`. */
export type ExportRefusal = 'full-archive' | 'not-an-export' | 'refused' | 'failed';

export type ExportOutcome = { ok: true; answer: ExportAnswer } | { ok: false; refused: ExportRefusal; detail: string };

/**
 * The engine's answer, from the end of what it printed: the last line that is
 * a JSON object of either shape. Anything else (a crash, a build without the
 * flag) is a failure with its last lines as the detail.
 */
export function readExportAnswer(output: string): ExportOutcome {
  const lines = output.split('\n').map((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    if (!line.startsWith('{')) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const ok = okSchema.safeParse(value);
    if (ok.success) return { ok: true, answer: ok.data };
    const refused = refusedSchema.safeParse(value);
    if (refused.success) {
      const kind = refused.data.refused;
      const known: ExportRefusal = kind === 'full-archive' || kind === 'not-an-export' ? kind : 'refused';
      return { ok: false, refused: known, detail: [refused.data.message, refused.data.hint].filter((part) => part !== undefined).join(' ') };
    }
  }
  return { ok: false, refused: 'failed', detail: lastLines(output) };
}

export interface OpenExportDeps extends MakeProjectDeps {
  /** A scratch folder for the dry run; removed after it. */
  scratch?: (() => string) | undefined;
  /** The new project's key. */
  newSecret?: (() => string) | undefined;
  /** `false`: `new` fetches no packages (the opening does). For tests, which have no network to spare. */
  install?: boolean | undefined;
}

/** A key for the new project, as `adminium new` makes one. */
const makeSecret = (): string => randomBytes(32).toString('hex');

/** The `.env` a project made from an export starts with: its own key, and nothing of the file's. */
export function exportProjectEnv(secret: string): string {
  return [
    '# Encrypts every stored connection string. Keep a copy somewhere safe, and never change it.',
    `ADMINIUM_SECRET=${secret}`,
    '',
  ].join('\n');
}

/** Step 1: what the file holds, read and checked by the engine, nothing written anywhere it stays. */
export function createDescribeExport(deps: OpenExportDeps): (file: string) => Promise<ExportOutcome> {
  return async (file) => {
    const scratch = (deps.scratch ?? (() => mkdtempSync(join(tmpdir(), 'adminium-export-'))))();
    try {
      const env = await engineEnv(deps);
      // A key of the scratch instance's own: the dry run opens a store, and nothing of the app's is it.
      env.ADMINIUM_SECRET = makeSecret();
      delete env.ADMINIUM_META_URL;
      delete env.ADMINIUM_DATA_DIR;
      const ran = await deps.run(
        deps.binary,
        [deps.cliEntry, 'import-zip', file, '--dry-run', '--json', '--data-dir', join(scratch, 'data'), '--project-dir', join(scratch, 'project')],
        { cwd: scratch, env, timeoutMs: DESCRIBE_EXPORT_TIMEOUT_MS },
      );
      if (ran.timedOut) return { ok: false, refused: 'failed', detail: 'Reading the file took too long and was stopped.' };
      const outcome = readExportAnswer(ran.output);
      if (!outcome.ok || ran.code !== 0) {
        deps.log?.(`[open export] ${file}: refused (exit ${String(ran.code)})\n${lastLines(ran.output, 6)}`);
        return outcome.ok ? { ok: false, refused: 'failed', detail: lastLines(ran.output) } : outcome;
      }
      return outcome;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
}

export interface ImportExportInput {
  file: string;
  /** The new project's folder: judged by the caller, absent or empty. */
  root: string;
  /** The Super Admin who signs in first, as the dry run named them. */
  ownerEmail: string;
  password: string;
  onStep?: ((step: DesktopMakeStep) => void) | undefined;
}

export type ImportExportResult =
  | { ok: true; answer: ExportAnswer; /** The export carried its own project folder (its code came with it: asked about before it runs). */ carriedProject: boolean }
  | { ok: false; refused: ExportRefusal; detail: string };

/** Steps 2 to 4: the folder, the restore, and the project around it. A failure leaves no folder this call made. */
export function createImportExport(deps: OpenExportDeps): (input: ImportExportInput) => Promise<ImportExportResult> {
  return async ({ file, root, ownerEmail, password, onStep }) => {
    const madeHere = !existsSync(root);
    if (!madeHere && readdirSync(root).some((name) => name !== '.DS_Store')) {
      return { ok: false, refused: 'failed', detail: `${root} is not empty.` };
    }
    const undo = (refused: ExportRefusal, detail: string): ImportExportResult => {
      try {
        if (madeHere) rmSync(root, { recursive: true, force: true });
        else for (const name of readdirSync(root)) rmSync(join(root, name), { recursive: true, force: true });
      } catch {
        // Still there (a file held open): the detail below is what matters.
      }
      return { ok: false, refused, detail };
    };

    onStep?.('files');
    const secret = (deps.newSecret ?? makeSecret)();
    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, '.env'), exportProjectEnv(secret), { mode: 0o600, flag: 'wx' });
    } catch (error) {
      return undo('failed', `Could not make ${root}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const env = await engineEnv(deps);
    env.ADMINIUM_SECRET = secret;
    delete env.ADMINIUM_META_URL;
    delete env.ADMINIUM_DATA_DIR;
    delete env.ADMINIUM_PROJECT_DIR;
    const ran = await deps.run(
      deps.binary,
      [deps.cliEntry, 'import-zip', file, '--json', '--data-dir', join(root, 'data'), '--project-dir', root, '--owner', ownerEmail, '--password-stdin'],
      { cwd: root, env, timeoutMs: IMPORT_EXPORT_TIMEOUT_MS, input: `${password}\n` },
    );
    // What it printed holds no password: it went in on standard input, and the engine never says it.
    deps.log?.(`[open export] ${file} → ${root}: exit ${String(ran.code)}${ran.timedOut ? ' (timed out)' : ''}\n${lastLines(ran.output, 12)}`);
    if (ran.timedOut) return undo('failed', 'Opening the file took too long and was stopped.');
    const outcome = readExportAnswer(ran.output);
    if (!outcome.ok) return undo(outcome.refused, outcome.detail);
    if (ran.code !== 0) return undo('failed', lastLines(ran.output));

    const carriedProject = isProjectFolder(root);
    if (!carriedProject) {
      // The engine's own `new`, in the folder: it keeps the instance in data/ and the key in .env, turns the
      // instance's connections and pages into the project's files, and (in the app) lists what the Designer's
      // screens need and installs what this release was tried with, as "Create" does.
      let printed = '';
      const onOutput = (text: string): void => {
        if (printed.includes(INSTALLING_LINE)) return;
        printed = (printed + text).slice(-512);
        if (printed.includes(INSTALLING_LINE)) onStep?.('packages');
      };
      const made = await deps.run(deps.binary, [deps.cliEntry, 'new', '--yes', ...(deps.install === false ? ['--no-install'] : [])], {
        cwd: root,
        env: await engineEnv(deps),
        timeoutMs: MAKE_PROJECT_TIMEOUT_MS,
        onOutput,
      });
      deps.log?.(`[open export] new project around ${root}: exit ${String(made.code)}${made.timedOut ? ' (timed out)' : ''}\n${lastLines(made.output, 12)}`);
      if (made.timedOut) return undo('failed', 'Making the project took too long and was stopped.');
      if (made.code !== 0 || !isProjectFolder(root)) return undo('failed', lastLines(made.output));
    }
    return { ok: true, answer: outcome.answer, carriedProject };
  };
}

/** `hollis-bakery-2026-11-10.zip` → `Hollis Bakery`: the name proposed for the project made from it. */
export function projectNameFromExport(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  const bare = base
    .replace(/\.zip$/i, '')
    .replace(/[-_ ]?\d{4}-\d{2}-\d{2}([T-]\d{2}[-:]?\d{2}([-:]?\d{2})?)?$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  const words = bare === '' ? 'Imported project' : bare;
  return words.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()).slice(0, 80);
}
