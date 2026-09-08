// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The one owner of `document.title` (03 app-shell).
 *
 * The tab used to read "Adminium" on every screen: `useBrandedDocumentTitle`
 * published the workspace name and nothing else, so a user with six tabs open
 * on six pages had six identical tabs. The record page was the sole exception,
 * and it got there by writing `document.title` directly and restoring the
 * previous value on unmount — a save/restore that is only correct while
 * exactly one component in the tree does it.
 *
 * So the title is composed here, from two slots, and written by this module
 * alone:
 *
 * - **the app name**, from branding — one publisher, the root route, since
 *   `/branding` is public and the sign-in screen needs it too;
 * - **the page**, from whichever surface currently IS the screen.
 *
 * A module-level store rather than context because `document.title` is itself
 * a global, and because the two publishers sit on opposite sides of the route
 * tree — the app name above the router, the page inside it. Composing in a
 * component would mean two effects racing for the same global, and React runs
 * child effects before parent ones: on a cold load the page would set its
 * title and the root would immediately overwrite it with the bare app name.
 * That is the bug this shape exists to make unrepresentable.
 *
 * ONE PAGE PUBLISHER AT A TIME. Inside the shell that is `Topbar` (the tab
 * mirrors the `<h1>`, so the two can never disagree); outside it — sign-in,
 * the direct-addressed system states, the routed 404 — it is the screen
 * itself. A surface that can render either as a whole screen or inside one
 * (`StateHero` inline, the in-outlet 404) must NOT publish: it is a region of
 * a page that already has a name.
 */
import { useEffect } from 'react';

import { DEFAULT_BRANDING } from '../app/branding.js';

/** Page · App. The record page's breadcrumb separator, kept for the tab. */
const SEPARATOR = ' · ';

let appName = DEFAULT_BRANDING.appName;
let pageTitle: string | null = null;

function apply(): void {
  document.title = pageTitle === null || pageTitle === '' ? appName : pageTitle + SEPARATOR + appName;
}

/** Branding's slot — the trailing half of every tab title. */
export function setDocumentAppName(next: string): void {
  appName = next;
  apply();
}

/** The screen's slot; `null` leaves the tab reading the workspace name alone. */
export function setDocumentPageTitle(next: string | null): void {
  pageTitle = next;
  apply();
}

/**
 * Names the tab for as long as the caller is mounted, and gives the name back
 * on unmount. Clearing is what stops one screen's name bleeding onto the next:
 * React runs every destroy before any create in a commit, so a route swap
 * clears then republishes rather than the reverse.
 */
export function useDocumentPageTitle(title: string | null): void {
  useEffect(() => {
    setDocumentPageTitle(title);
    return () => setDocumentPageTitle(null);
  }, [title]);
}
