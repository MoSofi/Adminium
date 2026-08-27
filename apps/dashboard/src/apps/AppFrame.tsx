// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A hosted app surface, blended into the dashboard (29-app-surfaces.md D6).
 *
 * ── Why an iframe, and why that is not a cop-out ───────────────────────────
 * The alternative considered and rejected was DOM-level merging — mounting the
 * app's React tree inside this one. The fifteen apps ship GLOBAL stylesheets: a
 * reset, `body`-level rules, their own token layer, their own icon set, their
 * own i18n runtime. Two React roots, two i18n singletons and fifteen design
 * systems sharing one document with the dashboard's Tailwind is not a feature,
 * it is a rewrite of all fifteen. A same-origin iframe keeps every app's CSS
 * world intact and is invisible at 1× zoom.
 *
 * No `sandbox` attribute, deliberately. The content is first-party code
 * Adminium itself serves at its own origin, and the minimum this needs —
 * `allow-same-origin allow-scripts allow-forms` — is equivalent to no sandbox
 * while READING as protection. What actually had to be checked was the other
 * direction: helmet shipped `frame-ancestors 'none'`, which would have rendered
 * this blank, and 29-T09 narrowed it to `'self'`.
 *
 * ── The two things that make it feel blended rather than framed ────────────
 *
 * 1. NAVIGATION DOES NOT REMOUNT. A sidebar click changes the route's splat,
 *    and this forwards it to the child as `host:set {path}`. Rebuilding `src`
 *    instead would reload the app on every click — losing scroll, form state
 *    and any in-flight work — which is the difference between a blended app
 *    and a hosted one with extra steps.
 * 2. THEME AND LOCALE COME FROM HERE. D11: the dashboard owns those axes and
 *    the app grows no control of its own.
 */
import { splitAppKeyParam } from '../shell/SidebarNav.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '@adminium/ui';

import { t } from '../i18n/t.js';
import {
  BRIDGE_VERSION,
  HELLO,
  INIT,
  NAVIGATE,
  SET,
  bcp47,
  bridgeMessage,
  type HostInit,
  type HostSet,
} from './bridge.js';

export interface AppFrameProps {
  appKey: string;
  /** Path under the surface base, no leading slash. `''` is the app's root. */
  path: string;
  /** The lens the active nav item pins, if it pinned one. */
  persona?: string | undefined;
  /** Accessible name for the frame — the active nav item's label. */
  title: string;
  /** Called when the APP navigates itself, so the address bar can follow. */
  onNavigate: (path: string) => void;
}

export function AppFrame({ appKey, path, persona, title, onNavigate }: AppFrameProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const resolved = useTheme();
  const [ready, setReady] = useState(false);

  /*
   * THE ECHO GUARD.
   *
   * Without it: the child reports `navigate {invoices}` → the host pushes
   * `/a/clients/invoices` → the `path` prop changes → the host sends
   * `host:set {invoices}` → the child navigates → reports again. A loop that
   * settles only because the child's `go()` happens to be idempotent, which is
   * not a property this component may rely on across fifteen apps.
   *
   * A ref, not state: it must be readable by the message handler in the same
   * tick the message arrives, and a state update would be a render too late.
   */
  const lastFromChild = useRef<string | null>(null);

  const post = useCallback((message: HostInit | HostSet): void => {
    // `location.origin`, never `*` — see bridge.ts.
    frame.current?.contentWindow?.postMessage(message, window.location.origin);
  }, []);

  // The handshake, plus the child's own navigations. One listener for both:
  // the child may re-`hello` after an internal reload, and treating that as a
  // fresh handshake is exactly right.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frame.current?.contentWindow) return;
      const message = bridgeMessage(event.data);

      if (message.type === HELLO) {
        if (message['v'] !== BRIDGE_VERSION) {
          // The CHILD logs its own version-mismatch line and renders its own
          // chrome; this one is for whoever is looking at the dashboard's
          // console instead. Both name both versions.
          console.error(
            `[adminium] hosted app "${appKey}" speaks bridge v${String(message['v'])}; ` +
              `this dashboard speaks v${String(BRIDGE_VERSION)}. Rebuild the surface.`,
          );
          return;
        }
        setReady(true);
        /*
         * The child reports where IT is, and the host's path wins — the URL is
         * what the operator navigated to. The one exception is a child that
         * booted somewhere the host's path does not name, which cannot happen
         * while `src` carries the path; belt and braces for a child that
         * restored its own state.
         */
        post({
          type: INIT,
          v: BRIDGE_VERSION,
          path,
          theme: resolved.theme,
          locale: bcp47(resolved.locale),
          ...(persona === undefined ? {} : { persona }),
        });
        return;
      }

      if (message.type === NAVIGATE && typeof message['path'] === 'string') {
        lastFromChild.current = message['path'];
        onNavigate(message['path']);
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // `path`, `resolved` and `persona` are read inside and must be fresh when a
    // late `hello` arrives; re-subscribing is one listener swap, not a remount.
  }, [appKey, onNavigate, path, persona, post, resolved]);

  // Route → child. Skipped when this path is the one the child just reported,
  // which is the echo guard's whole job.
  useEffect(() => {
    if (!ready) return;
    if (lastFromChild.current === path) {
      lastFromChild.current = null;
      return;
    }
    post({ type: SET, path });
  }, [path, post, ready]);

  // Theme and locale → child (D11), on every change rather than at init only:
  // an operator flipping the dashboard to dark must restyle the frame live.
  useEffect(() => {
    if (!ready) return;
    post({ type: SET, theme: resolved.theme, locale: bcp47(resolved.locale) });
  }, [post, ready, resolved]);

  /*
   * `src` carries the path so a COLD LOAD lands on the right screen without
   * waiting for the handshake — and it is deliberately NOT in a dependency
   * array anywhere, because React would then reset the attribute on every
   * navigation and reload the app. Later navigations go over the bridge.
   *
   * The key is the app key alone: switching apps is a genuine remount, moving
   * within one app is not.
   */
  /*
   * `<appKey>~<instance>` selects an extra tenant of the app (29 D9): the same
   * bundle mounted at `/apps/<appKey>/<instance>/staff/`, reading its own
   * database. Without the split the frame would load the app's own mount and
   * quietly show the wrong business's data.
   */
  const { appKey: mountKey, instance } = splitAppKeyParam(appKey);
  const mountPrefix =
    instance === null ? `/apps/${mountKey}/staff` : `/apps/${mountKey}/${instance}/staff`;
  const initialSrc = useRef(`${mountPrefix}/${path}`).current;

  return (
    <iframe
      ref={frame}
      key={appKey}
      src={initialSrc}
      title={title}
      /*
       * The FRAME is the scroll container, and no host-side `overflow` rule was
       * needed to get there: `AppShell`'s `<main class="min-h-0 flex-1">`
       * already bounds it. Measured live at a 520px viewport with 716px of app
       * content — the host document did not scroll, the frame did. Worth
       * recording because the obvious "fix" for the two-scrollbar risk is to
       * add `overflow-hidden` to the outlet, and doing so would change nothing
       * except to clip a future page that legitimately overflows.
       */
      className="h-full w-full border-0"
      // Not `sandbox` — see the header. `allow` is empty: nothing in the fleet
      // needs camera, microphone or geolocation, and naming none is the
      // narrowest permissions policy an iframe can carry.
      allow=""
    >
      {t('apps.frame.noFrames', 'This app needs a browser that supports frames.')}
    </iframe>
  );
}
