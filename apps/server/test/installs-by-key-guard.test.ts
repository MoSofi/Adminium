// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NOTHING READS "THE INSTALL" BY KEY ALONE.
 *
 * The same app or add-on may be installed once per database, so a key names
 * several `adminium_manifests` rows. A read by key alone answers the first
 * row — a silent wrong answer the day a second install exists. Every read of
 * an install goes through the repo's per-install reads (`findById`,
 * `findInScope`, `findBySlug`, `listByKey`) or names the row by id, scope,
 * slug or connection.
 *
 * This test reads the engine's source. It fails on:
 *  - a query on `adminium_manifests` whose `where` names `manifestKey` and
 *    nothing that picks one install (`id`, `scopeKey`, `instanceSlug`,
 *    `connectionId`);
 *  - a `list(…)` of manifests searched by `manifestKey ===` on its own;
 *  - one install picked out of `listByKey(…)` (`[0]`, `const [one] =`, or a
 *    `.find(…)` that names no install, database or slug).
 * A read that is right for every install alike (one version of a key runs on
 * a server, so its document and version are every copy's) says so in a
 * comment within three lines above it that contains `key-wide`. A mark never
 * covers what is each install's own: a key-wide read that selects or uses an
 * install's status, id, database, slug or parts is a by-key read all the same.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SOURCES = [join(ROOT, 'apps', 'server', 'src'), ...readdirSync(join(ROOT, 'packages')).map((name) => join(ROOT, 'packages', name, 'src'))];
/** The repo itself, and the migrations that backfilled from the one install each key had. */
const EXEMPT = [join('packages', 'meta', 'src', 'repos', 'manifests.ts'), join('packages', 'meta', 'src', 'migrations')];

function files(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts') ? [path] : [];
  });
}

const PICKS_ONE = /\.where\('(id|scopeKey|instanceSlug|connectionId|m\.id|m\.scopeKey)'/;
/** What is each install's own: never the same on every copy, so never read "key-wide". */
const PER_INSTALL_COLUMN = /'(status|id|scopeKey|connectionId|instanceSlug|modules)'/;
const PER_INSTALL_FIELD = /\.row\.(status|id|scopeKey|connectionId|instanceSlug|modules)\b|\?\.row\.(status|id|scopeKey|connectionId|instanceSlug|modules)\b/;
/** One install picked out of every install of a key. */
const PICKED_FROM_KEY = /listByKey\([^)]*\)\)?\s*\)?\s*\[0\]|\[[A-Za-z_$][\w$]*\]\s*=\s*await\s+[^;]*listByKey\(|listByKey\([^)]*\)\)\.find\(/;
/** A `.find` predicate that does pick one install: by its id, database or slug (or every one but this install's). */
const FIND_PICKS_ONE = /\.row\.(id|scopeKey|connectionId|instanceSlug)\s*[!=]==/;

/** Every by-key read of an install, as `file:line`. */
export function byKeyReads(sources: readonly string[] = SOURCES): string[] {
  const out: string[] = [];
  for (const file of sources.flatMap(files)) {
    const rel = relative(ROOT, file);
    if (EXEMPT.some((exempt) => rel.startsWith(exempt))) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    const marked = (at: number) => lines.slice(Math.max(0, at - 3), at + 1).some((line) => /\/\/.*key-wide|\*.*key-wide/.test(line));
    // What the read goes on to use: its own line, and what the next three lines read of the install it named.
    const usesPerInstall = (at: number) => {
      if (PER_INSTALL_FIELD.test(lines[at]!)) return true;
      const name = /const\s+\[?\s*([A-Za-z_$][\w$]*)/.exec(lines[at]!)?.[1];
      if (name === undefined) return false;
      const used = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\??\\.row\\??\\.(status|id|scopeKey|connectionId|instanceSlug|modules)\\b`);
      return lines.slice(at + 1, at + 4).some((line) => used.test(line));
    };
    lines.forEach((line, at) => {
      if (/\.where\('manifestKey', '(=|in)'/.test(line)) {
        // The statement around it: back to its start, forward to its end.
        let from = at;
        while (from > 0 && at - from < 10 && !/(selectFrom|updateTable|deleteFrom)\(/.test(lines[from]!)) from -= 1;
        let to = at;
        while (to < lines.length - 1 && to - at < 10 && !/execute|executeTakeFirst/.test(lines[to]!)) to += 1;
        const statement = lines.slice(from, to + 1).join('\n');
        if (!statement.includes('adminium_manifests')) return;
        if (PICKS_ONE.test(statement.replace(/\.where\('manifestKey'[^)]*\)/g, ''))) return;
        // A mark covers a read of what every copy shares, never of what each install keeps for itself.
        // (A read of every install, each on its own, is no pick: only a single row's is held to it.)
        const selected = /\.select\(([^)]*)\)/.exec(statement)?.[1] ?? '';
        const keyWide = (marked(from) || marked(at)) && !(/executeTakeFirst/.test(statement) && PER_INSTALL_COLUMN.test(selected));
        if (!keyWide) out.push(`${rel}:${at + 1}`);
        return;
      }
      if (/\.list\([^)]*\)\)?\.(find|some|filter)\(/.test(line) && /manifestKey === /.test(line)) {
        if (/connectionId|scopeKey|instanceSlug/.test(line)) return;
        if (!marked(at)) out.push(`${rel}:${at + 1}`);
        return;
      }
      if (PICKED_FROM_KEY.test(line)) {
        // Only the `.find` predicate itself can pick one install; `[0]` never does.
        const predicate = /listByKey\([^)]*\)\)\.find\((.*)$/.exec(line)?.[1];
        if (predicate !== undefined && FIND_PICKS_ONE.test(predicate)) return;
        if (!marked(at) || usesPerInstall(at)) out.push(`${rel}:${at + 1}`);
      }
    });
  }
  return out;
}

describe('installs are never read by key alone', () => {
  it('finds no read of adminium_manifests by key alone outside the repo', () => {
    expect(byKeyReads()).toEqual([]);
  });

  it('would catch one (the check itself is live)', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'by-key-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(
      join(dir, 'src', 'bad.ts'),
      [
        "const row = await db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', key).executeTakeFirst();",
        "const one = (await manifests.list('app')).find((m) => m.row.manifestKey === key);",
        "const ok = await db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', key).where('scopeKey', '=', conn).executeTakeFirst();",
        '// key-wide: the same for every install of the key.',
        "const fine = await db.selectFrom('adminium_manifests').select('version').where('manifestKey', '=', key).executeTakeFirst();",
        '',
        '',
        '',
        "const first = (await manifests.listByKey(key))[0] ?? null;",
        "const [head] = await manifests.listByKey(key);",
        "const any = (await manifests.listByKey(key)).find((one) => one.row.kind === 'app');",
        "const here = (await manifests.listByKey(key)).find((one) => one.row.scopeKey === connectionId);",
        "const other = owner.row.scopeKey === 'server' ? ((await manifests.listByKey(key))[0] ?? null) : null;",
        '',
        '',
        '',
        '// key-wide: claimed, but a status is each install\'s own.',
        "const status = await db.selectFrom('adminium_manifests').select(['version', 'status']).where('manifestKey', '=', key).executeTakeFirst();",
        '',
        '',
        '',
        '// key-wide: every copy runs one version, so any copy names it.',
        "const version = (await manifests.listByKey(key))[0]?.row.version ?? null;",
        '',
        '',
        '',
        '// key-wide: claimed, but the database is each install\'s own.',
        "const where = (await manifests.listByKey(key))[0] ?? null;",
        'const db = where?.row.connectionId;',
      ].join('\n'),
    );
    const found = byKeyReads([join(dir, 'src')]).map((entry) => entry.split(':').pop());
    expect(found).toEqual(['1', '2', '9', '10', '11', '13', '18', '28']);
  });
});
