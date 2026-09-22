// SPDX-License-Identifier: AGPL-3.0-only
/** Shared test helpers (not collected by vitest — no .test suffix). */
import type { InjectOptions } from 'fastify';

import { envSchema, type Env } from '../src/config/env.js';

export const TEST_SECRET = 'a-sufficiently-long-dev-secret';

/** Parses a minimal valid environment, without touching process.env. */
export function makeEnv(overrides: Record<string, string> = {}): Env {
  return envSchema.parse({ ADMINIUM_SECRET: TEST_SECRET, ...overrides });
}

export const REQUEST_ID_PATTERN = /^req_[0-9a-f]{8}$/;

/**
 * The body accepted by `app.inject({ payload })`, re-derived from Fastify's own
 * option type (`light-my-request` is not a declared dependency here, so its
 * `InjectPayload` cannot be imported directly).
 *
 * Helpers that post deliberately-malformed bodies want this rather than
 * `unknown`: `unknown` fails to satisfy `payload`, and a failed argument check
 * makes TypeScript abandon overload resolution on `inject` and fall back to the
 * intersection of all three return types, so every `.statusCode`/`.json()` on
 * the result errors too. Bad input that is not an object goes through as a
 * string (`'null'`, `'[]'`) — the route parses it the same way.
 */
export type InjectPayload = NonNullable<InjectOptions['payload']>;

/** The two router methods `routeTable` reads; any Fastify instance has them. */
interface PrintedRouter {
  printRoutes(opts: { commonPrefix: true }): string;
  hasRoute(opts: { method: string; url: string }): boolean;
}

/**
 * Every route the server registered, as `path → methods`, read from its own
 * tree: the registration list, not a hand-written one.
 *
 * `printRoutes` prints the router's radix tree, one node per line, each
 * showing only the characters it adds to its parent and bare when no route
 * ends there:
 *
 *   │   ├── files (POST, GET, HEAD)
 *   │   │   └── /
 *   │   │       └── :id (GET, HEAD, PATCH, DELETE)     /api/v1/files/:id
 *   ...
 *   │   │   │   ├── session (GET, HEAD)
 *   │   │   │   │   └── s (GET, HEAD)                  /api/v1/auth/sessions
 *
 * So a path is every ancestor's fragment joined, the ancestors found from the
 * indentation (four columns per level). Reading each line as a whole path is
 * how `public-api-isolation` came to reach 119 of 324 routes (2026-09) and
 * still pass.
 *
 * `commonPrefix: true`, deliberately. `false` folds each bare node into the
 * next line down, which reads better, but find-my-way 9 folds a WILDCARD by
 * dropping what it would have folded: `/add-ons/:key/bundle/*` prints as a
 * bare `*` under `/add-ons/:key`, and no reading of that output recovers it.
 * A parameter that routes named differently still prints as `:key|:id`,
 * which `hasRoute` accepts as is (it ignores names).
 *
 * Nothing here is trusted. A line that does not parse throws, and so does a
 * rebuilt path the router does not hold: a parse that quietly skips or
 * misplaces a route is the failure this exists to end.
 */
export function routeTable(app: PrintedRouter): Map<string, Set<string>> {
  const table = new Map<string, Set<string>>();
  const stack: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: true }).split('\n')) {
    if (line === '') continue;
    const match = /^((?:│ {3}| {4})*)(?:├── |└── )(\S+)(?: \(([A-Z, ]+)\))?$/.exec(line);
    if (match === null) throw new Error(`routeTable cannot read this line of printRoutes: ${line}`);
    const [, indent = '', fragment = '', list] = match;
    const depth = indent.length / 4;
    if (depth > stack.length) throw new Error(`routeTable found no parent for: ${line}`);
    stack.length = depth;
    const url = `${stack[depth - 1] ?? ''}${fragment}`;
    stack.push(url);
    if (list === undefined) continue; // a bare node: no route ends here

    const methods = list.split(', ');
    for (const method of methods) {
      if (!app.hasRoute({ method, url })) {
        throw new Error(`routeTable rebuilt ${method} ${url}, which the router does not hold`);
      }
    }
    table.set(url, new Set([...(table.get(url) ?? []), ...methods]));
  }
  return table;
}

/**
 * A `routeTable` path as a URL: every parameter (`:id`, `:key|:id`) and a
 * trailing wildcard filled with `fill`, which should match no row.
 */
export function concreteUrl(path: string, fill: string): string {
  return path.replace(/:[^/]+|\*$/g, fill);
}
