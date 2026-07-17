/**
 * The {@link WidgetRuntimeEnv} this SPA hands the widget registry — the input to
 * 11-electron.md §7's offline asset policy ("the widget registry resolves `map-*`
 * widgets to `choropleth-grid` when `runtime === 'desktop'` or
 * `offlineAssets === true`"). Mounted in `app/router.tsx`'s root component, above
 * every route that can render a widget.
 *
 * WHY THE BRIDGE AND NOT `GET /api/v1/system/info`, given §4 says the SPA "trusts
 * the server for feature gating and the bridge only for native affordances" — the
 * rule `lib/desktop-runtime.ts` exists to enforce. Three reasons it does not
 * govern this call, in order of weight:
 *
 *  1. **This is not feature gating.** §4's rule protects decisions a compromised
 *     renderer could lie its way through: whether billing renders, whether email
 *     may send. Nothing here grants an ability — both branches render a widget
 *     the user is already entitled to. The only lie available is "pretend to be
 *     offline", whose payoff is a tilegram instead of a map.
 *  2. **It must be synchronous.** `system/info` is a fetch; the answer would land
 *     one or more renders after the first widget mounts. In that window a stored
 *     `map-bubble` mounts, its `lazy()` ref imports the map chunk, and Leaflet
 *     pulls tiles — the exact network touch the desktop app promises never to
 *     make, already made by the time the authoritative answer arrives. A guarantee
 *     that depends on a race is not one. `window.adminiumDesktop` is injected by
 *     the preload before the document runs, so it is knowable at first paint.
 *  3. **The failure modes are not symmetric.** A false positive (fallback on a
 *     browser that somehow has the bridge — impossible outside the shell) costs a
 *     tilegram. A false negative costs the offline guarantee. The signal that is
 *     available earliest and errs toward the fallback is the correct one, and the
 *     server's `runtime` agrees with it by construction (§4: "both must agree").
 *
 * `offlineAssets` is §7's second trigger and is `false` here: no self-host surface
 * sets it yet. It exists because the flag, not the shell, is what an air-gapped
 * self-host install and 11-T18's offline smoke test will flip — neither of which
 * has a preload bridge to detect.
 */

import { DEFAULT_WIDGET_RUNTIME_ENV, type WidgetRuntimeEnv } from '@adminium/widgets';

import { isDesktopRuntime } from './desktop-runtime.js';

/**
 * Resolved ONCE at module scope, deliberately: this is context, so a fresh object
 * would re-render every WidgetHost in the tree on each root render — and the
 * answer cannot change within a page lifetime anyway (the bridge is either
 * injected before the document runs or it never appears).
 */
export const widgetRuntimeEnv: WidgetRuntimeEnv = isDesktopRuntime()
  ? { runtime: 'desktop', offlineAssets: false }
  : DEFAULT_WIDGET_RUNTIME_ENV;
