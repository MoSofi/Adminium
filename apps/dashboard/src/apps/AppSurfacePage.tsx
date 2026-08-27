// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/a/$appKey/$` — a hosted app's screens, inside this dashboard
 * (29-app-surfaces.md D5/D6).
 *
 * ── Why `/a/` and not a bare `/pos/kitchen` ────────────────────────────────
 * The naked URL was the nicer one and is the one deviation this wave records
 * (D5). The dashboard already owns roughly twenty-two top-level segments and
 * grows more each wave; the installer will accept arbitrary third-party app
 * keys; and the failure mode of a collision is SILENT SHADOWING years later,
 * where either an installed app stops working or a new dashboard route does,
 * and nobody remembers there was a rule. One extra segment deletes the entire
 * collision policy. It also mirrors `/p/` — generated pages are `/p/`, app
 * pages are `/a/`.
 *
 * ── One placement at a time ────────────────────────────────────────────────
 * An app the operator placed EXTERNALLY is not secretly reachable here: it 404s
 * exactly as an unknown key does. Rendering it anyway would mean two URLs for
 * one screen and an operator who cannot tell which one to bookmark.
 */
import { useCallback } from 'react';
import { useNavigate, useParams, useRouteContext } from '@tanstack/react-router';

import { activeHostedItem, hostedAppByKey } from '../app/bootstrap.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { NotFoundPage } from '../states/NotFoundPage.js';
import { AppFrame } from './AppFrame.js';

export function AppSurfacePage() {
  /*
   * `strict: false`, and it is not laziness.
   *
   * The strict form (`{ from: '/a/$appKey/$' }`) throws `Could not find an
   * active match` whenever this component renders while that route is NOT the
   * active one — which React does during a transition, with the outgoing tree
   * still mounted against an incoming match. In a lazy route that is a hard
   * crash on a screen the operator was in the middle of leaving. Reading
   * loosely and guarding costs one branch and cannot throw.
   */
  const context = useRouteContext({ strict: false });
  const params = useParams({ strict: false });
  const navigate = useNavigate();

  const bootstrap = context.bootstrap;
  const appKey = params.appKey;
  const path = (params._splat ?? '').replace(/^\/+|\/+$/g, '');

  /*
   * The app told us it moved. `replace`, not `push`: the app's internal screen
   * changes must not each become a history entry the operator has to press
   * Back through to leave the app — the same argument the child makes for
   * `replaceState` over `pushState`.
   */
  const onNavigate = useCallback(
    (next: string) => {
      if (appKey === undefined) return;
      void navigate({ to: '/a/$appKey/$', params: { appKey, _splat: next }, replace: true });
    },
    [appKey, navigate],
  );

  // Mid-transition: this tree is on its way out and the match it belongs to is
  // already gone. Render nothing rather than a 404 that flashes on the way.
  if (bootstrap === undefined || appKey === undefined) return null;

  const app = hostedAppByKey(bootstrap, appKey);
  // Unknown key, external placement, or a build with no `surface.json` — all
  // three arrive here as "not in `hostedApps`", and all three mean this URL
  // does not name anything. Studio distinguishes them; the router does not
  // need to.
  if (app === null) return <NotFoundPage />;

  const item = activeHostedItem(app, path);
  return (
    <>
      {/*
        The topbar names the SECTION and the app, the way a generated page names
        itself. Without this the topbar kept whatever the previous route had
        published — "Home", on every screen of every blended app — which is the
        single loudest tell that a frame is a frame rather than part of the
        shell.

        The app's own screen title still renders inside the frame; the two are
        different registers, the same as a generated page's `h1` and its topbar
        line.
      */}
      <PageActions title={item?.label ?? app.label} subtitle={app.label} />
      <AppFrame
        appKey={appKey}
        path={path}
        title={item?.label ?? app.label}
        onNavigate={onNavigate}
        {...(item?.persona === undefined ? {} : { persona: item.persona })}
      />
    </>
  );
}
