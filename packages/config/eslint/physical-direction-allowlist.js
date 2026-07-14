/**
 * Allowlist for `adminium/no-physical-direction-classes` (10-i18n-theming.md
 * §5.2). Each entry is an EXACT class token (including any variant/negative
 * prefix, e.g. `md:text-left`) that is genuinely, permanently physical and
 * must NOT mirror under RTL — a color-scale gradient direction, a document
 * text-align control, etc. (§5.1 "Judgment calls").
 *
 * Adding a token here is a reviewed change: every entry needs a one-line
 * justification comment. Navigation/layout semantics never belong here — they
 * mirror. Empty today: the tree is clean.
 */

/** @type {string[]} */
export const PHYSICAL_DIRECTION_ALLOWLIST = [
  // e.g. 'text-left', // document builder: literal left-align control (physical)
];
