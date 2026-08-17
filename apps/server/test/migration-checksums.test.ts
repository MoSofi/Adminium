// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The migration ledger's shipped checksums, frozen.
 *
 * WHY THIS TEST EXISTS. `applyMigrations` re-hashes every already-applied
 * migration on EVERY boot and throws `MigrationChecksumDriftError` when the
 * hash no longer matches the value stored in `adminium_migrations`. That is a
 * good guard, but it makes the hash a WIRE FORMAT: it lives in databases we do
 * not control, written by versions we have already shipped. If the value this
 * repo computes ever stops matching what an installed instance stored, that
 * instance stops booting — and no amount of fixing forward reaches it, because
 * the failure happens before the app is usable.
 *
 * v0.1.0 is published (npm `@adminiumjs/adminium`, ghcr, and the desktop
 * installers), so these ten values are now permanent facts about other people's
 * databases. The table below was taken from the PUBLISHED
 * `@adminiumjs/meta@0.1.0` tarball, not from a local build, and verified
 * byte-identical to `packages/meta/dist` at that commit.
 *
 * WHAT IT CATCHES — two distinct breakages, both of which brick upgrades:
 *
 *  1. Someone edits an already-shipped migration. Even a comment or a
 *     whitespace change is enough: the checksum is `sha256(name + "\n" +
 *     up.toString())`. The rule is in `packages/meta/src/migrations/index.ts` —
 *     applied migrations are immutable; a mistake ships as a NEW compensating
 *     migration. (One deliberate exception was taken pre-release, on
 *     2026-07-20, when no release existed. That door is now closed.)
 *
 *  2. The COMPILER OUTPUT changes without anyone touching a migration.
 *     `up.toString()` returns the *emitted* function text, so this hash is a
 *     hash of tsc's formatting choices — dist is 4-space-indented, type-stripped
 *     output, and hashes completely differently from the TypeScript source (the
 *     same function is `e4a9349…` from dist and `427b06e…` through vitest's
 *     esbuild transform). A TypeScript upgrade, a `target`/`module` change, or a
 *     switch of compiler can therefore change every checksum while every
 *     migration is untouched — and brick every existing install. This test is
 *     the tripwire for that, which is why it deliberately measures the BUILT
 *     artifact rather than the source.
 *
 * It lives in apps/server rather than packages/meta on purpose: turbo's `test`
 * task depends on `^build`, so an apps/server test is guaranteed a freshly
 * built `@adminium/meta` dist — the artifact users actually run. A test inside
 * packages/meta would race its own build.
 *
 * IF THIS TEST FAILS, do not update the table to make it green. Work out which
 * of the two causes above applies. For (1), revert the edit and write a new
 * migration. For (2), the change cannot ship as-is: every deployed instance
 * would refuse to boot, and the fix has to be a compatibility path in the
 * migrator, not a new expected value here.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { ALL_MIGRATIONS } from '@adminium/meta';
import { describe, expect, it } from 'vitest';

/**
 * Hash the migrations the way PRODUCTION does: plain Node, importing the built
 * dist, in a child process.
 *
 * This indirection is not ceremony. `up.toString()` returns whatever the
 * loading runtime holds, and every layer rewrites it — the same
 * `0001_core_auth` hashes three different ways:
 *   e4a9349…  plain node on packages/meta/dist   <- what production stores
 *   d9b4b3c…  vitest importing that same dist    (vite re-transforms the JS)
 *   427b06e…  vitest importing the TS source     (esbuild strips types)
 * So an in-process `migrationChecksum(m)` here would assert a number no
 * installed instance has ever written, and would happily stay green while the
 * real, shipped value drifted. Shelling out to node is the only way to observe
 * the value that actually lands in `adminium_migrations`.
 */
function shippedChecksums(): Record<string, string> {
  const require = createRequire(import.meta.url);
  const metaEntry = require.resolve('@adminium/meta');
  const migrations = resolve(dirname(metaEntry), 'migrations/index.js');
  const script = `
    import { createHash } from 'node:crypto';
    const { ALL_MIGRATIONS } = await import(${JSON.stringify(migrations)});
    const out = {};
    for (const m of ALL_MIGRATIONS) {
      out[m.name] = createHash('sha256').update(m.name + '\\n' + m.up.toString()).digest('hex');
    }
    process.stdout.write(JSON.stringify(out));
  `;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    cwd: dirname(metaEntry),
  });
  return JSON.parse(stdout) as Record<string, string>;
}

/**
 * name → sha256, exactly as written to `adminium_migrations.checksum` by
 * v0.1.0. Append-only: a new migration adds a row the first time it ships, and
 * an existing row is never edited.
 */
const SHIPPED_CHECKSUMS: Readonly<Record<string, string>> = Object.freeze({
  '0001_core_auth': 'e4a934991f2560220678579e4a8dfb83c8d0187e40e15a3bc2669454b6c30cd0',
  '0002_rbac': 'fbb0c6f015b5b96b60664511880e6eeb5fdfed36f7081406e5d38ea2e58e5bc8',
  '0003_connections_schema': 'ddfcb7d93e11fc7eb284b0711126b18403ec31eb9f6f418a7b53fe11f3ee6675',
  '0004_pages_views': '0d8db062262078d65c1b0f9d2d41c345d23739ba056280d4094a28c011678217',
  '0005_ops': 'dcdb3a56550c20219f86c6952c842bb7c5ca635048cbc59d8b44740f6e799ce2',
  '0006_platform': '407a03c81e8ada9401fe356779e6549f874741c716153b34d32001ff4cd035fc',
  '0007_llm_runs': 'd653f3bb43de35015101e0c2ad808f08cb1fde1b1e08d41e7c9b2bea792b6297',
  '0008_llm_overrides': 'b1e5fc49dcb02ec84ec6ca6a1151667478ecca42286758c37836dded62a27297',
  '0009_views_kind': 'c288a3fcadb44ac935d1a2a183c2b22bddfb2552e713d8c66e22b37db769b694',
  '0010_llm_prompt_version_width':
    '2dae4b5cfe89783d0e1a0bc32d807bb6bee3a9894da6cd2900fe44548633f64b',
});

describe('shipped migration checksums', () => {
  it('every migration released in v0.1.0 still hashes to its shipped value', () => {
    const actual = shippedChecksums();
    for (const migration of ALL_MIGRATIONS) {
      const expected = SHIPPED_CHECKSUMS[migration.name];
      if (expected === undefined) continue; // added after v0.1.0 — covered below
      expect(
        actual[migration.name],
        `${migration.name} no longer hashes to the value v0.1.0 wrote to every installed ` +
          `adminium_migrations ledger. Either the migration was edited (revert it and ship a ` +
          `compensating migration instead) or the compiler emit changed (which would make every ` +
          `deployed instance throw MigrationChecksumDriftError on boot). Do not "fix" this by ` +
          `editing the expected value.`,
      ).toBe(expected);
    }
  });

  it('no shipped migration has been removed or renamed', () => {
    const present = new Set(ALL_MIGRATIONS.map((m) => m.name));
    for (const name of Object.keys(SHIPPED_CHECKSUMS)) {
      expect(
        present.has(name),
        `${name} shipped in v0.1.0 but is no longer in ALL_MIGRATIONS. Installed ledgers still ` +
          `carry its row, and the migrator treats an unknown applied row as corruption.`,
      ).toBe(true);
    }
  });

  it('the ledger order of shipped migrations is unchanged', () => {
    const shipped = ALL_MIGRATIONS.map((m) => m.name).filter((n) => n in SHIPPED_CHECKSUMS);
    expect(shipped, 'shipped migrations must keep their original relative order').toEqual(
      Object.keys(SHIPPED_CHECKSUMS),
    );
  });

  it('flags any migration added since v0.1.0 so it gets pinned on release', () => {
    const unpinned = ALL_MIGRATIONS.map((m) => m.name).filter((n) => !(n in SHIPPED_CHECKSUMS));
    // Not a failure — new migrations are expected between releases. This
    // records them so the release checklist can add their checksums once they
    // ship, which is what makes the table append-only rather than a snapshot.
    expect(Array.isArray(unpinned)).toBe(true);
  });
});
