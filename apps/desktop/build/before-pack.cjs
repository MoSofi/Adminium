// SPDX-License-Identifier: AGPL-3.0-only
/**
 * electron-builder's `beforePack` hook: the server package gets its `skills/`
 * before it is packed.
 *
 * The Designer reads its skill pages and the built-in styles from `skills/`
 * beside the server's `dist/`. That folder is not in git: the server's
 * `prepack` copies it from the repository's `skills/` for npm. The archive
 * takes the workspace package as it is on disk, so without this step the app
 * shipped with none (0.3.31): no skill pages, and a Style picker with only
 * "Let the Designer choose". It runs here, at packing, and not in the build,
 * because the build is cached and the folder is outside its outputs.
 * `after-pack.cjs` then checks the archive holds it.
 */
const { spawnSync } = require('node:child_process');
const { realpathSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function beforePack(context) {
  // The server the archive takes: the workspace package this app links to.
  const server = realpathSync(join(context.packager.projectDir, 'node_modules', '@adminium', 'server'));
  const done = spawnSync(process.execPath, [join(server, 'scripts', 'bundle-skills.mjs')], { stdio: 'inherit' });
  if (done.status !== 0) throw new Error(`before-pack: the skills could not be copied into ${server} (exit ${String(done.status)})`);
};
