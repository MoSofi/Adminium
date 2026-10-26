// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every route's screens re-render when the words change: a language switch,
 * an owner's rewording, a deferred chunk landing (`bumpI18nRevision`).
 *
 * The root already re-renders on that, and it reached nothing: TanStack Router
 * memoises each `Outlet` and each match, so a re-render above a route stops
 * there. A screen that reads the plain `t()` and no context of the language
 * kept the words of its first paint — on a new browser that is the browser's
 * English, drawn just before the session said the reader reads Arabic, and it
 * stayed English under an Arabic menu until a reload.
 *
 * So each route's own components subscribe, wrapped once here over the whole
 * tree rather than at forty call sites a new route could forget. A re-render,
 * never a remount: the page keeps its state (an unsaved form, an open dialog).
 */
import { getI18nRevision, subscribeI18nRevision } from '@adminium/i18n';
import { useSyncExternalStore, type ComponentType } from 'react';

const SLOTS = ['component', 'errorComponent', 'notFoundComponent', 'pendingComponent'] as const;

const following = new WeakSet<object>();

function follows(Screen: ComponentType<Record<string, unknown>>): ComponentType<Record<string, unknown>> {
  if (following.has(Screen)) return Screen;
  function FollowsLanguage(props: Record<string, unknown>) {
    useSyncExternalStore(subscribeI18nRevision, getI18nRevision, getI18nRevision);
    return <Screen {...props} />;
  }
  FollowsLanguage.displayName = `FollowsLanguage(${Screen.displayName ?? Screen.name})`;
  // A `lazyRouteComponent`'s chunk loader, which the router calls before it renders.
  const preload = (Screen as { preload?: unknown }).preload;
  if (preload !== undefined) Object.assign(FollowsLanguage, { preload });
  following.add(FollowsLanguage);
  return FollowsLanguage;
}

interface RouteLike {
  options: object;
  children?: unknown;
}

/** Wraps the components of `route` and of every route under it, in place. Safe to call twice. */
export function followLanguage(route: RouteLike): void {
  const options = route.options as Record<string, unknown>;
  for (const slot of SLOTS) {
    const Screen = options[slot];
    if (typeof Screen === 'function') options[slot] = follows(Screen as ComponentType<Record<string, unknown>>);
  }
  const children = route.children;
  if (children === undefined || children === null) return;
  for (const child of Array.isArray(children) ? children : Object.values(children)) followLanguage(child as RouteLike);
}
