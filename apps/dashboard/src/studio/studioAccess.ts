// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who may open Studio — the role test, as a leaf.
 *
 * Split out of `StudioGuard.tsx` because a surface OUTSIDE Studio needs it:
 * `pages/planning/EmptyLayoutNotice` offers "Open page settings" only to
 * someone who can actually reach that screen, and importing the guard would
 * drag `StatePage` and the bootstrap query into a page-template chunk to read
 * a two-line predicate. A second copy of the role list is the alternative, and
 * the copy is what drifts.
 */

/** Role slugs granted Studio access (bootstrap `roles` payload). */
const STUDIO_ROLES = new Set(['admin', 'super-admin']);

export function hasStudioAccess(roles: readonly string[]): boolean {
  return roles.some((role) => STUDIO_ROLES.has(role));
}
