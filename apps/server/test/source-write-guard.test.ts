// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every write to a source database goes through `crud/write-service.ts`, so
 * that project hooks run for all of them. This test fails when a new direct
 * write appears anywhere else in the server.
 *
 * It reads the source, not the running server: a write path nobody tests is
 * exactly the one that would slip past a behavioural check. Adminium's own
 * `adminium_*` tables are not source tables and are ignored.
 *
 * A file on the list below writes rows for a reason that has nothing to do
 * with a user's record. Adding to the list needs that reason.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

const ALLOWED: Record<string, string> = {
  'crud/write-service.ts': 'the write service itself',
  'schema-ddl/sqlite-rebuild.ts': 'a schema change: rows are copied into the rebuilt table unchanged',
  'routes/desktop-local-db/handlers.ts': "the desktop app's placeholder rows in a database it has just created",
};

/** Kysely's write builders, unless their table is one of Adminium's own. */
const BUILDER_WRITE = /\.(insertInto|updateTable|deleteFrom|replaceInto|mergeInto)\(\s*(?!['"`]adminium_)/g;

/** Hand-written SQL that changes rows. */
const RAW_WRITE = /\b(insert\s+(?:or\s+\w+\s+)?into|delete\s+from|replace\s+into|merge\s+into|truncate\s+table|update\s+[`"\w.${}()]+\s+set)\b/gi;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** The code without its comments, keeping line numbers. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (_line, before: string) => before);
}

function writesIn(file: string): string[] {
  const code = stripComments(readFileSync(file, 'utf8'));
  const found: string[] = [];
  for (const pattern of [BUILDER_WRITE, RAW_WRITE]) {
    for (const match of code.matchAll(pattern)) {
      const line = code.slice(0, match.index).split('\n').length;
      found.push(`${String(line)}: ${match[0].trim()}`);
    }
  }
  return found;
}

describe('source database writes', () => {
  const files = sourceFiles(SRC);
  const byFile = new Map(files.map((file) => [relative(SRC, file).split('\\').join('/'), writesIn(file)]));

  it('happen only in the write service and the files listed with a reason', () => {
    const outside = [...byFile]
      .filter(([path, writes]) => writes.length > 0 && !(path in ALLOWED))
      .map(([path, writes]) => `${path}\n  ${writes.join('\n  ')}`);
    expect(
      outside,
      'Write through crud/write-service.ts so project hooks run, or add the file to ALLOWED with the reason.',
    ).toEqual([]);
  });

  it('lists no file that has stopped writing', () => {
    const stale = Object.keys(ALLOWED).filter((path) => (byFile.get(path) ?? []).length === 0);
    expect(stale).toEqual([]);
  });

  it('sees the writes it is looking for', () => {
    const sample = [
      "await trx.insertInto(table.id).values(row).execute();",
      "db\n  .updateTable(\n    table.id)",
      'db.prepare(`DELETE FROM ${q(name)}`)',
      "sql`update ${sql.table(name)} set x = 1`",
    ].join('\n');
    const found = [BUILDER_WRITE, RAW_WRITE].flatMap((pattern) => [...sample.matchAll(pattern)]);
    expect(found).toHaveLength(4);
    expect([..."meta.db.insertInto('adminium_users')".matchAll(BUILDER_WRITE)]).toHaveLength(0);
    expect(stripComments('// db.deleteFrom(table.id)\nconst url = "http://x";')).not.toContain('deleteFrom');
  });
});
