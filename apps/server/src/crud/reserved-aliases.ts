// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Row keys the read path writes itself, which no projection alias may take.
 *
 * `_masked` is the refusal marker `maskRow` writes and every refused lookup,
 * measure and derived field appends to. An alias that claimed it would
 * OVERWRITE the list — `applyMeasureMask` assigns `row[alias]` and `maskRow`
 * assigns `row._masked`, and whichever runs last wins — so a caller could turn
 * masked cells into merely-empty ones for a whole row. It is not an escalation
 * (the values were already withheld) but it silently removes the affordance
 * that says so, which is the one failure this layer must not have.
 *
 * The alias grammar all three families share (`/^[A-Za-z_][A-Za-z0-9_]{0,63}$/`)
 * has admitted a leading underscore since `agg=` shipped, so the exclusion has
 * to be stated rather than derived. `compute=` enforces the same list one
 * level up, inside the shared page-config validator — this is the `lookup=` /
 * `agg=` half of the same rule.
 */

import { RESERVED_ROW_KEYS } from '@adminium/engine/config';

import { ValidationFailedError } from '../errors.js';

export function assertNotReservedAlias(alias: string, kind: string): void {
  if (!RESERVED_ROW_KEYS.includes(alias)) return;
  throw new ValidationFailedError(
    `${kind} alias ${JSON.stringify(alias)} is a reserved row key.`,
    { alias },
  );
}
