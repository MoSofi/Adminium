// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Writing a project's files.
 *
 * The rule is that nothing already in the folder is overwritten. A template
 * file that exists is skipped. `package.json` and `.gitignore` are merged:
 * missing entries are added and present ones are left exactly as they are. A
 * folder that already runs its own `dev`, `build` or `start` script keeps it,
 * and Adminium's goes in as `adminium:dev` and so on.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CliError } from '../cli/exit.js';
import { runScript, type PackageManager } from './package-manager.js';

/** The package's own name, which project code imports its helpers from. */
export const ADMINIUM_PACKAGE = '@adminiumjs/adminium';

/** The esbuild range a new project gets; `adminium build` loads it from the project. */
export const ESBUILD_RANGE = '^0.28.0';

/**
 * React's types, for an editor checking `pages/*.tsx` and `widgets/*.tsx`.
 * Types only: the pages render with the dashboard's own React.
 */
export const REACT_TYPES_RANGE = '^19.2.0';

/** The Node versions Adminium runs on, as a package.json `engines` range. */
export const NODE_RANGE = '^22.14.0 || >=23.6.0';

/** The published image a project Dockerfile builds on. */
export const IMAGE = 'ghcr.io/mosofi/adminium';

export const SCRIPT_IDS = ['dev', 'build', 'start', 'check', 'pull'] as const;
export type ScriptId = (typeof SCRIPT_IDS)[number];

/** Template files copied as they are, by name in the template folder → name in the project. */
const COPIED: ReadonlyArray<readonly [string, string]> = [
  ['adminium.config.ts.tmpl', 'adminium.config.ts'],
  ['tsconfig.json', 'tsconfig.json'],
  ['_env.example', '.env.example'],
  ['_dockerignore', '.dockerignore'],
  // Empty until the project has its own code; git keeps a folder only with a file in it.
  ['_gitkeep', 'hooks/.gitkeep'],
  ['_gitkeep', 'actions/.gitkeep'],
  ['_gitkeep', 'widgets/.gitkeep'],
];

export function templateDir(moduleUrl: string = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..', 'templates', 'project');
}

export interface ScaffoldOptions {
  root: string;
  /** package.json `name` when one has to be created. */
  packageName: string;
  /** The dependency spec for Adminium: an exact version, or `file:…`. */
  adminiumSpec: string;
  /** The Adminium version, for the Dockerfile's image tag. */
  version: string;
  packageManager: PackageManager;
  templates?: string;
}

export interface ScaffoldResult {
  /** Files created, relative to the root. */
  created: string[];
  /** Files that existed and were changed by adding to them. */
  merged: string[];
  /** Template files that existed and were left alone. */
  skipped: string[];
  /** The script name that runs each Adminium command in this project. */
  scripts: Record<ScriptId, string>;
  /** Notes worth printing: kept versions, renamed scripts. */
  notes: string[];
}

type Json = Record<string, unknown>;

const record = (value: unknown): Record<string, string> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {};

/** New or merged package.json content, and which script names Adminium got. */
export function mergePackageJson(
  existing: Json | null,
  opts: Pick<ScaffoldOptions, 'packageName' | 'adminiumSpec'>,
): { json: Json; scripts: Record<ScriptId, string>; notes: string[] } {
  const notes: string[] = [];
  const json: Json =
    existing === null
      ? { name: opts.packageName, version: '0.1.0', private: true, type: 'module' }
      : { ...existing };

  const scripts = { ...record(json.scripts) };
  const chosen = {} as Record<ScriptId, string>;
  for (const id of SCRIPT_IDS) {
    const command = `adminium ${id}`;
    const candidates = [id, `adminium:${id}`];
    const name = candidates.find((candidate) => scripts[candidate] === undefined || scripts[candidate] === command);
    if (name === undefined) {
      throw new CliError(`package.json already has "${id}" and "adminium:${id}" scripts that do something else.`, {
        hint: `Rename one of them, or add "adminium:${id}": "${command}" yourself.`,
      });
    }
    if (name !== id) notes.push(`Your "${id}" script is kept; Adminium's is "${name}".`);
    scripts[name] = command;
    chosen[id] = name;
  }
  json.scripts = scripts;

  const dependencies = { ...record(json.dependencies) };
  const current = dependencies[ADMINIUM_PACKAGE];
  if (current === undefined) dependencies[ADMINIUM_PACKAGE] = opts.adminiumSpec;
  else if (current !== opts.adminiumSpec) notes.push(`package.json keeps ${ADMINIUM_PACKAGE} at "${current}".`);
  json.dependencies = dependencies;

  const devDependencies = { ...record(json.devDependencies) };
  if (devDependencies.esbuild === undefined && dependencies.esbuild === undefined) {
    devDependencies.esbuild = ESBUILD_RANGE;
  }
  if (devDependencies['@types/react'] === undefined && dependencies['@types/react'] === undefined) {
    devDependencies['@types/react'] = REACT_TYPES_RANGE;
  }
  json.devDependencies = devDependencies;

  if (existing === null) json.engines = { node: NODE_RANGE };
  return { json, scripts: chosen, notes };
}

/** The lines of `wanted` that `current` does not already have (ignoring slashes around them). */
export function missingIgnoreLines(current: string, wanted: readonly string[]): string[] {
  const normalise = (line: string) => line.trim().replace(/^\//, '').replace(/\/$/, '');
  const have = new Set(current.split(/\r?\n/).map(normalise));
  return wanted.filter((line) => !line.startsWith('#') && !have.has(normalise(line)));
}

export function dockerfile(pm: PackageManager, version: string): string {
  const install: Record<PackageManager, string[]> = {
    npm: ['COPY package.json package-lock.json ./', 'RUN npm ci'],
    pnpm: ['COPY package.json pnpm-lock.yaml ./', 'RUN corepack enable && pnpm install --frozen-lockfile'],
    yarn: ['COPY package.json yarn.lock ./', 'RUN corepack enable && yarn install --frozen-lockfile'],
    bun: ['COPY package.json bun.lock* ./', 'RUN npm install -g bun && bun install --frozen-lockfile'],
  };
  return [
    '# syntax=docker/dockerfile:1.7',
    '#',
    '# This project on top of the official Adminium image. Keep the image tag',
    '# equal to the @adminiumjs/adminium version in package.json;',
    '# `adminium check` compares them.',
    '',
    'FROM node:22-slim AS build',
    'WORKDIR /project',
    ...install[pm],
    'COPY . .',
    // The build stage's packages stay behind: the server code is bundled, and
    // the official image has Adminium itself.
    'RUN npx --no-install adminium build && rm -rf node_modules',
    '',
    `FROM ${IMAGE}:${version}`,
    // The whole folder, not only the build: `start` checks the build against
    // the files it was made from, and a missing one would make it look stale.
    'COPY --from=build --chown=node:node /project/ /project/',
    'ENV ADMINIUM_PROJECT_DIR=/project',
    '',
  ].join('\n');
}

export function readme(name: string, pm: PackageManager, scripts: Record<ScriptId, string>): string {
  const run = (id: ScriptId) => `\`${runScript(pm, scripts[id])}\``;
  return [
    `# ${name}`,
    '',
    'An admin panel built with [Adminium](https://adminium.dev).',
    '',
    '## Commands',
    '',
    '| Command | What it does |',
    '|---|---|',
    `| ${run('dev')} | Starts Adminium at http://localhost:4600. Edits to page files show at once, and Studio edits are written to them. |`,
    `| ${run('build')} | Compiles \`adminium.config.ts\`, hooks, actions, pages and widgets into \`.adminium/build/\`. |`,
    `| ${run('start')} | Starts Adminium from the build, the way a server runs it. |`,
    `| ${run('check')} | Checks the project and its page files without starting anything, for CI. |`,
    `| ${runScript(pm, scripts.pull)} -- --from <url> | Writes pages changed in Studio on a server into this folder (needs \`ADMINIUM_API_KEY\`). |`,
    '',
    '## Files',
    '',
    '| File | What it is |',
    '|---|---|',
    '| `adminium.config.ts` | Which databases the admin is built from, and other settings. |',
    '| `pages/` | One JSON file per generated page (its template, columns and place in the sidebar), and your own pages as `.tsx` files: `export default definePage({ … })`. |',
    '| `schema/` | One JSON file per database: labels, hidden columns, masks and relations. |',
    '| `hooks/` | Code that runs before or after a record is saved: `export default defineHook({ … })`. |',
    '| `actions/` | Buttons on records that run your code: `export default defineAction({ … })`. The file name is the action\'s id. |',
    '| `widgets/` | Your own table cells and dashboard cards: `export default defineWidget({ … })`. A page file uses one as `project.<file name>`. |',
    '| `.env` | `ADMINIUM_SECRET` and your database URLs. Never commit it, and keep a copy of the secret somewhere safe. |',
    "| `data/` | Adminium's own database and uploads while you develop. |",
    '| `Dockerfile` | Builds this project on the official Adminium image. |',
    '',
    '## Deploying',
    '',
    `Build the image with \`docker build -t ${name} .\` and run it with \`ADMINIUM_SECRET\`,`,
    '`DATABASE_URL` and a volume mounted at `/data`. Docker, Render, Fly.io, App',
    'Platform, Railway and a plain VPS, step by step:',
    'https://docs.adminium.dev/projects/deploy/',
    '',
    '## Docs',
    '',
    'https://docs.adminium.dev/projects/',
    '',
  ].join('\n');
}

/** Write the project files into `opts.root`, never overwriting one. */
export function scaffoldProject(opts: ScaffoldOptions): ScaffoldResult {
  const templates = opts.templates ?? templateDir();
  if (!existsSync(templates)) {
    throw new CliError(`The project template is missing from this Adminium install (${templates}).`);
  }
  mkdirSync(opts.root, { recursive: true });
  const result: ScaffoldResult = { created: [], merged: [], skipped: [], scripts: {} as Record<ScriptId, string>, notes: [] };
  const at = (name: string) => join(opts.root, name);

  // package.json
  const pkgPath = at('package.json');
  let existing: Json | null = null;
  if (existsSync(pkgPath)) {
    try {
      existing = JSON.parse(readFileSync(pkgPath, 'utf8')) as Json;
    } catch (error) {
      throw new CliError(`package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const pkg = mergePackageJson(existing, opts);
  writeFileSync(pkgPath, `${JSON.stringify(pkg.json, null, 2)}\n`);
  (existing === null ? result.created : result.merged).push('package.json');
  result.scripts = pkg.scripts;
  result.notes.push(...pkg.notes);

  // Files copied from the template.
  for (const [from, to] of COPIED) {
    if (existsSync(at(to))) {
      result.skipped.push(to);
      continue;
    }
    mkdirSync(dirname(at(to)), { recursive: true });
    writeFileSync(at(to), readFileSync(join(templates, from), 'utf8'));
    result.created.push(to);
  }

  // .gitignore
  const wanted = readFileSync(join(templates, '_gitignore'), 'utf8').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!existsSync(at('.gitignore'))) {
    writeFileSync(at('.gitignore'), `${wanted.join('\n')}\n`);
    result.created.push('.gitignore');
  } else {
    const current = readFileSync(at('.gitignore'), 'utf8');
    const missing = missingIgnoreLines(current, wanted);
    if (missing.length > 0) {
      const separator = current.length === 0 || current.endsWith('\n') ? '\n' : '\n\n';
      appendFileSync(at('.gitignore'), `${separator}# Adminium\n${missing.join('\n')}\n`);
      result.merged.push('.gitignore');
    }
  }

  // Generated files.
  const generated: ReadonlyArray<readonly [string, () => string]> = [
    ['Dockerfile', () => dockerfile(opts.packageManager, opts.version)],
    ['README.md', () => readme(opts.packageName, opts.packageManager, result.scripts)],
  ];
  for (const [name, render] of generated) {
    if (existsSync(at(name))) {
      result.skipped.push(name);
      continue;
    }
    writeFileSync(at(name), render());
    result.created.push(name);
  }
  return result;
}
