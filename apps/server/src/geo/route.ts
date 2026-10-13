// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The way between stops: how far each leg is, and, where a routing server is
 * switched on, how long it takes by road.
 *
 * OUT OF THE BOX every leg is a straight line over the globe: a distance, no
 * time, and marked an estimate. Nothing leaves the server.
 *
 * WITH ROUTING ON (`maps.routing`, and nothing above it saying no:
 * `geo/map-policy.ts`) the server asks the routing server, an OSRM, for the
 * road route. What is sent is the ordered positions of the stops and nothing
 * else: no name, no row, no person. It is asked:
 *
 *  - once for one set of stops (the answer is kept a day, a few hundred sets:
 *    its line no finer than a map draws, and no more points in all than
 *    {@link ROUTE_KEPT_POINTS});
 *  - at most once a second for the whole process, in turn. A caller who would
 *    wait longer than {@link ROUTE_WAIT_MS} is given the straight answer now,
 *    and so is one person's ask while {@link ROUTE_WAITING_EACH} of theirs
 *    already wait: the turns are everybody's;
 *  - behind the guard a webhook's address goes through, with a time limit
 *    and a size limit on the reply.
 *
 * ANY failure is the straight answer with `fellBack`. What the routing server
 * said is never passed on: its words are another program's, and a caller of
 * this route is told only that the roads could not be asked.
 *
 * A leg between two stops known only as the SAME TOWN has no length anybody
 * can honestly give: it is `unknown`, never 0, whoever answers.
 */
import { guardOutboundUrl } from '../connections/dsn.js';
import type { MapState } from './map-policy.js';

export interface RouteStop {
  lat: number;
  lng: number;
  by?: 'town' | 'exact' | undefined;
  placeId?: number | undefined;
}

export interface RouteLeg {
  /** Metres; null when unknown. */
  distanceM: number | null;
  /** Seconds by road; null for a straight leg and an unknown one. */
  durationS: number | null;
  /** A straight line, or a road route from or to the middle of a town: not a measured journey. */
  estimate: boolean;
  /** Both ends are known only as the same town. */
  unknown?: true;
}

export interface RouteAnswer {
  source: 'straight' | 'server';
  /** The routing server was to be asked and could not be: these legs are straight lines. */
  fellBack?: true;
  /** One for each pair of stops next to each other. */
  legs: RouteLeg[];
  /** The road route, from the routing server only. */
  line?: { type: 'LineString'; coordinates: [number, number][] };
}

export const ROUTE_STOPS_MAX = 50;
export const ROUTE_SPACING_MS = 1_000;
export const ROUTE_WAIT_MS = 10_000;
export const ROUTE_TIMEOUT_MS = 8_000;
export const ROUTE_REPLY_MAX_BYTES = 2 * 1024 * 1024;
export const ROUTE_KEPT = 300;
export const ROUTE_KEPT_MS = 24 * 60 * 60 * 1000;
/** The most points kept of one route's line: a longer one is thinned evenly. */
export const ROUTE_LINE_MAX_POINTS = 5_000;
/** The most points kept in all the answers together: the oldest go first. */
export const ROUTE_KEPT_POINTS = 300_000;
/** How many of one person's asks may wait their turn at once. */
export const ROUTE_WAITING_EACH = 3;

const EARTH_RADIUS_M = 6_371_008.8;

/** The length of the shortest line over the globe between two points, in metres. */
export function straightMetres(a: Pick<RouteStop, 'lat' | 'lng'>, b: Pick<RouteStop, 'lat' | 'lng'>): number {
  const rad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** Two stops known only as one town: by the town's id where both carry it, else by the very same point. */
export function sameTown(a: RouteStop, b: RouteStop): boolean {
  if (a.by !== 'town' || b.by !== 'town') return false;
  if (a.placeId !== undefined && b.placeId !== undefined) return a.placeId === b.placeId;
  return a.lat === b.lat && a.lng === b.lng;
}

const UNKNOWN_LEG: RouteLeg = { distanceM: null, durationS: null, estimate: true, unknown: true };

export function straightRoute(stops: readonly RouteStop[]): RouteAnswer {
  const legs: RouteLeg[] = [];
  for (let at = 1; at < stops.length; at += 1) {
    const from = stops[at - 1] as RouteStop;
    const to = stops[at] as RouteStop;
    legs.push(sameTown(from, to) ? { ...UNKNOWN_LEG } : { distanceM: straightMetres(from, to), durationS: null, estimate: true });
  }
  return { source: 'straight', legs };
}

/** What is kept of a routing server's answer: nothing but numbers. */
interface Roads {
  legs: { distanceM: number; durationS: number }[];
  line: [number, number][];
}

export interface RouterOptions {
  /** Whether routing is on, and where the routing server is (`MapPolicy.read`). */
  state: () => Promise<MapState>;
  /** Refuse a routing server on this machine (production). */
  blockLoopback: boolean;
  fetch?: typeof globalThis.fetch | undefined;
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  spacingMs?: number | undefined;
  waitMs?: number | undefined;
  timeoutMs?: number | undefined;
  maxBytes?: number | undefined;
}

export interface Router {
  /** `by` is who asks (a person's or a key's id): one of them never holds every turn. */
  route(stops: readonly RouteStop[], by?: string): Promise<RouteAnswer>;
}

/** A line of at most `max` points: the first, the last, and the others taken evenly between them. */
export function thinned(line: [number, number][], max: number = ROUTE_LINE_MAX_POINTS): [number, number][] {
  if (line.length <= max) return line;
  const out: [number, number][] = [];
  for (let at = 0; at < max; at += 1) out.push(line[Math.round((at * (line.length - 1)) / (max - 1))] as [number, number]);
  return out;
}

/** Five decimals is about a metre: two asks a hair apart are one ask. */
function coordinates(stops: readonly RouteStop[]): string {
  return stops.map((stop) => `${stop.lng.toFixed(5)},${stop.lat.toFixed(5)}`).join(';');
}

/** The reply as text, or null once it is longer than `maxBytes`: the rest is never read. */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** An OSRM `route` reply as the numbers kept of it, or null when it is not one for these stops. */
function roadsOf(text: string, legCount: number): Roads | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const route = (body as { code?: unknown; routes?: unknown[] } | null)?.code === 'Ok' ? (body as { routes?: unknown[] }).routes?.[0] : undefined;
  if (typeof route !== 'object' || route === null) return null;
  const { legs, geometry } = route as { legs?: unknown; geometry?: { type?: unknown; coordinates?: unknown } };
  if (!Array.isArray(legs) || legs.length !== legCount) return null;
  const out: Roads['legs'] = [];
  for (const leg of legs as { distance?: unknown; duration?: unknown }[]) {
    if (typeof leg?.distance !== 'number' || typeof leg.duration !== 'number' || !Number.isFinite(leg.distance) || !Number.isFinite(leg.duration) || leg.distance < 0 || leg.duration < 0) return null;
    out.push({ distanceM: Math.round(leg.distance), durationS: Math.round(leg.duration) });
  }
  if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) return null;
  const line: [number, number][] = [];
  for (const position of geometry.coordinates as unknown[]) {
    if (!Array.isArray(position) || typeof position[0] !== 'number' || typeof position[1] !== 'number' || Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) return null;
    line.push([position[0], position[1]]);
  }
  return { legs: out, line: thinned(line) };
}

export function createRouter(opts: RouterOptions): Router {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const spacingMs = opts.spacingMs ?? ROUTE_SPACING_MS;
  const waitMs = opts.waitMs ?? ROUTE_WAIT_MS;
  const timeoutMs = opts.timeoutMs ?? ROUTE_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? ROUTE_REPLY_MAX_BYTES;
  /** Kept answers, oldest first, and the asks still on their way: two asks for one set of stops are one request. */
  const kept = new Map<string, { at: number; roads: Roads }>();
  const asking = new Map<string, Promise<Roads | null>>();
  /** How many points the kept answers hold together. */
  let keptPoints = 0;
  /** How many asks of each person's are waiting their turn. */
  const waiting = new Map<string, number>();
  /** When the next request may leave. */
  let nextSlot = 0;

  function forget(key: string): void {
    keptPoints -= kept.get(key)?.roads.line.length ?? 0;
    kept.delete(key);
  }

  function keep(key: string, roads: Roads): void {
    forget(key);
    kept.set(key, { at: now(), roads });
    keptPoints += roads.line.length;
    // The newest is never the one let go: an answer just paid for is there for the ask that follows it.
    while (kept.size > 1 && (kept.size > ROUTE_KEPT || keptPoints > ROUTE_KEPT_POINTS)) forget(kept.keys().next().value as string);
  }

  async function ask(server: string, path: string): Promise<Roads | null> {
    // `simplified`: the line as a map draws it, not every bend the road data holds.
    const url = `${server}/route/v1/driving/${path}?overview=simplified&geometries=geojson`;
    try {
      guardOutboundUrl(url, { blockLoopback: opts.blockLoopback });
    } catch {
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      // A redirect is not followed: the address asked is the one the operator named.
      const response = await (opts.fetch ?? globalThis.fetch)(url, { signal: controller.signal, redirect: 'manual', headers: { accept: 'application/json' } });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const text = await readCapped(response, maxBytes);
      return text === null ? null : roadsOf(text, path.split(';').length - 1);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The roads for these stops: kept, on their way, or asked in turn. Null when they cannot be had, or not soon enough. */
  async function roadsFor(server: string, stops: readonly RouteStop[], by: string | undefined): Promise<Roads | null> {
    const path = coordinates(stops);
    const key = `${server} ${path}`;
    const held = kept.get(key);
    if (held !== undefined) {
      if (now() - held.at < ROUTE_KEPT_MS) return held.roads;
      forget(key);
    }
    const underWay = asking.get(key);
    if (underWay !== undefined) return underWay;
    const wait = Math.max(0, nextSlot - now());
    if (wait > waitMs) return null;
    // One person's asks hold a few turns and no more: thirty of them would be ten seconds of everybody's.
    const queued = wait > 0 && by !== undefined;
    if (queued && (waiting.get(by) ?? 0) >= ROUTE_WAITING_EACH) return null;
    nextSlot = Math.max(now(), nextSlot) + spacingMs;
    if (queued) waiting.set(by, (waiting.get(by) ?? 0) + 1);
    const asked = (async (): Promise<Roads | null> => {
      if (wait > 0) {
        try {
          await sleep(wait);
        } finally {
          if (queued) {
            const left = (waiting.get(by) ?? 1) - 1;
            if (left > 0) waiting.set(by, left);
            else waiting.delete(by);
          }
        }
      }
      const roads = await ask(server, path);
      if (roads !== null) keep(key, roads);
      return roads;
    })().finally(() => asking.delete(key));
    asking.set(key, asked);
    return asked;
  }

  return {
    async route(stops, by) {
      const straight = straightRoute(stops);
      const state = await opts.state().catch(() => null);
      if (state === null || !state.routing || state.routingServer === null) return straight;
      // Stops that are all one town have no road between them worth asking for.
      if (straight.legs.every((leg) => leg.unknown === true)) return straight;
      const roads = await roadsFor(state.routingServer, stops, by);
      if (roads === null) return { ...straight, fellBack: true };
      const legs = roads.legs.map((leg, at): RouteLeg => {
        const from = stops[at] as RouteStop;
        const to = stops[at + 1] as RouteStop;
        if (sameTown(from, to)) return { ...UNKNOWN_LEG };
        return { distanceM: leg.distanceM, durationS: leg.durationS, estimate: from.by === 'town' || to.by === 'town' };
      });
      return { source: 'server', legs, line: { type: 'LineString', coordinates: roads.line } };
    },
  };
}
