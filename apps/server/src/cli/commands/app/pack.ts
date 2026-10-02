// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium app pack` — make the file the install page takes.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { packApp, type PackedApp } from '../../../project/apps/pack-app.js';
import { resolveAppKey } from '../../../project/apps/read-app.js';
import type { ProjectLocation } from '../../../project/locate.js';
import { parseFlags, type FlagSpecs } from '../../args.js';
import type { Command, CommandContext } from '../../command.js';
import { EXIT_OK, EXIT_VALIDATION_FAILED } from '../../exit.js';
import { checkAndBuild, type BuiltApp } from './build.js';
import { requireProject } from './shared.js';

/** Where packs go unless told otherwise: inside the folder a project already keeps out of git. */
export const PACKS_DIR = join('.adminium', 'packs');

const flags: FlagSpecs = {
  out: { type: 'string', placeholder: '<dir>', describe: 'Where to write the package', defaultDescription: '.adminium/packs' },
};

/** Check, build and pack. Null when the check failed (the problems were printed). */
export async function checkBuildAndPack(
  io: CommandContext['io'],
  project: ProjectLocation,
  key: string,
  opts: { quiet?: boolean; brief?: boolean } = {},
): Promise<{ built: BuiltApp; packed: PackedApp } | null> {
  const built = await checkAndBuild(io, project, key, opts);
  if (built === null) return null;
  return { built, packed: await packApp(built.check, built.sides) };
}

export const appPackCommand: Command = {
  name: 'pack',
  summary: 'Check, build and pack the app into a file to install',
  usage: 'adminium app pack [key] [--out <dir>]',
  describe:
    'Checks the app, builds its sides, and writes <key>-<version>.tgz with its\n' +
    'fingerprint beside it (<key>-<version>.tgz.integrity). The package holds the\n' +
    'manifest as one manifest.json, each built side, and seeds/. Install it from\n' +
    'Studio → Hosted apps → Install an app: upload the file and paste the\n' +
    'fingerprint. Hooks and actions are not part of an app package.',
  flags,

  async run({ io, deps, argv }) {
    const { values, positionals } = parseFlags(argv, flags, 'app pack');
    const project = requireProject({ deps }, 'pack');
    const key = resolveAppKey(project.root, positionals[0], 'pack');
    const done = await checkBuildAndPack(io, project, key, { brief: true });
    if (done === null) return EXIT_VALIDATION_FAILED;
    const { packed } = done;

    const out = resolve(deps.cwd, typeof values['out'] === 'string' ? values['out'] : join(project.root, PACKS_DIR));
    mkdirSync(out, { recursive: true });
    const file = join(out, packed.fileName);
    writeFileSync(file, packed.tarball);
    writeFileSync(`${file}.integrity`, `${packed.integrity}\n`);

    const shown = relative(deps.cwd, file).split(sep).join('/');
    io.out(`Packed ${packed.key} ${packed.version} → ${shown.startsWith('..') ? file : shown}`);
    io.out(`  files:       ${String(packed.fileCount)}`);
    io.out(`  size:        ${String(Math.ceil(packed.tarball.byteLength / 1024))} kB`);
    io.out(`  fingerprint: ${packed.integrity}`);
    io.out('');
    io.out('Install it: Studio → Hosted apps → Install an app. Upload the file and paste the fingerprint.');
    const addOns = (done.built.check.manifest?.addOns?.requires ?? []).length > 0 ? ' --add-ons <folder>' : '';
    io.out(`Or prove it installs first:  npx @adminiumjs/adminium app try ${packed.key}${addOns}`);
    return EXIT_OK;
  },
};
