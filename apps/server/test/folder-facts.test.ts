// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { folderFactsCommand } from '../src/cli/commands/folder-facts.js';
import { readFolderFacts } from '../src/project/folder-facts.js';
import { APP_VERSION } from '../src/version.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adminium-facts-'));
  // A config file that would say so if anything ran it.
  writeFileSync(join(root, 'adminium.config.ts'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(root, 'RAN'))}, 'x');\nexport default {};\n`);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const KNOWN = ['0001_core_auth', '0002_rbac'];

/** A store with the tables the facts read, as the engine's migrations name them. */
function store(dir = join(root, 'data'), ledger: [string, string][] = [['0001_core_auth', '0.3.20'], ['0002_rbac', '0.3.21']]): Database.Database {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'meta.db'));
  db.exec(`
    CREATE TABLE adminium_migrations (name text primary key, checksum text not null, applied_at integer not null, duration_ms integer not null, adminium_version text not null);
    CREATE TABLE adminium_users (id text primary key, email text not null, name text not null, password_hash text, status text default 'active' not null, created_at integer not null);
    CREATE TABLE adminium_api_keys (id text primary key, name text not null, revoked_at integer, created_at integer not null);
    CREATE TABLE adminium_public_keys (id text primary key, name text not null, revoked_at integer, created_at integer not null);
    CREATE TABLE adminium_settings (key text primary key, value text not null, updated_at integer not null);
  `);
  const add = db.prepare('INSERT INTO adminium_migrations VALUES (?, ?, ?, 1, ?)');
  ledger.forEach(([name, version], index) => add.run(name, 'c', index, version));
  return db;
}

describe('readFolderFacts', () => {
  it('a folder with nothing yet: no key, no data, and where the data would go', () => {
    expect(readFolderFacts(root, KNOWN)).toEqual({
      secret: false,
      database: 'none',
      dataDir: join(root, 'data'),
      lastEngine: null,
      newer: [],
      people: { count: 0, names: [] },
      apiKeys: { count: 0, names: [] },
      publicKeys: { count: 0, names: [] },
      ownerHasPassword: null,
      running: null,
      otherManager: null,
      engine: { installed: null, declared: null, here: APP_VERSION },
      install: 'no-packages',
    });
  });

  it('says which Adminium the project’s own code imports, another manager’s lockfile, and a server that has the folder', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@adminiumjs/adminium': '0.3.16' } }));
    mkdirSync(join(root, 'node_modules', '@adminiumjs', 'adminium'), { recursive: true });
    writeFileSync(join(root, 'node_modules', '@adminiumjs', 'adminium', 'package.json'), JSON.stringify({ version: '0.3.16' }));
    writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    mkdirSync(join(root, '.adminium'));
    // This test's parent is a process that is certainly alive and is not this one.
    writeFileSync(join(root, '.adminium', 'running.json'), JSON.stringify({ pid: process.ppid, port: 4712, mode: 'dev', by: 'cli' }));
    expect(readFolderFacts(root, KNOWN)).toMatchObject({
      engine: { installed: '0.3.16', declared: '0.3.16', here: APP_VERSION },
      otherManager: { manager: 'pnpm' },
      running: { port: 4712, by: 'cli' },
      // Packages are there, and nothing says the install finished.
      install: 'not-finished',
    });
    // A package file that does not read is no pin, not a failure.
    writeFileSync(join(root, 'package.json'), '{');
    expect(readFolderFacts(root, KNOWN).engine.declared).toBeNull();
  });

  it('reads the key from .env as text, and an empty one is none', () => {
    writeFileSync(join(root, '.env'), 'ADMINIUM_SECRET=\nOTHER=1\n');
    expect(readFolderFacts(root, KNOWN).secret).toBe(false);
    writeFileSync(join(root, '.env'), 'ADMINIUM_SECRET=s3cret-s3cret-s3cret-s3cret-s3cret\n');
    expect(readFolderFacts(root, KNOWN).secret).toBe(true);
  });

  it('names the people, the API keys and the public keys a folder brought, but not the preview’s own account or what was taken back', () => {
    const db = store();
    const user = db.prepare('INSERT INTO adminium_users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)');
    user.run('u1', 'rosa@example.com', 'Rosa Pérez', 'hash', 1);
    user.run('u2', 'theo@example.com', '', null, 2);
    user.run('u3', 'preview@adminium.localhost', 'Preview', null, 3);
    db.prepare("INSERT INTO adminium_settings VALUES ('designer.localOwnerId', '\"u1\"', 1)").run();
    db.prepare("INSERT INTO adminium_api_keys VALUES ('k1', 'Booking widget', NULL, 1), ('k2', 'Old key', 5, 2)").run();
    db.prepare("INSERT INTO adminium_public_keys VALUES ('p1', 'Juniper Kitchen · the customer site', NULL, 1)").run();
    db.close();
    expect(readFolderFacts(root, KNOWN)).toMatchObject({
      database: 'sqlite',
      lastEngine: '0.3.21',
      newer: [],
      people: { count: 2, names: ['Rosa Pérez', 'theo@example.com'] },
      apiKeys: { count: 1, names: ['Booking widget'] },
      publicKeys: { count: 1, names: ['Juniper Kitchen · the customer site'] },
      ownerHasPassword: true,
    });
  });

  it('says the owner design mode made has no password yet, and nothing of an owner there is none of', () => {
    const db = store();
    db.prepare("INSERT INTO adminium_users (id, email, name, password_hash, created_at) VALUES ('u1', 'owner@adminium.localhost', 'Owner', NULL, 1)").run();
    db.close();
    expect(readFolderFacts(root, KNOWN).ownerHasPassword).toBeNull();
    const again = new Database(join(root, 'data', 'meta.db'));
    again.prepare("INSERT INTO adminium_settings VALUES ('designer.localOwnerId', '\"u1\"', 1)").run();
    again.close();
    expect(readFolderFacts(root, KNOWN).ownerHasPassword).toBe(false);
  });

  it('says so once that owner has a password: who the project was made for is kept when the link’s setting is cleared', () => {
    const db = store();
    db.prepare("INSERT INTO adminium_users (id, email, name, password_hash, created_at) VALUES ('u1', 'ava@example.test', 'Owner', 'a-hash', 1)").run();
    db.prepare("INSERT INTO adminium_settings VALUES ('designer.localOwnerId', 'null', 1)").run();
    db.prepare("INSERT INTO adminium_settings VALUES ('designer.ownerId', '\"u1\"', 1)").run();
    db.close();
    expect(readFolderFacts(root, KNOWN).ownerHasPassword).toBe(true);
  });

  it('a store a newer Adminium changed is named so, and read no further', () => {
    const db = store(undefined, [['0001_core_auth', '0.3.21'], ['0002_rbac', '0.3.21'], ['0003_from_the_future', '0.4.0']]);
    db.prepare("INSERT INTO adminium_users (id, email, name, created_at) VALUES ('u1', 'a@b.c', 'A', 1)").run();
    db.close();
    expect(readFolderFacts(root, KNOWN)).toMatchObject({ database: 'sqlite', lastEngine: '0.4.0', newer: [{ name: '0003_from_the_future', appliedBy: '0.4.0' }], people: { count: 0 } });
  });

  it('follows the data folder .env names, relative to the project or absolute', () => {
    store(join(root, 'elsewhere')).close();
    writeFileSync(join(root, '.env'), 'ADMINIUM_DATA_DIR=./elsewhere\n');
    expect(readFolderFacts(root, KNOWN)).toMatchObject({ database: 'sqlite', dataDir: join(root, 'elsewhere') });
    writeFileSync(join(root, '.env'), `ADMINIUM_DATA_DIR=${join(root, 'elsewhere')}\n`);
    expect(readFolderFacts(root, KNOWN).database).toBe('sqlite');
  });

  it('a data folder outside the project, or the project itself, is "elsewhere": nothing there is opened', () => {
    const outside = mkdtempSync(join(tmpdir(), 'adminium-facts-outside-'));
    try {
      store(outside).close();
      for (const named of [outside, join('..', basename(outside)), '.']) {
        writeFileSync(join(root, '.env'), `ADMINIUM_DATA_DIR=${named}\n`);
        expect(readFolderFacts(root, KNOWN), named).toMatchObject({ database: 'elsewhere', dataDir: null, people: { count: 0 } });
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('a store that is not a file here is asked nothing', () => {
    store().close();
    writeFileSync(join(root, '.env'), 'ADMINIUM_META_URL=postgres://db.example/adminium\n');
    expect(readFolderFacts(root, KNOWN)).toMatchObject({ database: 'elsewhere', dataDir: null });
    writeFileSync(join(root, '.env'), 'ADMINIUM_META_URL=sqlite:./data/meta.db\n');
    expect(readFolderFacts(root, KNOWN).database).toBe('sqlite');
  });

  it('a file that is not a store yet, or not a database at all, is no data', () => {
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'meta.db'), '');
    expect(readFolderFacts(root, KNOWN).database).toBe('none');
    writeFileSync(join(root, 'data', 'meta.db'), 'this is not a database, it is a sentence that is long enough to not be a header');
    expect(readFolderFacts(root, KNOWN).database).toBe('none');
  });

  it('with this build’s own list of changes, a store it made is not "newer"', () => {
    expect(readFolderFacts(root).newer).toEqual([]);
  });
});

describe('adminium folder-facts', () => {
  const run = async (cwd: string): Promise<{ out: string[]; code: unknown }> => {
    const out: string[] = [];
    const code = await folderFactsCommand.run({ io: { out: (line: string) => void out.push(line), err: () => undefined } as never, deps: { cwd, env: {} } as never, argv: [] });
    return { out, code };
  };

  it('prints the facts as one line of JSON and runs nothing of the folder', async () => {
    store().close();
    const { out, code } = await run(root);
    expect(code).toBe(0);
    expect(JSON.parse(out[0] ?? '')).toMatchObject({ database: 'sqlite', secret: false });
    // The config file would have left a mark.
    expect(existsSync(join(root, 'RAN'))).toBe(false);
  });

  it('refuses a folder that is not a project, and never looks above it', async () => {
    mkdirSync(join(root, 'inside'));
    await expect(run(join(root, 'inside'))).rejects.toThrow('There is no project in this folder');
  });
});
