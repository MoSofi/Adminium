// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE COUNTING LEVEL: `privacy.tracking`, Off, Counts only or Per visitor.
 *
 * Its own module because both the view counter and the visitor door read it,
 * and the counter already reads the visitor door's types: keeping the level
 * here leaves the two without an import loop.
 */

/** How visitors are counted: `privacy.tracking`. */
export const TRACKING_LEVELS = ['off', 'counts', 'visitor'] as const;
export type TrackingLevel = (typeof TRACKING_LEVELS)[number];
