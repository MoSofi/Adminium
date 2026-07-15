/**
 * Dashboard-builder edit-permission gate (04-widget-registry.md §6.3).
 *
 * Two editing paths, resolved from the SERVER's per-page `page:<pageId>:edit`
 * capability (delivered on the page document as `canEditLayout`, computed by
 * the same `request.can('page:<id>:edit')` the shared-layout PATCH is gated on,
 * super-admins bypassing):
 *
 *   - callers WITH the grant edit the SHARED default layout (`adminium_pages`) —
 *     the layout every viewer inherits and new users get.
 *   - everyone else edits only their PERSONAL override (`adminium_views`,
 *     `kind: 'layout'`).
 *
 * The client deliberately does NOT infer this from role slugs: page-edit is a
 * per-page grant (a built-in `editor` can be blessed on one page; a default
 * `admin` holds none), so a role heuristic misroutes both and diverges from the
 * server — the server then 403s the shared write or silently strands the edit.
 */

/** The layer a caller's edits persist to. */
export type EditTarget = 'shared' | 'personal';

/** True when the caller may save the shared default (holds `page:<id>:edit`). */
export function canEditSharedLayout(canEditLayout: boolean): boolean {
  return canEditLayout;
}

/** Which layer this caller's edit-mode changes persist to. */
export function editTargetForCapability(canEditLayout: boolean): EditTarget {
  return canEditLayout ? 'shared' : 'personal';
}
