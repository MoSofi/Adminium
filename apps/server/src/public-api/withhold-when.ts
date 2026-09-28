// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shape of a withhold's `when`, on its own so the scope compiler and the
 * rule's runtime (`withhold.ts`) can both name it without importing each other.
 */
import type { StateCondition } from '@adminium/manifest';

/**
 * When a rule withholds its columns whoever reads the row: while the row
 * holds a value (a ticket whose order is not paid yet), or the row one of its
 * links points at does. Every condition must hold.
 */
export interface WithholdWhen {
  where?: readonly StateCondition[] | undefined;
  linked?: readonly { via: string; where: readonly StateCondition[] }[] | undefined;
}
