#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scope-mapped npm publish.
 *
 * The npm scope `@adminium` is parked by a third party (dispute pending), so
 * source package names stay `@adminium/*` while the PUBLISHED identity is
 * `@<NPM_SCOPE>/*` (default: adminiumjs). Resolution when the dispute lands:
 * set NPM_SCOPE=adminium and republish — nothing in the source tree changes.
 *
 * How the mapping stays sound without rewriting compiled dist imports:
 * internal dependencies are published as npm ALIASES, e.g.
 *   "@adminium/engine": "npm:@adminiumjs/engine@0.1.0"
 * so consumers get node_modules/@adminium/engine and the dist `import
 * '@adminium/engine'` specifiers (JS and .d.ts) resolve unmodified.
 *
 * The flagship CLI (@adminium/server, bin `adminium`) publishes as
 * `@<scope>/adminium` — the unscoped name `adminium` is also taken.
 *
 * ONE PACKAGE FOR THE CLI
 * Only four workspaces publish: the flagship, and the three packages other
 * repos install on their own (public-client, manifest, add-on-contracts).
 * Everything else is `private`. The flagship carries the internal packages it
 * loads inside its own tarball, as `node_modules/@adminium/<name>/`:
 *   - they are listed in `bundleDependencies`, and each is also a dependency,
 *     spelled as the same alias as before. npm only packs a bundled package
 *     that a dependency points at, and never fetches one from the registry. A
 *     package manager that ignored the bundle would ask for `@adminiumjs/*`,
 *     never for a name in the third party's `@adminium` scope;
 *   - their copies have no dependency lists. npm would otherwise install what
 *     they declare, and `@adminium/widgets` declares React for the dashboard;
 *   - the flagship declares the third-party packages they load instead, from
 *     scripts/release/server-runtime-deps.json (traced from the built code;
 *     this script refuses to run while that file is stale).
 * Which packages get bundled comes from that same file.
 *
 * WHY THIS SCRIPT DOES SO MUCH MANIFEST SURGERY
 * This drives `npm`, not `pnpm`, because only npm understands the alias
 * rewrite above. npm has no idea what pnpm's `workspace:` and `catalog:`
 * protocols mean: it will happily PUBLISH a manifest containing them and then
 * every consumer install dies with EUNSUPPORTEDPROTOCOL. Published versions
 * are immutable, so that mistake burns the version number permanently. Hence:
 *   - every range is resolved (workspace: -> npm: alias, catalog:/catalog:<n>
 *     -> the concrete range from pnpm-workspace.yaml), not just @adminium/*;
 *   - a hard pre-flight assertion runs over ALL staged manifests before the
 *     first publish, so a bad range aborts the run instead of half-publishing;
 *   - every tarball is packed and X-rayed (deps, LICENSE, and every path named
 *     by exports/main/types/bin/files) before its package is published.
 * A `--dry-run` that skips those checks is what let the 0.1.0 candidate pack
 * green with `"zod": "catalog:"` in six runtime manifests.
 *
 * Usage:
 *   node scripts/release/publish-npm.mjs --dry-run   # pack to scripts/release/out/
 *   node scripts/release/publish-npm.mjs             # publish (needs npm auth)
 *
 * BEFORE THE REAL RUN: `node scripts/release/rehearse-npx.mjs --wizard` packs
 * with the same --dry-run, installs the tarballs the way npx does and runs the
 * CLI from a directory that is not this repo. A published version is immutable;
 * that is the last cheap chance to find out the artifact is broken.
 * Env:
 *   NPM_SCOPE       target scope, default adminiumjs
 *   NPM_PROVENANCE  "1" to pass --provenance (CI with OIDC only)
 *
 * Idempotent: versions already on the registry are skipped, so a failed run
 * resumes safely. The working tree is always restored — each package.json is
 * put back immediately after its own publish, and SIGINT/SIGTERM/SIGHUP,
 * uncaughtException and process exit all run the same restore.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCOPE = process.env.NPM_SCOPE ?? 'adminiumjs';
const DRY_RUN = process.argv.includes('--dry-run');
const OUT_DIR = join(ROOT, 'scripts/release/out');
const PACK_TMP = join(OUT_DIR, '.pack-tmp');
/** The bundled packages' own tarballs, before they go inside the flagship's. */
const BUNDLED_TMP = join(OUT_DIR, '.bundled');
/** Where the flagship is assembled with its bundled packages, then packed. */
const STAGE_DIR = join(OUT_DIR, '.stage');
/** The flagship's intermediate and final tarballs, before validation. */
const FLAGSHIP_TMP = join(OUT_DIR, '.flagship');
/** Any other package's tarball, until it passes validation. */
const VALIDATE_TMP = join(OUT_DIR, '.validate');
/** Scratch folders this run creates under OUT_DIR, all removed at the end. */
const SCRATCH_DIRS = [PACK_TMP, BUNDLED_TMP, STAGE_DIR, FLAGSHIP_TMP, VALIDATE_TMP];
const ROOT_LICENSE = join(ROOT, 'LICENSE');
const RUNTIME_DEPS_FILE = join(ROOT, 'scripts/release/server-runtime-deps.json');
const FLAGSHIP = '@adminium/server';

/**
 * Dashboard-only libraries. None of them may reach the flagship's dependency
 * lists: the server never loads them, and the dashboard ships pre-built.
 */
const BROWSER_ONLY = [/^react$/, /^react-dom$/, /^lucide-react$/, /^leaflet$/, /^@radix-ui\//, /^@dnd-kit\//, /^@tanstack\//, /^d3-/];

/** Workspace dirs holding `@adminium/*` packages (apps/server is the CLI flagship). */
const WORKSPACE_GLOBS = ['packages', 'apps'];

/** Dependency fields whose ranges a consumer's installer has to resolve. */
const DEP_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * Range prefixes npm can actually fetch from a published manifest. Anything
 * else that looks like a protocol (has a colon before any semver operator) is
 * a workspace-only convenience and must never reach the registry.
 */
const REGISTRY_PROTOCOL = /^(npm:|https?:|git:|git\+|github:|gitlab:|bitbucket:|gist:)/;

/** @adminium/server ships the product; everything else keeps its basename. */
function mappedName(sourceName) {
  if (sourceName === '@adminium/server') return `@${SCOPE}/adminium`;
  return sourceName.replace(/^@adminium\//, `@${SCOPE}/`);
}

/* ------------------------------------------------------------------ *
 * pnpm catalogs
 * ------------------------------------------------------------------ */

/**
 * Minimal reader for the `catalog:` / `catalogs:` blocks of
 * pnpm-workspace.yaml. Deliberately strict: anything inside those blocks it
 * cannot parse throws, because silently missing an entry here is exactly the
 * failure mode this script exists to prevent. (No YAML dependency at the repo
 * root, and this file must run before `pnpm install` has any say.)
 *
 * @returns {{ default: Map<string,string>, named: Map<string, Map<string,string>> }}
 */
function loadCatalogs() {
  const file = join(ROOT, 'pnpm-workspace.yaml');
  const catalogs = { default: new Map(), named: new Map() };
  if (!existsSync(file)) return catalogs;

  const lines = readFileSync(file, 'utf8').split('\n');
  const indentOf = (line) => line.length - line.trimStart().length;
  const strip = (line) => line.replace(/\s+#.*$/, '').trimEnd();
  const unquote = (v) => v.replace(/^['"]|['"]$/g, '');
  const isBlank = (line) => strip(line).trim() === '' || line.trimStart().startsWith('#');

  const entry = (line, where) => {
    const m = /^\s*(['"]?)([^:'"]+)\1\s*:\s*(.+)$/.exec(strip(line));
    if (!m) throw new Error(`pnpm-workspace.yaml: cannot parse ${where} entry: ${line}`);
    return [m[2].trim(), unquote(m[3].trim())];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line) || indentOf(line) !== 0) continue;
    const head = strip(line).trim();

    if (head === 'catalog:') {
      for (i++; i < lines.length; i++) {
        if (isBlank(lines[i])) continue;
        if (indentOf(lines[i]) === 0) break;
        const [name, range] = entry(lines[i], 'catalog');
        catalogs.default.set(name, range);
      }
      i--;
    } else if (head === 'catalogs:') {
      let current = null;
      for (i++; i < lines.length; i++) {
        if (isBlank(lines[i])) continue;
        const indent = indentOf(lines[i]);
        if (indent === 0) break;
        const text = strip(lines[i]).trim();
        if (text.endsWith(':') && !/:\s*\S/.test(text.slice(0, -1))) {
          current = text.slice(0, -1).trim();
          catalogs.named.set(current, new Map());
          continue;
        }
        if (!current) throw new Error(`pnpm-workspace.yaml: entry outside a named catalog: ${lines[i]}`);
        const [name, range] = entry(lines[i], `catalogs.${current}`);
        catalogs.named.get(current).set(name, range);
      }
      i--;
    }
  }
  return catalogs;
}

/** `catalog:` / `catalog:<name>` -> the concrete range, or the input unchanged. */
function resolveCatalogRange({ range, dep, field, pkgName, catalogs }) {
  if (typeof range !== 'string' || !range.startsWith('catalog:')) return range;
  const which = range.slice('catalog:'.length).trim();
  const table = which === '' || which === 'default' ? catalogs.default : catalogs.named.get(which);
  if (!table) {
    throw new Error(
      `${pkgName} ${field}.${dep} is "${range}" but pnpm-workspace.yaml declares no catalog "${which}"`,
    );
  }
  const resolved = table.get(dep);
  if (!resolved) {
    throw new Error(
      `${pkgName} ${field}.${dep} is "${range}" but catalog ${which || 'default'} has no entry for "${dep}"`,
    );
  }
  return resolved;
}

/* ------------------------------------------------------------------ *
 * workspace discovery
 * ------------------------------------------------------------------ */

/**
 * The pristine package.json text of every workspace this run rewrites, keyed
 * by path. Read once, at discovery, and used both as the restore source and as
 * the end-of-run integrity reference.
 * @type {Map<string,string>}
 */
const originals = new Map();

/** Remember `w`'s manifest as it was at discovery: this run rewrites it. */
function track(w) {
  originals.set(w.pkgPath, w.text);
}

/** Every `@adminium/*` workspace, published or private, keyed by name. */
function loadWorkspaces() {
  const found = new Map();
  for (const group of WORKSPACE_GLOBS) {
    const dirs = readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const dir of dirs) {
      const pkgPath = join(ROOT, group, dir, 'package.json');
      let text;
      try {
        text = readFileSync(pkgPath, 'utf8');
      } catch (err) {
        // A workspace dir with no manifest is normal; anything else (EACCES,
        // EMFILE under load) must NOT silently shrink the publish set — a
        // dropped package leaves the others aliasing a version that will never
        // exist on the registry.
        if (err?.code === 'ENOENT') continue;
        throw new Error(`cannot read ${pkgPath}: ${err?.message ?? err}`);
      }
      let pkg;
      try {
        pkg = JSON.parse(text);
      } catch (err) {
        throw new Error(`${pkgPath} is not valid JSON: ${err?.message ?? err}`);
      }
      // A manifest already carrying the PUBLISH scope is not a third-party
      // package that happens to live here — it is this script's own rewrite,
      // stranded by a run that died where nothing could restore it (SIGKILL, a
      // hard CI cancel). Say so, loudly: silently skipping it would shrink the
      // publish set and strand the aliases pointing at it.
      if (pkg.name?.startsWith(`@${SCOPE}/`)) {
        throw new Error(
          `${pkgPath} is named "${pkg.name}" — that is a leftover from an interrupted publish.\n` +
            `Restore it (git checkout -- ${pkgPath}) and delete any stray LICENSE beside it, then re-run.`,
        );
      }
      if (!pkg.name?.startsWith('@adminium/')) continue;
      found.set(pkg.name, { dir: join(ROOT, group, dir), pkgPath, pkg, text });
    }
  }
  return found;
}

/** Kahn topological sort over internal @adminium/* dependencies. */
function topoSort(workspaces) {
  const byName = new Map(workspaces.map((w) => [w.pkg.name, w]));
  const order = [];
  const marks = new Map(); // name -> 'visiting' | 'done'
  function visit(w, chain) {
    const mark = marks.get(w.pkg.name);
    if (mark === 'done') return;
    if (mark === 'visiting') {
      throw new Error(`dependency cycle: ${[...chain, w.pkg.name].join(' -> ')}`);
    }
    marks.set(w.pkg.name, 'visiting');
    for (const dep of Object.keys(w.pkg.dependencies ?? {})) {
      const inner = byName.get(dep);
      if (inner) visit(inner, [...chain, w.pkg.name]);
    }
    marks.set(w.pkg.name, 'done');
    order.push(w);
  }
  for (const w of workspaces) visit(w, []);
  return order;
}

/* ------------------------------------------------------------------ *
 * manifest rewrite + the assertion that guards it
 * ------------------------------------------------------------------ */

function rewriteForPublish(pkg, catalogs) {
  const out = structuredClone(pkg);
  out.name = mappedName(pkg.name);
  for (const field of DEP_FIELDS) {
    const deps = out[field];
    if (!deps) continue;
    for (const [dep, range] of Object.entries(deps)) {
      if (dep.startsWith('@adminium/')) {
        if (typeof range !== 'string' || !range.startsWith('workspace:')) {
          throw new Error(`${pkg.name} ${field}.${dep} is "${range}" — expected workspace:*`);
        }
        deps[dep] = `npm:${mappedName(dep)}@${pkg.version}`;
        continue;
      }
      // Everything else: third-party ranges, which in this repo routinely use
      // pnpm's catalog protocol. npm cannot resolve it, so expand it here.
      deps[dep] = resolveCatalogRange({ range, dep, field, pkgName: pkg.name, catalogs });
    }
  }
  // Publishing under an alias scope: devDependencies are irrelevant to
  // consumers and may reference private workspaces — drop them from the
  // published manifest (the repo copy is restored afterwards).
  delete out.devDependencies;
  // Build-time scripts describe this repo, not the tarball: `build`, `lint`
  // and `test` name tsconfigs and sources that `files` excludes, and the
  // flagship's `prepack` shells to scripts/ that never ships. Keeping them
  // leaves consumers with commands that cannot run and npm with lifecycle
  // hooks pointing at absent files.
  delete out.scripts;
  return out;
}

const sortKeys = (record) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b, 'en')));

/**
 * A package that travels inside the flagship: its published manifest with
 * every dependency list removed. npm installs what a bundled package declares,
 * and the flagship declares what these packages load (rewriteFlagship).
 */
function rewriteForBundle(pkg, catalogs) {
  const out = rewriteForPublish(pkg, catalogs);
  for (const field of [...DEP_FIELDS, 'peerDependenciesMeta', 'bundleDependencies', 'bundledDependencies']) {
    delete out[field];
  }
  return out;
}

/** Throws if a dashboard-only library made it into a dependency list. */
function assertNoBrowserLibraries(manifest, where) {
  const found = DEP_FIELDS.flatMap((field) =>
    Object.keys(manifest[field] ?? {})
      .filter((dep) => BROWSER_ONLY.some((pattern) => pattern.test(dep)))
      .map((dep) => `${field}.${dep}`),
  );
  if (found.length) {
    throw new Error(
      `${where}: dashboard-only libraries in the dependencies (the server never loads them):\n` +
        found.map((f) => `    ${f}`).join('\n'),
    );
  }
}

/**
 * The flagship's published manifest: its own dependencies, one alias per
 * bundled package, and the third-party packages the bundled code loads.
 *
 * @param {{ pkg: any }} server
 * @param {string[]} bundled  source names, from server-runtime-deps.json
 * @param {string[]} fromBundled  third-party names, from the same file
 * @param {Map<string, { pkg: any }>} workspaces
 */
function rewriteFlagship(server, bundled, fromBundled, workspaces, catalogs) {
  const out = rewriteForPublish(server.pkg, catalogs);
  const version = server.pkg.version;

  const internal = DEP_FIELDS.flatMap((field) =>
    Object.keys(server.pkg[field] ?? {})
      .filter((dep) => dep.startsWith('@adminium/'))
      .map((dep) => ({ field, dep })),
  );
  const wrong = internal.filter(({ field, dep }) => field !== 'dependencies' || !bundled.includes(dep));
  if (wrong.length) {
    throw new Error(
      `${server.pkg.name} declares internal packages the flagship cannot carry:\n` +
        wrong.map(({ field, dep }) => `    ${field}.${dep}`).join('\n') +
        '\nEvery internal dependency must be a plain dependency listed as `bundled` in ' +
        'server-runtime-deps.json. If the trace does not reach it, the server never loads it.',
    );
  }

  // npm packs a bundled package only when a dependency edge points at it, so
  // every bundled package is a dependency, spelled as the alias it always was.
  out.dependencies ??= {};
  for (const name of bundled) out.dependencies[name] = `npm:${mappedName(name)}@${version}`;

  // What the bundled code loads. Every declarer must agree on the range. Where
  // the server declares the package itself, its choice of field stands: pg and
  // mysql2 are optional on purpose (a `--no-optional` install is SQLite-only,
  // and a missing adapter is reported, not fatal), even though the adapters
  // declare them as hard dependencies. Otherwise a package any bundled declarer
  // requires is a hard dependency.
  const declarers = [server, ...bundled.map((name) => workspaces.get(name))];
  for (const dep of fromBundled) {
    const declarations = declarers.flatMap((w) =>
      ['dependencies', 'optionalDependencies']
        .filter((field) => w.pkg[field]?.[dep] !== undefined)
        .map((field) => ({
          owner: w.pkg.name,
          field,
          range: resolveCatalogRange({ range: w.pkg[field][dep], dep, field, pkgName: w.pkg.name, catalogs }),
        })),
    );
    if (!declarations.length) {
      throw new Error(`server-runtime-deps.json lists ${dep}, but nothing it bundles declares it — re-run its --write`);
    }
    const ranges = new Set(declarations.map((d) => d.range));
    if (ranges.size > 1) {
      throw new Error(
        `${dep} is declared with different ranges; align them before publishing:\n` +
          declarations.map((d) => `    ${d.owner} ${d.field}.${dep} = "${d.range}"`).join('\n'),
      );
    }
    const [range] = ranges;
    const serverField = declarations.find((d) => d.owner === server.pkg.name)?.field;
    const field =
      serverField ?? (declarations.some((d) => d.field === 'dependencies') ? 'dependencies' : 'optionalDependencies');
    out[field] ??= {};
    out[field][dep] = range;
  }

  out.dependencies = sortKeys(out.dependencies);
  if (out.optionalDependencies) {
    if (Object.keys(out.optionalDependencies).length) out.optionalDependencies = sortKeys(out.optionalDependencies);
    else delete out.optionalDependencies;
  }
  out.bundleDependencies = [...bundled].sort();
  assertNoBrowserLibraries(out, `${out.name} (staged manifest)`);
  return out;
}

/**
 * HARD GATE. Throws if any range a consumer's installer would have to resolve
 * still uses a protocol the registry cannot serve (catalog:, workspace:,
 * link:, file:, portal:, …). Run over every staged manifest BEFORE the first
 * publish, and again over every packed tarball.
 */
function assertPublishableRanges(manifest, where) {
  const bad = [];
  for (const field of DEP_FIELDS) {
    const deps = manifest[field];
    if (!deps) continue;
    for (const [dep, range] of Object.entries(deps)) {
      if (typeof range !== 'string') {
        bad.push(`${field}.${dep} is not a string (${JSON.stringify(range)})`);
        continue;
      }
      // A protocol is a scheme-ish prefix before any semver character. Plain
      // ranges ("^4.4.3", ">=1 <2", "^10 || ^11") never contain a colon.
      if (!range.includes(':')) continue;
      if (REGISTRY_PROTOCOL.test(range)) continue;
      bad.push(`${field}.${dep} = "${range}"`);
    }
  }
  if (bad.length) {
    throw new Error(
      `${where}: ${bad.length} dependency range(s) use a protocol npm cannot install ` +
        `(consumers would fail with EUNSUPPORTEDPROTOCOL, and the version would be burned):\n` +
        bad.map((b) => `    ${b}`).join('\n'),
    );
  }
}

/* ------------------------------------------------------------------ *
 * tarball X-ray
 * ------------------------------------------------------------------ */

/** Collect every './…' path an npm client may resolve out of a manifest. */
function referencedPaths(manifest) {
  const targets = new Set();
  const add = (v) => {
    if (typeof v === 'string' && v.startsWith('.')) targets.add(v.replace(/^\.\//, ''));
  };
  add(manifest.main);
  add(manifest.module);
  add(manifest.types);
  add(manifest.typings);
  add(manifest.browser);
  if (typeof manifest.bin === 'string') add(manifest.bin);
  else for (const v of Object.values(manifest.bin ?? {})) add(v);
  const walk = (node) => {
    if (typeof node === 'string') return add(node);
    if (node && typeof node === 'object') for (const v of Object.values(node)) walk(v);
  };
  walk(manifest.exports);
  return [...targets];
}

function tarballHas(entries, relPath) {
  const target = `package/${relPath.replace(/\/$/, '')}`;
  if (relPath.includes('*')) {
    const [head, tail] = relPath.split('*');
    return entries.some((e) => e.startsWith(`package/${head}`) && e.endsWith(tail ?? ''));
  }
  return entries.some((e) => e === target || e.startsWith(`${target}/`));
}

/**
 * The check whose absence made the dry-run a false green: open the artifact
 * that would actually be uploaded and prove it is installable.
 */
function validateTarball(tarball, expectedName, version) {
  const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .map((e) => e.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const label = `${expectedName}@${version} (${basename(tarball)})`;

  if (!entries.includes('package/package.json')) {
    throw new Error(`${label}: tarball has no package/package.json`);
  }
  const manifest = JSON.parse(
    execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], { encoding: 'utf8' }),
  );

  if (manifest.name !== expectedName) {
    throw new Error(`${label}: packed name is "${manifest.name}", expected "${expectedName}"`);
  }
  if (manifest.version !== version) {
    throw new Error(`${label}: packed version is "${manifest.version}", expected "${version}"`);
  }
  if (manifest.devDependencies) {
    throw new Error(`${label}: devDependencies survived into the tarball`);
  }
  assertPublishableRanges(manifest, label);

  if (!entries.includes('package/LICENSE')) {
    throw new Error(
      `${label}: no package/LICENSE — the manifest declares "${manifest.license}" and AGPL section 4 ` +
        `requires the licence text to travel with every copy`,
    );
  }

  // Compiled unit tests are never part of a package's public surface, and a
  // stale `dist/` (tsc never cleans its outDir) is the usual way they sneak in.
  const tests = entries.filter((e) => /\.(test|spec)\.(([cm]?js)|d\.[cm]?ts)$/.test(e));
  if (tests.length) {
    throw new Error(
      `${label}: ${tests.length} compiled test file(s) in the tarball — exclude them from the ` +
        `build config and clear a stale dist/:\n` +
        tests.slice(0, 8).map((t) => `    ${t}`).join('\n'),
    );
  }

  const missing = referencedPaths(manifest).filter((p) => !tarballHas(entries, p));
  if (missing.length) {
    throw new Error(
      `${label}: exports/main/types/bin name ${missing.length} path(s) that are not in the tarball ` +
        `(consumers get ERR_MODULE_NOT_FOUND):\n` +
        missing.map((p) => `    ${p}`).join('\n'),
    );
  }

  // `files` entries npm silently drops when they do not exist — that is how
  // the flagship shipped with an empty npm README page.
  const promised = (manifest.files ?? []).filter((f) => !/[*?[\]!]/.test(f));
  const unmet = promised.filter((f) => !tarballHas(entries, f.replace(/^\.?\//, '')));
  if (unmet.length) {
    throw new Error(
      `${label}: "files" promises path(s) absent from the tarball: ${unmet.join(', ')}`,
    );
  }
  return entries.length;
}

/**
 * The flagship's extra X-ray: exactly the bundled packages are inside, each
 * with no dependency list of its own, and nothing else sits in node_modules.
 */
function validateBundledFlagship(tarball, bundled, version) {
  const entries = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .map((e) => e.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const read = (path) =>
    JSON.parse(execFileSync('tar', ['-xzOf', tarball, path], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  const label = `${mappedName(FLAGSHIP)}@${version} (${basename(tarball)})`;
  const manifest = read('package/package.json');

  const listed = [...(manifest.bundleDependencies ?? [])].sort();
  if (JSON.stringify(listed) !== JSON.stringify([...bundled].sort())) {
    throw new Error(`${label}: bundleDependencies is [${listed.join(', ')}], expected [${[...bundled].sort().join(', ')}]`);
  }
  const problems = [];
  for (const name of bundled) {
    const expected = `npm:${mappedName(name)}@${version}`;
    if (manifest.dependencies?.[name] !== expected) {
      problems.push(`dependencies.${name} is "${manifest.dependencies?.[name]}", expected "${expected}"`);
    }
    const inner = `package/node_modules/${name}/package.json`;
    if (!entries.includes(inner)) {
      problems.push(`${name} is not inside the tarball`);
      continue;
    }
    const pkg = read(inner);
    if (pkg.name !== mappedName(name) || pkg.version !== version) {
      problems.push(`${inner} is ${pkg.name}@${pkg.version}, expected ${mappedName(name)}@${version}`);
    }
    const lists = [...DEP_FIELDS, 'bundleDependencies', 'bundledDependencies'].filter((field) => pkg[field] !== undefined);
    if (lists.length) problems.push(`${inner} still has ${lists.join(', ')} (npm would install them)`);
  }
  const stray = [
    ...new Set(
      entries
        .filter((e) => e.startsWith('package/node_modules/'))
        .map((e) => e.split('/').slice(2, e.split('/')[2]?.startsWith('@') ? 4 : 3).join('/'))
        // A bare `@scope` is a directory entry, not a package.
        .filter((name) => name && !(name.startsWith('@') && !name.includes('/')) && !bundled.includes(name)),
    ),
  ];
  if (stray.length) problems.push(`packages inside the tarball that are not bundled: ${stray.join(', ')}`);
  if (problems.length) {
    throw new Error(`${label}:\n${problems.map((p) => `    ${p}`).join('\n')}`);
  }
  assertNoBrowserLibraries(manifest, label);
}

/* ------------------------------------------------------------------ *
 * working-tree mutation, and getting out of it alive
 * ------------------------------------------------------------------ */

/** @type {Array<{ kind: 'manifest' | 'staged', path: string, contents?: string }>} */
const pending = [];
let restoring = false;

function restorePending() {
  if (restoring) return;
  restoring = true;
  const failures = [];
  while (pending.length) {
    const item = pending.pop();
    try {
      if (item.kind === 'manifest') writeFileSync(item.path, item.contents);
      else rmSync(item.path, { force: true });
    } catch (err) {
      failures.push(`${item.path}: ${err?.message ?? err}`);
    }
  }
  if (failures.length) {
    console.error(
      '\nCOULD NOT RESTORE the working tree — fix these by hand before committing:\n' +
        failures.map((f) => `  ${f}`).join('\n'),
    );
  }
  restoring = false;
}

/**
 * Signal safety, and why it is shaped like this.
 *
 * A `finally` block does NOT run when a signal kills the process, so the old
 * script left every processed manifest rewritten (devDependencies deleted) on
 * any Ctrl-C or cancelled CI job. Registering a JS listener changes the
 * disposition: node stops dying on the signal and instead queues the callback.
 * But a callback can only run when the event loop turns, and the publish loop
 * is a wall of synchronous execFileSync — so `main` awaits a tick between
 * packages, which is the ONLY point at which the queued handler can fire. By
 * then the current package has already been unstaged by its own `finally`, so
 * the tree is whole when the handler re-raises.
 *
 * SIGKILL remains unrecoverable by construction; the end-of-run integrity
 * sweep in `assertTreeRestored` is what catches its aftermath on the next run.
 */
let interrupted = null;

function installRestoreHandlers() {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      interrupted = signal;
      console.error(`\n${signal} — restoring package.json files before exiting…`);
      restorePending();
      // Re-raise with the default disposition so the exit status is honest.
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }
  process.on('uncaughtException', (err) => {
    restorePending();
    console.error(err);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    restorePending();
    console.error(err);
    process.exit(1);
  });
  // Backstop for anything that reaches exit without unwinding (sync fs calls
  // are legal in an 'exit' handler).
  process.on('exit', restorePending);
}

/** Yield to the event loop so a queued signal handler gets its turn. */
const tick = () => new Promise((r) => setImmediate(r));

/**
 * Last line of defence: prove every manifest is byte-identical to what was
 * read at discovery. If one is not but still carries OUR rewrite (the mapped
 * publish name), put it back; if it differs some other way, leave it and shout
 * rather than clobber a concurrent edit.
 */
function assertTreeRestored() {
  const repaired = [];
  const foreign = [];
  for (const [path, original] of originals) {
    let current;
    try {
      current = readFileSync(path, 'utf8');
    } catch (err) {
      foreign.push(`${path}: unreadable (${err?.message ?? err})`);
      continue;
    }
    if (current === original) continue;
    let looksLikeOurs = false;
    try {
      looksLikeOurs = JSON.parse(current).name === mappedName(JSON.parse(original).name);
    } catch {
      looksLikeOurs = false;
    }
    if (looksLikeOurs) {
      writeFileSync(path, original);
      repaired.push(path);
    } else {
      foreign.push(`${path}: changed during the run by something else — left as-is`);
    }
  }
  if (repaired.length) {
    console.error(
      `\nintegrity sweep: put back ${repaired.length} manifest(s) the normal restore missed:\n` +
        repaired.map((p) => `  ${p}`).join('\n'),
    );
  }
  if (foreign.length) console.error('\nintegrity sweep:\n' + foreign.map((f) => `  ${f}`).join('\n'));
}

/** Rewrite one package.json and drop a LICENSE beside it; both are undone. */
function stagePackage(w, publishManifest) {
  // The backup is the text captured at DISCOVERY, never a re-read: re-reading
  // would snapshot an already-rewritten manifest and make the mutation
  // permanent if a previous attempt died mid-flight.
  const original = originals.get(w.pkgPath);
  if (typeof original !== 'string' || !publishManifest) {
    throw new Error(`internal: no pristine manifest recorded for ${w.pkgPath}`);
  }
  pending.push({ kind: 'manifest', path: w.pkgPath, contents: original });
  writeFileSync(w.pkgPath, JSON.stringify(publishManifest, null, 2) + '\n');

  // npm only picks up a LICENSE from the PACKAGE root; the repo has exactly
  // one, at the monorepo root. Copy it in for the duration of the pack.
  const licensePath = join(w.dir, 'LICENSE');
  if (!existsSync(licensePath)) {
    copyFileSync(ROOT_LICENSE, licensePath);
    pending.push({ kind: 'staged', path: licensePath });
  }
}

/** Undo everything staged for one package (called right after its publish). */
function unstagePackage() {
  restorePending();
}

/* ------------------------------------------------------------------ *
 * registry probe
 * ------------------------------------------------------------------ */

function alreadyPublished(name, version) {
  try {
    execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */

/** `npm pack` in `dir`; returns the one tarball it wrote, moved to `destDir`. */
function packDir(dir, label, destDir) {
  rmSync(PACK_TMP, { recursive: true, force: true });
  mkdirSync(PACK_TMP, { recursive: true });
  execFileSync('npm', ['pack', '--pack-destination', PACK_TMP], { cwd: dir, stdio: 'inherit' });
  const packed = readdirSync(PACK_TMP).filter((f) => f.endsWith('.tgz'));
  if (packed.length !== 1) {
    throw new Error(`npm pack produced ${packed.length} tarballs for ${label}, expected 1`);
  }
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, packed[0]);
  rmSync(dest, { force: true });
  renameSync(join(PACK_TMP, packed[0]), dest);
  rmSync(PACK_TMP, { recursive: true, force: true });
  return dest;
}

/** Pack a workspace in place, with `manifest` written over its package.json for the duration. */
function packWorkspace(w, manifest, destDir) {
  try {
    stagePackage(w, manifest);
    return packDir(w.dir, w.pkg.name, destDir);
  } finally {
    // One package wide: the tree is whole again before the next package.
    unstagePackage();
  }
}

/** Unpack an npm tarball's `package/` folder into `dir`. */
function extractPackage(tarball, dir) {
  mkdirSync(dir, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', dir, '--strip-components=1']);
}

/**
 * The flagship tarball, with its bundled packages inside.
 *
 * Packing in place cannot do this: in the monorepo, node_modules/@adminium/*
 * are pnpm links into the workspace, and npm would follow them into every
 * bundled package's dependency tree. So the flagship's own files are packed in
 * place WITHOUT bundleDependencies, unpacked into a staging folder next to the
 * bundled packages' own packed files, and packed again from there.
 */
function packFlagship(server, manifest, bundledTarballs) {
  const ownFilesManifest = { ...manifest };
  delete ownFilesManifest.bundleDependencies;
  const ownFiles = packWorkspace(server, ownFilesManifest, join(FLAGSHIP_TMP, 'own-files'));

  rmSync(STAGE_DIR, { recursive: true, force: true });
  extractPackage(ownFiles, STAGE_DIR);
  for (const { name, tarball } of bundledTarballs) {
    const dir = join(STAGE_DIR, 'node_modules', name);
    extractPackage(tarball, dir);
    // The bundled copy's manifest was packed without dependency lists
    // (rewriteForBundle); assert it rather than trust it.
    const inner = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const lists = [...DEP_FIELDS, 'bundleDependencies'].filter((field) => inner[field] !== undefined);
    if (lists.length) throw new Error(`${name}: the bundled copy still has ${lists.join(', ')}`);
  }
  writeFileSync(join(STAGE_DIR, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  return packDir(STAGE_DIR, `${server.pkg.name} (bundled)`, join(FLAGSHIP_TMP, 'final'));
}

/**
 * Every internal alias must point at a package this same run ships, at the
 * same version — otherwise a consumer resolves `npm:@scope/x@1.2.3` against a
 * version that never reaches the registry. For the flagship "ships" means
 * bundled; for the other published packages it means published. Cheap, and it
 * catches a publish set that silently lost a member.
 */
function assertInternalGraphComplete(published, bundled) {
  const byName = new Map(published.map((w) => [w.pkg.name, w]));
  const problems = [];
  for (const w of published) {
    for (const field of DEP_FIELDS) {
      for (const [dep, range] of Object.entries(w.pkg[field] ?? {})) {
        if (!dep.startsWith('@adminium/')) continue;
        if (w.pkg.name === FLAGSHIP) {
          if (!bundled.has(dep)) {
            problems.push(`${w.pkg.name} ${field}.${dep} (${range}) — ${dep} is not bundled (server-runtime-deps.json)`);
          }
          continue;
        }
        const target = byName.get(dep);
        if (!target) {
          problems.push(`${w.pkg.name} ${field}.${dep} (${range}) — ${dep} is not in the publish set`);
        } else if (target.pkg.version !== w.pkg.version) {
          problems.push(
            `${w.pkg.name}@${w.pkg.version} ${field}.${dep} would alias ` +
              `${mappedName(dep)}@${w.pkg.version}, but ${dep} is at ${target.pkg.version}`,
          );
        }
      }
    }
  }
  if (problems.length) {
    throw new Error(
      'internal dependency graph is not publishable:\n' + problems.map((p) => `    ${p}`).join('\n'),
    );
  }
}

async function main() {
  if (!existsSync(ROOT_LICENSE)) {
    throw new Error(`no LICENSE at the repo root (${ROOT_LICENSE}) — refusing to publish`);
  }

  const catalogs = loadCatalogs();
  const workspaces = loadWorkspaces();
  const server = workspaces.get(FLAGSHIP);
  if (!server) throw new Error(`${FLAGSHIP} is not among the workspaces`);
  const published = topoSort([...workspaces.values()].filter((w) => w.pkg.private !== true));

  // What the flagship carries is traced from the built code. A stale trace
  // would publish a manifest missing a dependency, so a stale one stops here.
  console.log('checking scripts/release/server-runtime-deps.json against the built code…');
  execFileSync('node', [join(ROOT, 'scripts/release/server-runtime-deps.mjs'), '--check'], { stdio: 'inherit' });
  const runtime = JSON.parse(readFileSync(RUNTIME_DEPS_FILE, 'utf8'));
  const bundled = runtime.bundled.map((name) => {
    const w = workspaces.get(name);
    if (!w) throw new Error(`server-runtime-deps.json bundles ${name}, which is not a workspace`);
    if (w.pkg.version !== server.pkg.version) {
      throw new Error(`${name} is at ${w.pkg.version} but ${FLAGSHIP} is at ${server.pkg.version}`);
    }
    return w;
  });

  console.log(
    `${DRY_RUN ? 'DRY-RUN pack' : 'PUBLISH'} of ${published.length} packages under @${SCOPE}:\n` +
      published.map((w) => `  ${w.pkg.name} -> ${mappedName(w.pkg.name)}@${w.pkg.version}`).join('\n') +
      `\n${mappedName(FLAGSHIP)} carries ${bundled.length} packages inside it:\n` +
      bundled.map((w) => `  ${w.pkg.name}`).join('\n'),
  );
  console.log(
    `\npnpm catalogs: default=${catalogs.default.size} entr${catalogs.default.size === 1 ? 'y' : 'ies'}` +
      (catalogs.named.size ? `, named=[${[...catalogs.named.keys()].join(', ')}]` : ''),
  );

  // PRE-FLIGHT. Build every publish manifest and assert it up front: one bad
  // range aborts the whole run rather than half-publishing an immutable set.
  assertInternalGraphComplete(published, new Set(runtime.bundled));
  const staged = new Map();
  for (const w of published) {
    const manifest =
      w === server
        ? rewriteFlagship(server, runtime.bundled, runtime.fromBundled, workspaces, catalogs)
        : rewriteForPublish(w.pkg, catalogs);
    assertPublishableRanges(manifest, `${w.pkg.name} (staged manifest)`);
    staged.set(w.pkg.name, manifest);
  }
  const bundledManifests = new Map(bundled.map((w) => [w.pkg.name, rewriteForBundle(w.pkg, catalogs)]));
  for (const w of [...published, ...bundled]) track(w);
  console.log(
    `pre-flight: ${staged.size} manifests resolve to registry-installable ranges; ` +
      `${mappedName(FLAGSHIP)} declares ${Object.keys(staged.get(FLAGSHIP).dependencies).length} dependencies.`,
  );

  // The CLI resolver probes the bundled vocabulary snapshot first — a stale
  // snapshot ships a stale LLM allow-list, silently.
  console.log('\nregenerating apps/server/vocabulary from the built widgets dist…');
  execFileSync('node', [join(ROOT, 'apps/server/scripts/bundle-allowlists.mjs')], {
    stdio: 'inherit',
  });

  // Bundle the dashboard EXPLICITLY rather than leaning on apps/server's
  // `prepack`. `apps/server/dashboard/` is gitignored, so on a fresh CI
  // checkout it exists only if something creates it — and `rewriteForPublish`
  // strips `scripts` (build-time commands naming files the tarball excludes),
  // which removes that hook. Doing it here keeps the flagship from shipping
  // without the SPA it is supposed to serve, and makes packing deterministic
  // instead of dependent on npm lifecycle ordering.
  console.log('bundling the dashboard into apps/server…');
  execFileSync('node', [join(ROOT, 'apps/server/scripts/bundle-dashboard.mjs')], {
    stdio: 'inherit',
  });
  // `adminium new --sample` needs the demo seed, which lives in apps/desktop.
  execFileSync('node', [join(ROOT, 'apps/server/scripts/bundle-samples.mjs')], {
    stdio: 'inherit',
  });

  mkdirSync(OUT_DIR, { recursive: true });
  for (const dir of SCRATCH_DIRS) rmSync(dir, { recursive: true, force: true });
  installRestoreHandlers();

  const results = [];
  try {
    // ── PHASE 1: pack and X-ray EVERY package. Nothing is published yet. ────
    //
    // Publishing is irreversible: a version, once taken, can never be reused.
    // So a packaging defect discovered on package 12 must not leave 11 immutable
    // packages on the registry — the pre-flight above covers the dependency
    // ranges, but only packing can reveal a missing LICENSE, an unmet `files`
    // promise or an exports target absent from the tarball. Both classes must
    // therefore fail the whole run BEFORE the first upload.
    const validated = [];
    for (const w of published) {
      // The one point in the run where the event loop turns: a queued
      // SIGINT/SIGTERM handler fires HERE, between packages, with the tree
      // already whole. Without it the handler could never run at all.
      await tick();
      if (interrupted) break;

      const publishName = mappedName(w.pkg.name);
      if (!DRY_RUN && alreadyPublished(publishName, w.pkg.version)) {
        results.push(`SKIP  ${publishName}@${w.pkg.version} (already on registry)`);
        continue;
      }

      let tarball;
      if (w === server) {
        const bundledTarballs = [];
        for (const b of bundled) {
          await tick();
          if (interrupted) break;
          const packed = packWorkspace(b, bundledManifests.get(b.pkg.name), BUNDLED_TMP);
          const count = validateTarball(packed, mappedName(b.pkg.name), b.pkg.version);
          console.log(`  validated ${b.pkg.name} for the bundle (${count} entries)`);
          bundledTarballs.push({ name: b.pkg.name, tarball: packed });
        }
        if (interrupted) break;
        tarball = packFlagship(server, staged.get(w.pkg.name), bundledTarballs);
      } else {
        tarball = packWorkspace(w, staged.get(w.pkg.name), VALIDATE_TMP);
      }
      const fileCount = validateTarball(tarball, publishName, w.pkg.version);
      if (w === server) validateBundledFlagship(tarball, runtime.bundled, w.pkg.version);
      const dest = join(OUT_DIR, basename(tarball));
      rmSync(dest, { force: true });
      renameSync(tarball, dest);
      console.log(`  validated ${publishName}@${w.pkg.version} (${fileCount} entries)`);
      validated.push({ w, publishName, tarball: dest });
    }

    // ── PHASE 2: upload the validated tarballs, in dependency order ─────────
    //
    // Topological, so an alias (`npm:@scope/dep@x`) never names a version that
    // is not on the registry yet. The bytes uploaded are the exact bytes that
    // passed the X-ray above — nothing is re-packed here.
    if (!DRY_RUN && !interrupted) {
      for (const { w, publishName, tarball } of validated) {
        // A PRERELEASE MUST NOT BECOME `latest`.
        //
        // `npm publish` with no `--tag` moves the `latest` dist-tag, so an
        // rc rehearsal would hand every `npm i @adminiumjs/<pkg>` a release
        // candidate across every published package — and undoing it means restoring
        // the tag on each one by hand. The release workflow is prerelease-
        // aware everywhere else (docker leaves `:latest` alone, the GitHub
        // release gets `--prerelease`); this is that rule for npm.
        //
        // Semver says any version carrying a `-` is a prerelease, which is the
        // same test the workflow uses, so the two cannot disagree.
        const distTag = w.pkg.version.includes('-') ? 'next' : 'latest';
        execFileSync(
          'npm',
          [
            'publish',
            tarball,
            '--access',
            'public',
            '--tag',
            distTag,
            ...(process.env.NPM_PROVENANCE === '1' ? ['--provenance'] : []),
          ],
          { cwd: w.dir, stdio: 'inherit' },
        );
        results.push(`PUB   ${publishName}@${w.pkg.version} (dist-tag: ${distTag})`);
      }
    } else {
      for (const { publishName, w } of validated) {
        results.push(`PACK  ${publishName}@${w.pkg.version}`);
      }
    }
  } finally {
    restorePending();
    assertTreeRestored();
    for (const dir of SCRATCH_DIRS) rmSync(dir, { recursive: true, force: true });
  }
  console.log('\n' + results.join('\n'));
  console.log(`\ntarballs in ${OUT_DIR}`);
}

main().catch((err) => {
  restorePending();
  assertTreeRestored();
  console.error(`\n${err?.stack ?? err}`);
  process.exitCode = 1;
});
