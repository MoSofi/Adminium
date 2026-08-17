// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ensure-storybook — build `storybook-static/` only when needed.
 *
 * The VRT and a11y harnesses run against the static build. Rebuilding on
 * every run is slow, so: reuse an existing build unless (a) it is missing,
 * (b) VRT_FRESH=1 / A11Y_FRESH=1 is set, or (c) any story/source file under
 * src/ or .storybook/ is newer than the build's index.json.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const indexJson = join(pkgRoot, 'storybook-static', 'index.json');

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(join(dir, entry.name)));
    } else if (entry.isFile()) {
      newest = Math.max(newest, statSync(join(dir, entry.name)).mtimeMs);
    }
  }
  return newest;
}

const forceFresh = process.env.VRT_FRESH === '1' || process.env.A11Y_FRESH === '1';
let build = forceFresh || !existsSync(indexJson);
if (!build) {
  const builtAt = statSync(indexJson).mtimeMs;
  const srcNewest = Math.max(newestMtime(join(pkgRoot, 'src')), newestMtime(join(pkgRoot, '.storybook')));
  build = srcNewest > builtAt;
  if (build) console.log('[ensure-storybook] sources newer than build — rebuilding');
}

if (build) {
  execFileSync('pnpm', ['build-storybook'], { cwd: pkgRoot, stdio: 'inherit' });
} else {
  console.log('[ensure-storybook] reusing existing storybook-static build');
}
