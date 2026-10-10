// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The sentences that keep the desktop app working, read from the sources.
 *
 * 1. One module says how a program is started (`project/programs.ts`). A new
 *    `spawn('npm', …)` or `process.execPath` elsewhere works on every terminal
 *    and fails only inside the desktop app, where no test of that file runs.
 * 2. Nothing copies a folder out of the server's own package, and no child is
 *    given a working folder inside it: inside the desktop app that package is
 *    an archive, where `fs.cp` throws and a `cwd` does not exist.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

function sources(dir: string = SRC): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) found.push(...sources(file));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) found.push(file);
  }
  return found;
}

const files = sources().map((file) => ({ name: relative(SRC, file).split(sep).join('/'), text: readFileSync(file, 'utf8') }));
/** The text with its comments taken out, so a sentence about a name is not a use of it. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const users = (pattern: RegExp): string[] => files.filter((file) => pattern.test(code(file.text))).map((file) => file.name).sort();

describe('who may start a program', () => {
  it('finds the sources', () => {
    expect(files.length).toBeGreaterThan(400);
    expect(files.map((file) => file.name)).toContain('project/programs.ts');
  });

  it('only the resolver names this process’s own path', () => {
    expect(users(/process\.execPath/)).toEqual([
      // The CLI's own tests of a child, where the harness is always Node.
      'project/programs.ts',
    ]);
  });

  it('only the resolver and the words-only helpers pick a package manager', () => {
    expect(users(/\b(projectPackageManager|detectPackageManager)\(/)).toEqual([
      // Where they are defined.
      'project/package-manager.ts',
      // The resolver itself.
      'project/programs.ts',
    ]);
  });

  it('no file starts a package manager, Node or git by a name written out', () => {
    // `spawn('npm'`, `runChild('pnpm'`, `execFile('git'`, `run('git'` … with the name as a literal.
    expect(users(/\b(spawn|spawnSync|execFile|execFileSync|runChild|run|runProcess)\(\s*['"`](npm|npx|pnpm|yarn|bun|node|git)['"`]/)).toEqual([]);
  });

  it('every file that starts a child is known, so a new one is read before it lands', () => {
    expect(users(/\b(spawn|spawnSync|execFile|execFileSync|fork)\(/)).toEqual([
      // The system's opener for a page, refused inside the desktop app (`mayOpenBrowser`); `runProcess`, given a resolved program.
      'cli/commands/dev.ts',
      'cli/runtime.ts',
      // `runChild`: given a resolved program by its callers.
      'designer/child.ts',
      // git, by the path `createVersions` is handed.
      'designer/versions.ts',
      // An app's own build line, through the shell, with the resolver's PATH; and `taskkill` on Windows.
      'project/apps/own-build.ts',
    ]);
  });
});

const COPIERS = ['project/adopt.ts', 'project/apps/own-build.ts', 'project/apps/pack-app.ts', 'project/apps/side-build.ts'];

describe('what is read from the server’s own package', () => {
  it('only a project’s own folders are copied', () => {
    expect(users(/\b(cpSync|cp)\(|promises\.cp\b|\bcp\b\s*[,}]\s*from 'node:fs/).filter((name) => !COPIERS.includes(name))).toEqual([]);
    // The four that copy do it between a project's folders (an instance's data, an app's logo and public files, a build's
    // output, an app's sides and seeds into a pack).
    for (const name of COPIERS) {
      const text = code(files.find((file) => file.name === name)?.text ?? '');
      for (const call of text.match(/cpSync\([^)]*\)/g) ?? []) {
        expect(call, `${name}: ${call}`).not.toMatch(/import\.meta|PACKAGE_ROOT|TEMPLATES|__dirname/);
      }
    }
  });

  it('no child’s working folder is built from the package’s own location', () => {
    const offenders = files.filter((file) => /cwd:\s*[^,}\n]*(import\.meta\.(dirname|url)|PACKAGE_ROOT|__dirname)/.test(code(file.text))).map((file) => file.name);
    expect(offenders).toEqual([]);
  });
});
