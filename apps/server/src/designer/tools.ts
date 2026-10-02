// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Designer's tools: a closed list.
 *
 *   list_files, read_file, write_file, edit_file, delete_file
 *                     the app's folder, hooks/ and actions/ (the jail)
 *   check_app         the engine's check of the app, as `adminium app check`
 *   build_sides       the app's screens, built
 *   apply_app         check, build and apply, as `adminium dev` does on a save
 *   run_tests         the app's own tests, if it has any
 *   read_reference    one file of the skills
 *   list_add_ons      the add-ons this server has or can get
 *   ask_person        a question for the person, and their answer
 *   request_package   an npm package, installed only when the person says yes
 *
 * No shell, no network, no web. A bad input is an answer the model can read
 * and fix, never a crash of the turn.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { checkApp } from '../project/apps/check-app.js';
import { APPS_DIR } from '../project/apps/read-app.js';
import { rebuildApps } from '../project/build.js';
import { findProject } from '../project/locate.js';
import { projectPackageManager } from '../project/package-manager.js';
import { runChild } from './child.js';
import { createJail, JailError, type Jail } from './jail.js';
import type { Designer } from './service.js';
import type { Skills } from './skills.js';
import type { DesignerTool, ToolContext, ToolOutcome } from './tool-types.js';

/** The most a read returns; the rest is said to be there. */
export const MAX_READ_BYTES = 65_536;
/** The most entries a listing gives. */
const MAX_LIST = 400;
/** How long an app's tests may run. */
const TESTS_TIMEOUT_MS = 60_000;
/** How long a package install may run. */
const INSTALL_TIMEOUT_MS = 180_000;

/** An add-on the server has or can get, in one line. */
export interface AddOnLine {
  key: string;
  name: string;
  version: string;
  line: string;
  state: 'installed' | 'available';
}

export interface ToolsDeps {
  root: string;
  version: string;
  designer: () => Designer;
  skills: Skills;
  listAddOns: () => Promise<AddOnLine[]>;
}

const text = (content: string, label: string, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({ content, label, ...extra });
const refused = (content: string, label: string): ToolOutcome => ({ content, label, isError: true });

const str = (input: Record<string, unknown>, key: string): string | null => (typeof input[key] === 'string' ? (input[key] as string) : null);
const int = (input: Record<string, unknown>, key: string): number | null =>
  typeof input[key] === 'number' && Number.isInteger(input[key]) && (input[key] as number) >= 0 ? (input[key] as number) : null;

/** npm's own rule for a package name, scoped or not. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
/** An exact version: no range, no tag, no URL. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** An app manifest's own build command is set by a person (D33): refused when the model writes one. */
function addsBuildCommand(path: string, content: string, appKey: string): boolean {
  const manifestFiles = [`apps/${appKey}/manifest/app.json`, `apps/${appKey}/manifest.json`];
  if (!manifestFiles.includes(path)) return false;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return parsed !== null && typeof parsed === 'object' && 'build' in parsed;
  } catch {
    // Not JSON: the check will say so.
    return false;
  }
}

export function createDesignerTools(deps: ToolsDeps, appKey: string): DesignerTool[] {
  const jail: Jail = createJail(deps.root, appKey);
  const shown = (path: string): string => {
    try {
      return jail.normalise(path).replace(`apps/${appKey}/`, '');
    } catch {
      return path;
    }
  };
  /** Run a jail step; a refusal becomes an answer, not a crash. */
  const jailed = (label: string, step: () => ToolOutcome): ToolOutcome => {
    try {
      return step();
    } catch (error) {
      if (error instanceof JailError) return refused(error.message, label);
      throw error;
    }
  };

  const tools: DesignerTool[] = [
    {
      name: 'list_files',
      description: `List the files you may read and write: apps/${appKey}/ (this app), hooks/ and actions/. Give "dir" to list one folder.`,
      inputSchema: { type: 'object', properties: { dir: { type: 'string', description: `A folder, e.g. apps/${appKey}/manifest` } }, additionalProperties: false },
      running: () => 'Listing files',
      run: async (input) =>
        jailed('Listed files', () => {
          const dirs = str(input, 'dir') === null ? jail.roots : [jail.normalise(str(input, 'dir') as string)];
          const lines: string[] = [];
          for (const dir of dirs) {
            const absolute = jail.resolve(dir, 'list');
            if (!existsSync(absolute)) {
              lines.push(`${dir}/ (empty)`);
              continue;
            }
            const walk = (folder: string): void => {
              for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                if (lines.length >= MAX_LIST) return;
                if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
                const path = join(folder, entry.name);
                const shownPath = relative(deps.root, path).split(sep).join('/');
                if (entry.isDirectory()) walk(path);
                else if (entry.isFile()) lines.push(`${shownPath} (${String(statSync(path).size)} bytes)`);
              }
            };
            walk(absolute);
          }
          if (lines.length >= MAX_LIST) lines.push(`… more files: list one folder with "dir".`);
          return text(lines.length === 0 ? 'No files yet.' : lines.join('\n'), `Listed ${String(lines.length)} files`);
        }),
    },
    {
      name: 'read_file',
      description: 'Read a text file. Long files are cut; read the rest with "from" (a line number, from 1) and "lines".',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, from: { type: 'integer', minimum: 1 }, lines: { type: 'integer', minimum: 1 } },
        required: ['path'],
        additionalProperties: false,
      },
      running: (input) => `Reading ${shown(String(input['path'] ?? ''))}`,
      run: async (input) => {
        const path = str(input, 'path');
        if (path === null) return refused('Give the "path" of the file to read.', 'Read nothing');
        return jailed(`Could not read ${shown(path)}`, () => {
          const all = readFileSync(jail.resolve(path, 'read'), 'utf8');
          const from = int(input, 'from');
          const count = int(input, 'lines');
          let body = all;
          if (from !== null || count !== null) {
            const lines = all.split('\n');
            const start = Math.max(0, (from ?? 1) - 1);
            body = lines.slice(start, count === null ? undefined : start + count).join('\n');
          }
          if (Buffer.byteLength(body, 'utf8') > MAX_READ_BYTES) {
            const cut = Buffer.from(body, 'utf8').subarray(0, MAX_READ_BYTES).toString('utf8');
            const shownLines = cut.split('\n').length;
            body = `${cut}\n… cut here: the file goes on. Read from line ${String((from ?? 1) + shownLines - 1)} with "from".`;
          }
          return text(body, `Read ${shown(path)}`);
        });
      },
    },
    {
      name: 'write_file',
      description: 'Write a whole text file (made if it does not exist, replaced if it does).',
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
      running: (input) => `Writing ${shown(String(input['path'] ?? ''))}`,
      run: async (input) => {
        const path = str(input, 'path');
        const content = str(input, 'content');
        if (path === null || content === null) return refused('Give "path" and "content".', 'Wrote nothing');
        return jailed(`Could not write ${shown(path)}`, () => {
          const normal = jail.normalise(path);
          if (addsBuildCommand(normal, content, appKey)) {
            return refused('An app’s own build command is set by a person, never written here. Leave "build" out of app.json.', `Refused ${shown(path)}`);
          }
          const existed = existsSync(jail.resolve(path, 'write'));
          jail.write(path, content);
          return text(`${existed ? 'Replaced' : 'Made'} ${normal} (${String(Buffer.byteLength(content, 'utf8'))} bytes).`, `Wrote ${shown(path)}`);
        });
      },
    },
    {
      name: 'edit_file',
      description: 'Replace one exact piece of a text file with another. "old" must appear exactly once.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } },
        required: ['path', 'old', 'new'],
        additionalProperties: false,
      },
      running: (input) => `Editing ${shown(String(input['path'] ?? ''))}`,
      run: async (input) => {
        const path = str(input, 'path');
        const before = str(input, 'old');
        const after = str(input, 'new');
        if (path === null || before === null || after === null || before.length === 0) return refused('Give "path", a non-empty "old", and "new".', 'Edited nothing');
        return jailed(`Could not edit ${shown(path)}`, () => {
          const current = readFileSync(jail.resolve(path, 'read'), 'utf8');
          const count = current.split(before).length - 1;
          if (count !== 1) {
            return refused(
              count === 0 ? `"old" is not in ${path}. Read the file and copy the piece exactly.` : `"old" is in ${path} ${String(count)} times. Give more of it, so it is there once.`,
              `Could not edit ${shown(path)}`,
            );
          }
          const next = current.replace(before, () => after);
          const normal = jail.normalise(path);
          if (addsBuildCommand(normal, next, appKey)) {
            return refused('An app’s own build command is set by a person, never written here. Leave "build" out of app.json.', `Refused ${shown(path)}`);
          }
          jail.write(path, next);
          return text(`Edited ${normal}.`, `Edited ${shown(path)}`);
        });
      },
    },
    {
      name: 'delete_file',
      description: 'Delete one file.',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
      running: (input) => `Deleting ${shown(String(input['path'] ?? ''))}`,
      run: async (input) => {
        const path = str(input, 'path');
        if (path === null) return refused('Give the "path" to delete.', 'Deleted nothing');
        return jailed(`Could not delete ${shown(path)}`, () => {
          jail.delete(path);
          return text(`Deleted ${jail.normalise(path)}.`, `Deleted ${shown(path)}`);
        });
      },
    },
    {
      name: 'check_app',
      description: 'Check the app as the engine will: the manifest put together and validated, the sides found. Fix every error before applying.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      running: () => 'Checking the app',
      run: async () => {
        const check = checkApp(deps.root, appKey, { version: deps.version });
        const order = { error: 0, warn: 1, note: 2 } as Record<string, number>;
        const findings = [...check.findings].sort((a, b) => (order[a.level] ?? 3) - (order[b.level] ?? 3));
        const errors = findings.filter((finding) => finding.level === 'error').length;
        const lines = findings.slice(0, 40).map((finding) => `${finding.level} · ${finding.file}${finding.path === '' ? '' : ` · ${finding.path}`} · ${finding.message}`);
        if (findings.length > 40) lines.push(`… and ${String(findings.length - 40)} more.`);
        const head = errors === 0 ? 'No errors.' : `${String(errors)} error${errors === 1 ? '' : 's'}.`;
        return {
          content: [head, ...lines].join('\n'),
          label: errors === 0 ? 'Checked: no errors' : `Checked: ${String(errors)} error${errors === 1 ? '' : 's'}`,
          ...(errors === 0 ? {} : { isError: true, detail: lines.slice(0, 5).join('\n') }),
        };
      },
    },
    {
      name: 'build_sides',
      description: 'Build the app’s screens (its staff and customer sides). Gives the first errors when they do not build.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      running: () => 'Building the screens',
      run: async () => {
        const project = findProject(deps.root, {});
        if (project === null) return refused('The project folder has no adminium.config file.', 'Could not build');
        const built = await rebuildApps(project, { version: deps.version, dev: true });
        const app = built.apps.find((candidate) => candidate.key === appKey);
        const problems = app?.problems ?? (app === undefined ? ['The app was not found in the build.'] : []);
        if (problems.length > 0) {
          return { content: problems.slice(0, 20).join('\n'), label: 'Screens did not build', isError: true, detail: problems.slice(0, 3).join('\n') };
        }
        const sides = app?.sides ?? [];
        return text(sides.length === 0 ? 'The app has no screens of its own; nothing to build.' : `Built: ${sides.join(', ')}.`, sides.length === 0 ? 'No screens to build' : `Built ${sides.join(' and ')}`);
      },
    },
    {
      name: 'apply_app',
      description: 'Check, build and apply the app to this server, as saving a file under `adminium dev` does. Tables are made, pages written. Says where it stopped when it cannot.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      running: () => 'Applying the app',
      run: async (_input, ctx: ToolContext) => {
        const before = ctx.handle.events;
        let said = '';
        const watching = {
          ...ctx.handle,
          events: {
            ...before,
            emit: (turn: number, body: Parameters<typeof before.emit>[1]) => {
              if (body.kind === 'check' && !body.ok) said = `The check found errors:\n${body.findings.filter((f) => f.level === 'error').map((f) => `${f.file} · ${f.path} · ${f.message}`).join('\n')}`;
              if (body.kind === 'build' && !body.ok) said = `The screens did not build:\n${body.problems.join('\n')}`;
              if (body.kind === 'apply' && !body.ok) said = `It was not applied (${body.stage ?? body.state}): ${body.message ?? ''}`;
              return before.emit(turn, body);
            },
          },
        };
        const result = await deps.designer().pipeline(ctx.session, watching, { version: false });
        return result.ok
          ? text('Applied. The app on this server is what the folder says.', 'Applied the app')
          : { content: said || 'It was not applied.', label: 'Not applied', isError: true, detail: said.split('\n').slice(0, 3).join('\n') };
      },
    },
    {
      name: 'run_tests',
      description: `Run the app’s own tests (node --test, files under apps/${appKey}/tests/). Gives the end of what they printed.`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      running: () => 'Running the app’s tests',
      run: async (_input, ctx) => {
        const folder = join(deps.root, APPS_DIR, appKey, 'tests');
        const files = existsSync(folder) ? readdirSync(folder).filter((name) => /\.test\.m?js$/.test(name)).sort() : [];
        if (files.length === 0) return text(`This app has no tests (files named *.test.mjs under apps/${appKey}/tests/).`, 'No tests to run');
        const result = await runChild(process.execPath, ['--test', ...files.map((name) => `apps/${appKey}/tests/${name}`)], {
          cwd: deps.root,
          timeoutMs: TESTS_TIMEOUT_MS,
          signal: ctx.signal,
          // The starter's own test calls `adminium app check` through the CLI; check_app is that check, run here.
          env: { ...process.env, ADMINIUM_SKIP_CLI: '1' },
        });
        const tail = result.output.split('\n').slice(-200).join('\n');
        if (result.timedOut) return refused(`The tests ran longer than ${String(TESTS_TIMEOUT_MS / 1000)} s and were stopped.\n${tail}`, 'Tests took too long');
        return result.code === 0 ? text(tail, 'Tests passed') : { content: tail, label: 'Tests failed', isError: true, detail: tail.split('\n').slice(-5).join('\n') };
      },
    },
    {
      name: 'read_reference',
      description: 'Read one file of the skills by its name, as INDEX.md lists it: e.g. "adminium-app/references/manifest/overview.md". Start from a skill’s references/INDEX.md.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false },
      running: (input) => `Reading ${String(input['name'] ?? '')}`,
      run: async (input) => {
        const name = (str(input, 'name') ?? '').replace(/^skills\//, '').replace(/^references\//, '');
        const found = deps.skills.read(name);
        if (found === null) {
          const near = deps.skills.names().filter((candidate) => candidate.endsWith(name.split('/').pop() ?? '\0')).slice(0, 5);
          return refused(`There is no skill file "${name}".${near.length > 0 ? ` Did you mean: ${near.join(', ')}?` : ' Read a skill’s references/INDEX.md for the names.'}`, 'No such reference');
        }
        return text(found, `Read ${name}`);
      },
    },
    {
      name: 'list_add_ons',
      description: 'The add-ons this server has, or can get: key, name, version and what each does. An app names the ones it needs in its manifest.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      running: () => 'Looking at the add-ons',
      run: async () => {
        const all = await deps.listAddOns();
        if (all.length === 0) return text('This server has no add-ons, and none it can get without the network.', 'No add-ons here');
        return text(all.map((addOn) => `${addOn.key} ${addOn.version} (${addOn.state}) — ${addOn.name}: ${addOn.line}`).join('\n'), `Found ${String(all.length)} add-ons`);
      },
    },
    {
      name: 'ask_person',
      description: 'Ask the person a question, only when the answer changes what you build. Give "choices" when there are a few clear ones.',
      inputSchema: {
        type: 'object',
        properties: { question: { type: 'string' }, choices: { type: 'array', items: { type: 'string' }, maxItems: 6 } },
        required: ['question'],
        additionalProperties: false,
      },
      running: () => 'Asking you',
      run: async (input, ctx) => {
        const question = (str(input, 'question') ?? '').trim();
        if (question.length === 0 || question.length > 500) return refused('Ask a question of 1 to 500 characters.', 'Asked nothing');
        const choices = Array.isArray(input['choices']) ? (input['choices'] as unknown[]).filter((c): c is string => typeof c === 'string' && c.trim() !== '').slice(0, 6) : [];
        const answer = await ctx.ask({ type: 'question', question, choices });
        return text(answer.type === 'question' ? `The person answered: ${answer.text}` : 'No answer.', 'You answered');
      },
    },
    {
      name: 'request_package',
      description: 'Ask the person to add an npm package to the project (an exact version). Nothing is installed unless they say yes; install scripts never run.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, version: { type: 'string', description: 'An exact version, e.g. 4.17.21' }, why: { type: 'string' } },
        required: ['name', 'version', 'why'],
        additionalProperties: false,
      },
      running: (input) => `Asking to add ${String(input['name'] ?? '')}`,
      run: async (input, ctx) => {
        const name = str(input, 'name') ?? '';
        const version = str(input, 'version') ?? '';
        const why = (str(input, 'why') ?? '').slice(0, 300);
        if (!PACKAGE_NAME.test(name) || name.length > 214) return refused(`"${name}" is not an npm package name.`, 'No package added');
        if (!EXACT_VERSION.test(version)) return refused(`"${version}" is not an exact version. Give one like 1.2.3, not a range or a tag.`, 'No package added');
        const answer = await ctx.ask({ type: 'package', name, version, why });
        if (answer.type !== 'package' || !answer.accept) return text(`The person said no to ${name}@${version}. Do without it.`, `Did without ${name}`);
        const manager = projectPackageManager(deps.root, {});
        const exact = manager === 'npm' || manager === 'pnpm' ? '--save-exact' : '--exact';
        const args = [manager === 'npm' ? 'install' : 'add', `${name}@${version}`, '--ignore-scripts', exact];
        const result = await runChild(manager, args, { cwd: deps.root, timeoutMs: INSTALL_TIMEOUT_MS, signal: ctx.signal });
        if (result.code !== 0) {
          return refused(`${manager} ${args.join(' ')} failed:\n${result.output.split('\n').slice(-30).join('\n')}`, `Could not add ${name}`);
        }
        return text(`Added ${name}@${version} to the project.`, `Added ${name}@${version}`);
      },
    },
  ];
  return tools;
}

/** The names of the tools, in the order the model is told them. */
export const DESIGNER_TOOL_NAMES = [
  'list_files',
  'read_file',
  'write_file',
  'edit_file',
  'delete_file',
  'check_app',
  'build_sides',
  'apply_app',
  'run_tests',
  'read_reference',
  'list_add_ons',
  'ask_person',
  'request_package',
] as const;
