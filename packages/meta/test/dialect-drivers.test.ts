/**
 * Regression guard for the "matrix quietly only tests sqlite" trap
 * (15-quality.md): the dialect harness (test/helpers/db.ts) gates the Postgres
 * and MySQL legs on `Boolean(TEST_*_URL) && resolvable(driver)`. If `pg` /
 * `mysql2` are not dependencies of @adminium/meta, `resolvable()` is always
 * false and those legs are skipped even when their URL is set — so viewsRepo's
 * cross-dialect SQL ships to Postgres/MySQL untested.
 *
 * This test fails if either driver is dropped from the package, keeping the
 * silent-skip cause (missing driver) impossible: a skipped leg then means only
 * "no TEST_*_URL configured", which is the intended, visible reason.
 */
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('dialect drivers are real dependencies of @adminium/meta', () => {
  it.each(['pg', 'mysql2'])('resolves %s so its matrix leg is never silently skipped', (driver) => {
    expect(() => require.resolve(driver)).not.toThrow();
  });
});
