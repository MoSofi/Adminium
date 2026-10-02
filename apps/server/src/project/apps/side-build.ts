// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Building an app's own screens.
 *
 * A side is a small browser app in `apps/<key>/<side>/src/`, entered at
 * `main.tsx`. This bundles it with the project's own esbuild into
 * `.adminium/build/apps/<key>/<side>/`: an `index.html` the build writes, the
 * script and stylesheet under `assets/` with a hash in their names, and
 * `surface.json` when the side lists its screens in `nav.json`. That folder is
 * exactly what Adminium serves at `/apps/<key>/<side>/`.
 *
 * It is not the build for a project's pages and widgets (`client-build.ts`):
 * those are modules loaded into the dashboard and share its React. A side is
 * a page of its own, so it brings React from the project's dependencies.
 *
 * Three things the output must be for the server to serve it:
 *  - no inline script or style in `index.html`: the server's content policy
 *    allows scripts from its own address only;
 *  - asset addresses absolute under `/apps/<key>/<side>/`, so a screen opened
 *    at a deep address, or on a domain mapped to the app, still finds them;
 *  - `surface.json` in the shape `cli/surfaces-root.ts` reads.
 */

import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CliError } from '../../cli/exit.js';
import { SURFACE_JSON_VERSION } from '../../cli/surfaces-root.js';
import { BUILD_DIR, HELPERS_PACKAGE } from '../build-shared.js';
import type { ClientBundler as Bundler } from '../client-build.js';
import { toProjectPath } from '../paths.js';
import { APPS_DIR, SIDES, appDir, appPath, sideEntry, type AppSide } from './read-app.js';

/** What a side imports the shared plumbing from. */
export const SIDE_MODULE = `${HELPERS_PACKAGE}/side`;

/** Files a side may import by address: bundled as files with a hash in their name. */
const FILE_LOADERS: Readonly<Record<string, 'file'>> = {
  '.png': 'file',
  '.jpg': 'file',
  '.jpeg': 'file',
  '.gif': 'file',
  '.webp': 'file',
  '.avif': 'file',
  '.svg': 'file',
  '.ico': 'file',
  '.woff': 'file',
  '.woff2': 'file',
};

export interface BuiltSide {
  side: AppSide;
  /** Absolute: the folder holding `index.html`. */
  dir: string;
  /** Every file written, relative to `dir`, sorted. */
  files: string[];
  bytes: number;
  /** sha256 of every project file the build read, by project-relative path. */
  inputs: Record<string, string>;
}

export interface SideBuildOptions {
  /** The project folder. */
  root: string;
  key: string;
  side: AppSide;
  /** The app's name: the page's title, and the heading of its section in the sidebar. */
  name: string;
  bundler: Bundler;
  /** Readable output with a source map, for `dev`. */
  dev?: boolean;
  /** The file `@adminiumjs/adminium/side` is; the engine's own by default. */
  sideModule?: string;
}

/** Where a side's build goes: `.adminium/build/apps/<key>/<side>`. */
export function sideBuildDir(root: string, key: string, side: AppSide): string {
  return join(root, BUILD_DIR, APPS_DIR, key, side);
}

/** The address a side is served under, without a trailing slash. */
export const sidePrefix = (key: string, side: AppSide): string => `/apps/${key}/${side}`;

/**
 * The engine's own side module: `side/index.js` beside the built server, or
 * the TypeScript source when running from a checkout.
 */
export function engineSideModule(moduleUrl: string = import.meta.url): string {
  const dir = resolve(dirname(fileURLToPath(moduleUrl)), '..', '..', 'side');
  const built = join(dir, 'index.js');
  return existsSync(built) ? built : join(dir, 'index.ts');
}

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** esbuild's error list, as lines a person can act on. */
function describeFailure(error: unknown): string {
  const errors = (error as { errors?: { text: string; location?: { file: string; line: number; column: number } | null }[] }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return error instanceof Error ? error.message : String(error);
  return errors
    .map((e) => {
      const missing = /^Could not resolve "(react|react-dom|react-dom\/client|react\/jsx-runtime)"$/.exec(e.text);
      const text = missing === null ? e.text : `${e.text} — install the project's dependencies first (npm install)`;
      return e.location ? `${e.location.file}:${String(e.location.line)}:${String(e.location.column)}: ${text}` : text;
    })
    .join('\n');
}

interface PluginBuild {
  onResolve(options: { filter: RegExp }, callback: () => { path: string; namespace: string }): void;
  onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string; resolveDir: string }): void;
}

/**
 * `@adminiumjs/adminium/side` is the engine's own file, whatever the project
 * has installed, so the plumbing a side is built with is the plumbing of the
 * Adminium that serves it. Its own imports (React) are found from the project.
 */
function sideModulePlugin(root: string, file: string) {
  return {
    name: 'adminium-side-module',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^@adminiumjs\/adminium\/side$/ }, () => ({ path: SIDE_MODULE, namespace: 'adminium-side' }));
      build.onLoad({ filter: /.*/, namespace: 'adminium-side' }, () => ({
        contents: readFileSync(file, 'utf8'),
        loader: file.endsWith('.ts') ? 'ts' : 'js',
        resolveDir: root,
      }));
    },
  };
}

/** One screen a side lists in `nav.json`. */
interface NavItem {
  id: string;
  path: string;
  icon?: string;
  labels: Record<string, string>;
}

/** `nav.json` as `surface.json`'s nav, or the reason it cannot be one. */
export function readSideNav(file: string, where: string): NavItem[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new CliError(`${where} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(raw)) throw new CliError(`${where} must be a list of screens: [{ "id": "…", "path": "", "label": "…" }]`);
  const seen = new Set<string>();
  return raw.map((entry: unknown, index) => {
    const at = `${where}[${String(index)}]`;
    const item = entry !== null && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    const { id, path, label, labels, icon } = item;
    if (typeof id !== 'string' || id === '') throw new CliError(`${at} needs an "id".`);
    if (seen.has(id)) throw new CliError(`${at}: the id "${id}" is used twice.`);
    seen.add(id);
    // Relative, always: the address a side is opened at differs by placement.
    if (typeof path !== 'string' || path.startsWith('/')) {
      throw new CliError(`${at} needs a "path" that does not start with "/" ("" is the side's first screen).`);
    }
    const byLocale: Record<string, string> = {};
    if (typeof label === 'string' && label !== '') byLocale['en-US'] = label;
    if (labels !== null && typeof labels === 'object' && !Array.isArray(labels)) {
      for (const [tag, text] of Object.entries(labels as Record<string, unknown>)) {
        if (typeof text === 'string' && text !== '') byLocale[tag] = text;
      }
    }
    if (Object.keys(byLocale).length === 0) throw new CliError(`${at} needs a "label".`);
    return { id, path, ...(typeof icon === 'string' && icon !== '' ? { icon } : {}), labels: byLocale };
  });
}

/** Every file under `dir`, relative to it with `/`, sorted. */
function filesUnder(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(join(dir, entry.name), path));
    else out.push(path);
  }
  return out.sort();
}

/** Build one side, replacing what was built before only once the new build is whole. */
export async function buildSide(opts: SideBuildOptions): Promise<BuiltSide> {
  const { root, key, side } = opts;
  const entry = sideEntry(root, key, side);
  if (entry === null) {
    throw new CliError(`${appPath(key, side, 'src', 'main.tsx')} does not exist, so there is no ${side} side to build.`);
  }
  const source = join(appDir(root, key), side);
  const out = sideBuildDir(root, key, side);
  const staging = `${out}.tmp-${String(process.pid)}`;
  const prefix = sidePrefix(key, side);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, 'assets'), { recursive: true });

  let result: Awaited<ReturnType<Bundler['build']>>;
  try {
    result = await opts.bundler.build({
      absWorkingDir: root,
      entryPoints: { main: entry },
      outdir: join(staging, 'assets'),
      entryNames: '[name]-[hash]',
      assetNames: '[name]-[hash]',
      publicPath: `${prefix}/assets`,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      minify: opts.dev !== true,
      sourcemap: opts.dev === true ? 'linked' : false,
      loader: FILE_LOADERS,
      define: {
        'process.env.NODE_ENV': JSON.stringify(opts.dev === true ? 'development' : 'production'),
        __ADMINIUM_APP_KEY__: JSON.stringify(key),
        __ADMINIUM_SIDE__: JSON.stringify(side),
        // A bundle `adminium dev` built asks the server whether it was rebuilt, and reloads.
        __ADMINIUM_DEV__: JSON.stringify(opts.dev === true),
      },
      metafile: true,
      logLevel: 'silent',
      plugins: [sideModulePlugin(root, opts.sideModule ?? engineSideModule())],
    });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw new CliError(`Could not build the ${side} side of "${key}":\n${describeFailure(error)}`);
  }

  try {
    // What esbuild wrote for the entry: its script, and its stylesheet when it imports one.
    const outputs = result.metafile?.outputs ?? {};
    const main = Object.entries(outputs).find(([, output]) => output.entryPoint !== undefined);
    if (main === undefined) throw new CliError(`The ${side} side of "${key}" built to nothing.`);
    const assetUrl = (path: string): string => `${prefix}/assets/${path.split('/').pop() as string}`;
    const script = assetUrl(main[0]);
    const style = main[1].cssBundle === undefined ? null : assetUrl(main[1].cssBundle);

    // Files the side wants served as they are (a favicon, a robots.txt).
    const publicDir = join(source, 'public');
    if (existsSync(publicDir) && statSync(publicDir).isDirectory()) {
      // Plain files only: no link, and no hidden file (a package carries none).
      cpSync(publicDir, staging, {
        recursive: true,
        dereference: false,
        filter: (from) => !lstatSync(from).isSymbolicLink() && (from === publicDir || !basename(from).startsWith('.')),
      });
    }

    writeFileSync(
      join(staging, 'index.html'),
      [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(opts.name)}</title>`,
        ...(style === null ? [] : [`<link rel="stylesheet" href="${style}">`]),
        '</head>',
        '<body>',
        '<div id="root"></div>',
        `<script type="module" src="${script}"></script>`,
        '</body>',
        '</html>',
        '',
      ].join('\n'),
    );

    // The screens this side offers the dashboard's sidebar. No list, no file:
    // the side still serves, and an empty section would be worse than none.
    const navFile = join(source, 'nav.json');
    if (existsSync(navFile)) {
      const nav = readSideNav(navFile, appPath(key, side, 'nav.json'));
      if (nav.length > 0) {
        writeFileSync(
          join(staging, 'surface.json'),
          `${JSON.stringify({ v: SURFACE_JSON_VERSION, appKey: key, side, appLabels: { 'en-US': opts.name }, nav }, null, 2)}\n`,
        );
      }
    }

    const inputs: Record<string, string> = {};
    for (const input of Object.keys(result.metafile?.inputs ?? {})) {
      // The side module and other virtual files have a namespace and no file.
      if (input.includes(':') && !isAbsolute(input)) continue;
      const file = resolve(root, input);
      if (file.split(sep).includes('node_modules') || !existsSync(file)) continue;
      inputs[toProjectPath(root, file)] = sha256(file);
    }
    if (existsSync(navFile)) inputs[toProjectPath(root, navFile)] = sha256(navFile);

    rmSync(out, { recursive: true, force: true });
    mkdirSync(dirname(out), { recursive: true });
    renameSync(staging, out);

    const files = filesUnder(out);
    return { side, dir: out, files, bytes: files.reduce((sum, file) => sum + statSync(join(out, file)).size, 0), inputs };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

/** Build every side of an app that has code, in `staff`, `customer` order. */
export async function buildAppSides(
  opts: Omit<SideBuildOptions, 'side'> & { sides: readonly AppSide[] },
): Promise<BuiltSide[]> {
  const built: BuiltSide[] = [];
  for (const side of opts.sides) built.push(await buildSide({ ...opts, side }));
  // A side that is no longer there leaves no build behind to be packed by mistake.
  const dir = join(opts.root, BUILD_DIR, APPS_DIR, opts.key);
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Only a side's own folder: another build's staging folder beside it is left alone.
      if (entry.isDirectory() && (SIDES as readonly string[]).includes(entry.name) && !opts.sides.includes(entry.name as AppSide)) {
        rmSync(join(dir, entry.name), { recursive: true, force: true });
      }
    }
  }
  return built;
}

/** A built side's folder relative to the project, for a message. */
export const sideBuildPath = (root: string, key: string, side: AppSide): string =>
  relative(root, sideBuildDir(root, key, side)).split(sep).join('/');
