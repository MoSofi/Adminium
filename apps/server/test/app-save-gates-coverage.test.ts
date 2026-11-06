// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every sealed value the meta store can hold is one the save's secret scan
 * opens. Read from the schema's source, so a new sealed column, a new sealed
 * key inside a JSON column or a new `secret: true` setting fails here until
 * `collectKnownSecrets` reads it and lists it.
 *
 * A column counts as sealed by its name (`…Encrypted`, `…Enc`, `…Sealed`) or
 * by its own comment saying so (ciphertext, encrypted, `enc:v1:`, AES).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SETTINGS_REGISTRY } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

import { SECRET_SETTINGS, SECRET_SOURCES } from '../src/apps/save/gates/secrets.js';

const schemaFile = (name: string) => fileURLToPath(new URL(`../../../packages/meta/src/schema/${name}`, import.meta.url));

const SEALED_NAME = /(?:Encrypted|Enc|Sealed)$/;
const SEALED_WORDS = /ciphertext|encrypted|enc:v1:|AES-256|\bsealed\b/i;

/**
 * Columns whose comment mentions sealing but which hold nothing to find:
 * each says why.
 */
const NOT_A_SECRET: Readonly<Record<string, string>> = {};

/** `<table>.<column>` of every sealed column, read from `tables.ts`. */
function sealedColumns(source: string): string[] {
  // `adminium_users: AdminiumUsersTable;` — which table each interface is.
  const tableOf = new Map<string, string>();
  for (const match of source.matchAll(/^\s+(adminium_[a-z_]+):\s+(Adminium[A-Za-z]+Table);/gm)) tableOf.set(match[2]!, match[1]!);

  const out: string[] = [];
  for (const match of source.matchAll(/export interface (Adminium[A-Za-z]+Table)\s*\{([\s\S]*?)\n\}/g)) {
    const table = tableOf.get(match[1]!);
    if (table === undefined) continue;
    let comment = '';
    for (const line of match[2]!.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('/**') || trimmed.startsWith('*') || trimmed.startsWith('//')) {
        comment += ` ${trimmed}`;
        continue;
      }
      const field = /^([a-zA-Z][a-zA-Z0-9]*)\??:/.exec(trimmed);
      if (field !== null) {
        const name = field[1]!;
        if (SEALED_NAME.test(name) || SEALED_WORDS.test(comment)) out.push(`${table}.${name}`);
      }
      comment = '';
    }
  }
  return out;
}

describe('the secret scan covers every sealed value', () => {
  const tables = readFileSync(schemaFile('tables.ts'), 'utf8');
  const payloads = readFileSync(schemaFile('json-payloads.ts'), 'utf8');
  const covered = new Set<string>(SECRET_SOURCES);

  it('reads the schema it checks', () => {
    // The two the scan knows from the start, found by name and by comment: the reader works.
    expect(sealedColumns(tables)).toEqual(expect.arrayContaining(['adminium_connections.dataDsnEncrypted', 'adminium_add_on_credentials.payload']));
  });

  it('opens every sealed meta column', () => {
    const missing = sealedColumns(tables).filter((column) => !covered.has(column) && NOT_A_SECRET[column] === undefined);
    expect(missing, 'a sealed meta column the secret scan does not open: read it in collectKnownSecrets and add it to SECRET_SOURCES').toEqual([]);
  });

  it('opens every sealed key inside a JSON column', () => {
    const keys = [...new Set([...payloads.matchAll(/^\s+([a-zA-Z]+(?:Encrypted|Sealed)):/gm)].map((match) => match[1]!))];
    expect(keys.length).toBeGreaterThan(0);
    const coveredKeys = new Set([...covered].filter((source) => source.includes('#')).map((source) => source.slice(source.indexOf('#') + 1)));
    expect(keys.filter((key) => !coveredKeys.has(key)), 'a sealed key inside a JSON column the secret scan does not open').toEqual([]);
  });

  it('reads every secret setting by its own rule', () => {
    const secret = Object.entries(SETTINGS_REGISTRY)
      .filter(([, def]) => (def as { secret?: boolean }).secret === true)
      .map(([key]) => key)
      .sort();
    expect(secret, 'a `secret: true` setting the secret scan does not read by its own rule: add it to SECRET_SETTINGS').toEqual([...SECRET_SETTINGS].sort());
  });

  it('lists nothing the schema no longer has', () => {
    const columns = new Set(sealedColumns(tables));
    const stale = [...covered].filter((source) => !source.includes('#') && !columns.has(source));
    expect(stale).toEqual([]);
  });
});
