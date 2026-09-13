// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pack an app checkout into a bundled-set tarball
 * (47-app-installation.md step 4).
 *
 * The bundled set is how `/studio/apps` has real apps to browse and install
 * before anything is published to a registry (47 O1), and it is the same shape
 * the add-on bundle takes: `<key>-<version>.tgz` beside a `.tgz.integrity`,
 * staged into the store at boot by `seedBundledPackages`.
 *
 * ─── Why it packs from a STAGING directory ──────────────────────────────────
 *
 * `npm pack` packs a package root, and an app repo's root is its SOURCE — src/,
 * node_modules, db/, the comp's fixtures. What the server serves is
 * `dist-surface/<key>/<side>/`, which the install path expects to find at
 * `staff/` and `customer/` once npm's `package/` prefix is stripped. So the
 * files are staged into the shape the tarball needs and packed from there,
 * rather than teaching every app repo a `files` field that has to stay in step
 * with a layout it does not own.
 *
 * That also means this script needs NO change in the 15 app repos, which is the
 * point: a fleet-wide edit to add a pack script would be 15 pull requests to
 * produce bytes this can produce from the checkouts as they already are.
 *
 * Usage:
 *   node scripts/release/pack-app-bundle.mjs <app-checkout> [--out <dir>] [--build]
 *
 *   --build   run `npm run build:surface` in the checkout first; without it the
 *             existing `dist-surface/` is packed, which is what you want when
 *             the surfaces were just built by something else.
 *   --publishable
 *             drop `private: true` from the staged package and print the
 *             `npm publish` line. The bundled set does NOT need this — a
 *             bundled tarball is read off disk and never leaves the image —
 *             but 4c's registry path publishes this exact package, and a
 *             staging manifest that npm refuses is a trap waiting at the end
 *             of a release run rather than at the start of one.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const checkout = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const outIndex = args.indexOf('--out');
const out = resolve(outIndex === -1 ? 'apps-bundle' : (args[outIndex + 1] ?? 'apps-bundle'));
const build = args.includes('--build');
const publishable = args.includes('--publishable');

const manifestPath = join(checkout, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`no manifest.json in ${checkout} — is that an app checkout?`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const { key, version } = manifest;
if (typeof key !== 'string' || typeof version !== 'string') {
  console.error('manifest.json has no key/version');
  process.exit(1);
}
if (manifest.kind !== 'app') {
  console.error(`manifest.json declares kind "${String(manifest.kind)}" — this packs apps`);
  process.exit(1);
}

if (build) {
  console.log(`building surfaces in ${checkout} …`);
  execFileSync('npm', ['run', 'build:surface'], { cwd: checkout, stdio: 'inherit' });
}

// `build:surface` writes `dist-surface/<key>/<side>` — the key is the app's own,
// which is why it is read from the manifest rather than guessed from the folder.
const built = join(checkout, 'dist-surface', key);
const sides = ['staff', 'customer'].filter((side) => existsSync(join(built, side, 'index.html')));
if (sides.length === 0) {
  console.error(
    `no built surface under ${built} — run \`npm run build:surface\` in the checkout, or pass --build`,
  );
  process.exit(1);
}

const staging = mkdtempSync(join(tmpdir(), `app-pack-${key}-`));
try {
  writeFileSync(
    join(staging, 'package.json'),
    `${JSON.stringify(
      {
        name: `@adminiumjs/app-${key}`,
        version,
        // npm REFUSES to publish a package marked private, so the flag that
        // makes a bundled tarball safe is the one that would fail a release.
        ...(publishable ? {} : { private: true }),
        description: `Built surfaces for the ${key} app.`,
        files: ['manifest.json', ...sides],
      },
      null,
      2,
    )}\n`,
  );
  cpSync(manifestPath, join(staging, 'manifest.json'));
  for (const side of sides) cpSync(join(built, side), join(staging, side), { recursive: true });

  execFileSync('npm', ['pack', '--pack-destination', staging], { cwd: staging, stdio: 'pipe' });
  const packed = readdirSync(staging).find((f) => f.endsWith('.tgz'));
  if (packed === undefined) throw new Error('npm pack produced no tarball');

  mkdirSync(out, { recursive: true });
  // `seedBundledPackages` parses `<key>-<version>.tgz` from the RIGHT; npm's
  // own name (`adminiumjs-app-<key>-<version>.tgz`) would parse to a key
  // nothing asks for.
  const target = join(out, `${key}-${version}.tgz`);
  renameSync(join(staging, packed), target);

  const bytes = readFileSync(target);
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  writeFileSync(`${target}.integrity`, `${integrity}\n`);

  console.log(`${key}@${version} → ${target}`);
  console.log(`  sides:     ${sides.join(', ')}`);
  console.log(`  bytes:     ${bytes.length}`);
  console.log(`  integrity: ${integrity}`);
  if (publishable) {
    console.log(`\n  publish with:  npm publish ${target} --access public`);
    console.log('  (the first publish of a NEW package needs the 2FA bootstrap; after that,');
    console.log('   OIDC trusted publishing from the release workflow — see 47 §5, 4c)');
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
