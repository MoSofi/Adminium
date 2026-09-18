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
 * Every stable release from v0.1.0 through v0.2.9 is published on npm as
 * `@adminiumjs/adminium` — plus ghcr images, and desktop installers over part of
 * that range — so the 32 values below are now permanent facts about other
 * people's databases. Each one was read out of the PUBLISHED `@adminiumjs/meta`
 * tarball that first shipped it: `npm pack @adminiumjs/meta@<version>`, unpack,
 * then hash `package/dist/migrations/index.js` under plain node. That provenance
 * is the whole point and is not interchangeable with a local build — a number
 * taken from this tree only proves the tree agrees with itself, whereas the
 * tarball is the artifact that actually wrote those rows.
 *
 * All thirteen published versions were unpacked and cross-checked, prereleases
 * (`0.1.0-rc.1`, `0.2.2-rc.0`) included. Every migration hashes identically in
 * every version that carries it, so the emitted output has been stable across
 * the entire release history and no shipped migration has ever been edited.
 * `@adminiumjs/meta` is slated for removal from npm; these values were captured
 * while the tarballs were still fetchable, and once it is gone this table is
 * the only surviving record of them.
 *
 * WHERE THE NEXT ROW COMES FROM. That package stops being published once the
 * CLI bundles its internal packages, so 0033 onwards cannot be pinned by the
 * command above — it will simply 404. The successor source is the flagship
 * tarball, which carries the very same built artifact inside it:
 * `npm pack @adminiumjs/adminium@<version>`, then hash
 * `package/node_modules/@adminium/meta/dist/migrations/index.js`. Same emitted
 * file, same procedure, same number. What must not happen is quietly falling
 * back to a local build because the old command stopped working.
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
 * A THIRD FAILURE WEARS THE SAME FACE AND IS NOT A PRODUCT BUG. A development
 * meta store can hold migrations that no release ever published, applied by
 * whatever the tree looked like that day — and `MigrationChecksumDriftError`
 * cannot tell that apart from a real regression, because its message is the
 * same sentence either way. One such store, kept while 0.2.x was in flight, has
 * 18 applied rows, of which 0015–0018 carry `adminium_version` 0.2.2 even though
 * the published 0.2.2 shipped only as far as 0014. Seventeen of them still match
 * this table; `0018_connection_timezone_source` does not, because its source was
 * still changing between being applied there and being released — that store
 * holds `f8c0f35…` where every published tarball has `bc5dc24…`.
 * That data dir can no longer boot against main, and never could have; the only
 * fix is to re-init it. So when a drift error appears, first read the offending
 * row's `adminium_version` and ask whether that release actually shipped that
 * migration. If it did not, the store was migrated by an in-development tree
 * and nothing is wrong with the code. Pinning from published tarballs is what
 * keeps this test itself free of that ambiguity — this test reads no database,
 * so a dev store can never be what turned it red.
 *
 * IF THIS TEST FAILS, do not update the table to make it green. Work out which
 * of the two numbered causes applies. For (1), revert the edit and write a new
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
 * the value that actually lands in `adminium_migrations`. It is also the exact
 * procedure used against each published tarball to obtain the table below, so
 * the two sides of the comparison are measured the same way.
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
 * name → sha256, exactly as written to `adminium_migrations.checksum` by the
 * release noted above each block. Append-only: a migration gains a row the
 * first time it is published, and an existing row is never edited. Releases
 * that added no migration are listed with the one that did, to record that they
 * re-shipped those values unchanged rather than being unexamined.
 *
 * Migrations present in this tree but absent here are simply unreleased — they
 * get pinned by the release that publishes them, not before.
 */
const SHIPPED_CHECKSUMS: Readonly<Record<string, string>> = Object.freeze({
  // --- v0.1.0 (also re-shipped unchanged by 0.1.0-rc.1 and 0.1.2) ---
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
  // --- v0.2.1 ---
  '0011_i18n_runtime': '6be260ff7e472d287ea3c66b81a48cea914be95fc81b0cbc9a87a7bd851a10df',
  '0012_locale_width': 'f2ce665f255d809a040d929ef8dbc2500bbbd2355387a8ff620d2617cfc152de',
  // --- v0.2.2 (0013 also shipped in 0.2.2-rc.0, same hash) ---
  '0013_connection_last_error_hint':
    '20b86ea11ca718637d53ab4c7ffdc608e8374806e9309a001cdd6f26d6e797d6',
  '0014_public_surface': 'ad2a473308618b16cac96523860a8bff0235b012a721c4bd73aefedb4f19c74a',
  // --- v0.2.3 (also re-shipped unchanged by 0.2.4 and 0.2.5) ---
  '0015_connection_tenant_config':
    'd33ad2c7795cac43812bc421a93dd55acf7f226b9d8948d42e42594465eda824',
  '0016_audit_entity': '287934034fb04197d769d13b70f038a1ccb107c35fd671cc68b0056cd8b7a9c5',
  '0017_surface_binding': '86cce083c19c7cd88ec5044efd73257c9f19e2b3784b3decf2e1b56150e07816',
  '0018_connection_timezone_source':
    'bc5dc246d202c2a4385e93d03caa125564e5a165d5d0f35464f3a64edca77239',
  '0019_connection_disabled': '5a50fa89c4bcb986e58359f43b93cab9e2db2679ce75c45f5431c17c9c5c83d4',
  '0020_manifests_add_on': 'b98bd6de182d7938b7ef83f559bcf616b800515c53ca8f5c74b4160f0c4bf95a',
  '0021_add_on_credentials': 'd680e804334a60cabb28c1aaf13c205a6b4204a375609139463c31a661c64f84',
  '0022_studio_namespace': '719271dc3cf02c66290dc9e95000deb516db7c7eab1498617b39be106199e5d6',
  // --- v0.2.6 (also re-shipped unchanged by 0.2.7, 0.2.8 and 0.2.9) ---
  '0023_schema_authoring': '0c0b22f396bf855907358e3fa08bb8e9d0c9149cbc34c9a84b5836073a006505',
  '0024_file_destinations': '1479e19aa745a761a48f171633e5ea6ea9b14320865074b8ed8192c88e9a146d',
  '0025_schema_change_acknowledged_rows':
    'e449c02014d52c0226f24b79e26b6572bf9b8229d012cf2409427f5453d678d5',
  '0026_email_documents': '6126699450891736d6146729a28ba601ad38e6906412a6b6be3b6ec3ca860fb8',
  '0027_invoice_documents': '273e413ab5b067bfd38979e9de720fefe4daa9092618ce636f6b3489552595d7',
  '0028_automations_runtime': 'bf455912a549bd22bcd79cd0ae26cd28cb449e88b2db47d829f43613be1b1cbd',
  '0029_dataio_files_email_namespace':
    'ca307fb86681722690629d03b22f1ccf57f656c34af79f3d89aa41f18fa1813b',
  '0030_report_documents': 'ab513b132efda3e6b5b153ba10905b2e6b6ceeaff480da9139afbe262fa95767',
  '0031_documents': 'ab98dbb6ce73656a28d24ba15e95557a6287e77e5738ce77309badc9a46dc317',
  '0032_nav_group_width': '3683c74a1e66d7f46b16a872c80813fedac95e8a38bbe542ee0815dc10c086e4',
});

describe('shipped migration checksums', () => {
  it('every published migration still hashes to its shipped value', () => {
    const actual = shippedChecksums();
    for (const migration of ALL_MIGRATIONS) {
      const expected = SHIPPED_CHECKSUMS[migration.name];
      if (expected === undefined) continue; // not released yet — covered below
      expect(
        actual[migration.name],
        `${migration.name} no longer hashes to the value its release wrote to every installed ` +
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
        `${name} was published but is no longer in ALL_MIGRATIONS. Installed ledgers still carry ` +
          `its row, and the migrator treats an unknown applied row as corruption.`,
      ).toBe(true);
    }
  });

  it('the ledger order of shipped migrations is unchanged', () => {
    const shipped = ALL_MIGRATIONS.map((m) => m.name).filter((n) => n in SHIPPED_CHECKSUMS);
    expect(shipped, 'shipped migrations must keep their original relative order').toEqual(
      Object.keys(SHIPPED_CHECKSUMS),
    );
  });

  it('unreleased migrations sit after every published one', () => {
    const names = ALL_MIGRATIONS.map((m) => m.name);
    const firstUnpinned = names.findIndex((n) => !(n in SHIPPED_CHECKSUMS));
    const unpinned = firstUnpinned === -1 ? [] : names.slice(firstUnpinned);
    // New migrations between releases are expected, so their presence is not a
    // failure — they get pinned by the release that publishes them. What must
    // hold is that they are a suffix: a published migration appearing after an
    // unreleased one would mean something was slotted into the middle of a
    // ledger that installs have already run past.
    expect(
      unpinned.filter((n) => n in SHIPPED_CHECKSUMS),
      'a published migration is ordered after an unreleased one — new migrations append',
    ).toEqual([]);
  });
});
