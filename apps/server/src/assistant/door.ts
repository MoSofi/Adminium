// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The door: the ONE place the assistant sends a request to this server's own
 * routes, as the person who is signed in.
 *
 * A proposal is tried, and later carried out, by the same routes the screens
 * use, with the person's own session. So everything a route refuses (a right,
 * a column limit, a required field, a state the row may not move to) is
 * refused here in the route's own words, and nothing is decided twice.
 *
 * What keeps it narrow:
 *
 * - THE ADDRESS IS BUILT, NEVER TAKEN. A request goes to one of the routes
 *   listed in {@link DOOR_ROUTES}, chosen by name. Its path is that route's
 *   pattern with each `:param` filled by a value the caller resolved on the
 *   server; a segment that could change the path is refused before anything
 *   is sent.
 * - EVERY REQUEST CARRIES A TICKET THAT NAMES ITS ROUTE. A ticket is made for
 *   one request, names the method and the route pattern it is for and the
 *   person it is for, and is gone when the request returns. A request that
 *   carries a ticket and matched any other route, or carries the header with
 *   no ticket behind it, is refused.
 * - IT SIGNS NOBODY IN. It forwards the person's own cookie and never an
 *   `authorization` header; a caller with no session cookie cannot use it.
 *
 * Browser-only headers (`origin`, `referer`, `sec-fetch-*`) are not
 * forwarded: the outer request already passed the cross-site check, and an
 * inner one that looked like a browser's and carried no token would fail it.
 */
import { randomBytes } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { ForbiddenError } from '../errors.js';
import { getPrincipal } from '../rbac/principal.js';

export const DOOR_HEADER = 'x-adminium-via';

/** The prefix every API route is registered under. */
const API = '/api/v1';

/**
 * Every route the door may reach, as data. A test lists the server's routes
 * and holds this table against them: each entry exists, and none is a route
 * that hands out rights, keys, settings or connections.
 */
export const DOOR_ROUTES = {
  'row.read': { method: 'GET', url: `${API}/data/:connectionId/:table/:recordId`, query: '' },
  'row.create.try': { method: 'POST', url: `${API}/data/:connectionId/:table/dry-run`, query: '' },
  'row.change.try': { method: 'POST', url: `${API}/data/:connectionId/:table/:recordId/dry-run`, query: '' },
  'row.delete.try': { method: 'DELETE', url: `${API}/data/:connectionId/:table/:recordId`, query: 'dryRun=true' },
  'row.create': { method: 'POST', url: `${API}/data/:connectionId/:table`, query: '' },
  'row.change': { method: 'PATCH', url: `${API}/data/:connectionId/:table/:recordId`, query: '' },
} as const satisfies Record<string, { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; query: string }>;
export type DoorRouteKey = keyof typeof DOOR_ROUTES;

/** What a ticket says a request is for. */
export interface DoorTicket {
  userId: string;
  sessionId: string;
  turnId: string;
  method: string;
  /** The route PATTERN, as Fastify matched it. */
  route: string;
}

/** Thrown before anything is sent: the request could not be built safely. */
export class DoorRefusedError extends Error {
  constructor(
    readonly code: 'UNSAFE_KEY' | 'NO_SESSION',
    message: string,
  ) {
    super(message);
    this.name = 'DoorRefusedError';
  }
}

/**
 * Whether one value may stand as a path segment. Refused: an empty one, the
 * two that climb (`.`, `..`), and anything holding a character that ends or
 * re-reads a path.
 */
export function isSafeSegment(value: string): boolean {
  if (value === '' || value === '.' || value === '..' || value.length > 512) return false;
  // eslint-disable-next-line no-control-regex
  return !/[/\\?#%\u0000-\u001f\u007f]/.test(value);
}

/** The path of one listed route with its params filled. Throws for a segment that is not safe. */
export function doorPath(route: DoorRouteKey, params: Record<string, string>): string {
  const listed = DOOR_ROUTES[route];
  const path = listed.url.replace(/:([A-Za-z]+)/g, (_marker, name: string) => {
    const value = params[name];
    if (value === undefined || !isSafeSegment(value)) {
      throw new DoorRefusedError('UNSAFE_KEY', `That ${name === 'recordId' ? 'record id' : name} cannot be used in an address.`);
    }
    return encodeURIComponent(value);
  });
  return listed.query === '' ? path : `${path}?${listed.query}`;
}

export interface DoorRequest {
  route: DoorRouteKey;
  params: Record<string, string>;
  payload?: Record<string, unknown>;
  /** The conversation this request is made for; kept on its ticket. */
  sessionId: string;
  turnId: string;
}

export interface DoorReply {
  status: number;
  body: unknown;
}

export interface Door {
  /** Send one listed request as the person behind `request`. */
  replay: (request: FastifyRequest, target: DoorRequest) => Promise<DoorReply>;
}

declare module 'fastify' {
  interface FastifyInstance {
    assistantDoor: Door;
  }
  interface FastifyRequest {
    /** Set when this request came through the door: the conversation it was made for. */
    assistantVia: { sessionId: string; turnId: string } | null;
  }
}

const FORWARDED = ['user-agent', 'accept-language', 'host'] as const;

/**
 * Registered before any route scope exists, so its hook reaches every route
 * the server has: a ticket's request is checked wherever it lands.
 */
export const assistantDoorPlugin = fp(
  async (app: FastifyInstance) => {
    const tickets = new Map<string, DoorTicket>();

    app.decorateRequest('assistantVia', null);

    app.addHook('onRequest', async (request) => {
      const header = request.headers[DOOR_HEADER];
      if (header === undefined) return;
      const ticket = typeof header === 'string' ? tickets.get(header) : undefined;
      // The header with no ticket behind it is refused, never passed on unmarked: nothing
      // outside this process can hold one.
      if (ticket === undefined) throw new ForbiddenError('That request cannot be made this way.', 'FORBIDDEN', { reason: 'via-unknown' });
      if (request.method !== ticket.method || request.routeOptions.url !== ticket.route) {
        request.log.warn({ route: request.routeOptions.url, method: request.method, for: ticket.route }, 'assistant door: a ticket arrived at another route');
        throw new ForbiddenError('That request cannot be made this way.', 'FORBIDDEN', { reason: 'via-route' });
      }
      const principal = getPrincipal(request);
      if (principal === null || principal.kind !== 'user' || principal.id !== ticket.userId) {
        throw new ForbiddenError('That request cannot be made this way.', 'FORBIDDEN', { reason: 'via-person' });
      }
      request.assistantVia = { sessionId: ticket.sessionId, turnId: ticket.turnId };
    });

    const replay: Door['replay'] = async (request, target) => {
      const principal = getPrincipal(request);
      const cookie = request.headers.cookie;
      // A person's session, and nothing else: a key has no cookie, and none is made for it.
      if (principal === null || principal.kind !== 'user' || typeof cookie !== 'string' || cookie === '') {
        throw new DoorRefusedError('NO_SESSION', 'This needs a signed-in person.');
      }
      const listed = DOOR_ROUTES[target.route];
      const url = doorPath(target.route, target.params);
      const ticket = randomBytes(24).toString('base64url');
      tickets.set(ticket, { userId: principal.id, sessionId: target.sessionId, turnId: target.turnId, method: listed.method, route: listed.url });
      try {
        const headers: Record<string, string> = { cookie, [DOOR_HEADER]: ticket };
        for (const name of FORWARDED) {
          const value = request.headers[name];
          if (typeof value === 'string' && value !== '') headers[name] = value;
        }
        const res = await app.inject({
          method: listed.method,
          url,
          headers,
          remoteAddress: request.ip,
          ...(target.payload === undefined ? {} : { payload: target.payload }),
        });
        let body: unknown = null;
        try {
          body = res.body === '' ? null : (JSON.parse(res.body) as unknown);
        } catch {
          body = null;
        }
        return { status: res.statusCode, body };
      } finally {
        // No clock: the ticket lives exactly as long as its one request.
        tickets.delete(ticket);
      }
    };

    app.decorate('assistantDoor', { replay });
  },
  { name: 'assistant-door' },
);
