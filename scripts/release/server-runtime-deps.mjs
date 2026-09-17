#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the published CLI loads at run time, and therefore what it must declare.
 *
 * `@adminiumjs/adminium` carries the internal packages it needs inside its own
 * tarball, with their dependency lists removed (publish-npm.mjs). So the CLI's
 * own manifest has to name every third-party package that code loads. Taking
 * the union of what those packages declare would overshoot: `@adminium/widgets`
 * declares React, Radix, Leaflet and lucide-react for the dashboard, and the
 * server only reads two plain subpaths of it.
 *
 * So this traces the BUILT code: every static import and every string-literal
 * `import()` reachable from the CLI's entry points, through the internal
 * packages, stopping at node_modules. A static trace cannot follow a module
 * loaded by a computed name, so every such call site in the traced code must be
 * listed in LOADED_BY_NAME with what it loads. An unlisted site fails the run.
 *
 * Usage (after `pnpm build`):
 *   node scripts/release/server-runtime-deps.mjs           print the trace
 *   node scripts/release/server-runtime-deps.mjs --write   update server-runtime-deps.json
 *   node scripts/release/server-runtime-deps.mjs --check   fail when that file is stale
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cruise } from 'dependency-cruiser';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_FILE = join(ROOT, 'scripts/release/server-runtime-deps.json');
const SERVER_NAME = '@adminium/server';
const ENTRY_FILES = ['apps/server/dist/cli/index.js', 'apps/server/dist/index.js'];

// acorn and acorn-walk come with dependency-cruiser, so resolve them from there
// rather than adding root dependencies for one script.
const fromCruiser = createRequire(fileURLToPath(import.meta.resolve('dependency-cruiser')));
const acorn = fromCruiser('acorn');
const walk = fromCruiser('acorn-walk');

/**
 * Every place the traced code loads a module by a computed name. `arg` is the
 * source text of the computed argument, exactly as it appears in the built
 * file, so an edit to the call makes this table fail until someone looks.
 *
 * An entry with `resolves` instead of `arg` covers a `require.resolve` of a
 * literal name that is NOT a dependency of the CLI (a literal lookup is
 * otherwise counted as one).
 */
const LOADED_BY_NAME = [
  {
    site: 'apps/server/dist/project/build.js',
    resolves: 'esbuild',
    loads: [],
    why: "a project's own esbuild, found in its node_modules; the CLI does not depend on it",
  },
  {
    site: 'apps/server/dist/project/build.js',
    arg: 'pathToFileURL(entry).href',
    loads: [],
    why: "that esbuild's entry file",
  },
  {
    site: 'apps/server/dist/project/build.js',
    arg: 'url',
    loads: [],
    why: "a project's compiled or plain JavaScript adminium.config file",
  },
  {
    site: 'apps/server/dist/project/code/load.js',
    arg: 'url',
    loads: [],
    why: "a project's own hooks and actions, bundled by its build into .adminium/build/server/",
  },
  {
    site: 'apps/server/dist/project/sample.js',
    arg: 'pathToFileURL(script).href',
    loads: [],
    why: 'the sample database seed script, a file shipped inside the package',
  },
  {
    site: 'apps/server/dist/connections/register-adapters.js',
    arg: 'pkg',
    loads: ['@adminium/adapter-postgres', '@adminium/adapter-mysql', '@adminium/adapter-sqlite'],
    why: 'ADAPTER_PACKAGES: each database adapter is imported by name; a missing one is reported, not fatal',
  },
  {
    site: 'apps/server/dist/routes/schema-import/index.js',
    arg: 'SCHEMA_IMPORT_PACKAGE',
    loads: ['@adminium/schema-import'],
    why: 'the schema-file parsers load on the first import request',
  },
  {
    site: 'apps/server/dist/meta/store.js',
    arg: 'specifier',
    loads: ['pg', 'mysql2'],
    why: 'the meta-store driver for the configured engine',
  },
  {
    site: 'apps/server/dist/cli/allowlist.js',
    arg: 'pathToFileURL(candidate).href',
    loads: [],
    why: 'the vocabulary snapshot, a file inside this package',
  },
  {
    site: 'apps/server/dist/add-ons/runtime.js',
    arg: 'path',
    loads: [],
    why: 'an installed add-on server half, read from the data directory',
  },
  {
    site: 'apps/server/dist/routes/desktop-demo/handlers.js',
    arg: 'pathToFileURL(scriptPath).href',
    loads: [],
    why: 'the desktop demo seed script, which ships with the desktop app',
  },
];

const die = (message) => {
  console.error(`\nserver-runtime-deps: ${message}\n`);
  process.exit(1);
};

/** `@scope/name/sub/path` → `@scope/name`; `name/sub` → `name`. */
function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Every `@adminium/*` workspace: name → { dir, pkg }. */
function loadWorkspaces() {
  const byName = new Map();
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(ROOT, group, entry.name, 'package.json');
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.name?.startsWith('@adminium/')) byName.set(pkg.name, { dir: `${group}/${entry.name}`, pkg });
    }
  }
  return byName;
}

/** The file a bare `import '<name>'` of a workspace package resolves to. */
function entryFileOf(workspace) {
  const root = workspace.pkg.exports?.['.'] ?? workspace.pkg.main;
  const target = typeof root === 'string' ? root : (root?.import ?? root?.default);
  if (typeof target !== 'string') die(`${workspace.pkg.name} has no resolvable "." export`);
  const file = join(workspace.dir, target);
  if (!existsSync(join(ROOT, file))) die(`${file} does not exist — run \`pnpm build\` first`);
  return file;
}

/** The workspace a first-party file belongs to, by its path prefix. */
function workspaceOfFile(file, workspaces) {
  for (const [name, workspace] of workspaces) {
    if (file.startsWith(`${workspace.dir}/`)) return name;
  }
  return null;
}

/**
 * Module loads a static trace cannot see: computed `import()` / `require()` /
 * `new Worker()` arguments, and `require.resolve('<literal>')`-style lookups
 * (which name a package without importing it, as pino-pretty is).
 */
function scanFile(file) {
  const code = readFileSync(join(ROOT, file), 'utf8');
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const textOf = (node) => code.slice(node.start, node.end);
  const isStringLiteral = (node) =>
    (node.type === 'Literal' && typeof node.value === 'string') ||
    (node.type === 'TemplateLiteral' && node.expressions.length === 0);
  const literalValue = (node) => (node.type === 'Literal' ? node.value : node.quasis[0].value.cooked);

  // Names bound to createRequire(...) in this file behave like `require`.
  const requireLike = new Set(['require']);
  walk.simple(ast, {
    VariableDeclarator(node) {
      if (node.id.type === 'Identifier' && node.init?.type === 'CallExpression' && node.init.callee.name === 'createRequire') {
        requireLike.add(node.id.name);
      }
    },
  });
  const isRequireLike = (node) =>
    (node.type === 'Identifier' && requireLike.has(node.name)) ||
    (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'createRequire');

  const computed = [];
  const literalNames = [];
  const visitArg = (kind, arg) => {
    if (arg === undefined) return;
    if (isStringLiteral(arg)) literalNames.push({ kind, specifier: literalValue(arg) });
    else computed.push({ kind, arg: textOf(arg) });
  };
  walk.simple(ast, {
    ImportExpression(node) {
      // Literal imports are the dependency trace's job; only computed ones matter here.
      if (!isStringLiteral(node.source)) computed.push({ kind: 'import', arg: textOf(node.source) });
    },
    CallExpression(node) {
      const { callee } = node;
      if (isRequireLike(callee)) visitArg('require', node.arguments[0]);
      else if (
        callee.type === 'MemberExpression' &&
        !callee.computed &&
        callee.property.name === 'resolve' &&
        isRequireLike(callee.object)
      ) {
        visitArg('resolve', node.arguments[0]);
      }
    },
    NewExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'Worker') {
        computed.push({ kind: 'worker', arg: node.arguments[0] ? textOf(node.arguments[0]) : '' });
      }
    },
  });
  // A relative or absolute literal is a file, not a package.
  const packages = literalNames.filter(({ specifier }) => !/^[./]/.test(specifier) && !specifier.startsWith('node:'));
  return { computed, packages };
}

async function trace() {
  process.chdir(ROOT);
  const workspaces = loadWorkspaces();
  const server = workspaces.get(SERVER_NAME);
  if (!server) die(`${SERVER_NAME} not found under apps/`);
  for (const file of ENTRY_FILES) {
    if (!existsSync(join(ROOT, file))) die(`${file} does not exist — run \`pnpm build\` first`);
  }

  const internalByName = LOADED_BY_NAME.flatMap((entry) => entry.loads).filter((name) => workspaces.has(name));
  const entries = [...ENTRY_FILES, ...internalByName.map((name) => entryFileOf(workspaces.get(name)))];

  const result = await cruise(
    entries,
    { doNotFollow: { path: 'node_modules' }, moduleSystems: ['es6', 'cjs'] },
    {
      conditionNames: ['import', 'node', 'default'],
      exportsFields: ['exports'],
      mainFields: ['module', 'main'],
      extensions: ['.js', '.mjs', '.cjs', '.json'],
    },
  );
  const modules = result.output.modules;

  const reachedWorkspaces = new Set();
  const firstPartyFiles = [];
  /** `@adminium/<name>[/subpath]` specifiers one workspace imports from another */
  const entryPoints = new Set(internalByName);
  /** third-party package → first-party files that load it */
  const loadedBy = new Map();
  const noteLoad = (name, file) => {
    if (!loadedBy.has(name)) loadedBy.set(name, new Set());
    loadedBy.get(name).add(file);
  };
  const unresolved = [];

  for (const module of modules) {
    if (module.coreModule) continue;
    const owner = workspaceOfFile(module.source, workspaces);
    if (owner === null) continue; // a third-party file the trace stopped at
    reachedWorkspaces.add(owner);
    firstPartyFiles.push(module.source);
    for (const dep of module.dependencies) {
      if (dep.coreModule) continue;
      if (dep.couldNotResolve) {
        unresolved.push(`${module.source} → ${dep.module}`);
        continue;
      }
      const target = workspaceOfFile(dep.resolved, workspaces);
      if (target !== null) {
        if (target !== owner && dep.module.startsWith('@adminium/')) entryPoints.add(dep.module);
        continue;
      }
      noteLoad(packageNameOf(dep.module), module.source);
    }
  }
  if (unresolved.length) die(`imports that do not resolve:\n  ${unresolved.join('\n  ')}`);

  // Loads the dependency trace cannot see.
  const unexplained = [];
  const matchedEntries = new Set();
  for (const file of firstPartyFiles.filter((f) => /\.[cm]?js$/.test(f))) {
    const { computed, packages } = scanFile(file);
    for (const { kind, specifier } of packages) {
      const exempt = LOADED_BY_NAME.find((e) => e.site === file && kind === 'resolve' && e.resolves === specifier);
      if (exempt !== undefined) {
        matchedEntries.add(exempt);
        continue;
      }
      if (!workspaces.has(packageNameOf(specifier))) noteLoad(packageNameOf(specifier), file);
    }
    for (const site of computed) {
      const entry = LOADED_BY_NAME.find((e) => e.site === file && e.arg !== undefined && e.arg === site.arg);
      if (!entry) {
        unexplained.push(`${file}: ${site.kind}(${site.arg})`);
        continue;
      }
      matchedEntries.add(entry);
      for (const name of entry.loads) if (!workspaces.has(name)) noteLoad(name, file);
    }
  }
  if (unexplained.length) {
    die(
      `module loads with a computed name that LOADED_BY_NAME does not explain:\n  ${unexplained.join('\n  ')}\n` +
        'Add each one to LOADED_BY_NAME in this script, with what it loads.',
    );
  }
  const stale = LOADED_BY_NAME.filter((entry) => !matchedEntries.has(entry));
  if (stale.length) {
    die(
      `LOADED_BY_NAME lists call sites the built code no longer has:\n  ${stale
        .map((e) => `${e.site}: ${e.arg ?? `resolve('${e.resolves}')`}`)
        .join('\n  ')}\nUpdate or remove them.`,
    );
  }

  reachedWorkspaces.delete(SERVER_NAME);
  const bundled = [...reachedWorkspaces].sort();

  // Declarations: the server's own, plus those of every bundled package.
  /**
   * name → the field the published CLI uses: the server's own choice where it
   * declares the package, else 'dependencies' if any bundled declarer requires
   * it (the same rule as publish-npm.mjs).
   */
  const declared = new Map();
  /** Record `pkg`'s third-party declarations in `into` (name → field). */
  const declare = (pkg, into) => {
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const name of Object.keys(pkg[field] ?? {})) {
        if (name.startsWith('@adminium/')) continue;
        if (into.get(name) !== 'dependencies') into.set(name, field);
      }
    }
  };
  const declaredByServer = new Map();
  const declaredByBundled = new Map();
  declare(server.pkg, declaredByServer);
  for (const name of bundled) declare(workspaces.get(name).pkg, declaredByBundled);
  for (const [name, field] of [...declaredByBundled, ...declaredByServer]) declared.set(name, field);

  const undeclared = [...loadedBy.keys()].filter((name) => !declared.has(name));
  if (undeclared.length) {
    die(
      `loaded at run time but declared by neither ${SERVER_NAME} nor a bundled package:\n  ${undeclared
        .map((name) => `${name} (from ${[...loadedBy.get(name)].slice(0, 3).join(', ')})`)
        .join('\n  ')}`,
    );
  }

  // The server keeps everything it declares; a bundled package contributes only
  // what the traced code actually loads. Only that second part is recorded, so
  // an edit to the server's own manifest never makes the file stale.
  const fromBundled = [...loadedBy.keys()].filter((n) => declaredByBundled.has(n)).sort();
  const shipped = new Set([...declaredByServer.keys(), ...fromBundled]);
  const dependencies = [...shipped].filter((n) => declared.get(n) === 'dependencies').sort();
  const optionalDependencies = [...shipped].filter((n) => declared.get(n) === 'optionalDependencies').sort();

  const internalDeclared = new Set();
  for (const name of [SERVER_NAME, ...bundled]) {
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(workspaces.get(name).pkg[field] ?? {})) {
        if (dep.startsWith('@adminium/')) internalDeclared.add(dep);
      }
    }
  }
  const notLoaded = [
    ...[...declaredByBundled.keys()].filter((n) => !shipped.has(n)),
    ...[...internalDeclared].filter((n) => !reachedWorkspaces.has(n)),
  ].sort();

  return {
    entries,
    firstPartyFiles: firstPartyFiles.length,
    loadedBy,
    published: { dependencies, optionalDependencies },
    report: { bundled, entryPoints: [...entryPoints].sort(), fromBundled, notLoaded },
  };
}

const REPORT_KEYS = ['bundled', 'entryPoints', 'fromBundled', 'notLoaded'];

function serialize(report) {
  return (
    JSON.stringify(
      {
        '//': [
          'Generated by `node scripts/release/server-runtime-deps.mjs --write`. Do not edit by hand.',
          'bundled: internal packages the CLI loads; they ship inside the @adminiumjs/adminium tarball.',
          'entryPoints: the exact internal imports the server makes (rehearse-npx.mjs loads each one).',
          'fromBundled: third-party packages those bundled packages load; the published CLI declares',
          '  them next to its own dependencies (publish-npm.mjs).',
          'notLoaded: declared by a bundled package but never loaded by the server, so left out.',
        ],
        ...Object.fromEntries(REPORT_KEYS.map((key) => [key, report[key]])),
      },
      null,
      2,
    ) + '\n'
  );
}

const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : 'print';
const { entries, firstPartyFiles, loadedBy, published, report } = await trace();

if (mode === 'write') {
  writeFileSync(OUT_FILE, serialize(report));
  console.log(`wrote ${OUT_FILE.slice(ROOT.length + 1)}`);
} else if (mode === 'check') {
  const expected = serialize(report);
  const actual = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : '';
  if (actual !== expected) {
    const current = actual ? JSON.parse(actual) : {};
    const lines = [];
    for (const key of REPORT_KEYS) {
      const was = new Set(current[key] ?? []);
      const now = new Set(report[key]);
      for (const name of now) if (!was.has(name)) lines.push(`  ${key}: + ${name}`);
      for (const name of was) if (!now.has(name)) lines.push(`  ${key}: - ${name}`);
    }
    die(
      `scripts/release/server-runtime-deps.json is stale:\n${lines.join('\n') || '  (formatting only)'}\n` +
        'Run `node scripts/release/server-runtime-deps.mjs --write` and review the change.',
    );
  }
  console.log(
    `server-runtime-deps: up to date (${report.bundled.length} bundled packages, ` +
      `${report.fromBundled.length} third-party packages they load).`,
  );
} else {
  const describe = (name) => {
    const files = loadedBy.get(name)?.size ?? 0;
    return files ? `${name}  (loaded by ${files} file${files === 1 ? '' : 's'})` : `${name}  (declared by the server)`;
  };
  console.log(`entries (${entries.length}):\n  ${entries.join('\n  ')}`);
  console.log(`\nfirst-party files reached: ${firstPartyFiles}`);
  console.log(`\nbundled (${report.bundled.length}):\n  ${report.bundled.join('\n  ')}`);
  console.log(`\nentryPoints (${report.entryPoints.length}):\n  ${report.entryPoints.join('\n  ')}`);
  console.log(`\nfromBundled (${report.fromBundled.length}):\n  ${report.fromBundled.join('\n  ')}`);
  console.log(
    `\nthe published CLI will declare:\n  dependencies (${published.dependencies.length}):\n    ` +
      `${published.dependencies.map(describe).join('\n    ')}\n  optionalDependencies ` +
      `(${published.optionalDependencies.length}):\n    ${published.optionalDependencies.map(describe).join('\n    ')}`,
  );
  console.log(`\nnot loaded, left out (${report.notLoaded.length}):\n  ${report.notLoaded.join('\n  ')}`);
}
