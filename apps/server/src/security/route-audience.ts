// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who each route is for: the instance's own people (`staff`) or anybody on the
 * internet (`public`).
 *
 * The server's operator can hide every public page at once
 * (`trial/public-pages.ts`), and a gate like that is worth as much as the door
 * it forgets. So the answer is not a list of public paths kept somewhere: it is
 * a tag every route carries from the moment it is registered.
 *
 *  - A route that asks for a signed-in person or a staff API key before it
 *    answers ({@link signedInGuard}: `app.requireAuth`, `app.rbac.require(…)`)
 *    is `staff` by itself: a stranger gets nothing from it anyway.
 *  - Every other route says which it is, in its options
 *    (`config: { audience: 'staff' }`), or for a whole scope of public doors at
 *    once ({@link tagRoutes}).
 *  - A route that says nothing counts as PUBLIC: hidden with the rest. A door
 *    nobody thought about is closed, never left open.
 *
 * `public-route-tags.test.ts` composes the widest server and fails on any route
 * that carries no tag, so nobody adds one without deciding.
 */
import type { FastifyInstance, RouteOptions } from 'fastify';

export type RouteAudience = 'staff' | 'public';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Who this route is for (`security/route-audience.ts`). Unset counts as public. */
    audience?: RouteAudience;
  }
  interface FastifyInstance {
    /** Every route's audience, as registered (`security/route-audience.ts`). */
    routeAudience: RouteAudienceRegistry;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const SIGNED_IN_GUARDS = new WeakSet<Function>();

/**
 * Mark a pre-handler that refuses anybody not signed in as staff (a session or
 * a staff API key). A route that runs one is `staff` without saying so.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function signedInGuard<F extends Function>(guard: F): F {
  SIGNED_IN_GUARDS.add(guard);
  return guard;
}

function runsSignedInGuard(preHandler: unknown): boolean {
  const list: unknown[] = Array.isArray(preHandler) ? preHandler : [preHandler];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return list.some((hook) => typeof hook === 'function' && SIGNED_IN_GUARDS.has(hook as Function));
}

/** A route's audience as its config says it, or null when it says none. */
export function audienceOf(config: { audience?: unknown } | undefined): RouteAudience | null {
  const audience = config?.audience;
  return audience === 'staff' || audience === 'public' ? audience : null;
}

/**
 * Every route registered in `scope` from now on (its children's too) is for
 * `audience`, unless it says otherwise itself or runs a signed-in guard.
 */
export function tagRoutes(scope: FastifyInstance, audience: RouteAudience): void {
  scope.addHook('onRoute', (route) => {
    if (audienceOf(route.config) !== null) return;
    route.config = { ...route.config, audience };
  });
}

/**
 * Tag the routes `register` adds on `app` itself, for a plugin that registers
 * on its parent (`fastify-plugin`) and a package whose routes take no config of
 * ours. The hook stays, but tags nothing once `register` has settled.
 */
export async function tagRoutesWhile(app: FastifyInstance, audience: RouteAudience, register: () => PromiseLike<unknown>): Promise<void> {
  let on = true;
  app.addHook('onRoute', (route) => {
    if (!on || audienceOf(route.config) !== null) return;
    route.config = { ...route.config, audience };
  });
  try {
    await register();
  } finally {
    on = false;
  }
}

export interface RouteAudienceRow {
  method: string;
  url: string;
  audience: RouteAudience | null;
}

export interface RouteAudienceRegistry {
  /** Called by the first `onRoute` hook: tags a guarded route `staff` and keeps the route to read back. */
  record(route: RouteOptions): void;
  /** Every route registered, with the audience it ended with. */
  rows(): readonly RouteAudienceRow[];
}

export function createRouteAudienceRegistry(): RouteAudienceRegistry {
  const routes: RouteOptions[] = [];
  return {
    record(route) {
      if (audienceOf(route.config) === null && runsSignedInGuard(route.preHandler)) {
        route.config = { ...route.config, audience: 'staff' };
      }
      // Held, not copied: a scope's own tag is set by a later `onRoute` hook of
      // the same route, and is read from here when asked.
      routes.push(route);
    },
    rows() {
      return routes.flatMap((route) =>
        (Array.isArray(route.method) ? route.method : [route.method]).map((method) => ({ method, url: route.url, audience: audienceOf(route.config) })),
      );
    },
  };
}
