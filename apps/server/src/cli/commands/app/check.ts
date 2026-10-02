// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `adminium app check` — check an app in this project without starting anything.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { composeManifest, splitManifest } from '@adminium/manifest';

import { checkApp } from '../../../project/apps/check-app.js';
import { MANIFEST_FILE, MANIFEST_PARTS_DIR, appDir, appPath, readAppFolder, resolveAppKey } from '../../../project/apps/read-app.js';
import { APP_VERSION } from '../../../version.js';
import { parseFlags, type FlagSpecs } from '../../args.js';
import type { Command } from '../../command.js';
import { CliError, EXIT_OK, EXIT_VALIDATION_FAILED } from '../../exit.js';
import { hasErrors, printCheck, requireProject } from './shared.js';

const flags: FlagSpecs = {
  json: { type: 'boolean', describe: 'Print the result as JSON' },
  split: { type: 'boolean', describe: 'Rewrite a single manifest.json as a manifest/ folder of parts' },
};

/** Tables and pages in ref order, which is the order the parts compose in. */
function inRefOrder(document: Record<string, unknown>): Record<string, unknown> {
  const byRef = (list: unknown): unknown =>
    Array.isArray(list) ? [...(list as { ref?: string }[])].sort((a, b) => ((a.ref ?? '') < (b.ref ?? '') ? -1 : 1)) : list;
  const schema = document['requiredSchema'];
  return {
    ...document,
    ...(schema !== null && typeof schema === 'object' ? { requiredSchema: { ...schema, tables: byRef((schema as { tables?: unknown }).tables) } } : {}),
    pages: byRef(document['pages']),
  };
}

/** Rewrite `manifest.json` as parts, and remove it only once the parts compose back to it. */
function split(root: string, key: string): string[] {
  const folder = readAppFolder(root, key);
  if (folder.form !== 'file' || folder.document === null) {
    throw new CliError(
      folder.problems[0] === undefined
        ? `${appPath(key)} is already written as ${MANIFEST_PARTS_DIR}/ parts.`
        : `${folder.problems[0].file} ${folder.problems[0].message}`,
    );
  }
  const parts = splitManifest(folder.document);
  const composed = composeManifest(parts);
  if (!composed.ok || !isDeepStrictEqual(composed.document, inRefOrder(folder.document))) {
    throw new CliError(`${appPath(key, MANIFEST_FILE)} cannot be written as parts without changing it, so nothing was written.`, {
      hint: composed.ok ? 'A table or page may be missing its "ref".' : composed.problems.map((p) => `${p.file}: ${p.message}`).join('\n'),
    });
  }
  const dir = join(appDir(root, key), MANIFEST_PARTS_DIR);
  for (const part of parts) {
    const file = join(dir, part.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, part.text);
  }
  rmSync(join(appDir(root, key), MANIFEST_FILE));
  return parts.map((part) => appPath(key, MANIFEST_PARTS_DIR, part.path));
}

export const appCheckCommand: Command = {
  name: 'check',
  summary: 'Check the app: its manifest, its sides, its sample data',
  usage: 'adminium app check [key] [--json] [--split]',
  describe:
    'Puts the manifest together (manifest.json, or the parts in manifest/) and\n' +
    'validates it as an install would, naming the file each problem is in. Also\n' +
    'checks that every side the manifest declares has its code, and the sample\n' +
    'data. Prints what the customer side may reach. Needs no database. Exits 2\n' +
    'when something is wrong.',
  flags,

  async run({ io, deps, argv }) {
    const { values, positionals } = parseFlags(argv, flags, 'app check');
    const project = requireProject({ deps }, 'check');
    const key = resolveAppKey(project.root, positionals[0], 'check');

    if (values['split'] === true) {
      if (existsSync(join(appDir(project.root, key), MANIFEST_PARTS_DIR))) {
        throw new CliError(`${appPath(key, MANIFEST_PARTS_DIR)}/ already exists.`);
      }
      const written = split(project.root, key);
      io.out(`Wrote ${String(written.length)} part file(s) to ${appPath(key, MANIFEST_PARTS_DIR)}/ and removed ${MANIFEST_FILE}.`);
    }

    const check = checkApp(project.root, key, { version: APP_VERSION });
    if (values['json'] === true) {
      io.out(
        JSON.stringify(
          {
            ok: !hasErrors(check),
            key,
            version: check.manifest?.version ?? null,
            form: check.folder.form,
            sides: check.sides,
            problems: check.findings,
            access: check.access,
          },
          null,
          2,
        ),
      );
    } else {
      printCheck(io, check);
    }
    return hasErrors(check) ? EXIT_VALIDATION_FAILED : EXIT_OK;
  },
};
