// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Building a project's browser code: `pages/*.tsx` and
 * `widgets/*.tsx`.
 *
 * Two esbuild runs over the same files:
 *
 * 1. **Their settings.** Each file is bundled once more for Node, with every
 *    npm package replaced by an inert stand-in, and run in a fresh `vm`
 *    context whose host runtime is a stand-in too. That evaluates the file's
 *    own top-level code, which is where `definePage({ title, nav, … })` sits,
 *    and nothing a library would do on import. The server needs a page's
 *    title and sidebar place without a browser; this is where it gets them.
 * 2. **The files the browser loads.** ES modules, one per page or widget plus
 *    shared chunks, with content-hashed names. `react`, `react/jsx-runtime`,
 *    `react/compiler-runtime`, `react-dom` and `@adminiumjs/adminium/ui`
 *    resolve to shims that read the dashboard's copies from the host runtime
 *    global (`@adminium/add-on-contracts/runtime`), so a page renders with the
 *    dashboard's one React. A bare import left in the output fails the build:
 *    a browser could not resolve it.
 *
 * The output goes to `.adminium/build/client/`, replacing what was there in
 * one rename, and the build manifest lists every file with its hashes.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { PROJECT_UI_EXPORTS } from '@adminium/add-on-contracts/runtime';
import { z } from 'zod';

import { CliError } from '../cli/exit.js';
import { isPageSlug, PAGES_DIR, toProjectPath } from './paths.js';

/** Built pages and widgets, under the build folder. */
export const CLIENT_DIR = 'client';
/** The folders browser code lives in, which are also its kinds. */
export const CLIENT_CODE_FOLDERS = ['pages', 'widgets'] as const;
export type ClientKind = (typeof CLIENT_CODE_FOLDERS)[number];
const CLIENT_SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'];

/**
 * The URL the server serves the client folder under (`routes/project`). The
 * built files do not contain it: they refer to each other by relative paths.
 */
export const CLIENT_PUBLIC_PATH = '/api/v1/project/client/';

/** What browser code imports its kit from. */
export const UI_PACKAGE = '@adminiumjs/adminium/ui';

/** A widget is `project.<file name>`; the file name travels in page files and URLs. */
export const WIDGET_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const WIDGET_ID_PREFIX = 'project.';

/** The browsers the dashboard itself supports. */
const CLIENT_TARGET = ['es2022', 'chrome111', 'edge111', 'firefox114', 'safari16.4'];

/** Files esbuild copies next to the output, referenced by URL. */
const ASSET_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf'];

export interface ClientCodeSource {
  kind: ClientKind;
  /** The file name without its extension: the page's address, or the widget's name. */
  name: string;
  /** Relative to the project, with `/`: `pages/revenue.tsx`. */
  source: string;
}

export interface BuiltClientFile {
  /** Relative to the client folder, with `/`: `pages/revenue-5KX2P.js`. */
  path: string;
  /** sha256 hex, checked before the server serves the file. */
  hash: string;
  /** Subresource integrity, `sha384-…`, checked by the browser. */
  integrity: string;
}

interface BuiltEntry {
  name: string;
  source: string;
  /** The ES module to import, relative to the client folder. */
  module: string;
  /** Every chunk the module imports, directly or not. */
  imports: string[];
  styles: string[];
}

export interface BuiltClientPage extends BuiltEntry {
  title: string;
  icon: string;
  nav: { group: NavGroup; order: number | null; hidden: boolean };
}

export interface BuiltClientWidget extends BuiltEntry {
  kind: 'cell' | 'card';
  title: string | null;
}

export interface ClientBuild {
  /** Changes whenever an output changes; '' when there is no browser code. */
  digest: string;
  pages: BuiltClientPage[];
  widgets: BuiltClientWidget[];
  files: BuiltClientFile[];
  /** sha256 of every project file the build read. */
  inputs: Record<string, string>;
}

export const EMPTY_CLIENT_BUILD: ClientBuild = { digest: '', pages: [], widgets: [], files: [], inputs: {} };

// ─── Sources ────────────────────────────────────────────────────────────────

/** Whether the folder has a page of code at this address, such as `pages/orders.tsx`. */
export function hasCodePage(root: string, slug: string): boolean {
  return CLIENT_SOURCE_EXTENSIONS.some((extension) => existsSync(join(root, PAGES_DIR, `${slug}${extension}`)));
}

/**
 * The page and widget files: the top level of `pages/` and `widgets/`, in
 * TypeScript or JavaScript. As with hooks, names starting with `.` or `_` are
 * left out (`_chart.tsx` is a helper), and so are tests and `.d.ts` files. In
 * `pages/`, a `.json` file is a page file (`page-files.ts`), not code.
 */
export function clientCodeSources(root: string): ClientCodeSource[] {
  const out: ClientCodeSource[] = [];
  for (const kind of CLIENT_CODE_FOLDERS) {
    const dir = join(root, kind);
    if (!existsSync(dir)) continue;
    const seen = new Map<string, string>();
    const pageFiles = new Set<string>();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      if (kind === PAGES_DIR && entry.name.endsWith('.json')) {
        pageFiles.add(entry.name.slice(0, -'.json'.length));
        continue;
      }
      if (entry.name.endsWith('.d.ts') || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) continue;
      const extension = extname(entry.name);
      if (!CLIENT_SOURCE_EXTENSIONS.includes(extension)) continue;
      const name = entry.name.slice(0, -extension.length);
      const other = seen.get(name);
      if (other !== undefined) {
        throw new CliError(`${kind}/${other} and ${kind}/${entry.name} have the same name. Keep one of them.`);
      }
      if (kind === 'pages' && !isPageSlug(name)) {
        throw new CliError(
          `pages/${entry.name}: a page's file name is its address, so it must be lowercase letters, digits and "-", at most 31 characters.`,
        );
      }
      if (kind === 'widgets' && !WIDGET_NAME_PATTERN.test(name)) {
        throw new CliError(
          `widgets/${entry.name}: a widget is named after its file, so the name must be lowercase letters, digits and "-".`,
        );
      }
      seen.set(name, entry.name);
      out.push({ kind, name, source: `${kind}/${entry.name}` });
    }
    for (const [name, file] of seen) {
      if (pageFiles.has(name)) {
        throw new CliError(
          `pages/${name}.json and pages/${file} both describe the page at /p/${name}. Keep one of them.`,
        );
      }
    }
  }
  return out.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const sri = (bytes: Buffer): string => `sha384-${createHash('sha384').update(bytes).digest('base64')}`;

/** One output file, as esbuild's metafile describes it. */
export interface BundleOutput {
  entryPoint?: string;
  cssBundle?: string;
  imports: { path: string; kind: string; external?: boolean }[];
}

/** The slice of esbuild the project build uses (`build.ts` shares it). */
export interface ClientBundler {
  build(options: Record<string, unknown>): Promise<{
    metafile?: { inputs: Record<string, unknown>; outputs?: Record<string, BundleOutput> };
    outputFiles?: { path: string; text: string }[];
  }>;
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
  external?: boolean;
  errors?: { text: string }[];
}

interface PluginBuild {
  onResolve(
    options: { filter: RegExp; namespace?: string },
    callback: (args: ResolveArgs) => ResolveResult | undefined | Promise<ResolveResult | undefined>,
  ): void;
  onLoad(
    options: { filter: RegExp; namespace: string },
    callback: (args: { path: string }) => { contents: string; loader: string; resolveDir?: string },
  ): void;
  resolve(
    path: string,
    options: { resolveDir: string; kind: string; importer: string; namespace: string; pluginData: unknown },
  ): Promise<{ path: string; errors: { text: string }[] }>;
}

/** Where the shims live: the contract's own files, and this package's UI kit module. */
export interface ClientShims {
  react: string;
  jsxRuntime: string;
  compilerRuntime: string;
  reactDom: string;
  ui: string;
}

export function defaultClientShims(): ClientShims {
  const runtime = createRequire(import.meta.url).resolve('@adminium/add-on-contracts/runtime');
  const dir = dirname(runtime);
  const extension = extname(runtime);
  // `dist/project/client-build.js` → `dist/ui/index.js`; from source under
  // vitest, `src/project/client-build.ts` → `src/ui/index.ts`.
  const uiJs = fileURLToPath(new URL('../ui/index.js', import.meta.url));
  const ui = existsSync(uiJs) ? uiJs : fileURLToPath(new URL('../ui/index.ts', import.meta.url));
  return {
    react: join(dir, `react${extension}`),
    jsxRuntime: join(dir, `jsx-runtime${extension}`),
    compilerRuntime: join(dir, `compiler-runtime${extension}`),
    reactDom: join(dir, `react-dom${extension}`),
    ui,
  };
}

/** `react`, its runtimes, `react-dom` and the UI kit resolve to the shims. */
function runtimePlugin(shims: ClientShims) {
  return {
    name: 'adminium-host-runtime',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => {
        switch (args.path) {
          case 'react':
            return { path: shims.react };
          case 'react/jsx-runtime':
          case 'react/jsx-dev-runtime':
            return { path: shims.jsxRuntime };
          case 'react/compiler-runtime':
            return { path: shims.compilerRuntime };
          case 'react-dom':
            return { path: shims.reactDom };
          default:
            return {
              errors: [
                {
                  text:
                    `"${args.path}" is not available to pages and widgets. The dashboard provides react, ` +
                    'react/jsx-runtime, react/compiler-runtime and react-dom; it renders the page itself.',
                },
              ],
            };
        }
      });
      build.onResolve({ filter: /^@adminiumjs\/adminium(\/.*)?$/ }, (args) =>
        args.path === UI_PACKAGE
          ? { path: shims.ui }
          : {
              errors: [
                {
                  text: `Pages and widgets import from "${UI_PACKAGE}". "${args.path}" is server code, for hooks and actions.`,
                },
              ],
            },
      );
    },
  };
}

const ASSET_FILTER = new RegExp(`(${ASSET_EXTENSIONS.map((extension) => `\\${extension}`).join('|')})$`, 'i');

/**
 * An asset a module imports becomes a URL relative to that module.
 *
 * esbuild writes the asset's path relative to the output file that uses it,
 * which is right for a stylesheet's `url()`. In JavaScript the same string
 * would be resolved against the page (`/p/revenue`) instead, so the import is
 * wrapped: `new URL(path, import.meta.url)`. The output needs no public path,
 * and chunks import each other by relative paths too, so the build works under
 * whatever URL the server gives the folder.
 */
function assetPlugin() {
  return {
    name: 'adminium-asset-urls',
    setup(build: PluginBuild) {
      build.onResolve({ filter: ASSET_FILTER }, async (args) => {
        const inner = (args.pluginData as { adminiumAsset?: boolean } | undefined)?.adminiumAsset === true;
        if (inner || args.namespace === 'adminium-asset' || args.kind === 'url-token' || args.kind === 'import-rule') {
          return undefined;
        }
        const resolved = await build.resolve(args.path, {
          resolveDir: args.resolveDir,
          kind: args.kind,
          importer: args.importer,
          namespace: 'file',
          pluginData: { adminiumAsset: true },
        });
        if (resolved.errors.length > 0) return { errors: resolved.errors };
        return { path: resolved.path, namespace: 'adminium-asset' };
      });
      build.onLoad({ filter: /.*/, namespace: 'adminium-asset' }, (args) => ({
        contents: `import file from ${JSON.stringify(`./${basename(args.path)}`)};\nexport default new URL(file, import.meta.url).href;\n`,
        loader: 'js',
        resolveDir: dirname(args.path),
      }));
    },
  };
}

/** Is this import a package, as opposed to a file of the project? */
const isBareSpecifier = (path: string): boolean =>
  !path.startsWith('.') && !path.startsWith('/') && !isAbsolute(path) && !path.startsWith('node:');

// ─── 1. Reading each file's settings ────────────────────────────────────────

/**
 * An inert stand-in for any value: callable, constructible, every property
 * is itself, and it is nobody's promise. Its prototype is itself too, which
 * is what makes esbuild's CommonJS interop hand out a stand-in for every
 * named import.
 */
const STAND_IN_SOURCE = String.raw`
function makeStandIn() {
  const target = function standIn() {};
  const empty = function* () {};
  const proxy = new Proxy(target, {
    get(t, key) {
      if (key === 'prototype') return t.prototype;
      if (key === Symbol.iterator) return empty;
      if (key === Symbol.toPrimitive) return () => '';
      if (typeof key === 'symbol' || key === 'then' || key === '__esModule') return undefined;
      return proxy;
    },
    getPrototypeOf: () => proxy,
    apply: () => proxy,
    construct: () => proxy,
  });
  return proxy;
}
`;

/** Every npm package, in the settings run: the stand-in. */
const PACKAGE_STUB = `${STAND_IN_SOURCE}\nmodule.exports = makeStandIn();\n`;

/**
 * Packages become the stand-in, except Adminium's own runtime contract, which
 * the kit module and the React shims read the (stand-in) host runtime with.
 */
function settingsPlugin() {
  return {
    name: 'adminium-settings-stubs',
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point' || !isBareSpecifier(args.path)) return undefined;
        if (args.path.startsWith('@adminium/add-on-contracts/')) return undefined;
        return { path: args.path, namespace: 'adminium-stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'adminium-stub' }, () => ({ contents: PACKAGE_STUB, loader: 'js' }));
    },
  };
}

const navGroupSchema = z.enum(['workspace', 'library', 'planning', 'people', 'account']);
export type NavGroup = z.infer<typeof navGroupSchema>;

const componentSchema = z.custom<unknown>(
  (value) => typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value),
  { message: 'must be a React component' },
);

const iconSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a Lucide icon name, such as "chart-line"')
  .max(60);

const pageDefinitionSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    icon: iconSchema.optional(),
    nav: z
      .object({
        group: navGroupSchema.optional(),
        order: z.number().int().min(-100_000).max(100_000).optional(),
        hidden: z.boolean().optional(),
      })
      .strict()
      .optional(),
    component: componentSchema,
  })
  .strict();

const widgetDefinitionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cell'), component: componentSchema }).strict(),
  z.object({ kind: z.literal('card'), title: z.string().trim().min(1).max(80).optional(), component: componentSchema }).strict(),
]);

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      if (issue.code === 'unrecognized_keys') return `unknown option ${issue.keys.map((key) => `"${key}"`).join(', ')}`;
      const path = issue.path.map(String).join('.');
      return path === '' ? issue.message : `${path} ${issue.message}`;
    })
    .join('; ');
}

type Settings =
  | { kind: 'pages'; title: string; icon: string; nav: BuiltClientPage['nav'] }
  | { kind: 'widgets'; widget: 'cell' | 'card'; title: string | null };

/** How long a file's top-level code may run while its settings are read. */
const SETTINGS_TIMEOUT_MS = 5000;

/** Run one settings bundle, and check what it exports. */
export function readSettings(
  source: ClientCodeSource,
  code: string,
  opts: { timeoutMs?: number } = {},
): Settings {
  const standIn = new vm.Script(`${STAND_IN_SOURCE}\nmakeStandIn();`).runInNewContext({}) as unknown;
  const ui = Object.fromEntries(PROJECT_UI_EXPORTS.map((name) => [name, standIn]));
  const module = { exports: {} as Record<string, unknown> };
  const sandbox: Record<string, unknown> = {
    module,
    exports: module.exports,
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    __ADMINIUM_ADD_ON_RUNTIME__: {
      react: standIn,
      jsx: { jsx: standIn, jsxs: standIn, Fragment: standIn },
      reactDom: standIn,
      ui,
    },
  };
  try {
    vm.runInNewContext(code, sandbox, { filename: source.source, timeout: opts.timeoutMs ?? SETTINGS_TIMEOUT_MS });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new CliError(
      `${source.source}: its top-level code failed while Adminium read its settings (${reason}).`,
      {
        hint:
          'Adminium runs the code outside any component once, without a browser, to read the page or widget settings.\n' +
          'Move code that needs the browser (window, document, storage) into the component or an effect.',
      },
    );
  }
  const exported = (module.exports as { default?: unknown }).default;
  const helper = source.kind === 'pages' ? 'definePage' : 'defineWidget';
  if (exported === undefined) {
    throw new CliError(`${source.source} has no default export. End it with \`export default ${helper}({ … })\`.`);
  }
  if (source.kind === 'pages') {
    const parsed = pageDefinitionSchema.safeParse(exported);
    if (!parsed.success) throw new CliError(`${source.source}: the page is not valid: ${describeIssues(parsed.error)}.`);
    return {
      kind: 'pages',
      title: parsed.data.title,
      icon: parsed.data.icon ?? 'file',
      nav: {
        group: parsed.data.nav?.group ?? 'workspace',
        order: parsed.data.nav?.order ?? null,
        hidden: parsed.data.nav?.hidden ?? false,
      },
    };
  }
  const parsed = widgetDefinitionSchema.safeParse(exported);
  if (!parsed.success) throw new CliError(`${source.source}: the widget is not valid: ${describeIssues(parsed.error)}.`);
  return {
    kind: 'widgets',
    widget: parsed.data.kind,
    title: parsed.data.kind === 'card' ? (parsed.data.title ?? null) : null,
  };
}

/** esbuild's error list, as lines a person can act on. */
function describeBuildFailure(error: unknown): string {
  const errors = (error as { errors?: { text: string; location?: { file: string; line: number; column: number } }[] })
    .errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return error instanceof Error ? error.message : String(error);
  }
  return errors
    .map((e) => (e.location ? `${e.location.file}:${String(e.location.line)}:${String(e.location.column)}: ${e.text}` : e.text))
    .join('\n');
}

const assetLoaders = (loader: 'file' | 'empty'): Record<string, string> =>
  Object.fromEntries(ASSET_EXTENSIONS.map((extension) => [extension, loader]));

async function readAllSettings(
  root: string,
  sources: readonly ClientCodeSource[],
  bundler: ClientBundler,
  shims: ClientShims,
): Promise<Map<string, Settings>> {
  let result;
  try {
    result = await bundler.build({
      absWorkingDir: root,
      entryPoints: sources.map((file) => ({ in: join(root, file.source), out: `${file.kind}/${file.name}` })),
      outdir: join(root, '.adminium', 'settings'),
      write: false,
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      loader: assetLoaders('empty'),
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
      plugins: [runtimePlugin(shims), settingsPlugin()],
    });
  } catch (error) {
    throw new CliError(`Could not build the project's pages and widgets:\n${describeBuildFailure(error)}`);
  }
  const outputs = result.outputFiles ?? [];
  const settings = new Map<string, Settings>();
  for (const source of sources) {
    // Output paths are the platform's own; compare them with `/` either way.
    const suffix = `/${source.kind}/${source.name}.js`;
    const output = outputs.find((file) => file.path.replaceAll('\\', '/').endsWith(suffix));
    if (output === undefined) throw new CliError(`${source.source} produced no output.`);
    settings.set(source.source, readSettings(source, output.text));
  }
  return settings;
}

// ─── 2. The browser build ───────────────────────────────────────────────────

/** Static and literal dynamic imports in built JavaScript. */
const STATIC_IMPORT = /(?:^|[\s;}])(?:import|export)\s*(?:[\w$*{}\s,]*?\s*from\s*)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** The package imports a browser would be asked to resolve. */
export function bareImportsIn(code: string): string[] {
  const found = new Set<string>();
  for (const pattern of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1] as string;
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) found.add(specifier);
    }
  }
  return [...found].sort();
}

/** Every chunk a module imports statically, directly or through other chunks. */
function staticImports(outputs: Record<string, BundleOutput>, start: string): string[] {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const entry of outputs[current]?.imports ?? []) {
      if (entry.kind !== 'import-statement' || entry.external === true) continue;
      if (!seen.has(entry.path)) {
        seen.add(entry.path);
        queue.push(entry.path);
      }
    }
  }
  return [...seen].sort();
}

function inputsOf(root: string, inputs: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const input of Object.keys(inputs)) {
    // Virtual modules have a namespace prefix and no file.
    if (input.includes(':') && !isAbsolute(input)) continue;
    const file = resolve(root, input);
    // Installed packages, and Adminium's own shims, are the lockfile's business.
    if (file.split(sep).includes('node_modules') || !file.startsWith(`${root}${sep}`)) continue;
    if (existsSync(file)) out[toProjectPath(root, file)] = sha256(readFileSync(file));
  }
  return out;
}

export interface BuildClientOptions {
  bundler: ClientBundler;
  /** `adminium dev`: readable output, and React's development checks in libraries. */
  dev?: boolean;
  shims?: ClientShims;
}

/**
 * Bundle the pages and widgets into `<buildDir>/client/`, replacing what was
 * there, and describe the result for the manifest.
 */
export async function buildClientCode(root: string, buildDir: string, opts: BuildClientOptions): Promise<ClientBuild> {
  const out = join(buildDir, CLIENT_DIR);
  const sources = clientCodeSources(root);
  if (sources.length === 0) {
    rmSync(out, { recursive: true, force: true });
    return EMPTY_CLIENT_BUILD;
  }
  const shims = opts.shims ?? defaultClientShims();
  const settings = await readAllSettings(root, sources, opts.bundler, shims);

  const next = `${out}.next-${String(process.pid)}`;
  rmSync(next, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  let result;
  try {
    result = await opts.bundler.build({
      absWorkingDir: root,
      entryPoints: sources.map((file) => ({ in: join(root, file.source), out: `${file.kind}/${file.name}` })),
      outdir: next,
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      target: CLIENT_TARGET,
      jsx: 'automatic',
      minify: opts.dev !== true,
      sourcemap: false,
      legalComments: 'none',
      metafile: true,
      logLevel: 'silent',
      // Every output sits one folder deep (`pages/`, `widgets/`, `chunks/`,
      // `assets/`), and every reference between them is relative.
      entryNames: '[dir]/[name]-[hash]',
      chunkNames: 'chunks/[name]-[hash]',
      assetNames: 'assets/[name]-[hash]',
      loader: assetLoaders('file'),
      define: { 'process.env.NODE_ENV': opts.dev === true ? '"development"' : '"production"' },
      plugins: [runtimePlugin(shims), assetPlugin()],
    });
  } catch (error) {
    rmSync(next, { recursive: true, force: true });
    throw new CliError(`Could not build the project's pages and widgets:\n${describeBuildFailure(error)}`);
  }

  const metafile = result.metafile;
  if (metafile?.outputs === undefined) {
    rmSync(next, { recursive: true, force: true });
    throw new CliError('esbuild did not describe the pages and widgets it built.');
  }
  const outputs = metafile.outputs;
  // Output paths in the metafile are relative to the working directory.
  const toClientPath = (output: string): string => toProjectPath(next, resolve(root, output));

  const problems: string[] = [];
  const files: BuiltClientFile[] = [];
  for (const [output, info] of Object.entries(outputs)) {
    const path = toClientPath(output);
    const bytes = readFileSync(resolve(root, output));
    files.push({ path, hash: sha256(bytes), integrity: sri(bytes) });
    const externals = info.imports.filter((entry) => entry.external === true && isBareSpecifier(entry.path));
    const bare = path.endsWith('.js')
      ? [...new Set([...externals.map((entry) => entry.path), ...bareImportsIn(bytes.toString('utf8'))])]
      : [];
    if (bare.length > 0) problems.push(`${path} still imports ${bare.map((name) => `"${name}"`).join(', ')}`);
  }
  if (problems.length > 0) {
    rmSync(next, { recursive: true, force: true });
    throw new CliError(`The built pages and widgets would ask the browser for packages it cannot load:\n  ${problems.join('\n  ')}`);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const pages: BuiltClientPage[] = [];
  const widgets: BuiltClientWidget[] = [];
  for (const source of sources) {
    const entryPoint = toProjectPath(root, join(root, source.source));
    const found = Object.entries(outputs).find(
      ([output, info]) => info.entryPoint === entryPoint && output.endsWith('.js'),
    );
    if (found === undefined) {
      rmSync(next, { recursive: true, force: true });
      throw new CliError(`${source.source} produced no module.`);
    }
    const [output, info] = found;
    const entry: BuiltEntry = {
      name: source.name,
      source: source.source,
      module: toClientPath(output),
      imports: staticImports(outputs, output).map(toClientPath),
      styles: info.cssBundle === undefined ? [] : [toClientPath(info.cssBundle)],
    };
    const read = settings.get(source.source) as Settings;
    if (read.kind === 'pages') pages.push({ ...entry, title: read.title, icon: read.icon, nav: read.nav });
    else widgets.push({ ...entry, kind: read.widget, title: read.title });
  }

  // Replace the old output in one step, so a request never sees half of each.
  const old = `${out}.old-${String(process.pid)}`;
  rmSync(old, { recursive: true, force: true });
  if (existsSync(out)) renameSync(out, old);
  renameSync(next, out);
  rmSync(old, { recursive: true, force: true });

  const digest = createHash('sha256')
    .update(JSON.stringify({ pages, widgets, files: files.map((file) => [file.path, file.hash]) }))
    .digest('hex');
  return { digest, pages, widgets, files, inputs: inputsOf(root, metafile.inputs) };
}

/**
 * The pages and widgets a build manifest lists: none when there is no
 * manifest or it lists none, and null when the manifest cannot be read.
 */
export function readClientBuild(buildDir: string): ClientBuild | null {
  const file = join(buildDir, 'manifest.json');
  if (!existsSync(file)) return EMPTY_CLIENT_BUILD;
  try {
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { client?: Partial<ClientBuild> };
    const client = manifest.client;
    if (
      client === undefined ||
      typeof client.digest !== 'string' ||
      !Array.isArray(client.pages) ||
      !Array.isArray(client.widgets) ||
      !Array.isArray(client.files)
    ) {
      return EMPTY_CLIENT_BUILD;
    }
    return { digest: client.digest, pages: client.pages, widgets: client.widgets, files: client.files, inputs: client.inputs ?? {} };
  } catch {
    return null;
  }
}

// ─── Staleness ──────────────────────────────────────────────────────────────

/** Why the built pages and widgets are out of date, or null when they are not. */
export function clientCodeStaleReason(root: string, buildDir: string, built: ClientBuild | undefined): string | null {
  const sources = clientCodeSources(root).map((file) => file.source);
  if (built === undefined) return sources.length === 0 ? null : 'its pages and widgets have not been built';
  const listed = [...built.pages, ...built.widgets].map((entry) => entry.source);
  const added = sources.find((source) => !listed.includes(source));
  if (added !== undefined) return `${added} is new since the last build`;
  const removed = listed.find((source) => !sources.includes(source));
  if (removed !== undefined) return `${removed} was removed since the last build`;
  for (const file of built.files) {
    const output = join(buildDir, CLIENT_DIR, ...file.path.split('/'));
    if (!existsSync(output) || sha256(readFileSync(output)) !== file.hash) return `client/${file.path} is missing or was changed`;
  }
  for (const [path, hash] of Object.entries(built.inputs)) {
    const file = resolve(root, path);
    if (!existsSync(file) || sha256(readFileSync(file)) !== hash) return `${path} changed since the last build`;
  }
  return null;
}
