// SPDX-License-Identifier: AGPL-3.0-only
/**
 * electron-builder's `afterPack`: put the carried npm beside the archive.
 *
 * Why a step of our own. A project in the app is installed with the npm the app
 * carries, started as "the app's program, as Node, with npm's entry file". That
 * entry and everything it requires must be real files, and npm keeps its own
 * packages in a `node_modules` folder inside itself. electron-builder's
 * `extraResources` copy leaves every `node_modules` folder out, whatever its
 * filter says (tried: npm arrived at 3.3 MB and could not start), so the copy is
 * made here, whole, links followed.
 *
 * It runs before the app is signed. The carried npm holds no program and no
 * library, so it adds nothing to sign; it is covered by the app's seal like any
 * other resource.
 */
const { cpSync, existsSync, readFileSync, realpathSync, rmSync } = require('node:fs');
const { join } = require('node:path');

/** Where a packed app keeps its resources, per system. */
function resourcesDir(context) {
  if (context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas') {
    return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  }
  return join(context.appOutDir, 'resources');
}

exports.default = async function afterPack(context) {
  const from = realpathSync(join(context.packager.projectDir, 'node_modules', 'npm'));
  const to = join(resourcesDir(context), 'npm');
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, dereference: true });
  // Said outright, because a carried npm that cannot start is found only when a person makes their first project.
  for (const file of ['bin/npm-cli.js', 'bin/npx-cli.js', 'node_modules/graceful-fs/package.json', 'node_modules/@npmcli/arborist/package.json']) {
    if (!existsSync(join(to, file))) throw new Error(`after-pack: the carried npm is not whole: ${file} is missing in ${to}`);
  }
  const wanted = JSON.parse(readFileSync(join(context.packager.projectDir, 'package.json'), 'utf8')).dependencies.npm;
  const got = JSON.parse(readFileSync(join(to, 'package.json'), 'utf8')).version;
  if (got !== wanted) throw new Error(`after-pack: the carried npm is ${got}, and package.json pins ${wanted}`);
  console.log(`  • carried npm ${got} → ${to}`);
};
