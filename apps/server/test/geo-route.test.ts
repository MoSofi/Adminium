// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The way between stops. Out of the box: straight legs, marked estimates,
 * and NOTHING leaves the server (asserted with the recorder the telemetry
 * suite uses: every way out is replaced by one that records and throws).
 * With routing switched on: the routing server is asked once for one set of
 * stops, in turn, and anything it gets wrong is the straight answer.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

import { settingsRepo } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { MapState } from '../src/geo/map-policy.js';
import { createRouter, ROUTE_KEPT_MS, ROUTE_KEPT_POINTS, ROUTE_LINE_MAX_POINTS, ROUTE_WAITING_EACH, sameTown, straightMetres, straightRoute, type RouteAnswer, type RouteStop } from '../src/geo/route.js';
import { RATE_BUCKETS } from '../src/plugins/core.js';
import { geoServer, type GeoServer } from './geo.helpers.js';

// ─── Network kill-switch (mirrors telemetry-network-isolation.test.ts) ─────────

interface NetGuard {
  attempts: string[];
  restore: () => void;
}

function describeTarget(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof URL) return arg.href;
  if (arg !== null && typeof arg === 'object') {
    const req = arg as { url?: unknown; host?: unknown; hostname?: unknown; port?: unknown };
    if (typeof req.url === 'string') return req.url;
    const host = req.hostname ?? req.host;
    if (typeof host === 'string') return `${host}${req.port === undefined ? '' : `:${String(req.port)}`}`;
  }
  return '<unknown>';
}

function disableNetwork(): NetGuard {
  const attempts: string[] = [];
  const thrower =
    (label: string) =>
    (...args: unknown[]): never => {
      const target = describeTarget(args[0]);
      attempts.push(`${label} → ${target}`);
      throw new Error(`network disabled (routing is off): blocked ${label} to ${target}`);
    };
  const g = globalThis as { fetch: typeof globalThis.fetch };
  const originalFetch = g.fetch;
  const netMod = net as unknown as Record<string, unknown>;
  const httpMod = http as unknown as Record<string, unknown>;
  const httpsMod = https as unknown as Record<string, unknown>;
  const originals = { connect: netMod.connect, createConnection: netMod.createConnection, socketConnect: net.Socket.prototype.connect, httpRequest: httpMod.request, httpsRequest: httpsMod.request };
  g.fetch = thrower('fetch') as unknown as typeof globalThis.fetch;
  netMod.connect = thrower('net.connect');
  netMod.createConnection = thrower('net.createConnection');
  (net.Socket.prototype as unknown as { connect: unknown }).connect = thrower('socket.connect');
  httpMod.request = thrower('http.request');
  httpsMod.request = thrower('https.request');
  return {
    attempts,
    restore: () => {
      g.fetch = originalFetch;
      netMod.connect = originals.connect;
      netMod.createConnection = originals.createConnection;
      (net.Socket.prototype as unknown as { connect: unknown }).connect = originals.socketConnect;
      httpMod.request = originals.httpRequest;
      httpsMod.request = originals.httpsRequest;
    },
  };
}

// ─── A routing server that answers as an OSRM does ─────────────────────────────

type Mode = 'ok' | 'error' | 'slow' | 'huge' | 'nonsense' | 'no-route' | 'redirect';

interface Stub {
  origin: string;
  /** Each request: when it arrived and what it asked. */
  hits: { at: number; url: string }[];
  mode: Mode;
  close: () => Promise<void>;
}

/** An OSRM reply for a path of `lng,lat;lng,lat`: 1,000 m and 60 s a leg, a line through the stops. */
function osrmReply(path: string): string {
  const points = path.split(';').map((pair) => pair.split(',').map(Number) as [number, number]);
  return JSON.stringify({
    code: 'Ok',
    routes: [{ distance: 1000 * (points.length - 1), duration: 60 * (points.length - 1), geometry: { type: 'LineString', coordinates: points }, legs: points.slice(1).map((_, at) => ({ distance: 1000.4 + at, duration: 60.2 + at, steps: [] })) }],
    waypoints: [],
  });
}

async function startStub(): Promise<Stub> {
  const stub: Stub = { origin: '', hits: [], mode: 'ok', close: async () => undefined };
  const server = http.createServer((req, res) => {
    stub.hits.push({ at: Date.now(), url: req.url ?? '' });
    const path = decodeURIComponent((req.url ?? '').split('?')[0]!.replace('/route/v1/driving/', ''));
    if (stub.mode === 'error') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('SECRET-ROUTER-ERROR: database password is hunter2');
    } else if (stub.mode === 'no-route') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'NoRoute', message: 'SECRET-ROUTER-ERROR impossible route' }));
    } else if (stub.mode === 'slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(osrmReply(path));
      }, 1_500).unref();
    } else if (stub.mode === 'huge') {
      res.writeHead(200, { 'content-type': 'application/json' });
      // No length declared, so the limit is found while reading.
      res.write(`{"code":"Ok","padding":"${'x'.repeat(256 * 1024)}`);
      res.end(`${'y'.repeat(256 * 1024)}"}`);
    } else if (stub.mode === 'nonsense') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'Ok', routes: [{ legs: [{ distance: 'far', duration: 1 }], geometry: { type: 'LineString', coordinates: [] } }] }));
    } else if (stub.mode === 'redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere' });
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(osrmReply(path));
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  stub.origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  stub.close = () =>
    new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    });
  return stub;
}

const CAIRO: RouteStop = { lat: 30.06263, lng: 31.24967, by: 'town', placeId: 360630 };
const ALEXANDRIA: RouteStop = { lat: 31.20176, lng: 29.91582, by: 'town', placeId: 361058 };
const GIZA_GATE: RouteStop = { lat: 29.9773, lng: 31.1325, by: 'exact' };
const TAHRIR: RouteStop = { lat: 30.0444, lng: 31.2357, by: 'exact' };

describe('straight legs', () => {
  it('measures the line over the globe, in metres', () => {
    // One degree of latitude; a quarter of the way round the equator.
    expect(straightMetres({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBe(111_195);
    expect(straightMetres({ lat: 0, lng: 0 }, { lat: 0, lng: 90 })).toBe(10_007_557);
    // London to Paris is about 344 km; across the date line is short, not the long way round.
    expect(straightMetres({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 })).toBeGreaterThan(343_000);
    expect(straightMetres({ lat: 51.5074, lng: -0.1278 }, { lat: 48.8566, lng: 2.3522 })).toBeLessThan(344_500);
    expect(straightMetres({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 })).toBe(111_195);
    expect(straightMetres(CAIRO, CAIRO)).toBe(0);
  });

  it('gives each leg a distance, no time, and says it is an estimate', () => {
    const answer = straightRoute([CAIRO, ALEXANDRIA, GIZA_GATE]);
    expect(answer.source).toBe('straight');
    expect(answer.fellBack).toBeUndefined();
    expect(answer.line).toBeUndefined();
    expect(answer.legs).toEqual([
      { distanceM: straightMetres(CAIRO, ALEXANDRIA), durationS: null, estimate: true },
      { distanceM: straightMetres(ALEXANDRIA, GIZA_GATE), durationS: null, estimate: true },
    ]);
    expect(answer.legs[0]!.distanceM).toBeGreaterThan(175_000);
    expect(answer.legs[0]!.distanceM).toBeLessThan(185_000);
  });

  it('says a leg inside one town is unknown, never zero', () => {
    const other: RouteStop = { ...CAIRO };
    expect(sameTown(CAIRO, other)).toBe(true);
    expect(straightRoute([CAIRO, other, ALEXANDRIA]).legs).toEqual([
      { distanceM: null, durationS: null, estimate: true, unknown: true },
      { distanceM: straightMetres(CAIRO, ALEXANDRIA), durationS: null, estimate: true },
    ]);
    // Two exact points at one spot are zero apart; an exact point in a town is a real distance from its middle.
    expect(straightRoute([TAHRIR, { ...TAHRIR }]).legs).toEqual([{ distanceM: 0, durationS: null, estimate: true }]);
    expect(straightRoute([CAIRO, TAHRIR]).legs[0]).toMatchObject({ estimate: true });
    expect(straightRoute([CAIRO, TAHRIR]).legs[0]!.distanceM).toBeGreaterThan(1_000);
    // Towns without ids: the same only at the very same point.
    expect(sameTown({ lat: 1, lng: 2, by: 'town' }, { lat: 1, lng: 2, by: 'town' })).toBe(true);
    expect(sameTown({ lat: 1, lng: 2, by: 'town' }, { lat: 1, lng: 2.1, by: 'town' })).toBe(false);
    expect(sameTown({ lat: 1, lng: 2, by: 'town', placeId: 5 }, { lat: 1, lng: 2, by: 'town', placeId: 6 })).toBe(false);
  });
});

describe('asking the routing server', () => {
  const ON: MapState = { enabled: true, server: 'https://tiles.example.com', routing: true, routingServer: 'https://osrm.example.com' };
  const reply = (url: string): Response => new Response(osrmReply(decodeURIComponent(new URL(url).pathname.replace('/route/v1/driving/', ''))), { status: 200, headers: { 'content-type': 'application/json' } });

  /** A router on a clock the test moves: a sleep moves it, nothing waits. */
  function harness(over: { state?: MapState; blockLoopback?: boolean; fetch?: (url: string) => Promise<Response> } = {}) {
    let clock = 1_000_000;
    const asked: { at: number; url: string }[] = [];
    const router = createRouter({
      state: async () => over.state ?? ON,
      blockLoopback: over.blockLoopback ?? false,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetch: (async (input: unknown) => {
        const url = String(input);
        asked.push({ at: clock, url });
        return over.fetch === undefined ? reply(url) : over.fetch(url);
      }) as typeof globalThis.fetch,
    });
    return { router, asked, tick: (ms: number) => (clock += ms) };
  }

  it('asks an OSRM for the driving route, east first, and keeps its numbers only', async () => {
    const { router, asked } = harness();
    const answer = await router.route([TAHRIR, GIZA_GATE, ALEXANDRIA]);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.url).toBe('https://osrm.example.com/route/v1/driving/31.23570,30.04440;31.13250,29.97730;29.91582,31.20176?overview=simplified&geometries=geojson');
    expect(answer).toEqual({
      source: 'server',
      legs: [
        { distanceM: 1000, durationS: 60, estimate: false },
        // To the middle of a town: a road route, and still not a measured journey.
        { distanceM: 1001, durationS: 61, estimate: true },
      ],
      line: { type: 'LineString', coordinates: [[31.2357, 30.0444], [31.1325, 29.9773], [29.91582, 31.20176]] },
    });
  });

  it('asks once for one set of stops, for a day', async () => {
    const { router, asked, tick } = harness();
    const [first, second] = await Promise.all([router.route([TAHRIR, GIZA_GATE]), router.route([TAHRIR, GIZA_GATE])]);
    expect(asked).toHaveLength(1);
    expect(second).toEqual(first);
    await router.route([{ ...TAHRIR }, { ...GIZA_GATE }]);
    // A hair's difference in a position is the same ask; the other way round is another.
    await router.route([{ ...TAHRIR, lat: TAHRIR.lat + 0.000001 }, GIZA_GATE]);
    expect(asked).toHaveLength(1);
    await router.route([GIZA_GATE, TAHRIR]);
    expect(asked).toHaveLength(2);
    tick(ROUTE_KEPT_MS + 1);
    await router.route([TAHRIR, GIZA_GATE]);
    expect(asked).toHaveLength(3);
  });

  it('lets one request leave a second, in turn, and gives a caller who would wait too long the straight answer', async () => {
    // Fourteen asks in the same instant: the clock stands still, and each ask's wait is what is measured.
    const waits: number[] = [];
    const asked: string[] = [];
    const router = createRouter({
      state: async () => ON,
      blockLoopback: false,
      now: () => 5_000_000,
      sleep: async (ms) => {
        waits.push(ms);
      },
      fetch: (async (input: unknown) => {
        asked.push(String(input));
        return reply(String(input));
      }) as typeof globalThis.fetch,
    });
    const sets = Array.from({ length: 14 }, (_, at): RouteStop[] => [TAHRIR, { lat: 29 + at / 100, lng: 31, by: 'exact' }]);
    const answers = await Promise.all(sets.map((stops) => router.route(stops)));
    // The first leaves at once; ten more wait one to ten seconds, each a second after the one before; the rest would wait longer.
    expect(waits).toEqual([1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 10_000]);
    expect(answers.slice(0, 11).map((answer) => answer.source)).toEqual(Array.from({ length: 11 }, () => 'server'));
    for (const answer of answers.slice(11)) expect(answer).toMatchObject({ source: 'straight', fellBack: true, legs: [{ durationS: null, estimate: true }] });
    expect(asked).toHaveLength(11);
  });

  /** An OSRM reply whose line has `points` points, from the first stop to the last. */
  const longReply = (url: string, points: number): Response => {
    const stops = decodeURIComponent(new URL(url).pathname.replace('/route/v1/driving/', '')).split(';').map((pair) => pair.split(',').map(Number) as [number, number]);
    const [from, to] = [stops[0]!, stops[stops.length - 1]!];
    const coordinates = Array.from({ length: points }, (_, at): [number, number] => (at === 0 ? from : at === points - 1 ? to : [from[0] + ((to[0] - from[0]) * at) / (points - 1), from[1] + ((to[1] - from[1]) * at) / (points - 1)]));
    return new Response(JSON.stringify({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates }, legs: stops.slice(1).map(() => ({ distance: 1000, duration: 60 })) }] }), { status: 200 });
  };

  it('keeps a long line thinned evenly to its limit, from its first point to its last', async () => {
    const { router } = harness({ fetch: async (url) => longReply(url, 20_001) });
    const answer = await router.route([TAHRIR, GIZA_GATE]);
    const line = answer.line!.coordinates;
    expect(line).toHaveLength(ROUTE_LINE_MAX_POINTS);
    expect(ROUTE_LINE_MAX_POINTS).toBe(5_000);
    expect([line[0], line[line.length - 1]]).toEqual([[TAHRIR.lng, TAHRIR.lat], [GIZA_GATE.lng, GIZA_GATE.lat]]);
    // Evenly: no two kept points further apart along the line than any other two, give or take one of the points it was given.
    const step = Math.abs(GIZA_GATE.lat - TAHRIR.lat) / 20_000;
    const gaps = line.slice(1).map((point, at) => Math.round(Math.abs(point[1] - line[at]![1]) / step));
    expect([Math.min(...gaps), Math.max(...gaps)]).toEqual([4, 5]);
    // A line within the limit is kept as it came.
    const short = await harness({ fetch: async (url) => longReply(url, ROUTE_LINE_MAX_POINTS) }).router.route([TAHRIR, GIZA_GATE]);
    expect(short.line!.coordinates).toHaveLength(ROUTE_LINE_MAX_POINTS);
  });

  it('keeps no more points in all than its limit, letting the oldest answers go', async () => {
    expect(ROUTE_KEPT_POINTS).toBe(300_000);
    const { router, asked } = harness({ fetch: async (url) => longReply(url, ROUTE_LINE_MAX_POINTS) });
    const sets = Array.from({ length: 70 }, (_, at): RouteStop[] => [TAHRIR, { lat: 29 + at / 100, lng: 31, by: 'exact' }]);
    for (const stops of sets) await router.route(stops);
    expect(asked).toHaveLength(70);
    // Sixty answers of five thousand points are the limit: the last sixty are kept, the first ten are asked for again.
    for (const stops of sets.slice(10)) await router.route(stops);
    expect(asked).toHaveLength(70);
    await router.route(sets[0]!);
    expect(asked).toHaveLength(71);
  });

  it('lets one person have a few asks waiting their turn and no more, so the turns are left for everybody else', async () => {
    expect(ROUTE_WAITING_EACH).toBe(3);
    // A sleep the test ends: every ask that waits is still waiting while the others are made.
    const sleeping: (() => void)[] = [];
    const asked: string[] = [];
    const router = createRouter({
      state: async () => ON,
      blockLoopback: false,
      now: () => 5_000_000,
      sleep: () => new Promise<void>((done) => sleeping.push(done)),
      fetch: (async (input: unknown) => {
        asked.push(String(input));
        return reply(String(input));
      }) as typeof globalThis.fetch,
    });
    const stopsOf = (at: number): RouteStop[] => [TAHRIR, { lat: 29 + at / 100, lng: 31, by: 'exact' }];
    // Seven different asks of one person's in the same instant: one leaves at once, three wait, and the rest are answered straight NOW.
    const hers = Array.from({ length: 7 }, (_, at) => router.route(stopsOf(at), 'user_ava'));
    const refused = await Promise.all(hers.slice(4));
    for (const answer of refused) expect(answer).toMatchObject({ source: 'straight', fellBack: true });
    expect(sleeping).toHaveLength(3);
    // Somebody else still gets a turn, behind hers; and an ask of hers for stops already on their way waits with it, taking no turn.
    const his = router.route(stopsOf(20), 'user_noah');
    const same = router.route(stopsOf(1), 'user_ava');
    await new Promise<void>((done) => setImmediate(done));
    expect(sleeping).toHaveLength(4);
    // A turn of hers that has left frees a place for her next ask.
    sleeping[0]!();
    expect((await hers[1]!).source).toBe('server');
    const next = router.route(stopsOf(30), 'user_ava');
    await new Promise<void>((done) => setImmediate(done));
    expect(sleeping).toHaveLength(5);
    for (const done of sleeping) done();
    for (const answer of await Promise.all([...hers.slice(0, 4), his, same, next])) expect(answer.source).toBe('server');
    expect(asked).toHaveLength(6);
    // An ask that names nobody (the server's own) is held to the turns alone.
    const nobody = await Promise.all(Array.from({ length: 5 }, (_, at) => {
      const made = router.route(stopsOf(40 + at));
      setImmediate(() => sleeping.forEach((done) => done()));
      return made;
    }));
    expect(nobody.map((answer) => answer.source)).toEqual(Array.from({ length: 5 }, () => 'server'));
  });

  it('falls back to straight legs on anything the routing server gets wrong, and passes none of its words on', async () => {
    const failures: Record<string, (url: string) => Promise<Response>> = {
      'a 500': async () => new Response('SECRET-ROUTER-ERROR', { status: 500 }),
      'no route': async () => new Response(JSON.stringify({ code: 'NoRoute', message: 'SECRET-ROUTER-ERROR' }), { status: 400 }),
      'not JSON': async () => new Response('<html>SECRET-ROUTER-ERROR</html>', { status: 200 }),
      'the wrong number of legs': async () => new Response(osrmReply('1,1;2,2;3,3'), { status: 200 }),
      'a leg that is not a number': async () => new Response(JSON.stringify({ code: 'Ok', routes: [{ legs: [{ distance: 'SECRET-ROUTER-ERROR', duration: 1 }], geometry: { type: 'LineString', coordinates: [] } }] }), { status: 200 }),
      'a line off the map': async () => new Response(JSON.stringify({ code: 'Ok', routes: [{ legs: [{ distance: 1, duration: 1 }], geometry: { type: 'LineString', coordinates: [[500, 500]] } }] }), { status: 200 }),
      'a reply that says it is too long': async () => new Response('{}', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } }),
      'a thrown error': async () => {
        throw new Error('SECRET-ROUTER-ERROR getaddrinfo ENOTFOUND');
      },
    };
    for (const [name, fetch] of Object.entries(failures)) {
      const { router, asked } = harness({ fetch });
      const answer = await router.route([TAHRIR, GIZA_GATE]);
      expect(answer, name).toEqual({ source: 'straight', fellBack: true, legs: [{ distanceM: straightMetres(TAHRIR, GIZA_GATE), durationS: null, estimate: true }] });
      expect(JSON.stringify(answer), name).not.toContain('SECRET');
      expect(asked, name).toHaveLength(1);
    }
  });

  it('does not keep a failure: the next ask tries again', async () => {
    let fail = true;
    const { router, asked } = harness({ fetch: async (url) => (fail ? new Response('no', { status: 503 }) : reply(url)) });
    expect((await router.route([TAHRIR, GIZA_GATE])).fellBack).toBe(true);
    fail = false;
    expect((await router.route([TAHRIR, GIZA_GATE])).source).toBe('server');
    expect(asked).toHaveLength(2);
  });

  it('keeps a leg inside one town unknown, whatever the routing server says of it', async () => {
    const { router, asked } = harness();
    const answer = await router.route([CAIRO, { ...CAIRO }, ALEXANDRIA]);
    expect(answer.source).toBe('server');
    expect(answer.legs[0]).toEqual({ distanceM: null, durationS: null, estimate: true, unknown: true });
    expect(answer.legs[1]).toEqual({ distanceM: 1001, durationS: 61, estimate: true });
    // Stops that are all one town: there is nothing to ask.
    expect(await router.route([CAIRO, { ...CAIRO }])).toEqual({ source: 'straight', legs: [{ distanceM: null, durationS: null, estimate: true, unknown: true }] });
    expect(asked).toHaveLength(1);
  });

  it('asks nobody while routing is off, and never a server on this machine in production', async () => {
    for (const state of [{ ...ON, routing: false, routingServer: null }, { enabled: false, server: null, routing: false, routingServer: null }] as MapState[]) {
      const { router, asked } = harness({ state });
      expect(await router.route([TAHRIR, GIZA_GATE])).toEqual(straightRoute([TAHRIR, GIZA_GATE]));
      expect(asked).toHaveLength(0);
    }
    for (const routingServer of ['http://127.0.0.1:5000', 'http://localhost:5000', 'http://169.254.169.254']) {
      const { router, asked } = harness({ state: { ...ON, routingServer }, blockLoopback: true });
      expect(await router.route([TAHRIR, GIZA_GATE]), routingServer).toMatchObject({ source: 'straight', fellBack: true });
      expect(asked, routingServer).toHaveLength(0);
    }
  });
});

describe('POST /geo/route with routing off (as installed)', () => {
  let s: GeoServer;
  let guard: NetGuard | undefined;
  beforeAll(async () => {
    s = await geoServer();
  }, 60_000);
  afterEach(() => {
    guard?.restore();
    guard = undefined;
  });
  afterAll(async () => s.close());

  it('answers straight legs and makes no attempt to reach anything', async () => {
    guard = disableNetwork();
    const res = await s.server.app.inject({ method: 'POST', url: '/api/v1/geo/route', headers: s.write, payload: { stops: [CAIRO, ALEXANDRIA, { ...ALEXANDRIA }, TAHRIR] } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      data: {
        source: 'straight',
        legs: [
          { distanceM: straightMetres(CAIRO, ALEXANDRIA), durationS: null, estimate: true },
          { distanceM: null, durationS: null, estimate: true, unknown: true },
          { distanceM: straightMetres(ALEXANDRIA, TAHRIR), durationS: null, estimate: true },
        ],
      },
    });
    expect(Number(res.headers['x-ratelimit-limit'])).toBe(RATE_BUCKETS['geo-route'].max);
    expect(guard.attempts).toEqual([]);
  });

  it('takes two to fifty stops on the map, from somebody signed in', async () => {
    const call = (payload: unknown, headers: Record<string, string> = s.write) => s.server.app.inject({ method: 'POST', url: '/api/v1/geo/route', headers, payload: payload as never });
    expect((await call({ stops: [TAHRIR] })).statusCode).toBe(422);
    expect((await call({ stops: Array.from({ length: 51 }, () => TAHRIR) })).statusCode).toBe(422);
    expect((await call({ stops: Array.from({ length: 50 }, (_, at) => ({ lat: at / 10, lng: at / 10 })) })).statusCode).toBe(200);
    expect((await call({ stops: [TAHRIR, { lat: 91, lng: 0 }] })).statusCode).toBe(422);
    expect((await call({ stops: [TAHRIR, { lat: 0, lng: 181 }] })).statusCode).toBe(422);
    expect((await call({ stops: [TAHRIR, { lat: 0, lng: 0, by: 'guess' }] })).statusCode).toBe(422);
    expect((await call({ stops: [TAHRIR, { lat: 0, lng: 0, url: 'https://evil.example.com' }] })).statusCode).toBe(422);
    expect((await call({ stops: [TAHRIR, GIZA_GATE], server: 'https://evil.example.com' })).statusCode).toBe(422);
    expect((await call({ stops: [TAHRIR, GIZA_GATE] }, {})).statusCode).toBe(401);
  });
});

describe('POST /geo/route with routing switched on', () => {
  let stub: Stub;
  let s: GeoServer;
  const ask = async (stops: RouteStop[]) => {
    const res = await s.server.app.inject({ method: 'POST', url: '/api/v1/geo/route', headers: s.write, payload: { stops } });
    expect(res.statusCode, res.body).toBe(200);
    return { body: res.body, data: (res.json() as { data: RouteAnswer }).data };
  };

  beforeAll(async () => {
    stub = await startStub();
    s = await geoServer({ ADMINIUM_ROUTING_SERVER: stub.origin });
    const on = await s.server.app.inject({ method: 'PUT', url: '/api/v1/settings/maps', headers: s.write, payload: { routing: true } });
    expect(on.statusCode, on.body).toBe(200);
    expect((on.json() as { data: { routing: boolean; routingServer: string } }).data).toMatchObject({ routing: true, routingServer: stub.origin });
  }, 60_000);
  afterAll(async () => {
    await s.close();
    await stub.close();
  });

  it('asks the routing server once for two identical asks, and a second apart for different ones', async () => {
    stub.mode = 'ok';
    const first = await ask([TAHRIR, GIZA_GATE]);
    expect(first.data).toEqual({ source: 'server', legs: [{ distanceM: 1000, durationS: 60, estimate: false }], line: { type: 'LineString', coordinates: [[31.2357, 30.0444], [31.1325, 29.9773]] } });
    const again = await ask([TAHRIR, GIZA_GATE]);
    expect(again.data).toEqual(first.data);
    expect(stub.hits).toHaveLength(1);
    expect(stub.hits[0]!.url).toBe('/route/v1/driving/31.23570,30.04440;31.13250,29.97730?overview=simplified&geometries=geojson');

    const other = await ask([GIZA_GATE, TAHRIR]);
    expect(other.data.source).toBe('server');
    expect(stub.hits).toHaveLength(2);
    // One a second for the whole process (a little slack for the timer).
    expect(stub.hits[1]!.at - stub.hits[0]!.at).toBeGreaterThanOrEqual(950);
  }, 20_000);

  it('answers one person’s fifth and sixth ask at once with straight legs while four of theirs are under way', async () => {
    stub.mode = 'ok';
    // Past the turn the test before took, so the first of these leaves at once.
    await new Promise((done) => setTimeout(done, 1_100));
    const before = stub.hits.length;
    const started = Date.now();
    const took: number[] = [];
    const answers = await Promise.all(
      Array.from({ length: 6 }, async (_, at) => {
        const { data } = await ask([TAHRIR, { lat: 27 + at / 100, lng: 31, by: 'exact' }]);
        took[at] = Date.now() - started;
        return data;
      }),
    );
    const straight = answers.flatMap((answer, at) => (answer.source === 'straight' ? [at] : []));
    expect(straight).toHaveLength(2);
    for (const at of straight) {
      expect(answers[at]).toMatchObject({ fellBack: true, legs: [{ durationS: null, estimate: true }] });
      // At once: not after the ten seconds a turn is waited for.
      expect(took[at]).toBeLessThan(900);
    }
    expect(stub.hits.length).toBe(before + 4);
  }, 20_000);

  it('falls back when the routing server fails, and says nothing of what it said', async () => {
    for (const mode of ['error', 'no-route', 'huge', 'nonsense', 'redirect'] as const) {
      stub.mode = mode;
      const before = stub.hits.length;
      const stops = [TAHRIR, { lat: 29.5 + before / 1000, lng: 31, by: 'exact' as const }];
      const { body, data } = await ask(stops);
      expect(data, mode).toEqual({ source: 'straight', fellBack: true, legs: [{ distanceM: straightMetres(stops[0]!, stops[1]!), durationS: null, estimate: true }] });
      expect(body, mode).not.toContain('SECRET');
      expect(body, mode).not.toContain('hunter2');
      expect(stub.hits.length, mode).toBe(before + 1);
    }
  }, 40_000);

  it('stops asking when the switch goes off, and when maps do', async () => {
    stub.mode = 'ok';
    const before = stub.hits.length;
    await s.server.app.inject({ method: 'PUT', url: '/api/v1/settings/maps', headers: s.write, payload: { routing: false } });
    expect((await ask([TAHRIR, { lat: 28, lng: 31 }])).data).toMatchObject({ source: 'straight' });
    expect((await ask([TAHRIR, { lat: 28, lng: 31 }])).data.fellBack).toBeUndefined();
    await s.server.app.inject({ method: 'PUT', url: '/api/v1/settings/maps', headers: s.write, payload: { routing: true, enabled: false } });
    expect((await ask([TAHRIR, { lat: 28, lng: 31 }])).data).toMatchObject({ source: 'straight' });
    expect(stub.hits.length).toBe(before);
    await s.server.app.inject({ method: 'PUT', url: '/api/v1/settings/maps', headers: s.write, payload: { enabled: true } });
  }, 20_000);
});

describe('POST /geo/route with a slow routing server', () => {
  it('gives up after its time limit and answers straight', async () => {
    const stub = await startStub();
    stub.mode = 'slow';
    const router = createRouter({ state: async () => ({ enabled: true, server: 'https://tiles.example.com', routing: true, routingServer: stub.origin }), blockLoopback: false, timeoutMs: 200 });
    const started = Date.now();
    expect(await router.route([TAHRIR, GIZA_GATE])).toMatchObject({ source: 'straight', fellBack: true });
    expect(Date.now() - started).toBeLessThan(1_400);
    expect(stub.hits).toHaveLength(1);
    await stub.close();
  }, 20_000);

  it('stops reading a reply longer than its size limit', async () => {
    const stub = await startStub();
    stub.mode = 'ok';
    const router = createRouter({ state: async () => ({ enabled: true, server: 'https://tiles.example.com', routing: true, routingServer: stub.origin }), blockLoopback: false, maxBytes: 64 });
    expect(await router.route([TAHRIR, GIZA_GATE])).toMatchObject({ source: 'straight', fellBack: true });
    await stub.close();
  }, 20_000);
});

describe('POST /geo/route on an install that makes no outside calls', () => {
  let stub: Stub;
  let s: GeoServer;
  let guard: NetGuard | undefined;
  beforeAll(async () => {
    stub = await startStub();
    // ADMINIUM_NETWORK_FEATURES=off: the routing switch, even set, sends nothing anywhere.
    s = await geoServer({ ADMINIUM_ROUTING_SERVER: stub.origin, ADMINIUM_NETWORK_FEATURES: 'off' });
    await settingsRepo(s.meta).set('maps.routing', true, { updatedBy: null });
    s.server.app.maps.drop();
  }, 60_000);
  afterEach(() => {
    guard?.restore();
    guard = undefined;
  });
  afterAll(async () => {
    await s.close();
    await stub.close();
  });

  it('answers straight legs, not fallen back, with no attempt recorded', async () => {
    guard = disableNetwork();
    const res = await s.server.app.inject({ method: 'POST', url: '/api/v1/geo/route', headers: s.write, payload: { stops: [TAHRIR, GIZA_GATE] } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: { source: 'straight', legs: [{ distanceM: straightMetres(TAHRIR, GIZA_GATE), durationS: null, estimate: true }] } });
    expect(guard.attempts).toEqual([]);
    guard.restore();
    guard = undefined;
    expect(stub.hits).toHaveLength(0);
    // And the bootstrap tells the page the same.
    const boot = await s.server.app.inject({ method: 'GET', url: '/api/v1/bootstrap', headers: { cookie: s.cookie } });
    expect((boot.json() as { data: { maps: unknown } }).data.maps).toEqual({ enabled: true, server: 'https://tiles.openfreemap.org', routing: false });
  });
});
