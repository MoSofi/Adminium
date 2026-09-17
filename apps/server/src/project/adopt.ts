// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Making an existing instance a project's: `adminium new` in a folder whose
 * `data/` already holds one, or `adminium new --import <folder>`.
 *
 * Every connection that belongs to no project gets a key: `main` for the
 * oldest, then each connection's name made into a key. The keys go into
 * `adminium.config.ts`, each reading its URL from an environment variable
 * named after it. The stored connection strings stay encrypted where they
 * are; setting the variable later replaces one. No password is ever written
 * to a file.
 */

import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ConnectionManager } from '../connections/manager.js';
import { PROJECT_KEY_PATTERN } from './config.js';

/** Files that mark a data folder as holding an instance. */
export const INSTANCE_MARKERS = ['meta.db', 'adminium.json'] as const;

export function holdsInstance(dataDir: string): boolean {
  return INSTANCE_MARKERS.some((name) => existsSync(join(dataDir, name)));
}

/** `~/…` as a path under the home folder; anything else relative to `cwd`. */
export function expandFolder(value: string, cwd: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return resolve(cwd, value);
}

/** The environment variable a database key reads its URL from. */
export function envVarFor(key: string): string {
  return key === 'main' ? 'DATABASE_URL' : `${key.toUpperCase().replaceAll('-', '_')}_DATABASE_URL`;
}

/** A connection name as a key: lowercase, `-` between words, starting with a letter. */
export function keyFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const key = /^[a-z]/.test(slug) ? slug : `db-${slug}`.replace(/-+$/, '');
  return PROJECT_KEY_PATTERN.test(key) ? key : 'db';
}

interface KeyCandidate {
  id: string;
  name: string;
  projectKey: string | null;
  createdAt: number;
}

/** Keys for the connections that have none, oldest first. */
export function chooseProjectKeys(connections: readonly KeyCandidate[]): Map<string, string> {
  const taken = new Set(connections.flatMap((connection) => (connection.projectKey === null ? [] : [connection.projectKey])));
  const chosen = new Map<string, string>();
  const unkeyed = connections
    .filter((connection) => connection.projectKey === null)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  for (const connection of unkeyed) {
    const base = taken.has('main') ? keyFromName(connection.name) : 'main';
    let key = base;
    for (let n = 2; taken.has(key); n += 1) key = `${base.slice(0, 44)}-${String(n)}`;
    taken.add(key);
    chosen.set(connection.id, key);
  }
  return chosen;
}

export interface AdoptedDatabase {
  key: string;
  name: string;
  envVar: string;
}

/**
 * Give every unkeyed connection its key. Every stored connection string is
 * decrypted first, so a secret that does not open this instance stops here,
 * before anything is written.
 */
export async function adoptConnections(manager: ConnectionManager, at: number = Date.now()): Promise<AdoptedDatabase[]> {
  const connections = await manager.connections.list();
  for (const connection of connections) {
    try {
      await manager.connections.getDsns(connection.id);
    } catch {
      throw new Error(
        `The ADMINIUM_SECRET given does not open the stored connection string of "${connection.name}". ` +
          'Use the secret this instance was created with.',
      );
    }
  }
  const keys = chooseProjectKeys(connections);
  const adopted: AdoptedDatabase[] = [];
  for (const connection of connections) {
    const key = keys.get(connection.id) ?? connection.projectKey;
    if (key === null) continue;
    if (keys.has(connection.id)) await manager.connections.setProjectKey(connection.id, key, at);
    adopted.push({ key, name: connection.name, envVar: envVarFor(key) });
  }
  return adopted.sort((a, b) => (a.key === 'main' ? -1 : b.key === 'main' ? 1 : a.key < b.key ? -1 : 1));
}

/** `adminium.config.ts` for these databases. */
export function renderConfig(databases: readonly AdoptedDatabase[]): string {
  const lines = databases.map((database) => `    ${database.key}: { url: env('${database.envVar}') },`);
  return [
    "import { defineConfig, env } from '@adminiumjs/adminium';",
    '',
    'export default defineConfig({',
    '  // The databases the admin is built from. Keep passwords out of this file:',
    "  // `env()` reads them from .env, or from the host's environment.",
    '  databases: {',
    ...lines,
    '  },',
    '});',
    '',
  ].join('\n');
}

export function writeConfig(root: string, databases: readonly AdoptedDatabase[]): void {
  writeFileSync(join(root, 'adminium.config.ts'), renderConfig(databases));
}

/** Copy an instance's data folder into the project's. */
export function importInstance(from: string, dataDir: string): void {
  cpSync(from, dataDir, { recursive: true, force: false, errorOnExist: false });
}
