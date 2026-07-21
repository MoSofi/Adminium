#!/usr/bin/env node
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
 * Usage:
 *   node scripts/release/publish-npm.mjs --dry-run   # pack to scripts/release/out/
 *   node scripts/release/publish-npm.mjs             # publish (needs npm auth)
 * Env:
 *   NPM_SCOPE       target scope, default adminiumjs
 *   NPM_PROVENANCE  "1" to pass --provenance (CI with OIDC only)
 *
 * Idempotent: versions already on the registry are skipped, so a failed run
 * resumes safely. Original package.json files are always restored.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCOPE = process.env.NPM_SCOPE ?? 'adminiumjs';
const DRY_RUN = process.argv.includes('--dry-run');
const OUT_DIR = join(ROOT, 'scripts/release/out');

/** Workspace dirs that may publish (apps/server is the CLI flagship). */
const WORKSPACE_GLOBS = ['packages', 'apps'];

/** @adminium/server ships the product; everything else keeps its basename. */
function mappedName(sourceName) {
  if (sourceName === '@adminium/server') return `@${SCOPE}/adminium`;
  return sourceName.replace(/^@adminium\//, `@${SCOPE}/`);
}

function loadWorkspaces() {
  const found = [];
  for (const group of WORKSPACE_GLOBS) {
    const dirs = execFileSync('ls', [join(ROOT, group)], { encoding: 'utf8' })
      .trim()
      .split('\n');
    for (const dir of dirs) {
      const pkgPath = join(ROOT, group, dir, 'package.json');
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      } catch {
        continue;
      }
      if (pkg.private === true || !pkg.name?.startsWith('@adminium/')) continue;
      found.push({ dir: join(ROOT, group, dir), pkgPath, pkg });
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

function rewriteForPublish(pkg) {
  const out = structuredClone(pkg);
  out.name = mappedName(pkg.name);
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = out[field];
    if (!deps) continue;
    for (const [dep, range] of Object.entries(deps)) {
      if (!dep.startsWith('@adminium/')) continue;
      if (!range.startsWith('workspace:')) {
        throw new Error(`${pkg.name} ${field}.${dep} is "${range}" — expected workspace:*`);
      }
      deps[dep] = `npm:${mappedName(dep)}@${pkg.version}`;
    }
  }
  // Publishing under an alias scope: devDependencies are irrelevant to
  // consumers and may reference private workspaces — drop them from the
  // published manifest (the repo copy is restored afterwards).
  delete out.devDependencies;
  return out;
}

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

function main() {
  const workspaces = topoSort(loadWorkspaces());
  console.log(
    `${DRY_RUN ? 'DRY-RUN pack' : 'PUBLISH'} of ${workspaces.length} packages under @${SCOPE}:\n` +
      workspaces.map((w) => `  ${w.pkg.name} -> ${mappedName(w.pkg.name)}@${w.pkg.version}`).join('\n'),
  );

  // The CLI resolver probes the bundled vocabulary snapshot first — a stale
  // snapshot ships a stale LLM allow-list, silently.
  console.log('\nregenerating apps/server/vocabulary from the built widgets dist…');
  execFileSync('node', [join(ROOT, 'apps/server/scripts/bundle-allowlists.mjs')], {
    stdio: 'inherit',
  });

  if (DRY_RUN) mkdirSync(OUT_DIR, { recursive: true });

  const backups = new Map();
  const results = [];
  try {
    for (const w of workspaces) {
      const publishName = mappedName(w.pkg.name);
      if (!DRY_RUN && alreadyPublished(publishName, w.pkg.version)) {
        results.push(`SKIP  ${publishName}@${w.pkg.version} (already on registry)`);
        continue;
      }
      backups.set(w.pkgPath, readFileSync(w.pkgPath, 'utf8'));
      writeFileSync(w.pkgPath, JSON.stringify(rewriteForPublish(w.pkg), null, 2) + '\n');

      const args = DRY_RUN
        ? ['pack', '--pack-destination', OUT_DIR]
        : [
            'publish',
            '--access',
            'public',
            ...(process.env.NPM_PROVENANCE === '1' ? ['--provenance'] : []),
          ];
      execFileSync('npm', args, { cwd: w.dir, stdio: 'inherit' });
      results.push(`${DRY_RUN ? 'PACK' : 'PUB '}  ${publishName}@${w.pkg.version}`);
    }
  } finally {
    for (const [path, contents] of backups) writeFileSync(path, contents);
  }
  console.log('\n' + results.join('\n'));
  if (DRY_RUN) console.log(`\ntarballs in ${OUT_DIR}`);
}

main();
