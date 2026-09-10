// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where `ADMINIUM_DATA_DIR` lands when nobody names one (`cli/data-dir.ts`).
 *
 * THE COMPLAINT THIS ANSWERS. `npx @adminiumjs/adminium` wrote `data/meta.db`
 * into whatever directory the shell happened to be in — an instance nobody
 * chose the location of, and one that a run from one directory over would never
 * find again. The resolver's contract is therefore an ORDER, and the order is
 * what is asserted here; every case drives it through the `exists` seam so the
 * answers do not depend on the machine running the suite.
 *
 * The rule that matters most is the FIRST one: an instance already in
 * `<cwd>/data` keeps it. Getting that wrong is not a cosmetic default — it
 * boots an empty store beside somebody's real one and reads as data loss.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  defaultDataDir,
  HOME_DATA_DIR_NAME,
  PROJECT_DATA_DIR,
  tildify,
} from '../src/cli/data-dir.js';
import { loadCliEnv } from '../src/cli/runtime.js';
import { TEST_SECRET } from './cli-helpers.js';

const HOME = join('/home', 'ada');
const ELSEWHERE = join('/home', 'ada', 'Downloads');
const HOME_DATA = join(HOME, HOME_DATA_DIR_NAME);

/** `exists` over a fixed set of paths — the home directory is always there. */
function tree(...paths: string[]): (path: string) => boolean {
  const set = new Set([HOME, ...paths]);
  return (path) => set.has(path);
}

describe('defaultDataDir', () => {
  it('keeps ./data when an instance already lives there — whatever else is true', () => {
    for (const marker of ['meta.db', 'adminium.json']) {
      const exists = tree(join(ELSEWHERE, 'data', marker));
      expect(defaultDataDir({ cwd: ELSEWHERE, home: HOME, exists })).toBe(PROJECT_DATA_DIR);
    }
  });

  it('does not adopt a plain data/ directory — that is somebody else’s CSVs', () => {
    const exists = tree(join(ELSEWHERE, 'data'), join(ELSEWHERE, 'data', 'customers.csv'));
    expect(defaultDataDir({ cwd: ELSEWHERE, home: HOME, exists })).toBe(HOME_DATA);
  });

  it('uses ./data inside a project, and not only a Node one', () => {
    const project = join('/srv', 'app');
    for (const marker of ['package.json', '.git', 'docker-compose.yml', 'go.mod', 'Gemfile']) {
      const exists = tree(join(project, marker));
      expect(defaultDataDir({ cwd: project, home: HOME, exists })).toBe(PROJECT_DATA_DIR);
    }
  });

  it('uses ~/.adminium when the directory is nobody’s project', () => {
    expect(defaultDataDir({ cwd: ELSEWHERE, home: HOME, exists: tree() })).toBe(HOME_DATA);
  });

  it('never treats the home directory as a project — dotfile repos live there', () => {
    const exists = tree(join(HOME, '.git'), join(HOME, 'package.json'));
    expect(defaultDataDir({ cwd: HOME, home: HOME, exists })).toBe(HOME_DATA);
  });

  it('falls back to ./data when there is no home to fall back to', () => {
    expect(defaultDataDir({ cwd: ELSEWHERE, home: '', exists: tree() })).toBe(PROJECT_DATA_DIR);
    const noHome = (path: string) => path !== HOME;
    expect(defaultDataDir({ cwd: ELSEWHERE, home: HOME, exists: noHome })).toBe(PROJECT_DATA_DIR);
  });

  it('returns an ABSOLUTE path for the home case — it must mean one place', () => {
    const resolved = defaultDataDir({ cwd: ELSEWHERE, home: HOME, exists: tree() });
    expect(resolved).toBe(join(HOME, '.adminium'));
    expect(resolved.startsWith(HOME)).toBe(true);
  });
});

describe('tildify', () => {
  it('shortens a path under the home directory and leaves every other alone', () => {
    expect(tildify(join(HOME, '.adminium'), HOME)).toBe(join('~', '.adminium'));
    expect(tildify(HOME, HOME)).toBe('~');
    expect(tildify(PROJECT_DATA_DIR, HOME)).toBe(PROJECT_DATA_DIR);
    expect(tildify(join('/srv', 'app', 'data'), HOME)).toBe(join('/srv', 'app', 'data'));
    // A sibling that merely SHARES THE PREFIX is not inside it.
    expect(tildify(`${HOME}-backup`, HOME)).toBe(`${HOME}-backup`);
    expect(tildify(join(HOME, '.adminium'), '')).toBe(join(HOME, '.adminium'));
  });
});

describe('loadCliEnv — the data directory', () => {
  const ENV = { ADMINIUM_SECRET: TEST_SECRET };

  it('resolves the default rather than taking the schema’s ./data', () => {
    // Whatever this machine is, the CLI's answer is the resolver's answer —
    // which is what a schema default could never be, since it cannot see a cwd.
    expect(loadCliEnv(ENV).ADMINIUM_DATA_DIR).toBe(defaultDataDir());
  });

  it('leaves an explicit ADMINIUM_DATA_DIR and --data-dir alone', () => {
    expect(loadCliEnv({ ...ENV, ADMINIUM_DATA_DIR: '/var/lib/adminium' }).ADMINIUM_DATA_DIR).toBe(
      '/var/lib/adminium',
    );
    expect(loadCliEnv(ENV, { dataDir: '/from-flag' }).ADMINIUM_DATA_DIR).toBe('/from-flag');
    expect(
      loadCliEnv({ ...ENV, ADMINIUM_DATA_DIR: '/from-env' }, { dataDir: '/from-flag' })
        .ADMINIUM_DATA_DIR,
    ).toBe('/from-flag');
  });

  it('treats an empty variable as unset, exactly as the schema does', () => {
    expect(loadCliEnv({ ...ENV, ADMINIUM_DATA_DIR: '' }).ADMINIUM_DATA_DIR).toBe(defaultDataDir());
  });

  it('is the monorepo checkout’s ./data when the suite runs here', () => {
    // A guard on the guard: apps/server has a package.json, so a dev tree keeps
    // the behaviour every existing test and script was written against.
    expect(defaultDataDir({ cwd: process.cwd(), home: homedir() })).toBe(PROJECT_DATA_DIR);
  });
});
