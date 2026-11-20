// SPDX-License-Identifier: AGPL-3.0-only
import { coverage, workers } from '@adminium/config/vitest';
import { defineConfig } from 'vitest/config';
import { ShardSequencer } from './test/shard-sequencer.js';

/**
 * Several suites here exercise a live Postgres (Northwind) through per-suite
 * beforeAll/afterAll hooks (create test DB, build the app, introspect, drop DB).
 * Under `turbo run test` the whole monorepo runs these live-PG suites in
 * parallel against one shared server, so a cold-cache run can push an individual
 * setup/teardown hook past vitest's 10s default and flake with "Hook timed out".
 * The work itself is fast in isolation (<1s); raising only the hook/test
 * timeouts gives headroom under contention without touching any assertion.
 */
export default defineConfig({
  test: {
    ...workers(),
    // No test reaches adminium.dev: the catalogue switches are on by default since 0.3.16.
    setupFiles: ['./test/no-adminium-dev.setup.ts'],
    // CI runs this suite in shards (`--shard=i/n`); they are dealt by measured
    // file durations rather than vitest's path hash. See test/shard-sequencer.ts.
    sequence: { sequencer: ShardSequencer },
    // The quality bar asks 85 statements / 80 branches. The statements floor
    // keeps its existing 88 ratchet; branches move 79 -> 80 because 79 was the
    // one configured floor in the repo sitting BELOW its number, which is
    // what kept the gate's coverage row unchecked.
    //
    // WHAT IS MEASURED, AND WHAT IS NOT. Re-measured in CI's own `verify`
    // configuration as far as this machine allows — TEST_POSTGRES_URL against a
    // real pg16, PGUSER/PGPASSWORD set, 1477 tests, 7 skipped: 90.54% statements
    // / 81.3% branches, so 80 clears with 1.3 points of margin. What could NOT be
    // reproduced is the MySQL leg (no MySQL, no Docker here), and that leg is
    // precisely why fb8b2ae lowered this floor from 81 to 79 off a CI reading.
    // The denominator is close to fully expanded — 4 of 211 files are unexecuted
    // and all four are entrypoints (index, start, cli/index, rbac/index) that no
    // database leg reaches — so MySQL should add covered branches rather than
    // expand the total, which is the adapter-mysql effect in reverse. That is a
    // reasoned expectation, not a measurement: if `verify` reddens on coverage,
    // this line is the first place to look.
    //
    // AST-AWARE REMAPPING, since the suite runs in CI shards (2026-11-20). The
    // default v8-to-istanbul conversion builds a file's branch map from the code
    // that RAN, so each shard converts the same file to a different map, and
    // merging the shards' maps overstated branches: 55.19% unsharded against
    // 62.42% merged on the same 30 files. Remapped from the source AST, every
    // shard builds the same map and the merge equals an unsharded run. Measured
    // so in CI on 2026-11-20 (Postgres, no MySQL): 90.42% / 82.04%, so both
    // floors still clear.
    coverage: { ...coverage({ statements: 88, branches: 80 }), experimentalAstAwareRemapping: true },
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
