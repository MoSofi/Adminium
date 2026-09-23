// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/a/$appKey/$` — a hosted app's screens, inside this
 * dashboard.
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

import {
  activeHostedItem,
  hostedAppByKey,
  type BootstrapData,
  type UnavailableApp,
} from '../app/bootstrap.js';
import { PageActions } from '../shell/PageActionsProvider.js';
import { NotFoundPage } from '../states/NotFoundPage.js';
import { StatePage } from '../states/StatePage.js';
import { Button, IconTile } from '@adminium/ui';
import { Compass } from 'lucide-react';
import { t } from '../i18n/t.js';
import { AppFrame } from './AppFrame.js';

/**
 * Why `/a/<param>` shows nothing, or null when the app is simply not
 * installed. An instance (`key~slug`) shares its app's answer. Here rather
 * than beside the other bootstrap readers: this page is its only reader, and
 * that module is in the entry chunk.
 */
export function unavailableAppByKey(bootstrap: BootstrapData, param: string): UnavailableApp | null {
  const at = param.indexOf('~');
  const appKey = at === -1 ? param : param.slice(0, at);
  return (bootstrap.unavailableApps ?? []).find((app) => app.appKey === appKey) ?? null;
}

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
  if (app === null) {
    /*
     * Installed, but not here: switched off, its staff screens switched off,
     * or placed on its own address. Each says so, and the last links there.
     */
    const unavailable = unavailableAppByKey(bootstrap, appKey);
    if (unavailable === null) return <NotFoundPage />;
    if (unavailable.reason === 'external') {
      /*
       * Drawn here rather than as a system state: this lazy page is the only
       * place it can appear, and the state map ships in the entry chunk.
       */
      return (
        <div data-part="state-hero" data-state="app-external" className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <IconTile size="lg">
            <Compass aria-hidden className="size-7" />
          </IconTile>
          <h1 className="mt-2 text-xl font-bold tracking-tight">
            {t('states.appExternal.title', 'This app opens on its own')}
          </h1>
          <p className="max-w-md text-sm text-fg-muted">
            {t('states.appExternal.body', 'It opens at its own address, not inside the dashboard.')}
          </p>
          {unavailable.href === undefined ? null : (
            <Button asChild className="mt-2">
              <a href={unavailable.href}>{t('states.appExternal.primary', 'Open it')}</a>
            </Button>
          )}
        </div>
      );
    }
    return (
      <StatePage stateId={unavailable.reason === 'app-disabled' ? 'app-disabled' : 'screens-off'} fullPage={false} />
    );
  }

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
