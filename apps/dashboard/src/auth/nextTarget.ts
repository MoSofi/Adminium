// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where sign-in hands a person back: the `next` the staff gate of an app's
 * screens puts on `/login` (plugins/surfaces.ts), and the dashboard's own
 * `returnTo`.
 *
 * Both are an address somebody else can write into a link, so both are read
 * as a path of THIS origin and nothing else: one leading `/`, then anything
 * but a second `/` or a `\` (a browser reads `/\host` as `//host`), and no
 * `\` or control character anywhere after it. An absolute address, a scheme
 * and a host are never followed.
 *
 * `next` is narrower still. It is followed as a document, so it could land a
 * person on any path of the origin, an API route among them. On the
 * dashboard's own address the gate only ever sends an app's mount
 * (`/apps/<key>/…`), so only that is followed there; on an address mapped to
 * an app's staff side every path is the app's, and any local path is.
 *
 * A `next` on the dashboard's own address that names one of the dashboard's
 * own screens (`/studio/privacy`, `/p/orders`) is not a document to open: it
 * is where the person was going, followed inside the dashboard as `returnTo`
 * is ({@link dashboardReturn}). Never an API route, and never into `/apps/`.
 */

/** A path of this origin: `/p/orders`, never `//host`, `/\host` or `https://host`. */
export function isLocalPath(value: unknown): value is string {
  // eslint-disable-next-line no-control-regex -- a control character in an address is exactly what is refused
  return typeof value === 'string' && /^\/(?![/\\])[^\\\u0000-\u001f]*$/.test(value);
}

/** The address a sign-in on this host may hand back to as a document, or null. */
export function nextTarget(next: string | null | undefined, onAppAddress: boolean): string | null {
  if (!isLocalPath(next)) return null;
  return onAppAddress || /^\/apps\/[a-z0-9]/.test(next) ? next : null;
}

/**
 * The dashboard screen a sign-in on the dashboard's own address hands back to
 * when `next` names one, or null: a path of this origin that is not an API
 * route and not an app's screens (those are opened as a document, above).
 * On an app's staff address every path is the app's, so none is.
 */
export function dashboardReturn(next: string | null | undefined, onAppAddress: boolean): string | null {
  if (onAppAddress || !isLocalPath(next)) return null;
  if (/^\/(api|apps)(\/|$|\?|#)/.test(next)) return null;
  return next;
}
