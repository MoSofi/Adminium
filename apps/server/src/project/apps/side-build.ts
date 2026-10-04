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
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
      const icon = /^No matching export in "[^"]*lucide-react[^"]*" for import "([^"]+)"$/.exec(e.text);
      const text =
        icon !== null
          ? `lucide-react has no icon named "${icon[1] as string}" (it has no brand logos, and names are exact): use another icon, or plain text`
          : missing === null
            ? e.text
            : `${e.text} — install the project's dependencies first (npm install)`;
      return e.location ? `${e.location.file}:${String(e.location.line)}:${String(e.location.column)}: ${text}` : text;
    })
    .join('\n');
}

interface ResolveArgs {
  path: string;
  importer: string;
  resolveDir: string;
  kind: string;
  namespace: string;
  pluginData?: unknown;
}
interface ResolveResult {
  path?: string;
  namespace?: string;
  errors?: { text: string }[];
  external?: boolean;
  pluginData?: unknown;
}
interface PluginBuild {
  onResolve(options: { filter: RegExp; namespace?: string }, callback: (args: ResolveArgs) => ResolveResult | null | undefined | Promise<ResolveResult | null | undefined>): void;
  onLoad(
    options: { filter: RegExp; namespace?: string },
    callback: (args: { path: string }) => { contents: string; loader: string; resolveDir?: string; watchFiles?: string[] } | null | undefined | Promise<{ contents: string; loader: string; resolveDir?: string } | null | undefined>,
  ): void;
  resolve(path: string, options: { resolveDir: string; kind: string; importer?: string; pluginData?: unknown }): Promise<ResolveResult>;
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

/** The stylesheets of a side, in the order they are loaded. `tailwind` is not a file: the build makes its text. */
export const SIDE_STYLES = ['theme.css', 'fonts.css', 'app.css', 'tailwind', 'style.css', 'design.css'] as const;
const SIDE_ENTRY = 'adminium-side-entry';
const TAILWIND_TEXT = 'adminium-tailwind.css';

/**
 * A side's entry: its stylesheets, each when it is there, then `main.tsx`.
 * The build brings the stylesheets itself, so a screen whose `main.tsx` was
 * written again without an import still has its look. A stylesheet `main.tsx`
 * imports as well is bundled once, in the place it has here.
 */
function sideEntryPlugin(src: string, tailwind: boolean) {
  return {
    name: 'adminium-side-entry',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^adminium-side-entry$/ }, () => ({ path: SIDE_ENTRY, namespace: 'adminium-entry' }));
      build.onLoad({ filter: /.*/, namespace: 'adminium-entry' }, () => {
        const lines = SIDE_STYLES.flatMap((name) => {
          if (name === 'tailwind') return tailwind ? [`import ${JSON.stringify(TAILWIND_TEXT)};`] : [];
          return existsSync(join(src, name)) ? [`import ${JSON.stringify(`./${name}`)};`] : [];
        });
        return { contents: `${lines.join('\n')}\nimport './main.tsx';\n`, loader: 'js', resolveDir: src };
      });
    },
  };
}

const sameOrUnder = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}${sep}`);

/**
 * A side is built from its app's folder and from installed packages, and from
 * nothing else in the project. A screen is written by a model that reads
 * other people's text (a style, a picture's caption); an import of
 * `../../../package.json` or of a file under `.adminium/` would put the
 * project's own files into a public page. So every import is resolved here
 * first, by its real path, and one that lands anywhere else is refused.
 */
function containmentPlugin(root: string, key: string) {
  const real = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const app = real(appDir(root, key));
  return {
    name: 'adminium-side-containment',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        // Our own second look at the same import, and anything another plugin of ours names.
        if ((args.pluginData as { checked?: boolean } | undefined)?.checked === true) return null;
        if (args.namespace !== 'file' && args.namespace !== 'adminium-entry' && args.namespace !== '') return null;
        if (args.kind === 'entry-point' || /^(data:|https?:|#)/.test(args.path)) return null;
        // What an installed package imports is the package's own business: only the app's files are held to the app.
        if (args.namespace === 'file' && args.importer !== '' && !sameOrUnder(real(args.importer), app)) return null;
        const found = await build.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer, pluginData: { checked: true } });
        if ((found.errors ?? []).length > 0 || found.path === undefined || found.external === true || (found.namespace !== undefined && found.namespace !== 'file')) return found;
        const target = real(found.path);
        if (sameOrUnder(target, app)) return found;
        // A package: the import names it, and it is installed in the project or above it. What it resolves to must be inside
        // that package, so a name mapped elsewhere (a tsconfig "paths" in the app) opens nothing.
        const named = /^(@[^/]+\/[^/]+|[^./@][^/]*)/.exec(args.path)?.[1];
        if (named !== undefined) {
          for (let dir = root; ; dir = dirname(dir)) {
            const installed = join(dir, 'node_modules', named);
            if (existsSync(installed) && sameOrUnder(target, real(installed))) return found;
            if (dir === dirname(dir)) break;
          }
        }
        return {
          errors: [
            {
              text: `"${args.path}" is outside this app: a screen may import files of ${appPath(key)}/ and installed packages, nothing else in the project.`,
            },
          ],
        };
      });
    },
  };
}

/** The classes Tailwind is to know of: every run of marks in a side's source that could be one. */
function classCandidates(src: string, read: (file: string) => void): string[] {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      // No link is followed: a link out of the side would have the scan read the project.
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /\.(?:tsx?|jsx?|mjs)$/.test(entry.name) && statSync(path).size <= 512 * 1024) {
        read(path);
        for (const mark of readFileSync(path, 'utf8').matchAll(/[^\s"'`<>{}=;,]+/g)) if (mark[0].length <= 120) found.add(mark[0]);
      }
    }
  };
  walk(src);
  return [...found];
}

/** The theme's values, given to Tailwind under its own names: `bg-accent`, `font-display`, `rounded-theme`. */
export const TAILWIND_SOURCE = `@import "tailwindcss";
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-text: var(--text);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-accent-soft: var(--accent-soft);
  --color-accent-2: var(--accent-2, var(--accent));
  --color-accent-2-ink: var(--accent-2-ink, var(--accent-ink));
  --color-band: var(--band, var(--text));
  --color-band-ink: var(--band-ink, var(--bg));
  --color-good: var(--good);
  --color-warn: var(--warn);
  --color-bad: var(--bad);
  --font-display: var(--font-display);
  --font-body: var(--font-body);
  --radius-theme: var(--radius);
  --shadow-theme: var(--shadow);
}
`;

interface TailwindModule {
  compile(
    css: string,
    opts: {
      base: string;
      loadStylesheet: (id: string, base: string) => Promise<{ path: string; base: string; content: string }>;
      loadModule: () => Promise<never>;
    },
  ): Promise<{ build(candidates: string[]): string }>;
}

/** The Tailwind a project carries, when it is the one this build knows: version 4, with no package of its own to pull in. */
export function projectTailwind(root: string): { dir: string; entry: string; version: string } | { problem: string } | null {
  // The project's own: named in its package.json. One that only happens to be reachable (hoisted by a package manager, found on NODE_PATH) is not.
  try {
    const listed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    if (listed.dependencies?.['tailwindcss'] === undefined && listed.devDependencies?.['tailwindcss'] === undefined) return null;
  } catch {
    return null;
  }
  let manifest: string;
  try {
    manifest = createRequire(join(root, 'package.json')).resolve('tailwindcss/package.json');
  } catch {
    return null;
  }
  try {
    const json = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown; version?: unknown; dependencies?: Record<string, unknown>; exports?: Record<string, unknown>; main?: unknown };
    if (json.name !== 'tailwindcss') return { problem: 'The package installed as "tailwindcss" is not Tailwind.' };
    const version = typeof json.version === 'string' ? json.version : '';
    if (!version.startsWith('4.')) return { problem: `The project has Tailwind ${version}, and this build knows Tailwind 4. Use no Tailwind class, or put Tailwind 4 in the project.` };
    if (Object.keys(json.dependencies ?? {}).length > 0) return { problem: 'This Tailwind brings packages of its own, which this build does not run.' };
    const dir = dirname(manifest);
    const entry = createRequire(join(root, 'package.json')).resolve('tailwindcss');
    return { dir, entry, version };
  } catch (error) {
    return { problem: `The project's Tailwind does not read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** How long Tailwind may take over one side. */
const TAILWIND_TIMEOUT_MS = 5000;

/**
 * Tailwind for a side, when the project has it. Its text is made here at
 * every build (the theme's values under Tailwind's names) and never read from
 * the side, so nothing a screen's author writes reaches Tailwind's compiler
 * but class names. Tailwind may read its own four stylesheets and no other
 * file, and loads no module: a plugin or a config file is code.
 *
 * The side's own stylesheets are put in Tailwind's "components" layer, so a
 * class on an element wins over a made part's rule, as people who know
 * Tailwind expect.
 */
/** Tailwind's stylesheet for a side, from the class names given: its own four files and no other, no module, in a few seconds or not at all. */
export async function tailwindCss(tailwind: { dir: string; entry: string }, src: string, candidates: string[], applied = ''): Promise<string> {
  // The package's entry may load as a CommonJS module, whose exports come under `default`.
  const loaded = (await import(pathToFileURL(tailwind.entry).href)) as Partial<TailwindModule> & { default?: Partial<TailwindModule> };
  const compile = loaded.compile ?? loaded.default?.compile;
  if (typeof compile !== 'function') throw new Error('The project\'s Tailwind has no compile() this build can call.');
  const module: TailwindModule = { compile };
  const work = (async () => {
    const compiler = await module.compile(`${TAILWIND_SOURCE}${applied}`, {
      base: src,
      loadStylesheet: async (id, base) => {
        const file = TAILWIND_OWN.get(id);
        // Tailwind's own files, asked for by name or from inside its own folder; nothing else.
        if (file === undefined || (id.startsWith('./') && base !== tailwind.dir)) throw new Error(`Tailwind may not read "${id}" here.`);
        const path = join(tailwind.dir, file);
        return { path, base: tailwind.dir, content: readFileSync(path, 'utf8') };
      },
      loadModule: async () => {
        throw new Error('Tailwind plugins and config files are not run here.');
      },
    });
    return compiler.build(candidates);
  })();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Tailwind took too long over this side.')), TAILWIND_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

const TAILWIND_OWN = new Map([
  ['tailwindcss', 'index.css'],
  ['tailwindcss/theme', 'theme.css'],
  ['tailwindcss/theme.css', 'theme.css'],
  ['tailwindcss/preflight', 'preflight.css'],
  ['tailwindcss/preflight.css', 'preflight.css'],
  ['tailwindcss/utilities', 'utilities.css'],
  ['tailwindcss/utilities.css', 'utilities.css'],
  ['./theme.css', 'theme.css'],
  ['./preflight.css', 'preflight.css'],
  ['./utilities.css', 'utilities.css'],
]);

function tailwindPlugin(tailwind: { dir: string; entry: string }, src: string, scanned: (file: string) => void) {
  // By their real paths: the bundler names a file by where it really is (a temp folder is often a link).
  const realOf = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  const layered = new Set(['app.css', 'style.css', 'design.css'].map((name) => realOf(join(src, name))));
  return {
    name: 'adminium-side-tailwind',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^adminium-tailwind\.css$/ }, () => ({ path: TAILWIND_TEXT, namespace: 'adminium-tailwind' }));
      /**
       * A stylesheet of the app's that uses `@apply` is Tailwind's to compile: its text goes in with Tailwind's own, in the
       * components layer. It may then hold rules and nothing that loads or runs: Tailwind is given no path of the app's to follow.
       */
      const applied = (): { files: Set<string>; text: string } => {
        const files = new Set<string>();
        let text = '';
        for (const file of layered) {
          if (!existsSync(file)) continue;
          const css = readFileSync(file, 'utf8');
          const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
          if (!/@apply\b/.test(bare)) continue;
          const loads = /@(import|source|plugin|config|reference)\b/.exec(bare);
          if (loads !== null) throw new Error(`${basename(file)} uses @apply and @${loads[1] as string} together: a stylesheet with @apply holds rules only. Take the @${loads[1] as string} out.`);
          files.add(file);
          text += `\n@layer components {\n${css}\n}\n`;
        }
        return { files, text };
      };
      build.onLoad({ filter: /.*/, namespace: 'adminium-tailwind' }, async () => ({ contents: await tailwindCss(tailwind, src, classCandidates(src, scanned), applied().text), loader: 'css', resolveDir: src }));
      build.onLoad({ filter: /\.css$/ }, (args) => {
        if (!layered.has(realOf(args.path))) return null;
        // Compiled with Tailwind's own text, where its @apply is understood: nothing of it is left to load here.
        if (applied().files.has(realOf(args.path))) return { contents: '', loader: 'css', resolveDir: dirname(args.path) };
        const text = readFileSync(args.path, 'utf8');
        // What must stand first in a stylesheet stays above the layer.
        const first: string[] = [];
        const rest = text.replace(/^\s*@(?:import|charset)\b[^;]*;/gm, (line) => {
          first.push(line.trim());
          return '';
        });
        return { contents: `${first.join('\n')}\n@layer theme, base, components, utilities;\n@layer components {\n${rest}\n}\n`, loader: 'css', resolveDir: dirname(args.path) };
      });
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

/** The app's name as its manifest spells it (part files, or one manifest.json); empty when it does not read as one. */
function manifestName(root: string, key: string): string {
  for (const file of [join(appDir(root, key), 'manifest', 'app.json'), join(appDir(root, key), 'manifest.json')]) {
    if (!existsSync(file)) continue;
    try {
      const name = (JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown }).name;
      if (typeof name === 'string') return name;
      // A name per language: the English one.
      if (name !== null && typeof name === 'object') {
        const english = (name as Record<string, unknown>)['en-US'] ?? (name as Record<string, unknown>)['fallback'];
        if (typeof english === 'string') return english;
      }
    } catch {
      // The check says what is wrong with the file; the build goes on without a name.
    }
    return '';
  }
  return '';
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

  const src = join(source, 'src');
  // Tailwind, when the project carries the one this build knows; a project without it builds as it always did.
  const tailwind = projectTailwind(root);
  if (tailwind !== null && 'problem' in tailwind) throw new CliError(`Could not build the ${side} side of "${key}":\n${tailwind.problem}`);
  const scanned: string[] = [];

  let result: Awaited<ReturnType<Bundler['build']>>;
  try {
    result = await opts.bundler.build({
      absWorkingDir: root,
      entryPoints: { main: SIDE_ENTRY },
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
        // The name in the manifest now: a screen's header follows a rename at the next build.
        __ADMINIUM_APP_NAME__: JSON.stringify(manifestName(root, key)),
        __ADMINIUM_SIDE__: JSON.stringify(side),
        // A bundle `adminium dev` built asks the server whether it was rebuilt, and reloads.
        __ADMINIUM_DEV__: JSON.stringify(opts.dev === true),
      },
      metafile: true,
      logLevel: 'silent',
      plugins: [
        sideEntryPlugin(src, tailwind !== null),
        sideModulePlugin(root, opts.sideModule ?? engineSideModule()),
        ...(tailwind === null ? [] : [tailwindPlugin(tailwind, src, (file) => scanned.push(file))]),
        containmentPlugin(root, key),
      ],
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

    // The app's logo is the page's icon: copied beside the page, under a name that changes when it does.
    const logo = join(appDir(root, key), 'assets', 'logo.svg');
    let icon: string | null = null;
    if (existsSync(logo) && lstatSync(logo).isFile() && statSync(logo).size <= 64 * 1024) {
      const name = `logo-${sha256(logo).slice(0, 8)}.svg`;
      cpSync(logo, join(staging, 'assets', name));
      icon = `${prefix}/assets/${name}`;
    }

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
        ...(icon === null ? [] : [`<link rel="icon" type="image/svg+xml" href="${icon}">`]),
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
    // Every file Tailwind read class names from: a class changed in one changes the stylesheet.
    for (const file of scanned) inputs[toProjectPath(root, file)] = sha256(file);

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
