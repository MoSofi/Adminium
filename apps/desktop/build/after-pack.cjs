// SPDX-License-Identifier: AGPL-3.0-only
/**
 * electron-builder's `afterPack`: check what the archive holds, and put the
 * carried npm beside it.
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
const { closeSync, cpSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync } = require('node:fs');
const { join } = require('node:path');

/** Where a packed app keeps its resources, per system. */
function resourcesDir(context) {
  if (context.electronPlatformName === 'darwin' || context.electronPlatformName === 'mas') {
    return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources');
  }
  return join(context.appOutDir, 'resources');
}

/** The archive's own list of what it holds (its header), read with no library. */
function archiveHeader(file) {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const json = Buffer.alloc(head.readUInt32LE(12));
    readSync(fd, json, 0, json.length, 16);
    return JSON.parse(json.toString('utf8'));
  } finally {
    closeSync(fd);
  }
}

/** What npm always puts in a package, whatever its `files` says. */
const ALWAYS = new Set(['package.json', 'README.md', 'LICENSE', 'LICENSES']);

/**
 * Every workspace package in the archive holds what its own `files` names and
 * nothing else. The same package installed from npm is exactly that; here it
 * is a folder of the repository, and whatever lies in that folder rides along
 * unless the build's list cuts it (41 MB of test pictures once did).
 */
/**
 * Every workspace package's manifest, by the package's name, read from the
 * repository itself.
 *
 * NOT from the app's own `node_modules`: only the packages the app depends on
 * DIRECTLY are linked there, and the archive also holds the ones the server
 * brings. Looking there passed every such package unread (the UI package's
 * test baseline and a translators' note rode in every installer until two of
 * them became direct dependencies and were seen).
 */
function workspaceManifests(projectDir) {
  const found = new Map();
  const repository = join(projectDir, '..', '..');
  for (const group of ['apps', 'packages']) {
    const dir = join(repository, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const manifest = join(dir, entry, 'package.json');
      if (!existsSync(manifest)) continue;
      const name = JSON.parse(readFileSync(manifest, 'utf8')).name;
      if (typeof name === 'string') found.set(name, manifest);
    }
  }
  return found;
}

function checkWorkspacePackages(context) {
  const archive = join(resourcesDir(context), 'app.asar');
  if (!existsSync(archive)) return;
  const scope = archiveHeader(archive).files?.node_modules?.files?.['@adminium']?.files ?? {};
  const strays = [];
  const manifests = workspaceManifests(context.packager.projectDir);
  for (const [name, node] of Object.entries(scope)) {
    const manifest = manifests.get(`@adminium/${name}`);
    // Not skipped: a package this check cannot find is one it would otherwise pass unread.
    if (manifest === undefined) throw new Error(`after-pack: @adminium/${name} is in the archive, and no package of the repository has that name.`);
    const named = (JSON.parse(readFileSync(manifest, 'utf8')).files ?? []).map((entry) => entry.split('/')[0]);
    for (const entry of Object.keys(node.files ?? {})) {
      if (!ALWAYS.has(entry) && !named.includes(entry)) strays.push(`@adminium/${name}/${entry}`);
    }
  }
  if (strays.length > 0) {
    throw new Error(`after-pack: the archive holds what no package's \`files\` names. Cut it in electron-builder.yml's \`files\`:\n  ${strays.join('\n  ')}`);
  }
  console.log(`  • ${Object.keys(scope).length} workspace packages in the archive, each holding only what its \`files\` names`);
}

exports.default = async function afterPack(context) {
  checkWorkspacePackages(context);
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
