// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Building a project, and loading what the build produced.
 *
 * `adminium build` compiles `adminium.config.ts` into
 * `.adminium/build/config.mjs`, bundles `hooks/*.ts` and `actions/*.ts` into
 * `.adminium/build/server/` and `pages/*.tsx` and `widgets/*.tsx` into
 * `.adminium/build/client/` (`client-build.ts`), and records a manifest: the
 * Adminium version that built it and a hash of every file that went in. `start` loads that output,
 * so a server needs no TypeScript tooling and a project image needs no source
 * files beyond the config.
 *
 * The compiler is esbuild, loaded from the PROJECT's own dependencies (it is a
 * devDependency there), so an Adminium install does not carry it. Imports of
 * `@adminiumjs/adminium` resolve to a tiny inlined module with the `define*`
 * helpers, so the output runs where the package is absent. Server code is
 * bundled with its npm dependencies, except packages with native code, which
 * stay imports and must be installed where the server runs.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CliError } from '../cli/exit.js';
import {
  buildClientCode,
  clientCodeSources,
  clientCodeStaleReason,
  type ClientBuild,
  type ClientBundler,
} from './client-build.js';
import { parseProjectConfig, type ProjectConfig } from './config.js';
import { configFileName, type ProjectLocation } from './locate.js';
import { toProjectPath } from './paths.js';

export const BUILD_DIR = join('.adminium', 'build');
const BUILT_CONFIG = 'config.mjs';
const MANIFEST = 'manifest.json';
/** Bundled hooks and actions, under the build folder. */
export const SERVER_DIR = 'server';
/** The folders server code lives in, which are also its kinds. */
export const SERVER_CODE_FOLDERS = ['hooks', 'actions'] as const;
const SOURCE_EXTENSIONS = ['.ts', '.mts', '.js', '.mjs'];

/** The package name project code imports its helpers from. */
export const HELPERS_PACKAGE = '@adminiumjs/adminium';

/**
 * What the inlined helpers module exports: the same small functions
 * `@adminiumjs/adminium` exports from `project/config.ts`, as plain JavaScript.
 */
export const HELPERS_SOURCE = [
  'export const defineConfig = (config) => config;',
  'export const defineHook = (definition) => definition;',
  'export const defineAction = (definition) => definition;',
  'export const env = (name, fallback) => {',
  '  const value = process.env[name];',
  "  return value === undefined || value === '' ? fallback : value;",
  '};',
  '',
].join('\n');

/**
 * Lets a bundled CommonJS dependency call `require` inside an ES module.
 * Without it, esbuild's shim throws "Dynamic require is not supported".
 */
const REQUIRE_BANNER =
  "import { createRequire as __adminiumCreateRequire } from 'node:module'; const require = __adminiumCreateRequire(import.meta.url);";

export interface ServerCodeSource {
  kind: (typeof SERVER_CODE_FOLDERS)[number];
  /** The file name without its extension. */
  name: string;
  /** Relative to the project, with `/`: `hooks/orders.ts`. */
  source: string;
}

export interface BuiltServerFile extends ServerCodeSource {
  /** Relative to the build folder: `server/hooks/orders.mjs`. */
  output: string;
  /** sha256 of the output. */
  hash: string;
}

export interface BuildManifest {
  adminiumVersion: string;
  builtAt: string;
  config: {
    /** The config file, relative to the project. */
    entry: string;
    /** sha256 of every project file the build read, by relative path. */
    inputs: Record<string, string>;
  };
  /** Hooks and actions. Absent in a build made before they existed. */
  server?: {
    /** Changes whenever an output changes; '' when there is no server code. */
    digest: string;
    files: BuiltServerFile[];
    /** sha256 of every project file the server build read. */
    inputs: Record<string, string>;
  };
  /** Pages and widgets (`client-build.ts`). Absent in a build made before they existed. */
  client?: ClientBuild;
}

/** The slice of esbuild's API this module uses. */
export type Bundler = ClientBundler;

export type LoadBundler = (root: string) => Promise<Bundler | null>;

/**
 * esbuild, from a `node_modules` folder in the project or above it (a
 * workspace root), or null when there is none. Only real `node_modules`
 * folders count: NODE_PATH and global folders are not the project's
 * dependencies.
 */
export const loadProjectBundler: LoadBundler = async (root) => {
  let manifest: string | null = null;
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', 'esbuild', 'package.json');
    if (existsSync(candidate)) {
      manifest = candidate;
      break;
    }
    if (dirname(dir) === dir) break;
  }
  if (manifest === null) return null;
  let entry: string;
  try {
    entry = createRequire(manifest).resolve('esbuild');
  } catch {
    return null;
  }
  const mod = (await import(pathToFileURL(entry).href)) as { build?: unknown; default?: { build?: unknown } };
  const candidate = typeof mod.build === 'function' ? mod : mod.default;
  return typeof candidate?.build === 'function' ? (candidate as Bundler) : null;
};

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

/**
 * The hook and action files: the top level of `hooks/` and `actions/`, in
 * TypeScript or JavaScript. Names starting with `.` or `_` are left out, so a
 * shared helper can sit beside them as `_shared.ts`.
 */
export function serverCodeSources(root: string): ServerCodeSource[] {
  const out: ServerCodeSource[] = [];
  for (const kind of SERVER_CODE_FOLDERS) {
    const dir = join(root, kind);
    if (!existsSync(dir)) continue;
    const seen = new Map<string, string>();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
      if (entry.name.endsWith('.d.ts') || /\.test\.[cm]?[jt]s$/.test(entry.name)) continue;
      const extension = extname(entry.name);
      if (!SOURCE_EXTENSIONS.includes(extension)) continue;
      const name = entry.name.slice(0, -extension.length);
      const other = seen.get(name);
      if (other !== undefined) {
        throw new CliError(`${kind}/${other} and ${kind}/${entry.name} have the same name. Keep one of them.`);
      }
      seen.set(name, entry.name);
      out.push({ kind, name, source: `${kind}/${entry.name}` });
    }
  }
  return out.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
}

/** Write a file so a reader never sees half of it. */
function writeAtomically(file: string, text: string): void {
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}

export function buildDir(project: ProjectLocation): string {
  return join(project.root, BUILD_DIR);
}

export function readBuildManifest(project: ProjectLocation): BuildManifest | null {
  const file = join(buildDir(project), MANIFEST);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as BuildManifest;
  } catch {
    return null;
  }
}

/** A changed input, or null when every file hashes as it did. */
function changedInput(root: string, inputs: Record<string, string>): string | null {
  for (const [path, hash] of Object.entries(inputs)) {
    const file = resolve(root, path);
    if (!existsSync(file) || sha256(file) !== hash) return `${path} changed since the last build`;
  }
  return null;
}

/** Why the built hooks and actions are out of date, or null when they are not. */
export function serverCodeStaleReason(project: ProjectLocation, manifest: BuildManifest): string | null {
  const sources = serverCodeSources(project.root).map((file) => file.source);
  const built = manifest.server;
  if (built === undefined) return sources.length === 0 ? null : 'its hooks and actions have not been built';
  const listed = built.files.map((file) => file.source);
  const added = sources.find((source) => !listed.includes(source));
  if (added !== undefined) return `${added} is new since the last build`;
  const removed = listed.find((source) => !sources.includes(source));
  if (removed !== undefined) return `${removed} was removed since the last build`;
  for (const file of built.files) {
    const output = join(buildDir(project), file.output);
    if (!existsSync(output) || sha256(output) !== file.hash) return `${file.output} is missing or was changed`;
  }
  return changedInput(project.root, built.inputs);
}

/** Why the build output cannot be used as it is, or null when it can. */
export function staleReason(project: ProjectLocation, version: string): string | null {
  const manifest = readBuildManifest(project);
  if (manifest === null || !existsSync(join(buildDir(project), BUILT_CONFIG))) {
    return 'the project has not been built';
  }
  if (manifest.adminiumVersion !== version) {
    return `it was built by Adminium ${manifest.adminiumVersion}, and this is ${version}`;
  }
  if (manifest.config.entry !== relative(project.root, project.configFile)) {
    return `it was built from ${manifest.config.entry}`;
  }
  return (
    changedInput(project.root, manifest.config.inputs) ??
    serverCodeStaleReason(project, manifest) ??
    clientCodeStaleReason(project.root, buildDir(project), manifest.client)
  );
}

/** Does the project have code that only a build can turn into something to run? */
export function hasProjectCode(project: ProjectLocation): boolean {
  return serverCodeSources(project.root).length > 0 || clientCodeSources(project.root).length > 0;
}

export interface BuildResult {
  manifest: BuildManifest;
  /** Absolute path of the compiled config. */
  configOutput: string;
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

interface PluginBuild {
  onResolve(
    options: { filter: RegExp; namespace?: string },
    callback: (args: { path: string; resolveDir: string }) => { path: string; namespace?: string; external?: boolean } | undefined,
  ): void;
  onLoad(options: { filter: RegExp; namespace: string }, callback: () => { contents: string; loader: string }): void;
}

/** `@adminiumjs/adminium` becomes the inlined helpers. */
const helpersPlugin = {
  name: 'adminium-helpers',
  setup(build: PluginBuild) {
    build.onResolve({ filter: /^@adminiumjs\/adminium$/ }, () => ({ path: HELPERS_PACKAGE, namespace: 'adminium-helpers' }));
    build.onLoad({ filter: /.*/, namespace: 'adminium-helpers' }, () => ({ contents: HELPERS_SOURCE, loader: 'js' }));
  },
};

/** Dependencies that mark a package as one with native code. */
const NATIVE_MARKERS = ['bindings', 'node-gyp-build', 'prebuild-install', 'node-pre-gyp', '@mapbox/node-pre-gyp', 'cmake-js'];

/** The package a bare import names: `pg` for `pg/lib/x`, `@scope/name` for `@scope/name/x`. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] as string);
}

/** Does the installed package ship native code? */
export function isNativePackage(dir: string): boolean {
  if (existsSync(join(dir, 'binding.gyp'))) return true;
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      gypfile?: unknown;
      dependencies?: Record<string, unknown>;
    };
    if (manifest.gypfile === true) return true;
    return Object.keys(manifest.dependencies ?? {}).some((name) => NATIVE_MARKERS.includes(name));
  } catch {
    return false;
  }
}

function packageDir(name: string, from: string): string | null {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

/** Packages with native code stay imports: esbuild cannot bundle a `.node` file. */
const nativePlugin = {
  name: 'adminium-native-external',
  setup(build: PluginBuild) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('node:') || args.path === HELPERS_PACKAGE) return undefined;
      const dir = packageDir(packageNameOf(args.path), args.resolveDir);
      return dir !== null && isNativePackage(dir) ? { path: args.path, external: true } : undefined;
    });
  },
};

/** The project files esbuild read, hashed, leaving out virtual modules. */
function inputsOf(root: string, result: { metafile?: { inputs: Record<string, unknown> } }): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const input of Object.keys(result.metafile?.inputs ?? {})) {
    // Virtual modules (the helpers) have a namespace prefix and no file.
    if (input.includes(':') && !isAbsolute(input)) continue;
    const file = resolve(root, input);
    // Installed packages are the lockfile's business, not the build's.
    if (file.split(sep).includes('node_modules')) continue;
    if (existsSync(file)) inputs[toProjectPath(root, file)] = sha256(file);
  }
  return inputs;
}

async function requireBundler(project: ProjectLocation, load: LoadBundler | undefined, what: string): Promise<Bundler> {
  const bundler = await (load ?? loadProjectBundler)(project.root);
  if (bundler === null) {
    throw new CliError(`Building ${what} needs esbuild, and this project does not have it.`, {
      hint: 'Install it as a dev dependency:\n  npm install --save-dev esbuild',
    });
  }
  return bundler;
}

/** Bundle the hooks and actions into `server/`, replacing what was there. */
export async function buildServerCode(
  project: ProjectLocation,
  bundler: Bundler,
): Promise<NonNullable<BuildManifest['server']>> {
  const out = join(buildDir(project), SERVER_DIR);
  const sources = serverCodeSources(project.root);
  rmSync(out, { recursive: true, force: true });
  if (sources.length === 0) return { digest: '', files: [], inputs: {} };
  mkdirSync(out, { recursive: true });

  let result;
  try {
    result = await bundler.build({
      absWorkingDir: project.root,
      entryPoints: sources.map((file) => ({ in: join(project.root, file.source), out: `${file.kind}/${file.name}` })),
      outdir: out,
      outExtension: { '.js': '.mjs' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      metafile: true,
      logLevel: 'silent',
      banner: { js: REQUIRE_BANNER },
      plugins: [helpersPlugin, nativePlugin],
    });
  } catch (error) {
    throw new CliError(`Could not build the project's hooks and actions:\n${describeBuildFailure(error)}`);
  }

  const files: BuiltServerFile[] = sources.map((file) => {
    const output = `${SERVER_DIR}/${file.kind}/${file.name}.mjs`;
    return { ...file, output, hash: sha256(join(buildDir(project), output)) };
  });
  const digest = createHash('sha256')
    .update(JSON.stringify(files.map((file) => [file.source, file.hash])))
    .digest('hex');
  return { digest, files, inputs: inputsOf(project.root, result) };
}

/**
 * Rebuild only the hooks and actions, and record them in the manifest. `dev`
 * calls this when one of them changes; the running server notices the new
 * manifest and swaps the code in without a restart.
 */
export async function rebuildServerCode(
  project: ProjectLocation,
  opts: { loadBundler?: LoadBundler },
): Promise<NonNullable<BuildManifest['server']>> {
  const manifest = readBuildManifest(project);
  if (manifest === null) throw new CliError('The project has not been built yet.');
  const bundler = await requireBundler(project, opts.loadBundler, "the project's hooks and actions");
  const server = await buildServerCode(project, bundler);
  writeAtomically(join(buildDir(project), MANIFEST), `${JSON.stringify({ ...manifest, server }, null, 2)}\n`);
  return server;
}

/**
 * Rebuild only the pages and widgets, and record them in the manifest. `dev`
 * calls this when one of them changes; the running server notices the new
 * manifest and tells open dashboards to load the new files.
 */
export async function rebuildClientCode(
  project: ProjectLocation,
  opts: { loadBundler?: LoadBundler; dev?: boolean },
): Promise<ClientBuild> {
  const manifest = readBuildManifest(project);
  if (manifest === null) throw new CliError('The project has not been built yet.');
  const bundler = await requireBundler(project, opts.loadBundler, "the project's pages and widgets");
  const client = await buildClientCode(project.root, buildDir(project), { bundler, dev: opts.dev === true });
  writeAtomically(join(buildDir(project), MANIFEST), `${JSON.stringify({ ...manifest, client }, null, 2)}\n`);
  return client;
}

/** Compile the config, the server code and the browser code into the build folder, and write the manifest. */
export async function buildProject(
  project: ProjectLocation,
  opts: { version: string; loadBundler?: LoadBundler; dev?: boolean },
): Promise<BuildResult> {
  const bundler = await requireBundler(project, opts.loadBundler, configFileName(project));

  const out = buildDir(project);
  const configOutput = join(out, BUILT_CONFIG);
  mkdirSync(out, { recursive: true });
  rmSync(join(out, MANIFEST), { force: true });

  let result;
  try {
    result = await bundler.build({
      absWorkingDir: project.root,
      entryPoints: [project.configFile],
      outfile: configOutput,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      metafile: true,
      logLevel: 'silent',
      plugins: [helpersPlugin],
    });
  } catch (error) {
    throw new CliError(`Could not build ${configFileName(project)}:\n${describeBuildFailure(error)}`);
  }

  const server = await buildServerCode(project, bundler);
  const client = await buildClientCode(project.root, out, { bundler, dev: opts.dev === true });
  const manifest: BuildManifest = {
    adminiumVersion: opts.version,
    builtAt: new Date().toISOString(),
    config: { entry: relative(project.root, project.configFile), inputs: inputsOf(project.root, result) },
    server,
    client,
  };
  writeAtomically(join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, configOutput };
}

/** Import a config module and validate what it exports. */
async function importConfig(project: ProjectLocation, file: string): Promise<ProjectConfig> {
  // The query string defeats Node's module cache when the file changed.
  const url = `${pathToFileURL(file).href}?v=${sha256(file).slice(0, 16)}`;
  let mod: { default?: unknown };
  try {
    mod = (await import(url)) as { default?: unknown };
  } catch (error) {
    throw new CliError(
      `Could not load ${configFileName(project)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = parseProjectConfig(mod.default);
  if (!parsed.ok) {
    throw new CliError(`${configFileName(project)} is not valid:\n  ${parsed.problems.join('\n  ')}`, {
      hint: 'It must `export default defineConfig({ … })`.',
    });
  }
  return parsed.config;
}

export interface LoadedProjectConfig {
  config: ProjectConfig;
  /** How the config was obtained, for the boot log. */
  from: 'build' | 'new-build' | 'source';
}

/**
 * The project's config, from a current build when there is one. Otherwise it
 * builds, when esbuild is installed, or imports a plain JavaScript config
 * directly. A TypeScript config with no usable build and no esbuild is an
 * error that says what to run.
 */
export async function loadProjectConfig(
  project: ProjectLocation,
  opts: { version: string; loadBundler?: LoadBundler; rebuild?: boolean },
): Promise<LoadedProjectConfig> {
  const stale = opts.rebuild === true ? 'a rebuild was asked for' : staleReason(project, opts.version);
  if (stale === null) {
    return { config: await importConfig(project, join(buildDir(project), BUILT_CONFIG)), from: 'build' };
  }

  const bundler = await (opts.loadBundler ?? loadProjectBundler)(project.root);
  if (bundler !== null) {
    const built = await buildProject(project, { version: opts.version, loadBundler: async () => bundler });
    return { config: await importConfig(project, built.configOutput), from: 'new-build' };
  }

  if (['.js', '.mjs'].includes(extname(project.configFile)) && !hasProjectCode(project)) {
    return { config: await importConfig(project, project.configFile), from: 'source' };
  }

  throw new CliError(`${configFileName(project)} cannot be loaded: ${stale}.`, {
    hint: 'Build the project first (it needs the esbuild dev dependency):\n  npm run build',
  });
}
