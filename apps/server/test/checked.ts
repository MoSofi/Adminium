// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The statements (`insertRow`, `insertRows`, `updateRows`) take a
 * `CheckedRow`, a brand only the write service's check step produces — that is
 * the point: a write that skipped the column rules does not compile.
 *
 * A STATEMENT-LEVEL TEST is the one caller with a reason to hand one over
 * anyway: it is testing the SQL a statement emits, not the order a write runs
 * in. This is the only way to say so, it lives in `test/` where production
 * code cannot import it, and `source-write-guard.test.ts` still owns the
 * question of where statements may live.
 */
import type { Row } from '../src/crud/mask.js';
import type { CheckedRow } from '../src/crud/write-service.js';

export function asChecked(row: Row): CheckedRow {
  return row as CheckedRow;
}
