// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Allowlist for `adminium/no-physical-direction-classes`. Each entry is an
 * EXACT class token (including any variant/negative prefix, e.g.
 * `md:text-left`) that is genuinely, permanently physical and must NOT
 * mirror under RTL — a color-scale gradient direction, a document text-align
 * control, etc.
 *
 * Adding a token here is a reviewed change: every entry needs a one-line
 * justification comment. Navigation/layout semantics never belong here — they
 * mirror. Empty today: the tree is clean.
 */

/** @type {string[]} */
export const PHYSICAL_DIRECTION_ALLOWLIST = [
  // e.g. 'text-left', // document builder: literal left-align control (physical)
];
